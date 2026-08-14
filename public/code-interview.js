/**
 * 代码面试模块
 * AI 生成编程题 + AI 代码审查
 * 编辑器：textarea 降级方案（无外部依赖）
 */
(function() {
  'use strict';

  var state = {
    question: null,
    language: 'javascript',
    reviewing: false
  };

  function $(sel) { return document.querySelector(sel); }

  // ─── 初始化 ───────────────────────────────────────────

  function init() {
    var genBtn = $('#ci-generate-btn');
    var submitBtn = $('#ci-submit-btn');
    var hintBtn = $('#ci-hint-btn');
    var langSelect = $('#ci-language');

    if (genBtn) genBtn.onclick = generateQuestion;
    if (submitBtn) submitBtn.onclick = submitCode;
    if (hintBtn) hintBtn.onclick = showHint;
    if (langSelect) langSelect.onchange = function() { state.language = this.value; };
  }

  // ─── 生成题目 ────────────────────────────────────────

  async function generateQuestion() {
    var btn = $('#ci-generate-btn');
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = '生成中...';

    // 清空之前的审查结果
    var reviewArea = $('#ci-review-area');
    if (reviewArea) reviewArea.innerHTML = '<div class="ci-empty">提交代码后查看 AI 审查结果</div>';

    try {
      var data = await window.Auth.apiCall('POST', '/code-interview/generate', {
        language: state.language
      });
      state.question = data;
      renderQuestion(data);
      ensureEditor();
      // 清空编辑器
      var editor = $('#ci-code-editor');
      if (editor) editor.value = '';
    } catch (e) {
      var msg = e.message || '生成失败';
      if (msg.includes('402') || msg.includes('点数不足')) {
        msg = '点数不足，请购买点数后继续使用';
      }
      toast(msg);
    } finally {
      btn.disabled = false;
      btn.textContent = '生成题目';
    }
  }

  function renderQuestion(q) {
    var area = $('#ci-question-area');
    if (!area) return;

    var diffClass = 'ci-difficulty-' + (q.difficulty || 'medium');
    var examplesHTML = '';

    if (q.examples && q.examples.length > 0) {
      examplesHTML = '<p><strong>示例:</strong></p>' + q.examples.map(function(ex, i) {
        return '<div class="ci-example"><strong>示例 ' + (i + 1) + ':</strong>' +
          '<div><strong>输入:</strong> <code>' + escHtml(String(ex.input)) + '</code></div>' +
          '<div><strong>输出:</strong> <code>' + escHtml(String(ex.output)) + '</code></div>' +
          (ex.explanation ? '<div><em>' + escHtml(ex.explanation) + '</em></div>' : '') +
          '</div>';
      }).join('');
    }

    var constraintsHTML = '';
    if (q.constraints && q.constraints.length > 0) {
      constraintsHTML = '<p><strong>约束条件:</strong></p><ul>' +
        q.constraints.map(function(c) { return '<li>' + escHtml(c) + '</li>'; }).join('') + '</ul>';
    }

    var hintsHTML = '';
    if (q.hints && q.hints.length > 0) {
      hintsHTML = '<p style="margin-top:8px;color:var(--text-secondary);font-size:12px;">💡 ' + q.hints.length + ' 个提示可用，点击下方「提示」按钮查看</p>';
    }

    area.innerHTML = '<h4>' + escHtml(q.title || '编程题') +
      ' <span class="ci-difficulty ' + diffClass + '">' + escHtml(q.difficulty || 'medium') + '</span></h4>' +
      '<p>' + escHtml(q.description || '') + '</p>' +
      (q.inputFormat ? '<p><strong>输入格式:</strong> ' + escHtml(q.inputFormat) + '</p>' : '') +
      (q.outputFormat ? '<p><strong>输出格式:</strong> ' + escHtml(q.outputFormat) + '</p>' : '') +
      constraintsHTML + examplesHTML + hintsHTML;
  }

  function ensureEditor() {
    var container = $('#ci-editor-container');
    if (!container) return;
    // 使用 textarea 作为编辑器（无外部依赖）
    if (!document.getElementById('ci-code-editor')) {
      container.innerHTML = '<textarea id="ci-code-editor" ' +
        'style="width:100%;height:100%;background:#1e1e2e;color:#e2e8f0;border:none;padding:16px;' +
        'font-family:Consolas,\'Courier New\',monospace;font-size:14px;line-height:1.6;resize:none;' +
        'outline:none;tab-size:4;" ' +
        'placeholder="// 在此编写 ' + state.language.toUpperCase() + ' 代码...\n// 支持 Tab 缩进\n// Ctrl+Enter 提交代码" ' +
        'spellcheck="false"></textarea>';
      var editor = $('#ci-code-editor');
      if (editor) {
        // 支持 Tab 键缩进
        editor.addEventListener('keydown', function(e) {
          if (e.key === 'Tab') {
            e.preventDefault();
            var start = this.selectionStart;
            var end = this.selectionEnd;
            this.value = this.value.substring(0, start) + '    ' + this.value.substring(end);
            this.selectionStart = this.selectionEnd = start + 4;
          }
          if (e.key === 'Enter' && e.ctrlKey) {
            e.preventDefault();
            submitCode();
          }
        });
      }
    }
  }

  function getCode() {
    var editor = document.getElementById('ci-code-editor');
    return editor ? editor.value : '';
  }

  // ─── 提交代码审查 ────────────────────────────────────

  async function submitCode() {
    if (state.reviewing) return;

    var code = getCode();
    if (!code.trim()) { toast('请先编写代码'); return; }
    if (!state.question) { toast('请先生成题目'); return; }
    if (code.trim().length < 10) { toast('代码太短，请至少写几行'); return; }

    state.reviewing = true;
    var btn = $('#ci-submit-btn');
    if (btn) { btn.disabled = true; btn.textContent = '审查中...'; }

    try {
      var result = await window.Auth.apiCall('POST', '/code-interview/review', {
        question: state.question,
        code: code,
        language: state.language
      });
      renderReview(result);

      // 保存历史
      try {
        await window.Auth.apiCall('POST', '/code-interview/history', {
          question: state.question,
          code: code,
          language: state.language,
          review: result
        });
      } catch (e) { /* 静默失败 */ }
    } catch (e) {
      var msg = e.message || '审查失败';
      if (msg.includes('402') || msg.includes('点数不足')) {
        msg = '点数不足，请购买点数后继续使用';
      }
      toast(msg);
    } finally {
      state.reviewing = false;
      if (btn) { btn.disabled = false; btn.textContent = '📝 提交审查'; }
    }
  }

  function renderReview(result) {
    var area = $('#ci-review-area');
    if (!area) return;

    var dims = result.dimensions || {};
    var dimNames = {
      correctness: '正确性', codeQuality: '代码质量',
      efficiency: '算法效率', edgeCases: '边界处理'
    };

    var dimsHTML = Object.keys(dimNames).map(function(key) {
      var d = dims[key] || {};
      var score = d.score || 0;
      var color = score >= 80 ? '#22c55e' : score >= 60 ? '#f59e0b' : '#ef4444';
      return '<div class="ci-review-dimension">' +
        '<span>' + dimNames[key] + '</span>' +
        '<span style="color:' + color + ';font-weight:600;">' + score + '分</span>' +
        '</div>' +
        '<div class="ci-review-bar"><div class="ci-review-bar-fill" style="width:' + score + '%;background:' + color + ';"></div></div>' +
        '<p style="font-size:12px;color:var(--text-secondary);margin:4px 0 12px;">' + escHtml(d.comment || '') + '</p>';
    }).join('');

    var overallScore = result.overallScore || 0;
    var scoreColor = overallScore >= 80 ? '#22c55e' : overallScore >= 60 ? '#f59e0b' : '#ef4444';

    area.innerHTML = '<div class="ci-review-score" style="color:' + scoreColor + ';">' + overallScore + '</div>' +
      '<p style="text-align:center;color:var(--text-secondary);font-size:13px;">综合评分</p>' +
      dimsHTML +
      (result.strengths && result.strengths.length ? '<h4>✅ 优点</h4><ul>' + result.strengths.map(function(s) { return '<li>' + escHtml(s) + '</li>'; }).join('') + '</ul>' : '') +
      (result.improvements && result.improvements.length ? '<h4>🔧 改进建议</h4><ul>' + result.improvements.map(function(s) { return '<li>' + escHtml(s) + '</li>'; }).join('') + '</ul>' : '') +
      (result.complexityAnalysis ? '<p><strong>复杂度:</strong> ' + escHtml(result.complexityAnalysis) + '</p>' : '') +
      (result.overallComment ? '<p><strong>综合评价:</strong> ' + escHtml(result.overallComment) + '</p>' : '') +
      (result.optimizedCode ? '<h4>📝 优化建议代码</h4><pre class="ci-optimized-code">' + escHtml(result.optimizedCode) + '</pre>' : '');
  }

  // ─── 提示 ────────────────────────────────────────────

  var hintIndex = 0;

  function showHint() {
    if (!state.question || !state.question.hints || state.question.hints.length === 0) {
      toast('暂无提示');
      return;
    }
    toast('💡 ' + state.question.hints[hintIndex]);
    hintIndex = (hintIndex + 1) % state.question.hints.length;
  }

  // ─── 工具函数 ─────────────────────────────────────────

  function escHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  function toast(msg) {
    if (typeof window.toast === 'function') {
      window.toast(msg);
      return;
    }
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:2rem;left:50%;transform:translateX(-50%);background:#1a1a2e;color:#fff;padding:0.6rem 1.5rem;border-radius:8px;z-index:9999;font-size:0.85rem;pointer-events:none;';
    document.body.appendChild(t);
    setTimeout(function() { t.remove(); }, 2500);
  }

  // ─── 暴露全局 API ─────────────────────────────────────

  window.CodeInterview = { init: init };

})();