// ============================================================
// 一键上岸 - Express 服务器
// 将 Chatflow 引擎暴露为 REST API，前端通过 API 调用
// ============================================================

try { require('dotenv').config(); } catch {}
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { execSync, exec } = require('child_process');

// ============================================================
// async exec 辅助 — 避免长时间子进程阻塞 event loop
// ============================================================
function execAsync(cmd, options = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: options.timeout || 30000, maxBuffer: options.maxBuffer || 5 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
      if (error) {
        if (stdout && stdout.length > 20) resolve(stdout);
        else reject(error);
      } else resolve(stdout);
    });
  });
}
async function closeOpencliWindow() {
  try { await execAsync('opencli close', { timeout: 5000 }); } catch {}
}

// ---- 数据目录 (Electron模式用app.getPath('userData')，普通模式用__dirname) ----
const DATA_DIR = process.env.DATA_DIR || __dirname;
// ---- 日志系统（同时输出控制台 + 文件） ----
const LOG_DIR = path.join(DATA_DIR, 'logs');
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}
const LOG_FILE = path.join(LOG_DIR, 'error.log');

function log(level, msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const line = `[${ts}] [${level}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
}
function logInfo(msg)  { log('INFO', msg); }
function logWarn(msg)  { log('WARN', msg); }
function logError(msg) { log('ERROR', msg); }

process.on('uncaughtException', (err) => {
  logError('未捕获异常: ' + (err.stack || err.message));
});
process.on('unhandledRejection', (reason) => {
  logError('未处理的Promise拒绝: ' + (reason?.stack || reason?.message || reason));
});

logInfo('========== 一键上岸 启动 ==========');

const {
  runAnalysisPipeline,
  createInterviewSession,
  interviewStart,
  interviewRespond,
  evaluateFullSession,
  optimizeResume,
  groupInterviewStart,
  groupInterviewRespond,
  groupInterviewEvaluate
} = require('./chatflow/engine');

// ============================================================
// 多轮面试 - 岗位类型轮次预设
// ============================================================
const ROUND_PRESETS = {
  '技术岗': {
    label: '技术岗',
    rounds: [
      { round: 1, type: 'technical', label: '技术面', questionTypes: ['专业能力'], desc: '考察技术栈掌握程度、项目技术难点' },
      { round: 2, type: 'project_stress', label: '项目深挖+压力面', questionTypes: ['项目深挖', '压力测试'], desc: '深挖项目细节、考察抗压能力' },
      { round: 3, type: 'hr', label: 'HR面', questionTypes: ['行为面试', 'HR面'], desc: '考察综合素质、职业规划、团队协作' }
    ]
  },
  '产品岗': {
    label: '产品岗',
    rounds: [
      { round: 1, type: 'product', label: '产品思维面', questionTypes: ['专业能力', '行为面试'], desc: '考察产品思维、需求分析、数据驱动决策' },
      { round: 2, type: 'comprehensive', label: '综合面', questionTypes: ['项目深挖', '压力测试', 'HR面'], desc: '深挖项目经验、考察综合素质' }
    ]
  },
  '运营岗': {
    label: '运营岗',
    rounds: [
      { round: 1, type: 'operations', label: '运营策略面', questionTypes: ['专业能力', '行为面试'], desc: '考察运营策略、数据分析、用户增长' },
      { round: 2, type: 'comprehensive', label: '综合面', questionTypes: ['项目深挖', '压力测试', 'HR面'], desc: '考察综合能力、抗压能力、职业规划' }
    ]
  },
  '设计岗': {
    label: '设计岗',
    rounds: [
      { round: 1, type: 'design', label: '设计思维面', questionTypes: ['专业能力', '行为面试'], desc: '考察设计思维、用户研究、视觉表达' },
      { round: 2, type: 'comprehensive', label: '综合面', questionTypes: ['项目深挖', '压力测试', 'HR面'], desc: '考察综合能力、团队协作、职业规划' }
    ]
  },
  '市场/销售岗': {
    label: '市场/销售岗',
    rounds: [
      { round: 1, type: 'business', label: '业务能力面', questionTypes: ['专业能力', '行为面试'], desc: '考察市场策略、销售技巧、商务谈判' },
      { round: 2, type: 'comprehensive', label: '综合面', questionTypes: ['项目深挖', '压力测试', 'HR面'], desc: '考察综合能力、抗压能力、职业规划' }
    ]
  },
  '通用/管理岗': {
    label: '通用/管理岗',
    rounds: [
      { round: 1, type: 'management', label: '专业面', questionTypes: ['专业能力', '行为面试'], desc: '考察专业能力和管理经验' },
      { round: 2, type: 'stress', label: '压力面', questionTypes: ['压力测试', '项目深挖'], desc: '考察抗压能力和应变能力' },
      { round: 3, type: 'hr', label: 'HR面', questionTypes: ['HR面', '行为面试'], desc: '考察综合素质、职业规划' }
    ]
  }
};

// 根据JD中的岗位名推断岗位类型
function detectPositionType(position) {
  if (!position) return '通用/管理岗';
  const p = position.toLowerCase();
  if (/技术|开发|工程|算法|后端|前端|全栈|java|python|go|rust|架构|运维|测试|数据|ai|ml|deep learning|机器学习/.test(p)) return '技术岗';
  if (/产品|pm|产品经理/.test(p)) return '产品岗';
  if (/运营|增长|新媒体|内容|社群|用户运营/.test(p)) return '运营岗';
  if (/设计|ui|ux|视觉|交互|产品设计/.test(p)) return '设计岗';
  if (/市场|销售|商务|bd|渠道|营销|推广/.test(p)) return '市场/销售岗';
  if (/管理|总监|经理|主管|lead|head|director/.test(p)) return '通用/管理岗';
  return '通用/管理岗';
}

// ---- ai-provider-kit 集成（云端自动降级） ----
let provider;
try {
  provider = require('./chatflow/ai-provider');
  console.log('[Server] 使用 ai-provider-kit');
} catch (e) {
  console.log('[Server] ai-provider-kit 不可用, 使用独立连接存储');
  provider = require('./chatflow/conn-store');
}

const {
  listConnections,
  saveConnection,
  setActiveConnection,
  deleteConnection,
  testConnection,
  listProviders,
  fetchModels,
  startGateway = () => { throw new Error('gateway unavailable'); },
  PROVIDER_KIT_PATH = '',
  setConnectionTemperature = () => {},
  getConnectionTemperature = () => 0.7,
  getTokenUsage = () => ({ prompt: 0, completion: 0, total: 0, calls: 0 })
} = provider;

const app = express();
app.use(express.json({ limit: '2mb' }));

// ─── 商业化模块 ───────────────────────────────────────────────
const { authMiddleware, registerAuthRoutes } = require('./server/auth');
const { creditCheck, registerCreditRoutes } = require('./server/credits');
const { registerPlanRoutes } = require('./server/plans');
const { registerAdminRoutes } = require('./server/admin');
const { registerCodeInterviewRoutes } = require('./server/code-interview');

// 认证中间件：解析 JWT，注入 req.user
app.use(authMiddleware);

// 注册商业化路由
registerAuthRoutes(app);
registerCreditRoutes(app);
registerPlanRoutes(app);
registerAdminRoutes(app);
registerCodeInterviewRoutes(app);

app.use(express.static(path.join(__dirname, 'public')));
app.use('/knowledge', express.static(path.join(__dirname, 'knowledge')));

// ============================================================
// Render 健康检查端点
// ============================================================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// 文件上传
const upload = multer({
  dest: path.join(DATA_DIR, '.data', 'uploads'),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '.txt').toLowerCase();
    if (['.txt','.md','.docx','.doc','.pdf'].includes(ext)) cb(null, true);
    else cb(new Error('仅支持 TXT / MD / DOCX / PDF 文件'));
  }
});

// ---- 会话存储 ----
const SESSIONS_FILE = path.join(DATA_DIR, '.data', 'sessions.json');
const PHRASES_FILE = path.join(DATA_DIR, '.data', 'phrase-library.json');
const MIANJING_BANK_FILE = path.join(DATA_DIR, '.data', 'mianjing-bank.json');
const COMPANY_RESEARCH_HISTORY_FILE = path.join(DATA_DIR, '.data', 'company-research-history.json');

// 确保数据目录存在
try { fs.mkdirSync(path.join(DATA_DIR, '.data'), { recursive: true }); } catch {}

const sessions = new Map();
let activeSessionId = null;

// 会话持久化
function loadSessions() {
  try { if (fs.existsSync(SESSIONS_FILE)) { const d = JSON.parse(fs.readFileSync(SESSIONS_FILE,'utf-8')); for (const [k,v] of Object.entries(d)) sessions.set(k,v); const keys = Object.keys(d); if (keys.length) activeSessionId = keys[0]; } }
  catch(e) { console.warn('会话加载失败:', e.message); }
}
function saveSessions() {
  try { fs.writeFileSync(SESSIONS_FILE, JSON.stringify(Object.fromEntries(sessions), null, 2)); } catch {}
}
loadSessions();

// ---- JD 分析缓存 ----
const jdCache = new Map(); // key: jdHash -> { jdParsed, gapAnalysis, questions, timestamp }
const JD_CACHE_TTL = 24 * 60 * 60 * 1000; // 24小时过期
function getJdCacheKey(jdText) { return require('crypto').createHash('md5').update(jdText.slice(0, 2000)).digest('hex'); }
function getJdCache(jdText) {
  const key = getJdCacheKey(jdText);
  const entry = jdCache.get(key);
  if (entry && Date.now() - entry.timestamp < JD_CACHE_TTL) return entry;
  return null;
}
function setJdCache(jdText, data) {
  const key = getJdCacheKey(jdText);
  jdCache.set(key, { ...data, timestamp: Date.now() });
  // 限制缓存大小
  if (jdCache.size > 50) {
    const oldest = [...jdCache.entries()].sort((a,b) => a[1].timestamp - b[1].timestamp)[0];
    if (oldest) jdCache.delete(oldest[0]);
  }
}


// 面经库持久化
function loadMianjingBank() {
  try { if (fs.existsSync(MIANJING_BANK_FILE)) return JSON.parse(fs.readFileSync(MIANJING_BANK_FILE,'utf-8')); }
  catch(e) { return []; }
  return [];
}
function saveMianjingBank(bank) {
  try { fs.writeFileSync(MIANJING_BANK_FILE, JSON.stringify(bank, null, 2)); } catch {}
}

// 话术库持久化
function loadPhrases() {
  try { if (fs.existsSync(PHRASES_FILE)) return JSON.parse(fs.readFileSync(PHRASES_FILE,'utf-8')); }
  catch(e) { return []; }
  return [];
}
function savePhrases(phrases) {
  try { fs.writeFileSync(PHRASES_FILE, JSON.stringify(phrases, null, 2)); } catch {}
}

// ============================================================
// SSE + 进程安全
// ============================================================
function sseInit(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
}
function sseSend(res, data) {
  try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch {}
}
function sseDone(res, data) {
  try { res.write(`data: ${JSON.stringify({ ...data, _done: true })}\n\n`); } catch {}
  try { res.end(); } catch {}
}
function sseError(res, msg) {
  try { sseSend(res, { error: String(msg) }); } catch {}
  try { sseDone(res, { error: String(msg) }); } catch {}
}

// 安全 LLM 调用 + 自动重试：捕获所有异常，返回 { value, error }
async function safeCall(fn, retries = 1) {
  let lastError;
  for (let i = 0; i <= retries; i++) {
    try {
      const val = await fn();
      return { value: val };
    } catch (e) {
      lastError = e?.message || String(e);
      if (i < retries) {
        console.warn(`[LLM] 调用失败，1秒后重试 (${i+1}/${retries}): ${lastError}`);
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
  return { error: lastError };
}


// ============================================================
// JD 链接自动解析
// ============================================================
app.post('/api/parse-jd-url', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: '请提供JD链接' });

    const { llm } = require('./chatflow/llm-client');
    const prompts = require('./chatflow/prompts');

    // 尝试 fetch 页面
    let pageText = '';
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(15000)
      });
      const html = await resp.text();
      // 简单提取文本
      pageText = html.replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 8000);
    } catch (e) {
      return res.status(400).json({ error: '无法访问该链接: ' + e.message });
    }

    if (!pageText || pageText.length < 100) {
      return res.status(400).json({ error: '页面内容为空或太短，请手动粘贴JD' });
    }

    // 用 LLM 提取 JD
    const result = await llm(
      `你是一个JD提取助手。从以下网页文本中提取招聘岗位的完整JD信息。
      输出JSON格式: {"company":"公司名","position":"岗位名","jd_text":"完整的JD内容（包括职责、要求、福利等）","location":"工作地点","source":"来源网站"}
      如果页面不是招聘页面，返回 {"error":"不是招聘页面"}`,
      pageText, { temperature: 0.3 }
    );

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: '解析失败: ' + e.message });
  }
});

// ============================================================
// API 1: 一键分析（SSE 流式 + 进度 + 预估剩余时间）
// ============================================================
app.post('/api/analyze', creditCheck('analyze', 'analysis'), async (req, res) => {
  const { jdText, resumeText, useMianjing, quickMode, manualUrls, resumeFileName, resumeSourceType } = req.body;
  if (!jdText || !resumeText) {
    return res.status(400).json({ error: '请同时提供JD文本和简历文本' });
  }

  // 快速模式：跳过面经，只用3类核心题型

  sseInit(res);

  // 检查 JD 缓存
  const cachedJD = getJdCache(jdText);
  if (cachedJD) {
    sseSend(res, { step: 'cache', label: '缓存命中', detail: 'JD分析结果已缓存，跳过解析...', status: 'ok' });
  }

  let aborted = false;
  res.on('close', () => { aborted = true; });

  // 步骤耗时追踪（用于预估剩余时间）
  const stepTimes = {};
  const totalSteps = 6; // jd_parse, resume_parse, gap, question_gen(视为1步), kb, done
  const t0 = Date.now();

  function eta(completedSteps) {
    const elapsed = (Date.now() - t0) / 1000;
    const avg = completedSteps > 0 ? elapsed / completedSteps : 5;
    const remaining = Math.ceil(avg * (totalSteps - completedSteps));
    return remaining > 0 ? ` ⏱ 预计剩余 ${remaining} 秒` : '';
  }
  let completedSteps = 0;

  function stepOk(res, step, label, detail) {
    completedSteps++;
    sseSend(res, { step, label, detail: detail + eta(completedSteps), status: 'ok' });
  }
  function stepWarn(res, step, label, detail) {
    completedSteps++;
    sseSend(res, { step, label, detail: detail + eta(completedSteps), status: 'warn' });
  }

  try {
    const prompts = require('./chatflow/prompts');
    const { llm, fillTemplate } = require('./chatflow/llm-client');
    const { searchKnowledgeBase } = require('./knowledge');

    // ---- 步骤1: JD解析 (优先使用缓存) ----
    let jdParsed, company, position;
    if (cachedJD && cachedJD.jdParsed) {
      jdParsed = cachedJD.jdParsed;
      company = jdParsed.company || '';
      position = jdParsed.position || '';
      sseSend(res, { step: 'jd_parse', label: '解析JD', detail: `从缓存加载: ${position || '未知'} · ${company || '未知'}`, status: 'ok' });
      completedSteps++;
    } else {
      sseSend(res, { step: 'jd_parse', label: '解析JD', detail: '正在理解岗位要求...', status: 'running' });
      const jdResult = await safeCall(() => llm(prompts.JD_PARSE_SYSTEM, jdText, { temperature: 0.3 }));
      if (jdResult.error) { sseError(res, `JD解析失败: ${jdResult.error}`); return; }
      jdParsed = jdResult.value;
      company = jdParsed.company || '';
      position = jdParsed.position || '';
      stepOk(res, 'jd_parse', '解析JD', `识别到: ${position || '未知'} · ${company || '未知'}`);
    }
    if (aborted) return;

    // ---- 步骤2: 简历解析 ----
    sseSend(res, { step: 'resume_parse', label: '解析简历', detail: '正在提取经历/技能...', status: 'running' });
    const resumeResult = await safeCall(() => llm(prompts.RESUME_PARSE_SYSTEM, resumeText, { temperature: 0.3 }));
    if (resumeResult.error) { sseError(res, `简历解析失败: ${resumeResult.error}`); return; }
    const resumeParsed = resumeResult.value;
    stepOk(res, 'resume_parse', '解析简历', `${resumeParsed.internships?.length || 0} 段实习, ${resumeParsed.projects?.length || 0} 个项目`);
    if (aborted) return;

    // ---- 步骤3: 差距分析 (优先使用缓存) ----
    let gapAnalysis;
    if (cachedJD && cachedJD.gapAnalysis) {
      gapAnalysis = cachedJD.gapAnalysis;
      sseSend(res, { step: 'gap_analysis', label: '差距分析', detail: `从缓存加载 匹配度 ${gapAnalysis.match_score || '--'} 分`, status: 'ok' });
      completedSteps++;
    } else {
      sseSend(res, { step: 'gap_analysis', label: '差距分析', detail: '对比JD与简历...', status: 'running' });
      const gapPrompt = fillTemplate(prompts.GAP_ANALYSIS_SYSTEM, { jd_parsed: jdParsed, resume_parsed: resumeParsed });
      const gapResult = await safeCall(() => llm(gapPrompt, '', { temperature: 0.5 }));
      if (gapResult.error) { sseError(res, `差距分析失败: ${gapResult.error}`); return; }
      gapAnalysis = gapResult.value;
      stepOk(res, 'gap_analysis', '差距分析', `匹配度 ${gapAnalysis.match_score || '--'} 分`);
    }
    // 写入 JD 分析缓存
    setJdCache(jdText, { jdParsed, gapAnalysis });
    if (aborted) return;

    // ---- 步骤4: 押题生成（分题型并行） ----
    const questionTypes = quickMode
      ? ['行为面试', '专业能力', '项目深挖']  // 快速模式只用3类
      : ['行为面试', '专业能力', '项目深挖', '压力测试', 'HR面'];
    let allQuestions = [];
    let allInsights = {};
    const totalBatches = questionTypes.length;

    // ⚡ 5个题型互不依赖，全部并行
    sseSend(res, { step: 'question_gen', label: '生成押题', detail: `⚡ 并行生成 ${totalBatches} 类题目...`, status: 'running' });
    const qPromises = questionTypes.map(async (qType) => {
      const questionPrompt = fillTemplate(prompts.QUESTION_GEN_SYSTEM, {
        jd_parsed: jdParsed,
        resume_parsed: resumeParsed,
        gap_analysis: gapAnalysis,
        position: jdParsed.position || '',
        mianjing_data: '无面经数据',
        focus_type: qType
      });
      const qResult = await safeCall(() => llm(questionPrompt, '', { temperature: 0.7 }));
      return { type: qType, result: qResult };
    });

    const qResults = await Promise.all(qPromises);
    for (const { type, result } of qResults) {
      if (result.error) {
        console.warn(`[Analyze] 押题生成「${type}」失败:`, result.error);
        continue;
      }
      const batch = result.value;
      if (batch?.questions?.length) allQuestions.push(...batch.questions);
      if (batch?.insights) allInsights = { ...allInsights, ...batch.insights };
    }
    if (aborted) return;
    const questions = { questions: allQuestions, insights: allInsights };
    sseSend(res, { step: 'question_gen', label: '生成押题', detail: `✅ ${allQuestions.length} 题 · ${questionTypes.length}维度 (并行完成)`, status: 'ok' });

    // ---- 步骤6: 知识库增强 ----
    const kbQuestions = searchKnowledgeBase({
      company: jdParsed.company,
      position: jdParsed.position,
      industry: jdParsed.industry,
      keywords: jdParsed.keywords
    });

    // ---- 构建结果 ----
    const result = { jd: jdParsed, resume: resumeParsed, gap: gapAnalysis,
      questions: questions.questions || [], insights: questions.insights || {},
      mianjing: null, kb_supplement: kbQuestions.slice(0, 5) };

    const sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const label = jdParsed.position || jdParsed.company || '未命名';
    sessions.set(sessionId, { analysis: result, interview: null,
      jdText, resumeText, resumeFileName: resumeFileName || '', resumeSourceType: resumeSourceType || '',
      label, createdAt: Date.now(), fullExperiences: [] });
    activeSessionId = sessionId;
    saveSessions();

    sseDone(res, { step: 'done', sessionId, jd: result.jd, resume: result.resume,
      gap: result.gap, questions: result.questions, insights: result.insights,
      mianjing: result.mianjing, kb_supplement: result.kb_supplement });

  } catch (e) {
    console.error('[API] 分析致命错误:', e?.message || e);
    sseError(res, '分析失败: ' + (e?.message || String(e)));
  }
});

// JD 文本智能排版（手动粘贴时用）
app.post('/api/jd-format', async (req, res) => {
  const { text } = req.body;
  if (!text || text.length < 20) return res.status(400).json({ error: 'JD文本太短' });

  const formatPrompt = `你是一个JD排版助手。请将以下岗位JD文本重新排版，使其清晰易读。

## 排版规范
- **每条职责/要求独占一行**，以 "• " 或 "1. " 开头
- **小节标题**（如「岗位职责」「任职要求」「加分项」「工作内容」等）**独占一行**，不加任何前缀
- 保留所有原文信息，不删减、不改写、不润色
- 标题前后保留空行
- 仅输出排版后的纯文本，不要加任何解释

## 原始文本
${text.slice(0, 6000)}`;

  try {
    const { llm } = require('./chatflow/llm-client');
    const formatted = await llm(formatPrompt, '', { temperature: 0.1, jsonMode: false });
    // normalize: llm may return object or string
    let raw = typeof formatted === 'string' ? formatted : (formatted.text || formatted.content || formatted.raw || JSON.stringify(formatted));
    // fix double-escaped newlines from JSON round-trip
    raw = raw.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    const clean = raw.replace(/^```[a-z]*\n?/im, '').replace(/\n?```$/m, '').trim();
    res.json({ text: clean || text, changed: clean !== text });
  } catch (e) {
    res.status(500).json({ error: '排版失败: ' + (e.message || '').slice(0, 60) });
  }
});

// ============================================================
// API 2: 开始模拟面试
// ============================================================
app.post('/api/interview/start', creditCheck('interview-start', 'evaluation'), async (req, res) => {
  try {
    const { sessionId } = req.body;
    const session = sessions.get(sessionId);
    if (!session?.analysis) {
      return res.status(400).json({ error: '请先完成分析（调用 /api/analyze）' });
    }

    const interview = createInterviewSession(session.analysis);
    session.interview = interview;

    const company = session.analysis.jd?.company || '目标公司';
    const position = session.analysis.jd?.position || '目标岗位';
    const msg = await interviewStart(interview, company, position);

    res.json({
      type: 'start',
      message: msg,
      stage: interview.stage,
      questionInfo: null
    });
  } catch (e) {
    console.error('[API] 面试启动失败:', e);
    res.status(500).json({ error: '面试启动失败: ' + e.message });
  }
});

// ============================================================
// API 3: 回答当前问题
// ============================================================
app.post('/api/interview/answer', async (req, res) => {
  try {
    const { sessionId, answer } = req.body;
    const session = sessions.get(sessionId);
    if (!session?.interview) {
      return res.status(400).json({ error: '请先开始模拟面试' });
    }
    if (!answer || answer.trim().length < 3) {
      return res.status(400).json({ error: '回答内容太短' });
    }

    const result = await interviewRespond(session.interview, answer);
    res.json(result);
  } catch (e) {
    console.error('[API] 回答处理失败:', e);
    res.status(500).json({ error: '处理失败: ' + e.message });
  }
});

// ============================================================
// API 4: 跳过当前题（直接下一题）
// ============================================================
app.post('/api/interview/skip', async (req, res) => {
  try {
    const { sessionId } = req.body;
    const session = sessions.get(sessionId);
    if (!session?.interview) {
      return res.status(400).json({ error: '请先开始模拟面试' });
    }

    const result = await interviewRespond(session.interview, '（跳过）');
    res.json(result);
  } catch (e) {
    console.error('[API] 跳过失败:', e);
    res.status(500).json({ error: '跳过失败: ' + e.message });
  }
});

// ============================================================
// API 5: 结束面试并获取评估报告
// ============================================================
app.post('/api/interview/evaluate', creditCheck('interview-evaluate', null), async (req, res) => {
  try {
    const { sessionId } = req.body;
    const session = sessions.get(sessionId);
    if (!session?.interview) {
      return res.status(400).json({ error: '请先开始模拟面试' });
    }

    session.interview.stage = 'done';
    const report = await evaluateFullSession(session.interview, session.resumeText || '');

    res.json({
      stage: 'done',
      message: '面试已结束，以下是你的评估报告',
      report
    });
  } catch (e) {
    console.error('[API] 评估失败:', e);
    res.status(500).json({ error: '评估失败: ' + e.message });
  }
});

// ============================================================
// API: 压力面试（对抗练习）— 开始
// ============================================================
app.post('/api/interview/stress/start', async (req, res) => {
  try {
    const { sessionId } = req.body;
    const session = sessions.get(sessionId);
    if (!session?.analysis) {
      return res.status(400).json({ error: '请先完成分析（调用 /api/analyze）' });
    }

    const { llm, fillTemplate } = require('./chatflow/llm-client');
    const prompts = require('./chatflow/prompts');

    // 创建压力面试会话
    session.stressInterview = {
      stage: 'intro',
      currentQuestion: null,
      questionQueue: [...(session.analysis.questions || [])],
      askedQuestions: [],
      history: [],
      rounds: 0,
      maxRounds: 8,
      isActive: true,
      startTime: Date.now()
    };

    const company = session.analysis.jd?.company || '目标公司';
    const position = session.analysis.jd?.position || '目标岗位';
    const resumeSummary = JSON.stringify(session.analysis.resume || {});
    const jdSummary = JSON.stringify(session.analysis.jd || {});

    const systemPrompt = fillTemplate(prompts.STRESS_INTERVIEW_START_SYSTEM, {
      company, position, resume_summary: resumeSummary, jd_summary: jdSummary
    });

    const msg = await llm(systemPrompt, '请开始压力面试', { jsonMode: false, temperature: 0.9 });
    session.stressInterview.history.push({ role: 'interviewer', content: msg });
    session.stressInterview.currentQuestion = '开场';

    // 从题库取第一题
    const firstQ = session.stressInterview.questionQueue[0];
    if (firstQ) {
      session.stressInterview.askedQuestions.push(firstQ.question);
      session.stressInterview.currentQuestion = firstQ.question;
    }

    res.json({
      type: 'start',
      message: msg,
      stressMode: true,
      questionCount: session.stressInterview.questionQueue.length,
      tips: '💡 压力面试中，AI面试官会打断、质疑、施压。保持冷静，这是训练的一部分。'
    });
  } catch (e) {
    console.error('[API] 压力面试启动失败:', e);
    res.status(500).json({ error: '压力面试启动失败: ' + e.message });
  }
});

// ============================================================
// API: 压力面试（对抗练习）— 回答
// ============================================================
app.post('/api/interview/stress/respond', async (req, res) => {
  try {
    const { sessionId, answer } = req.body;
    const session = sessions.get(sessionId);
    if (!session?.stressInterview || !session.stressInterview.isActive) {
      return res.status(400).json({ error: '请先开始压力面试' });
    }

    const si = session.stressInterview;
    si.history.push({ role: 'candidate', content: answer });
    si.rounds++;

    const { llm, fillTemplate } = require('./chatflow/llm-client');
    const prompts = require('./chatflow/prompts');

    // 构建历史摘要
    const recentHistory = si.history.slice(-6).map(h =>
      (h.role === 'interviewer' ? '面试官: ' : '候选人: ') + h.content.slice(0, 200)
    ).join('\n');

    const resumeSummary = JSON.stringify(session.analysis.resume || {});
    const jdSummary = JSON.stringify(session.analysis.jd || {});

    const respondPrompt = fillTemplate(prompts.STRESS_INTERVIEW_RESPOND_SYSTEM, {
      history_summary: recentHistory,
      current_question: si.currentQuestion || '当前问题',
      candidate_answer: answer,
      jd_summary: jdSummary
    });

    let decision;
    try {
      decision = await llm(respondPrompt, '', { temperature: 0.8 });
    } catch {
      decision = { action: 'next_question', message: '下一个问题。', question: '', evaluate_current: false };
    }

    const action = decision.action || 'next_question';
    let responseMsg = decision.message || '';
    let nextQuestion = decision.question || '';

    // 根据 action 处理
    if (action === 'next_question' || action === 'end') {
      if (action === 'end' || si.rounds >= si.maxRounds) {
        si.isActive = false;
        si.stage = 'done';
        si.history.push({ role: 'interviewer', content: '压力面试结束。' });
        // 自动评估
        let report = null;
        try {
          const evalPrompt = fillTemplate(prompts.STRESS_INTERVIEW_EVALUATE_SYSTEM, {
            interview_history: si.history.map(h => h.role + ': ' + h.content).join('\n'),
            jd_summary: jdSummary
          });
          report = await llm(evalPrompt, '', { temperature: 0.5 });
        } catch {}

        return res.json({
          type: 'end',
          message: '压力面试结束！请查看评估报告。',
          report: report || null,
          stressMode: true
        });
      }

      // 取下一题
      const available = si.questionQueue.filter(q => !si.askedQuestions.includes(q.question));
      if (available.length > 0) {
        nextQuestion = available[0].question;
        si.askedQuestions.push(nextQuestion);
        si.currentQuestion = nextQuestion;
      } else {
        si.isActive = false;
        si.stage = 'done';
        return res.json({ type: 'end', message: '所有题目已用完，压力面试结束。', stressMode: true });
      }
    }

    if (action === 'interrupt' || action === 'challenge') {
      si.history.push({ role: 'interviewer', content: responseMsg });
    }

    // 通知作答
    if (action === 'next_question' || action === 'end') {
      si.history.push({ role: 'interviewer', content: nextQuestion || responseMsg });
    }

    res.json({
      type: action === 'interrupt' ? 'interrupt' : action === 'challenge' ? 'challenge' : action === 'silence' ? 'silence' : 'question',
      action,
      message: responseMsg,
      question: nextQuestion || responseMsg,
      stressMode: true,
      round: si.rounds,
      roundsLeft: si.maxRounds - si.rounds
    });
  } catch (e) {
    console.error('[API] 压力面试回答失败:', e);
    res.status(500).json({ error: '处理失败: ' + e.message });
  }
});

// ============================================================
// API: 压力面试（对抗练习）— 结束并评估
// ============================================================
app.post('/api/interview/stress/evaluate', async (req, res) => {
  try {
    const { sessionId } = req.body;
    const session = sessions.get(sessionId);
    if (!session?.stressInterview) {
      return res.status(400).json({ error: '未找到压力面试记录' });
    }

    const si = session.stressInterview;
    si.isActive = false;
    si.stage = 'done';

    const { llm, fillTemplate } = require('./chatflow/llm-client');
    const prompts = require('./chatflow/prompts');
    const jdSummary = JSON.stringify(session.analysis.jd || {});

    const evalPrompt = fillTemplate(prompts.STRESS_INTERVIEW_EVALUATE_SYSTEM, {
      interview_history: si.history.map(h => h.role + ': ' + h.content).join('\n'),
      jd_summary: jdSummary
    });

    const report = await llm(evalPrompt, '', { temperature: 0.5 });

    // 保存压力面试记录到话术库
    try {
      const phrasesPath = path.join(DATA_DIR, '.data', 'phrase-library.json');
      let phrases = [];
      try { phrases = JSON.parse(fs.readFileSync(phrasesPath, 'utf8')); } catch {}
      if (!Array.isArray(phrases)) phrases = [];
      phrases.push({
        id: 'stress_' + Date.now().toString(36),
        type: 'stress',
        question: '压力面试练习',
        answer: JSON.stringify(si.history.filter(h => h.role === 'candidate').map(h => h.content)),
        score: report?.total_score || 0,
        scores: report?.scores || {},
        improvedVersion: '',
        keyTakeaways: report?.advice || '',
        createdAt: new Date().toISOString(),
        tags: ['压力面试', '对抗练习'],
        source: 'stress_interview'
      });
      fs.writeFileSync(phrasesPath, JSON.stringify(phrases, null, 2));
    } catch {}

    res.json({ report, stressMode: true });
  } catch (e) {
    console.error('[API] 压力面试评估失败:', e);
    res.status(500).json({ error: '评估失败: ' + e.message });
  }
});

// ============================================================
// API: 面试陪练模式 — 开始自由对话
// ============================================================
app.post('/api/practice/free/start', async (req, res) => {
  try {
    const { sessionId } = req.body;
    const session = sessions.get(sessionId);
    if (!session?.analysis) {
      return res.status(400).json({ error: '请先完成分析（调用 /api/analyze）' });
    }

    const { llm, fillTemplate } = require('./chatflow/llm-client');
    const prompts = require('./chatflow/prompts');

    // 创建陪练会话
    session.freePractice = {
      isActive: true,
      history: [],
      rounds: 0,
      topics: [],
      startTime: Date.now()
    };

    const resumeSummary = JSON.stringify(session.analysis.resume || {});
    const jdSummary = JSON.stringify(session.analysis.jd || {});

    const systemPrompt = fillTemplate(prompts.FREE_PRACTICE_START_SYSTEM, {
      resume_summary: resumeSummary,
      jd_summary: jdSummary
    });

    const msg = await llm(systemPrompt, '开始陪练对话', { jsonMode: false, temperature: 0.8 });
    session.freePractice.history.push({ role: 'coach', content: msg });

    res.json({
      type: 'start',
      message: msg,
      freeMode: true,
      tips: '💡 自由对话模式，你可以随时反问、换话题、要求重复。就像和朋友聊天一样自然练习面试。'
    });
  } catch (e) {
    console.error('[API] 陪练启动失败:', e);
    res.status(500).json({ error: '陪练启动失败: ' + e.message });
  }
});

// ============================================================
// API: 面试陪练模式 — 自由对话回复
// ============================================================
app.post('/api/practice/free/respond', async (req, res) => {
  try {
    const { sessionId, message } = req.body;
    const session = sessions.get(sessionId);
    if (!session?.freePractice || !session.freePractice.isActive) {
      return res.status(400).json({ error: '请先开始陪练模式' });
    }

    const fp = session.freePractice;
    fp.history.push({ role: 'candidate', content: message });
    fp.rounds++;

    const { llm, fillTemplate } = require('./chatflow/llm-client');
    const prompts = require('./chatflow/prompts');

    const recentHistory = fp.history.slice(-8).map(h =>
      (h.role === 'coach' ? '陪练: ' : '候选人: ') + h.content.slice(0, 300)
    ).join('\n');

    const respondPrompt = fillTemplate(prompts.FREE_PRACTICE_RESPOND_SYSTEM, {
      history_summary: recentHistory,
      current_topic: fp.topics[fp.topics.length - 1] || '自由对话',
      candidate_answer: message
    });

    let response;
    try {
      response = await llm(respondPrompt, '', { temperature: 0.7 });
    } catch {
      response = { feedback: '感谢你的回答', follow_up: '还有什么想聊聊的吗？', type: 'switch_topic', can_end: false };
    }

    const feedback = response.feedback || '';
    const followUp = response.follow_up || '';
    const responseType = response.type || 'deep_dive';
    const canEnd = response.can_end || false;

    fp.history.push({ role: 'coach', content: followUp ? feedback + '\n\n' + followUp : feedback });

    res.json({
      feedback,
      followUp,
      type: responseType,
      canEnd,
      summary: response.summary || '',
      freeMode: true,
      round: fp.rounds
    });
  } catch (e) {
    console.error('[API] 陪练回复失败:', e);
    res.status(500).json({ error: '处理失败: ' + e.message });
  }
});

// ============================================================
// API: 面试陪练模式 — 结束并评估
// ============================================================
app.post('/api/practice/free/evaluate', async (req, res) => {
  try {
    const { sessionId } = req.body;
    const session = sessions.get(sessionId);
    if (!session?.freePractice) {
      return res.status(400).json({ error: '未找到陪练记录' });
    }

    const fp = session.freePractice;
    fp.isActive = false;

    const { llm, fillTemplate } = require('./chatflow/llm-client');
    const prompts = require('./chatflow/prompts');

    const evalPrompt = fillTemplate(prompts.FREE_PRACTICE_EVALUATE_SYSTEM, {
      conversation_history: fp.history.map(h => h.role + ': ' + h.content).join('\n')
    });

    const report = await llm(evalPrompt, '', { temperature: 0.5 });

    // 保存陪练记录
    try {
      const phrasesPath = path.join(DATA_DIR, '.data', 'phrase-library.json');
      let phrases = [];
      try { phrases = JSON.parse(fs.readFileSync(phrasesPath, 'utf8')); } catch {}
      if (!Array.isArray(phrases)) phrases = [];
      phrases.push({
        id: 'free_' + Date.now().toString(36),
        type: 'free_practice',
        question: '面试陪练练习',
        answer: JSON.stringify(fp.history.filter(h => h.role === 'candidate').map(h => h.content)),
        score: report?.total_score || 0,
        scores: report?.scores || {},
        improvedVersion: '',
        keyTakeaways: report?.practice_tips || '',
        createdAt: new Date().toISOString(),
        tags: ['陪练模式', '自由对话'],
        source: 'free_practice'
      });
      fs.writeFileSync(phrasesPath, JSON.stringify(phrases, null, 2));
    } catch {}

    res.json({ report, freeMode: true });
  } catch (e) {
    console.error('[API] 陪练评估失败:', e);
    res.status(500).json({ error: '评估失败: ' + e.message });
  }
});

// ============================================================
// API: 多轮面试 — 获取轮次信息
// ============================================================
app.get('/api/interview/multi/info', (req, res) => {
  try {
    const { sessionId } = req.query;
    const session = sessions.get(sessionId);
    if (!session?.analysis) {
      return res.json({ enabled: false, error: '请先完成分析' });
    }

    const position = session.analysis.jd?.position || '';
    const positionType = detectPositionType(position);
    const preset = ROUND_PRESETS[positionType];
    if (!preset) {
      return res.json({ enabled: false, error: '未能识别岗位类型' });
    }

    // 检查是否有足够题目覆盖所有轮次
    const questions = session.analysis.questions || [];
    const totalRounds = preset.rounds.length;
    const roundQuestionCounts = preset.rounds.map(r => {
      return questions.filter(q => r.questionTypes.some(t => (q.type || '').includes(t))).length;
    });
    const hasEnoughQuestions = roundQuestionCounts.every(c => c >= 1) && questions.length >= totalRounds * 2;

    // 判断是否已有正在进行的多轮面试
    const interview = session.interview;
    const activeMultiRound = interview && interview.multiRound && interview.multiRound.enabled;

    res.json({
      enabled: true,
      positionType: preset.label,
      totalRounds,
      rounds: preset.rounds,
      questionCounts: roundQuestionCounts,
      hasEnoughQuestions,
      activeMultiRound: activeMultiRound ? {
        currentRound: interview.multiRound.currentRound,
        currentRoundLabel: interview.multiRound.rounds[interview.multiRound.currentRound - 1]?.label || '',
        completedRounds: interview.multiRound.rounds.filter(r => r.status === 'completed').length,
        totalRounds: interview.multiRound.totalRounds,
        roundStatuses: interview.multiRound.rounds.map(r => ({
          round: r.round, label: r.label, status: r.status, score: r.score
        }))
      } : null
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// API: 多轮面试 — 开始面试（指定轮次）
// ============================================================
app.post('/api/interview/multi/start', async (req, res) => {
  try {
    const { sessionId, roundNumber } = req.body;
    const session = sessions.get(sessionId);
    if (!session?.analysis) {
      return res.status(400).json({ error: '请先完成分析' });
    }

    const position = session.analysis.jd?.position || '';
    const positionType = detectPositionType(position);
    const preset = ROUND_PRESETS[positionType];
    if (!preset) {
      return res.status(400).json({ error: '未能识别岗位类型，无法启动多轮面试' });
    }

    const targetRound = roundNumber || 1;
    const roundConfig = preset.rounds[targetRound - 1];
    if (!roundConfig) {
      return res.status(400).json({ error: '无效的轮次' });
    }

    // 创建或复用一个多轮面试会话
    let interview = session.interview;
    if (!interview || !interview.multiRound) {
      // 全新多轮面试
      interview = createInterviewSession(session.analysis);
      interview.multiRound = {
        enabled: true,
        currentRound: targetRound,
        totalRounds: preset.rounds.length,
        positionType: preset.label,
        rounds: preset.rounds.map(r => ({
          round: r.round,
          type: r.type,
          label: r.label,
          desc: r.desc,
          status: r.round === targetRound ? 'in_progress' : 'pending',
          score: null,
          report: null
        })),
        roundReports: []
      };
      session.interview = interview;
    } else {
      // 已有会话，切换到新轮次
      interview.multiRound.currentRound = targetRound;
      interview.multiRound.rounds[targetRound - 1].status = 'in_progress';

      // 重置面试状态
      interview.stage = 'intro';
      interview.stageIndex = 0;
      interview.currentQuestion = null;
      interview.followUpCount = 0;
      interview.maxFollowUps = 2;

      // 保留已问过的题目，但只保留当前轮次之前的
      // 重新设置题目队列：只包含当前轮次类型的题目
    }

    // 过滤题目：只保留当前轮次对应的题型
    const allQuestions = session.analysis.questions || [];
    const roundTypes = roundConfig.questionTypes;
    const filteredQuestions = allQuestions.filter(q =>
      roundTypes.some(t => (q.type || '').includes(t))
    );

    // 如果过滤后题目太少，补充一些其他类型的题目
    let finalQuestions = filteredQuestions.length >= 2 ? filteredQuestions : allQuestions.slice(0, Math.min(8, allQuestions.length));

    interview.questionQueue = [...finalQuestions];
    interview.askedQuestions = [];
    interview.history = [];

    const company = session.analysis.jd?.company || '目标公司';
    const position_ = session.analysis.jd?.position || '目标岗位';
    const msg = await interviewStart(interview, company, position_);

    res.json({
      type: 'start',
      message: msg,
      stage: interview.stage,
      roundInfo: {
        currentRound: targetRound,
        totalRounds: preset.rounds.length,
        roundLabel: roundConfig.label,
        roundDesc: roundConfig.desc,
        questionCount: finalQuestions.length
      }
    });
  } catch (e) {
    console.error('[API] 多轮面试启动失败:', e);
    res.status(500).json({ error: '多轮面试启动失败: ' + e.message });
  }
});

// ============================================================
// API: 多轮面试 — 结束当前轮次并评估
// ============================================================
app.post('/api/interview/multi/round-evaluate', async (req, res) => {
  try {
    const { sessionId } = req.body;
    const session = sessions.get(sessionId);
    if (!session?.interview?.multiRound) {
      return res.status(400).json({ error: '未找到多轮面试会话' });
    }

    const interview = session.interview;
    const mr = interview.multiRound;
    const currentRoundIdx = mr.currentRound - 1;
    const roundConfig = mr.rounds[currentRoundIdx];

    // 执行评估
    session.interview.stage = 'done';
    const report = await evaluateFullSession(session.interview, session.resumeText || '');

    // 保存轮次报告
    roundConfig.status = 'completed';
    roundConfig.score = report.overall_score || 0;
    roundConfig.report = {
      overall_score: report.overall_score,
      average_scores: report.average_scores,
      total_questions: report.total_questions,
      per_question: report.per_question,
      evaluatedAt: new Date().toISOString()
    };

    mr.roundReports.push({
      round: mr.currentRound,
      label: roundConfig.label,
      score: report.overall_score || 0,
      scores: report.average_scores || {},
      totalQuestions: report.total_questions || 0,
      evaluatedAt: new Date().toISOString()
    });

    // 检查是否所有轮次都已完成
    const allCompleted = mr.rounds.every(r => r.status === 'completed');
    const isLastRound = mr.currentRound >= mr.totalRounds;

    // 保存到会话
    saveSessions();

    // 同时保存到面试历史(localStorage由前端负责)
    res.json({
      stage: 'round_complete',
      roundScore: report.overall_score || 0,
      roundLabel: roundConfig.label,
      currentRound: mr.currentRound,
      totalRounds: mr.totalRounds,
      isLastRound,
      allCompleted,
      report: {
        overall_score: report.overall_score,
        average_scores: report.average_scores,
        total_questions: report.total_questions,
        per_question: report.per_question
      },
      nextRound: isLastRound ? null : {
        round: mr.currentRound + 1,
        label: mr.rounds[mr.currentRound]?.label || ''
      }
    });
  } catch (e) {
    console.error('[API] 多轮评估失败:', e);
    res.status(500).json({ error: '评估失败: ' + e.message });
  }
});

// ============================================================
// API: 多轮面试 — 获取综合报告（所有轮次）
// ============================================================
app.get('/api/interview/multi/report', (req, res) => {
  try {
    const { sessionId } = req.query;
    const session = sessions.get(sessionId);
    if (!session?.interview?.multiRound) {
      return res.status(400).json({ error: '未找到多轮面试数据' });
    }

    const mr = session.interview.multiRound;
    const completedRounds = mr.roundReports;

    // 计算综合评分
    let totalScore = 0;
    const avgScores = { star_completeness: 0, quantification: 0, position_match: 0, structure: 0, highlight: 0 };
    if (completedRounds.length > 0) {
      completedRounds.forEach(r => {
        totalScore += r.score || 0;
        if (r.scores) {
          Object.keys(avgScores).forEach(k => {
            avgScores[k] += (r.scores[k] || 0);
          });
        }
      });
      const count = completedRounds.length;
      totalScore = Math.round(totalScore / count);
      Object.keys(avgScores).forEach(k => {
        avgScores[k] = Math.round(avgScores[k] / count);
      });
    }

    // 轮次对比数据
    const roundComparisons = completedRounds.map(r => ({
      label: r.label,
      score: r.score,
      scores: r.scores,
      totalQuestions: r.totalQuestions,
      evaluatedAt: r.evaluatedAt
    }));

    res.json({
      enabled: true,
      positionType: mr.positionType,
      totalRounds: mr.totalRounds,
      completedRounds: completedRounds.length,
      overallScore: totalScore,
      averageScores: avgScores,
      roundReports: completedRounds,
      roundComparisons,
      rounds: mr.rounds
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// API 6: 简历优化
// ============================================================
app.post('/api/optimize-resume', creditCheck('optimize-resume', 'analysis'), async (req, res) => {
  try {
    const { sessionId } = req.body;
    const session = sessions.get(sessionId);
    if (!session?.analysis) {
      return res.status(400).json({ error: '请先完成分析' });
    }

    const result = await optimizeResume(
      session.analysis.jd,
      req.body.resumeText || ''
    );
    res.json(result);
  } catch (e) {
    console.error('[API] 简历优化失败:', e);
    res.status(500).json({ error: '简历优化失败: ' + e.message });
  }
});

// 简历优化 — 生成完整优化版 DOCX 供下载（内联生成，不依赖已删除的 export-resume 模块）
app.post('/api/optimize-resume-docx', async (req, res) => {
  try {
    const { sessionId } = req.body;
    const session = sessions.get(sessionId);
    if (!session?.analysis) {
      return res.status(400).json({ error: '请先完成分析' });
    }

    const prompts = require('./chatflow/prompts');
    const { llm, fillTemplate } = require('./chatflow/llm-client');
    const jdParsed = session.analysis.jd;
    const resumeText = session.resumeText || '';

    // 1. LLM 生成全文优化版
    const optPrompt = fillTemplate(prompts.RESUME_FULL_OPTIMIZE_SYSTEM, {
      jd_parsed: JSON.stringify(jdParsed, null, 2),
      resume_text: resumeText
    });
    const optimized = await llm(optPrompt, '', { temperature: 0.5 });

    if (!optimized?.optimized_full_text && !optimized?.optimized_sections) {
      return res.status(500).json({ error: 'AI 未能生成优化版简历，请重试' });
    }

    const fullText = optimized.optimized_full_text || 
      Object.values(optimized.optimized_sections || {}).filter(Boolean).join('\n\n');
    
    // 2. 内联生成 DOCX (不依赖已删除的 export-resume 模块)
    const { Document, Packer, Paragraph, TextRun, Header, AlignmentType } = require('docx');
    const CJK_FONT = 'Microsoft YaHei';
    const FONT = { ascii: 'Arial', hAnsi: 'Arial', eastAsia: CJK_FONT };
    
    const children = [];
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { after: 200 },
      children: [new TextRun({ text: 'AI 优化版简历', bold: true, size: 36, color: '4F46E5', font: FONT })]
    }));
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { after: 400 },
      children: [new TextRun({ text: '由 一键上岸 根据目标岗位 JD 自动优化', size: 18, color: '999999', font: FONT })]
    }));

    const sections = fullText.split(/\n{2,}/);
    for (const section of sections) {
      const trimmed = section.trim();
      if (!trimmed) continue;
      const lines = trimmed.split('\n');
      if (lines[0] && lines[0].length < 50 && !lines[0].startsWith('•') && !lines[0].startsWith('-')) {
        children.push(new Paragraph({
          spacing: { before: 280, after: 120 },
          children: [new TextRun({ text: lines[0], bold: true, size: 24, color: '4F46E5', font: FONT })]
        }));
        for (let i = 1; i < lines.length; i++) {
          if (lines[i].trim()) {
            children.push(new Paragraph({
              spacing: { after: 80 },
              children: [new TextRun({ text: lines[i].trim(), size: 22, font: FONT })]
            }));
          }
        }
      } else {
        for (const line of lines) {
          if (line.trim()) {
            children.push(new Paragraph({
              spacing: { after: 80 },
              children: [new TextRun({ text: line.trim(), size: 22, font: FONT })]
            }));
          }
        }
      }
    }

    const doc = new Document({
      styles: {
        default: { document: { run: { font: FONT, size: 22 } } }
      },
      sections: [{
        properties: {
          page: { size: { width: 11906, height: 16838 }, margin: { top: 1200, right: 1200, bottom: 1200, left: 1200 } }
        },
        headers: {
          default: new Header({ children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: '一键上岸 AI 优化生成', font: FONT, size: 18, color: '999999' })]
          })] })
        },
        children
      }]
    });
    const buf = await Packer.toBuffer(doc);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const filename = encodeURIComponent(jdParsed.position || 'resume');
    res.setHeader('Content-Disposition', `attachment; filename="resume-${filename}.docx"`);
    res.send(buf);
  } catch (e) {
    console.error('[API] 优化版简历DOCX生成失败:', e);
    res.status(500).json({ error: '生成失败: ' + e.message });
  }
});

// ============================================================
// API 6b: 简历评分
// ============================================================
app.post('/api/score-resume', async (req, res) => {
  try {
    const { resumeText } = req.body;
    if (!resumeText || resumeText.trim().length < 50) {
      return res.status(400).json({ error: '请提供至少50字的简历内容' });
    }
    const prompts = require('./chatflow/prompts');
    const { llm } = require('./chatflow/llm-client');
    const result = await llm(prompts.RESUME_SCORE_SYSTEM, resumeText, { temperature: 0.3 });
    // Normalize: ensure overall_score is average of scores
    if (result.scores) {
      const scores = result.scores;
      const vals = [scores.format, scores.completeness, scores.quantification, scores.star_structure, scores.position_alignment];
      const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
      result.overall_score = result.overall_score || avg;
    }
    // Validate suggestion length
    if (result.suggestion && result.suggestion.length > 300) {
      result.suggestion = result.suggestion.slice(0, 300);
    }
    res.json(result);
  } catch (e) {
    console.error('[API] 简历评分失败:', e);
    res.status(500).json({ error: '评分失败: ' + e.message });
  }
});

// ============================================================
// API 6c: 简历优化 SSE 流式
// ============================================================
app.post('/api/optimize-resume-stream', async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId || !sessions.has(sessionId)) {
      return res.status(404).json({ error: '会话不存在' });
    }
    const session = sessions.get(sessionId);
    const jdParsed = session.analysis?.jd;
    const resumeText = session.resumeText || '';

    if (!jdParsed) return res.status(400).json({ error: '请先完成JD分析' });

    // SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    const send = (data) => {
      res.write('data: ' + JSON.stringify(data) + '\n\n');
    };

    send({ type: 'start', message: '开始分析简历...' });

    const prompts = require('./chatflow/prompts');
    const { llm, fillTemplate } = require('./chatflow/llm-client');
    const optPrompt = fillTemplate(prompts.RESUME_OPTIMIZE_SYSTEM, {
      jd_parsed: JSON.stringify(jdParsed, null, 2),
      resume_text: resumeText
    });

    send({ type: 'progress', message: 'AI 正在逐段优化简历...' });

    try {
      const { llmStream } = require('./chatflow/llm-client');
      let fullText = '';
      for await (const chunk of llmStream(optPrompt, '', { temperature: 0.5 })) {
        fullText += chunk;
        send({ type: 'stream', chunk: chunk, partial: fullText.slice(-200) });
      }
      // Parse JSON result
      try {
        const codeBlock = fullText.match(/```(?:json)?\s*([\s\S]*?)```/);
        const candidate = codeBlock ? codeBlock[1] : fullText;
        const braceMatch = candidate.match(/\{[\s\S]*\}/);
        const result = JSON.parse(braceMatch ? braceMatch[0] : candidate);
        send({ type: 'done', result });
      } catch (parseErr) {
        send({ type: 'done', result: { raw: fullText, parse_error: true } });
      }
    } catch (streamErr) {
      console.warn('[SSE] 流式不可用，回退到普通调用:', streamErr.message);
      send({ type: 'progress', message: '流式暂不可用，正在获取优化结果...' });
      const result = await llm(optPrompt, '', { temperature: 0.5 });
      send({ type: 'done', result });
    }

    send({ type: 'end' });
    res.end();
  } catch (e) {
    console.error('[API] 简历优化 SSE 失败:', e);
    if (!res.headersSent) {
      res.status(500).json({ error: '简历优化失败: ' + e.message });
    } else {
      res.write('data: ' + JSON.stringify({ type: 'error', message: e.message }) + '\n\n');
      res.end();
    }
  }
});


// ============================================================
// API 7: 单题评估（不依赖面试会话）
// ============================================================
app.post('/api/evaluate-single', creditCheck('evaluate-single', 'evaluation'), async (req, res) => {
  try {
    const { question, answer, jdSummary, resumeText } = req.body;
    if (!question || !answer) {
      return res.status(400).json({ error: '请提供题目和回答' });
    }

    const { evaluateAnswer } = require('./chatflow/engine');
    const result = await evaluateAnswer(question, answer, jdSummary || '', resumeText || '');
    res.json(result);
  } catch (e) {
    console.error('[API] 单题评估失败:', e);
    res.status(500).json({ error: '评估失败: ' + e.message });
  }
});

// ============================================================
// ============================================================
// API 7b: AI追问
// ============================================================
app.post('/api/follow-up', creditCheck('follow-up', null), async (req, res) => {
  try {
    const { question, answer, jdSummary, resumeText } = req.body;
    if (!question || !answer) {
      return res.status(400).json({ error: '请提供题目和回答' });
    }
    const { llm, fillTemplate } = require('./chatflow/llm-client');
    const prompts = require('./chatflow/prompts');
    const followUpPrompt = fillTemplate(prompts.FOLLOW_UP_SYSTEM, {
      original_question: question,
      candidate_answer: answer
    });
    const result = await llm(followUpPrompt, '', { temperature: 0.5 });
    res.json(result);
  } catch (e) {
    console.error('[API] 追问生成失败:', e);
    res.status(500).json({ error: '追问失败: ' + e.message });
  }
});

// ============================================================
// API 7c: AI 生成基于简历的标准答案
// ============================================================
app.post('/api/generate-model-answer', creditCheck('generate-model-answer', null), async (req, res) => {
  try {
    const { question, jdSummary, resumeText, fullExperiences } = req.body;
    if (!question) return res.status(400).json({ error: '请提供题目' });

    const { llm, fillTemplate } = require('./chatflow/llm-client');
    const prompts = require('./chatflow/prompts');

    const userPrompt = `面试题目：${question}
${jdSummary ? '岗位背景：' + jdSummary : ''}
${resumeText ? '候选人简历：\n' + resumeText : '（未提供简历）'}
${fullExperiences?.length ? '候选人完整经历补充（简历之外的详细经历）：\n' + fullExperiences.map((e, i) => `【经历${i+1}】${e.name || ''}\n${e.detail || ''}`).join('\n\n') : ''}

请基于以上信息生成标准答案。`;

    const result = await llm(prompts.MODEL_ANSWER_SYSTEM, userPrompt, { temperature: 0.7 });
    res.json(result);
  } catch (e) {
    console.error('[API] 标准答案生成失败:', e);
    res.status(500).json({ error: '生成失败: ' + e.message });
  }
});

// ============================================================
// API: 面试备考方案生成
// ============================================================
app.post('/api/study-plan/generate', creditCheck('study-plan', null), async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: '请提供会话ID' });

    const session = sessions.get(sessionId);
    if (!session || !session.analysis) return res.status(400).json({ error: '未找到分析结果，请先在分析&押题中完成JD分析' });

    const { llm, fillTemplate } = require('./chatflow/llm-client');
    const prompts = require('./chatflow/prompts');

    const jdParsed = JSON.stringify(session.analysis.jd || {}, null, 2);
    const resumeParsed = JSON.stringify(session.analysis.resume || {}, null, 2);
    const gapAnalysis = JSON.stringify(session.analysis.gap || {}, null, 2);

    const planPrompt = fillTemplate(prompts.STUDY_PLAN_SYSTEM, {
      jd_parsed: jdParsed.slice(0, 3000),
      resume_parsed: resumeParsed.slice(0, 3000),
      gap_analysis: gapAnalysis.slice(0, 2000)
    });

    const result = await llm(planPrompt, '', { temperature: 0.7 });
    res.json(result);
  } catch (e) {
    console.error('[API] 备考方案生成失败:', e);
    res.status(500).json({ error: '生成失败: ' + e.message });
  }
});

// API 8: AI Provider 管理 — 供应商/连接/测试/模型
// ============================================================

// ============================================================
// API 7d: AI 生成基于简历的自我介绍
// ============================================================
app.post('/api/generate-self-intro', creditCheck('generate-self-intro', null), async (req, res) => {
  try {
    const { jdSummary, resumeText, customPrompt, style, duration } = req.body;
    if (!resumeText) return res.status(400).json({ error: '请先提供简历内容' });

    const { llm } = require('./chatflow/llm-client');
    const prompts = require('./chatflow/prompts');

    const userPrompt = `岗位背景：${jdSummary || '（未提供）'}
候选人简历：
${resumeText.slice(0, 4000)}
${customPrompt ? `
用户额外要求：${customPrompt}` : ''}

风格要求：${style || '稳重专业型'}
时长要求：${duration || '1.5分钟'}

请基于以上信息，按照指定的风格和时长要求生成面试自我介绍。`;

    const result = await llm(prompts.SELF_INTRO_SYSTEM, userPrompt, { temperature: 0.8 });
    res.json(result);
  } catch (e) {
    console.error('[API] 自我介绍生成失败:', e);
    res.status(500).json({ error: '生成失败: ' + e.message });
  }
});

// 通用题库：获取题目列表
app.get('/api/behavioral-questions', (req, res) => {
  try {
    const qs = require('./knowledge/behavioral-questions.json');
    res.json(qs);
  } catch (e) {
    res.status(500).json({ error: '加载题库失败' });
  }
});

// 通用题库：生成标准化回答
app.post('/api/generate-behavioral-answer', async (req, res) => {
  try {
    const { question, framework, danger_zones, jdSummary, resumeText, fullExperiences } = req.body;
    if (!question || !resumeText) return res.status(400).json({ error: '缺少题目或简历内容' });

    const { llm } = require('./chatflow/llm-client');
    const prompts = require('./chatflow/prompts');

    const userPrompt = `题目：${question}
${framework ? `回答框架：${framework}` : ''}
${danger_zones ? `⚠️ 危险区（绝对不能犯的错误）：${danger_zones}` : ''}

岗位背景：${jdSummary || '（未提供）'}
候选人简历：
${resumeText.slice(0, 4000)}
${fullExperiences?.length ? '候选人完整经历补充（简历之外的详细经历）：\n' + fullExperiences.map((e, i) => `【经历${i+1}】${e.name || ''}\n${e.detail || ''}`).join('\n\n') : ''}

请基于以上信息生成这道题的标准化回答。`;

    const result = await llm(prompts.BEHAVIORAL_ANSWER_SYSTEM, userPrompt, { temperature: 0.8 });
    res.json(result);
  } catch (e) {
    console.error('[API] 通用题库回答生成失败:', e);
    res.status(500).json({ error: '生成失败: ' + e.message });
  }
});

// 反问生成：为候选人生成反问面试官的问题
app.post('/api/generate-counter-questions', async (req, res) => {
  try {
    const { question, answer, jdSummary, resumeText, fullExperiences } = req.body;
    if (!question) return res.status(400).json({ error: '缺少题目信息' });

    const { llm } = require('./chatflow/llm-client');
    const prompts = require('./chatflow/prompts');

    const userPrompt = `面试中讨论的题目：${question}
${answer ? `候选人的回答要点：${answer.slice(0, 800)}` : ''}

岗位背景：${jdSummary || '（未提供）'}
候选人简历概要：
${resumeText ? resumeText.slice(0, 2000) : '（未提供）'}
${fullExperiences?.length ? '候选人完整经历补充（简历之外的详细经历）：\n' + fullExperiences.map((e, i) => `【经历${i+1}】${e.name || ''}\n${e.detail || ''}`).join('\n\n') : ''}

请基于以上信息，生成3-5个候选人可以在面试结束时反问面试官的高质量问题。`;

    const result = await llm(prompts.COUNTER_QUESTION_SYSTEM, userPrompt, { temperature: 0.9 });
    res.json(result);
  } catch (e) {
    console.error('[API] 反问生成失败:', e);
    res.status(500).json({ error: '生成失败: ' + e.message });
  }
});

// 列出所有供应商预设（OpenAI / DeepSeek / Qwen / Doubao / Ollama / Custom）
app.get('/api/providers/list', async (req, res) => {
  try {
    const result = await listProviders();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 列出所有已保存的连接
app.get('/api/providers/connections', async (req, res) => {
  try {
    const result = await listConnections();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 保存/更新连接
app.post('/api/providers/connections', async (req, res) => {
  try {
    const result = await saveConnection(req.body);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 切换激活的连接
app.post('/api/providers/connections/active', async (req, res) => {
  try {
    const result = await setActiveConnection(req.body.id);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 删除连接
app.delete('/api/providers/connections/:id', async (req, res) => {
  try {
    const result = await deleteConnection(req.params.id);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 测试连接（传入原始字段 → 构造成 connection 对象）
app.post('/api/providers/test', async (req, res) => {
  try {
    const { apiBaseUrl, apiKey, model, protocol, providerId } = req.body;
    const result = await testConnection({
      connection: {
        apiBaseUrl: apiBaseUrl || '',
        apiKey: apiKey || '',
        model: model || '',
        protocol: protocol || 'openai-compatible',
        providerId: providerId || 'custom'
      }
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 拉取模型列表（支持通过连接ID或直接传 connection）
app.post('/api/providers/models', async (req, res) => {
  try {
    const { connectionId, apiBaseUrl, apiKey, model, protocol, providerId } = req.body;
    if (connectionId) {
      // 通过已保存的连接ID拉取
      const conns = await listConnections();
      const conn = conns.connections?.find(c => c.id === connectionId);
      if (!conn) return res.status(404).json({ error: '连接未找到' });
      const result = await fetchModels({ modelAlias: conn.name || conn.providerId });
      res.json(result);
    } else {
      // 用临时连接对象拉取
      const result = await fetchModels({
        connection: {
          apiBaseUrl: apiBaseUrl || '', apiKey: apiKey || '',
          model: model || '', protocol: protocol || 'openai-compatible',
          providerId: providerId || 'custom'
        }
      });
      res.json(result);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 更新连接 temperature
app.post('/api/providers/temperature', async (req, res) => {
  try {
    const { connectionId, temperature } = req.body;
    if (!connectionId || temperature == null) return res.status(400).json({ error: '需要 connectionId 和 temperature' });
    const t = Math.max(0, Math.min(2, Number(temperature)));
    setConnectionTemperature(connectionId, t);
    res.json({ ok: true, temperature: t });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 读取所有连接的 temperature
app.get('/api/providers/temperatures', async (req, res) => {
  try {
    const conns = await listConnections();
    const temps = {};
    (conns.connections || []).forEach(c => {
      temps[c.id] = getConnectionTemperature(c.id);
    });
    res.json({ temperatures: temps });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Token 用量
app.get('/api/usage', (req, res) => {
  res.json({ ...getTokenUsage() });
});

// ============================================================
// API 9: 话术库 — 保存/获取/删除优质回答
// ============================================================

// 保存话术
app.post('/api/phrases', (req, res) => {
  try {
    const { question, answer, improvedVersion, keyTakeaways, score, scores, tags, type } = req.body;
    if (!question || !answer) return res.status(400).json({ error: '需要 question 和 answer' });
    const phrases = loadPhrases();
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      question, answer, improvedVersion: improvedVersion || '', keyTakeaways: keyTakeaways || '',
      score: score || 0, scores: scores || {}, tags: tags || [], type: type || '',
      createdAt: new Date().toISOString()
    };
    phrases.unshift(entry);
    savePhrases(phrases);
    res.json({ ok: true, entry, total: phrases.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 获取话术列表
app.get('/api/phrases', (req, res) => {
  try {
    const phrases = loadPhrases();
    const tag = req.query.tag;
    const list = tag ? phrases.filter(p => (p.tags||[]).includes(tag)) : phrases;
    res.json({ phrases: list, total: list.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 删除话术
app.delete('/api/phrases/:id', (req, res) => {
  try {
    let phrases = loadPhrases();
    phrases = phrases.filter(p => p.id !== req.params.id);
    savePhrases(phrases);
    res.json({ ok: true, total: phrases.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// API 10: 专项训练记录 — 持久化存储
// ============================================================
const DRILL_RECORDS_PATH = path.join(DATA_DIR, '.data', 'drill-records.json');

function loadDrillRecords() {
  try {
    if (fs.existsSync(DRILL_RECORDS_PATH)) {
      const data = JSON.parse(fs.readFileSync(DRILL_RECORDS_PATH, 'utf8'));
      return Array.isArray(data) ? data : [];
    }
  } catch (e) { logWarn('加载专项训练记录失败: ' + e.message); }
  return [];
}

function saveDrillRecords(records) {
  try {
    const dir = path.dirname(DRILL_RECORDS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DRILL_RECORDS_PATH, JSON.stringify(records, null, 2), 'utf8');
  } catch (e) { logError('保存专项训练记录失败: ' + e.message); }
}

// 保存专项训练记录
app.post('/api/drill/records', creditCheck('drill-evaluate', 'evaluation'), (req, res) => {
  try {
    const { question, questionType, answer, scores, overallScore, improvedVersion, keyTakeaways, lineByLine } = req.body;
    if (!question || !answer) return res.status(400).json({ error: '需要 question 和 answer' });

    const records = loadDrillRecords();
    const existingCount = records.filter(r => r.question === question).length;
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      question,
      questionType: questionType || '',
      answer,
      scores: scores || {},
      overallScore: overallScore || 0,
      improvedVersion: improvedVersion || '',
      keyTakeaways: keyTakeaways || [],
      lineByLine: lineByLine || [],
      attemptNumber: existingCount + 1,
      createdAt: new Date().toISOString()
    };
    records.unshift(entry);
    saveDrillRecords(records);
    res.json({ ok: true, entry, attemptNumber: entry.attemptNumber, totalAttempts: existingCount + 1 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 获取某道题的专项训练历史
app.get('/api/drill/records', (req, res) => {
  try {
    const records = loadDrillRecords();
    const question = req.query.question;
    if (question) {
      const filtered = records
        .filter(r => r.question === question || r.question.includes(question) || (question && question.includes(r.question)))
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return res.json({ records: filtered, total: filtered.length });
    }
    res.json({ records: records.slice(0, 100), total: records.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 获取专项训练统计
app.get('/api/drill/stats', (req, res) => {
  try {
    const records = loadDrillRecords();
    const totalDrills = records.length;

    const typeStats = {};
    records.forEach(r => {
      const t = r.questionType || '其他';
      if (!typeStats[t]) typeStats[t] = { count: 0, totalScore: 0, avgScore: 0 };
      typeStats[t].count++;
      typeStats[t].totalScore += r.overallScore || 0;
    });
    Object.keys(typeStats).forEach(t => {
      if (typeStats[t].count > 0) {
        typeStats[t].avgScore = Math.round(typeStats[t].totalScore / typeStats[t].count);
      }
    });

    const questionCount = {};
    records.forEach(r => {
      const key = r.question;
      if (!questionCount[key]) questionCount[key] = { question: r.question, questionType: r.questionType, count: 0, scores: [] };
      questionCount[key].count++;
      if (r.overallScore) questionCount[key].scores.push(r.overallScore);
    });
    const topQuestions = Object.values(questionCount)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map(q => ({
        question: q.question.slice(0, 80),
        questionType: q.questionType,
        attemptCount: q.count,
        latestScore: q.scores[q.scores.length - 1] || 0,
        firstScore: q.scores[0] || 0,
        trend: q.scores.length >= 2 ? q.scores[q.scores.length - 1] - q.scores[0] : 0
      }));

    const recentDrills = records.slice(0, 10).map(r => ({
      date: r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : '',
      question: (r.question || '').slice(0, 60),
      overallScore: r.overallScore || 0,
      questionType: r.questionType || '',
      attemptNumber: r.attemptNumber || 1
    }));

    res.json({ totalDrills, typeStats, topQuestions, recentDrills });
  } catch (e) {
    console.error('Drill stats error:', e);
    res.status(500).json({ error: 'Failed to load drill stats' });
  }
});

// ============================================================
// API 11: 会话管理 — 列表 + 切换
// ============================================================


app.get('/api/sessions', (req, res) => {
  const list = [];
  for (const [id, s] of sessions) {
    const a = s.analysis;
    list.push({
      id,
      label: s.label || (a?.jd?.position || a?.jd?.company || '未命名'),
      company: a?.jd?.company || '',
      position: a?.jd?.position || '',
      matchScore: a?.gap?.match_score || '-',
      questionCount: (a?.questions || []).length,
      isActive: id === activeSessionId,
      createdAt: s.createdAt
    });
  }
  list.sort((a, b) => b.createdAt - a.createdAt);
  res.json({ sessions: list, activeSessionId });
});

// ---- Dashboard stats endpoint ----

// 专项训练弱点分析
app.get('/api/drill/weakness', (req, res) => {
  try {
    const records = loadDrillRecords();
    const dimKeys = ['star_completeness', 'quantification', 'position_match', 'structure', 'highlight'];
    const dimLabels = { star_completeness: 'STAR完整性', quantification: '量化程度', position_match: '岗位匹配', structure: '表达结构', highlight: '亮点突出' };
    const dimTotals = {};
    const dimCounts = {};
    dimKeys.forEach(k => { dimTotals[k] = 0; dimCounts[k] = 0; });

    records.forEach(r => {
      const sc = r.scores || {};
      dimKeys.forEach(k => {
        if (typeof sc[k] === 'number' && sc[k] > 0) {
          dimTotals[k] += sc[k];
          dimCounts[k]++;
        }
      });
    });

    const weaknesses = dimKeys
      .map(k => ({
        key: k,
        label: dimLabels[k],
        avgScore: dimCounts[k] > 0 ? Math.round(dimTotals[k] / dimCounts[k]) : 0,
        count: dimCounts[k]
      }))
      .filter(w => w.avgScore > 0)
      .sort((a, b) => a.avgScore - b.avgScore);

    const weakQuestions = [];
    if (weaknesses.length > 0) {
      const questionMap = {};
      records.forEach(r => {
        const key = r.question;
        if (!questionMap[key]) {
          questionMap[key] = { question: key, questionType: r.questionType || '', attemptCount: 0, avgScore: 0, totalScore: 0 };
        }
        questionMap[key].attemptCount++;
        questionMap[key].totalScore += (r.overallScore || 0);
      });
      Object.values(questionMap).forEach(q => {
        if (q.attemptCount > 0) q.avgScore = Math.round(q.totalScore / q.attemptCount);
      });
      const sorted = Object.values(questionMap).sort((a, b) => a.avgScore - b.avgScore);
      weakQuestions.push(...sorted.slice(0, 5));
    }

    res.json({ weaknesses: weaknesses.slice(0, 3), weakQuestions });
  } catch (e) {
    console.error('Weakness analysis error:', e);
    res.status(500).json({ error: 'Failed to analyze weaknesses' });
  }
});

// ============================================================
// P1: 自定义题目管理
// ============================================================
const CUSTOM_QUESTIONS_PATH = path.join(DATA_DIR, '.data', 'custom-questions.json');

function loadCustomQuestions() {
  try {
    if (fs.existsSync(CUSTOM_QUESTIONS_PATH)) {
      return JSON.parse(fs.readFileSync(CUSTOM_QUESTIONS_PATH, 'utf-8'));
    }
  } catch (e) { console.error('Load custom questions error:', e); }
  return [];
}

function saveCustomQuestions(data) {
  try {
    const dir = path.dirname(CUSTOM_QUESTIONS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CUSTOM_QUESTIONS_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) { console.error('Save custom questions error:', e); }
}

app.get('/api/custom-questions', (req, res) => {
  try {
    res.json({ questions: loadCustomQuestions() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/custom-questions', (req, res) => {
  try {
    const { question, type, category, examinerIntent, difficulty } = req.body;
    if (!question || !question.trim()) {
      return res.status(400).json({ error: '请输入题目内容' });
    }
    const questions = loadCustomQuestions();
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      question: question.trim(),
      type: type || '自定义',
      category: category || '',
      examiner_intent: examinerIntent || '',
      difficulty: difficulty || '中等',
      _source: '自定义',
      createdAt: new Date().toISOString()
    };
    questions.unshift(entry);
    saveCustomQuestions(questions);
    res.json({ ok: true, entry, total: questions.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/custom-questions/:id', (req, res) => {
  try {
    const questions = loadCustomQuestions();
    const before = questions.length;
    const filtered = questions.filter(q => q.id !== req.params.id);
    if (filtered.length === before) {
      return res.status(404).json({ error: '未找到该题目' });
    }
    saveCustomQuestions(filtered);
    res.json({ ok: true, deleted: before - filtered.length, total: filtered.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ============================================================
// 面试准备度评分
// ============================================================
app.get('/api/dashboard/readiness-score', (req, res) => {
  try {
    const records = loadDrillRecords();
    const sessions = []; // mock sessions not yet stored separately
    const today = new Date();
    const days30 = new Date(today - 30*86400000);

    // 计算维度
    const recentRecords = records.filter(r => r.createdAt && new Date(r.createdAt) >= days30);
    const uniqueDays = new Set(recentRecords.map(r => r.createdAt?.slice(0,10))).size;
    const uniqueQuestions = new Set(recentRecords.map(r => r.question)).size;
    const avgScore = recentRecords.length ? recentRecords.reduce((s,r) => s + (r.score||0), 0) / recentRecords.length : 0;
    const questionTypes = new Set(recentRecords.map(r => r.questionType)).size;
    const mockCount = sessions.length;
    const rawScores = recentRecords.map(r => r.score||0).filter(s => s > 0);

    // 分维度计算
    const dimensions = {
      practice_volume: Math.min(100, recentRecords.length * 5),  // 每题5分，上限100
      score_quality: recentRecords.length ? Math.min(100, avgScore * 100 / 90) : 0, // 目标是90分
      consistency: Math.min(100, uniqueDays * 100 / 14),  // 14天=满分
      breadth: Math.min(100, questionTypes * 25),  // 4种题型=满分
      mock_experience: Math.min(100, mockCount * 25),  // 4次模拟=满分
      improvement: rawScores.length >= 3 ? (() => {
        const recent = rawScores.slice(-3).reduce((a,b) => a+b, 0) / 3;
        const older = rawScores.slice(0, -3).length ? rawScores.slice(0, -3).reduce((a,b) => a+b, 0) / rawScores.slice(0, -3).length : recent;
        return Math.min(100, Math.max(0, 50 + (recent - older) * 10));
      })() : 50
    };

    const overall = Math.round(
      dimensions.practice_volume * 0.2 +
      dimensions.score_quality * 0.3 +
      dimensions.consistency * 0.1 +
      dimensions.breadth * 0.15 +
      dimensions.mock_experience * 0.15 +
      dimensions.improvement * 0.1
    );

    const level = overall >= 85 ? 'ready' : overall >= 60 ? 'approaching' : 'needs_work';
    const suggestions = [];
    if (dimensions.practice_volume < 50) suggestions.push('建议增加练习量，每天至少练3-5题');
    if (dimensions.score_quality < 60) suggestions.push('当前平均得分偏低，建议先看标准答案学习思路');
    if (dimensions.consistency < 40) suggestions.push('练习不够连续，建议每天固定时间练习');
    if (dimensions.breadth < 50) suggestions.push('题型覆盖不足，建议尝试不同题型');
    if (dimensions.mock_experience < 50) suggestions.push('建议至少完成一次全真模拟面试');
    if (suggestions.length === 0) suggestions.push('🎉 准备度良好，继续保持！');

    res.json({
      overall, level, dimensions, suggestions,
      stats: { total_practice: recentRecords.length, unique_days: uniqueDays, avg_score: Math.round(avgScore), mock_count: mockCount }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ============================================================
// 错题集 API
// ============================================================
app.get('/api/drill/wrong-answers', (req, res) => {
  try {
    const records = loadDrillRecords();
    const minScore = parseInt(req.query.min_score) || 60;
    const type = req.query.type || '';

    // 按题目聚合，取最低分
    const questionMap = {};
    records.forEach(r => {
      const key = r.question;
      if (!questionMap[key]) {
        questionMap[key] = { question: key, questionType: r.questionType || '', attempts: [], bestScore: r.score || 0, worstScore: r.score || 0, latestAnswer: r.answer || '', latestFeedback: r.feedback || '' };
      }
      const entry = questionMap[key];
      entry.attempts.push({ score: r.score || 0, answer: r.answer || '', createdAt: r.createdAt });
      entry.bestScore = Math.max(entry.bestScore, r.score || 0);
      entry.worstScore = Math.min(entry.worstScore, r.score || 0);
      if (r.answer) entry.latestAnswer = r.answer;
      if (r.feedback) entry.latestFeedback = r.feedback;
    });

    let wrong = Object.values(questionMap).filter(q => q.bestScore < minScore);
    if (type) wrong = wrong.filter(q => q.questionType === type);

    wrong.sort((a, b) => a.bestScore - b.bestScore);

    const stats = {
      total_practice: records.length,
      wrong_count: wrong.length,
      improvement_rate: records.length > 5 ? Math.round(wrong.filter(q => q.attempts.length >= 2 && q.attempts.slice(-1)[0].score > q.attempts[0].score).length / wrong.length * 100) : 0
    };

    res.json({ wrong, stats, all_types: [...new Set(records.map(r => r.questionType))].filter(Boolean) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// P2: 快速复习卡片
// ============================================================
app.get('/api/review/cards', (req, res) => {
  try {
    const records = loadDrillRecords();
    const cards = [];
    const questionMap = {};
    records.forEach(r => {
      const key = r.question;
      if (!questionMap[key]) {
        questionMap[key] = {
          question: key,
          questionType: r.questionType || '',
          answers: [],
          bestScore: 0,
          totalScore: 0,
          count: 0
        };
      }
      questionMap[key].answers.push({
        answer: r.answer || '',
        score: r.overallScore || 0,
        scores: r.scores || {},
        improvedVersion: r.improvedVersion || '',
        keyTakeaways: r.keyTakeaways || [],
        date: r.createdAt
      });
      questionMap[key].totalScore += (r.overallScore || 0);
      questionMap[key].count++;
      questionMap[key].bestScore = Math.max(questionMap[key].bestScore, r.overallScore || 0);
    });

    Object.values(questionMap).forEach(q => {
      if (q.count > 0) q.avgScore = Math.round(q.totalScore / q.count);
      const latest = q.answers[q.answers.length - 1];
      cards.push({
        question: q.question,
        questionType: q.questionType,
        avgScore: q.avgScore || 0,
        bestScore: q.bestScore,
        attemptCount: q.count,
        latestAnswer: latest ? latest.answer : '',
        latestImproved: latest ? latest.improvedVersion : '',
        latestTakeaways: latest ? latest.keyTakeaways : [],
        latestScores: latest ? latest.scores : {},
        latestDate: latest ? latest.date : ''
      });
    });

    cards.sort((a, b) => (a.avgScore || 0) - (b.avgScore || 0));
    res.json({ cards: cards.slice(0, 20) });
  } catch (e) {
    console.error('Review cards error:', e);
    res.status(500).json({ error: 'Failed to load review cards' });
  }
});

// ============================================================
// P2: 面试学习计划
// ============================================================
const STUDY_PLAN_PATH = path.join(DATA_DIR, '.data', 'study-plan.json');

function loadStudyPlan() {
  try {
    if (fs.existsSync(STUDY_PLAN_PATH)) {
      return JSON.parse(fs.readFileSync(STUDY_PLAN_PATH, 'utf-8'));
    }
  } catch (e) { console.error('Load study plan error:', e); }
  return { targetDate: null, dailyGoal: 5, checkins: {}, createdAt: null };
}

function saveStudyPlan(data) {
  try {
    const dir = path.dirname(STUDY_PLAN_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STUDY_PLAN_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) { console.error('Save study plan error:', e); }
}

app.get('/api/study-plan', (req, res) => {
  try {
    const plan = loadStudyPlan();
    const drillRecords = loadDrillRecords();
    const today = new Date().toISOString().slice(0, 10);
    const todayCount = drillRecords.filter(r => (r.createdAt || '').startsWith(today)).length;

    let daysRemaining = 0;
    let totalDays = 0;
    if (plan.targetDate) {
      const target = new Date(plan.targetDate);
      const now = new Date();
      daysRemaining = Math.max(0, Math.ceil((target - now) / (1000 * 60 * 60 * 24)));
      totalDays = Math.max(1, Math.ceil((target - new Date(plan.createdAt || plan.targetDate)) / (1000 * 60 * 60 * 24)));
    }

    let streak = 0;
    const check = new Date();
    for (let i = 0; i < 365; i++) {
      const d = new Date(check);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const dayRecords = drillRecords.filter(r => (r.createdAt || '').startsWith(key));
      if (dayRecords.length > 0) { streak++; } else { break; }
    }

    res.json({
      plan,
      todayCount,
      todayGoal: plan.dailyGoal || 5,
      daysRemaining,
      totalDays,
      streak,
      progress: totalDays > 0 ? Math.round(((totalDays - daysRemaining) / totalDays) * 100) : 0
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/study-plan', (req, res) => {
  try {
    const { targetDate, dailyGoal } = req.body;
    const plan = loadStudyPlan();
    if (targetDate) plan.targetDate = targetDate;
    if (dailyGoal !== undefined) plan.dailyGoal = Math.max(1, Math.min(50, parseInt(dailyGoal) || 5));
    if (!plan.createdAt) plan.createdAt = new Date().toISOString();
    saveStudyPlan(plan);
    res.json({ ok: true, plan });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// 面试复盘模块
// ============================================================
const REVIEWS_PATH = path.join(DATA_DIR, '.data', 'interview-reviews.json');

function loadReviews() {
  try {
    if (fs.existsSync(REVIEWS_PATH)) {
      return JSON.parse(fs.readFileSync(REVIEWS_PATH, 'utf-8'));
    }
  } catch (e) { console.error('Load reviews error:', e); }
  return [];
}

function saveReviews(data) {
  try {
    const dir = path.dirname(REVIEWS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(REVIEWS_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) { console.error('Save reviews error:', e); }
}

// 上传面试记录文件
app.post('/api/interview-review/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '请上传文件' });
    const { parseResumeFile } = require('./chatflow/resume-parser');
    try {
      const result = await parseResumeFile(req.file.path, req.file.originalname);
      res.json({ text: result.text || result.rawText || '', fileName: req.file.originalname });
    } finally {
      try { fs.unlinkSync(req.file.path); } catch {}
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 生成面试复盘
app.post('/api/interview-review/generate', creditCheck('interview-review', null), async (req, res) => {
  try {
    const { interviewText } = req.body;
    if (!interviewText || !interviewText.trim()) {
      return res.status(400).json({ error: '请提供面试记录文本' });
    }

    const { llm, fillTemplate } = require('./chatflow/llm-client');
    const prompts = require('./chatflow/prompts');

    const reviewPrompt = fillTemplate(prompts.INTERVIEW_REVIEW_SYSTEM, {
      interview_text: interviewText.slice(0, 8000)
    });

    const result = await llm(reviewPrompt, '', { temperature: 0.7 });
    res.json(result);
  } catch (e) {
    console.error('[API] 面试复盘生成失败:', e);
    res.status(500).json({ error: '生成失败: ' + e.message });
  }
});

// 保存复盘记录
app.post('/api/interview-review/save', async (req, res) => {
  try {
    const { review, sourceText, fileName } = req.body;
    if (!review) return res.status(400).json({ error: '请提供复盘数据' });

    const reviews = loadReviews();
    const record = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      createdAt: new Date().toISOString(),
      review,
      sourceText: (sourceText || '').slice(0, 500),
      fileName: fileName || ''
    };
    reviews.unshift(record);
    saveReviews(reviews);
    res.json({ ok: true, id: record.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取历史复盘列表
app.get('/api/interview-review/history', (req, res) => {
  try {
    const reviews = loadReviews();
    const list = reviews.map(r => ({
      id: r.id,
      createdAt: r.createdAt,
      fileName: r.fileName,
      sourceText: r.sourceText,
      company: r.review?.interview_info?.company || '',
      position: r.review?.interview_info?.position || '',
      round: r.review?.interview_info?.round || '',
      overallScore: r.review?.overall_score || 0
    }));
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取单个复盘详情
app.get('/api/interview-review/detail/:id', (req, res) => {
  try {
    const reviews = loadReviews();
    const found = reviews.find(r => r.id === req.params.id);
    if (!found) return res.status(404).json({ error: '未找到复盘记录' });
    res.json(found);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 删除复盘记录
app.delete('/api/interview-review/:id', (req, res) => {
  try {
    const reviews = loadReviews();
    const filtered = reviews.filter(r => r.id !== req.params.id);
    if (filtered.length === reviews.length) {
      return res.status(404).json({ error: '未找到复盘记录' });
    }
    saveReviews(filtered);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/dashboard/stats', (req, res) => {
  try {
    // Read phrase library
    const phrasesPath = path.join(DATA_DIR, '.data', 'phrase-library.json');
    let phrases = [];
    try { phrases = JSON.parse(fs.readFileSync(phrasesPath, 'utf8')); } catch {}
    if (!Array.isArray(phrases)) phrases = [];

    // Use in-memory sessions Map (consistent with other API handlers)
    // --- Practice stats from phrase library + drill records ---
    const drillRecordsForStats = loadDrillRecords();
    const totalPractices = phrases.length + drillRecordsForStats.length;

    // Average score (包含话术库和专项训练)
    const phraseScores = phrases.map(p => p.score || 0).filter(s => s > 0);
    const drillScores = drillRecordsForStats.map(r => r.overallScore || 0).filter(s => s > 0);
    const allScores = [...phraseScores, ...drillScores];
    const avgScore = allScores.length > 0 ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length) : 0;

    // Type coverage
    const typeCoverage = { behavioral: 0, technical: 0, project: 0, stress: 0, hr: 0, total: 0 };
    phrases.forEach(p => {
      const t = p.type;
      if (t && typeCoverage.hasOwnProperty(t)) typeCoverage[t]++;
      typeCoverage.total++;
    });
    drillRecordsForStats.forEach(r => {
      const t = r.questionType;
      if (t && typeCoverage.hasOwnProperty(t)) typeCoverage[t]++;
      typeCoverage.total++;
    });

    // Radar scores - average dimension scores from phrases that have evaluations
    const dimKeys = ['star_completeness', 'quantification', 'position_match', 'structure', 'highlight'];
    const radarScores = { star_completeness: 0, quantification: 0, position_match: 0, structure: 0, highlight: 0 };
    const dimCounts = { star_completeness: 0, quantification: 0, position_match: 0, structure: 0, highlight: 0 };
    phrases.forEach(p => {
      // 兼容两种数据来源：旧的 p.evaluation 和新的 p.scores
      const evalData = p.scores || p.evaluation;
      if (evalData && typeof evalData === 'object') {
        dimKeys.forEach(k => {
          if (typeof evalData[k] === 'number' && evalData[k] > 0) {
            radarScores[k] += evalData[k];
            dimCounts[k]++;
          }
        });
      }
    });
    // 也计入专项训练记录的维度评分
    drillRecordsForStats.forEach(r => {
      if (r.scores && typeof r.scores === 'object') {
        dimKeys.forEach(k => {
          if (typeof r.scores[k] === 'number' && r.scores[k] > 0) {
            radarScores[k] += r.scores[k];
            dimCounts[k]++;
          }
        });
      }
    });
    dimKeys.forEach(k => {
      if (dimCounts[k] > 0) radarScores[k] = Math.round(radarScores[k] / dimCounts[k]);
    });

    // Recent practices (last 10) - 合并话术库和专项训练记录
    const drillRecent = drillRecordsForStats.slice(0, 10).map(r => ({
      date: r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : '',
      createdAt: r.createdAt || '',
      question: r.question || '',
      score: r.overallScore || 0,
      type: r.questionType || '专项训练',
      answer: r.answer || '',
      improvedVersion: r.improvedVersion || '',
      keyTakeaways: r.keyTakeaways || [],
      scores: r.scores || {},
      source: 'drill'
    }));
    const phraseRecent = phrases.map(p => ({
      date: p.createdAt ? new Date(p.createdAt).toISOString().slice(0, 10) : '',
      createdAt: p.createdAt || '',
      question: p.question || '',
      score: p.score || 0,
      type: p.type || '',
      answer: p.answer || '',
      improvedVersion: p.improvedVersion || '',
      keyTakeaways: p.keyTakeaways || '',
      scores: (p.scores || p.evaluation) || {},
      source: 'practice'
    }));
    // 合并并按时间排序
    const allRecent = [...phraseRecent, ...drillRecent]
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .slice(0, 10);
    const recentPractices = allRecent;

    // Calendar: date -> count for last 60 days
    const calendar = {};
    const now = new Date();
    const sixtyDaysAgo = new Date(now);
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    phrases.forEach(p => {
      if (p.createdAt) {
        const d = new Date(p.createdAt);
        if (d >= sixtyDaysAgo && d <= now) {
          const key = d.toISOString().slice(0, 10);
          calendar[key] = (calendar[key] || 0) + 1;
        }
      }
    });
    // 也计入专项训练记录
    drillRecordsForStats.forEach(r => {
      if (r.createdAt) {
        const d = new Date(r.createdAt);
        if (d >= sixtyDaysAgo && d <= now) {
          const key = d.toISOString().slice(0, 10);
          calendar[key] = (calendar[key] || 0) + 1;
        }
      }
    });

    // --- Interview reports from sessions ---
    const interviewReports = [];
    let totalInterviews = 0;
    for (const s of sessions.values()) {
      const interview = s.interview;
      if (interview && interview.stage === 'done') {
        totalInterviews++;
        let reportScore = '-';
        if (interview.askedQuestions && interview.askedQuestions.length > 0) {
          const qScores = interview.askedQuestions
            .map(q => q.score || q.evaluation?.score)
            .filter(v => typeof v === 'number');
          if (qScores.length > 0) {
            reportScore = Math.round(qScores.reduce((a, b) => a + b, 0) / qScores.length);
          }
        }
        interviewReports.push({
          label: s.label || s.analysis?.jd?.position || s.analysis?.jd?.company || '面试',
          company: s.analysis?.jd?.company || '',
          position: s.analysis?.jd?.position || '',
          date: s.createdAt ? new Date(s.createdAt).toISOString() : '',
          score: reportScore
        });
      }
    }
    interviewReports.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({
      totalPractices,
      totalInterviews,
      avgScore,
      radarScores,
      typeCoverage,
      recentPractices,
      interviewReports: interviewReports.slice(0, 10),
      calendar
    });
  } catch (e) {
    console.error('Dashboard stats error:', e);
    res.status(500).json({ error: 'Failed to load dashboard stats' });
  }
});

// ============================================================
// API: 岗位竞争力雷达 — 基于JD+简历对比的多维度匹配度可视化
// ============================================================
app.get('/api/radar/competitiveness', (req, res) => {
  try {
    const sessionId = req.query.sessionId || activeSessionId;
    const session = sessions.get(sessionId);
    if (!session?.analysis) {
      return res.json({ available: false, error: '请先上传JD和简历完成分析' });
    }

    const gap = session.analysis.gap || {};
    const jd = session.analysis.jd || {};
    const resume = session.analysis.resume || {};

    // 维度定义（5个维度，与GAP_ANALYSIS_SYSTEM一致）
    const dimensions = [
      { key: 'hard_skills', label: '硬技能匹配', max: 30, weight: 30 },
      { key: 'soft_skills', label: '软素质匹配', max: 20, weight: 20 },
      { key: 'core_duties', label: '核心职责匹配', max: 20, weight: 20 },
      { key: 'industry_experience', label: '行业经验匹配', max: 15, weight: 15 },
      { key: 'education', label: '学历背景匹配', max: 15, weight: 15 }
    ];

    // 从 gap.dimension_scores 获取各维度得分（新分析会包含，旧分析需要降级）
    const dimScores = gap.dimension_scores || {};
    const hasDetailScores = Object.keys(dimScores).length > 0;

    // 构建雷达数据
    const radarData = dimensions.map(dim => {
      let score = 0;
      let detail = '';
      let max = dim.max;

      if (hasDetailScores && dimScores[dim.key]) {
        score = dimScores[dim.key].score || 0;
        detail = dimScores[dim.key].detail || '';
        max = dimScores[dim.key].max || dim.max;
      } else {
        // 降级：从match_score按权重比例估算
        const matchScore = gap.match_score || 0;
        score = Math.round((matchScore / 100) * max);
        detail = '基于综合匹配度估算';
      }

      // 计算百分比（用于雷达图统一尺度）
      const pct = max > 0 ? Math.round((score / max) * 100) : 0;

      // 生成改进建议
      let suggestion = '';
      if (pct >= 80) {
        suggestion = '继续保持，这是你的优势项';
      } else if (pct >= 60) {
        suggestion = '有一定基础，建议针对性强化';
      } else if (pct >= 40) {
        suggestion = '存在明显差距，需要重点准备';
      } else {
        suggestion = '薄弱环节，建议优先补齐';
      }

      return {
        key: dim.key,
        label: dim.label,
        score,
        max,
        pct,
        detail,
        suggestion,
        weight: dim.weight
      };
    });

    // 总体匹配度
    const matchScore = gap.match_score || 0;
    let matchLevel = '未分析';
    let matchColor = 'var(--muted)';
    if (matchScore >= 90) { matchLevel = '高度匹配'; matchColor = '#10B981'; }
    else if (matchScore >= 70) { matchLevel = '良好匹配'; matchColor = '#22d3ee'; }
    else if (matchScore >= 50) { matchLevel = '部分匹配'; matchColor = '#F59E0B'; }
    else if (matchScore > 0) { matchLevel = '差距较大'; matchColor = '#EF4444'; }

    // 构建JD要求和简历信息摘要
    const jdSummary = {
      position: jd.position || '',
      company: jd.company || '',
      hard_skills: jd.hard_skills || [],
      soft_skills: jd.soft_skills || [],
      core_duties: jd.core_duties || []
    };

    const resumeSummary = {
      education: resume.education || {},
      skills: resume.skills || [],
      internships: (resume.internships || []).map(i => ({ company: i.company, role: i.role })),
      projects: (resume.projects || []).map(p => ({ name: p.name, role: p.role }))
    };

    res.json({
      available: true,
      matchScore,
      matchLevel,
      matchColor,
      dimensions: radarData,
      jdSummary,
      resumeSummary,
      hasDetailScores,
      advantagePoints: gap.advantage_points || [],
      weakPoints: gap.weak_points || [],
      interviewStrategy: gap.interview_strategy || ''
    });
  } catch (e) {
    console.error('Radar competitiveness error:', e);
    res.status(500).json({ error: '获取竞争力数据失败' });
  }
});

// ============================================================
// API: 能力趋势数据 — 分数随时间变化曲线
// ============================================================
app.get('/api/dashboard/trends', (req, res) => {
  try {
    const phrasesPath = path.join(DATA_DIR, '.data', 'phrase-library.json');
    let phrases = [];
    try { phrases = JSON.parse(fs.readFileSync(phrasesPath, 'utf8')); } catch {}
    if (!Array.isArray(phrases)) phrases = [];
    const drillRecords = loadDrillRecords();

    const dimKeys = ['star_completeness', 'quantification', 'position_match', 'structure', 'highlight'];
    const dimLabels = ['STAR完整度', '量化程度', '岗位匹配', '结构逻辑', '亮点突出'];

    // 按天聚合所有练习记录
    const dailyMap = {}; // YYYY-MM-DD -> { count, scores: {dim: total}, overallTotal }
    function addToDaily(createdAt, scores, overallScore) {
      if (!createdAt) return;
      const day = new Date(createdAt).toISOString().slice(0, 10);
      if (!dailyMap[day]) dailyMap[day] = { count: 0, scores: {}, overallTotal: 0, overallCount: 0 };
      dailyMap[day].count++;
      if (overallScore) {
        dailyMap[day].overallTotal += overallScore;
        dailyMap[day].overallCount++;
      }
      if (scores) {
        dimKeys.forEach(k => {
          if (typeof scores[k] === 'number' && scores[k] > 0) {
            if (dailyMap[day].scores[k] === undefined) dailyMap[day].scores[k] = 0;
            dailyMap[day].scores[k] += scores[k];
          }
        });
      }
    }

    phrases.forEach(p => {
      const evalData = p.scores || p.evaluation;
      addToDaily(p.createdAt, evalData, p.score);
    });
    drillRecords.forEach(r => {
      addToDaily(r.createdAt, r.scores, r.overallScore);
    });

    // 转为排序数组
    const sortedDays = Object.keys(dailyMap).sort();
    const trendData = sortedDays.map(day => {
      const d = dailyMap[day];
      const dimAvgs = {};
      dimKeys.forEach(k => {
        dimAvgs[k] = d.scores[k] !== undefined ? Math.round(d.scores[k] / d.count) : 0;
      });
      return {
        date: day,
        count: d.count,
        overallAvg: d.overallCount > 0 ? Math.round(d.overallTotal / d.overallCount) : 0,
        scores: dimAvgs
      };
    });

    // 计算周聚合趋势（超过14天数据时，按周聚合显示）
    let weeklyTrend = [];
    if (sortedDays.length > 14) {
      const weekMap = {};
      sortedDays.forEach(day => {
        const d = new Date(day);
        // 获取该日所在的周一
        const dayOfWeek = d.getDay();
        const monday = new Date(d);
        monday.setDate(d.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
        const weekKey = monday.toISOString().slice(0, 10);
        if (!weekMap[weekKey]) weekMap[weekKey] = { count: 0, scores: {}, overallTotal: 0, overallCount: 0 };
        weekMap[weekKey].count += dailyMap[day].count;
        weekMap[weekKey].overallTotal += dailyMap[day].overallTotal;
        weekMap[weekKey].overallCount += dailyMap[day].overallCount;
        dimKeys.forEach(k => {
          if (dailyMap[day].scores[k] !== undefined) {
            if (weekMap[weekKey].scores[k] === undefined) weekMap[weekKey].scores[k] = 0;
            weekMap[weekKey].scores[k] += dailyMap[day].scores[k];
          }
        });
      });
      weeklyTrend = Object.keys(weekMap).sort().map(wk => {
        const w = weekMap[wk];
        const dimAvgs = {};
        dimKeys.forEach(k => {
          dimAvgs[k] = w.scores[k] !== undefined ? Math.round(w.scores[k] / w.count) : 0;
        });
        return {
          date: wk,
          count: w.count,
          overallAvg: w.overallCount > 0 ? Math.round(w.overallTotal / w.overallCount) : 0,
          scores: dimAvgs
        };
      });
    }

    // 计算薄弱点变化趋势：最近5次练习的各维度分数
    const allRecords = [
      ...phrases.map(p => ({ createdAt: p.createdAt, scores: p.scores || p.evaluation, overallScore: p.score, source: 'practice' })),
      ...drillRecords.map(r => ({ createdAt: r.createdAt, scores: r.scores, overallScore: r.overallScore, source: 'drill' }))
    ].filter(r => r.createdAt && r.scores)
     .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
     .slice(0, 20);

    const dimKeysReadable = ['star_completeness', 'quantification', 'position_match', 'structure', 'highlight'];

    // 找出薄弱维度（平均分最低的维度）
    const dimAverages = {};
    dimKeysReadable.forEach(k => { dimAverages[k] = { total: 0, count: 0 }; });
    allRecords.forEach(r => {
      if (r.scores) {
        dimKeysReadable.forEach(k => {
          if (typeof r.scores[k] === 'number' && r.scores[k] > 0) {
            dimAverages[k].total += r.scores[k];
            dimAverages[k].count++;
          }
        });
      }
    });
    const weakDimensions = dimKeysReadable
      .map(k => ({ key: k, label: dimLabels[dimKeysReadable.indexOf(k)], avg: dimAverages[k].count > 0 ? Math.round(dimAverages[k].total / dimAverages[k].count) : 0 }))
      .sort((a, b) => a.avg - b.avg);

    // 最近练习的趋势（最近10条）
    const recentTrend = allRecords.slice(0, 10).map(r => ({
      date: new Date(r.createdAt).toISOString().slice(0, 10),
      overallScore: r.overallScore || 0,
      scores: dimKeysReadable.reduce((acc, k) => { acc[k] = (r.scores && r.scores[k]) || 0; return acc; }, {})
    })).reverse();

    res.json({
      dailyTrend: trendData.slice(-30), // 最多返回30天
      weeklyTrend,
      recentTrend,
      weakDimensions,
      totalRecords: allRecords.length
    });
  } catch (e) {
    console.error('Trend data error:', e);
    res.status(500).json({ error: 'Failed to load trend data' });
  }
});

// ============================================================
// API: 练习报告详情
// ============================================================
app.get('/api/practice/report/:id', (req, res) => {
  try {
    const id = req.params.id;
    // 先从话术库查找
    const phrasesPath = path.join(DATA_DIR, '.data', 'phrase-library.json');
    let phrases = [];
    try { phrases = JSON.parse(fs.readFileSync(phrasesPath, 'utf8')); } catch {}
    if (Array.isArray(phrases)) {
      const found = phrases.find(p => p.id === id);
      if (found) return res.json({ source: 'practice', ...found });
    }
    // 再从专项训练记录查找
    const drillRecords = loadDrillRecords();
    const found = drillRecords.find(r => r.id === id);
    if (found) return res.json({ source: 'drill', ...found });
    res.status(404).json({ error: '报告未找到' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// API: 报告列表（合并话术库和专项训练记录）
// ============================================================
app.get('/api/practice/reports', (req, res) => {
  try {
    const phrasesPath = path.join(DATA_DIR, '.data', 'phrase-library.json');
    let phrases = [];
    try { phrases = JSON.parse(fs.readFileSync(phrasesPath, 'utf8')); } catch {}
    if (!Array.isArray(phrases)) phrases = [];

    const drillRecords = loadDrillRecords();

    const reports = [];
    phrases.forEach(p => {
      const evalData = p.scores || p.evaluation;
      reports.push({
        id: p.id,
        type: 'practice',
        question: p.question || '',
        answer: p.answer || '',
        score: p.score || 0,
        scores: evalData || {},
        improvedVersion: p.improvedVersion || '',
        keyTakeaways: p.keyTakeaways || '',
        tags: p.tags || [],
        questionType: p.type || '',
        createdAt: p.createdAt || ''
      });
    });
    drillRecords.forEach(r => {
      reports.push({
        id: r.id,
        type: 'drill',
        question: r.question || '',
        answer: r.answer || '',
        score: r.overallScore || 0,
        scores: r.scores || {},
        improvedVersion: r.improvedVersion || '',
        keyTakeaways: Array.isArray(r.keyTakeaways) ? r.keyTakeaways.join('；') : (r.keyTakeaways || ''),
        tags: [],
        questionType: r.questionType || '',
        attemptNumber: r.attemptNumber || 1,
        createdAt: r.createdAt || ''
      });
    });

    // 按时间排序
    reports.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    res.json({ reports, total: reports.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/sessions/switch', (req, res) => {
  const { sessionId } = req.body;
  if (!sessions.has(sessionId)) return res.status(404).json({ error: '会话不存在' });
  activeSessionId = sessionId;
  const s = sessions.get(sessionId);
  const a = s.analysis;
  res.json({
    ok: true,
    sessionId,
    label: s.label,
    jdText: s.jdText || '',
    resumeText: s.resumeText || '',
    resumeFileName: s.resumeFileName || '',
    resumeSourceType: s.resumeSourceType || '',
    jd: a.jd,
    resume: a.resume,
    gap: a.gap,
    questions: a.questions,
    insights: a.insights,
    mianjing: a.mianjing,
    kb_supplement: a.kb_supplement,
    fullExperiences: s.fullExperiences || []
  });
});

app.delete('/api/sessions/:id', (req, res) => {
  const id = req.params.id;
  if (!sessions.has(id)) return res.status(404).json({ error: '会话不存在' });
  sessions.delete(id);
  if (activeSessionId === id) {
    activeSessionId = [...sessions.keys()][0] || null;
  }
  saveSessions();
  res.json({ ok: true, activeSessionId });
});

// 更新会话标签（岗位名称）
app.patch('/api/sessions/:id', (req, res) => {
  const id = req.params.id;
  if (!sessions.has(id)) return res.status(404).json({ error: '会话不存在' });
  const s = sessions.get(id);
  const { label } = req.body;
  if (label) {
    s.label = label;
    if (s.analysis && s.analysis.jd) {
      s.analysis.jd.position = label;
    }
    saveSessions();
  }
  res.json({ ok: true });
});

// 获取完整经历列表
app.get('/api/sessions/:id/experiences', (req, res) => {
  const id = req.params.id;
  if (!sessions.has(id)) return res.status(404).json({ error: '会话不存在' });
  const s = sessions.get(id);
  res.json({ experiences: s.fullExperiences || [] });
});

// 保存完整经历列表
app.put('/api/sessions/:id/experiences', (req, res) => {
  const id = req.params.id;
  if (!sessions.has(id)) return res.status(404).json({ error: '会话不存在' });
  const s = sessions.get(id);
  s.fullExperiences = req.body.experiences || [];
  saveSessions();
  res.json({ ok: true });
});

// 生成经历回忆访谈问题
app.post('/api/generate-experience-questions', async (req, res) => {
  try {
    const { resumeText } = req.body;
    const { llm } = require('./chatflow/llm-client');
    const prompts = require('./chatflow/prompts');
    const userPrompt = `以下是一份简历的文本内容，请根据简历中提到的经历，生成5-8个问题，帮助候选人回忆和补充其经历的更多细节。

简历内容：
${(resumeText || '').slice(0, 3000)}

每个问题应该针对简历中的一段具体经历（实习、项目、工作等），引导候选人回忆更多细节，如：
- 具体负责什么任务
- 团队规模多大
- 遇到了什么困难
- 取得了什么量化成果
- 使用了什么技术/方法

请生成问题列表，让候选人可以选择性回答。`;
    const result = await llm(prompts.EXPERIENCE_INTERVIEW_SYSTEM, userPrompt, { temperature: 0.8 });
    res.json(result);
  } catch (e) {
    console.error('[API] 经历问题生成失败:', e);
    res.status(500).json({ error: '生成失败: ' + e.message });
  }
});

// ============================================================
// API 11: 面经库
// ============================================================

app.get('/api/mianjing-bank', (req, res) => {
  const bank = loadMianjingBank();
  const company = req.query.company || '';
  const position = req.query.position || '';
  const type = req.query.type || '';

  let filtered = bank;
  if (company) filtered = filtered.filter(b => b.company.includes(company));
  if (position) filtered = filtered.filter(b => b.position.includes(position));
  if (type) filtered = filtered.filter(b => (b.type || '').includes(type));

  const companies = [...new Set(bank.map(b => b.company).filter(Boolean))];
  const positions = [...new Set(bank.map(b => b.position).filter(Boolean))];
  const types = [...new Set(bank.map(b => b.type).filter(Boolean))];
  const sources = ['小红书面经', '用户收藏'];

  res.json({
    total: bank.length,
    filtered: filtered.length,
    companies, positions, types, sources,
    questions: filtered.slice(0, 200)
  });
});



// ============================================================
// Company Research API — 公司调研（SSE流式）
// ============================================================
app.post('/api/company-research', creditCheck('company-research', null), async (req, res) => {
  const { company, position } = req.body;
  if (!company) return res.status(400).json({ error: '请提供公司名' });

  sseInit(res);

  try {
    const { researchCompany } = require('./chatflow/nodes/company-research');

    sseSend(res, { step: 'research', label: '公司调研', detail: `🔍 正在搜索「${company}」相关信息...`, status: 'running' });

    const result = await researchCompany(company, position || '', (msg) => {
      sseSend(res, { step: msg.step, label: msg.label, detail: msg.detail, status: msg.status || 'running' });
    });

    if (result.error) {
      sseError(res, result.error);
      return;
    }

    sseSend(res, { step: 'research', label: '公司调研', detail: '✅ 知识图谱生成完成', status: 'ok' });
    sseDone(res, { step: 'done', ...result });

  } catch (e) {
    sseError(res, '公司调研失败: ' + (e.message || String(e)));
  }
});

// ============================================================
// 公司调研历史记录
// ============================================================
function loadCompanyResearchHistory() {
  try {
    if (fs.existsSync(COMPANY_RESEARCH_HISTORY_FILE)) {
      const data = JSON.parse(fs.readFileSync(COMPANY_RESEARCH_HISTORY_FILE, 'utf8'));
      return Array.isArray(data) ? data : [];
    }
  } catch (e) { logWarn('加载公司调研历史失败: ' + e.message); }
  return [];
}

function saveCompanyResearchHistory(records) {
  try {
    const dir = path.dirname(COMPANY_RESEARCH_HISTORY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(COMPANY_RESEARCH_HISTORY_FILE, JSON.stringify(records, null, 2), 'utf8');
  } catch (e) { logError('保存公司调研历史失败: ' + e.message); }
}

app.get('/api/company-research/history', (req, res) => {
  try {
    const history = loadCompanyResearchHistory();
    res.json({ history: history.slice(0, 50) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/company-research/history', (req, res) => {
  try {
    const { company, position, result } = req.body;
    if (!company || !result) return res.status(400).json({ error: '需要 company 和 result' });

    const history = loadCompanyResearchHistory();
    // 去重：同一公司+岗位的调研，只保留最新的一条
    const filtered = history.filter(h => !(h.company === company && h.position === (position || '')));
    history.length = 0;
    history.push(...filtered);

    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      company,
      position: position || '',
      result: {
        _summary: result._summary || '',
        interview_talking_points: result.interview_talking_points || null,
        mock_qa: result.mock_qa || null,
        company_basics: result.company_basics || null,
        business_insight: result.business_insight || null,
        interview_intel: result.interview_intel || null,
        latest_news: result.latest_news || null,
        competitors: result.competitors || null
      },
      createdAt: new Date().toISOString()
    };
    history.unshift(entry);
    saveCompanyResearchHistory(history);
    res.json({ ok: true, entry });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// API 12: 简历文件上传解析
// ============================================================
app.post('/api/resume-upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '请上传文件' });
    const { parseResumeFile } = require('./chatflow/resume-parser');
    try {
      const result = await parseResumeFile(req.file.path, req.file.originalname);
      res.json(result);
    } finally {
      // 删临时文件
      try { fs.unlinkSync(req.file.path); } catch {}
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// API 13: 导出 DOCX — 话术库 / 面经库
// ============================================================
app.get('/api/export/phrases', async (req, res) => {
  try {
    const { generatePhraseDocx } = require('./chatflow/export-docx');
    const phrases = loadPhrases();
    const buffer = await generatePhraseDocx(phrases);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('话术库_面试准备.docx')}`);
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/export/mianjing', async (req, res) => {
  try {
    const { generateMianjingDocx } = require('./chatflow/export-docx');
    const bank = loadMianjingBank();
    const company = req.query.company || '';
    const position = req.query.position || '';
    let filtered = bank;
    if (company) filtered = filtered.filter(b => b.company.includes(company));
    if (position) filtered = filtered.filter(b => b.position.includes(position));
    const buffer = await generateMianjingDocx(filtered);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('面经库_面试准备.docx')}`);
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// API 14: JD URL 扒取（opencli browser bridge → 可过登录墙）
// ============================================================
app.post('/api/jd-fetch', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: '请提供岗位链接URL' });
  if (!/^https?:\/\//.test(url)) return res.status(400).json({ error: '请输入完整URL' });

  const ocErr = requireOpencli('JD链接扒取');
  if (ocErr) return res.status(503).json({ error: ocErr });

  try {
    let text = '';

    // 策略1: 专属 adapter — Boss直聘有 detail 命令
    const bossMatch = url.match(/boss\.com.*?(?:job_detail|jobDetail).*?[?&]jid=([\w-]+)/i)
                   || url.match(/boss\.com.*?(?:job_detail|jobDetail)\/([\w-]+)/i)
                   || url.match(/boss\.com.*?securityId=([\w-]+)/i);
    if (bossMatch) {
      const securityId = bossMatch[1];
      console.log('[JD扒取] Boss直聘详情:', securityId);
      try {
        const result = await execAsync(
          `opencli boss detail "${securityId}" -f md --stdout true`,
          { timeout: 30000, maxBuffer: 5 * 1024 * 1024 }
        );
        text = result || '';
      } catch (e) {
        console.warn('[JD扒取] Boss直聘失败:', e.message?.slice(0, 80));
      }
    }

    // 策略2: 51job 等 — 通用 web read
    if (!text || text.length < 100) {
      console.log('[JD扒取] 通用web read:', url);
      try {
        const result = await execAsync(
          `opencli web read --url "${url}" -f md --stdout true --wait 2`,
          { timeout: 30000, maxBuffer: 5 * 1024 * 1024 }
        );
        text = result || '';
      } catch (e) {
        console.warn('[JD扒取] opencli web read 失败:', e.message?.slice(0, 80));
      }
    }

    // 清理
    text = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

    if (text.length < 100) {
      return res.status(502).json({ error: '未能提取到足够内容。请手动复制粘贴JD文本，或在浏览器中打开该链接后重试。' });
    }

    // ---- LLM 清洗：从整页 Markdown 中提取纯 JD ----
    const cleaningPrompt = `你是一个信息提取与排版助手。以下是网页扒取的原始内容，包含大量无关信息（头像、导航、HR介绍、其他职位、footer等）。

请仅提取该岗位的核心JD信息，输出以下 JSON：
{
  "company": "公司名称",
  "position": "岗位名称",
  "salary": "薪资范围",
  "location": "工作城市",
  "detail": "职位描述与要求的全文"
}

## detail 排版规范（非常重要）
- **每条职责/要求独占一行**，行首用 "• " 或 "1. " 开头
- **小节标题**（如「岗位职责」「任职要求」「加分项」等）**单独一行**，前后加空行
- **不要输出连续长段落**，每句话原则上不超过60字即换行
- 保留原文中的所有关键信息（技能名、年限、学历等），**不删减**
- 只输出提取的JD内容，不添加"以下是根据..."等无关说明

如果某项信息在原文中找不到，填 ""。

## 原始内容
${text.slice(0, 8000)}`;

    try {
      const { llm } = require('./chatflow/llm-client');
      const cleaned = await llm(cleaningPrompt, '', { temperature: 0.1 });
      // 构建干净的文本
      const parts = [];
      if (cleaned.company) parts.push(`公司：${cleaned.company}`);
      if (cleaned.position) parts.push(`岗位：${cleaned.position}`);
      if (cleaned.salary) parts.push(`薪资：${cleaned.salary}`);
      if (cleaned.location) parts.push(`地点：${cleaned.location}`);
      if (parts.length) parts.push('');
      if (cleaned.detail) parts.push(cleaned.detail);
      text = parts.join('\n').trim() || text;
      console.log('[JD扒取] LLM清洗完成:', text.length, '字');
    } catch (e) {
      console.warn('[JD扒取] LLM清洗失败，使用原始内容:', e.message?.slice(0, 60));
      // 降级：返回原始内容
    }

    const maxLen = 15000;
    // 扒取完成后自动关闭 opencli 浏览器窗口
    closeOpencliWindow().catch(()=>{});
    res.json({ url, text: text.slice(0, maxLen), charCount: Math.min(text.length, maxLen), truncated: text.length > maxLen });
  } catch (e) {
    // 失败时也尝试关闭浏览器
    closeOpencliWindow().catch(()=>{});
    res.status(502).json({ error: '扒取失败: ' + (e.message || String(e)).slice(0, 100) });
  }
});

// ============================================================
// 面经相关性过滤器：LLM 判断每道题是否和当前岗位相关
// ============================================================
async function filterRelevantQuestions(questions, jdParsed) {
  if (!questions.length) return [];
  const { llm } = require('./chatflow/llm-client');

  const jdSummary = [
    jdParsed.company ? `公司: ${jdParsed.company}` : '',
    jdParsed.position ? `岗位: ${jdParsed.position}` : '',
    jdParsed.responsibilities?.length ? `职责: ${jdParsed.responsibilities.join('; ')}` : '',
    jdParsed.requirements?.length ? `要求: ${jdParsed.requirements.join('; ')}` : '',
    jdParsed.keywords?.length ? `关键词: ${jdParsed.keywords.join(', ')}` : ''
  ].filter(Boolean).join('\n');

  const questionsText = questions.map((q, i) =>
    `${i + 1}. [${q.type || ''}] ${q.question}`
  ).join('\n');

  const prompt = `你是一位严格的面试题筛选器。以下是从小红书面经中提取的面试题，请逐一判断是否与当前岗位相关。

## 当前岗位信息
${jdSummary}

## 待过滤的面试题
${questionsText}

## 过滤规则
- 题目内容和岗位职责/技能/行业直接相关 → 保留
- 题目是通用行为问题（自我介绍、优缺点等）→ 保留
- 题目明确是其他公司/完全不相关岗位的 → 丢弃
- 题目涉及的技术栈和JD要求的完全无关 → 丢弃
- 公司入职体验、福利待遇等非面试题 → 丢弃

输出严格 JSON：
{
  "relevant_indices": [1, 3, 5],
  "reasons": {"1": "和岗位AI方向直接相关", "5": "通用行为面试题保留"}
}`;

  try {
    const result = await llm(prompt, '', { temperature: 0.1 });
    const indices = result.relevant_indices || [];
    const filtered = indices.map(i => questions[i - 1]).filter(Boolean);
    if (filtered.length === 0) return questions; // 过滤掉全部时回退
    console.log(`[过滤] 面经题目 ${questions.length} → ${filtered.length} (丢弃 ${questions.length - filtered.length} 条无关)`);
    return filtered;
  } catch (e) {
    console.warn('[过滤] LLM过滤失败，保留全部:', e.message?.slice(0, 60));
    return questions;
  }
}

// ============================================================

// ============================================================
// 批量生成题目（一次生成10-20道）
// ============================================================
app.post('/api/generate-questions-batch', async (req, res) => {
  try {
    const { jdText, resumeText, count = 15 } = req.body;
    if (!jdText) return res.status(400).json({ error: '请提供JD文本' });

    const { llm, fillTemplate } = require('./chatflow/llm-client');
    const prompts = require('./chatflow/prompts');

    const questionTypes = ['行为面试', '专业能力', '项目深挖', '压力测试', 'HR面'];
    const qCount = Math.min(Math.max(parseInt(count) || 15, 10), 20);
    const perType = Math.ceil(qCount / questionTypes.length);

    const allQuestions = [];
    const promises = questionTypes.map(async (qType) => {
      const genPrompt = `你是面试出题专家。请根据JD和候选人简历，生成${perType}道「${qType}」类面试题目。
输出JSON数组: [{"question":"题目","difficulty":"简单/中等/困难","examiner_intent":"考察意图","suggested_answer":"建议回答要点"}]`;
      const userPrompt = `JD: ${jdText.slice(0, 2000)}\n简历: ${(resumeText || "").slice(0, 2000)}\n请生成${qType}题目。`;
      try {
        const result = await llm(genPrompt, userPrompt, { temperature: 0.8 });
        if (Array.isArray(result)) {
          result.forEach(q => { q._type = qType; q._source = 'batch'; });
          allQuestions.push(...result);
        } else if (result.questions && Array.isArray(result.questions)) {
          result.questions.forEach(q => { q._type = qType; q._source = 'batch'; });
          allQuestions.push(...result.questions);
        }
      } catch (e) {
        console.warn('[BatchQ] ' + qType + ' generated failed:', e.message);
      }
    });

    await Promise.all(promises);
    res.json({ questions: allQuestions, total: allQuestions.length, types: questionTypes });
  } catch (e) {
    res.status(500).json({ error: 'batch gen failed: ' + e.message });
  }
});

// 面经采集 — 独立触发
// ============================================================
app.post('/api/mianjing-collect', creditCheck('mianjing-collect', 'analysis'), async (req, res) => {
  const { sessionId, jdText, resumeText, company: reqCompany, position: reqPosition, manualUrls } = req.body;
  const session = sessions.get(sessionId);
  
  const jdParsed = session?.analysis?.jd || {};
  const company = reqCompany || jdParsed.company || '';
  const position = reqPosition || jdParsed.position || '';
  
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  function sse(data) { res.write(`data: ${JSON.stringify(data)}\n\n`); }

  try {
    // 优先手动URL模式
    if (manualUrls?.length) {
      sse({ step: 'mianjing', detail: `🔍 读取 ${manualUrls.length} 条链接...`, status: 'running' });
      const { fetchNotesFromUrls } = require('./chatflow/nodes/mianjing');
      const mResult = await fetchNotesFromUrls(manualUrls, (ev) => sse(ev));
      
      if (mResult?.success && mResult.data?.questions?.length) {
        const relevant = await filterRelevantQuestions(mResult.data.questions, jdParsed);
        mResult.data.questions = relevant;
        
        sse({ step: 'done', detail: `✅ 采集完成: ${mResult.data.source_count || 0} 篇 · ${relevant.length} 题`, status: 'ok', result: { mianjing: mResult.data } });
        res.end();
        return;
      }
      sse({ step: 'done', detail: '❌ 手动链接未提取到题目', status: 'warn' });
      res.end();
      return;
    }

    if (!company && !position) {
      sse({ step: 'error', detail: '无法识别公司/岗位，请确保JD已解析或手动输入' });
      res.end();
      return;
    }

    sse({ step: 'mianjing', detail: '🔍 搜索小红书面经...', status: 'running' });
    
    const { queryMianjing } = require('./chatflow/nodes/mianjing');
    const mResult = await queryMianjing(company, position, (ev) => {
      sse(ev);
    });
    
    if (mResult?.success && mResult.data?.questions?.length) {
      // 相关性过滤
      const qCount = mResult.data.questions.length;
      sse({ step: 'mianjing', detail: `📝 采集到 ${qCount} 道题，正在过滤...`, status: 'running' });
      
      const relevant = await filterRelevantQuestions(mResult.data.questions, jdParsed);
      mResult.data.questions = relevant;
      
      // 更新session中的面经数据
      if (session) {
        session.analysis.mianjing = mResult.data;
        saveSessions();
      }
      
      // 面经库写入
      const label = (session ? session.label : null) || (jdParsed.position || jdParsed.company || '未命名');
      if (mResult.data.questions?.length) {
        const bank = loadMianjingBank();
        for (const q of mResult.data.questions) {
          bank.unshift({
            ...q,
            company: jdParsed.company || '',
            position: jdParsed.position || '',
            sourceLabel: label,
            source: '小红书面经',
            sourceUrls: (mResult.data.sources || []).slice(0, 5).map(s => ({ title: s.title, url: s.url, platform: s.platform || '小红书' })),
            sessionId,
            collectedAt: new Date().toISOString()
          });
        }
        const seen = new Set();
        const deduped = bank.filter(b => { const k = (b.company||'') + '|' + (b.position||'') + '|' + (b.question||''); if (seen.has(k)) return false; seen.add(k); return true; });
        saveMianjingBank(deduped.slice(0, 500));
        console.log(`[Mianjing] 面经库归档: ${mResult.data.questions.length} 条面经题, 题库总量 ${deduped.length}`);
      }
      
      sse({
        step: 'done',
        detail: `✅ 采集完成：${mResult.data.source_count || 0} 篇笔记 · ${relevant.length} 道真题`,
        status: 'ok',
        result: { mianjing: mResult.data }
      });
    } else {
      sse({ step: 'done', detail: '❌ 未采集到面经题目', status: 'warn' });
    }
    res.end();
  } catch (e) {
    sse({ step: 'error', detail: '采集异常: ' + (e.message || '未知'), status: 'error' });
    res.end();
  }
});

// ============================================================
// API: 群面模拟 - 开始
// ============================================================
app.post('/api/group-interview/start', creditCheck('group-interview', 'evaluation'), async (req, res) => {
  try {
    const { sessionId } = req.body;
    const session = sessions.get(sessionId);
    if (!session?.analysis) {
      return res.status(400).json({ error: '请先完成分析（调用 /api/analyze）' });
    }

    const jdParsed = session.analysis.jd;
    const resumeParsed = session.analysis.resume;

    const groupSession = await groupInterviewStart(jdParsed, resumeParsed);
    session.groupInterview = groupSession;
    saveSessions();

    res.json({
      topic: groupSession.topic,
      candidates: groupSession.candidates,
      stage: groupSession.stage
    });
  } catch (e) {
    logError('群面开始失败: ' + (e.stack || e.message));
    res.status(500).json({ error: '群面初始化失败: ' + (e.message || '未知错误') });
  }
});

// ============================================================
// API: 群面模拟 - 用户发言
// ============================================================
app.post('/api/group-interview/respond', async (req, res) => {
  try {
    const { sessionId, message } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: '请提供发言内容' });
    }

    const session = sessions.get(sessionId);
    if (!session?.groupInterview) {
      return res.status(400).json({ error: '请先开始群面模拟（调用 /api/group-interview/start）' });
    }

    const result = await groupInterviewRespond(session.groupInterview, message);
    saveSessions();

    res.json({
      speaker: result.speaker,
      role: result.role,
      message: result.message,
      action: result.action
    });
  } catch (e) {
    logError('群面发言处理失败: ' + (e.stack || e.message));
    res.status(500).json({ error: '群面发言处理失败: ' + (e.message || '未知错误') });
  }
});

// ============================================================
// API: 群面模拟 - 评估
// ============================================================
app.post('/api/group-interview/evaluate', async (req, res) => {
  try {
    const { sessionId } = req.body;
    const session = sessions.get(sessionId);
    if (!session?.groupInterview) {
      return res.status(400).json({ error: '请先开始群面模拟（调用 /api/group-interview/start）' });
    }

    const evaluation = await groupInterviewEvaluate(session.groupInterview);
    saveSessions();

    res.json(evaluation);
  } catch (e) {
    logError('群面评估失败: ' + (e.stack || e.message));
    res.status(500).json({ error: '群面评估失败: ' + (e.message || '未知错误') });
  }
});

// ============================================================
// API: 面经整合分析 (SSE 流式)
// ============================================================
app.post('/api/mianjing-analysis', async (req, res) => {
  sseInit(res);
  const { sessionId, company, position } = req.body;

  try {
    // 从面经库中加载相关题目
    const bank = loadMianjingBank();
    const targetCompany = company || '';
    const targetPosition = position || '';

    if (!targetCompany && !targetPosition) {
      sseError(res, '请提供公司名或岗位名');
      return;
    }

    sseSend(res, { step: 'loading', detail: '正在从面经库加载相关数据...', status: 'running' });

    // 筛选相关题目
    const relevantQuestions = bank.filter(q => {
      const companyMatch = !targetCompany || (q.company && q.company.includes(targetCompany));
      const positionMatch = !targetPosition || (q.position && q.position.includes(targetPosition));
      return companyMatch || positionMatch;
    });

    if (relevantQuestions.length === 0) {
      sseDone(res, {
        step: 'done',
        detail: '未找到相关面经数据，请先采集面经（调用 /api/mianjing-collect）',
        status: 'warn',
        result: {
          company_analysis: { interview_rounds: '未知', common_questions: [], difficulty_level: '未知', salary_range: '面经中未提及', interview_style: '未知' },
          position_analysis: { skill_requirements: [], common_topics: [], pass_rate_estimate: '面经数据不足以估计' },
          trends: [],
          comparison: { same_position_different_company: [], same_company_different_position: [] },
          preparation_advice: ['请先采集面经数据后再进行分析']
        }
      });
      return;
    }

    sseSend(res, { step: 'analyzing', detail: `找到 ${relevantQuestions.length} 道相关真题，正在分析...`, status: 'running' });

    // 调用 LLM 进行分析
    const { llm } = require('./chatflow/llm-client');
    const prompts = require('./chatflow/prompts');

    const analysisPrompt = require('./chatflow/llm-client').fillTemplate(prompts.MIANJING_ANALYSIS, {
      company: targetCompany,
      position: targetPosition,
      mianjing_data: JSON.stringify(relevantQuestions.slice(0, 50), null, 2)
    });

    const analysisResult = await llm(analysisPrompt, '', { temperature: 0.5 });

    sseDone(res, {
      step: 'done',
      detail: `分析完成：${relevantQuestions.length} 道真题，覆盖 ${targetCompany || targetPosition}`,
      status: 'ok',
      result: analysisResult
    });
  } catch (e) {
    logError('面经分析失败: ' + (e.stack || e.message));
    sseError(res, '面经分析失败: ' + (e.message || '未知错误'));
  }
});

// ============================================================
// 健康检查（含 opencli 环境检测）
// ============================================================
app.get('/api/health', async (req, res) => {
  let providerStatus = '未连接';
  try {
    const conns = await listConnections();
    providerStatus = conns.activeConnection
      ? `${conns.activeConnection.providerId} (${conns.activeConnection.name})`
      : '未配置激活连接';
  } catch { /* ignore */ }

  // opencli 自检
  const opencliInfo = detectOpencli();

  res.json({
    status: 'ok',
    provider: providerStatus,
    providerKitPath: PROVIDER_KIT_PATH,
    uptime: process.uptime(),
    sessions: sessions.size,
    opencli: opencliInfo,
    usage: getTokenUsage()
  });
});

/**
 * 检测 opencli 安装状态和可用站点适配器
 */
function detectOpencli() {
  const info = {
    installed: false, version: '', path: '',
    daemon_running: false, ext_installed: false,
    browser_ready: false,
    has_xiaohongshu: false, has_web: false, has_boss: false,
    node_version: process.version
  };

  function findOpencliBin() {
    const candidates = [];
    try {
      const out = execSync('where opencli 2>nul', { shell: true, timeout: 3000, encoding: 'utf-8' }).trim();
      if (out) candidates.push(...out.split('\n').map(s => s.trim()).filter(Boolean));
    } catch {}
    try {
      const root = execSync('npm root -g', { shell: true, timeout: 5000, encoding: 'utf-8' }).trim();
      if (root) candidates.push(path.join(root, '.bin', 'opencli.cmd'), path.join(root, '..', 'opencli'));
    } catch {}
    const appData = process.env.APPDATA || '';
    if (appData) {
      candidates.push(path.join(appData, 'npm', 'opencli.cmd'));
      candidates.push(path.join(appData, 'npm', 'node_modules', 'opencli', 'bin', 'opencli.js'));
    }
    return [...new Set(candidates)];
  }

  function runViaBin(binPath, args) {
    if (!binPath || !fs.existsSync(binPath)) return null;
    try {
      return execSync(`"${binPath}" ${args}`, { shell: true, timeout: 8000, encoding: 'utf-8' }).trim();
    } catch { return null; }
  }

  // 优先 shell 模式 → 解析 PATH
  try {
    const ver = execSync('opencli --version', { shell: true, timeout: 5000, encoding: 'utf-8' }).trim();
    if (ver) { info.installed = true; info.version = ver; }
  } catch {
    const bins = findOpencliBin();
    for (const b of bins) {
      const v = runViaBin(b, '--version');
      if (v && /^\d+\.\d+/.test(v)) { info.installed = true; info.version = v; info.path = b; break; }
    }
  }

  if (info.installed) {
    if (!info.path) {
      try {
        const out = execSync('where opencli 2>nul', { shell: true, timeout: 3000, encoding: 'utf-8' }).trim();
        info.path = out.split('\n')[0]?.trim() || '';
      } catch {}
    }
    try {
      const list = execSync('opencli list 2>&1', { shell: true, timeout: 8000, encoding: 'utf-8' });
      info.has_xiaohongshu = list.includes('xiaohongshu');
      info.has_web = list.includes('web');
      info.has_boss = list.includes('boss');
    } catch {}
    try {
      const d = execSync('opencli doctor 2>&1', { shell: true, timeout: 8000, encoding: 'utf-8' });
      info.daemon_running = d.includes('Daemon: running');
      info.ext_installed = d.includes('Extension: connected');
      info.browser_ready = info.daemon_running && info.ext_installed;
    } catch {}
  }
  return info;
}

// 独立 opencli 检测端点
app.get('/api/opencli-check', (req, res) => {
  res.json(detectOpencli());
});

// ── opencli 一键安装（SSE 流式进度） ──
app.post('/api/opencli-setup', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  function sse(data) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }
  try {
    const { setupOpencliExtension } = require('./chatflow/nodes/opencli-setup');
    const result = await setupOpencliExtension((ev) => sse(ev));
    sse({ step: 'done', detail: result.message, status: result.success ? 'ok' : 'warn', result });
    res.end();
  } catch (e) {
    sse({ step: 'error', detail: '安装异常: ' + (e.message || '未知'), status: 'error' });
    res.end();
  }
});

// 小红书扫码登录 — 使用 opencli 打开小红书搜索页，触发扫码登录
app.post('/api/open-xhs-login', async (req, res) => {
  const ocErr = requireOpencli('打开小红书登录');
  if (ocErr) return res.status(503).json({ error: ocErr });
  try {
    // 使用 opencli xiaohongshu search 命令，会自动打开浏览器（让用户扫码登录）
    await execAsync('opencli xiaohongshu search "面试经验" --foreground', { timeout: 20000 });
    res.json({ ok: true });
  } catch(e) {
    // opencli 可能返回非0（daemon已在运行等），只要命令执行了就认为成功
    const msg = e.stderr ? String(e.stderr) : String(e.message || '');
    if (msg.includes('daemon') || msg.includes('running') || msg.includes('connected')) {
      res.json({ ok: true, hint: 'daemon 已就绪' });
    } else {
      res.status(500).json({ error: '无法打开小红书: ' + msg.slice(0, 120) });
    }
  }
});

// 中间件：检查 opencli 是否就绪
function requireOpencli(what) {
  const oc = detectOpencli();
  if (!oc.installed) {
    return `❌ opencli 未安装。\n\n💡 快速安装：打开终端，执行\n   npm install -g @jackwener/opencli\n\n然后重启本应用。${what ? `（${what}功能需要 opencli）` : ''}`;
  }
  if (!oc.browser_ready) {
    return `❌ 浏览器未绑定。\n\n💡 在终端执行：\n   opencli daemon restart\n\n然后刷新页面重试。`;
  }
  return null;
}

// ============================================================
// 通用 DOCX 生成端点
// ============================================================
app.post('/api/export/generate-docx', async (req, res) => {
  try {
    const { title, content, sections } = req.body;
    const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require('docx');
    const CJK_FONT = 'Microsoft YaHei';
    const FONT = { ascii: 'Arial', hAnsi: 'Arial', eastAsia: CJK_FONT };
    
    const children = [];
    children.push(new Paragraph({ heading: HeadingLevel.TITLE, alignment: require('docx').AlignmentType.CENTER, spacing: { after: 200 },
      children: [new TextRun({ text: title || '导出文档', bold: true, color: '4F46E5', font: FONT })]
    }));
    
    const timestamp = new Date().toLocaleString('zh-CN');
    children.push(new Paragraph({ alignment: require('docx').AlignmentType.CENTER, spacing: { after: 300 },
      children: [new TextRun({ text: `由 一键上岸 导出 · ${timestamp}`, size: 18, color: '999999', font: FONT })]
    }));

    if (sections) {
      for (const [label, text] of Object.entries(sections)) {
        children.push(new Paragraph({ spacing: { before: 300, after: 120 },
          children: [new TextRun({ text: label, bold: true, size: 24, color: '4F46E5', font: FONT })]
        }));
        for (const line of String(text).split('\n')) {
          if (line.trim()) {
            children.push(new Paragraph({ spacing: { after: 60 },
              children: [new TextRun({ text: line, size: 20, font: FONT })]
            }));
          }
        }
      }
    } else if (content) {
      for (const line of String(content).split('\n')) {
        if (line.trim()) {
          children.push(new Paragraph({ spacing: { after: 60 },
            children: [new TextRun({ text: line, size: 20, font: FONT })]
          }));
        }
      }
    }

    const doc = new Document({
      styles: { default: { document: { run: { font: FONT, size: 20 } } } },
      sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1200, right: 1200, bottom: 1200, left: 1200 } } }, children }]
    });
    const buf = await Packer.toBuffer(doc);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(title||'export')}.docx`);
    res.send(buf);
  } catch (e) {
    console.error('[DOCX] 生成失败:', e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// 启动
// ============================================================
const PORT = process.env.PORT || 3456;
const GATEWAY_PORT = process.env.GATEWAY_PORT || 8787;
const IS_ELECTRON = process.env.ELECTRON_MODE === '1';

// 网关就绪标志（用于 SSE 流式等依赖网关的功能）
let _gatewayReady = false;
function isGatewayReady() { return _gatewayReady; }

// HTTP 服务器引用，用于关闭时清理
let _server = null;

function startServer() {
  return new Promise((resolve, reject) => {
    _server = app.listen(PORT, async () => {
      logInfo(`服务器已启动 — http://localhost:${PORT}`);
      logInfo(`AI Provider Kit: ${PROVIDER_KIT_PATH}`);
      console.log(`\n🎯 一键上岸 已启动`);
      console.log(`   应用地址: http://localhost:${PORT}`);
      console.log(`   AI Provider Kit: ${PROVIDER_KIT_PATH}`);

      // 立即 resolve，不阻塞窗口显示
      resolve(_server);

      // 网关异步启动（不阻塞 server 就绪）
      if (process.env.NO_GATEWAY === '1') {
        console.log(`   网关: 云端模式跳过`);
      } else {
        // 延迟 500ms 让 Electron 窗口先渲染
        setTimeout(async () => {
          try {
            const { url } = await startGateway(GATEWAY_PORT);
            _gatewayReady = true;
            logInfo(`网关已启动: ${url}`);
            console.log(`   网关地址: ${url} (OpenAI-compatible)`);
          } catch (e) {
            logWarn(`网关未启动: ${e.message?.slice(0, 80)}`);
            console.log(`   网关: 未启动 (${e.message?.slice(0, 80)})`);
          }
          console.log();
        }, process.env.ELECTRON_MODE === '1' ? 2000 : 500);
      }

      // Electron 模式下不打开外部浏览器
      if (!IS_ELECTRON) {
        const appUrl = `http://localhost:${PORT}`;
        try {
          const platform = process.platform;
          if (platform === 'win32') {
            execSync(`start "" "${appUrl}"`, { shell: true, timeout: 3000 });
          } else if (platform === 'darwin') {
            execSync(`open "${appUrl}"`, { timeout: 3000 });
          } else {
            execSync(`xdg-open "${appUrl}"`, { timeout: 3000 });
          }
          logInfo('浏览器已自动打开: ' + appUrl);
        } catch { /* 打开浏览器失败不阻塞 */ }
      }
    });
    _server.on('error', reject);
  });
}

// 停止 HTTP 服务器，清理所有连接
function stopServer() {
  if (_server) {
    try {
      // 关闭所有活跃连接
      _server.closeAllConnections?.();
      _server.close(() => {
        logInfo('HTTP 服务器已关闭');
      });
      _server = null;
    } catch (e) {
      logWarn('关闭服务器时出错: ' + e.message);
    }
  }
}

// 直接运行时启动
if (!IS_ELECTRON || require.main === module) {
  startServer();
}

// Electron 主进程引用用
module.exports = { app, startServer, stopServer, PORT, isGatewayReady };

// 优雅退出
process.on('SIGINT', () => { logInfo('收到 SIGINT，正在关闭...'); process.exit(0); });
process.on('SIGTERM', () => { logInfo('收到 SIGTERM，正在关闭...'); process.exit(0); });
