/* ============================================================
 * app.js — 启动与事件绑定
 * ============================================================ */

/* 主题：空值跟随系统偏好，否则用用户选择 */
function currentTheme() {
  const t = S.settings.theme;
  if (!t || t === 'system') {
    return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }
  return t;
}
function applyTheme() {
  const t = currentTheme();
  document.documentElement.dataset.theme = t;
  const btn = $('#btn-theme');
  if (btn) btn.innerHTML = icon(t === 'dark' ? 'sun' : 'moon');
}
function toggleTheme() {
  S.settings.theme = currentTheme() === 'dark' ? 'light' : 'dark';
  saveState();
  applyTheme();
  toast(currentTheme() === 'dark' ? '已切换深色模式 🌙' : '已切换浅色模式 ☀️');
}

document.addEventListener('DOMContentLoaded', () => {
  /* 自动保存指示器（节流 1.5s） */
  let saveTimer = null, lastSavedAt = 0;
  window.__notifySaved = () => {
    const el = document.getElementById('save-status');
    if (!el) return;
    const now = Date.now();
    if (now - lastSavedAt < 1500) return;
    lastSavedAt = now;
    el.textContent = '已保存 ' + new Date().toTimeString().slice(0, 5);
    el.classList.add('flash');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => el.classList.remove('flash'), 1200);
  };
  loadState();
  /* 本地使用统计（纯前端，不联网）：记录访问 */
  if (!S.stats) S.stats = { firstVisitAt: '', lastVisitAt: '', visits: 0, generations: 0, diagnoses: 0, exports: 0, shares: 0, backups: 0, lastBackupAt: '' };
  const nowIso = new Date().toISOString();
  if (!S.stats.firstVisitAt) S.stats.firstVisitAt = nowIso;
  S.stats.lastVisitAt = nowIso;
  S.stats.visits = (S.stats.visits || 0) + 1;
  saveState();
  applyTheme();
  $('#btn-continue').hidden = !(S.versions.length || S.resume.name);

  /* ---------- 登录态与云端同步（未登录完全离线，零影响） ---------- */
  if (window.Auth) {
    // 校验本地 token：有效则恢复登录态并触发云端同步，无效则跳转登录页
    Auth.init();
  }

  /* U12：统一版本号来源（data.js APP_VERSION） */
  const avEl = $('#app-version');
  if (avEl) avEl.textContent = 'v' + APP_VERSION;

  /* U09：学校 / 专业 <datalist> 自动补全候选 */
  const schoolList = $('#school-list'), majorList = $('#major-list');
  if (schoolList) schoolList.innerHTML = (UNIVERSITIES || []).map(u => '<option value="' + esc(u) + '">').join('');
  if (majorList) majorList.innerHTML = (COMMON_MAJORS || []).map(m => '<option value="' + esc(m) + '">').join('');

  /* ---------- 导航 ---------- */
  $('#btn-home').addEventListener('click', () => switchView('home'));
  $$('.step').forEach(s => s.addEventListener('click', () => switchView(s.dataset.view)));
  $$('#mobile-tabs button').forEach(b => b.addEventListener('click', () => switchView(b.dataset.view)));
  $$('[data-goto]').forEach(el => el.addEventListener('click', () => switchView(el.dataset.goto)));

  /* ---------- 示例 / 重置 ---------- */
  $('#btn-demo').addEventListener('click', chooseDemoProfile);
  $('#btn-demo2').addEventListener('click', chooseDemoProfile);
  $('#btn-theme').addEventListener('click', toggleTheme);
  /* 粒子特效开关（科技感背景，设置持久化） */
  const fxBtn = $('#btn-fx');
  if (fxBtn) {
    const renderFxBtn = () => {
      const on = S.settings.fx !== false;
      fxBtn.classList.toggle('on', on);
      fxBtn.innerHTML = icon('sparkles');
      fxBtn.title = on ? '粒子特效：开（点击关闭）' : '粒子特效：关（点击开启）';
    };
    renderFxBtn();
    fxBtn.addEventListener('click', () => {
      S.settings.fx = S.settings.fx === false ? true : false;
      saveState();
      if (S.settings.fx === false) { if (window.FxEffects) FxEffects.stop(); }
      else { if (window.FxEffects) FxEffects.start(); }
      renderFxBtn();
      toast(S.settings.fx === false ? '粒子特效已关闭' : '粒子特效已开启 ✨', 'success');
    });
  }
  // 系统主题变化时跟随（仅当用户未手动指定）
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (!S.settings.theme) applyTheme();
    });
  }
  $('#btn-continue').addEventListener('click', () => switchView('generate'));
  $('#rs-continue').addEventListener('click', () => switchView('generate'));
  $('#rs-export').addEventListener('click', () => switchView('export'));

  /* 回到顶部悬浮按钮 */
  const backTop = $('#btn-back-top');
  if (backTop) {
    window.addEventListener('scroll', () => {
      backTop.classList.toggle('show', (window.scrollY || document.documentElement.scrollTop) > 320);
    }, { passive: true });
    backTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  }

  /* 撤销 / 重做：按钮 + 快捷键（编辑框内保留原生撤销） */
  const undoBtn = $('#btn-undo'), redoBtn = $('#btn-redo');
  window.__refreshUndo = () => {
    if (undoBtn) undoBtn.disabled = !(window.Store && Store.canUndo());
    if (redoBtn) redoBtn.disabled = !(window.Store && Store.canRedo());
  };
  if (undoBtn) undoBtn.addEventListener('click', () => { if (window.Store) Store.undo(); });
  if (redoBtn) redoBtn.addEventListener('click', () => { if (window.Store) Store.redo(); });
  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const t = e.target;
    const editing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    const key = (e.key || '').toLowerCase();
    if (key === 'z' && !editing) {
      e.preventDefault();
      if (e.shiftKey) { if (window.Store) Store.redo(); } else { if (window.Store) Store.undo(); }
    } else if (key === 'y' && !editing) {
      e.preventDefault();
      if (window.Store) Store.redo();
    }
  });

  /* Ctrl+S / Cmd+S：一键导出备份（防止误触发浏览器保存页面） */
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.keyCode === 83)) {
      e.preventDefault();
      exportBackup();
    }
  });

  /* 按钮点击波纹（炫酷） */
  document.addEventListener('pointerdown', e => {
    const btn = e.target.closest('.btn-primary, .btn-ghost, .btn-danger-ghost');
    if (!btn || btn.disabled) return;
    const rect = btn.getBoundingClientRect();
    const d = Math.max(rect.width, rect.height) * 2;
    const span = document.createElement('span');
    span.className = 'ripple';
    span.style.width = span.style.height = d + 'px';
    span.style.left = (e.clientX - rect.left - d / 2) + 'px';
    span.style.top = (e.clientY - rect.top - d / 2) + 'px';
    btn.appendChild(span);
    setTimeout(() => span.remove(), 600);
  });
  $('#completion-ring').addEventListener('click', showCompletionDetail);
  $('#btn-copy-md').addEventListener('click', copyResumeMarkdown);

  $('#btn-about').addEventListener('click', e => {
    e.preventDefault();
    const st = S.stats || {};
    const statCell = (label, val) => '<div class="about-stat"><b>' + val + '</b><small>' + label + '</small></div>';
    const hasContent = !!(S.resume.name || S.resume.phone || S.resume.email || S.versions.length);
    const backupTip = (st.backups || 0) > 0
      ? '上次备份：' + new Date(st.lastBackupAt).toLocaleDateString('zh-CN')
      : (hasContent ? '从未备份 · 建议在「导出投递」页导出 JSON 备份' : '暂无数据可备份');
    openModal('<h3>关于 一键上岸</h3>' +
      '<p><b>版本</b>：v' + APP_VERSION + ' · 纯前端本地版<br><b>定位</b>：面向高校毕业生的 AI Agent 简历撰写工具</p>' +
      '<p><b>六大模块</b>：对话引导 / 智能生成 / 模板排版 / 诊断优化 / 岗位匹配 / 导出投递</p>' +
      '<div class="about-stats">' +
      statCell('使用次数', st.visits || 0) +
      statCell('简历版本', S.versions.length) +
      statCell('AI 生成', st.generations || 0) +
      statCell('诊断次数', st.diagnoses || 0) +
      statCell('导出次数', st.exports || 0) +
      statCell('备份次数', st.backups || 0) +
      '</div>' +
      '<p class="muted about-backup-tip">💾 ' + backupTip + '</p>' +
      '<p><b>快捷键</b>：数字键 1-6 快速切换模块；聊天框输入 <code>/</code> 打开命令面板</p>' +
      '<p><b>数据安全</b>：纯前端本地版，所有数据仅保存在你自己的浏览器（localStorage）中，不上传任何服务器；清除浏览器数据即永久删除。</p>' +
      '<p><b>AI 原则</b>：所有内容基于你的输入生成，绝不虚构经历与数据。</p>' +
      '<div class="modal-actions"><button class="btn btn-ghost" id="about-backup">💾 去导出备份</button><button class="btn btn-primary" onclick="closeModal()">知道了</button></div>');
    const aboutBackupBtn = $('#about-backup');
    if (aboutBackupBtn) aboutBackupBtn.addEventListener('click', () => { closeModal(); switchView('export'); });
  });
  $('#btn-reset').addEventListener('click', resetAll);

  /* GAP-E1 意见反馈 */
  $('#btn-feedback').addEventListener('click', e => {
    e.preventDefault();
    openModal('<h3>意见反馈</h3><p>你的建议会帮助我们做得更好，纯前端版反馈仅保存在本地浏览器，不会发送到任何服务器。</p>' +
      '<textarea class="report-preview" id="fb-content" rows="5" placeholder="遇到的问题 / 建议 / 吐槽…"></textarea>' +
      '<div class="form-group"><label class="form-label">联系方式（可选）</label><input class="form-input" id="fb-contact" maxlength="120" placeholder="邮箱 / 微信，便于我们回复"></div>' +
      '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">取消</button><button class="btn btn-primary" id="fb-submit">提交反馈</button></div>');
    $('#fb-submit').addEventListener('click', () => {
      const content = $('#fb-content').value.trim();
      const contact = $('#fb-contact').value.trim();
      if (!content) { toast('请输入反馈内容', 'error'); return; }
      const btn = $('#fb-submit');
      btn.disabled = true;
      try {
        const list = JSON.parse(localStorage.getItem('ai-resume-feedback-v1') || '[]');
        list.unshift({ content: content, contact: contact, createdAt: new Date().toISOString() });
        localStorage.setItem('ai-resume-feedback-v1', JSON.stringify(list.slice(0, 200)));
        closeModal();
        toast('反馈已保存在本地浏览器（纯前端版不联网）🙏', 'success');
      } catch (e) {
        btn.disabled = false;
        toast('保存失败，请稍后再试', 'error');
      }
    });
  });

  /* ---------- 对话 ---------- */
  const chatText = $('#chat-text');
  $('#chat-send').addEventListener('click', sendChat);

  /* 语音输入（Web Speech API，支持的浏览器可用） */
  const micBtn = $('#chat-mic');
  if (window.SpeechRecognition || window.webkitSpeechRecognition) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    let rec = null, listening = false;
    micBtn.addEventListener('click', () => {
      if (listening) { rec.stop(); return; }
      rec = new SR();
      rec.lang = 'zh-CN';
      rec.interimResults = false;
      rec.onresult = e => { chatText.value = e.results[0][0].transcript; chatText.focus(); };
      rec.onend = () => { listening = false; micBtn.innerHTML = icon('mic'); };
      rec.onerror = () => { listening = false; micBtn.innerHTML = icon('mic'); };
      rec.start();
      listening = true;
      micBtn.innerHTML = icon('micOff');
    });
  } else {
    micBtn.hidden = true;
  }

  /* 阶段进度条可点击回跳 */
  $$('.cstage').forEach(el => el.addEventListener('click', () => {
    const g = el.dataset.s;
    const map = { basic: 'contact', edu: 'edu', exp: 'exp_type', skill: 'skill', intent: 'intention' };
    const target = map[g];
    if (!target) return;
    const status = Chat.stageStatus();
    const curGroup = Chat.progress().group;
    if (!status[g] && g !== curGroup) { toast('该模块还未开始'); return; }
    S.chat.stage = target;
    if (target === 'intention') S.chat.pendingIntent = 'position';
    S.chat.messages.push({ role: 'ai', text: '好的，回到「' + (STAGE_LABEL[target] || '该') + '」环节，直接告诉我需要修改的内容，或回复「跳过」继续。' });
    saveState();
    renderChat();
  }));
  chatText.addEventListener('keydown', e => {
    if (e.isComposing) return; // 中文输入法选词时不发送
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });
  chatText.addEventListener('input', () => {
    chatText.style.height = 'auto';
    chatText.style.height = Math.min(120, chatText.scrollHeight) + 'px';
    renderCommandPalette(chatText.value);
  });
  chatText.addEventListener('keydown', e => {
    if (e.key === 'Escape') hideCommandPalette();
  });
  chatText.addEventListener('blur', () => setTimeout(hideCommandPalette, 150));
  $('#btn-to-generate').addEventListener('click', () => {
    ensureVersion();
    syncResumeToVersion();
    saveState();
    switchView('generate');
    // 生成动画由 renderGenerate 内部触发
    setTimeout(() => toast('简历已生成 🎉 可点击段落直接编辑', 'success'), 1000);
  });
  $('#btn-export-chat').addEventListener('click', exportChat);
  $('#btn-collapse-side').addEventListener('click', () => {
    const panel = $('#extract-panel');
    const btn = $('#btn-collapse-side');
    panel.hidden = !panel.hidden;
    btn.textContent = panel.hidden ? '展开' : '收起';
  });

  /* ---------- 智能生成 ---------- */
  $('#btn-apply-all').addEventListener('click', applyAllSuggestions);
  $('#btn-ignore-all').addEventListener('click', ignoreAllSuggestions);
  $('#btn-regen').addEventListener('click', () => {
    const editedCount = (S.editedPaths || []).length;
    openModal('<h3>重新生成全部内容？</h3><p>将基于对话收集的原始信息重新生成全部表述。</p>' +
      '<label style="display:flex;align-items:center;gap:8px;font-weight:600"><input type="checkbox" id="keep-edits" checked> 保留我手动修改过的段落（' + editedCount + ' 处）</label>' +
      '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">取消</button><button class="btn btn-primary" id="confirm-regen">确认重新生成</button></div>');
    $('#confirm-regen').addEventListener('click', () => {
      const keep = $('#keep-edits').checked;
      const edited = new Set(keep ? (S.editedPaths || []) : []);
      closeModal();
      showGenLoading();
      setTimeout(() => {
        (S.resume.experiences || []).forEach(e => {
          const paths = (e.bullets || []).map((_, i) => 'exp.' + e.id + '.bullets.' + i);
          if (!paths.some(p => edited.has(p))) e.bullets = buildBullets(e);
        });
        S.generated = true;
        syncResumeToVersion();
        saveState();
        if (window.Store && Store.bumpStat) Store.bumpStat('generations');
        renderGenerateNow();
        toast(keep && editedCount ? '已重新生成，保留 ' + editedCount + ' 处手动修改 🔄' : '已基于原始对话数据重新生成 🔄', 'success');
      }, 700);
    });
  });
  $('#btn-add-module').addEventListener('click', () => {
    openModal('<h3>添加模块</h3><p>为简历补充一个模块：</p>' +
      '<div class="modal-actions" style="flex-wrap:wrap">' +
      '<button class="btn btn-ghost" id="add-summary">自我评价</button>' +
      '<button class="btn btn-ghost" id="add-skill">技能</button>' +
      '<button class="btn btn-ghost" id="add-exp">添加经历（对话补充）</button>' +
      '<button class="btn btn-ghost" id="add-custom">添加自定义模块（证书/荣誉等）</button>' +
      '<button class="btn btn-ghost" onclick="closeModal()">取消</button></div>');
    $('#add-summary').addEventListener('click', () => {
      if (S.resume.summary) { toast('已有自我评价'); closeModal(); return; }
      S.resume.summary = buildSummary(S.resume);
      syncResumeToVersion(); saveState(); closeModal(); renderGenerate();
      toast('自我评价已添加 ✅', 'success');
    });
    $('#add-skill').addEventListener('click', () => {
      const all = (S.resume.experiences || []).map(e => e.title + ' ' + e.desc + ' ' + (e.bullets || []).join(' ')).join(' ');
      const techs = extractTech(all);
      if (techs.length) { mergeSkills(S.resume, techs); syncResumeToVersion(); saveState(); closeModal(); renderGenerate(); toast('已自动提取 ' + techs.length + ' 项技能', 'success'); }
      else { closeModal(); switchView('chat'); toast('先补充经历，我才能提取技能'); }
    });
    $('#add-custom').addEventListener('click', () => { closeModal(); addCustomFlow(); });
    $('#add-exp').addEventListener('click', () => {
      closeModal();
      S.chat.stage = 'exp_type';
      S.chat.quick = [['实习经历','实习经历'],['项目经历','项目经历'],['竞赛获奖','竞赛获奖'],['社团活动','社团活动']];
      S.chat.messages.push({ role: 'ai', text: '好的，想补充一段什么经历？可以告诉我类型，也可以直接描述你做过什么。' });
      saveState();
      switchView('chat');
    });
  });

  /* ---------- 模板设置 ---------- */
  $$('#font-size-seg button').forEach(b => b.addEventListener('click', () => {
    S.settings.fontSize = b.dataset.v;
    saveState();
    renderTemplate();
  }));
  $$('#font-family-seg button').forEach(b => b.addEventListener('click', () => {
    S.settings.fontFamily = b.dataset.v;
    saveState();
    renderTemplate();
  }));
  $('#line-height-slider').addEventListener('input', e => {
    S.settings.lineHeight = Number(e.target.value);
    $('#line-height-val').textContent = S.settings.lineHeight.toFixed(1);
    saveState();
    renderTplSheet();
  });
  $('#photo-toggle').addEventListener('change', e => {
    S.settings.showPhoto = e.target.checked;
    if (e.target.checked && !S.resume.photoUrl) {
      toast('已开启照片栏（当前为姓名首字母占位），点击「上传头像」上传真实照片');
    }
    if (!e.target.checked) S.resume.photoUrl = '';
    saveState();
    renderTemplate();
  });

  /* ---------- 诊断 ---------- */
  $('#btn-rediag').addEventListener('click', () => {
    $('#btn-rediag').textContent = '🔄 重新诊断';
    showDiagScan();
  });
  $('#btn-export-report').addEventListener('click', exportDiagnosisReport);
  $('#btn-ats-preview').addEventListener('click', showAtsPreview);
  $('#btn-text-check').addEventListener('click', () => {
    renderTextCheck();
    const el = $('#text-check-list');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  /* ---------- 岗位匹配 ---------- */
  $('#btn-jd-sample').addEventListener('click', () => { $('#jd-text').value = DEMO_JD; });
  $('#btn-jd-compare').addEventListener('click', renderJdCompare);
  $('#btn-jd-ocr').addEventListener('click', () => $('#jd-ocr-input').click());
  $('#btn-cover-letter').addEventListener('click', () => showCoverLetter($('#jd-text').value));
  $('#btn-job-email').addEventListener('click', () => showJobEmail($('#jd-text').value));
  $('#btn-interview').addEventListener('click', () => showInterviewQuestions($('#jd-text').value));
  $('#jd-ocr-input').addEventListener('change', e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      /* GAP-C5：调后端 OCR（可配置视觉模型）；失败明确提示并引导手动粘贴 */
      if (!window.Auth || !Auth.api) {
        openModal('<h3>截图识别</h3><p>OCR 服务未配置，请手动将 JD 文本粘贴到上方输入框。</p><div class="modal-actions"><button class="btn btn-primary" onclick="closeModal()">知道了</button></div>');
        return;
      }
      toast('正在识别 JD 截图…');
      Auth.api('/ocr/jd', { method: 'POST', body: JSON.stringify({ imageBase64: dataUrl }) }).then(res => {
        const text = (res && res.text) || '';
        if (!text) throw new Error('未识别到文字');
        $('#jd-text').value = text;
        closeModal();
        toast('OCR 识别成功，已填入 JD 输入框 ✅', 'success');
      }).catch(err => {
        openModal('<h3>截图识别未成功</h3><img src="' + dataUrl + '" style="width:100%;border-radius:10px;margin:8px 0" alt="JD 截图">' +
          '<p>' + esc(err && err.message ? err.message : '识别失败') + '，请手动将 JD 文本粘贴到上方输入框。</p>' +
          '<div class="modal-actions"><button class="btn btn-primary" onclick="closeModal()">知道了</button></div>');
      });
    };
    reader.readAsDataURL(file);
  });
  $('#btn-jd-analyze').addEventListener('click', () => {
    const text = $('#jd-text').value.trim();
    if (!text) { toast('请先粘贴或输入 JD 内容', 'error'); return; }
    const btn = $('#btn-jd-analyze');
    btn.textContent = '正在解析岗位要求…';
    btn.disabled = true;
    setTimeout(() => {
      const result = analyzeJD(text);
      const id = uid('jd');
      S.jdAnalyses.unshift({ id, jdText: text, result });
      S.jdAnalyses = S.jdAnalyses.slice(0, 6);
      saveState();
      renderJd();
      renderJdResult(result);
      btn.textContent = '分析匹配度';
      btn.disabled = false;
      toast('分析完成：匹配度 ' + result.overall + '%', result.overall >= 60 ? 'success' : '');
      if (window.AIRemote && AIRemote.ready()) {
        const aiBox = addAiPanel('ai-jd-box', 'AI 岗位匹配深度分析（DeepSeek）', '正在调用 DeepSeek 分析岗位匹配度…', '#jd-result');
        if (aiBox) {
          AIRemote.call('jd', [{ role: 'user', content: '以下是岗位 JD 和我的简历信息，请分析匹配度：总体匹配百分比、我的优势、差距，以及 3-5 条补足建议。\n\nJD：\n' + text + '\n\n简历：\n' + resumeBriefForAI() }], null)
            .then(function (t) { setAiPanelDone(aiBox, t, 'DeepSeek'); })
            .catch(function () { removeEl('ai-jd-box'); });
        }
      }
    }, 900);
  });

  /* ---------- 导出与版本 ---------- */
  $$('.export-card').forEach(card => card.addEventListener('click', () => {
    card.classList.add('flash');
    setTimeout(() => card.classList.remove('flash'), 1200);
    const f = card.dataset.format;
    if (f === 'pdf') exportPdf();
    else if (f === 'doc') exportDoc();
    else if (f === 'url') exportUrl();
    else if (f === 'ats') exportAtsText();
    else if (f === 'app') exportStandaloneApp();
  }));
  $('#btn-new-version').addEventListener('click', createVersionFlow);
  $('#btn-compare-versions').addEventListener('click', compareVersions);
  $('#btn-tpl-full').addEventListener('click', previewTplFull);
  $('#btn-delivery-csv').addEventListener('click', exportDeliveryCsv);
  $('#btn-backup-export').addEventListener('click', exportBackup);
  $('#btn-backup-import').addEventListener('click', () => $('#backup-file').click());
  $('#backup-file').addEventListener('change', e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => importBackup(String(reader.result));
    reader.readAsText(file);
  });

  /* 右键版本项也支持菜单（PRD：右键操作菜单） */
  document.addEventListener('contextmenu', e => {
    const item = e.target.closest('.version-item');
    if (item) {
      e.preventDefault();
      const v = S.versions.find(x => x.id && item.textContent.includes(x.name));
      const rect = e.target.getBoundingClientRect();
      if (v) showContextMenu(e.clientX, e.clientY, [
        { label: '重命名', action: () => renameVersion(v) },
        { label: '复制版本', action: () => duplicateVersion(v) },
        { label: v.status === 'submitted' ? '标记为草稿' : '标记为已投递', action: () => markSubmitted(v) },
        { label: '删除版本', danger: true, action: () => deleteVersion(v) }
      ]);
    }
  });

  /* 快捷键 1-6 切换模块（输入态不触发） */
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 6) {
      switchView(['chat', 'generate', 'template', 'diagnosis', 'jd', 'export'][n - 1]);
    }
  });

  /* 初始渲染 + 首访引导 */
  renderAll();
  setTimeout(showOnboarding, 350);
});

/* 导出诊断报告（弹窗预览 + 下载 .txt） */
function exportDiagnosisReport() {
  const d = diagnoseResume();
  const lines = [];
  lines.push('一键上岸 · 简历诊断报告');
  lines.push('生成时间：' + new Date().toLocaleString('zh-CN'));
  lines.push('总分：' + d.total + ' / 100');
  lines.push('');
  lines.push('【六维评分】');
  d.dims.forEach(x => lines.push('· ' + x.name + '：' + d.scores[x.key] + ' / 100（权重 ' + Math.round(x.weight * 100) + '%）'));
  lines.push('');
  lines.push('【问题清单】');
  d.issues.forEach((it, i) => lines.push((i + 1) + '. [' + ({ high: '高', medium: '中', low: '低' }[it.level]) + '] ' + it.title + ' —— ' + it.desc));
  const tc = contentCheck(S.resume);
  lines.push('');
  lines.push('【文字与格式体检】');
  lines.push('体检评分：' + tc.score + ' / 100');
  tc.issues.forEach((it, i) => lines.push((i + 1) + '. [' + ({ high: '高', medium: '中', low: '低' }[it.level]) + '] ' + it.title + ' —— ' + it.desc));
  const text = lines.join('\n');
  openModal('<h3>诊断报告</h3><p>总分 ' + d.total + ' / 100 · 文字体检 ' + tc.score + ' / 100，可下载为 .txt 或带样式的 HTML 报告。</p>' +
    '<textarea readonly class="report-preview" rows="12">' + esc(text) + '</textarea>' +
    '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">关闭</button><button class="btn btn-ghost" id="dl-report-html">下载 HTML</button><button class="btn btn-primary" id="dl-report">下载 .txt</button></div>');
  $('#dl-report').addEventListener('click', () => {
    downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), '简历诊断报告-' + todayStr() + '.txt');
    toast('报告已下载 📄', 'success');
  });
  $('#dl-report-html').addEventListener('click', () => { closeModal(); exportDiagnosisReportHtml(); });
}

/* 诊断报告 HTML 版（带样式，可打印/分享） */
function exportDiagnosisReportHtml() {
  const d = diagnoseResume();
  const tc = contentCheck(S.resume);
  const lv = { high: '高', medium: '中', low: '低' };
  const dims = d.dims.map(x =>
    '<div class="dim"><div class="dim-head"><b>' + esc(x.name) + '</b><span>' + d.scores[x.key] + ' / 100</span></div><div class="bar"><i style="width:' + d.scores[x.key] + '%"></i></div></div>'
  ).join('');
  const issues = d.issues.map(it => '<li><b>[' + lv[it.level] + ']</b> ' + esc(it.title) + ' —— ' + esc(it.desc) + '</li>').join('');
  const tcIssues = tc.issues.map(it => '<li><b>[' + lv[it.level] + ']</b> ' + esc(it.title) + ' —— ' + esc(it.desc) + '</li>').join('');
  const css = 'body{font-family:"PingFang SC","Microsoft YaHei",sans-serif;background:#f4f6f8;color:#223344;margin:0;padding:28px 16px;line-height:1.8}.card{max-width:760px;margin:0 auto;background:#fff;border:1px solid #e3e8ee;border-radius:16px;padding:28px 30px;box-shadow:0 10px 30px rgba(20,40,60,.08)}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:22px 0 10px;color:#1f4e3f;border-bottom:2px solid #2d9d78;padding-bottom:4px}.total{font-size:34px;font-weight:900;color:#2d9d78}.dim{margin-bottom:10px}.dim-head{display:flex;justify-content:space-between;font-size:13px}.bar{height:8px;background:#edf1f4;border-radius:6px;overflow:hidden;margin-top:4px}.bar i{display:block;height:100%;background:linear-gradient(90deg,#2d9d78,#4b7ef0);border-radius:6px}ul{padding-left:20px;margin:6px 0}li{margin-bottom:6px;font-size:13.5px}.foot{color:#99a2ab;font-size:12px;text-align:center;margin-top:18px}';
  const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>简历诊断报告</title><style>' + css + '</style></head><body><div class="card">' +
    '<h1>简历诊断报告</h1><p style="color:#888;font-size:12.5px">生成时间：' + new Date().toLocaleString('zh-CN') + '</p>' +
    '<p>总分 <span class="total">' + d.total + '</span> / 100 · 文字体检 <span class="total">' + tc.score + '</span> / 100</p>' +
    '<h2>六维评分</h2>' + dims +
    '<h2>问题清单</h2>' + (issues ? '<ul>' + issues + '</ul>' : '<p>暂无问题 ✅</p>') +
    '<h2>文字与格式体检</h2>' + (tcIssues ? '<ul>' + tcIssues + '</ul>' : '<p>未发现问题 ✅</p>') +
    '<div class="foot">由「一键上岸」纯前端本地版生成 · 数据仅保存在本机浏览器</div>' +
    '</div></body></html>';
  downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), '简历诊断报告-' + todayStr() + '.html');
  toast('诊断报告 HTML 已导出 ✅', 'success');
  if (window.Store && Store.bumpStat) Store.bumpStat('exports');
}

/* 单文件版：把整个工具内联为 1 个 HTML（双击即用，方便发给别人） */
async function exportStandaloneApp() {
  toast('正在打包单文件版…', 'success');
  try {
    const srcs = [
      ['index.html', 'index'],
      ['css/style.css', 'css'],
      ['js/icons.js', 'icons'],
      ['js/data.js', 'data'],
      ['js/auth.js', 'auth'],
      ['js/store.js', 'store'],
      ['js/ai.js', 'ai'],
      ['js/ai-remote.js', 'aiRemote'],
      ['js/docx.js', 'docx'],
      ['js/ui.js', 'ui'],
      ['js/app.js', 'app'],
      ['js/effects.js', 'effects']
    ];
    const loaded = {};
    await Promise.all(srcs.map(async s => { loaded[s[1]] = await fetch(s[0]).then(r => r.text()); }));
    const S_OPEN = '<scr' + 'ipt>';
    const S_CLOSE = '<' + '/scr' + 'ipt>';
    const escScript = t => t.split('</scr' + 'ipt>').join('<\\/scr' + 'ipt>');
    let out = loaded.index;
    out = out.replace('<link rel="stylesheet" href="css/style.css">', '<style>' + loaded.css + '</style>');
    const jsMap = { 'js/icons.js': loaded.icons, 'js/data.js': loaded.data, 'js/auth.js': loaded.auth, 'js/store.js': loaded.store, 'js/ai.js': loaded.ai, 'js/ai-remote.js': loaded.aiRemote, 'js/docx.js': loaded.docx, 'js/ui.js': loaded.ui, 'js/app.js': loaded.app, 'js/effects.js': loaded.effects };
    Object.keys(jsMap).forEach(src => {
      const tag = '<script src="' + src + '">' + S_CLOSE;
      out = out.split(tag).join(S_OPEN + escScript(jsMap[src]) + S_CLOSE);
    });
    downloadBlob(new Blob([out], { type: 'text/html;charset=utf-8' }), '一键上岸-单文件版.html');
    toast('单文件版已导出 ✅ 双击即可使用（数据仍只存本机）', 'success');
    if (window.Store && Store.bumpStat) Store.bumpStat('exports');
  } catch (e) {
    toast('打包失败：请先通过本地服务（python -m http.server）打开再导出', 'error');
  }
}

/* JSON 备份导出/导入 */
async function exportBackup() {
  const data = {
    app: 'ai-resume-agent',
    version: 1,
    exportedAt: new Date().toISOString(),
    state: {
      resume: S.resume,
      settings: S.settings,
      versions: S.versions,
      currentVersionId: S.currentVersionId,
      jdAnalyses: S.jdAnalyses,
      editedPaths: S.editedPaths || []
    }
  };
  const text = JSON.stringify(data, null, 2);
  const name = '简历数据备份-' + todayStr() + '.json';
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: 'JSON 备份', accept: { 'application/json': ['.json'] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      toast('备份已保存到本地文件 ✅', 'success');
      if (window.Store && Store.bumpStat) Store.bumpStat('backups');
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return; // 用户取消选择
      /* 其他错误回退普通下载 */
    }
  }
  downloadBlob(new Blob([text], { type: 'application/json' }), name);
  toast('备份已导出 ✅', 'success');
  if (window.Store && Store.bumpStat) Store.bumpStat('backups');
}

function importBackup(jsonText) {
  let data = null;
  try {
    data = JSON.parse(jsonText);
    if (!data || data.app !== 'ai-resume-agent' || !data.state) throw new Error('bad format');
  } catch (e) {
    toast('导入失败：文件格式不正确', 'error');
    return;
  }
  const st = data.state || {};
  const expCount = ((st.resume || {}).experiences || []).length;
  const skillCount = flatSkills(st.resume || {}).length;
  const exportedAt = data.exportedAt ? new Date(data.exportedAt).toLocaleString('zh-CN') : '未知';
  const versionNames = (st.versions || []).slice(0, 3).map(v => v.name).filter(Boolean).join('、');
  openModal('<h3>确认导入备份</h3>' +
    '<p>将用备份数据<b>覆盖</b>当前简历（当前数据会丢失，建议先导出当前备份再导入）。</p>' +
    '<div class="imp-summary">' +
    '<div><b>' + ((st.versions || []).length) + '</b><small>版本</small></div>' +
    '<div><b>' + expCount + '</b><small>经历</small></div>' +
    '<div><b>' + skillCount + '</b><small>技能</small></div>' +
    '</div>' +
    '<p class="muted" style="font-size:12.5px;margin:8px 0 0">导出时间：' + exportedAt + (versionNames ? '<br>包含版本：' + esc(versionNames) + (((st.versions || []).length) > 3 ? ' 等 ' + (st.versions || []).length + ' 个' : '') : '') + '</p>' +
    '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">取消</button><button class="btn btn-primary" id="confirm-import">确认导入</button></div>');
  $('#confirm-import').addEventListener('click', () => { closeModal(); applyImport(data); });
}

function applyImport(data) {
  try {
    const st = data.state;
    S.resume = Object.assign(emptyResume(), st.resume || {});
    S.resume.education = Object.assign({ school:'', major:'', degree:'', gradDate:'' }, st.resume && st.resume.education || {});
    S.resume.intention = Object.assign({ position:'', city:'', salary:'' }, st.resume && st.resume.intention || {});
    S.settings = Object.assign(S.settings, st.settings || {});
    S.versions = Array.isArray(st.versions) ? st.versions : [];
    S.currentVersionId = st.currentVersionId || (S.versions[0] && S.versions[0].id) || '';
    S.jdAnalyses = Array.isArray(st.jdAnalyses) ? st.jdAnalyses : [];
    S.editedPaths = Array.isArray(st.editedPaths) ? st.editedPaths : [];
    S.generated = true;
    saveState();
    renderAll();
    const expCount = (S.resume.experiences || []).length;
    const skillCount = flatSkills(S.resume).length;
    toast('备份已导入 ✅（版本 ' + S.versions.length + ' · 经历 ' + expCount + ' · 技能 ' + skillCount + '）', 'success');
  } catch (e) {
    toast('导入失败：文件格式不正确', 'error');
  }
}








/* 照片压缩：限制最长边并转 JPEG，避免 localStorage 超限 */
function compressImageToDataUrl(file, maxSide, cb) {
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    try {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * scale));
      c.height = Math.max(1, Math.round(img.height * scale));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      cb(c.toDataURL('image/jpeg', 0.85));
    } catch (e) { cb(null); }
    URL.revokeObjectURL(url);
  };
  img.onerror = () => { URL.revokeObjectURL(url); cb(null); };
  img.src = url;
}









