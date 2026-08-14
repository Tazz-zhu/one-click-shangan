/* ============================================================
 * jobseeker-bridge.js — 一键上岸：简历助手 ↔ 面试助手 桥接
 * 功能：把简历（ATS 纯文本）与 JD 写入 localStorage 共享键，
 *       嵌入模式（?embed=1）下通过 postMessage 通知父页面
 *       自动切换到「分析 & 押题」并填入输入框。
 * 2026-08-14 新增（整合自 ai-resume-agent 一键上岸）
 * ============================================================ */
(function () {
  'use strict';

  var LS_BRIDGE = 'jobseeker-bridge-v1';
  var params = new URLSearchParams(location.search);
  var embed = params.get('embed') === '1';

  function getState() {
    return (typeof S !== 'undefined') ? S : {};
  }

  function collectPayload() {
    var state = getState();
    var resume = state.resume || {};
    var resumeText = '';
    try {
      if (typeof atsParse === 'function') resumeText = atsParse(resume).text || '';
    } catch (e) { /* 忽略解析异常 */ }
    var jdText = (typeof state.jdText === 'string') ? state.jdText : '';
    return {
      resumeText: resumeText,
      jdText: jdText,
      resumeName: resume.name || '',
      updatedAt: new Date().toISOString(),
      source: 'ai-resume-agent'
    };
  }

  function hasResumeContent(payload) {
    var t = (payload.resumeText || '').replace(/（未填写）/g, '').trim();
    return t.length > 0;
  }

  function safeToast(msg) {
    try { if (typeof toast === 'function') toast(msg); } catch (e) { /* noop */ }
  }

  function bumpStat() {
    try { if (window.Store && Store.bumpStat) Store.bumpStat('exports'); } catch (e) { /* noop */ }
  }

  function syncToInterview() {
    var payload = collectPayload();
    if (!hasResumeContent(payload)) {
      safeToast('请先填写简历内容，再同步到面试助手');
      return;
    }
    try { localStorage.setItem(LS_BRIDGE, JSON.stringify(payload)); } catch (e) { /* noop */ }
    bumpStat();
    if (embed && window.parent && window.parent !== window) {
      try {
        window.parent.postMessage({ type: 'jobseeker-bridge', action: 'import', payload: payload }, '*');
      } catch (e) { /* noop */ }
      safeToast('已同步到面试助手 ✅');
    } else {
      safeToast('已保存到本机 ✅ 打开面试助手后，在「分析 & 押题」页点击「从简历助手导入」即可');
    }
  }

  function initEmbedMode() {
    var banner = document.getElementById('embed-banner');
    if (banner) banner.hidden = false;
    document.body.classList.add('embed-mode');
  }

  function init() {
    var btn1 = document.getElementById('btn-sync-interview');
    var btn2 = document.getElementById('btn-sync-interview-top');
    if (btn1) btn1.addEventListener('click', syncToInterview);
    if (btn2) btn2.addEventListener('click', syncToInterview);
    if (embed) initEmbedMode();
    window.JobseekerBridge = {
      embed: embed,
      syncToInterview: syncToInterview,
      collectPayload: collectPayload
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();