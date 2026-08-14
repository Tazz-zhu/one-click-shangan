/* ============================================================
 * auth.js — 纯前端本地版：无账号体系、无后端、无需登录
 *
 * 保留与旧版一致的 window.Auth 接口（isLoggedIn / api / track / init 等），
 * 让 store.js / ui.js / app.js 中依赖后端的功能自动降级为纯本地模式：
 *   - Auth.api = null        → 云端同步 / 真实 docx / OCR / 在线分享等自动跳过
 *   - Auth.isLoggedIn()=false→ 云端同步与登录相关 UI 全部关闭
 *   - Auth.track() 为空操作  → 不采集任何行为数据
 * ============================================================ */
(function () {
  var Auth = {
    apiBase: '',

    /* ---- 登录态（纯前端版恒为未登录） ---- */
    getToken: function () { return null; },
    getRefreshToken: function () { return null; },
    getUser: function () { return null; },
    isLoggedIn: function () { return false; },
    setSession: function () { /* 无后端：忽略 */ },
    clearSession: function () { /* 无后端：忽略 */ },

    /* ---- 后端 API（纯前端版不提供，业务代码检测到 null 自动走本地降级） ---- */
    api: null,

    /* ---- 行为埋点：不采集 ---- */
    track: function () {},

    /* ---- 生命周期 ---- */
    init: function () { return Promise.resolve(); },
    onAuthChange: function (cb) { /* 保留接口，登录态不会变化 */ },
    renderAuthUI: function () {},
    refreshSession: function () { return Promise.reject(new Error('纯前端版无账号体系')); },
    logout: function () { Auth.clearSession(); },
    showAccountModal: function () {}
  };

  window.Auth = Auth;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { Auth.renderAuthUI(); });
  } else {
    Auth.renderAuthUI();
  }
})();
