/**
 * 用户认证模块
 * JWT-based authentication for 一键上岸 commercialization
 */
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..');
const USERS_FILE = path.join(DATA_DIR, '.data', 'users.json');
const JWT_SECRET = process.env.JWT_SECRET || 'yijianshangan-jwt-secret-change-in-production';
const JWT_EXPIRES_IN = '30d';
const FREE_TIER = {
  dailyEvaluations: 3,
  dailyAnalyses: 1,
  creditEquivalent: 10
};

// ─── User Storage ───────────────────────────────────────────

function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    }
  } catch (e) { console.error('Load users failed:', e.message); }
  return {};
}

function saveUsers(users) {
  try {
    const dir = path.dirname(USERS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
  } catch (e) { console.error('Save users failed:', e.message); }
}

// ─── Auth Middleware ─────────────────────────────────────────

/**
 * 验证 JWT，将用户信息注入 req.user
 * 如果请求中无 token，则 req.user = null（兼容未登录的免费模式）
 */
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
  } catch (e) {
    req.user = null;
  }
  next();
}

/**
 * 强制要求登录的中间件
 */
function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: '请先登录' });
  }
  next();
}

// ─── Auth Routes ─────────────────────────────────────────────

function registerAuthRoutes(app) {

  // POST /api/auth/register
  app.post('/api/auth/register', async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: '邮箱和密码不能为空' });
      }
      if (password.length < 6) {
        return res.status(400).json({ error: '密码至少6位' });
      }
      const users = loadUsers();
      const existing = Object.values(users).find(u => u.email === email);
      if (existing) {
        return res.status(409).json({ error: '该邮箱已注册' });
      }
      const userId = 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const passwordHash = await bcrypt.hash(password, 10);
      users[userId] = {
        email,
        passwordHash,
        createdAt: new Date().toISOString(),
        freeUsedToday: { date: '', evaluations: 0, analyses: 0 }
      };
      saveUsers(users);

      // 初始化用户 sessions 文件
      const userSessionsFile = path.join(DATA_DIR, '.data', `sessions_${userId}.json`);
      if (!fs.existsSync(userSessionsFile)) {
        fs.writeFileSync(userSessionsFile, '{}', 'utf8');
      }

      const token = jwt.sign({ userId, email, isAdmin: !!user.isAdmin }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
      res.json({ token, userId, email, isAdmin: !!user.isAdmin });
    } catch (e) {
      console.error('Register error:', e);
      res.status(500).json({ error: '注册失败' });
    }
  });

  // POST /api/auth/login
  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: '邮箱和密码不能为空' });
      }
      const users = loadUsers();
      const entry = Object.entries(users).find(([_, u]) => u.email === email);
      if (!entry) {
        return res.status(401).json({ error: '邮箱或密码错误' });
      }
      const [userId, user] = entry;
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        return res.status(401).json({ error: '邮箱或密码错误' });
      }
      const token = jwt.sign({ userId, email, isAdmin: !!user.isAdmin }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
      res.json({ token, userId, email, isAdmin: !!user.isAdmin });
    } catch (e) {
      console.error('Login error:', e);
      res.status(500).json({ error: '登录失败' });
    }
  });

  // GET /api/auth/me
  app.get('/api/auth/me', requireAuth, (req, res) => {
    const users = loadUsers();
    const user = users[req.user.userId];
    if (!user) return res.status(404).json({ error: '用户不存在' });
    res.json({
      userId: req.user.userId,
      email: user.email,
      createdAt: user.createdAt,
      isAdmin: !!user.isAdmin
    });
  });

  // GET /api/auth/free-quota
  app.get('/api/auth/free-quota', async (req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    // 未登录用户：返回默认免费配额
    if (!req.user) {
      return res.json({
        loggedIn: false,
        free: { dailyEvaluations: FREE_TIER.dailyEvaluations, dailyAnalyses: FREE_TIER.dailyAnalyses }
      });
    }
    const users = loadUsers();
    const user = users[req.user.userId];
    if (!user) return res.status(404).json({ error: '用户不存在' });
    const freeUsed = user.freeUsedToday || { date: '', evaluations: 0, analyses: 0 };
    if (freeUsed.date !== today) {
      return res.json({
        loggedIn: true,
        free: {
          dailyEvaluations: FREE_TIER.dailyEvaluations,
          dailyAnalyses: FREE_TIER.dailyAnalyses,
          usedEvaluations: 0,
          usedAnalyses: 0
        }
      });
    }
    res.json({
      loggedIn: true,
      free: {
        dailyEvaluations: FREE_TIER.dailyEvaluations,
        dailyAnalyses: FREE_TIER.dailyAnalyses,
        usedEvaluations: freeUsed.evaluations || 0,
        usedAnalyses: freeUsed.analyses || 0
      }
    });
  });
}

module.exports = { registerAuthRoutes, authMiddleware, requireAuth, loadUsers, saveUsers, JWT_SECRET, FREE_TIER, USERS_FILE };