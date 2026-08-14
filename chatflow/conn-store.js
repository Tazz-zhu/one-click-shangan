// ============================================================
// 连接存储 — 独立于 ai-provider-kit 的直接文件操作
// 云端部署时替代 ai-provider-kit 的连接管理
// ============================================================

const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');

const CONNECTIONS_FILE = path.resolve(__dirname, '..', '.local', 'ai-connections.json');
const PROVIDERS_FILE = path.resolve(__dirname, '..', '.local', 'ai-providers.json');

function ensureDir() {
  const dir = path.dirname(CONNECTIONS_FILE);
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
}

function readJSON(filePath, fallback = {}) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {}
  return fallback;
}

function writeJSON(filePath, data) {
  ensureDir();
  try { fs.writeFileSync(filePath, JSON.stringify(data, null, 2)); } catch {}
}

// ─── 内置供应商预设 ───
const DEFAULT_PROVIDERS = [
  { id: 'openai', name: 'OpenAI', defaultBaseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini', protocol: 'openai-compatible' },
  { id: 'deepseek', name: 'DeepSeek', defaultBaseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat', protocol: 'openai-compatible' },
  { id: 'custom', name: '自定义', defaultBaseUrl: '', defaultModel: 'gpt-4o-mini', protocol: 'openai-compatible' },
];

function listProviders() {
  const saved = readJSON(PROVIDERS_FILE, { providers: [] });
  const merged = [...DEFAULT_PROVIDERS];
  for (const p of (saved.providers || [])) {
    if (!merged.find(m => m.id === p.id)) merged.push(p);
  }
  return { providers: merged };
}

function listConnections() {
  const state = readJSON(CONNECTIONS_FILE, { aiConnections: [], activeConnectionId: '' });
  return { connections: state.aiConnections || [], activeConnectionId: state.activeConnectionId || '' };
}

function saveConnection(input) {
  const state = readJSON(CONNECTIONS_FILE, { aiConnections: [], activeConnectionId: '' });
  const list = state.aiConnections || [];
  const existing = list.findIndex(c => c.id === input.id);
  if (existing >= 0) {
    list[existing] = { ...list[existing], ...input };
  } else {
    list.push({ ...input, id: input.id || Date.now().toString(36) });
  }
  state.aiConnections = list;
  if (!state.activeConnectionId && list.length > 0) state.activeConnectionId = list[0].id;
  writeJSON(CONNECTIONS_FILE, state);
  return { ok: true, connection: input };
}

function setActiveConnection(id) {
  const state = readJSON(CONNECTIONS_FILE, { aiConnections: [], activeConnectionId: '' });
  state.activeConnectionId = id;
  writeJSON(CONNECTIONS_FILE, state);
  return { ok: true };
}

function deleteConnection(id) {
  const state = readJSON(CONNECTIONS_FILE, { aiConnections: [], activeConnectionId: '' });
  state.aiConnections = (state.aiConnections || []).filter(c => c.id !== id);
  if (state.activeConnectionId === id) state.activeConnectionId = (state.aiConnections[0] || {}).id || '';
  writeJSON(CONNECTIONS_FILE, state);
  return { ok: true };
}

async function testConnection(input) {
  const conn = input.connection || input;
  try {
    const client = new OpenAI({
      baseURL: conn.apiBaseUrl || 'https://api.openai.com/v1',
      apiKey: conn.apiKey || '',
      timeout: 15000
    });
    const resp = await client.models.list();
    const models = (resp.data || []).map(m => m.id).filter(id => id && !id.includes('dall-e') && !id.includes('whisper') && !id.includes('tts') && !id.includes('embedding')).slice(0, 20);
    return { ok: true, models };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

async function fetchModels(input) {
  const conn = input.connection || input;
  return testConnection(input);
}

module.exports = { listProviders, listConnections, saveConnection, setActiveConnection, deleteConnection, testConnection, fetchModels };
