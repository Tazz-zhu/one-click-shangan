/**
 * 代码面试 API 模块
 * AI 生成编程题 + AI 代码审查
 */
const { llm } = require('../chatflow/llm-client');
const { CODE_INTERVIEW_GENERATE, CODE_INTERVIEW_REVIEW } = require('../chatflow/prompts');
const { creditCheck } = require('./credits');
const fs = require('fs');
const path = require('path');

function extractJSON(str) {
  // 尝试匹配 JSON 代码块
  const codeBlock = str.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (codeBlock) {
    try { return JSON.parse(codeBlock[1].trim()); } catch (e) { /* fall through */ }
  }
  // 尝试匹配裸 JSON 对象
  const match = str.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch (e) { /* fall through */ }
  }
  return {};
}

function registerCodeInterviewRoutes(app) {

  // POST /api/code-interview/generate — 生成编程题
  app.post('/api/code-interview/generate', creditCheck('code-interview-generate', 'evaluation'), async (req, res) => {
    try {
      const { jdText, resumeText, language = 'javascript' } = req.body;

      const prompt = CODE_INTERVIEW_GENERATE
        .replace('{jdText}', jdText || '通用技术岗位')
        .replace('{resumeText}', resumeText || '无简历信息')
        .replace(/\{language\}/g, language);

      const result = await llm(prompt, '', { temperature: 0.7 });
      const parsed = extractJSON(result);

      // 确保必要字段存在
      if (!parsed.title) {
        return res.status(500).json({ error: '题目生成失败，请重试', raw: result.substring(0, 500) });
      }

      res.json(parsed);
    } catch (e) {
      console.error('Code interview generate error:', e);
      res.status(500).json({ error: '生成题目失败: ' + e.message });
    }
  });

  // POST /api/code-interview/review — 审查代码
  app.post('/api/code-interview/review', creditCheck('code-interview-review', 'evaluation'), async (req, res) => {
    try {
      const { question, code, language } = req.body;
      if (!question || !code) {
        return res.status(400).json({ error: '缺少题目或代码' });
      }
      if (code.trim().length < 10) {
        return res.status(400).json({ error: '代码内容太短，请至少写几行代码' });
      }

      const prompt = CODE_INTERVIEW_REVIEW
        .replace('{question}', typeof question === 'string' ? question : JSON.stringify(question, null, 2))
        .replace('{code}', code)
        .replace('{language}', language || '未知');

      const result = await llm(prompt, '', { temperature: 0.3 });
      const parsed = extractJSON(result);

      if (!parsed.overallScore && parsed.overallScore !== 0) {
        return res.status(500).json({ error: '代码审查失败，请重试', raw: result.substring(0, 500) });
      }

      res.json(parsed);
    } catch (e) {
      console.error('Code interview review error:', e);
      res.status(500).json({ error: '代码审查失败: ' + e.message });
    }
  });

  // GET /api/code-interview/history — 代码面试历史
  app.get('/api/code-interview/history', (req, res) => {
    try {
      const historyFile = path.join(DATA_DIR, '.data', 'code-interview-history.json');
      if (!fs.existsSync(historyFile)) {
        return res.json([]);
      }
      const history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
      // 如果已登录，只返回该用户的记录
      if (req.user) {
        const userHistory = (history[req.user.userId] || []).slice(-20).reverse();
        return res.json(userHistory);
      }
      res.json([]);
    } catch (e) {
      res.json([]);
    }
  });

  // POST /api/code-interview/history — 保存记录
  app.post('/api/code-interview/history', (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: '请先登录' });
      const { question, code, language, review } = req.body;
      const historyFile = path.join(DATA_DIR, '.data', 'code-interview-history.json');
      const dir = path.dirname(historyFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      let history = {};
      if (fs.existsSync(historyFile)) {
        try { history = JSON.parse(fs.readFileSync(historyFile, 'utf8')); } catch (e) {}
      }
      if (!history[req.user.userId]) history[req.user.userId] = [];

      history[req.user.userId].push({
        id: 'ci_' + Date.now().toString(36),
        question: question,
        code: code,
        language: language,
        review: review,
        createdAt: new Date().toISOString()
      });

      // 只保留最近 50 条
      if (history[req.user.userId].length > 50) {
        history[req.user.userId] = history[req.user.userId].slice(-50);
      }

      fs.writeFileSync(historyFile, JSON.stringify(history, null, 2), 'utf8');
      res.json({ success: true });
    } catch (e) {
      console.error('Save code interview history error:', e);
      res.status(500).json({ error: '保存失败' });
    }
  });
}

module.exports = { registerCodeInterviewRoutes };