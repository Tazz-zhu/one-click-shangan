/* ============================================================
 * store.js — 应用状态、本地持久化、版本管理、云端同步
 * ============================================================ */

const LS_KEY = 'ai-resume-agent-v1';

function uid(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function emptyResume() {
  return {
    name: '', phone: '', email: '', city: '',
    education: { school: '', major: '', degree: '', gradDate: '' },
    experiences: [],
    skills: [],
    summary: '',
    intention: { position: '', city: '', salary: '' },
    customSections: [] // 自定义模块：{ id, title, items: [] }
  };
}

function cloneResume(r) {
  return JSON.parse(JSON.stringify(r || emptyResume()));
}

function emptyVersion(resume) {
  const now = new Date();
  return {
    id: uid('v'),
    name: '',
    createdAt: now.toISOString(),
    status: 'draft',          // draft | submitted | editing
    company: '',
    submittedAt: '',
    url: '',
    resume: cloneResume(resume)
  };
}

/* 全局状态对象 */
const S = {
  resume: emptyResume(),
  settings: {
    template: 'modern',
    color: '#2d9d78',
    fontSize: 'standard',     // small | standard | large
    lineHeight: 1.6,
    showPhoto: false,
    theme: '',                // '' = 跟随系统 | light | dark
    fontFamily: 'sans',       // sans | serif | mono
    recentTemplates: []        // 最近使用的模板（最多 3 个）
  },
  onboarded: false,           // 首访引导是否已完成
  jdText: '',                 // 当前目标岗位 JD（对话中收集，参与生成定制）
  chat: {
    started: false,
    stage: 'name',            // 当前对话阶段
    messages: [],             // { role: 'ai'|'user', text }
    quick: [],
    expPending: null,         // 正在采集的经历 id
    expField: null,           // 当前采集字段 title|role|time|detail|result
    pendingIntent: 'position',// position | city | salary
    unrecognized: 0           // 连续未识别计数（>=3 切表单模式）
  },
  editedPaths: [],            // 用户手动编辑过的 data-path（重新生成时保留）
  versions: [],
  currentVersionId: '',
  jdAnalyses: [],             // { id, jdText, result }
  generated: false,           // 是否已执行过内容生成
  stats: defaultStats()        // 本地使用统计（纯前端，不联网）
};

/* ---------- 持久化 ---------- */
function saveState() {
  recordHistory();
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(S));
  } catch (e) {
    console.warn('保存状态失败', e);
    try { if (typeof toast === 'function') toast('存储空间不足：请导出 JSON 备份后删除旧版本或照片', 'error'); } catch (e2) { /* 忽略 */ }
  }
  try { if (typeof window !== 'undefined' && window.__notifySaved) window.__notifySaved(); } catch (e3) { /* 忽略 */ }
  // 记录本地最后修改时间并调度云端同步（未登录时自动跳过）
  syncMeta.localUpdatedAt = Date.now();
  persistSyncMeta();
  scheduleCloudSync();
}

/** 将任意数据合并进默认状态结构，返回新对象（不修改 S） */
function mergeState(data) {
  const base = JSON.parse(JSON.stringify(S));
  Object.assign(base, data);
  base.editedPaths = Array.isArray(data.editedPaths) ? data.editedPaths : [];
  base.settings = Object.assign({}, S.settings, data.settings || {});
  base.resume = Object.assign({}, emptyResume(), data.resume || {});
  base.resume.education = Object.assign({ school:'', major:'', degree:'', gradDate:'' }, (data.resume && data.resume.education) || {});
  base.resume.intention = Object.assign({ position:'', city:'', salary:'' }, (data.resume && data.resume.intention) || {});
  base.chat = Object.assign({}, S.chat, data.chat || {});
  base.versions = Array.isArray(data.versions) ? data.versions : [];
  base.jdAnalyses = Array.isArray(data.jdAnalyses) ? data.jdAnalyses : [];
  base.stats = Object.assign({}, defaultStats(), data.stats || {});
  return base;
}

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return false;
    // 合并默认值，防止旧数据结构缺失字段
    Object.assign(S, mergeState(data));
    return true;
  } catch (e) {
    console.warn('读取状态失败', e);
    return false;
  }
}

/* ---------- 撤销 / 重做（会话内内存历史，最多 50 步） ---------- */
var undoStack = [], redoStack = [], lastSavedSnapshot = null;
function snapshotKey() { try { return JSON.stringify(S); } catch (e) { return ''; } }
function recordHistory() {
  const key = snapshotKey();
  if (lastSavedSnapshot === null) { lastSavedSnapshot = key; return; }
  if (key !== lastSavedSnapshot) {
    undoStack.push(lastSavedSnapshot);
    if (undoStack.length > 50) undoStack.shift();
    redoStack = [];
    lastSavedSnapshot = key;
  }
}
function applySnapshot(snap, msg) {
  try {
    const data = JSON.parse(snap);
    Object.keys(S).forEach(k => delete S[k]);
    Object.assign(S, data);
    localStorage.setItem(LS_KEY, snap);
    syncMeta.localUpdatedAt = Date.now(); persistSyncMeta();
    lastSavedSnapshot = snap;
    if (typeof renderAll === 'function') renderAll();
    if (typeof toast === 'function') toast(msg, 'success');
    refreshUndoUI();
    return true;
  } catch (e) { return false; }
}
function undo() { if (!undoStack.length) return false; redoStack.push(snapshotKey()); return applySnapshot(undoStack.pop(), '已撤销 ↩'); }
function redo() { if (!redoStack.length) return false; undoStack.push(snapshotKey()); return applySnapshot(redoStack.pop(), '已重做 ↪'); }
function refreshUndoUI() { try { if (typeof window !== 'undefined' && window.__refreshUndo) window.__refreshUndo(); } catch (e) { /* 忽略 */ } }

function defaultStats() {
  return {
    firstVisitAt: '', lastVisitAt: '', visits: 0,
    generations: 0, diagnoses: 0, exports: 0, shares: 0, backups: 0, lastBackupAt: ''
  };
}

/* 本地统计计数（纯前端，不联网；仅本地存储） */
function bumpStat(key) {
  if (!S.stats) S.stats = defaultStats();
  S.stats[key] = (S.stats[key] || 0) + 1;
  if (key === 'backups') S.stats.lastBackupAt = new Date().toISOString();
  saveState();
}

function resetState() {
  const prevStats = (S.stats && typeof S.stats === 'object') ? S.stats : defaultStats();
  const keys = Object.keys(S);
  keys.forEach(k => delete S[k]);
  Object.assign(S, {
    resume: emptyResume(),
    settings: { template:'modern', color:'#2d9d78', fontSize:'standard', lineHeight:1.6, showPhoto:false, theme:'', fontFamily:'sans', recentTemplates: [] },
    onboarded: false,
    jdText: '',
    chat: { started:false, stage:'name', messages:[], quick:[], expPending:null, expField:null, pendingIntent:'position' },
    versions: [],
    currentVersionId: '',
    jdAnalyses: [],
    generated: false,
    stats: prevStats
  });
  localStorage.removeItem(LS_KEY);
  // 重置同步时间戳（云端数据保留；下次登录/编辑时按时间戳新者合并）
  syncMeta = { cloudUpdatedAt: 0, localUpdatedAt: 0 };
  persistSyncMeta();
}

/* ---------- 版本管理 ---------- */
function currentVersion() {
  return S.versions.find(v => v.id === S.currentVersionId) || null;
}

function ensureVersion() {
  if (!currentVersion()) {
    const v = emptyVersion(S.resume);
    const pos = (S.resume.intention && S.resume.intention.position) || '';
    v.name = pos ? (pos + ' · ' + todayStr()) : ('我的简历 · ' + todayStr());
    v.status = 'editing';
    v.resume = cloneResume(S.resume);
    S.versions.push(v);
    S.currentVersionId = v.id;
  }
}

function createVersion(name) {
  const cur = currentVersion();
  const v = emptyVersion(cur ? cur.resume : S.resume);
  v.name = name || ('新版本 · ' + todayStr());
  v.status = 'editing';
  S.versions.push(v);
  S.currentVersionId = v.id;
  S.resume = cloneResume(v.resume);
  return v;
}

function switchVersion(id) {
  const v = S.versions.find(x => x.id === id);
  if (!v) return false;
  S.currentVersionId = id;
  S.resume = cloneResume(v.resume);
  // 重置生成态：切换版本后需要重新渲染
  S.generated = false;
  saveState();
  return true;
}

function todayStr() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/* 当前版本数据同步到 S.resume（编辑后调用） */
function syncResumeToVersion() {
  const v = currentVersion();
  if (v) {
    v.resume = cloneResume(S.resume);
    v.status = 'editing';
  }
}

function diffVersions(a, b) {
  /* 返回两个版本的差异摘要（模块级） */
  const parts = [];
  const ra = a.resume || {}, rb = b.resume || {};
  if (ra.name !== rb.name) parts.push('基本信息');
  if ((ra.education || {}).school !== (rb.education || {}).school) parts.push('教育背景');
  const ea = (ra.experiences || []).length, eb = (rb.experiences || []).length;
  if (ea !== eb) parts.push('经历条目（' + ea + ' → ' + eb + '）');
  if (JSON.stringify(ra.experiences || []) !== JSON.stringify(rb.experiences || [])) {
    if (!parts.includes('经历条目')) parts.push('经历内容');
  }
  if (JSON.stringify(ra.skills || []) !== JSON.stringify(rb.skills || [])) parts.push('专业技能');
  if (ra.summary !== rb.summary) parts.push('自我评价');
  if (JSON.stringify(ra.intention || {}) !== JSON.stringify(rb.intention || {})) parts.push('求职意向');
  return parts.length ? parts : ['无差异'];
}

/* ============================================================
 * 云端同步（登录后启用；未登录完全离线，零影响）
 * - 本地保存后 2 秒防抖 PUT /api/resume（乐观锁）
 * - 登录/刷新页面时 GET 合并：时间戳新者优先，冲突弹 toast
 * ============================================================ */
const SYNC_KEY = 'ai-resume-agent-sync-v1';
let syncTimer = null;
let syncMeta = loadSyncMeta();

function loadSyncMeta() {
  try {
    const raw = localStorage.getItem(SYNC_KEY);
    if (!raw) return { cloudUpdatedAt: 0, localUpdatedAt: 0 };
    const d = JSON.parse(raw);
    return {
      cloudUpdatedAt: Number(d.cloudUpdatedAt) || 0,
      localUpdatedAt: Number(d.localUpdatedAt) || 0
    };
  } catch (e) {
    return { cloudUpdatedAt: 0, localUpdatedAt: 0 };
  }
}

function persistSyncMeta() {
  try {
    localStorage.setItem(SYNC_KEY, JSON.stringify(syncMeta));
  } catch (e) {
    console.warn('保存同步状态失败', e);
  }
}

function authApi() {
  return (typeof Auth !== 'undefined' && Auth) ? Auth : null;
}

function isCloudSyncEnabled() {
  const a = authApi();
  return !!(a && a.isLoggedIn && a.isLoggedIn());
}

function cloudRequest(path, options) {
  const a = authApi();
  if (!a || !a.api) return Promise.reject(new Error('未登录'));
  return a.api(path, options);
}

/** 本地变更后 2 秒防抖推送云端；未登录直接跳过 */
function scheduleCloudSync() {
  if (!isCloudSyncEnabled()) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(function () {
    syncTimer = null;
    pushToCloud().catch(function (err) {
      // 网络失败静默降级：数据仍保存在本地，不打断编辑
      console.warn('云端同步失败，数据仍保存在本地', err && err.message);
    });
  }, 2000);
}

/** 推送本地状态到云端（乐观锁；冲突时按时间戳新者处理） */
function pushToCloud() {
  if (!isCloudSyncEnabled()) return Promise.resolve(null);
  const body = {
    resumeJson: JSON.parse(JSON.stringify(S)),
    clientUpdatedAt: syncMeta.localUpdatedAt || Date.now()
  };
  if (syncMeta.cloudUpdatedAt > 0) body.updatedAt = syncMeta.cloudUpdatedAt;

  return cloudRequest('/resume', { method: 'PUT', body: JSON.stringify(body) })
    .then(function (res) {
      syncMeta.cloudUpdatedAt = Number(res && res.updatedAt) || Date.now();
      syncMeta.localUpdatedAt = syncMeta.cloudUpdatedAt;
      persistSyncMeta();
      return res;
    })
    .catch(function (err) {
      if (err && err.conflictData) {
        const server = err.conflictData;
        const serverUpdatedAt = Number(server && server.updatedAt) || 0;
        if (serverUpdatedAt > syncMeta.localUpdatedAt) {
          // 云端更新：采用云端版本
          adoptCloudData(server);
          return null;
        }
        // 本地更新：以服务器版本为基线直接覆盖
        syncMeta.cloudUpdatedAt = serverUpdatedAt;
        persistSyncMeta();
        return pushToCloud();
      }
      throw err;
    });
}

/** 采用云端版本：合并进 S 并写回本地（不再触发重复推送） */
function adoptCloudData(server) {
  const data = (server && server.resumeJson && typeof server.resumeJson === 'object') ? server.resumeJson : null;
  if (!data) return false;
  Object.assign(S, mergeState(data));
  syncMeta.cloudUpdatedAt = Number(server.updatedAt) || 0;
  syncMeta.localUpdatedAt = syncMeta.cloudUpdatedAt;
  persistSyncMeta();
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(S));
  } catch (e) {
    console.warn('写入本地状态失败', e);
  }
  if (typeof renderAll === 'function') renderAll();
  if (typeof toast === 'function') toast('已同步云端最近版本', 'success');
  try {
    if (window.dispatchEvent) window.dispatchEvent(new CustomEvent('resume:cloud-synced'));
  } catch (e) { /* 忽略 */ }
  return true;
}

/**
 * 登录/刷新页面时初始化云端同步：
 * - 本地为空 → 直接采用云端
 * - 云端新 → 下载覆盖本地
 * - 本地新（或无本地时间戳但有数据）→ 上传覆盖云端
 */
function initCloudSync() {
  if (!isCloudSyncEnabled()) return Promise.resolve(null);
  return cloudRequest('/resume', { method: 'GET' })
    .then(function (res) {
      const serverUpdatedAt = Number(res && res.updatedAt) || 0;
      const serverResume = (res && res.resumeJson && typeof res.resumeJson === 'object') ? res.resumeJson : null;
      const localHasData = S.versions.length > 0 || !!(
        S.resume && (
          S.resume.name || S.resume.phone || S.resume.email ||
          (S.resume.experiences && S.resume.experiences.length) ||
          (S.resume.education && S.resume.education.school)
        )
      );
      const localHasTimestamp = syncMeta.localUpdatedAt > 0;

      if (serverUpdatedAt > 0 && !localHasData) {
        adoptCloudData(res); // 本地为空：直接采用云端
      } else if (serverUpdatedAt > syncMeta.localUpdatedAt && localHasTimestamp) {
        adoptCloudData(res); // 云端新：下载覆盖本地
      } else if (syncMeta.localUpdatedAt > serverUpdatedAt || (localHasData && !localHasTimestamp)) {
        syncMeta.cloudUpdatedAt = serverUpdatedAt; // 本地新：上传覆盖云端
        persistSyncMeta();
        return pushToCloud();
      } else {
        syncMeta.cloudUpdatedAt = serverUpdatedAt;
        persistSyncMeta();
      }
      return null;
    })
    .catch(function (err) {
      // 拉取失败保持本地模式（离线可用）
      console.warn('云端简历拉取失败，保持本地模式', err && err.message);
      return null;
    });
}

/* 暴露给 auth.js / 其他页面 */
if (typeof window !== 'undefined') {
  window.Store = {
    initCloudSync: initCloudSync,
    pushToCloud: pushToCloud,
    bumpStat: bumpStat,
    undo: undo,
    redo: redo,
    canUndo: function () { return undoStack.length > 0; },
    canRedo: function () { return redoStack.length > 0; },
    getSyncMeta: function () {
      return { cloudUpdatedAt: syncMeta.cloudUpdatedAt, localUpdatedAt: syncMeta.localUpdatedAt };
    }
  };
}
