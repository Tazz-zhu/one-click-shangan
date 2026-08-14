// ============================================================
// 独立 LLM 客户端 — 直接调用 OpenAI-compatible API
// 不依赖 ai-provider-kit，适用于云端部署
// ============================================================

const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');

const CONNECTIONS_FILE = path.resolve(__dirname, '..', '.local', 'ai-connections.json');

function loadActiveConnection() {
  try {
    if (!fs.existsSync(CONNECTIONS_FILE)) return null;
    const state = JSON.parse(fs.readFileSync(CONNECTIONS_FILE, 'utf-8'));
    const activeId = state.activeConnectionId;
    if (!activeId) return state.aiConnections?.[0];
    return (state.aiConnections || []).find(c => c.id === activeId) || state.aiConnections?.[0];
  } catch { return null; }
}

let _client = null;
let _connId = null;

function getClient() {
  const conn = loadActiveConnection();
  if (!conn) throw new Error('未配置 AI 供应商。请在设置面板中添加连接。');
  const key = `${conn.apiBaseUrl}|${conn.apiKey || ''}`;
  if (_client && _connId === key) return _client;
  _client = new OpenAI({ baseURL: conn.apiBaseUrl || 'https://api.openai.com/v1', apiKey: conn.apiKey || '', timeout: 120000 });
  _connId = key;
  return _client;
}

async function standaloneLlm(systemPrompt, userContent, { jsonMode = true, temperature = 0.7 } = {}) {
  const client = getClient();
  const conn = loadActiveConnection();
  const model = conn?.model || 'gpt-4o-mini';

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: typeof userContent === 'string' ? userContent : JSON.stringify(userContent, null, 2) }
  ];

  const resp = await client.chat.completions.create({ model, messages, temperature, max_tokens: 4096 });
  const text = resp.choices?.[0]?.message?.content || '';

  if (jsonMode) {
    try {
      const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      const candidate = codeBlock ? codeBlock[1] : text;
      const braceMatch = candidate.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(braceMatch ? braceMatch[0] : candidate);
      if (Object.keys(parsed).length === 0) throw new Error('empty object');
      return parsed;
    } catch (e) {
      console.warn('[Standalone LLM] JSON 解析失败:', e.message?.slice(0, 60));
      return { raw: text, parse_error: true, error_detail: e.message };
    }
  }
  return text;
}

module.exports = { standaloneLlm, loadActiveConnection };
