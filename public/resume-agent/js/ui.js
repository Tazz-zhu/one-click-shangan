/* ============================================================
 * ui.js — 渲染与交互（Part 1：工具、视图、简历纸张、对话、生成）
 * ============================================================ */

/* ---------- 工具 ---------- */
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

function toast(msg, type, actionLabel, actionFn) {
  const el = document.createElement('div');
  el.className = 'toast ' + (type || '');
  el.textContent = msg;
  if (actionLabel && actionFn) {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = actionLabel;
    btn.addEventListener('click', () => { actionFn(); el.remove(); });
    el.appendChild(btn);
  }
  $('#toast-root').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 320); }, 4200);
}

let escHandler = null;
function openModal(html, wide) {
  const root = $('#modal-root');
  root.innerHTML = '<div class="modal-mask"><div class="modal' + (wide ? ' modal-wide' : '') + '">' + html + '</div></div>';
  root.querySelector('.modal-mask').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });
  if (escHandler) document.removeEventListener('keydown', escHandler);
  escHandler = (e) => { if (e.key === 'Escape' || e.keyCode === 27) closeModal(); };
  document.addEventListener('keydown', escHandler);
}

function closeModal() {
  if (escHandler) { document.removeEventListener('keydown', escHandler); escHandler = null; }
  $('#modal-root').innerHTML = '';
}

function showContextMenu(x, y, items) {
  closeContextMenu();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.id = 'ctx-menu';
  items.forEach(it => {
    const btn = document.createElement('button');
    btn.textContent = it.label;
    if (it.danger) btn.className = 'danger';
    btn.addEventListener('click', () => { closeContextMenu(); it.action(); });
    menu.appendChild(btn);
  });
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, window.innerWidth - rect.width - 8) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - rect.height - 8) + 'px';
  setTimeout(() => document.addEventListener('click', closeContextMenu, { once: true }), 0);
}
function closeContextMenu() { const m = $('#ctx-menu'); if (m) m.remove(); }

/* ---------- 首页渲染（完成度环） ---------- */
function emptyState(iconName, title, desc, actionsHtml) {
  return '<div class="empty-state">' +
    '<span class="es-icon">' + icon(iconName) + '</span>' +
    '<p class="es-title">' + esc(title) + '</p>' +
    (desc ? '<p class="es-desc">' + esc(desc) + '</p>' : '') +
    (actionsHtml ? '<div class="es-actions">' + actionsHtml + '</div>' : '') +
    '</div>';
}

function renderHome() {
  const pct = resumeCompletion();
  const ring = $('#completion-ring');
  if (ring) ring.style.background = 'conic-gradient(var(--accent) ' + pct + '%, var(--rule) 0)';
  const sp = $('#completion-pct');
  if (sp) sp.textContent = pct ? pct + '%' : '--';
  /* 继续上次编辑摘要卡片 */
  const sum = $('#resume-summary');
  if (sum) {
    const hasData = !!(S.versions.length || S.resume.name || S.resume.phone || S.resume.email);
    sum.hidden = !hasData;
    if (hasData) {
      const v = currentVersion() || (S.versions && S.versions[0]) || null;
      const versionName = (v && v.name) || '';
      const personName = S.resume.name || versionName || '未命名简历';
      const name = personName + (versionName && versionName !== personName ? ' · ' + versionName : '');
      const submitted = (S.versions || []).filter(x => x.status === 'submitted').length;
      const last = (S.stats && S.stats.lastVisitAt) ? '上次编辑：' + new Date(S.stats.lastVisitAt).toLocaleDateString('zh-CN') : '';
      const nameEl = $('#rs-name'); if (nameEl) nameEl.textContent = name;
      const metaEl = $('#rs-meta'); if (metaEl) metaEl.textContent = '版本 ' + S.versions.length + ' · 已投递 ' + submitted + (last ? ' · ' + last : '');
      const pctEl = $('#rs-pct'); if (pctEl) pctEl.textContent = pct ? pct + '%' : '--';
    }
  }
  /* 备份提醒横幅（有数据且长期未备份时显示，可关闭） */
  const tip = $('#backup-tip');
  if (tip) {
    const hasData = !!(S.versions.length || S.resume.name || S.resume.phone || S.resume.email);
    const st = S.stats || {};
    const last = st.lastBackupAt ? new Date(st.lastBackupAt).getTime() : 0;
    const needTip = hasData && (st.backups === 0 || (last && (Date.now() - last) > 14 * 24 * 3600 * 1000));
    let dismissed = false;
    try { dismissed = sessionStorage.getItem('backup-tip-dismissed') === '1'; } catch (e) { /* 忽略 */ }
    tip.style.display = (needTip && !dismissed) ? 'flex' : 'none';
    if (!tip.dataset.bound) {
      tip.dataset.bound = '1';
      const go = $('#backup-tip-go'); if (go) go.addEventListener('click', () => switchView('export'));
      const close = $('#backup-tip-close'); if (close) close.addEventListener('click', () => {
        tip.style.display = 'none';
        try { sessionStorage.setItem('backup-tip-dismissed', '1'); } catch (e) { /* 忽略 */ }
      });
    }
  }
}

/* 完成度缺口清单 */
function showCompletionDetail() {
  const R = S.resume, E = R.education || {}, I = R.intention || {};
  const items = [];
  const add = (ok, label, action) => { if (!ok) items.push({ label, action }); };
  add(R.name, '填写姓名', 'chat');
  add(R.phone, '填写手机号', 'chat');
  add(R.email, '填写邮箱', 'chat');
  add(E.school, '填写学校', 'chat');
  add(E.major, '填写专业', 'chat');
  add(E.degree, '选择学历', 'chat');
  add(E.gradDate, '填写毕业时间', 'chat');
  add((R.experiences || []).length > 0, '补充至少 1 段经历', 'chat');
  add(flatSkills(R).length > 0, '补充专业技能', 'chat');
  add(!!R.summary, '生成自我评价', 'generate');
  add(!!I.position, '填写目标岗位', 'chat');
  const done = 11 - items.length;
  openModal('<h3>简历完成度</h3><p>已完成 <b>' + done + '/11</b> 项' + (items.length ? '，还差：' : '，非常棒！') + '</p>' +
    '<div class="todo-list">' +
    (items.length
      ? items.map(it => '<button class="todo-item" data-act="' + it.action + '"><span>☐</span>' + esc(it.label) + '<small>去补充 →</small></button>').join('')
      : '<div class="todo-done">🎉 全部完成，可以开始诊断与投递了！</div>') +
    '</div>' +
    '<div class="modal-actions"><button class="btn btn-primary" onclick="closeModal()">知道了</button></div>');
  $$('.todo-item').forEach(b => b.addEventListener('click', () => {
    closeModal();
    switchView(b.dataset.act === 'generate' ? 'generate' : 'chat');
  }));
}

/* ---------- 视图切换 ---------- */
function switchView(name) {
  $$('.view').forEach(v => v.classList.remove('active'));
  const view = $('#view-' + name);
  if (view) view.classList.add('active');
  $$('.step').forEach(s => s.classList.toggle('active', s.dataset.view === name));
  $$('#mobile-tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'home') renderHome();
  else if (name === 'chat') renderChat();
  else if (name === 'generate') renderGenerate();
  else if (name === 'template') renderTemplate();
  else if (name === 'diagnosis') renderDiagnosis();
  else if (name === 'jd') renderJd();
  else if (name === 'export') renderExport();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (window.Auth && Auth.track) Auth.track('page_view', { view: name });
}

/* 姓名首字母占位头像（未上传照片时使用） */
function initialAvatar(name, color) {
  try {
    const c = document.createElement('canvas');
    c.width = 148; c.height = 184;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 148, 184);
    g.addColorStop(0, color || '#2d9d78');
    g.addColorStop(1, '#4b7ef0');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 148, 184);
    ctx.fillStyle = 'rgba(255,255,255,.94)';
    ctx.font = 'bold 60px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText((name || '我').slice(0, 1), 74, 94);
    return c.toDataURL('image/png');
  } catch (e) { return ''; }
}

/* ---------- 简历纸张渲染 ---------- */
function renderResumeHTML(resume, settings) {
  const tpl = TEMPLATES.find(t => t.id === settings.template) || TEMPLATES[0];
  const fs = settings.fontSize === 'small' ? 12 : settings.fontSize === 'large' ? 15.5 : 14;
  const lh = settings.lineHeight || 1.6;
  const color = settings.color || '#2d9d78';
  const ffMap = {
    sans: "'PingFang SC','Microsoft YaHei','Noto Sans CJK SC',sans-serif",
    serif: "Georgia,'Songti SC','SimSun',serif",
    mono: "'Consolas','Courier New',monospace"
  };
  const ff = ffMap[settings.fontFamily] || ffMap.sans;
  const R = resume || S.resume;
  const E = R.education || { school:'', major:'', degree:'', gradDate:'' };
  const I = R.intention || { position:'', city:'', salary:'' };
  const hasPhoto = !!settings.showPhoto;

  const nameHtml = R.name ? esc(R.name) : '<span class="r-placeholder">你的姓名</span>';
  const subHtml =
    '<span data-path="phone" contenteditable="true">' + (R.phone ? esc(R.phone) : '<span class="r-placeholder">手机号</span>') + '</span> · ' +
    '<span data-path="email" contenteditable="true">' + (R.email ? esc(R.email) : '<span class="r-placeholder">邮箱</span>') + '</span>' +
    (R.city ? ' · <span data-path="city" contenteditable="true">' + esc(R.city) + '</span>' : '');
  const eduLine =
    '<span data-path="edu.school" contenteditable="true">' + (E.school ? esc(E.school) : '<span class="r-placeholder">学校</span>') + '</span> · ' +
    '<span data-path="edu.major" contenteditable="true">' + (E.major ? esc(E.major) : '<span class="r-placeholder">专业</span>') + '</span> · ' +
    '<span data-path="edu.degree" contenteditable="true">' + (E.degree ? esc(E.degree) : '<span class="r-placeholder">学历</span>') + '</span> · ' +
    '<span data-path="edu.gradDate" contenteditable="true">' + (E.gradDate ? esc(E.gradDate) : '<span class="r-placeholder">毕业时间</span>') + '</span>';

  const intentionHtml = '<span class="r-intention" data-path="intention" contenteditable="true">求职意向：' + (I.position ? esc(I.position) : '<span class="r-placeholder">目标岗位</span>') + (I.city ? ' · ' + esc(I.city) : '') + (I.salary ? ' · ' + esc(I.salary) : '') + '</span>';

  const eduSec = '<section class="r-section" data-sec="edu"><div class="r-section-title">教育背景</div><div class="r-item"><div class="r-item-head"><span class="r-item-title" data-path="edu.school" contenteditable="true">' + (E.school ? esc(E.school) : '<span class="r-placeholder">学校</span>') + '</span><span class="r-item-time" data-path="edu.gradDate" contenteditable="true">' + (E.gradDate ? esc(E.gradDate) : '') + '</span></div><div class="r-item-role" data-path="edu.major" contenteditable="true">' + (E.major ? esc(E.major) : '<span class="r-placeholder">专业</span>') + ' · ' + (E.degree ? esc(E.degree) : '<span class="r-placeholder">学历</span>') + '</div></div></section>';

  const expSecs = (R.experiences || []).map(e => {
    const title = e.title ? esc(e.title) : '<span class="r-placeholder">经历名称</span>';
    const role = e.role ? esc(e.role) : '';
    const org = e.org ? esc(e.org) : '';
    const time = (e.start ? esc(e.start) : '') + (e.end ? ' - ' + esc(e.end) : '');
    const bullets = (e.bullets && e.bullets.length ? e.bullets : (e.desc ? [e.desc] : ['<span class="r-placeholder">请补充经历描述</span>'])).map((b, i) => '<li data-path="exp.' + e.id + '.bullets.' + i + '" contenteditable="true">' + esc(b) + '</li>').join('');
    return '<section class="r-section" data-sec="exp" data-exp="' + e.id + '"><div class="r-section-title">' + ({ intern:'实习经历', project:'项目经历', competition:'竞赛获奖', club:'社团活动' }[e.type] || '经历') + ' <span class="hint">点击条目可直接编辑</span></div><div class="r-item"><div class="r-item-head"><span class="r-item-title" data-path="exp.' + e.id + '.title" contenteditable="true">' + title + '</span><span class="r-item-time">' + time + '</span></div><div class="r-item-role">' + [role, org].filter(Boolean).join(' · ') + '</div><ul class="r-bullets">' + bullets + '</ul></div></section>';
  }).join('');

  const skillHtml = (R.skills || []).map((g, gi) =>
    '<div class="r-skill-line"><b>' + esc(g.category) + '：</b>' + g.items.map((it, ii) => '<span data-path="skills.' + gi + '.' + ii + '" contenteditable="true">' + esc(it) + '</span>').join(' / ') + '</div>'
  ).join('') || '<span class="r-placeholder">暂无技能信息</span>';
  const skillSec = '<section class="r-section" data-sec="skill"><div class="r-section-title">专业技能</div>' + skillHtml + '</section>';

  const summarySec = '<section class="r-section" data-sec="summary"><div class="r-section-title">自我评价</div><div class="r-summary" data-path="summary" contenteditable="true">' + (R.summary ? esc(R.summary) : '<span class="r-placeholder">暂无自我评价（可点击编辑）</span>') + '</div></section>';

  /* 自定义模块（证书 / 荣誉 / 语言 / 兴趣爱好等） */
  const customSecs = (R.customSections || []).map(s =>
    '<section class="r-section" data-sec="custom" data-custom="' + s.id + '"><div class="r-section-title">' + esc(s.title) + ' <span class="hint">可编辑</span></div>' +
    (s.items && s.items.length
      ? s.items.map((it, ii) => '<div class="r-summary" data-path="custom.' + s.id + '.' + ii + '" contenteditable="true">' + esc(it) + '</div>').join('')
      : '<div class="r-placeholder">（空模块，点击上方「添加模块」补充内容）</div>') +
    '</section>'
  ).join('');

  const header = '<header class="r-header">' +
    (hasPhoto ? '<img class="r-photo" src="' + esc(R.photoUrl || initialAvatar(R.name, color)) + '" alt="照片">' : '') +
    '<div class="r-name" data-path="name" contenteditable="true">' + nameHtml + '</div>' +
    '<div class="r-sub">' + subHtml + '<br>' + eduLine + '</div>' +
    intentionHtml + '</header>';

  if (tpl.id === 'duo') {
    const side = '<div class="r-side">' +
      '<section class="r-section"><div class="r-section-title">联系方式</div><div class="r-summary" style="font-size:12.5px">' + subHtml + '</div></section>' +
      skillSec +
      '<section class="r-section"><div class="r-section-title">求职意向</div><div class="r-summary" style="font-size:12.5px">' + (I.position ? esc(I.position) : '<span class="r-placeholder">目标岗位</span>') + '<br>' + (I.city ? esc(I.city) : '') + '<br>' + (I.salary ? esc(I.salary) : '') + '</div></section>' +
      '</div><div class="r-maincol">' + eduSec + expSecs + summarySec + customSecs + '</div>';
    return '<div class="sheet tpl-duo" style="--r-accent:' + color + ';font-size:' + fs + 'px;line-height:' + lh + ';font-family:' + ff + '">' + header + '<div class="r-duo">' + side + '</div></div>';
  }

  return '<div class="sheet tpl-' + tpl.id + '" style="--r-accent:' + color + ';font-size:' + fs + 'px;line-height:' + lh + ';font-family:' + ff + '">' + header + eduSec + expSecs + skillSec + summarySec + customSecs + '</div>';
}

/* 内容编辑同步（data-path → 数据模型） */
function applyPathEdit(path, text) {
  const R = S.resume;
  const parts = path.split('.');
  if (parts[0] === 'name') R.name = text;
  else if (parts[0] === 'phone') R.phone = text;
  else if (parts[0] === 'email') R.email = text;
  else if (parts[0] === 'intention') {
    const m = text.replace(/^求职意向：/, '').split('·');
    R.intention.position = (m[0] || '').trim();
    R.intention.city = (m[1] || '').trim();
    R.intention.salary = (m[2] || '').trim();
  }
  else if (parts[0] === 'edu') R.education[parts[1]] = text;
  else if (parts[0] === 'exp') {
    const exp = R.experiences.find(e => e.id === parts[1]);
    if (exp) {
      if (parts[2] === 'title') exp.title = text;
      else if (parts[2] === 'bullets') {
        exp.bullets[Number(parts[3])] = text;
        if (!S.editedPaths.includes(path)) S.editedPaths.push(path);
      }
    }
  }
  else if (parts[0] === 'skills') {
    const gi = Number(parts[1]), ii = Number(parts[2]);
    if (R.skills[gi] && R.skills[gi].items[ii] != null) R.skills[gi].items[ii] = text;
  }
  else if (parts[0] === 'summary') R.summary = text;
  else if (parts[0] === 'custom') {
    const sec = R.customSections.find(s => s.id === parts[1]);
    if (sec && parts[2] != null) sec.items[Number(parts[2])] = text;
  }
}

function wireSheetEditable(container) {
  container.querySelectorAll('[contenteditable="true"]').forEach(el => {
    el.addEventListener('input', () => {
      const path = el.dataset.path;
      if (!path) return;
      applyPathEdit(path, el.innerText.trim());
      scheduleSuggRefresh();
      debouncedSave();
    });
  });
}

let saveTimer = null;
function debouncedSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { syncResumeToVersion(); saveState(); }, 350);
}

let suggTimer = null;
function scheduleSuggRefresh() {
  clearTimeout(suggTimer);
  suggTimer = setTimeout(() => {
    const active = $('.view.active');
    if (active && active.id === 'view-generate') renderSuggestions();
  }, 500);
}

/* ---------- 模块1：对话 ---------- */
function renderChat() {
  Chat.start();
  renderMessages();
  renderQuick();
  updateChatProgress();
  renderExtract();
  updateGenerateBtn();
  // 移动端不自动聚焦（避免键盘弹出遮挡，也让底部 Tab 保持可见）；用户点击输入框后再隐藏
  if (window.innerWidth > 768) $('#chat-text').focus();
}

function renderMessages() {
  const box = $('#chat-messages');
  box.innerHTML = '';
  const msgs = S.chat.messages;
  msgs.forEach((m, i) => {
    const el = buildMsgEl(m);
    // PRD：AI 消息附带下一轮快捷建议按钮
    if (m.role === 'ai' && i === msgs.length - 1 && S.chat.quick && S.chat.quick.length) {
      const chips = document.createElement('div');
      chips.className = 'quick-chips';
      S.chat.quick.forEach(([label, val]) => {
        const b = document.createElement('button');
        b.className = 'chip';
        b.textContent = label;
        b.addEventListener('click', () => { $('#chat-text').value = val; sendChat(); });
        chips.appendChild(b);
      });
      el.querySelector('.msg-body').appendChild(chips);
    }
    box.appendChild(el);
  });
  scrollChat();
}

function updateGenerateBtn() {
  const ready = !!(S.resume.name && S.resume.education.school && S.resume.education.major && S.resume.intention.position);
  $('#btn-to-generate').disabled = !ready;
  $('#btn-to-generate').textContent = ready ? '信息完整 · 生成简历 →' : '继续对话，补充完整信息…';
}

function buildMsgEl(m) {
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + m.role;
  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.textContent = m.role === 'ai' ? 'AI' : '我';
  const body = document.createElement('div');
  body.className = 'msg-body';
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.textContent = m.text;
  body.appendChild(bubble);
  const d = new Date();
  const time = document.createElement('div');
  time.className = 'msg-time';
  time.textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  body.appendChild(time);
  wrap.appendChild(avatar);
  wrap.appendChild(body);
  return wrap;
}

function scrollChat() {
  const box = $('#chat-messages');
  if (box) box.scrollTop = box.scrollHeight;
}

function renderQuick() {
  // 快捷建议已改为跟随 AI 消息展示（见 renderMessages），此处仅清理旧容器
  const q = $('#chat-quick');
  if (q) q.innerHTML = '';
}

function updateChatProgress() {
  const p = Chat.progress();
  $('#chat-progress-num').textContent = p.pct;
  $('#chat-progress-bar').style.width = p.pct + '%';
  $('#chat-stage-label').textContent = p.label;
  const status = Chat.stageStatus();
  $$('.cstage').forEach(el => {
    const g = el.dataset.s;
    el.classList.toggle('done', !!status[g]);
    el.classList.toggle('current', g === p.group && p.pct < 100);
  });
}

function row(k, v, field, ph) {
  const btn = field ? '<button class="ext-edit" data-field="' + field + '" title="点击编辑">' + icon('edit') + '</button>' : '';
  return '<div class="ext-row"><span class="k">' + k + '</span><b>' + esc(v || ph || '待补充') + '</b>' + btn + '</div>';
}

/* ================= 头像上传 ================= */
function openPhotoUpload() {
  const cur = S.resume.photoUrl || '';
  openModal('<h3>上传头像</h3><p>支持 jpg / png / webp，自动压缩至 360px，仅保存在本地浏览器。</p>' +
    '<div class="photo-upload">' +
    '<div class="photo-preview" id="photo-preview">' +
    (cur ? '<img src="' + esc(cur) + '" alt="当前头像">' : '<div class="photo-ph">' + esc((S.resume.name || '我').slice(0, 1)) + '</div>') +
    '</div>' +
    '<input type="file" id="photo-file" accept="image/*" hidden>' +
    '<div class="modal-actions" style="justify-content:center">' +
    '<button class="btn btn-primary btn-sm" id="btn-pick-photo">' + (cur ? '更换图片' : '选择图片') + '</button>' +
    (cur ? '<button class="btn btn-danger-ghost btn-sm" id="btn-del-photo">移除头像</button>' : '') +
    '<button class="btn btn-ghost btn-sm" onclick="closeModal()">取消</button>' +
    '</div></div>');
  $('#btn-pick-photo').addEventListener('click', () => $('#photo-file').click());
  const del = $('#btn-del-photo');
  if (del) del.addEventListener('click', () => { removePhoto(); closeModal(); });
  $('#photo-file').addEventListener('change', ev => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    compressImageToDataUrl(file, 360, dataUrl => {
      if (!dataUrl) { toast('图片读取失败，请换一张', 'error'); return; }
      S.resume.photoUrl = dataUrl;
      S.settings.showPhoto = true;
      syncResumeToVersion(); saveState();
      closeModal();
      refreshPhotoUI();
      toast('头像已上传 ✅', 'success');
    });
  });
}

function removePhoto() {
  S.resume.photoUrl = '';
  S.settings.showPhoto = false;
  syncResumeToVersion(); saveState();
  refreshPhotoUI();
  toast('头像已移除');
}

function refreshPhotoUI() {
  const active = $('.view.active');
  if (!active) return;
  const id = active.id;
  if (id === 'view-chat') renderExtract();
  else if (id === 'view-template') renderTemplate();
  else if (id === 'view-generate') renderGenerate();
}

function renderExtract() {
  const R = S.resume, E = R.education, I = R.intention;
  const box = $('#extract-panel');
  const item = (title, inner, addBtn) => '<div class="ext-item"><h4><span class="dot"></span>' + title + (addBtn || '') + '</h4>' + (inner || '<div class="ext-empty">待补充</div>') + '</div>';
  const addExpBtn = '<button class="ext-add" data-act="add-exp" title="通过对话添加经历">+ 添加经历</button>';
  const addSkillBtn = '<button class="ext-add" data-act="add-skill" title="手动添加技能">+ 技能</button>';
  const contact = row('姓名', R.name, 'name') + row('电话', R.phone, 'phone') + row('邮箱', R.email, 'email') + row('城市', R.city, 'city');
  const edu = row('学校', E.school, 'edu.school') + row('专业', E.major, 'edu.major') + row('学历', E.degree, 'edu.degree') + row('毕业时间', E.gradDate, 'edu.gradDate');
  const exp = (R.experiences || []).map(e =>
    '<div class="ext-row"><b>' + esc(e.title || '未命名经历') + '</b><span class="ext-moves">' +
    '<button class="ext-mv" data-exp="' + e.id + '" data-dir="-1" title="上移">▲</button>' +
    '<button class="ext-mv" data-exp="' + e.id + '" data-dir="1" title="下移">▼</button>' +
    '<button class="ext-del" data-exp="' + e.id + '" title="删除该经历">' + icon('trash') + '</button></span></div>' +
    '<div class="ext-row"><span class="k">' + ({ intern:'实习', project:'项目', competition:'竞赛', club:'社团' }[e.type] || '经历') + ' · ' + esc(e.role || '角色待补充') + '</span></div>'
  ).join('');
  const customRows = (R.customSections || []).map(s =>
    '<div class="ext-row"><b>' + esc(s.title) + '</b><button class="ext-del" data-custom="' + s.id + '" title="删除该模块">' + icon('trash') + '</button></div>' +
    (s.items && s.items.length ? '<div class="ext-row"><span class="k">' + esc(s.items.join(' · ').slice(0, 34)) + (s.items.join(' · ').length > 34 ? '…' : '') + '</span></div>' : '')
  ).join('');
  const skills = (R.skills || []).map((g, gi) => g.items.map((it, ii) =>
    '<span class="exp-tag">' + esc(it) + '<b class="tag-x" data-skill="' + gi + '.' + ii + '" title="删除该技能">×</b></span>'
  ).join('')).join('');
  const intent = row('目标岗位', I.position, 'intent.position') + row('期望城市', I.city, 'intent.city') + row('期望薪资', I.salary, 'intent.salary');
  const avatarHtml =
    '<div class="ext-avatar">' +
    (R.photoUrl
      ? '<img class="ext-avatar-img" src="' + esc(R.photoUrl) + '" alt="头像">'
      : '<div class="ext-avatar-ph">' + esc((R.name || '我').slice(0, 1)) + '</div>') +
    '<button class="btn btn-ghost btn-sm" id="btn-ext-avatar">' + (R.photoUrl ? '更换头像' : '上传头像') + '</button>' +
    '</div>';
  box.innerHTML = avatarHtml + item('基本信息', contact) + item('教育背景', edu) + item('经历挖掘', exp || '<div class="ext-empty">通过对话补充</div>', addExpBtn) + item('专业技能', skills || '<div class="ext-empty">待补充</div>', addSkillBtn) + item('自定义模块', customRows || '<div class="ext-empty">证书 / 荣誉 / 语言 / 兴趣</div>', '<button class="ext-add" data-act="add-custom">+ 模块</button>') + item('求职意向', intent);

  const extAvatarBtn = $('#btn-ext-avatar');
  if (extAvatarBtn) extAvatarBtn.addEventListener('click', openPhotoUpload);
  box.querySelectorAll('.ext-edit').forEach(b => b.addEventListener('click', () => openFieldEditor(b.dataset.field)));
  box.querySelectorAll('.tag-x').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    const [gi, ii] = b.dataset.skill.split('.').map(Number);
    const group = S.resume.skills[gi];
    if (group) {
      group.items.splice(ii, 1);
      if (!group.items.length) S.resume.skills.splice(gi, 1);
      syncResumeToVersion(); saveState();
      renderExtract();
      renderGenerate();
      toast('技能已删除');
    }
  }));
  box.querySelectorAll('.ext-add').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.act === 'add-exp') addExperienceFlow();
    if (b.dataset.act === 'add-skill') addSkillFlow();
  }));
  box.querySelectorAll('.ext-del').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.exp) deleteExperience(b.dataset.exp);
    if (b.dataset.custom) deleteCustomSection(b.dataset.custom);
  }));
  box.querySelectorAll('.ext-mv').forEach(b => b.addEventListener('click', () => moveExperience(b.dataset.exp, Number(b.dataset.dir))));
  box.querySelectorAll('.ext-add').forEach(b => {
    if (b.dataset.act === 'add-custom') b.addEventListener('click', addCustomFlow);
  });
}

function moveExperience(id, dir) {
  const arr = S.resume.experiences;
  const i = arr.findIndex(e => e.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= arr.length) return;
  const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  syncResumeToVersion(); saveState();
  renderExtract(); renderGenerate();
  toast(dir < 0 ? '经历已上移' : '经历已下移');
}

function addCustomFlow() {
  openModal('<h3>添加自定义模块</h3><p>例如：证书荣誉、语言能力、兴趣爱好等。每行一条内容。</p>' +
    '<label>模块名称</label><input type="text" id="custom-title" placeholder="例如：证书荣誉 / 语言能力" maxlength="20">' +
    '<label>内容（每行一条）</label><textarea id="custom-items" rows="4" placeholder="CET-6（550 分）&#10;国家励志奖学金&#10;普通话二级甲等"></textarea>' +
    '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">取消</button><button class="btn btn-primary" id="custom-save">添加</button></div>');
  $('#custom-save').addEventListener('click', () => {
    const title = ($('#custom-title').value || '').trim();
    const items = ($('#custom-items').value || '').split(/\n+/).map(s => s.trim()).filter(Boolean);
    if (!title) { toast('请填写模块名称', 'error'); return; }
    S.resume.customSections = S.resume.customSections || [];
    S.resume.customSections.push({ id: uid('cs'), title, items });
    syncResumeToVersion(); saveState();
    closeModal(); renderExtract(); renderGenerate();
    toast('自定义模块已添加 ✅', 'success');
  });
}

function deleteCustomSection(id) {
  const sec = (S.resume.customSections || []).find(s => s.id === id);
  if (!sec) return;
  openModal('<h3>删除该模块？</h3><p>「' + esc(sec.title) + '」将从简历中移除。</p>' +
    '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">取消</button><button class="btn btn-danger-ghost" id="confirm-del-custom">删除</button></div>');
  $('#confirm-del-custom').addEventListener('click', () => {
    const idx = S.resume.customSections.findIndex(s => s.id === id);
    lastDeleted = { type: 'custom', item: sec, index: idx };
    S.resume.customSections.splice(idx, 1);
    syncResumeToVersion(); saveState();
    closeModal(); renderExtract(); renderGenerate();
    toast('模块已删除', '', '撤销', undoDelete);
  });
}

let lastDeleted = null; // 撤销栈：{ type, item, index, wasCurrent? }

function undoDelete() {
  if (!lastDeleted) return;
  const d = lastDeleted;
  lastDeleted = null;
  if (d.type === 'exp') {
    S.resume.experiences.splice(Math.min(d.index, S.resume.experiences.length), 0, d.item);
    if (S.chat.expPending === null) S.chat.expPending = d.item.id;
    syncResumeToVersion(); saveState(); renderExtract(); renderGenerate();
    toast('已恢复经历 ✅', 'success');
  } else if (d.type === 'custom') {
    S.resume.customSections = S.resume.customSections || [];
    S.resume.customSections.splice(Math.min(d.index, S.resume.customSections.length), 0, d.item);
    syncResumeToVersion(); saveState(); renderExtract(); renderGenerate();
    toast('已恢复模块 ✅', 'success');
  } else if (d.type === 'version') {
    S.versions.splice(Math.min(d.index, S.versions.length), 0, d.item);
    if (d.wasCurrent) S.currentVersionId = d.item.id;
    saveState(); renderExport();
    toast('已恢复版本 ✅', 'success');
  }
}

function deleteExperience(id) {
  const exp = S.resume.experiences.find(e => e.id === id);
  if (!exp) return;
  openModal('<h3>删除这段经历？</h3><p>「' + esc(exp.title || '未命名经历') + '」将从简历中移除。</p>' +
    '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">取消</button><button class="btn btn-danger-ghost" id="confirm-del-exp">删除</button></div>');
  $('#confirm-del-exp').addEventListener('click', () => {
    const idx = S.resume.experiences.findIndex(e => e.id === id);
    lastDeleted = { type: 'exp', item: exp, index: idx };
    S.resume.experiences.splice(idx, 1);
    if (S.chat.expPending === id) S.chat.expPending = null;
    syncResumeToVersion(); saveState();
    closeModal(); renderExtract(); renderGenerate();
    toast('经历已删除', '', '撤销', undoDelete);
  });
}

/* 表单降级模式：直接编辑字段（对应 PRD 兜底机制） */
const FIELD_EDITORS = {
  name:           { label: '姓名',     get: () => S.resume.name, set: v => { S.resume.name = v; } },
  phone:          { label: '手机号',   get: () => S.resume.phone, set: v => { S.resume.phone = v; } },
  email:          { label: '邮箱',     get: () => S.resume.email, set: v => { S.resume.email = v; } },
  city:           { label: '城市',     get: () => S.resume.city, set: v => { S.resume.city = v; } },
  'edu.school':   { label: '学校',     get: () => S.resume.education.school, set: v => { S.resume.education.school = v; } },
  'edu.major':    { label: '专业',     get: () => S.resume.education.major, set: v => { S.resume.education.major = v; } },
  'edu.degree':   { label: '学历',     get: () => S.resume.education.degree, set: v => { S.resume.education.degree = v; }, select: true },
  'edu.gradDate': { label: '毕业时间', get: () => S.resume.education.gradDate, set: v => { S.resume.education.gradDate = v; } },
  'intent.position': { label: '目标岗位', get: () => S.resume.intention.position, set: v => { S.resume.intention.position = v; } },
  'intent.city':  { label: '期望城市', get: () => S.resume.intention.city, set: v => { S.resume.intention.city = v; } },
  'intent.salary':{ label: '期望薪资', get: () => S.resume.intention.salary, set: v => { S.resume.intention.salary = v; } }
};

function openFieldEditor(field) {
  const def = FIELD_EDITORS[field];
  if (!def) return;
  const listAttr = field === 'edu.school' ? ' list="school-list"' : field === 'edu.major' ? ' list="major-list"' : '';
  const input = def.select
    ? '<select id="field-input">' + DEGREES.map(d => '<option' + (def.get() === d ? ' selected' : '') + '>' + d + '</option>').join('') + '</select>'
    : '<input type="text" id="field-input" value="' + esc(def.get()) + '" placeholder="' + esc(def.label) + '"' + listAttr + '>';
  openModal('<h3>编辑' + def.label + '</h3><p style="margin-bottom:0">直接填写即可，保存后同步到简历。</p>' + input +
    '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">取消</button><button class="btn btn-primary" id="field-save">保存</button></div>');
  $('#field-save').addEventListener('click', () => {
    const v = def.select ? $('#field-input').value : $('#field-input').value.trim();
    if ((field === 'edu.school' || field === 'edu.major') && !v) { toast('请填写' + def.label, 'error'); return; }
    def.set(v);
    if (field === 'phone' && v && !/^1[3-9]\d{9}$/.test(v)) toast('提示：手机号建议为 11 位数字（已保存）');
    if (field === 'email' && v && !/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(v)) toast('提示：邮箱格式可能不正确（已保存）');
    if (field === 'edu.school' && v.length > 30) toast('提示：学校名称过长，请检查是否有错别字（已保存）');
    else if (field === 'edu.school' && /\d/.test(v)) toast('提示：学校名称一般不含数字，请确认（已保存）');
    else if (field === 'edu.school' && v.length >= 2 && !/(大学|学院|学校|分校|校区|研究院|党校)/.test(v)) toast('提示：请确认学校名称完整（已保存）');
    if (field === 'edu.major' && v.length > 20) toast('提示：专业名称过长，请检查（已保存）');
    else if (field === 'edu.major' && /(大学|学院)/.test(v)) toast('提示：专业名称不应包含“大学/学院”，请确认（已保存）');
    S.chat.unrecognized = 0;
    syncResumeToVersion();
    saveState();
    closeModal();
    renderExtract();
    updateChatProgress();
    updateGenerateBtn();
    toast('已保存 ✅', 'success');
  });
}

/* ---------- 首访引导 ---------- */
function showOnboarding() {
  if (S.onboarded) return;
  openModal(
    '<div class="ob-wrap">' +
    '<div class="ob-logo">Offer</div>' +
    '<h3 style="margin:10px 0 4px">欢迎使用一键上岸 👋</h3>' +
    '<p>三步搞定一份专业简历：</p>' +
    '<div class="ob-steps">' +
    '<div class="ob-step"><b>1</b><span><b>对话引导</b><small>像聊天一样回答问题，AI 挖掘你的经历亮点</small></span></div>' +
    '<div class="ob-step"><b>2</b><span><b>AI 生成</b><small>基础信息 + 岗位 JD 自动生成定制简历表述</small></span></div>' +
    '<div class="ob-step"><b>3</b><span><b>诊断投递</b><small>六维诊断 + JD 匹配，导出多版本简历</small></span></div>' +
    '</div>' +
    '<div class="modal-actions">' +
    '<button class="btn btn-ghost" id="ob-skip">跳过</button>' +
    '<button class="btn btn-ghost" id="ob-demo">先看示例</button>' +
    '<button class="btn btn-primary" id="ob-start">开始对话 →</button>' +
    '</div></div>'
  );
  const finish = () => { S.onboarded = true; saveState(); };
  $('#ob-start').addEventListener('click', () => { finish(); closeModal(); switchView('chat'); });
  $('#ob-demo').addEventListener('click', () => { finish(); closeModal(); chooseDemoProfile(); });
  $('#ob-skip').addEventListener('click', () => { finish(); closeModal(); });
}

function addExperienceFlow() {
  S.chat.stage = 'exp_type';
  S.chat.quick = [['实习经历','实习经历'],['项目经历','项目经历'],['竞赛获奖','竞赛获奖'],['社团活动','社团活动']];
  S.chat.messages.push({ role: 'ai', text: '好的，想补充一段什么经历？可以告诉我类型，也可以直接描述你做过什么。' });
  saveState();
  switchView('chat');
}

function addSkillFlow() {
  openModal('<h3>添加技能</h3><p>用顿号或逗号分隔多个技能，例如：Vue3、TypeScript、Git。</p>' +
    '<input type="text" id="skill-input" placeholder="技能1、技能2、技能3">' +
    '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">取消</button><button class="btn btn-primary" id="skill-save">添加</button></div>');
  $('#skill-save').addEventListener('click', () => {
    const text = $('#skill-input').value.trim();
    if (!text) { toast('请输入技能', 'error'); return; }
    const items = text.split(/[、,，;；\s]+/).map(s => s.trim()).filter(Boolean);
    const techs = [];
    items.forEach(it => { if (!TECH_KEYWORDS.some(k => k.toLowerCase() === it.toLowerCase())) techs.push(it); });
    mergeSkills(S.resume, items);
    syncResumeToVersion();
    saveState();
    closeModal();
    renderExtract();
    renderGenerate();
    toast('已添加 ' + items.length + ' 项技能 ✅', 'success');
  });
}

/* ================= / 命令面板 ================= */
const COMMANDS = [
  { cmd: '/对话', desc: 'AI 对话引导', act: () => switchView('chat') },
  { cmd: '/生成', desc: '简历智能生成', act: () => switchView('generate') },
  { cmd: '/模板', desc: '模板与排版', act: () => switchView('template') },
  { cmd: '/诊断', desc: '简历诊断', act: () => switchView('diagnosis') },
  { cmd: '/岗位', desc: '岗位匹配分析', act: () => switchView('jd') },
  { cmd: '/导出', desc: '导出与投递', act: () => switchView('export') },
  { cmd: '/示例', desc: '选择示例简历', act: chooseDemoProfile },
  { cmd: '/主题', desc: '切换深浅色模式', act: () => toggleTheme() },
  { cmd: '/求职信', desc: '生成求职信', act: () => showCoverLetter($('#jd-text').value) },
  { cmd: '/面试', desc: '模拟面试问题', act: () => showInterviewQuestions($('#jd-text').value) }
];

function renderCommandPalette(filter) {
  const input = $('#chat-text');
  if (!input) return;
  let pal = $('#cmd-palette');
  const kw = (filter || '').slice(1).toLowerCase();
  const list = COMMANDS.filter(c => c.cmd.slice(1).toLowerCase().includes(kw));
  if (!filter || !filter.startsWith('/') || filter.includes(' ') || !list.length) {
    if (pal) pal.remove();
    return;
  }
  if (!pal) {
    pal = document.createElement('div');
    pal.id = 'cmd-palette';
    pal.className = 'cmd-palette';
    const row = input.closest('.chat-input-row');
    if (row) row.appendChild(pal);
  }
  pal.innerHTML = '<div class="cmd-head">命令面板</div>' + list.map(c =>
    '<button data-cmd="' + c.cmd + '"><code>' + c.cmd + '</code><small>' + c.desc + '</small></button>'
  ).join('');
  pal.querySelectorAll('button').forEach(b => b.addEventListener('mousedown', e => {
    e.preventDefault();
    const item = COMMANDS.find(c => c.cmd === b.dataset.cmd);
    const input2 = $('#chat-text'); if (input2) input2.value = '';
    hideCommandPalette();
    if (item) { item.act(); toast('已执行 ' + item.cmd); }
  }));
}

function hideCommandPalette() {
  const p = $('#cmd-palette');
  if (p) p.remove();
}

function executeCommand(text) {
  const t = (text || '').trim().toLowerCase();
  let item = COMMANDS.find(c => t === c.cmd.toLowerCase()) ||
             COMMANDS.find(c => t.startsWith(c.cmd.toLowerCase())) ||
             COMMANDS.find(c => t.startsWith('/') && c.cmd.toLowerCase().includes(t));
  if (item) { item.act(); toast('已执行 ' + item.cmd); return true; }
  toast('未找到命令：' + text, 'error');
  return false;
}

let chatBusy = false;
function sendChat() {
  const ta = $('#chat-text');
  const text = ta.value.trim();
  if (!text || chatBusy) return;
  if (text.startsWith('/')) {
    ta.value = '';
    hideCommandPalette();
    executeCommand(text);
    return;
  }
  ta.value = '';
  chatBusy = true;
  const { clean, flags } = sanitizeSensitive(text);
  Chat.pushUser(clean);
  renderMessages();
  const box = $('#chat-messages');
  const loading = document.createElement('div');
  loading.className = 'msg ai';
  loading.innerHTML = '<div class="msg-avatar">AI</div><div class="msg-body"><div class="msg-bubble loading"><span class="typing-dots"><i></i><i></i><i></i></span>&nbsp;正在思考…</div></div>';
  box.appendChild(loading);
  scrollChat();
  if (flags.length) {
    toast('检测到' + flags.join('、') + '：简历中不建议包含此类信息，已自动忽略', 'error');
  }
  const history = S.chat.messages.map(m => ({ role: m.role, content: m.text }));
  const finishReply = function (text) {
    if (text) {
      const aiMsgs = S.chat.messages.filter(m => m.role === 'ai');
      const lastAi = aiMsgs[aiMsgs.length - 1];
      if (lastAi) { lastAi.text = cleanAiText(text); lastAi.fromLLM = true; saveState(); }
    }
    loading.remove();
    renderMessages();
    renderQuick();
    updateChatProgress();
    renderExtract();
    updateGenerateBtn();
    chatBusy = false;
  };
  setTimeout(() => {
    Chat.process(clean, flags);
    if (window.AIRemote && AIRemote.ready()) {
      AIRemote.call('chat', history, null).then(finishReply).catch(function () { finishReply(null); });
    } else {
      finishReply(null);
    }
  }, 700 + Math.random() * 600);
}

function exportChat() {
  const lines = S.chat.messages.map(m => (m.role === 'ai' ? '🤖 AI' : '👤 我') + '：' + m.text);
  downloadBlob(new Blob(['\ufeff' + lines.join('\n\n')], { type: 'text/plain;charset=utf-8' }), '对话记录-' + todayStr() + '.txt');
  toast('对话记录已导出 ✅', 'success');
}

/* ---------- 模块2：生成 ---------- */
function renderGenerate() {
  ensureVersion();
  if (!S.generated) {
    showGenLoading();
    setTimeout(() => {
      generateResumeContent();
      renderGenerateNow();
      enhanceGenerateWithAI();
    }, 850);
    return;
  }
  renderGenerateNow();
  enhanceGenerateWithAI();
}

function renderGenerateNow() {
  if (window.Auth && Auth.track) Auth.track('generate');
  const genLoad = $('#gen-loading'); if (genLoad) genLoad.remove();
  const wrap = $('#resume-sheet');
  wrap.innerHTML = renderResumeHTML(S.resume, S.settings);
  wireSheetEditable(wrap);
  if (!(S.resume.experiences || []).length) {
    $('#gen-status').textContent = '暂无经历 · 点击「添加模块」→「添加经历」';
  } else {
    $('#gen-status').textContent = S.generated ? (S.jdText ? '已生成 · 已按 JD 定制 ✓' : '已生成 · 可点击编辑') : '生成中…';
  }
  renderSuggestions();
}

function showGenLoading() {
  if (window.FxEffects && FxEffects.burst) FxEffects.burst();
  const wrap = $('#resume-sheet');
  wrap.innerHTML =
    '<div class="gen-loading" id="gen-loading">' +
    '<div class="gen-loading-dots"><i></i><i></i><i></i></div>' +
    '<div class="gen-loading-title">正在组织语言…</div>' +
    '<div class="gen-loading-sub">将对话中的碎片信息整理为 STAR 专业表述</div>' +
    '<div class="gen-loading-steps"><span>基本信息 ✅</span><span>教育背景 ✅</span><span>经历挖掘 ✅</span><span class="doing">技能 / 意向 ⏳</span></div>' +
    '</div>';
  $('#gen-status').textContent = '生成中…';
}

function renderSuggestions(highlightPath) {
  const list = collectSuggestions();
  const box = $('#sugg-list');
  $('#sugg-count').textContent = list.length + ' 条';
  if (!list.length) {
    box.innerHTML = '<div class="empty-hint">暂无待处理建议，内容将随编辑实时更新</div>';
    return;
  }
  box.innerHTML = '';
  list.forEach(s => {
    const card = document.createElement('div');
    card.className = 'sugg-card';
    card.dataset.sid = s.id;
    const typeLabel = { optimize: '表述优化', missing: '缺失内容提醒', quantify: '量化补充' }[s.type] || '建议';
    card.innerHTML =
      '<span class="sugg-type ' + s.type + '">' + typeLabel + '</span>' +
      '<h4>' + esc(s.title) + '</h4>' +
      '<p>' + esc(s.desc) + '</p>' +
      (s.oldText ? '<div class="sugg-diff"><div class="old">' + esc(s.oldText) + '</div><div class="new">→ ' + esc(s.newText) + '</div></div>' : '') +
      '<div class="sugg-actions">' +
      '<button class="btn btn-primary btn-sm">' + (s.action === 'goto-chat' ? '前往补充' : '采纳') + '</button>' +
      '<button class="btn btn-ghost btn-sm">忽略</button></div>';
    card.querySelector('.btn-primary').addEventListener('click', () => applySuggestion(s));
    card.querySelector('.btn-ghost').addEventListener('click', () => { card.remove(); });
    box.appendChild(card);
  });
  if (highlightPath) {
    const el = $('#resume-sheet').querySelector('[data-path="' + highlightPath + '"]');
    if (el) { el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 2200); }
  }
}

/* 一键全部采纳：自动应用可落地的建议（优化表述/生成自我评价/提取技能） */
function applyAllSuggestions() {
  const list = collectSuggestions();
  const R = S.resume;
  let applied = 0, skipped = 0;
  list.forEach(s => {
    if (s.action === 'gen-summary') {
      R.summary = s.newText; applied++;
    } else if (s.action === 'gen-skills') {
      const all = (R.experiences || []).map(e => e.title + ' ' + e.desc + ' ' + (e.bullets || []).join(' ')).join(' ');
      const techs = extractTech(all);
      if (techs.length) { mergeSkills(R, techs); applied++; } else skipped++;
    } else if (s.action === 'optimize' && s.target) {
      const exp = R.experiences.find(e => e.id === s.target.expId);
      if (exp && exp.bullets[s.target.bulletIndex] != null) { exp.bullets[s.target.bulletIndex] = s.newText; applied++; }
    } else if (s.action === 'quantify') {
      skipped++;
    }
  });
  if (applied) {
    saveState(); renderGenerate();
    toast('已采纳 ' + applied + ' 条建议' + (skipped ? '，跳过 ' + skipped + ' 条需你填写真实数据' : '') + ' ✅', 'success');
  } else {
    toast(skipped ? '可自动采纳的建议已处理完，剩余需你补充真实信息' : '暂无可自动采纳的建议', 'error');
  }
}

function ignoreAllSuggestions() {
  const box = $('#sugg-list');
  if (box) box.innerHTML = '<div class="empty-hint">已忽略全部建议（编辑内容后建议会再次出现）</div>';
  const c = $('#sugg-count');
  if (c) c.textContent = '0 条';
  toast('已忽略全部建议', 'success');
}

function applySuggestion(s) {
  const R = S.resume;
  if (s.action === 'gen-summary') {
    R.summary = s.newText;
    saveState();
    renderGenerate();
    toast('自我评价已生成 ✅', 'success');
  } else if (s.action === 'gen-skills') {
    const all = (R.experiences || []).map(e => e.title + ' ' + e.desc + ' ' + (e.bullets || []).join(' ')).join(' ');
    const techs = extractTech(all);
    if (techs.length) { mergeSkills(R, techs); saveState(); renderGenerate(); toast('已从经历中提取 ' + techs.length + ' 项技能 ✅', 'success'); }
    else toast('暂时没有可提取的技能，请先补充经历', 'error');
  } else if (s.action === 'optimize' && s.target) {
    const exp = R.experiences.find(e => e.id === s.target.expId);
    if (exp && exp.bullets[s.target.bulletIndex] != null) {
      exp.bullets[s.target.bulletIndex] = s.newText;
      saveState();
      renderGenerate('exp.' + s.target.expId + '.bullets.' + s.target.bulletIndex);
      toast('已应用优化表述 ✅', 'success');
    }
  } else if (s.action === 'quantify' && s.target) {
    const path = 'exp.' + s.target.expId + '.bullets.' + s.target.bulletIndex;
    renderGenerate(path);
    const el = $('#resume-sheet').querySelector('[data-path="' + path + '"]');
    if (el) el.focus();
    const card = document.querySelector('.sugg-card[data-sid="' + s.id + '"]');
    if (card) card.remove();
    toast('请补充你的真实数据，例如「效率提升 30%」（我不会编造数字）');
  } else if (s.id === 's-exp') {
    S.chat.stage = 'exp_type';
    S.chat.quick = [['实习经历', '实习经历'], ['项目经历', '项目经历'], ['竞赛获奖', '竞赛获奖'], ['社团活动', '社团活动']];
    S.chat.messages.push({ role: 'ai', text: '好的，想补充一段什么经历？可以告诉我类型，也可以直接描述你做过什么。' });
    saveState();
    switchView('chat');
  } else if (s.action === 'open-jd') {
    switchView('jd');
    toast('已打开岗位匹配：请在真实经历中补充 JD 关键词');
  } else if (s.action === 'goto-chat') {
    switchView('chat');
    toast('请在对话中补充该信息');
  }
}
/* ================= DeepSeek 真实 AI 增强（失败自动静默降级） ================= */
let aiSuggestPending = false;
let aiSuggestDone = false;
let aiSummaryDone = false;
let diagAiPending = false;

/* 清理 AI 回复中的 Markdown 星号（**加粗** / * 列表），界面显示不再出现 * */
function cleanAiText(text) {
  return String(text || '')
    .replace(/\*\*/g, '')
    .replace(/^\s*\*\s?/gm, '')
    .replace(/\*+/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* 发送给 AI 的简历摘要：不含手机号/邮箱等隐私字段 */
function resumeBriefForAI() {
  const R = S.resume;
  const E = R.education || {}, I = R.intention || {};
  const lines = [];
  lines.push('姓名：' + (R.name || '未填'));
  lines.push('教育：' + ([E.school, E.major, E.degree, E.gradDate].filter(Boolean).join(' / ') || '未填'));
  (R.experiences || []).forEach(e => {
    lines.push('经历：' + [e.title, e.role, e.start, e.end].filter(Boolean).join(' / '));
    const bs = (e.bullets && e.bullets.length) ? e.bullets : [e.desc];
    bs.forEach(b => lines.push('  - ' + b));
  });
  lines.push('技能：' + (flatSkills(R).join('、') || '未填'));
  lines.push('自我评价：' + (R.summary || '未填'));
  lines.push('求职意向：' + [I.position, I.city, I.salary].filter(Boolean).join(' / '));
  return lines.join('\n');
}

function removeEl(id) {
  const el = document.getElementById(id);
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

function addAiPanel(id, title, placeholder, afterSelector) {
  const ref = document.querySelector(afterSelector);
  if (!ref) return null;
  const box = document.createElement('div');
  box.id = id;
  box.className = 'panel';
  box.innerHTML = '<div class="side-head"><h3>' + esc(title) + '</h3><span class="badge-soft">分析中…</span></div><p class="muted" id="' + id + '-text">' + esc(placeholder) + '</p>';
  ref.insertAdjacentElement('afterend', box);
  return box;
}

function setAiPanelDone(box, text, label) {
  if (!box) return;
  if (!text) { if (box.parentNode) box.parentNode.removeChild(box); return; }
  const t = document.getElementById(box.id + '-text');
  if (t) t.textContent = cleanAiText(text);
  const b = box.querySelector('.badge-soft');
  if (b) b.textContent = label || 'DeepSeek';
}

/* 生成页：AI 优化建议 + 自我评价润色（每个会话只调一次，避免编辑时反复请求） */
function enhanceGenerateWithAI() {
  if (!window.AIRemote || !AIRemote.ready() || aiSuggestPending || aiSuggestDone) return;
  aiSuggestPending = true;
  const brief = resumeBriefForAI();
  const box = addAiPanel('ai-advice-box', 'AI 优化建议（DeepSeek）', '正在调用 DeepSeek 分析你的简历…', '#sugg-list');
  AIRemote.call('suggest', [{ role: 'user', content: '以下是我的简历信息（不含联系方式）：\n' + brief + '\n\n请给出 3-5 条具体、可执行的简历优化建议，直接输出建议正文，不要寒暄。' }], null)
    .then(function (text) {
      aiSuggestPending = false;
      aiSuggestDone = true;
      if (text) setAiPanelDone(box, text, 'DeepSeek');
      else removeEl('ai-advice-box');
      polishSummaryWithAI(brief);
    })
    .catch(function () {
      aiSuggestPending = false;
      aiSuggestDone = true;
      removeEl('ai-advice-box');
    });
}

function polishSummaryWithAI(brief) {
  if (aiSummaryDone) return;
  aiSummaryDone = true;
  AIRemote.call('generate', [{ role: 'user', content: '基于以下简历内容，重写一段更专业、更有说服力的“自我评价”（150 字以内）。只输出 JSON，格式：{"summary":"..."}，不要输出其他内容。\n\n' + brief }], null)
    .then(function (text) {
      if (!text) return;
      let summary = '';
      try {
        const m = text.match(/\{[\s\S]*\}/);
        summary = String((m ? JSON.parse(m[0]) : JSON.parse(text)).summary || '').trim();
      } catch (e) { summary = ''; }
      if (!summary) return;
      const cur = String(S.resume.summary || '').trim();
      if (!cur || cur !== summary) {
        addAiSuggestionCard({
          id: 'ai-summary',
          title: 'AI 润色：自我评价',
          desc: 'DeepSeek 根据你的经历生成的自我评价（请核对是否真实准确后再采纳）。',
          oldText: cur || '（当前无自我评价）',
          newText: summary
        });
      }
    })
    .catch(function () { /* 静默降级 */ });
}

function addAiSuggestionCard(item) {
  const box = $('#sugg-list');
  if (!box || !item || !item.newText) return;
  item.newText = cleanAiText(item.newText);
  if (item.oldText) item.oldText = cleanAiText(item.oldText);
  const card = document.createElement('div');
  card.className = 'sugg-card';
  card.dataset.sid = item.id;
  card.innerHTML =
    '<span class="sugg-type optimize">AI 润色</span>' +
    '<h4>' + esc(item.title) + '</h4>' +
    '<p>' + esc(item.desc) + '</p>' +
    '<div class="sugg-diff"><div class="old">' + esc(item.oldText || '') + '</div><div class="new">→ ' + esc(item.newText) + '</div></div>' +
    '<div class="sugg-actions"><button class="btn btn-primary btn-sm">采纳</button><button class="btn btn-ghost btn-sm">忽略</button></div>';
  card.querySelector('.btn-primary').addEventListener('click', function () {
    S.resume.summary = item.newText;
    if (window.syncResumeToVersion) syncResumeToVersion();
    saveState();
    card.remove();
    renderGenerate();
    toast('已采纳 AI 润色的自我评价 ✅', 'success');
  });
  card.querySelector('.btn-ghost').addEventListener('click', function () { card.remove(); });
  box.appendChild(card);
}

/* ============================================================
 * ui.js — Part 2：模板、诊断、JD、导出、示例/重置
 * ============================================================ */

/* ---------- 模块3：模板 ---------- */
function previewTplFull() {
  openModal('<h3>模板全屏预览</h3><div class="tpl-full">' + renderResumeHTML(S.resume, S.settings) + '</div><div class="modal-actions"><button class="btn btn-primary" onclick="closeModal()">关闭</button></div>', true);
}

function renderTemplate() {
  renderTplGrid();
  renderTplSettings();
  renderTplSheet();
}

function renderTplSheet() {
  const wrap = $('#tpl-sheet');
  wrap.innerHTML = renderResumeHTML(S.resume, S.settings);
  wireSheetEditable(wrap);
  const sheet = wrap.querySelector('.sheet');
  const over = sheet && sheet.scrollHeight > sheet.clientHeight + 8;
  $('#page-fit-tip').textContent = over ? '⚠ 内容超过一页，建议精简' : '单页 A4 ✅';
}

function renderTplSettings() {
  const st = S.settings;
  const dots = $('#color-dots');
  dots.innerHTML = '';
  COLORS.forEach(c => {
    const b = document.createElement('button');
    b.className = 'color-dot' + (st.color === c ? ' active' : '');
    b.style.background = c;
    b.title = c;
    b.addEventListener('click', () => { st.color = c; saveState(); renderTemplate(); });
    dots.appendChild(b);
  });
  $$('#font-size-seg button').forEach(b => b.classList.toggle('active', b.dataset.v === st.fontSize));
  $$('#font-family-seg button').forEach(b => b.classList.toggle('active', b.dataset.v === st.fontFamily));
  $('#line-height-slider').value = st.lineHeight;
  $('#line-height-val').textContent = st.lineHeight.toFixed(1);
  $('#photo-toggle').checked = !!st.showPhoto;
  const tools = $('#photo-tools');
  if (tools) {
    if (S.resume.photoUrl) {
      tools.innerHTML = '<img class="photo-thumb" src="' + esc(S.resume.photoUrl) + '" alt="头像">' +
        '<button class="btn btn-ghost btn-sm" id="btn-change-photo">更换</button>' +
        '<button class="btn btn-ghost btn-sm" id="btn-remove-photo">移除</button>';
      $('#btn-change-photo').addEventListener('click', openPhotoUpload);
      $('#btn-remove-photo').addEventListener('click', removePhoto);
    } else if (st.showPhoto) {
      tools.innerHTML = '<button class="btn btn-ghost btn-sm" id="btn-upload-photo">上传头像</button>';
      $('#btn-upload-photo').addEventListener('click', openPhotoUpload);
    } else {
      tools.innerHTML = '';
    }
  }
}

/* 根据求职意向推荐模板（PRD：投递互联网技术岗推荐 ATS，设计岗推荐创意，科研岗推荐学术） */
function recommendedTplId() {
  const pos = S.resume.intention.position || '';
  if (/设计|UI|视觉|新媒体|创意|插画/.test(pos)) return 'fresh';
  if (/学术|科研|研究|考研|论文|实验室/.test(pos)) return 'academic';
  if (/前端|后端|开发|算法|测试|运维|数据|工程师/.test(pos)) return 'modern';
  if (/产品|运营|市场|销售/.test(pos)) return 'duo';
  if (/行政|文员|人事|助理|财务|会计|客服|前台|管理/.test(pos)) return 'minimal';
  return '';
}

function recordRecentTpl(id) {
  const list = (S.settings.recentTemplates || []).filter(x => x !== id);
  list.unshift(id);
  S.settings.recentTemplates = list.slice(0, 3);
}

function renderTplGrid() {
  const grid = $('#tpl-grid');
  grid.innerHTML = '';
  /* 最近使用模板快捷行 */
  const recs = (S.settings.recentTemplates || []).filter(id => id !== S.settings.template);
  if (recs.length) {
    const row = document.createElement('div');
    row.className = 'tpl-recent';
    row.innerHTML = '<span class="tpl-recent-label">最近使用</span>' + recs.map(id => {
      const rt = TEMPLATES.find(x => x.id === id);
      return rt ? '<button class="btn btn-ghost btn-sm" data-tpl="' + rt.id + '">' + esc(rt.name) + '</button>' : '';
    }).join('');
    row.querySelectorAll('[data-tpl]').forEach(b => b.addEventListener('click', () => {
      S.settings.template = b.dataset.tpl;
      recordRecentTpl(b.dataset.tpl);
      saveState(); renderTemplate();
      const rt2 = TEMPLATES.find(x => x.id === b.dataset.tpl);
      if (rt2) toast('已切换模板：' + rt2.name);
    }));
    grid.appendChild(row);
  }
  const rec = recommendedTplId();
  TEMPLATES.forEach(t => {
    const card = document.createElement('button');
    card.className = 'tpl-card' + (S.settings.template === t.id ? ' active' : '');
    card.style.setProperty('--tpl-accent', t.accent);
    const catCls = { '创意': 'creative', '学术': 'academic' }[t.cat] || 'ats';
    const thumb = t.id === 'duo'
      ? '<div class="tpl-thumb duo"><i class="t-title"></i><span class="t-cols"><i class="t-side"></i><span class="t-main"><i></i><i></i><i></i></span></span></div>'
      : (t.id === 'gradient')
        ? '<div class="tpl-thumb gradient"><i class="t-title"></i><i></i><i></i><i></i><i></i></div>'
        : (t.id === 'neon')
          ? '<div class="tpl-thumb neon"><i class="t-title"></i><i></i><i></i><i></i><i></i></div>'
          : (t.cat === '学术')
        ? '<div class="tpl-thumb academic"><i class="t-title center"></i><i></i><i></i><i></i><i></i></div>'
        : '<div class="tpl-thumb ' + catCls + '"><i class="t-title"></i><i></i><i></i><i></i><i></i></div>';
    card.innerHTML =
      thumb +
      '<div class="tpl-card-meta"><span class="tpl-card-name">' + t.name + '</span><span class="tpl-cat">' + t.cat + '</span></div>' +
      (rec === t.id ? '<span class="tpl-ai">AI 推荐</span>' : '');
    card.title = t.desc;
    card.addEventListener('click', () => {
      const prev = TEMPLATES.find(x => x.id === S.settings.template);
      S.settings.template = t.id;
      recordRecentTpl(t.id);
      saveState();
      renderTemplate();
      if (prev && (prev.id === 'duo') !== (t.id === 'duo')) {
        toast('模板结构已调整：部分模块位置发生变化（单栏 ↔ 双栏）');
      } else {
        toast('已切换模板：' + t.name);
      }
    });
    grid.appendChild(card);
  });
}

/* ---------- ATS 解析预览（模块4 入口） ---------- */
function showAtsPreview() {
  const r = atsParse(S.resume);
  openModal('<h3>ATS 解析预览</h3><p>模拟 ATS（申请者追踪系统）读取简历后的纯文本视图，检查关键词与格式兼容性。</p>' +
    '<div class="ats-wrap">' +
    '<div class="ats-warnings">' + r.warnings.map(w =>
      '<div class="ats-warn ' + w.level + '">' + ({ ok: '✅', high: '🔴', medium: '🟡', low: 'ℹ️', info: 'ℹ️' }[w.level] || '•') + ' ' + esc(w.text) + '</div>'
    ).join('') + '</div>' +
    '<textarea readonly class="ats-text" rows="16">' + esc(r.text) + '</textarea>' +
    '</div>' +
    '<div class="modal-actions"><button class="btn btn-ghost" id="copy-ats">复制纯文本</button><button class="btn btn-primary" onclick="closeModal()">知道了</button></div>');
  $('#copy-ats').addEventListener('click', () => {
    navigator.clipboard.writeText(r.text).then(() => toast('ATS 纯文本已复制 📋', 'success'));
  });
}

/* ---------- 求职信 + 模拟面试 ---------- */
function showJobEmail(jdText) {
  const g = generateJobEmail(S.resume, jdText);
  openModal('<h3>' + icon('mail') + '求职邮件</h3><p>主题与正文已按你的简历和岗位 JD 自动生成（内容来自你的真实信息，不会虚构经历），可直接编辑后复制发送。</p>' +
    '<div class="form-group"><label class="form-label">邮件主题</label><input class="form-input" id="email-subject" value="' + esc(g.subject) + '"></div>' +
    '<label class="form-label">邮件正文</label><textarea class="report-preview" id="email-body" rows="14">' + esc(g.body) + '</textarea>' +
    '<div class="modal-actions"><button class="btn btn-ghost" id="copy-email">复制</button><button class="btn btn-ghost" id="dl-email">下载 .txt</button><button class="btn btn-primary" onclick="closeModal()">完成</button></div>');
  const emailText = () => '主题：' + $('#email-subject').value + '\n\n' + $('#email-body').value;
  $('#copy-email').addEventListener('click', () => {
    navigator.clipboard.writeText(emailText()).then(() => toast('求职邮件已复制 📋', 'success')).catch(() => toast('复制失败，请手动复制', 'error'));
  });
  $('#dl-email').addEventListener('click', () => {
    downloadBlob(new Blob([emailText()], { type: 'text/plain;charset=utf-8' }), '求职邮件-' + (S.resume.name || '我') + '.txt');
    toast('求职邮件已导出 ✅', 'success');
    if (window.Store && Store.bumpStat) Store.bumpStat('exports');
  });
}

function showCoverLetter(jdText) {
  const text = generateCoverLetter(S.resume, jdText);
  openModal('<h3>' + icon('mail') + '求职信</h3><p>基于你的简历与岗位 JD 自动生成（内容来自你的真实信息，不会虚构经历），可直接编辑后复制或下载。</p>' +
    '<textarea class="report-preview" id="letter-text" rows="16">' + esc(text) + '</textarea>' +
    '<div class="modal-actions"><button class="btn btn-ghost" id="copy-letter">复制</button><button class="btn btn-ghost" id="dl-letter">下载 .txt</button><button class="btn btn-primary" onclick="closeModal()">完成</button></div>');
  $('#copy-letter').addEventListener('click', () => navigator.clipboard.writeText($('#letter-text').value).then(() => toast('求职信已复制 📋', 'success')));
  $('#dl-letter').addEventListener('click', () => downloadBlob(new Blob([$('#letter-text').value], { type: 'text/plain;charset=utf-8' }), '求职信-' + (S.resume.name || '我') + '.txt'));
  if (window.AIRemote && AIRemote.ready()) {
    AIRemote.call('generate', [{ role: 'user', content: '请根据我的简历和岗位 JD 写一封求职信：语气真诚专业，不虚构经历与数字，400 字以内，直接输出求职信正文。\n\n简历：\n' + resumeBriefForAI() + (jdText ? '\n\nJD：\n' + jdText : '') }], null)
      .then(function (t) {
        if (!t) return;
        const ta = $('#letter-text');
        if (ta) { ta.value = cleanAiText(t); toast('已生成 DeepSeek 版求职信 ✨', 'success'); }
      })
      .catch(function () { /* 静默降级 */ });
  }
}

function showInterviewQuestions(jdText) {
  const qs = generateInterviewQuestions(S.resume, jdText);
  openModal('<h3>' + icon('mic') + '模拟面试问题</h3><p>根据你的简历与目标岗位生成，面试前练一练吧。</p>' +
    '<div class="iq-list">' +
    qs.map((x, i) => '<div class="iq-item"><b>' + (i + 1) + '. ' + esc(x.q) + '</b><small>' + icon('lightbulb') + ' ' + esc(x.tip) + '</small></div>').join('') +
    '</div>' +
    '<div class="modal-actions"><button class="btn btn-ghost" id="iq-copy">复制题目</button><button class="btn btn-primary" onclick="closeModal()">知道了</button></div>');
  $('#iq-copy').addEventListener('click', () => {
    const text = qs.map((x, i) => (i + 1) + '. ' + x.q + '\n   提示：' + x.tip).join('\n\n');
    navigator.clipboard.writeText(text).then(() => toast('面试题目已复制 📋', 'success'));
  });
}

/* ---------- 在线简历分享预览 ---------- */
function makeReadonly(container) {
  container.querySelectorAll('[contenteditable="true"]').forEach(el => el.removeAttribute('contenteditable'));
}

function previewOnlineResume() {
  const v = currentVersion();
  if (v) { v.urlPassword = ''; saveState(); }
  openModal(
    '<div class="share-head"><div><b>' + icon('link') + '在线简历（本地预览）</b><small>演示功能 · 链接不可公开访问</small></div>' +
    '<button class="btn btn-ghost btn-sm" onclick="closeModal()">关闭</button></div>' +
    '<div class="share-body"><div id="share-sheet"></div></div>',
    true
  );
  const sheet = $('#share-sheet');
  sheet.innerHTML = renderResumeHTML(S.resume, S.settings);
  makeReadonly(sheet);
  sheet.querySelectorAll('.sheet').forEach(el => el.classList.add('sheet-readonly'));
}

/* ---------- 模块4：诊断 ---------- */
let diagScanned = false;
/* 文字与格式体检（contentCheck 规则引擎，纯本地） */
function renderTextCheck() {
  const list = $('#text-check-list');
  if (!list) return;
  const c = contentCheck(S.resume);
  const countEl = $('#text-check-count');
  if (countEl) countEl.textContent = c.issues.length + ' 项';
  list.innerHTML = '';
  if (c.issues.length === 0) {
    list.innerHTML = emptyState('check', '文字与格式很干净 🎉', '未发现明显问题：联系方式、日期、标点、表达都正常，继续保持。');
    return;
  }
  const lvLabel = { high: '高', medium: '中', low: '低' };
  c.issues.forEach((it, idx) => {
    const card = document.createElement('div');
    card.className = 'issue-card ' + it.level;
    card.dataset.issue = 'tc-' + idx;
    let actions = '';
    if (it.fix === 'normalize-dates') actions = '<button class="btn btn-primary btn-sm fix-btn">统一日期</button>';
    card.style.animationDelay = (idx * 60) + 'ms';
    card.innerHTML =
      '<div class="issue-head">' +
      '<span class="issue-lv ' + it.level + '">' + lvLabel[it.level] + '</span>' +
      '<span class="issue-title">' + esc(it.title) + '</span>' +
      '<span class="issue-arrow">▾</span></div>' +
      '<div class="issue-desc">' + esc(it.desc) + '</div>' +
      (it.detail ? '<div class="issue-detail"><div class="old" style="color:var(--danger);text-decoration:line-through">' + esc(it.detail.old || '') + '</div><div style="color:var(--ok);font-weight:600">' + esc(it.detail.new || '') + '</div></div>' : '') +
      '<div class="issue-actions">' + actions + '</div>';
    card.querySelector('.issue-head').addEventListener('click', () => card.classList.toggle('open'));
    const fix = card.querySelector('.fix-btn');
    if (fix) fix.addEventListener('click', e => { e.stopPropagation(); applyTextCheckFix(it, card); });
    list.appendChild(card);
  });
}

function applyTextCheckFix(issue, card) {
  if (issue.fix === 'normalize-dates') {
    (S.resume.experiences || []).forEach(e => {
      if (e.start) e.start = normalizeDate(e.start);
      if (e.end) e.end = normalizeDate(e.end);
    });
    if (S.resume.education && S.resume.education.gradDate) S.resume.education.gradDate = normalizeDate(S.resume.education.gradDate);
    syncResumeToVersion(); saveState();
    markFixed(card);
    toast('日期已统一为 YYYY.MM 格式 ✅', 'success');
    setTimeout(renderTextCheck, 400);
  }
}

function renderDiagnosis() {
  if (!diagScanned) {
    diagScanned = true;
    showDiagScan();
    return;
  }
  renderDiagnosisNow();
}

function showDiagScan() {
  diagAiPending = false;
  removeEl('ai-diag-box');
  $('#diag-total').innerHTML = '<span style="font-size:24px;color:var(--muted)">扫描中…</span>';
  $('#diag-percentile').textContent = '';
  const svg = $('#radar-svg');
  if (svg) svg.style.display = 'none';
  const wrap = document.querySelector('.radar-wrap');
  const oldScan = $('#diag-scan'); if (oldScan) oldScan.remove();
  wrap.insertAdjacentHTML('beforeend',
    '<div class="diag-scan" id="diag-scan">' +
    '<div class="scan-title">正在扫描简历</div>' +
    '<div class="scan-bar"><i id="scan-fill"></i></div>' +
    '<div class="scan-pct" id="scan-pct">0%</div>' +
    '<div class="scan-steps" id="scan-steps">内容完整性 → 表述专业度 → 量化程度</div>' +
    '</div>');
  $('#issue-list').innerHTML = '<div class="empty-state panel">正在分析六大维度…</div>';
  $('#issue-count').textContent = '…';
  $('#radar-legend').innerHTML = '';
  const steps = ['内容完整性','表述专业度','量化程度','ATS 兼容性','岗位匹配度','排版规范度'];
  let p = 0, si = 0;
  const iv = setInterval(() => {
    p += 8; // 固定步长：约 1.2s 完成扫描
    if (p >= 100) {
      p = 100;
      clearInterval(iv);
      const fillEnd = $('#scan-fill'); if (fillEnd) fillEnd.style.width = '100%';
      const pctEnd = $('#scan-pct'); if (pctEnd) pctEnd.textContent = '100%';
      setTimeout(renderDiagnosisNow, 220);
      return;
    }
    const fill = $('#scan-fill'); if (fill) fill.style.width = p + '%';
    const pct = $('#scan-pct'); if (pct) pct.textContent = Math.round(p) + '%';
    si = Math.min(steps.length - 1, Math.floor(p / 18));
    const ss = $('#scan-steps'); if (ss) ss.textContent = '正在分析：' + steps[si];
  }, 90);
}

function animateNumber(el, to, duration, suffix) {
  if (!el) return;
  const start = performance.now();
  const dur = duration || 700;
  function step(now) {
    const f = Math.min(1, (now - start) / dur);
    const ease = 1 - Math.pow(1 - f, 3);
    el.textContent = Math.round(0 + (to - 0) * ease) + (suffix || '');
    if (f < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function renderDiagnosisNow() {
  renderTextCheck();
  if (window.Store && Store.bumpStat) Store.bumpStat('diagnoses');
  if (window.Auth && Auth.track) Auth.track('diagnose');
  const scanEl = $('#diag-scan'); if (scanEl) scanEl.remove();
  const svgEl = $('#radar-svg'); if (svgEl) svgEl.style.display = '';
  const d = diagnoseResume();
  renderRadar(d);
  const dt = $('#diag-total'); if (dt) dt.classList.remove('empty');
  $('#diag-total').innerHTML = '<span id="total-num">0</span><small> / 100</small>';
  animateNumber(document.getElementById('total-num'), d.total, 850);
  const percentile = Math.max(3, Math.min(99, Math.round(46 + (d.total - 50) * 1.15)));
  $('#diag-percentile').textContent = '超过 ' + percentile + '% 的同龄求职者';
  $('#issue-count').textContent = d.issues.length + ' 项';
  const list = $('#issue-list');
  list.innerHTML = '';
  d.issues.forEach((it, idx) => {
    const card = document.createElement('div');
    card.className = 'issue-card ' + it.level;
    card.dataset.issue = idx;
    const lvLabel = { high: '高', medium: '中', low: '低' }[it.level];
    let actions = '';
    if (it.action !== 'none') {
      actions = '<button class="btn btn-primary btn-sm fix-btn">一键修复</button>';
    }
    card.style.animationDelay = (idx * 70) + 'ms';
    card.innerHTML =
      '<div class="issue-head">' +
      '<span class="issue-lv ' + it.level + '">' + lvLabel + '</span>' +
      '<span class="issue-title">' + esc(it.title) + '</span>' +
      '<span class="issue-arrow">▾</span></div>' +
      '<div class="issue-desc">' + esc(it.desc) + '</div>' +
      (it.detail ? '<div class="issue-detail"><div class="old" style="color:var(--danger);text-decoration:line-through">' + esc(it.detail.old || '') + '</div><div style="color:var(--ok);font-weight:600">' + esc(it.detail.new || '') + '</div></div>' : '') +
      '<div class="issue-actions">' + actions + '</div>';
    card.querySelector('.issue-head').addEventListener('click', () => card.classList.toggle('open'));
    const fix = card.querySelector('.fix-btn');
    if (fix) fix.addEventListener('click', e => { e.stopPropagation(); applyDiagnosisFix(it, card); });
    list.appendChild(card);
  });

  /* AI 深度诊断（DeepSeek，失败静默降级） */
  if (window.AIRemote && AIRemote.ready() && !diagAiPending) {
    diagAiPending = true;
    const aiBox = addAiPanel('ai-diag-box', 'AI 深度诊断（DeepSeek）', '正在调用 DeepSeek 进行深度诊断…', '#issue-list');
    AIRemote.call('diagnose', [{ role: 'user', content: '请对我的简历做六维深度诊断（内容完整性/表述专业度/量化程度/ATS兼容性/岗位匹配度/排版规范度），给出总分、主要问题与 3-5 条优先改进建议。\n\n简历信息：\n' + resumeBriefForAI() }], null)
      .then(function (text) { setAiPanelDone(aiBox, text, 'DeepSeek'); })
      .catch(function () { removeEl('ai-diag-box'); });
  }

  /* 空简历 CTA */
  if (!S.resume.name) {
    $('#issue-list').innerHTML = emptyState('file', '还没有简历内容', '先去对话引导填写信息，或载入示例体验完整流程。',
      '<button class="btn btn-primary btn-sm" id="diag-cta-chat">开始对话</button>' +
      '<button class="btn btn-ghost btn-sm" id="diag-cta-demo">载入示例</button>');
    const b1 = $('#diag-cta-chat'); if (b1) b1.addEventListener('click', () => switchView('chat'));
    const b2 = $('#diag-cta-demo'); if (b2) b2.addEventListener('click', chooseDemoProfile);
    $('#issue-count').textContent = '0 项';
  }
}

function applyDiagnosisFix(issue, card) {
  const R = S.resume;
  if (issue.action === 'goto-chat') {
    switchView('chat');
    toast('请在对话中补充该信息');
  } else if (issue.action === 'gen-summary' && issue.detail) {
    R.summary = issue.detail.new;
    syncResumeToVersion(); saveState();
    markFixed(card);
    toast('自我评价已重新生成 ✅', 'success');
    setTimeout(renderDiagnosisNow, 900); // 修复后实时更新左侧评分
  } else if (issue.action === 'gen-skills') {
    const all = (R.experiences || []).map(e => e.title + ' ' + e.desc + ' ' + (e.bullets || []).join(' ')).join(' ');
    const techs = extractTech(all);
    if (techs.length) {
      mergeSkills(R, techs);
      syncResumeToVersion(); saveState();
      markFixed(card);
      toast('已从经历中提取 ' + techs.length + ' 项技能 ✅', 'success');
      setTimeout(renderDiagnosisNow, 900);
    } else toast('暂无技能可提取，请先补充经历', 'error');
  } else if (issue.action === 'open-edit') {
    const firstPlain = (R.experiences || []).map(e => e.bullets || []).flat().find(b => b && !hasQuantData(b));
    if (firstPlain != null) {
      const ei = R.experiences.findIndex(e => (e.bullets || []).includes(firstPlain));
      const bi = R.experiences[ei].bullets.indexOf(firstPlain);
      switchView('generate');
      setTimeout(() => {
        const path = 'exp.' + R.experiences[ei].id + '.bullets.' + bi;
        const el = $('#resume-sheet').querySelector('[data-path="' + path + '"]');
        if (el) { el.classList.add('flash'); el.focus(); }
        toast('请补充真实数据，例如「效率提升 30%」');
      }, 350);
    } else {
      switchView('chat');
      toast('请先在对话中补充一段有内容的经历');
    }
  }
}

function markFixed(card) {
  card.classList.add('fixed');
  const fix = card.querySelector('.fix-btn');
  if (fix) { fix.textContent = '已修复 ✓'; fix.disabled = true; fix.className = 'btn btn-ghost btn-sm'; }
  setTimeout(() => { if (card.parentNode) card.parentNode.removeChild(card); }, 1200);
}

function renderRadar(d) {
  const svg = $('#radar-svg');
  const W = 320, H = 280, cx = 160, cy = 132, R = 86;
  const n = d.dims.length;
  const pt = (i, r) => {
    const ang = -Math.PI / 2 + i * 2 * Math.PI / n;
    return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
  };
  const target = d.dims.map((dim, i) => pt(i, R * (d.scores[dim.key] / 100)));
  const base = d.dims.map((dim, i) => pt(i, 0));

  /* 空态：六维全 0 时保留网格 + 半透明填充 + 中心弱化文字（D5/Dg1） */
  const allZero = d.dims.every(dim => !d.scores[dim.key]);
  if (allZero) {
    let ehtml = '<circle class="radar-halo" cx="' + cx + '" cy="' + cy + '" r="' + (R + 18) + '"/>';
    [0.25, 0.5, 0.75, 1].forEach(f => {
      const pts = d.dims.map((_, i) => pt(i, R * f).join(',')).join(' ');
      ehtml += '<polygon class="radar-grid" points="' + pts + '"/>';
    });
    d.dims.forEach((_, i) => {
      const [x, y] = pt(i, R);
      ehtml += '<line class="radar-axis" x1="' + cx + '" y1="' + cy + '" x2="' + x + '" y2="' + y + '"/>';
    });
    d.dims.forEach((dim, i) => {
      const [lx, ly] = pt(i, R + 26);
      ehtml += '<text class="radar-label" x="' + lx + '" y="' + ly + '" text-anchor="middle">' + dim.name + '</text>';
    });
    ehtml += '<polygon class="radar-data" points="' + base.map(p => p.join(',')).join(' ') + '"/>';
    ehtml += '<text class="radar-label radar-empty-label" x="' + cx + '" y="' + cy + 5 + '" text-anchor="middle">未评估</text>';
    svg.innerHTML = ehtml;
    $('#radar-legend').innerHTML = d.dims.map(dim => '<div><span>' + dim.name + '</span><b>--</b></div>').join('');
    return;
  }

  /* 背景光晕 + 网格 + 轴线 + 标签（全部走 CSS 变量，适配深浅色） */
  let html = '<circle class="radar-halo" cx="' + cx + '" cy="' + cy + '" r="' + (R + 18) + '"/>';
  [0.25, 0.5, 0.75, 1].forEach(f => {
    const pts = d.dims.map((_, i) => pt(i, R * f).join(',')).join(' ');
    html += '<polygon class="radar-grid" points="' + pts + '"/>';
  });
  d.dims.forEach((_, i) => {
    const [x, y] = pt(i, R);
    html += '<line class="radar-axis" x1="' + cx + '" y1="' + cy + '" x2="' + x + '" y2="' + y + '"/>';
  });
  d.dims.forEach((dim, i) => {
    const [lx, ly] = pt(i, R + 26);
    html += '<text class="radar-label" x="' + lx + '" y="' + ly + '" text-anchor="middle" font-size="10.5">' + dim.name + '</text>';
  });
  html += '<polygon class="radar-data" id="radar-data" points="' + base.map(p => p.join(',')).join(' ') + '"/>';
  html += d.dims.map((dim, i) => '<circle class="radar-dot" data-i="' + i + '" cx="' + base[i][0] + '" cy="' + base[i][1] + '" r="0"/>').join('');
  svg.innerHTML = html;

  /* 图例先归零，雷达绘制完成后逐个滚动 */
  $('#radar-legend').innerHTML = d.dims.map(dim =>
    '<div><span>' + dim.name + '</span><b>0</b></div>'
  ).join('');
  const legendNums = Array.from(document.querySelectorAll('#radar-legend b'));

  /* 精致动画：rAF + 三次缓出 + 顶点圆点逐个弹出（带回弹）+ 图例数字滚动 */
  const dataPoly = document.getElementById('radar-data');
  const dots = Array.from(svg.querySelectorAll('.radar-dot'));
  const DUR = 1000;
  const t0 = performance.now();
  const easeOutCubic = x => 1 - Math.pow(1 - x, 3);
  const easeOutBack = x => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };

  function frame(now) {
    const t = Math.min(1, (now - t0) / DUR);
    const e = easeOutCubic(t);
    if (dataPoly) {
      const pts = target.map((p, i) => [
        base[i][0] + (p[0] - base[i][0]) * e,
        base[i][1] + (p[1] - base[i][1]) * e
      ].join(',')).join(' ');
      dataPoly.setAttribute('points', pts);
    }
    dots.forEach((c, i) => {
      const appear = Math.min(1, Math.max(0, (t - i / n) * 2.6));
      c.setAttribute('cx', target[i][0].toFixed(1));
      c.setAttribute('cy', target[i][1].toFixed(1));
      c.setAttribute('r', appear > 0 ? (3.6 * easeOutBack(appear)).toFixed(2) : '0');
    });
    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      d.dims.forEach((dim, i) => {
        setTimeout(() => { if (legendNums[i]) animateNumber(legendNums[i], d.scores[dim.key], 500); }, 120 + i * 80);
      });
    }
  }
  requestAnimationFrame(frame);
}

/* ---------- 模块5：JD ---------- */
function renderJd() {
  /* 对话阶段收集的 JD 自动填入 */
  const ta = $('#jd-text');
  if (ta && !ta.value && S.jdText) ta.value = S.jdText;
  const hint = $('#jd-from-chat');
  if (hint) hint.hidden = !S.jdText;
  const hist = $('#jd-history');
  if (S.jdAnalyses.length) {
    hist.hidden = false;
    $('#jd-history-list').innerHTML = S.jdAnalyses.map(a =>
      '<div class="jd-history-item"><span style="word-break:break-all;flex:1">' + esc(a.jdText.slice(0, 26)) + (a.jdText.length > 26 ? '…' : '') + '</span><span class="pct">' + a.result.overall + '%</span><button class="btn btn-ghost btn-sm" data-hist="' + a.id + '">查看</button><button class="jd-del" data-hist="' + a.id + '" title="删除该分析">×</button></div>'
    ).join('');
    $$('#jd-history-list [data-hist]').forEach(b => b.addEventListener('click', () => renderJdResult(S.jdAnalyses.find(x => x.id === b.dataset.hist).result)));
    $$('#jd-history-list .jd-del').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      S.jdAnalyses = S.jdAnalyses.filter(x => x.id !== b.dataset.hist);
      saveState();
      renderJd();
      renderJdResult(null);
      toast('该分析已删除');
    }));
  } else {
    hist.hidden = true;
  }
}

function renderJdCompare() {
  if (S.jdAnalyses.length < 2) { toast('至少需要 2 条历史分析才能对比', 'error'); return; }
  const list = S.jdAnalyses.slice(0, 6);
  const max = Math.max.apply(null, list.map(a => a.result.overall).concat([1]));
  openModal('<h3>多岗位匹配对比</h3><p>对比不同 JD 的匹配度，帮你找到最合适的方向。</p>' +
    '<div class="jd-compare">' +
    list.map(a => '<div class="jc-row"><span class="jc-name">' + esc(a.jdText.slice(0, 14)) + (a.jdText.length > 14 ? '…' : '') + '</span><span class="jc-bar"><i style="width:' + Math.max(4, Math.round(a.result.overall / max * 100)) + '%"></i></span><b class="jc-pct">' + a.result.overall + '%</b></div>').join('') +
    '</div>' +
    '<div class="modal-actions"><button class="btn btn-primary" onclick="closeModal()">知道了</button></div>');
}

function renderJdResult(result) {
  removeEl('ai-jd-box');
  const box = $('#jd-result');
  if (!result) {
    box.innerHTML = emptyState('target', '还没有分析结果', '粘贴 JD 并点击「分析匹配度」，查看岗位关键词覆盖与优化建议。',
      '<button class="btn btn-ghost btn-sm" id="jd-empty-sample">填入示例 JD</button>');
    const sBtn = $('#jd-empty-sample');
    if (sBtn) sBtn.addEventListener('click', () => { $('#jd-text').value = DEMO_JD; $('#jd-text').focus(); });
    return;
  }
  const rate = result.overall >= 80 ? ['high', '匹配度较高'] : result.overall >= 60 ? ['mid', '匹配度一般'] : ['low', '匹配度较低，建议优化'];
  const kwRow = k => {
    const cls = k.match ? 'matched' : 'missing';
    return '<div class="kw-row"><span class="kw-name">' + esc(k.name) + '</span><span class="kw-bar ' + cls + '"><i style="width:0%" data-w="' + (k.match ? 100 : 0) + '"></i></span><span class="kw-pct" data-v="' + (k.match ? 100 : 0) + '">0%</span></div>';
  };
  let html = '<div class="jd-score-card panel">' +
    '<div class="jd-score-big"><div class="jd-score-num" data-v="' + result.overall + '">0%</div><div class="jd-score-label">岗位匹配度</div></div>' +
    '<div style="flex:1"><span class="jd-score-rate ' + rate[0] + '">' + rate[1] + '</span>' +
    (result.position ? '<p class="muted" style="margin-top:8px">解析岗位：' + esc(result.position) + '</p>' : '') +
    '<p class="muted">' + (result.kws.length ? '共解析 ' + result.kws.length + ' 项要求' : '未解析出明确关键词') + '</p></div></div>';
  if (result.kws.length) {
    html += '<div class="panel"><div class="side-head"><h3>关键词匹配</h3></div><div class="kw-list">' + result.kws.map(kwRow).join('') + '</div></div>';
  }
  if (result.suggestions.length) {
    html += '<div class="panel"><div class="side-head"><h3>优化建议</h3><span class="badge-soft">' + result.suggestions.length + ' 条</span></div>' +
      result.suggestions.map((s, i) =>
        '<div class="jd-sugg-card"><h4>' + icon('target') + esc(s.title) + '</h4><p>' + esc(s.desc) + '</p>' +
        '<div class="ref">' + esc(s.ref) + '</div>' +
        '<button class="btn btn-primary btn-sm jd-apply" data-i="' + i + '">去简历中补充</button></div>'
      ).join('') + '</div>';
  }
  box.innerHTML = html;
  box.querySelectorAll('.jd-apply').forEach(b => b.addEventListener('click', () => {
    const s = result.suggestions[Number(b.dataset.i)];
    const exp = S.resume.experiences[0];
    if (exp) {
      switchView('generate');
      setTimeout(() => {
        const path = 'exp.' + exp.id + '.bullets.0';
        const el = $('#resume-sheet').querySelector('[data-path="' + path + '"]');
        if (el) { el.classList.add('flash'); el.focus(); }
        toast('请基于真实经历补充「' + s.keyword + '」相关内容');
      }, 350);
    } else {
      switchView('chat');
      toast('请先补充一段经历，再应用该建议');
    }
  }));
  // 匹配度数字滚动 + 关键词进度条依次填充（PRD 动画）
  setTimeout(() => {
    const num = box.querySelector('.jd-score-num');
    if (num) animateNumber(num, Number(num.dataset.v), 900, '%');
    const bars = box.querySelectorAll('.kw-bar i');
    bars.forEach((bar, i) => setTimeout(() => { bar.style.width = bar.dataset.w + '%'; }, 130 + i * 90));
    const pcts = box.querySelectorAll('.kw-pct');
    pcts.forEach((el, i) => setTimeout(() => animateNumber(el, Number(el.dataset.v), 450, '%'), 130 + i * 90));
  }, 100);
}

/* ---------- 模块6：导出与版本 ---------- */
function copyResumeMarkdown() {
  const R = S.resume, E = R.education || {}, I = R.intention || {};
  const md = [];
  md.push('# ' + (R.name || '姓名'));
  md.push('');
  md.push('- 电话：' + (R.phone || '—') + ' | 邮箱：' + (R.email || '—'));
  md.push('- 学校：' + [E.school, E.major, E.degree, E.gradDate].filter(Boolean).join(' · '));
  md.push('- 求职意向：' + [I.position, I.city, I.salary].filter(Boolean).join(' · '));
  md.push('');
  md.push('## 项目与实习经历');
  (R.experiences || []).forEach(e => {
    md.push('### ' + (e.title || '') + (e.role ? '（' + e.role + '）' : ''));
    (e.bullets && e.bullets.length ? e.bullets : [e.desc]).forEach(b => md.push('- ' + (b || '')));
    md.push('');
  });
  md.push('## 专业技能');
  md.push(flatSkills(R).join('、') || '—');
  md.push('');
  md.push('## 自我评价');
  md.push(R.summary || '—');
  (R.customSections || []).forEach(s => {
    md.push('');
    md.push('## ' + s.title);
    (s.items || []).forEach(i => md.push('- ' + i));
  });
  const text = md.join('\n');
  navigator.clipboard.writeText(text).then(() => toast('简历 Markdown 已复制 📋', 'success'));
}

function compareVersions() {
  if (S.versions.length < 2) { toast('至少需要 2 个版本才能对比', 'error'); return; }
  const opts = S.versions.map(v => '<option value="' + v.id + '">' + esc(v.name) + '</option>').join('');
  const other = S.versions.find(v => v.id !== S.currentVersionId);
  const baseId = other ? other.id : S.versions[0].id;
  openModal('<h3>版本对比</h3><p>选择两个版本查看差异：<span class="dd-add">新内容</span> / <span class="dd-del">旧内容</span>。</p>' +
    '<div class="cmp-pick"><label>基准（旧）</label><select id="cmp-a">' + opts + '</select><label>对比（新）</label><select id="cmp-b">' + opts + '</select></div>' +
    '<div class="diff-detail" id="cmp-detail"></div>' +
    '<div class="modal-actions"><button class="btn btn-ghost" id="cmp-export">导出 diff</button><button class="btn btn-primary" onclick="closeModal()">知道了</button></div>', true);
  $('#cmp-a').value = baseId;
  $('#cmp-b').value = S.currentVersionId;
  const renderCmp = () => {
    const va = S.versions.find(v => v.id === $('#cmp-a').value);
    const vb = S.versions.find(v => v.id === $('#cmp-b').value);
    if (!va || !vb) return;
    const lines = diffResumeDetail(va.resume, vb.resume);
    $('#cmp-detail').innerHTML = lines.map(l => '<div class="dd ' + l.type + '">' + esc(l.text) + '</div>').join('');
  };
  $('#cmp-a').addEventListener('change', renderCmp);
  $('#cmp-b').addEventListener('change', renderCmp);
  $('#cmp-export').addEventListener('click', () => {
    const va = S.versions.find(v => v.id === $('#cmp-a').value);
    const vb = S.versions.find(v => v.id === $('#cmp-b').value);
    if (!va || !vb) { toast('请选择两个版本', 'error'); return; }
    const lines = diffResumeDetail(va.resume, vb.resume);
    const text = '版本对比：' + va.name + ' → ' + vb.name + '\n\n' + lines.map(l => (l.type === 'del' ? '-' : l.type === 'add' ? '+' : ' ') + ' ' + l.text).join('\n');
    downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), '版本对比-' + todayStr() + '.txt');
    toast('版本对比已导出 ✅', 'success');
    if (window.Store && Store.bumpStat) Store.bumpStat('exports');
  });
  renderCmp();
}

function csvCell(s) {
  return '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
}

function exportDeliveryCsv() {
  const rows = S.versions.filter(v => v.status === 'submitted');
  if (!rows.length) { toast('暂无已投递记录', 'error'); return; }
  const lines = [['版本名称', '投递企业', '投递日期', '目标岗位', '期望城市', '跟进阶段', '跟进备注', '分享网页'].map(csvCell).join(',')];
  rows.forEach(v => {
    const r = v.resume || {};
    const f = v.follow || {};
    lines.push([v.name, v.company, v.submittedAt, (r.intention || {}).position || '', (r.intention || {}).city || '', stageLabel(f.stage), f.note || '', v.url || ''].map(csvCell).join(','));
  });
  downloadBlob(new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }), '投递台账-' + todayStr() + '.csv');
  toast('投递台账已导出 ✅', 'success');
}

function renderExport() {
  ensureVersion();
  $('#version-count').textContent = S.versions.length + ' 个版本';
  /* 投递时间线 */
  const tl = $('#delivery-timeline');
  if (tl) {
    const submitted = S.versions
      .filter(v => v.status === 'submitted')
      .sort((x, y) => String(y.submittedAt || '').localeCompare(String(x.submittedAt || '')));
    tl.innerHTML = submitted.length
      ? '<div class="tl-head"><h4>' + icon('sendMail') + '投递时间线</h4></div><div class="tl-list">' +
        submitted.map(v => {
          const f = v.follow || {};
          const st = stageLabel(f.stage);
          const note = f.note ? '<small class="tl-note">' + esc(f.note) + '</small>' : '';
          return '<div class="tl-item"><span class="tl-dot stage-' + (f.stage || 'applied') + '"></span><div class="tl-info"><b>' + esc(v.company || '未填企业') + '</b>' +
            '<small>' + esc(v.name) + ' · ' + esc(v.submittedAt || '') + ' · <span class="tl-stage ' + (f.stage || 'applied') + '">' + st + '</span>' + (followOverdue(v) ? ' · <span class="tl-follow">待跟进</span>' : '') + '</small>' + note + '</div></div>';
        }).join('') + '</div>'
      : '';
  }
  const submitted = S.versions.filter(v => v.status === 'submitted').length;
  const drafts = S.versions.filter(v => v.status === 'draft').length;
  const views = S.versions.reduce((a, v) => a + (v.views || 0), 0);
  const shareCount = S.versions.reduce((a, v) => a + (v.shareCount || 0), 0);
  /* 投递看板：按跟进阶段统计 + 超期提醒 */
  const board = $('#delivery-board');
  if (board) {
    const stages = { applied: 0, interview: 0, offer: 0, rejected: 0 };
    let overdue = 0;
    const nowMs = Date.now();
    const WEEK = 7 * 24 * 60 * 60 * 1000;
    S.versions.filter(v => v.status === 'submitted').forEach(v => {
      const f = v.follow || {};
      const st = f.stage || 'applied';
      stages[st] = (stages[st] || 0) + 1;
      const evs = f.events || [];
      const lastAt = evs.length ? new Date(evs[evs.length - 1].at).getTime() : (v.submittedAt ? new Date(v.submittedAt).getTime() : 0);
      if ((st === 'applied' || st === 'interview') && lastAt && (nowMs - lastAt) > WEEK) overdue++;
    });
    const dbCard = (key, label, cls) => '<div class="db-card ' + cls + '"><b>' + (stages[key] || 0) + '</b><small>' + label + '</small></div>';
    board.innerHTML =
      '<div class="db-head"><h4>' + icon('inbox') + '投递看板</h4>' +
      (overdue ? '<span class="db-overdue">⚠ ' + overdue + ' 家超 7 天未跟进</span>' : '<span class="db-ok">✓ 跟进正常</span>') + '</div>' +
      '<div class="db-grid">' +
      dbCard('applied', '已投递', 'db-applied') +
      dbCard('interview', '面试中', 'db-interview') +
      dbCard('offer', '已发Offer', 'db-offer') +
      dbCard('rejected', '未通过', 'db-rejected') +
      '</div>';
  }
  const statsBox = $('#exp-stats');
  if (statsBox) {
    statsBox.innerHTML =
      '<div class="exp-stat"><b>' + S.versions.length + '</b><small>版本</small></div>' +
      '<div class="exp-stat"><b>' + submitted + '</b><small>已投递</small></div>' +
      '<div class="exp-stat"><b>' + drafts + '</b><small>草稿</small></div>' +
      '<div class="exp-stat"><b>' + (shareCount ? shareCount : '—') + '</b><small>分享网页</small></div>';
    if (window.Auth && Auth.isLoggedIn()) refreshLinkStats();
  }
  const list = $('#version-list');
  list.innerHTML = '';
  S.versions.forEach(v => {
    const isCur = v.id === S.currentVersionId;
    const item = document.createElement('button');
    item.className = 'version-item' + (isCur ? ' current' : '');
    const statusLabel = { editing: '当前编辑', draft: '草稿', submitted: '已投递' }[v.status] || '草稿';
    const meta = [v.name, fmtDate(v.createdAt), v.company ? '投递：' + v.company : ''].filter(Boolean).join(' · ');
    item.innerHTML =
      '<div class="v-info"><div class="v-name">' + esc(v.name || '未命名版本') + '</div><div class="v-meta">' + esc(meta) + '</div></div>' +
      '<span class="v-status ' + v.status + '">' + statusLabel + '</span>' +
      '<span class="v-more">⋯</span>';
    item.addEventListener('click', e => {
      if (e.target.classList.contains('v-more')) return;
      if (!isCur) {
        openModal('<h3>切换到该版本？</h3><p>切换到「' + esc(v.name) + '」后，未保存的修改将丢失。</p><div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">取消</button><button class="btn btn-primary" id="confirm-switch">确认切换</button></div>');
        $('#confirm-switch').addEventListener('click', () => { switchVersion(v.id); closeModal(); renderAll(); toast('已切换版本', 'success'); });
      }
    });
    item.querySelector('.v-more').addEventListener('click', e => {
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      showContextMenu(rect.right, rect.bottom, [
        { label: '重命名', action: () => renameVersion(v) },
        { label: '复制版本', action: () => duplicateVersion(v) },
        { label: v.status === 'submitted' ? '更新跟进' : '标记为已投递', action: () => v.status === 'submitted' ? updateFollow(v) : markSubmitted(v) },
        { label: '删除版本', danger: true, action: () => deleteVersion(v) }
      ]);
    });
    list.appendChild(item);
  });
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function createVersionFlow() {
  const defaultName = (S.resume.intention.position || '岗位名') + ' · ' + todayStr();
  openModal('<h3>创建新版本</h3><p>基于当前版本复制内容，独立编辑。</p>' +
    '<label>版本名称</label><input type="text" id="new-version-name" value="' + esc(defaultName) + '" maxlength="30" placeholder="建议格式：岗位名 · 日期">' +
    '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">取消</button><button class="btn btn-primary" id="confirm-new-version">创建</button></div>');
  $('#confirm-new-version').addEventListener('click', () => {
    const name = ($('#new-version-name').value || '').trim();
    const prev = currentVersion();
    const v = createVersion(name || defaultName);
    saveState();
    closeModal();
    renderAll();
    const parts = diffVersions(v, prev);
    openModal('<h3>版本差异</h3><p>新版本「' + esc(v.name) + '」与「' + esc(prev ? prev.name : '当前版本') + '」的内容差异：</p>' +
      '<div class="diff-list">' + parts.map(p => '<div class="diff-item">' + esc(p) + '</div>').join('') + '</div>' +
      '<div class="modal-actions"><button class="btn btn-primary" onclick="closeModal()">知道了</button></div>');
    toast('已创建版本 ✅', 'success');
  });
}

function renameVersion(v) {
  openModal('<h3>重命名版本</h3><label>版本名称</label><input type="text" id="rename-input" value="' + esc(v.name) + '" maxlength="30">' +
    '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">取消</button><button class="btn btn-primary" id="confirm-rename">保存</button></div>');
  $('#confirm-rename').addEventListener('click', () => {
    v.name = ($('#rename-input').value || '').trim() || v.name;
    saveState(); closeModal(); renderExport(); toast('已重命名', 'success');
  });
}

function duplicateVersion(v) {
  const copy = emptyVersion(v.resume);
  copy.name = v.name + ' · 副本';
  copy.status = 'draft';
  S.versions.push(copy);
  saveState(); renderExport(); toast('已复制版本', 'success');
}

function followStageOptions(sel) {
  const stages = [['applied', '已投递'], ['interview', '面试中'], ['offer', '已发Offer'], ['rejected', '未通过']];
  return stages.map(s => '<option value="' + s[0] + '"' + (sel === s[0] ? ' selected' : '') + '>' + s[1] + '</option>').join('');
}

function followOverdue(v) {
  const f = v.follow || {};
  if (f.stage !== 'applied' && f.stage !== 'interview') return false;
  const evs = f.events || [];
  const lastAt = evs.length ? new Date(evs[evs.length - 1].at).getTime() : (v.submittedAt ? new Date(v.submittedAt).getTime() : 0);
  return !!lastAt && (Date.now() - lastAt) > 7 * 24 * 60 * 60 * 1000;
}

function stageLabel(stage) {
  return { applied: '已投递', interview: '面试中', offer: '已发Offer', rejected: '未通过' }[stage] || '已投递';
}

function markSubmitted(v) {
  if (v.status === 'submitted') {
    v.status = 'draft'; v.company = ''; v.submittedAt = ''; v.follow = undefined;
    saveState(); renderExport(); toast('已恢复为草稿');
    return;
  }
  openModal('<h3>标记为已投递</h3><p>记录投递企业与日期，可选跟进阶段与备注。</p>' +
    '<label>投递企业</label><input type="text" id="sub-company" placeholder="例如：字节跳动">' +
    '<label>投递日期</label><input type="date" id="sub-date" value="' + todayStr() + '">' +
    '<label>跟进阶段</label><select id="sub-stage">' + followStageOptions() + '</select>' +
    '<label>备注（可选）</label><input type="text" id="sub-note" placeholder="例如：内推人：张xx">' +
    '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">取消</button><button class="btn btn-primary" id="confirm-submit">确认</button></div>');
  $('#confirm-submit').addEventListener('click', () => {
    v.status = 'submitted';
    v.company = ($('#sub-company').value || '').trim();
    v.submittedAt = $('#sub-date').value || todayStr();
    const stage = $('#sub-stage').value || 'applied';
    const note = ($('#sub-note').value || '').trim();
    v.follow = { stage: stage, note: note, events: [{ at: new Date().toISOString(), stage: stage, note: note }] };
    saveState(); closeModal(); renderExport(); toast('已标记为已投递 📮', 'success');
  });
}

function updateFollow(v) {
  const f = v.follow || { stage: 'applied', note: '', events: [] };
  openModal('<h3>更新投递跟进</h3><p>「' + esc(v.company || v.name) + '」当前阶段：' + stageLabel(f.stage) + '，保存后自动记录到时间线。</p>' +
    '<label>跟进阶段</label><select id="follow-stage">' + followStageOptions(f.stage) + '</select>' +
    '<label>备注（可选）</label><input type="text" id="follow-note" value="' + esc(f.note || '') + '" placeholder="例如：HR 约了周三电话面试">' +
    '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">取消</button><button class="btn btn-primary" id="confirm-follow">保存</button></div>');
  $('#confirm-follow').addEventListener('click', () => {
    const stage = $('#follow-stage').value || 'applied';
    const note = ($('#follow-note').value || '').trim();
    v.follow = v.follow || { events: [] };
    v.follow.stage = stage;
    v.follow.note = note;
    v.follow.events = v.follow.events || [];
    v.follow.events.push({ at: new Date().toISOString(), stage: stage, note: note });
    saveState(); closeModal(); renderExport();
    toast('跟进已更新 ✅', 'success');
    if (window.Store && Store.bumpStat) Store.bumpStat('exports');
  });
}

function deleteVersion(v) {
  if (S.versions.length <= 1) { toast('至少保留一个版本', 'error'); return; }
  openModal('<h3>删除版本？</h3><p>「' + esc(v.name) + '」将被永久删除，且无法恢复。</p>' +
    '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">取消</button><button class="btn btn-danger-ghost" id="confirm-delete">删除</button></div>');
  $('#confirm-delete').addEventListener('click', () => {
    const idx = S.versions.findIndex(x => x.id === v.id);
    lastDeleted = { type: 'version', item: v, index: idx, wasCurrent: S.currentVersionId === v.id };
    S.versions.splice(idx, 1);
    if (S.currentVersionId === v.id) S.currentVersionId = S.versions[0].id;
    S.resume = cloneResume(S.versions.find(x => x.id === S.currentVersionId).resume);
    saveState(); closeModal(); renderExport();
    toast('版本已删除', '', '撤销', undoDelete);
  });
}

/* ---------- 导出 ---------- */
function exportPdf() {
  const printArea = $('#print-area');
  printArea.innerHTML = renderResumeHTML(S.resume, S.settings);
  wireSheetEditable(printArea);
  toast('正在生成 PDF…');
  setTimeout(() => window.print(), 300);
  if (window.Store && Store.bumpStat) Store.bumpStat('exports');
  if (window.Auth && Auth.track) Auth.track('export', { format: 'pdf' });
}

function exportDoc() {
  const R = S.resume;
  /* 纯前端生成真实 .docx（js/docx.js，OOXML + ZIP，零依赖）；失败时降级为 HTML .doc（兼容） */
  const fallbackDoc = () => {
    const html = renderResumeHTML(S.resume, Object.assign({}, S.settings, { showPhoto: false }));
    const docHtml =
      '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>简历 - ' + esc(R.name || '未命名') + '</title>' +
      '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->' +
      '<style>body{font-family:"Microsoft YaHei",sans-serif;color:#222}.sheet{width:100%;padding:20px}.r-section-title{border-bottom:1px solid #999;font-weight:bold;margin:12px 0 6px;font-size:16px}.r-name{font-size:24px;font-weight:bold}.r-bullets{margin:4px 0 4px 18px}</style></head><body>' + html + '</body></html>';
    const blob = new Blob([String.fromCharCode(0xFEFF) + docHtml], { type: 'application/msword' });
    downloadBlob(blob, (R.name || '简历') + '-' + todayStr() + '.doc');
    toast('Word 文档已导出 ✅（兼容 .doc）', 'success');
  };
  if (window.DocxBuilder) {
    try {
      const blob = window.DocxBuilder.buildBlob(S.resume);
      downloadBlob(blob, (R.name || '简历') + '-' + todayStr() + '.docx');
      toast('Word 文档已导出 ✅（.docx 可编辑）', 'success');
      if (window.Store && Store.bumpStat) Store.bumpStat('exports');
      return;
    } catch (e) { /* 生成失败时降级 */ }
  }
  fallbackDoc();
}

/* 分享简历网页：纯前端生成单文件 HTML（只读、无需服务器，发给招聘方用浏览器打开即可） */
const SHARE_CSS = ':root{--r-accent:#2d9d78;--text-sm:13px;--text-xs:12px;--text-base:14px;--text-md:15px;--muted:#888;--serif:Georgia,"Songti SC","SimSun",serif}html,body{margin:0;padding:0;background:#eceff2;font-family:"PingFang SC","Microsoft YaHei",sans-serif}.share-page{max-width:840px;margin:28px auto 48px;padding:0 16px}.sheet{width:auto;max-width:100%;background:#fff;color:#222;box-shadow:0 18px 50px rgba(22,37,31,.16),0 2px 8px rgba(22,37,31,.06);border-radius:4px;padding:clamp(28px,5vw,58px);font-size:14px;line-height:1.6;position:relative}.sheet .r-header{margin-bottom:16px}.sheet .r-name{font-size:26px;font-weight:800;letter-spacing:1px}.sheet .r-sub{font-size:var(--text-sm);color:#555;margin-top:5px;line-height:1.7}.sheet .r-intention{display:inline-block;margin-top:7px;background:#f1f5f4;border:1px solid #dde7e2;color:#2d6b57;border-radius:20px;padding:2px 12px;font-size:var(--text-xs)}.sheet .r-section{margin-top:14px}.sheet .r-section-title{font-size:var(--text-md);font-weight:800;letter-spacing:2px;color:#1f4e3f;border-bottom:2px solid var(--r-accent,#2d9d78);padding-bottom:4px;margin-bottom:9px}.sheet .r-item{margin-bottom:9px}.sheet .r-item-head{display:flex;justify-content:space-between;align-items:baseline;gap:10px}.sheet .r-item-title{font-weight:700;font-size:var(--text-base)}.sheet .r-item-role{font-size:var(--text-xs);color:#567;margin-top:1px}.sheet .r-item-time{font-size:var(--text-xs);color:#888;white-space:nowrap}.sheet .r-bullets{margin:5px 0 0;padding-left:18px}.sheet .r-bullets li{font-size:13px;line-height:1.65;margin-bottom:3px}.sheet .r-skill-line{font-size:13px;margin-bottom:4px}.sheet .r-skill-line b{font-weight:700;margin-right:6px}.sheet .r-summary{font-size:13px;line-height:1.7}.sheet .r-photo{width:74px;height:92px;object-fit:cover;border-radius:4px;float:right;margin:0 0 8px 14px;border:1px solid #e5e5e5}.sheet.tpl-modern .r-section-title{border-bottom-width:1px;border-bottom-style:solid;letter-spacing:1px}.sheet.tpl-classic .r-name{font-family:var(--serif);letter-spacing:2px}.sheet.tpl-classic .r-section-title{border-bottom:1px solid #999;color:#333;font-family:var(--serif)}.sheet.tpl-classic{font-family:var(--serif)}.sheet.tpl-geek{background:#0d1420;color:#dbe6f5}.sheet.tpl-geek .r-section-title{color:#66d9ff;border-bottom-color:#1e3a5f}.sheet.tpl-geek .r-name{color:#fff}.sheet.tpl-geek .r-sub{color:#8fa6c4}.sheet.tpl-geek .r-item-time,.sheet.tpl-geek .r-item-role{color:#7d93b0}.sheet.tpl-geek .r-intention{background:#12283c;border-color:#1e3a5f;color:#66d9ff}.sheet.tpl-fresh{font-family:"PingFang SC","Microsoft YaHei",sans-serif;background:#fffdf8}.sheet.tpl-fresh .r-section-title{border-bottom:2px dashed #e8c6d8;color:#c96a94;letter-spacing:2px}.sheet.tpl-fresh .r-name{color:#c96a94}.sheet.tpl-academic .r-section-title{color:#5b3a29;border-bottom:2px solid #8b5e3c}.sheet.tpl-academic{font-family:var(--serif)}.sheet.tpl-paper .r-section-title{text-align:center;border-bottom:none;color:#444;letter-spacing:4px}.sheet.tpl-paper .r-name{text-align:center;font-family:var(--serif)}.sheet.tpl-paper .r-item-head{flex-direction:column;gap:2px}.sheet.tpl-tech{background:linear-gradient(135deg,#101820,#0d1b2a);color:#e6eef7}.sheet.tpl-tech .r-section-title{color:#35d0a0;border-bottom-color:#1c4a3a}.sheet.tpl-tech .r-name{color:#fff;font-family:"Consolas","Courier New",monospace;letter-spacing:1px}.sheet.tpl-tech .r-sub{color:#8fb3d8}.sheet.tpl-duo .r-header{display:grid;grid-template-columns:auto 1fr;gap:18px;align-items:start}.sheet.tpl-duo .r-side .r-section-title{border-bottom:none;font-size:13px;color:var(--r-accent,#2d9d78);border-left:3px solid var(--r-accent,#2d9d78);padding-left:8px;letter-spacing:1px}.share-foot{text-align:center;color:#9aa3ab;font-size:12px;margin-top:14px}.share-toolbar{text-align:center;margin-bottom:14px}.share-toolbar button{background:#2d9d78;color:#fff;border:none;border-radius:20px;padding:8px 18px;font-size:13px;cursor:pointer;font-family:inherit}.share-toolbar button:hover{opacity:.9}.sheet.tpl-minimal{border:1px solid #e0e0e0;box-shadow:none}.sheet.tpl-minimal .r-name{font-size:24px;letter-spacing:2px;color:#111}.sheet.tpl-minimal .r-section-title{color:#111;border-bottom:1px solid #111}.sheet.tpl-minimal .r-intention{background:#f5f5f5;border-color:#ddd;color:#333}.sheet.tpl-gradient{background:linear-gradient(165deg,#eef2ff 0%,#ffffff 45%)}.sheet.tpl-gradient .r-header{background:linear-gradient(135deg,#4b7ef0 0%,#7a5af8 100%);border-radius:14px;padding:24px 26px 20px;color:#fff;margin:0 0 18px;box-shadow:0 10px 24px rgba(75,126,240,.25)}.sheet.tpl-gradient .r-header .r-name{color:#fff}.sheet.tpl-gradient .r-header .r-sub{color:#eef2ff}.sheet.tpl-gradient .r-header .r-intention{background:rgba(255,255,255,.18);border-color:rgba(255,255,255,.35);color:#fff}.sheet.tpl-gradient .r-section-title{color:#4b7ef0;border-bottom-color:#c9d6ff}.sheet.tpl-neon{background:radial-gradient(circle at 12% 8%,rgba(56,189,248,.20),transparent 42%),radial-gradient(circle at 88% 92%,rgba(255,94,168,.18),transparent 42%),#0a0f1e;color:#d7e3ff}.sheet.tpl-neon .r-name{color:#fff;text-shadow:0 0 18px rgba(120,140,255,.85),0 0 36px rgba(56,189,248,.4)}.sheet.tpl-neon .r-sub,.sheet.tpl-neon .r-item-role{color:#9fb3d9}.sheet.tpl-neon .r-section-title{color:#7dd3fc;border-bottom:1px solid rgba(125,211,252,.35);text-shadow:0 0 12px rgba(56,189,248,.55)}.sheet.tpl-neon .r-item-title{color:#e0e7ff}.sheet.tpl-neon .r-item-time{color:#8fa6c4}.sheet.tpl-neon .r-intention{background:rgba(255,94,168,.14);border-color:rgba(255,94,168,.4);color:#ffb3d9;box-shadow:0 0 14px rgba(255,94,168,.25)}.sheet.tpl-neon .r-skill-line b{color:#ffb86c}.share-toolbar button.active{opacity:1;box-shadow:0 0 0 2px rgba(255,255,255,.85)}.share-text{max-width:840px;margin:0 auto 48px;padding:0 16px}.share-text pre{background:#fff;border:1px solid #e0e0e0;border-radius:12px;padding:22px 24px;font-family:inherit;font-size:13.5px;line-height:1.8;white-space:pre-wrap;word-break:break-word;margin:0}@media print{.share-page{margin:0;padding:0}.sheet{box-shadow:none;border-radius:0}.share-toolbar{display:none}#share-text{display:none!important}#share-view{display:block!important}}';

function buildShareHtml() {
  const R = S.resume;
  const tmp = document.createElement('div');
  tmp.innerHTML = renderResumeHTML(R, Object.assign({}, S.settings, { showPhoto: false }));
  tmp.querySelectorAll('[contenteditable]').forEach(function (el) { el.removeAttribute('contenteditable'); });
  tmp.querySelectorAll('[data-path],[data-sec],[data-exp],[data-custom]').forEach(function (el) {
    el.removeAttribute('data-path'); el.removeAttribute('data-sec'); el.removeAttribute('data-exp'); el.removeAttribute('data-custom');
  });
  tmp.querySelectorAll('.r-placeholder, .hint').forEach(function (el) { el.remove(); });
  const clean = tmp.innerHTML;
  let atsText = '';
  try { atsText = (atsParse(R) || {}).text || ''; } catch (e) { atsText = ''; }
  return '<!doctype html>' +
    '<html lang="zh-CN">' +
    '<head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + esc(R.name || '简历') + ' · 简历</title>' +
    '<style>' + SHARE_CSS + '</style>' +
    '</head><body>' +
    '<div class="share-toolbar">' +
    '<button type="button" class="active" id="tab-view-btn" onclick="showShareTab(0)">👁 视觉版</button>' +
    '<button type="button" id="tab-text-btn" onclick="showShareTab(1)">📄 ATS 纯文本</button>' +
    '<button type="button" onclick="window.print()">🖨 打印 / 存 PDF</button>' +
    '</div>' +
    '<div class="share-page" id="share-view">' + clean +
    '<div class="share-foot">由「一键上岸」生成 · 内容基于本人真实输入，绝不虚构</div>' +
    '</div>' +
    '<div class="share-text" id="share-text" style="display:none"><pre>' + esc(atsText) + '</pre></div>' +
    '<scr' + 'ipt>' +
    'function showShareTab(i){var v=document.getElementById("share-view"),t=document.getElementById("share-text"),vb=document.getElementById("tab-view-btn"),tb=document.getElementById("tab-text-btn");v.style.display=i===0?"block":"none";t.style.display=i===1?"block":"none";vb.className=i===0?"active":"";tb.className=i===1?"active":"";}' +
    '<' + '/scr' + 'ipt>' +
    '</body></html>';
}

function exportUrl() {
  const R = S.resume;
  const hasContent = !!(R.name || R.phone || R.email || R.city ||
    (R.education && (R.education.school || R.education.major || R.education.degree)) ||
    (R.experiences && R.experiences.length) || R.summary ||
    (R.skills && R.skills.length));
  if (!hasContent) { toast('请先填写简历内容', 'error'); return; }
  const v = currentVersion();
  const blob = new Blob([buildShareHtml()], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  openModal('<h3>' + icon('link') + '分享简历网页</h3>' +
    '<p>已为你生成一个<b>单文件 HTML 简历网页</b>：不依赖任何服务器，把文件发给招聘方，对方用浏览器打开即可查看（只读、无水印、排版一致）。</p>' +
    '<div class="modal-actions"><button class="btn btn-ghost" id="share-preview">👁 预览</button><button class="btn btn-primary" id="share-download">⬇ 下载文件</button></div>');
  $('#share-preview').addEventListener('click', () => { window.open(url, '_blank'); });
  $('#share-download').addEventListener('click', () => {
    downloadBlob(blob, (R.name || '简历') + '-分享网页-' + todayStr() + '.html');
    if (v) { v.shareCount = (v.shareCount || 0) + 1; saveState(); renderExport(); }
    closeModal();
    toast('分享网页已导出 ✅', 'success');
    if (window.Store && Store.bumpStat) Store.bumpStat('shares');
  });
}

/* ATS 纯文本：招聘网站 / 网申表单直接粘贴，复用 ai.js 的 atsParse 标准输出 */
function exportAtsText() {
  const R = S.resume;
  if (!R.name && !R.phone && !R.email && !(R.experiences || []).length && !((R.education || {}).school)) {
    toast('请先填写简历内容', 'error'); return;
  }
  const ats = atsParse(S.resume);
  const text = ats.text;
  const name = R.name || '简历';
  openModal('<h3>TXT ATS 纯文本</h3>' +
    '<p>适合粘贴到招聘网站 / 网申系统 / 在线表单，纯文本不会乱码、不会破坏排版：</p>' +
    '<textarea class="report-preview" id="ats-text" rows="12" readonly>' + esc(text) + '</textarea>' +
    '<div class="modal-actions">' +
    '<button class="btn btn-ghost" id="ats-copy">📋 复制</button>' +
    '<button class="btn btn-ghost" id="ats-download">⬇ 下载 .txt</button>' +
    '<button class="btn btn-primary" onclick="closeModal()">完成</button></div>');
  $('#ats-copy').addEventListener('click', () => {
    const ta = $('#ats-text');
    ta.select();
    navigator.clipboard.writeText(text).then(() => {
      toast('ATS 纯文本已复制 📋', 'success');
    }).catch(() => {
      try { document.execCommand('copy'); toast('ATS 纯文本已复制 📋', 'success'); } catch (e) { toast('复制失败，请手动选择复制', 'error'); }
    });
  });
  $('#ats-download').addEventListener('click', () => {
    downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), name + '-ATS纯文本-' + todayStr() + '.txt');
    toast('ATS 纯文本已导出 ✅', 'success');
    if (window.Store && Store.bumpStat) Store.bumpStat('exports');
  });
}

/* 本地分享导出计数（纯前端版无在线访问统计） */
/* 本地分享导出计数（纯前端版无在线访问统计） */
let linkStatsLoading = false;
function refreshLinkStats() {
  if (!window.Auth || !Auth.isLoggedIn() || linkStatsLoading) return;
  linkStatsLoading = true;
  Auth.api('/links/mine').then(list => {
    const map = {};
    (list || []).forEach(l => { map[l.code] = Number(l.viewCount) || 0; });
    let changed = false;
    S.versions.forEach(v => {
      if (!v.url) return;
      const m = String(v.url).match(/\/r\/([A-Za-z0-9_-]+)/);
      if (m && map[m[1]] !== undefined && (v.views || 0) !== map[m[1]]) {
        v.views = map[m[1]];
        changed = true;
      }
    });
    if (changed) { saveState(); renderExport(); }
  }).catch(() => { /* 静默 */ }).finally(() => { linkStatsLoading = false; });
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
}

/* ---------- 载入示例 / 重置 ---------- */
function loadDemo(profileId) {
  const profile = (DEMO_PROFILES || []).find(p => p.id === profileId) || DEMO_PROFILES[0];
  const src = profile.resume === 'WANG_RESUME' ? WANG_RESUME : profile.resume === 'ZHANG_RESUME' ? ZHANG_RESUME : DEMO_RESUME;
  resetState();
  S.resume = JSON.parse(JSON.stringify(src));
  S.chat.started = true;
  S.chat.stage = 'done';
  S.chat.messages = [
    { role: 'ai', text: '你好！我是一键上岸 🤖\n\n这是示例简历「' + profile.name + '」的完整数据，已跳过对话引导。' },
    { role: 'user', text: '（示例）载入' + profile.name + '的简历数据' },
    { role: 'ai', text: '已载入 ✅ 你可以直接体验「智能生成」「模板排版」「诊断优化」「岗位匹配」「导出投递」全部模块！' }
  ];
  S.chat.quick = [];
  S.generated = true;
  const v = emptyVersion(S.resume);
  v.name = (S.resume.intention.position || '示例') + ' · 通用版';
  v.status = 'editing';
  S.versions = [v];
  S.currentVersionId = v.id;
  saveState();
  switchView('generate');
  toast('已载入示例：' + profile.name, 'success');
}

function chooseDemoProfile() {
  openModal('<h3>选择示例简历</h3><p>对应 PRD 的三类用户画像，选择后直接体验各模块。</p>' +
    '<div class="profile-list">' +
    DEMO_PROFILES.map(p =>
      '<button class="profile-card" data-p="' + p.id + '">' +
      '<b>' + p.name + '</b><span class="profile-tag">' + p.tag + '</span>' +
      '<small>' + p.desc + '</small></button>').join('') +
    '</div>');
  $$('.profile-card').forEach(c => c.addEventListener('click', () => { closeModal(); loadDemo(c.dataset.p); }));
}

function resetAll() {
  openModal('<h3>确认重置？</h3><p>将清空所有简历数据、版本与诊断记录，此操作不可恢复。</p>' +
    '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">取消</button><button class="btn btn-danger-ghost" id="confirm-reset">确认重置</button></div>');
  $('#confirm-reset').addEventListener('click', () => {
    resetState();
    closeModal();
    switchView('home');
    toast('已重置所有数据');
  });
}

/* 全量刷新 */
function renderAll() {
  const active = $('.view.active');
  const name = active ? active.id.replace('view-', '') : 'home';
  if (name === 'home') renderHome();
  else if (name === 'chat') renderChat();
  else if (name === 'generate') renderGenerate();
  else if (name === 'template') renderTemplate();
  else if (name === 'diagnosis') renderDiagnosis();
  else if (name === 'jd') renderJd();
  else if (name === 'export') renderExport();
}



































