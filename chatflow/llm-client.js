// ============================================================
// LLM Client — 自动选择后端
//   优先使用 ai-provider-kit (本地开发), 不存在时用 standalone-llm
// ============================================================

const path = require('path');
const fs = require('fs');

let _llm = null;
let _backend = 'unknown';

async function loadLlm() {
  if (_llm) return _llm;

  // 尝试加载 ai-provider-kit
  try {
    const provider = require('./ai-provider');
    _llm = provider.llm;
    _backend = 'ai-provider-kit';
    console.log('[LLM] 使用 ai-provider-kit');
    return _llm;
  } catch (e) {
    console.warn('[LLM] ai-provider-kit 不可用, 尝试 standalone...');
  }

  // 回退到 standalone
  try {
    const { standaloneLlm } = require('./standalone-llm');
    _llm = standaloneLlm;
    _backend = 'standalone';
    console.log('[LLM] 使用 standalone (直接 OpenAI API)');
    return _llm;
  } catch (e) {
    throw new Error('无法加载任何 LLM 后端: ' + e.message);
  }
}

/** 统一 LLM 接口, 与 ai-provider.js 签名兼容 */
async function llm(systemPrompt, userContent, opts = {}) {
  const fn = await loadLlm();
  return fn(systemPrompt, userContent, opts);
}

function fillTemplate(template, vars) {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(
      new RegExp(`\\{\\{${key}\\}\\}`, 'g'),
      typeof value === 'string' ? value : JSON.stringify(value, null, 2)
    );
  }
  return result;
}

async function* llmStream(systemPrompt, userContent, opts = {}) {
  // 尝试从 ai-provider 获取流式接口
  try {
    const provider = require('./ai-provider');
    if (provider.llmStream) {
      yield* provider.llmStream(systemPrompt, userContent, opts);
      return;
    }
  } catch {}
  throw new Error('llmStream not available');
}

module.exports = { llm, fillTemplate, llmStream };
