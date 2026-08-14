/* ============================================================
 * ai-remote.js — 真实 LLM 适配器（GAP-A7/C2/C3）
 * 用法：设置 window.AI_REMOTE_ENABLED = true 并配置后端 DEEPSEEK_API_KEY 后启用。
 * 提供统一入口：AIRemote.call(kind, messages, fallback)
 *   - 未启用/未登录/后端 503/超时/失败 → 自动降级 fallback（模拟引擎）
 * ============================================================ */
(function () {
  var REMOTE_ENABLED = !!window.AI_REMOTE_ENABLED;
  // 不同接口超时：chat/生成/建议较快；诊断/JD 用强推理模型（v4-pro）耗时 20-40s，需给足时间
  var TIMEOUTS = { chat: 20000, generate: 30000, suggest: 30000, diagnose: 120000, jd: 120000 };

  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error('AI 服务超时')); }, ms);
      promise.then(function (v) { clearTimeout(timer); resolve(v); }, function (e) { clearTimeout(timer); reject(e); });
    });
  }

  window.AIRemote = {
    enabled: REMOTE_ENABLED,

    /** 是否真正可用：开关已开启 且 已登录（未登录时远程 AI 不做调用，直接降级） */
    ready: function () {
      return REMOTE_ENABLED && !!window.Auth && !!Auth.getToken();
    },

    /** kind: chat / generate / suggest / diagnose / jd；messages: [{role, content}] */
    call: function (kind, messages, fallback) {
      var fallbackValue = function () { return typeof fallback === 'function' ? fallback() : fallback; };
      if (!REMOTE_ENABLED) return Promise.resolve(fallbackValue());
      if (!window.Auth || !Auth.api || !Auth.getToken()) return Promise.resolve(fallbackValue());
      // 前端内部角色为 ai/user，OpenAI 兼容接口需要 assistant/user：发送前归一化
      var payloadMessages = (messages || []).map(function (m) {
        return { role: m.role === 'ai' ? 'assistant' : m.role, content: m.content };
      });
      var timeout = TIMEOUTS[kind] || 20000;
      return withTimeout(
        Auth.api('/ai/' + kind, { method: 'POST', body: JSON.stringify({ messages: payloadMessages }) }).then(function (r) {
          if (!r || !r.content) throw new Error('AI 返回为空');
          return r.content;
        }),
        timeout
      ).catch(function () { return fallbackValue(); });
    },
  };
})();