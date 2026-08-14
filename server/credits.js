/**
 * 点数系统模块
 * Credit balance management, consumption tracking, and cost definitions
 */
const fs = require('fs');
const path = require('path');
const { loadUsers, saveUsers, FREE_TIER } = require('./auth');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..');
const CREDITS_FILE = path.join(DATA_DIR, '.data', 'credits.json');
const CREDIT_LOGS_FILE = path.join(DATA_DIR, '.data', 'credit_logs.json');

// ─── Cost Definitions (点数消耗) ─────────────────────────────

const API_COSTS = {
  'analyze': 3,              // 一键分析（押题生成）
  'evaluate-single': 1,      // 单题评估
  'follow-up': 1,            // AI追问
  'generate-model-answer': 1, // AI标准答案
  'generate-self-intro': 1,  // 自我介绍生成
  'interview-start': 2,      // 面试开始（含多题）
  'interview-evaluate': 2,   // 面试评估
  'optimize-resume': 2,      // 简历优化
  'mianjing-collect': 2,     // 面经采集
  'company-research': 2,     // 公司调研
  'interview-review': 2,     // 面试复盘
  'group-interview': 3,      // 群面模拟
  'drill-evaluate': 1,       // 专项训练评估
  'behavioral-answer': 1,    // 通用题库回答
  'study-plan': 1,           // 备考方案
  'counter-questions': 1,    // 反问生成
  'code-interview-generate': 2,  // 代码题生成
  'code-interview-review': 1,    // 代码审查
};

// ─── Credit Storage ──────────────────────────────────────────

function loadCredits() {
  try {
    if (fs.existsSync(CREDITS_FILE)) {
      return JSON.parse(fs.readFileSync(CREDITS_FILE, 'utf8'));
    }
  } catch (e) { console.error('Load credits failed:', e.message); }
  return {};
}

function saveCredits(credits) {
  try {
    const dir = path.dirname(CREDITS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CREDITS_FILE, JSON.stringify(credits, null, 2), 'utf8');
  } catch (e) { console.error('Save credits failed:', e.message); }
}

function loadCreditLogs() {
  try {
    if (fs.existsSync(CREDIT_LOGS_FILE)) {
      return JSON.parse(fs.readFileSync(CREDIT_LOGS_FILE, 'utf8'));
    }
  } catch (e) { console.error('Load credit logs failed:', e.message); }
  return {};
}

function saveCreditLogs(logs) {
  try {
    const dir = path.dirname(CREDIT_LOGS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CREDIT_LOGS_FILE, JSON.stringify(logs, null, 2), 'utf8');
  } catch (e) { console.error('Save credit logs failed:', e.message); }
}

// ─── Credit Operations ───────────────────────────────────────

function getBalance(userId) {
  const credits = loadCredits();
  return credits[userId] || { balance: 0, totalEarned: 0, totalSpent: 0 };
}

function addCredits(userId, amount, action, feature) {
  const credits = loadCredits();
  if (!credits[userId]) {
    credits[userId] = { balance: 0, totalEarned: 0, totalSpent: 0 };
  }
  credits[userId].balance += amount;
  credits[userId].totalEarned += amount;
  saveCredits(credits);

  // Log
  const logs = loadCreditLogs();
  if (!logs[userId]) logs[userId] = [];
  logs[userId].push({
    amount,
    action: action || 'purchase',
    feature: feature || '充值',
    balanceAfter: credits[userId].balance,
    createdAt: new Date().toISOString()
  });
  // Keep last 500 logs
  if (logs[userId].length > 500) logs[userId] = logs[userId].slice(-500);
  saveCreditLogs(logs);

  return credits[userId];
}

function deductCredits(userId, amount, feature) {
  if (amount <= 0) return { success: true, free: true };

  const credits = loadCredits();
  if (!credits[userId]) {
    credits[userId] = { balance: 0, totalEarned: 0, totalSpent: 0 };
  }
  if (credits[userId].balance < amount) {
    return { success: false, balance: credits[userId].balance, required: amount };
  }
  credits[userId].balance -= amount;
  credits[userId].totalSpent += amount;
  saveCredits(credits);

  const logs = loadCreditLogs();
  if (!logs[userId]) logs[userId] = [];
  logs[userId].push({
    amount: -amount,
    action: 'consume',
    feature,
    balanceAfter: credits[userId].balance,
    createdAt: new Date().toISOString()
  });
  if (logs[userId].length > 500) logs[userId] = logs[userId].slice(-500);
  saveCreditLogs(logs);

  return { success: true, balance: credits[userId].balance };
}

// ─── Free Tier Check ─────────────────────────────────────────

function useFreeTier(userId, type) {
  // type: 'evaluation' | 'analysis'
  const users = loadUsers();
  const user = users[userId];
  if (!user) return { success: false, reason: '用户不存在' };

  const today = new Date().toISOString().slice(0, 10);
  const freeUsed = user.freeUsedToday || { date: '', evaluations: 0, analyses: 0 };

  if (freeUsed.date !== today) {
    freeUsed.date = today;
    freeUsed.evaluations = 0;
    freeUsed.analyses = 0;
  }

  if (type === 'evaluation') {
    if (freeUsed.evaluations >= FREE_TIER.dailyEvaluations) {
      return { success: false, reason: '今日免费评估次数已用完' };
    }
    freeUsed.evaluations++;
  } else if (type === 'analysis') {
    if (freeUsed.analyses >= FREE_TIER.dailyAnalyses) {
      return { success: false, reason: '今日免费分析次数已用完' };
    }
    freeUsed.analyses++;
  }

  user.freeUsedToday = freeUsed;
  saveUsers(users);
  return { success: true, remaining: { evaluations: FREE_TIER.dailyEvaluations - freeUsed.evaluations, analyses: FREE_TIER.dailyAnalyses - freeUsed.analyses } };
}

// ─── Credit Check Middleware ──────────────────────────────────

/**
 * 点数检查中间件工厂函数
 * @param {string} costKey - API_COSTS 中的 key
 * @param {string} freeTierType - 免费层类型: 'evaluation' | 'analysis' | null
 */
function creditCheck(costKey, freeTierType) {
  return (req, res, next) => {
    // 未登录用户：检查免费配额
    if (!req.user) {
      if (freeTierType) {
        // 未登录用户使用临时配额（简单计数，不持久化）
        // 实际通过前端 localStorage 控制
        return next();
      }
      return res.status(402).json({ error: '请登录后使用', code: 'AUTH_REQUIRED' });
    }

    const cost = API_COSTS[costKey] || 1;
    const userId = req.user.userId;

    // 1. 先检查是否可以使用免费配额
    if (freeTierType) {
      const freeResult = useFreeTier(userId, freeTierType);
      if (freeResult.success) {
        // 免费使用，附加剩余配额信息
        req._creditUsed = { cost: 0, free: true, ...freeResult };
        return next();
      }
    }

    // 2. 免费配额用完，尝试扣点数
    const result = deductCredits(userId, cost, costKey);
    if (!result.success) {
      return res.status(402).json({
        error: '点数不足',
        code: 'INSUFFICIENT_CREDITS',
        balance: result.balance,
        required: result.required
      });
    }

    req._creditUsed = { cost, free: false, balance: result.balance };
    next();
  };
}

// ─── Credit Routes ────────────────────────────────────────────

function registerCreditRoutes(app) {
  const { requireAuth } = require('./auth');

  // GET /api/user/credits
  app.get('/api/user/credits', requireAuth, (req, res) => {
    const balance = getBalance(req.user.userId);
    res.json(balance);
  });

  // GET /api/user/credit-logs
  app.get('/api/user/credit-logs', requireAuth, (req, res) => {
    const logs = loadCreditLogs();
    const userLogs = (logs[req.user.userId] || []).slice(-50).reverse();
    res.json(userLogs);
  });

  // GET /api/credits/costs
  app.get('/api/credits/costs', (req, res) => {
    res.json(API_COSTS);
  });
}

module.exports = { registerCreditRoutes, creditCheck, getBalance, addCredits, deductCredits, useFreeTier, API_COSTS, loadCredits, saveCredits, loadCreditLogs, saveCreditLogs };