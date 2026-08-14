// ============================================================
// 一键上岸 - Frontend App (v2)
// ============================================================

const API = '/api';
// HTML 转义
function escapeHtml(str) {
  if (!str) return '';
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}


// 防抖工具函数
function debounce(fn, ms = 300) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

// 暗色模式（默认日光模式，仅用户手动切换后才启用暗色）
(function() {
  const saved = localStorage.getItem('darkMode');
  if (saved === '1') {
    document.documentElement.classList.add('dark');
  }
  const btn = document.getElementById('btn-dark-toggle');
  if (btn) {
    const update = () => {
      const dark = document.documentElement.classList.contains('dark');
      btn.textContent = dark ? '\u2600\uFE0F' : '\uD83C\uDF19';
      localStorage.setItem('darkMode', dark ? '1' : '0');
    };
    update();
    btn.addEventListener('click', () => {
      document.documentElement.classList.toggle('dark');
      update();
    });
  }
})();

// 全局 fetch 重试包装器（LLM API 错误时自动处理）
async function fetchRetry(url, options = {}, retries = 2) {
  // 自动注入认证 token
  var opts = Object.assign({}, options);
  if (window.Auth && window.Auth.getToken()) {
    opts.headers = Object.assign({}, opts.headers || {});
    opts.headers['Authorization'] = 'Bearer ' + window.Auth.getToken();
  }
  for (let i = 0; i <= retries; i++) {
    try {
      const resp = await fetch(url, opts);
      if (!resp.ok) {
        // 处理 402 点数不足
        if (resp.status === 402) {
          const err = await resp.json().catch(() => ({ error: '点数不足' }));
          if (err.code === 'INSUFFICIENT_CREDITS') {
            toast('点数不足，请购买点数后继续使用');
            // 触发打开购买弹窗
            if (window.Auth && typeof window.Auth.openPlansModal === 'function') {
              setTimeout(function() { window.Auth.openPlansModal(); }, 500);
            }
          }
          throw new Error(err.error || '点数不足');
        }
        const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
        throw new Error(err.error || `请求失败 (${resp.status})`);
      }
      return resp;
    } catch (e) {
      if (i < retries && (e.message.includes('网络') || e.message.includes('Network') || e.message.includes('fetch'))) {
        toast(`⏳ 第 ${i+1} 次重试...`);
        await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        continue;
      }
      throw e;
    }
  }
}

let state = {
  sessionId: null,
  analysis: null,
  interviewActive: false,
  stressInterviewActive: false,
  freePracticeActive: false,
  multiRoundActive: false,
  _multiRoundCurrent: 1,
  _multiRoundTotal: 3,
  _practiceQuestion: null,
  _lastFeedback: null,
  jdText: '',
  resumeText: '',
  resumeFileName: '',
  resumeSourceType: '',
  _drillMode: 'type',
  _drillType: '',
  _drillQuestion: null,
  _drillFeedback: null,
  _drillTimer: null,
  _drillPhase: null
};

// ===== Helpers =====
function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }
function toast(msg, ms = 2500) {
  const el = $('#toast');
  el.textContent = msg; el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), ms);
}
function setStatus(text) { $('#nav-status').textContent = text; }

// Resize event — 通知所有活跃ECharts实例重绘
window.addEventListener('resize', () => {
  // echarts 实例由各图表模块自行维护，resize时自动触发
  // 这里仅做占位，避免 ReferenceError
});

// Tab 小红点系统
async function loadDashboard() {
  try {
    const data = await fetchRetry('/api/dashboard/stats').then(r => r.json()).catch(() => null);
    if (!data || (data.totalPractices === 0 && data.totalInterviews === 0)) {
      // New user — show onboarding
      const dash = document.getElementById('tab-dashboard');
      const welcome = document.getElementById('welcome-hero');
      if (!welcome && dash) {
        const el = document.createElement('div');
        el.id = 'welcome-hero';
        el.className = 'card';
        el.style.cssText = 'text-align:center;padding:2.5rem;border:2px dashed var(--accent2);background:linear-gradient(135deg, rgba(79,70,229,0.06), rgba(6,182,212,0.06));';
        el.innerHTML = `
          <h2 style="margin-bottom:0.8rem;">👋 欢迎使用 一键上岸</h2>
          <p style="color:var(--muted);margin-bottom:1.2rem;">AI 驱动的面试准备工具，三步开始你的面试备战之旅</p>
          <div style="display:flex;gap:1rem;justify-content:center;flex-wrap:wrap;">
            <div style="flex:1;min-width:140px;max-width:200px;padding:1rem;background:var(--bg1);border-radius:8px;">
              <div style="font-size:1.5rem;margin-bottom:0.3rem;">1️⃣</div>
              <div style="font-weight:600;font-size:0.85rem;">填写 JD + 简历</div>
              <div style="font-size:0.72rem;color:var(--muted);">在「分析 & 押题」页输入岗位描述和你的简历</div>
            </div>
            <div style="flex:1;min-width:140px;max-width:200px;padding:1rem;background:var(--bg1);border-radius:8px;">
              <div style="font-size:1.5rem;margin-bottom:0.3rem;">2️⃣</div>
              <div style="font-weight:600;font-size:0.85rem;">AI 自动押题</div>
              <div style="font-size:0.72rem;color:var(--muted);">点击分析，AI 生成 5 类面题 + 差距分析</div>
            </div>
            <div style="flex:1;min-width:140px;max-width:200px;padding:1rem;background:var(--bg1);border-radius:8px;">
              <div style="font-size:1.5rem;margin-bottom:0.3rem;">3️⃣</div>
              <div style="font-weight:600;font-size:0.85rem;">逐题练习 + 模拟</div>
              <div style="font-size:0.72rem;color:var(--muted);">在「单题练习」打磨每道题，或「全真模拟」1v1 面试</div>
            </div>
          </div>
          <button onclick="switchTab('analyze')" class="btn-primary" style="margin-top:1.2rem;">🚀 开始分析</button>
        `;
        dash.prepend(el);
      }
      return;
    }
    // Remove welcome hero if stats exist
    const welcome = document.getElementById('welcome-hero');
    if (welcome) welcome.remove();

    renderDashStats(data);

    // 异步加载趋势数据
    loadTrendData();

    // 加载岗位竞争力雷达
    loadCompetitivenessRadar();

    // Defer heavy chart rendering
    setTimeout(() => renderRadarChart(data.radarScores || {}), 100);
    renderPieChart(data.typeCoverage || {});
    renderCalendar(data.calendar || {});
    renderRecentPractices(data.recentPractices || []);
    renderInterviewHistory(data.interviewReports || []);

    // Quick summary card
    const container = document.getElementById('tab-dashboard');
    if (data && container) {
      let card = document.getElementById('dashboard-summary-card');
      if (!card) {
        card = document.createElement('div');
        card.id = 'dashboard-summary-card';
        card.className = 'card';
        card.style.cssText = 'text-align:center;margin-top:1rem;';
        container.appendChild(card);
      }
      card.innerHTML = `
        <h3 style="margin-bottom:0.5rem;">📈 练习概览</h3>
        <div style="display:flex;gap:1rem;justify-content:center;flex-wrap:wrap;">
          <div><span style="font-size:1.5rem;font-weight:700;">${data.totalPractices || 0}</span><br><span style="font-size:0.78rem;color:var(--muted);">总练习</span></div>
          <div><span style="font-size:1.5rem;font-weight:700;">${data.totalInterviews || 0}</span><br><span style="font-size:0.78rem;color:var(--muted);">模拟面试</span></div>
          <div><span style="font-size:1.5rem;font-weight:700;color:var(--accent);">${data.avgScore || 0}</span><br><span style="font-size:0.78rem;color:var(--muted);">平均分</span></div>
        </div>
      `;
    }
  } catch (e) {
    console.warn('Dashboard load failed:', e);
    $('#dash-stats').innerHTML = '<p style="color:var(--muted);">暂无数据，完成一次练习或模拟面试后开始追踪</p>';
  }
}

// ============================================================
// 趋势数据加载与渲染
// ============================================================
async function loadTrendData() {
  try {
    const data = await fetchRetry('/api/dashboard/trends').then(r => r.json()).catch(() => null);
    if (!data || (!data.dailyTrend.length && !data.recentTrend.length)) return;

    // 显示趋势卡片
    const trendCard = $('#dash-trend-card');
    if (trendCard) trendCard.style.display = '';

    const weaknessCard = $('#dash-weakness-card');
    if (weaknessCard) weaknessCard.style.display = '';

    const recentTrendCard = $('#dash-recent-trend-card');
    if (recentTrendCard) recentTrendCard.style.display = '';

    // 渲染趋势图
    setTimeout(() => renderTrendChart(data), 150);
    renderWeakDimensions(data.weakDimensions || []);
    renderRecentTrendChart(data.recentTrend || []);
  } catch (e) {
    // 静默失败，趋势图是增强功能
  }
}

function renderTrendChart(data) {
  const el = $('#dash-trend');
  if (!el) return;

  // 使用每日趋势数据
  var trendData = data.dailyTrend || [];
  if (!trendData.length) {
    // 降级使用周趋势
    trendData = data.weeklyTrend || [];
  }
  if (!trendData.length) {
    // 尝试使用最近练习趋势
    if (data.recentTrend && data.recentTrend.length >= 2) {
      trendData = data.recentTrend;
    } else {
      el.innerHTML = '<p style="color:var(--muted);text-align:center;padding:2rem;">完成多次练习后显示趋势</p>';
      return;
    }
  }

  var dates = trendData.map(function(d) { return d.date ? d.date.slice(5) : ''; });
  var overallScores = trendData.map(function(d) { return d.overallAvg || 0; });

  var dimKeys = ['star_completeness', 'quantification', 'position_match', 'structure', 'highlight'];
  var dimLabels = ['STAR完整度', '量化程度', '岗位匹配', '结构逻辑', '亮点突出'];
  var dimColors = ['#4F46E5', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'];

  var chart = echarts.init(el);

  // 根据当前激活的按钮决定显示模式
  var activeMode = 'overall';
  var toggleBtns = el.parentElement.querySelectorAll('.trend-toggle');
  toggleBtns.forEach(function(btn) {
    if (btn.classList.contains('active')) {
      activeMode = btn.dataset.trend;
    }
  });

  var option = {
    tooltip: {
      trigger: 'axis',
      confine: true,
      formatter: function(params) {
        var html = '<b>' + params[0].axisValue + '</b><br>';
        params.forEach(function(p) {
          html += '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + p.color + ';margin-right:4px;"></span> ' + p.seriesName + ': <b>' + p.value + '</b><br>';
        });
        return html;
      }
    },
    legend: { bottom: 0, textStyle: { fontSize: 11 } },
    grid: { left: 45, right: 16, top: 20, bottom: 40 },
    xAxis: {
      type: 'category',
      data: dates,
      axisLabel: { fontSize: 10, rotate: dates.length > 10 ? 45 : 0 }
    },
    yAxis: { type: 'value', min: 0, max: 100, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } } },
    series: []
  };

  if (activeMode === 'overall') {
    option.series = [{
      name: '总分',
      type: 'line',
      data: overallScores,
      smooth: true,
      lineStyle: { width: 2, color: '#4F46E5' },
      itemStyle: { color: '#4F46E5' },
      areaStyle: { color: 'rgba(79,70,229,0.1)' },
      connectNulls: true
    }];
  } else {
    option.series = dimKeys.map(function(k, i) {
      var values = trendData.map(function(d) { return d.scores && d.scores[k] || 0; });
      return {
        name: dimLabels[i],
        type: 'line',
        data: values,
        smooth: true,
        lineStyle: { width: 1.5, color: dimColors[i] },
        itemStyle: { color: dimColors[i] },
        symbol: 'circle',
        symbolSize: 4,
        connectNulls: true
      };
    });
  }

  chart.setOption(option);
  chart._trendMode = activeMode;

  // 绑定切换按钮事件
  toggleBtns.forEach(function(btn) {
    btn.onclick = null; // 移除旧事件
    btn.addEventListener('click', function() {
      toggleBtns.forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      chart._trendMode = btn.dataset.trend;
      renderTrendChart(data);
    });
  });

  window.addEventListener('resize', function() { chart.resize(); });
}

function renderWeakDimensions(dimensions) {
  var el = $('#dash-weakness');
  if (!el || !dimensions.length) return;
  el.innerHTML = dimensions.map(function(d) {
    var score = d.avg || 0;
    var barWidth = Math.max(score, 5);
    var color = score < 50 ? 'var(--red)' : score < 70 ? '#F59E0B' : 'var(--green)';
    return '<div style="flex:1;min-width:140px;background:var(--bg1);border-radius:8px;padding:0.8rem;">' +
      '<div style="font-size:0.82rem;font-weight:600;margin-bottom:0.3rem;">' + d.label + '</div>' +
      '<div style="font-size:1.2rem;font-weight:700;color:' + color + ';margin-bottom:0.3rem;">' + score + '<span style="font-size:0.7rem;color:var(--muted);">/100</span></div>' +
      '<div style="background:var(--bg2);border-radius:4px;height:6px;overflow:hidden;">' +
      '<div style="height:100%;width:' + barWidth + '%;border-radius:4px;background:' + color + ';transition:width 0.5s;"></div></div>' +
      '</div>';
  }).join('');
}

function renderRecentTrendChart(recentTrend) {
  var el = $('#dash-recent-trend');
  if (!el || !recentTrend || recentTrend.length < 2) {
    if (el) el.innerHTML = '<p style="color:var(--muted);text-align:center;padding:1.5rem;">完成更多练习后将显示分数变化趋势</p>';
    return;
  }

  var labels = recentTrend.map(function(r) { return r.date ? r.date.slice(5) : ''; });
  var scores = recentTrend.map(function(r) { return r.overallScore || 0; });

  var chart = echarts.init(el);
  chart.setOption({
    tooltip: { trigger: 'axis', confine: true, formatter: function(params) { return '<b>' + params[0].axisValue + '</b><br>总分: <b>' + params[0].value + '</b>'; } },
    grid: { left: 40, right: 10, top: 10, bottom: 25 },
    xAxis: { type: 'category', data: labels, axisLabel: { fontSize: 10 } },
    yAxis: { type: 'value', min: 0, max: 100, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } } },
    series: [{
      type: 'bar',
      data: scores.map(function(s, i) {
        return {
          value: s,
          itemStyle: {
            color: s >= 80 ? '#10B981' : s >= 60 ? '#F59E0B' : '#EF4444',
            borderRadius: [3, 3, 0, 0]
          }
        };
      }),
      barWidth: '60%'
    }]
  });
  window.addEventListener('resize', function() { chart.resize(); });
}

function renderDashStats(data) {
  const stats = [
    { label: '练习次数', value: data.totalPractices || 0, icon: '📝' },
    { label: '模拟面试', value: data.totalInterviews || 0, icon: '🎤' },
    { label: '平均得分', value: (data.avgScore || 0) + '分', icon: '⭐' },
  ];
  $('#dash-stats').innerHTML = stats.map(s =>
    '<div class="card" style="flex:1;min-width:150px;text-align:center;padding:1rem;">' +
    '<div style="font-size:2rem;">' + s.icon + '</div>' +
    '<div style="font-size:1.5rem;font-weight:700;">' + s.value + '</div>' +
    '<div style="font-size:0.78rem;color:var(--muted);">' + s.label + '</div>' +
    '</div>'
  ).join('');
}

function renderRadarChart(scores) {
  const el = document.getElementById('dash-radar');
  if (!el) return;
  const keys = ['star_completeness','quantification','position_match','structure','highlight'];
  const labels = ['STAR完整度','量化程度','岗位匹配','结构逻辑','亮点突出'];
  const values = keys.map(k => scores[k] || 0);
  if (values.every(v => v === 0)) { el.innerHTML = '<p style="color:var(--muted);text-align:center;padding:2rem;">完成练习后显示</p>'; return; }

  const chart = echarts.init(el);
  chart.setOption({
    tooltip: {},
    radar: {
      indicator: labels.map((l,i) => ({ name: l, max: 100 })),
      center: ['50%','55%'],
      radius: '65%'
    },
    series: [{ type: 'radar', data: [{ value: values, name: '平均得分', areaStyle: { color: 'rgba(79,70,229,0.15)' },
      lineStyle: { color: '#4F46E5', width: 2 }, itemStyle: { color: '#4F46E5' } }] }]
  });
  window.addEventListener('resize', () => chart.resize());
}

// ============================================================
// 岗位竞争力雷达 — 加载并渲染 JD vs 简历对比
// ============================================================
async function loadCompetitivenessRadar() {
  try {
    const data = await fetchRetry('/api/radar/competitiveness').then(r => r.json()).catch(() => null);
    if (!data || !data.available) return;

    const card = $('#dash-competitiveness-card');
    if (!card) return;
    card.style.display = '';

    // 渲染匹配度标签
    const badge = $('#competitiveness-match-badge');
    if (badge) {
      badge.textContent = data.matchLevel + ' ' + data.matchScore + '分';
      badge.style.background = data.matchColor + '22';
      badge.style.color = data.matchColor;
      badge.style.border = '1px solid ' + data.matchColor;
    }

    // 渲染雷达图
    const el = $('#dash-competitiveness-radar');
    if (!el) return;
    const dims = data.dimensions || [];
    const radarLabels = dims.map(d => d.label);
    const myScores = dims.map(d => d.pct);
    const maxScores = dims.map(d => 100);

    var chart = echarts.init(el);
    chart.setOption({
      tooltip: {
        trigger: 'item',
        formatter: function(params) {
          var idx = params.dataIndex;
          var dim = dims[idx];
          if (!dim) return '';
          return '<b>' + dim.label + '</b><br>' +
            '得分: ' + dim.score + '/' + dim.max + ' (' + dim.pct + '%)<br>' +
            '<span style="font-size:0.78rem;color:var(--muted);">' + (dim.detail || '') + '</span>';
        }
      },
      radar: {
        indicator: radarLabels.map(function(l) { return { name: l, max: 100 }; }),
        center: ['50%','55%'],
        radius: '65%',
        shape: 'polygon',
        splitNumber: 5,
        name: { textStyle: { fontSize: 11, color: 'var(--text)' } },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.1)' } },
        splitArea: { areaStyle: { color: ['rgba(79,70,229,0.02)','rgba(79,70,229,0.04)'] } },
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.1)' } }
      },
      series: [{
        type: 'radar',
        data: [{
          value: myScores,
          name: '你的匹配度',
          areaStyle: { color: 'rgba(79,70,229,0.2)' },
          lineStyle: { color: '#4F46E5', width: 2 },
          itemStyle: { color: '#4F46E5' }
        }],
        symbol: 'circle',
        symbolSize: 6
      }]
    });
    window.addEventListener('resize', function() { chart.resize(); });

    // 渲染详情面板
    const details = $('#dash-competitiveness-details');
    if (details) {
      var detailHtml = dims.map(function(d) {
        var barColor = '#4F46E5';
        if (d.pct >= 80) barColor = '#10B981';
        else if (d.pct >= 60) barColor = '#22d3ee';
        else if (d.pct >= 40) barColor = '#F59E0B';
        else barColor = '#EF4444';

        return '<div style="margin-bottom:0.6rem;padding:0.4rem 0.6rem;background:var(--bg1);border-radius:6px;">' +
          '<div style="display:flex;justify-content:space-between;font-size:0.82rem;margin-bottom:0.3rem;">' +
            '<span style="font-weight:500;">' + d.label + '</span>' +
            '<span style="color:' + barColor + ';font-weight:600;">' + d.score + '/' + d.max + '</span>' +
          '</div>' +
          '<div class="study-progress-bar" style="height:6px;background:var(--rule);">' +
            '<div class="study-progress-fill" style="width:' + d.pct + '%;height:100%;background:' + barColor + ';border-radius:3px;transition:width 0.6s ease;"></div>' +
          '</div>' +
          '<div style="font-size:0.72rem;color:var(--muted);margin-top:0.2rem;">' + d.suggestion + '</div>' +
        '</div>';
      }).join('');
      details.innerHTML = detailHtml;
    }

    // 面试策略
    if (data.interviewStrategy) {
      var strategy = $('#dash-competitiveness-strategy');
      if (strategy) {
        strategy.style.display = '';
        strategy.innerHTML = '<strong>💡 面试策略建议：</strong> ' + data.interviewStrategy;
      }
    }
  } catch (e) {
    // 静默失败
  }
}

function renderPieChart(data) {
  const el = document.getElementById('dash-pie');
  if (!el) return;
  const types = [
    { key: 'behavioral', name: '行为面试', color: '#4F46E5' },
    { key: 'technical', name: '专业能力', color: '#10B981' },
    { key: 'project', name: '项目深挖', color: '#F59E0B' },
    { key: 'stress', name: '压力测试', color: '#EF4444' },
    { key: 'hr', name: 'HR面', color: '#8B5CF6' }
  ];
  const hasData = types.some(t => (data[t.key] || 0) > 0);
  if (!hasData) { el.innerHTML = '<p style="color:var(--muted);text-align:center;padding:2rem;">完成练习后显示</p>'; return; }

  const chart = echarts.init(el);
  chart.setOption({
    tooltip: { trigger: 'item' },
    legend: { bottom: 0, textStyle: { fontSize: 11 } },
    series: [{
      type: 'pie', radius: ['45%','70%'], center: ['50%','50%'],
      data: types.filter(t => (data[t.key]||0) > 0).map(t => ({ value: data[t.key], name: t.name, itemStyle: { color: t.color } })),
      label: { show: false }
    }]
  });
  window.addEventListener('resize', () => chart.resize());
}

function renderCalendar(calData) {
  const el = $('#dash-calendar');
  if (!el) return;
  const now = new Date();
  let html = '';
  for (let i = 59; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0,10);
    const count = calData[key] || 0;
    let bg = '#1e293b';
    if (count >= 5) bg = '#10B981';
    else if (count >= 3) bg = '#34D399';
    else if (count >= 1) bg = '#6EE7B7';
    html += '<div title="' + key + ': ' + count + '次" style="width:14px;height:14px;border-radius:3px;background:' + bg + ';"></div>';
  }
  el.innerHTML = html;
}

// 练习详情弹窗 - 完整报告视图
function showPracticeDetail(p) {
  const modal = document.getElementById('practice-detail-modal');
  const body = document.getElementById('practice-detail-body');
  if (!modal || !body) return;

  const dateStr = p.createdAt ? new Date(p.createdAt).toLocaleDateString('zh-CN') + ' ' + new Date(p.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : (p.date ? new Date(p.date).toLocaleDateString('zh-CN') : '');
  const score = p.score || 0;
  const scoreCls = score >= 80 ? 'color:var(--green);' : score >= 60 ? 'color:#F59E0B;' : 'color:var(--red);';
  const scores = p.scores || {};
  const dimKeys = ['star_completeness', 'quantification', 'position_match', 'structure', 'highlight'];
  const dimLabels = ['STAR完整度', '量化程度', '岗位匹配', '结构逻辑', '亮点突出'];
  const dimColors = ['#4F46E5', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'];

  // 生成雷达图（使用内联SVG）
  var radarHtml = '';
  if (scores && dimKeys.some(function(k) { return scores[k] > 0; })) {
    var radarData = dimKeys.map(function(k, i) {
      return { label: dimLabels[i], value: scores[k] || 0, color: dimColors[i] };
    });
    radarHtml = '<div style="margin-bottom:1rem;padding:0.8rem;background:var(--bg1);border-radius:8px;">' +
      '<div style="font-size:0.85rem;font-weight:600;margin-bottom:0.5rem;">📊 五维评分</div>' +
      '<div style="display:flex;gap:0.6rem;flex-wrap:wrap;">' +
      radarData.map(function(d) {
        var barPct = Math.max(d.value, 5);
        var barColor = d.value >= 80 ? 'var(--green)' : d.value >= 60 ? '#F59E0B' : 'var(--red)';
        return '<div style="flex:1;min-width:100px;">' +
          '<div style="display:flex;justify-content:space-between;font-size:0.72rem;margin-bottom:0.2rem;">' +
          '<span style="color:var(--muted);">' + d.label + '</span>' +
          '<span style="font-weight:600;color:' + barColor + ';">' + d.value + '</span></div>' +
          '<div style="background:var(--bg2);border-radius:4px;height:8px;overflow:hidden;">' +
          '<div style="height:100%;width:' + barPct + '%;border-radius:4px;background:' + d.color + ';transition:width 0.5s;"></div></div></div>';
      }).join('') +
      '</div></div>';
  }

  // 关键词提取：从改进点中提取
  var takeaways = p.keyTakeaways || '';
  if (Array.isArray(takeaways)) takeaways = takeaways.join('；');

  // 题型标签
  var typeTag = p.type || p.questionType || '';
  var sourceTag = p.source === 'drill' ? '专项训练' : '单题练习';

  body.innerHTML = `
    <div style="margin-bottom:1rem;">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.3rem;margin-bottom:0.5rem;">
        <div style="display:flex;gap:0.4rem;align-items:center;">
          <span style="font-size:0.72rem;background:var(--tag-bg);padding:0.15rem 0.5rem;border-radius:4px;color:var(--muted);">${sourceTag}</span>
          ${typeTag ? '<span style="font-size:0.72rem;background:var(--tag-bg);padding:0.15rem 0.5rem;border-radius:4px;color:var(--muted);">' + typeTag + '</span>' : ''}
        </div>
        <div style="font-size:0.78rem;color:var(--muted);">${dateStr}</div>
      </div>
      <div style="font-weight:600;font-size:1rem;margin-bottom:0.5rem;line-height:1.5;">${p.question || '无题目'}</div>
      ${score ? '<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.8rem;"><span style="font-size:1.3rem;font-weight:700;' + scoreCls + '">' + score + '分</span><span style="font-size:0.78rem;color:var(--muted);">/ 100</span></div>' : ''}
    </div>

    ${radarHtml}

    ${p.answer ? '<div style="margin-bottom:0.8rem;"><b style="font-size:0.85rem;display:flex;align-items:center;gap:0.3rem;">📝 你的回答</b><div style="background:var(--bg2);padding:0.6rem;border-radius:6px;margin-top:0.3rem;font-size:0.82rem;line-height:1.7;max-height:250px;overflow-y:auto;white-space:pre-wrap;">' + escHtml(p.answer) + '</div></div>' : ''}

    ${p.improvedVersion ? '<div style="margin-bottom:0.8rem;"><b style="font-size:0.85rem;display:flex;align-items:center;gap:0.3rem;">💡 AI改进参考</b><div style="background:rgba(79,70,229,0.05);padding:0.6rem;border-radius:6px;margin-top:0.3rem;font-size:0.82rem;line-height:1.7;max-height:250px;overflow-y:auto;white-space:pre-wrap;">' + escHtml(p.improvedVersion) + '</div></div>' : ''}

    ${takeaways ? '<div style="margin-bottom:0.8rem;"><b style="font-size:0.85rem;display:flex;align-items:center;gap:0.3rem;">🎯 关键改进点</b><div style="font-size:0.82rem;color:var(--accent);margin-top:0.3rem;line-height:1.6;">' + takeaways + '</div></div>' : ''}

    ${p.lineByLine && p.lineByLine.length ? '<div style="margin-bottom:0.8rem;"><b style="font-size:0.85rem;display:flex;align-items:center;gap:0.3rem;">🔍 逐句分析</b><div style="margin-top:0.3rem;">' + p.lineByLine.map(function(l) {
      return '<div style="padding:0.4rem 0.5rem;margin-bottom:0.3rem;background:' + (l.is_good ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)') + ';border-radius:4px;border-left:3px solid ' + (l.is_good ? 'var(--green)' : 'var(--red)') + ';">' +
        '<div style="font-size:0.78rem;color:var(--muted);margin-bottom:0.2rem;">"' + escHtml(l.quote || '') + '"</div>' +
        '<div style="font-size:0.78rem;">' + escHtml(l.comment || '') + '</div></div>';
    }).join('') + '</div></div>' : ''}

    ${p.source === 'drill' && p.attemptNumber ? '<div style="font-size:0.72rem;color:var(--muted);margin-top:0.5rem;">第 ' + p.attemptNumber + ' 次尝试</div>' : ''}
  `;

  modal.classList.remove('hidden');
}

// 打开报告列表
async function openReportList() {
  var modal = document.getElementById('report-list-modal');
  var body = document.getElementById('report-list-body');
  if (!modal || !body) return;
  modal.classList.remove('hidden');
  body.innerHTML = '<p style="text-align:center;padding:2rem;color:var(--muted);">加载中...</p>';

  try {
    var data = await fetchRetry('/api/practice/reports').then(function(r) { return r.json(); });
    var reports = data.reports || [];
    if (!reports.length) {
      body.innerHTML = '<p style="text-align:center;padding:2rem;color:var(--muted);">暂无练习报告，完成练习后将自动生成</p>';
      return;
    }
    body.innerHTML = reports.map(function(r, idx) {
      var score = r.score || 0;
      var scoreCls = score >= 80 ? 'color:var(--green);' : score >= 60 ? 'color:#F59E0B;' : 'color:var(--red);';
      var dateStr = r.createdAt ? new Date(r.createdAt).toLocaleDateString('zh-CN') + ' ' + new Date(r.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';
      var typeLabel = r.type === 'drill' ? '专项训练' : '单题练习';
      return '<div class="dash-practice-item" data-report-idx="' + idx + '" style="display:flex;align-items:center;gap:0.6rem;padding:0.6rem 0;border-bottom:1px solid var(--rule);cursor:pointer;" title="点击查看完整报告">' +
        '<span style="font-size:0.72rem;background:var(--tag-bg);padding:0.1rem 0.4rem;border-radius:3px;color:var(--muted);white-space:nowrap;">' + typeLabel + '</span>' +
        '<span style="font-size:0.78rem;color:var(--muted);white-space:nowrap;">' + dateStr + '</span>' +
        '<span style="flex:1;font-size:0.85rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + (r.question || '').slice(0, 60) + '</span>' +
        '<span style="font-weight:600;' + scoreCls + '">' + score + '分</span>' +
        '</div>';
    }).join('');

    // 点击查看报告
    body.querySelectorAll('.dash-practice-item').forEach(function(item) {
      item.addEventListener('click', function() {
        var idx = parseInt(item.dataset.reportIdx);
        var r = reports[idx];
        if (r) {
          modal.classList.add('hidden');

          // 延迟打开详情弹窗，避免同时显示两个弹窗
          setTimeout(function() {
            showPracticeDetail(r);
          }, 200);
        }
      });
    });
  } catch (e) {
    body.innerHTML = '<p style="text-align:center;padding:2rem;color:var(--red);">加载失败: ' + e.message + '</p>';
  }
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderRecentPractices(items) {
  const el = $('#dash-recent');
  if (!items.length) { el.innerHTML = '<p style="color:var(--muted);">暂无练习记录</p>'; return; }
  // 存储最近练习数据供详情弹窗使用
  window._dashRecentPractices = items;
  el.innerHTML = items.slice(0, 10).map((p, idx) =>
    '<div class="dash-practice-item" data-idx="' + idx + '" style="display:flex;align-items:center;gap:0.8rem;padding:0.5rem 0;border-bottom:1px solid var(--rule);cursor:pointer;" title="点击查看详情">' +
    '<span style="font-size:0.78rem;color:var(--muted);white-space:nowrap;">' + (p.date || '').slice(5) + '</span>' +
    '<span style="flex:1;font-size:0.85rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + (p.question || p.type || '练习') + '</span>' +
    '<span style="font-weight:600;color:' + (p.score >= 80 ? 'var(--green)' : p.score >= 60 ? '#F59E0B' : 'var(--red)') + ';">' + (p.score || 0) + '分</span>' +
    '</div>'
  ).join('');

  // 点击查看详情
  el.querySelectorAll('.dash-practice-item').forEach(item => {
    item.addEventListener('click', () => {
      const idx = parseInt(item.dataset.idx);
      const p = window._dashRecentPractices[idx];
      if (p) showPracticeDetail(p);
    });
  });
}

function renderInterviewHistory(reports) {
  const el = $('#dash-interviews');
  if (!reports.length) { el.innerHTML = '<p style="color:var(--muted);">暂无模拟面试记录</p>'; return; }
  el.innerHTML = reports.slice(0, 10).map(r =>
    '<div style="display:flex;align-items:center;gap:0.8rem;padding:0.5rem 0;border-bottom:1px solid var(--rule);">' +
    '<span>🎤</span>' +
    '<span style="flex:1;font-size:0.85rem;">' + (r.label || r.position || '面试') + '</span>' +
    '<span style="font-size:0.78rem;color:var(--muted);">' + (r.date || '').slice(0,10) + '</span>' +
    '<span style="font-weight:600;color:var(--accent);">' + (r.score || '-') + '分</span>' +
    '</div>'
  ).join('');
}

function renderInterviewTabHistory() {
  const el = $('#interview-history-list');
  if (!el) return;
  try {
    const history = JSON.parse(localStorage.getItem('interview_history') || '[]');
    if (!history.length) {
      el.innerHTML = '暂无面试记录。完成一次模拟面试后会显示。';
      return;
    }
    el.innerHTML = history.map((h, i) => `
      <div style="padding:0.5rem;margin:4px 0;background:var(--tag-bg);border-radius:4px;display:flex;justify-content:space-between;align-items:center;">
        <span>${new Date(h.date).toLocaleDateString('zh-CN')} · ${h.position}</span>
        <span style="font-weight:600;">${h.score}分 · ${h.questions}题</span>
      </div>
    `).join('');
  } catch { el.innerHTML = '加载失败'; }
}

function renderPracticeHistory() {
  loadPracticeHistoryFromServer();
}

async function loadPracticeHistoryFromServer() {
  const el = $('#practice-history-list');
  if (!el) return;
  try {
    const data = await fetchRetry('/api/phrases?tag=练习');
    const phrases = (data.phrases || []).slice(0, 50);
    if (!phrases.length) {
      el.innerHTML = '暂无练习记录。提交一道题后会自动显示。';
      return;
    }
    el.innerHTML = phrases.map(p => {
      const cls = (p.score || 0) >= 85 ? 'color:var(--green);' : (p.score || 0) >= 60 ? 'color:#D97706;' : 'color:var(--red);';
      return `<details style="margin:4px 0;background:var(--tag-bg);border-radius:4px;padding:0.4rem 0.6rem;">
        <summary style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:0.5rem;">
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.82rem;">${new Date(p.createdAt).toLocaleDateString('zh-CN')} · ${(p.question||'').slice(0, 50)}</span>
          <span style="font-weight:600;white-space:nowrap;font-size:0.82rem;${cls}">${p.score||0}分</span>
        </summary>
        <div style="margin-top:0.4rem;font-size:0.78rem;line-height:1.6;">
          <div style="color:var(--muted);margin-bottom:0.3rem;"><b>题目：</b>${p.question||''}</div>
          <div style="color:var(--muted);margin-bottom:0.3rem;"><b>你的回答：</b>${(p.answer||'').slice(0, 300)}${(p.answer||'').length>300?'...':''}</div>
          ${p.improvedVersion ? `<div style="background:rgba(79,70,229,0.05);padding:0.4rem;border-radius:4px;margin-bottom:0.3rem;"><b>💡 改进版参考：</b>${p.improvedVersion}</div>` : ''}
          ${p.keyTakeaways ? `<div style="color:var(--accent);"><b>🎯 关键改进点：</b>${p.keyTakeaways}</div>` : ''}
          ${p.scores ? `<div style="font-size:0.72rem;color:var(--muted);margin-top:0.2rem;">STAR:${p.scores.star_completeness||'-'} | 量化:${p.scores.quantification||'-'} | 匹配:${p.scores.position_match||'-'} | 结构:${p.scores.structure||'-'} | 亮点:${p.scores.highlight||'-'}</div>` : ''}
        </div>
      </details>`;
    }).join('');
  } catch { el.innerHTML = '加载失败'; }
}

async function autoSavePracticeRecord(question, answer, result) {
  try {
    const scores = {
      star_completeness: result.star_completeness || result.scores?.star_completeness || 0,
      quantification: result.quantification || result.scores?.quantification || 0,
      position_match: result.position_match || result.scores?.position_match || 0,
      structure: result.structure || result.scores?.structure || 0,
      highlight: result.highlight || result.scores?.highlight || 0
    };
    await fetchRetry('/api/phrases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        answer,
        improvedVersion: result.improved_version || '',
        keyTakeaways: (result.key_takeaways || []).join('；'),
        score: result.overall_score || 0,
        scores,
        tags: ['练习', result.type || ''],
        type: result.type || ''
      })
    });
  } catch { /* 静默失败，不影响主流程 */ }
}



// ===== P1: Follow-up Question System =====
// ============================================================
// AI 辅助按钮组：追问 + 标准答案
// ============================================================
function showFollowUpButton(mode, question, answer, evalResult) {
  var existing = document.querySelector('.follow-up-section');
  if (existing) existing.remove();

  var container = mode === 'practice' ? document.getElementById('practice-feedback') : document.getElementById('drill-feedback');
  if (!container) return;

  var section = document.createElement('div');
  section.className = 'follow-up-section';
  section.innerHTML = '<div class=\"ai-action-row\">' +
    '<button class=\"btn-ai-action btn-ai-followup\" id=\"btn-follow-up-' + mode + '\" title=\"AI根据你的回答弱点生成追问\"><span class=\"ai-action-icon\">💬</span>AI追问练习</button>' +
    '<button class=\"btn-ai-action btn-ai-model\" id=\"btn-model-answer-' + mode + '\" title=\"AI基于你的简历生成标准答案参考\"><span class=\"ai-action-icon\">✨</span>AI标准答案</button>' +
    '<button class=\"btn-ai-action btn-ai-counter\" id=\"btn-counter-' + mode + '\" title=\"AI生成你可以反问面试官的问题\"><span class=\"ai-action-icon\">🔄</span>生成反问</button>' +
    '</div>';
  container.appendChild(section);

  // ---- 反问按钮 ----
  bindCounterButtonHandler(mode, question, answer);

  // ---- 追问按钮 ----
  document.getElementById('btn-follow-up-' + mode).addEventListener('click', async function() {
    var btn = document.getElementById('btn-follow-up-' + mode);
    btn.disabled = true; btn.innerHTML = '<span class=\"ai-action-icon\">⏳</span>生成追问中...';
    try {
      var jd = state.analysis ? (state.analysis.jd || {}) : {};
      var jdSummary = jd.position ? (jd.company || '') + ' ' + jd.position : '';
      var followUp = await fetchRetry('/api/follow-up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: question,
          answer: answer,
          jdSummary: jdSummary,
          resumeText: (state.resumeText || '').slice(0, 3000)
        })
      }).then(function(r) { return r.json(); });

      if (followUp.should_follow_up) {
        section.innerHTML = '<div class=\"ai-action-row\">' +
          '<button class=\"btn-ai-action btn-ai-followup\" disabled>💬 已追问</button>' +
          '<button class=\"btn-ai-action btn-ai-model\" id=\"btn-model-answer-' + mode + '\" title=\"AI基于你的简历生成标准答案参考\"><span class=\"ai-action-icon\">✨</span>AI标准答案</button>' +
          '<button class=\"btn-ai-action btn-ai-counter\" id=\"btn-counter-' + mode + '\" title=\"AI生成你可以反问面试官的问题\"><span class=\"ai-action-icon\">🔄</span>生成反问</button>' +
          '</div>' +
          '<div class=\"follow-up-q\">' + (followUp.follow_up_question || '') + '</div>' +
          '<div class=\"follow-up-reason\">追问原因：' + (followUp.reason || '') + ' (' + (followUp.follow_up_type || '') + ')</div>' +
          '<textarea id=\"follow-up-answer-' + mode + '\" rows=\"4\" placeholder=\"输入你的追问回答...\" style=\"width:100%;min-height:100px;resize:vertical;line-height:1.7;padding:0.5rem;border:1px solid var(--rule);border-radius:var(--radius-sm);background:var(--bg);margin-bottom:0.5rem;font-family:var(--font-body);\"></textarea>' +
          '<button class=\"btn-primary\" id=\"btn-follow-up-submit-' + mode + '\" style=\"font-size:0.82rem;\">提交追问回答</button>';

        // 重新绑定标准答案按钮 + 反问按钮
        loadModelAnswerHandler(mode, question, section);
        bindCounterButtonHandler(mode, question, answer);

        document.getElementById('btn-follow-up-submit-' + mode).addEventListener('click', async function() {
          var fuAnswer = document.getElementById('follow-up-answer-' + mode).value.trim();
          if (!fuAnswer || fuAnswer.length < 5) { toast('请写下追问回答（至少5个字）'); return; }
          var fuBtn = document.getElementById('btn-follow-up-submit-' + mode);
          fuBtn.disabled = true; fuBtn.textContent = '评估中...';
          try {
            var fuResult = await apiEvaluateSingle(followUp.follow_up_question, fuAnswer, jdSummary, (state.resumeText || '').slice(0, 3000));
            if (mode === 'practice') {
              renderSingleFeedback(fuResult);
            } else {
              renderDrillFeedback(fuResult);
            }
            const saveHistory = document.getElementById('chk-save-history')?.checked !== false;
            if (saveHistory) {
              autoSavePracticeRecord(followUp.follow_up_question, fuAnswer, fuResult);
            }
            toast('追问评估完成');
          } catch(e) { toast('评估失败: ' + e.message); }
          finally { fuBtn.disabled = false; fuBtn.textContent = '重新提交'; }
        });
      } else {
        section.innerHTML = '<div class=\"ai-action-row\">' +
          '<p style=\"font-size:0.82rem;color:var(--green);margin:0;\">回答已足够充分，无需追问</p>' +
          '<button class=\"btn-ai-action btn-ai-model\" id=\"btn-model-answer-' + mode + '\" title=\"AI基于你的简历生成标准答案参考\"><span class=\"ai-action-icon\">✨</span>AI标准答案</button>' +
          '<button class=\"btn-ai-action btn-ai-counter\" id=\"btn-counter-' + mode + '\" title=\"AI生成你可以反问面试官的问题\"><span class=\"ai-action-icon\">🔄</span>生成反问</button>' +
          '</div>';
        loadModelAnswerHandler(mode, question, section);
        bindCounterButtonHandler(mode, question, answer);
      }
    } catch (e) {
      section.innerHTML = '<p style=\"font-size:0.82rem;color:var(--red);\">追问生成失败: ' + e.message + '</p>';
    }
  });

  // ---- 标准答案按钮 ----
  loadModelAnswerHandler(mode, question, section);
}

// 为面试模式添加标准答案按钮
function showInterviewModelAnswerButton() {
  var existing = document.querySelector('.interview-model-answer-section');
  if (existing) existing.remove();

  var actions = document.querySelector('.interview-actions');
  if (!actions) return;

  var section = document.createElement('div');
  section.className = 'interview-model-answer-section';
  section.innerHTML = '<button class=\"btn-ai-action btn-ai-model\" id=\"btn-interview-model-answer\" title=\"AI基于你的简历生成当前题目的标准答案\"><span class=\"ai-action-icon\">✨</span>AI标准答案参考</button>';

  var parent = actions.parentNode;
  parent.insertBefore(section, actions.nextSibling);

  loadModelAnswerHandler('interview', getCurrentInterviewQuestion(), section);
}

function getCurrentInterviewQuestion() {
  var chat = document.getElementById('interview-chat');
  if (!chat) return '';
  var msgs = chat.querySelectorAll('.chat-msg.interviewer');
  if (msgs.length === 0) return '';
  return msgs[msgs.length - 1].textContent || '';
}

// 反问按钮事件绑定（可复用）
function bindCounterButtonHandler(mode, question, answer) {
  var btn = document.getElementById('btn-counter-' + mode);
  if (!btn) return;
  btn.addEventListener('click', async function() {
    btn.disabled = true; btn.innerHTML = '<span class=\"ai-action-icon\">⏳</span>生成中...';
    try {
      var jd = state.analysis ? (state.analysis.jd || {}) : {};
      var jdSummary = jd.position ? (jd.company || '') + ' ' + jd.position + ' | ' + (jd.requirements || '') : '';
      var resp = await fetchRetry('/api/generate-counter-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: question,
          answer: answer || '',
          jdSummary: jdSummary.slice(0, 400),
          resumeText: (state.resumeText || '').slice(0, 3000)
        })
      }).then(function(r) { return r.json(); });
      renderCounterQuestions(mode, resp);
      btn.disabled = false; btn.innerHTML = '<span class=\"ai-action-icon\">🔄</span>生成反问';
    } catch(e) {
      toast('反问生成失败: ' + e.message);
      btn.disabled = false; btn.innerHTML = '<span class=\"ai-action-icon\">🔄</span>生成反问';
    }
  });
}

// 渲染反问问题
function renderCounterQuestions(mode, data) {
  var containerId = mode === 'interview' ? 'interview-counter-questions' : 'practice-counter-questions';
  var container = document.getElementById(containerId);
  if (!container) return;

  if (data.error || !data.questions?.length) {
    container.innerHTML = '<div class="card" style="text-align:center;color:var(--muted);padding:1rem;">' + (data.error || '暂无反问建议') + '</div>';
    container.classList.remove('hidden');
    return;
  }

  var catColors = {
    '业务/产品': '#3b82f6',
    '团队/文化': '#8b5cf6',
    '个人发展': '#10b981',
    '行业洞察': '#f59e0b'
  };

  container.innerHTML = `
    <div style="font-weight:600;font-size:0.95rem;margin-bottom:0.6rem;color:var(--accent);">🔄 反问面试官 — 高质量问题建议</div>
    <div style="display:flex;flex-direction:column;gap:0.5rem;">
      ${data.questions.map(function(q, i) {
        var color = catColors[q.category] || 'var(--accent)';
        return `<div style="display:flex;gap:0.5rem;align-items:flex-start;padding:0.5rem 0.6rem;background:var(--bg0);border-radius:8px;border-left:3px solid ${color};">
          <span style="flex-shrink:0;font-weight:700;color:${color};font-size:0.85rem;">${i+1}.</span>
          <div style="flex:1;">
            <div style="font-weight:600;font-size:0.85rem;line-height:1.5;margin-bottom:0.2rem;">${q.q}</div>
            <div style="display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap;">
              <span style="font-size:0.7rem;background:${color}22;color:${color};padding:1px 6px;border-radius:4px;">${q.category}</span>
              <span style="font-size:0.72rem;color:var(--muted);">${q.why || ''}</span>
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>
    ${data.tips ? `<div style="margin-top:0.6rem;font-size:0.78rem;color:var(--muted);padding:0.4rem 0.6rem;background:var(--accent-glow);border-radius:6px;">💡 ${data.tips}</div>` : ''}
  `;
  container.classList.remove('hidden');
  container.scrollIntoView({ behavior: 'smooth' });
}

// 通用的标准答案生成逻辑（核心函数）
async function executeModelAnswerGeneration(btn, mode, question, section) {
  btn.disabled = true;
  btn.innerHTML = '<span class="ai-action-icon">⏳</span>AI正在生成标准答案...';

  // 创建进度指示器（如果section有空间）
  var progressContainer = null;
  var progress = null;
  if (mode !== 'interview' && section) {
    progressContainer = document.createElement('div');
    progressContainer.id = 'model-answer-progress-' + mode;
    progressContainer.style.display = 'none';
    section.appendChild(progressContainer);
    progress = showAiProgress('model-answer-progress-' + mode, [
      '正在准备简历信息...',
      '正在生成个性化标准答案...',
      '正在整理答案格式...'
    ]);
  }

  try {
    if (progress) progress.update(0);
    var jd = state.analysis ? (state.analysis.jd || {}) : {};
    var jdSummary = jd.position
      ? (jd.company || '') + ' ' + jd.position + ' | ' + (jd.requirements || jd.responsibilities || '')
      : (jd.requirements || jd.responsibilities || '');
    var resumeText = state.resumeText || '';
    var fullExperiences = state._fullExperiences || [];

    // 步骤1: 准备简历信息
    if (progress) progress.update(0);
    await new Promise(function(r) { setTimeout(r, 200); });

    // 步骤2: 调用API生成标准答案
    if (progress) progress.update(1);
    var result = await fetchRetry('/api/generate-model-answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: question,
        jdSummary: jdSummary.slice(0, 400),
        resumeText: resumeText.slice(0, 3000),
        fullExperiences: fullExperiences
      })
    }).then(function(r) { return r.json(); });

    if (result.model_answer) {
      // 步骤3: 整理格式
      if (progress) progress.update(2);
      await new Promise(function(r) { setTimeout(r, 200); });
      if (progress) progress.done();

      var html = '<div class="model-answer-card">';
      html += '<div class="model-answer-header">✨ AI标准答案参考 <button class="btn-speak" data-text="' + result.model_answer.replace(/"/g, '&quot;').replace(/\n/g, ' ') + '" style="width:24px;height:24px;font-size:0.7rem;margin-left:0.4rem;vertical-align:middle;">🔊</button></div>';
      html += '<div class="model-answer-body">' + result.model_answer.replace(/\n/g, '<br>') + '</div>';
      if (result.resume_anchors && result.resume_anchors.length > 0) {
        html += '<div class="model-answer-anchors"><b>📎 引用的简历经历：</b>' +
          result.resume_anchors.map(function(a) { return '<span class="anchor-tag">' + a + '</span>'; }).join('') +
          '</div>';
      }
      if (result.tips) {
        html += '<div class="model-answer-tips">💡 ' + result.tips + '</div>';
      }
      html += '</div>';

      if (mode === 'interview') {
        var chat = document.getElementById('interview-chat');
        if (chat) {
          var div = document.createElement('div');
          div.className = 'chat-msg system';
          div.innerHTML = html;
          chat.appendChild(div);
          chat.scrollTop = chat.scrollHeight;
        }
      } else if (section) {
        section.innerHTML = html;
        section.scrollIntoView({ behavior: 'smooth' });
      }

      // 恢复按钮状态
      btn.disabled = false;
      btn.innerHTML = '<span class="ai-action-icon">✨</span>AI标准答案';
    } else {
      toast('生成失败：未获取到答案');
      if (progress) progress.hide();
      btn.disabled = false;
      btn.innerHTML = '<span class="ai-action-icon">✨</span>AI标准答案';
    }
  } catch (e) {
    toast('标准答案生成失败: ' + e.message);
    if (progress) progress.hide();
    btn.disabled = false;
    btn.innerHTML = '<span class="ai-action-icon">✨</span>AI标准答案';
  }
}

// 通用的标准答案生成逻辑 - 绑定按钮点击事件
function loadModelAnswerHandler(mode, question, section, btnElement) {
  var btn = btnElement;
  if (!btn) {
    var btnId = mode === 'interview' ? 'btn-interview-model-answer' : 'btn-model-answer-' + mode;
    btn = document.getElementById(btnId);
    if (!btn && section) {
      btn = section.querySelector('#' + btnId);
    }
    if (!btn) {
      console.warn('[loadModelAnswerHandler] 按钮未找到:', btnId);
      return;
    }
  }

  // 如果传入了btnElement，说明已经在点击处理中，直接执行
  // 否则绑定点击事件
  if (btnElement) {
    executeModelAnswerGeneration(btn, mode, question, section);
  } else {
    btn.addEventListener('click', async function() {
      executeModelAnswerGeneration(btn, mode, question, section);
    });
  }
}

// Tab 小红点系统
function showTabDot(tabName) {
  const dot = document.querySelector(`.tab-dot[data-dot-tab="${tabName}"]`);
  if (!dot || dot.classList.contains('show')) return;
  dot.classList.add('show');
}
function hideTabDot(tabName) {
  const dot = document.querySelector(`.tab-dot[data-dot-tab="${tabName}"]`);
  if (dot) dot.classList.remove('show');
}
// 点击 tab 时自动清除该 tab 的小红点
document.addEventListener('click', (e) => {
  const tabBtn = e.target.closest('.nav-tab');
  if (tabBtn) {
    const dot = tabBtn.querySelector('.tab-dot.show');
    if (dot) dot.classList.remove('show');
  }
});


// 语义化版本号比较（返回 -1/0/1）
function compareVersions(a, b) {
  const pa = a.replace(/^v/i, '').split('.').map(Number);
  const pb = b.replace(/^v/i, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}
// ===== 版本更新检查 (GitHub Releases API) =====
$('#btn-check-update')?.addEventListener('click', async () => {
  const statusEl = document.getElementById('update-status');
  const detailEl = document.getElementById('update-detail');
  if (!statusEl || !detailEl) return;
  statusEl.textContent = '⏳ 查询中...';
  detailEl.classList.add('hidden');

  try {
    let currentVer = window.__ELECTRON_VERSION__ || '1.2.0';
    try {
      if (window.electronAPI?.getVersion) {
        currentVer = await window.electronAPI.getVersion();
      }
    } catch {}
    const resp = await fetch('https://api.github.com/repos/Tazz-zhu/one-click-shangan/releases/latest', {
      headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': '一键上岸' }
    });
    if (!resp.ok) {
      if (resp.status === 403) throw new Error('API 频率限制，请稍后再试');
      throw new Error('无法获取更新信息 (HTTP ' + resp.status + ')');
    }
    const release = await resp.json();
    const latestVer = (release.tag_name || '').replace(/^v/i, '');
    const currentClean = currentVer.replace(/^v/i, '');

    if (compareVersions(latestVer, currentClean) <= 0) {
      statusEl.textContent = '✅ 已是最新版';
      detailEl.classList.remove('hidden');
      detailEl.innerHTML = `<p style="color:var(--green);font-size:0.82rem;">当前 v${currentClean} 已是最新版本。</p>
        <p style="font-size:0.78rem;color:var(--muted);">发布标题：${release.name || latestVer} · ${new Date(release.published_at).toLocaleDateString('zh-CN')}</p>`;
    } else {
      statusEl.textContent = `🆕 发现新版本 v${latestVer}`;
      detailEl.classList.remove('hidden');
      const body = (release.body || '').slice(0, 500).replace(/\n/g, '<br>');
      const asset = (release.assets || []).find(a => a.name.endsWith('.zip'));
      const downloadUrl = asset?.browser_download_url || release.html_url;
      const isElectron = window.__IS_ELECTRON__ && window.electronAPI?.installUpdate;

      detailEl.innerHTML = `
        <div style="background:var(--bg2);border:1px solid var(--accent);border-radius:8px;padding:0.8rem;">
          <p style="font-weight:600;color:var(--accent);margin:0 0 0.5rem 0;">📦 v${latestVer} 更新内容</p>
          <p style="font-size:0.8rem;color:var(--muted);margin:0 0 0.8rem 0;">${body || '（无详细说明）'}</p>
          ${isElectron
            ? `<button id="btn-install-update" class="btn-primary" style="font-size:0.82rem;" data-url="${downloadUrl}">⬇️ 一键安装更新</button>`
            : `<a href="${release.html_url}" target="_blank" class="btn-primary" style="font-size:0.82rem;text-decoration:none;display:inline-block;">📥 前往下载</a>`}
        </div>`;

      setTimeout(() => {
        const installBtn = document.getElementById('btn-install-update');
        if (!installBtn) return;
        installBtn.addEventListener('click', async () => {
          installBtn.disabled = true;
          installBtn.textContent = '⏳ 下载中...';
          statusEl.textContent = '⏳ 正在下载更新...';
          try {
            const result = await window.electronAPI.installUpdate(installBtn.dataset.url);
            if (result.success) {
              statusEl.textContent = '✅ 更新已就绪';
              detailEl.innerHTML = `<p style="color:var(--green);font-size:0.82rem;">${result.message}</p>
                <button id="btn-restart-update" class="btn-primary" style="font-size:0.82rem;margin-top:0.5rem;">🔄 立即重启</button>`;
              setTimeout(() => {
                const restartBtn = document.getElementById('btn-restart-update');
                if (restartBtn) restartBtn.addEventListener('click', () => window.electronAPI.restartApp());
              }, 100);
            } else {
              statusEl.textContent = '❌ 更新失败';
              detailEl.innerHTML = `<p style="color:var(--red);font-size:0.82rem;">${result.message}</p>`;
            }
          } catch (e) {
            statusEl.textContent = '❌ 安装失败';
            detailEl.innerHTML = `<p style="color:var(--red);font-size:0.82rem;">${e.message}</p>`;
          }
        });
      }, 100);
    }
  } catch (e) {
    statusEl.textContent = '❌ 检查失败';
    detailEl.classList.remove('hidden');
    detailEl.innerHTML = `<p style="color:var(--red);font-size:0.82rem;">${e.message}</p>`;
  }
});

// 练习详情弹窗关闭
const practiceDetailModal = document.getElementById('practice-detail-modal');
if (practiceDetailModal) {
  document.getElementById('btn-close-practice-detail')?.addEventListener('click', () => {
    practiceDetailModal.classList.add('hidden');
  });
  practiceDetailModal.addEventListener('click', (e) => {
    if (e.target === practiceDetailModal) practiceDetailModal.classList.add('hidden');
  });
}

// 报告列表弹窗关闭 + 打开
const reportListModal = document.getElementById('report-list-modal');
if (reportListModal) {
  document.getElementById('btn-close-report-list')?.addEventListener('click', () => {
    reportListModal.classList.add('hidden');
  });
  reportListModal.addEventListener('click', (e) => {
    if (e.target === reportListModal) reportListModal.classList.add('hidden');
  });
}

// 查看全部报告
document.getElementById('btn-view-all-reports')?.addEventListener('click', (e) => {
  e.preventDefault();
  openReportList();
});

// 自动检查（静默，启动时）
(async function autoCheckUpdate() {
  try {
    const resp = await fetch('https://api.github.com/repos/Tazz-zhu/one-click-shangan/releases/latest', {
      headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': '一键上岸' }
    });
    if (!resp.ok) return;
    const release = await resp.json();
    const latestVer = (release.tag_name || '').replace(/^v/i, '');
    let currentVerRaw = window.__ELECTRON_VERSION__ || '1.2.0';
    try {
      if (window.electronAPI?.getVersion) {
        currentVerRaw = await window.electronAPI.getVersion();
      }
    } catch {}
    const currentVer = currentVerRaw.replace(/^v/i, '');
    if (compareVersions(latestVer, currentVer) > 0) {
      // 在右上角设置按钮旁显示小红点
      const btn = document.getElementById('btn-open-settings');
      if (btn) {
        const badge = document.createElement('span');
        badge.className = 'update-badge';
        badge.title = `新版本 v${latestVer} 可用`;
        badge.textContent = '🆕';
        badge.style.cssText = 'font-size:0.7rem;margin-left:2px;animation:pulse 2s infinite;';
        btn.parentElement.style.position = 'relative';
        btn.appendChild(badge);
      }
    }
  } catch {} // 静默失败
})();

// ===== 简历文件上传 =====
$('#btn-resume-file').addEventListener('click', () => $('#resume-file-input').click());
$('#resume-file-input').addEventListener('change', async () => {
  const file = $('#resume-file-input').files[0];
  if (!file) return;
  $('#resume-file-name').textContent = `⏳ 解析中: ${file.name}`;
  $('#btn-resume-file').disabled = true;
  try {
    const form = new FormData();
    form.append('file', file);
    // 注意：FormData 只能消费一次，不能用 fetchRetry（重试会导致空 body）
    const resp = await fetch('/api/resume-upload', { method: 'POST', body: form });
    const data = await resp.json();
    if (!resp.ok || data.error) {
      throw new Error(data.error || `上传失败 (${resp.status})`);
    }
    $('#resume-input').value = data.text;
    state.resumeFileName = data.fileName || '';
    state.resumeSourceType = data.sourceType || '';
    $('#resume-file-name').textContent = `✅ ${data.fileName} (${data.sourceType})`;
    const hintEl = $('#resume-hint');
    hintEl.textContent = `已解析 ${data.sourceType.toUpperCase()} 文件，可手动编辑后再分析`;
    if (data.warnings?.length) {
      hintEl.innerHTML += `<br><span style="color:#e5a020;font-size:0.8rem;">⚠️ ${data.warnings.join('；')}</span>`;
    }
    toast(`✅ 已解析: ${data.fileName}`);
  } catch(e) {
    // 仅当确实是错误时才提示失败
    const msg = e.message || String(e);
    if (msg && msg !== 'undefined') {
      toast('解析失败: ' + msg);
    }
    $('#resume-file-name').textContent = '或直接粘贴文本';
  } finally {
    $('#btn-resume-file').disabled = false;
  }
});

// ===== JD 链接扒取（opencli browser bridge）=====
$('#btn-jd-fetch').addEventListener('click', async () => {
  const url = $('#jd-url-input').value.trim();
  if (!url) return toast('请先粘贴岗位链接URL');
  if (!/^https?:\/\//.test(url)) return toast('请输入完整URL (http/https)');
  const btn = $('#btn-jd-fetch');
  btn.disabled = true; btn.textContent = '⏳ 扒取中...';
  try {
    const resp = await fetch('/api/jd-fetch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await resp.json();
    if (!resp.ok || data.error) {
      throw new Error(data.error || `扒取失败 (${resp.status})`);
    }
    $('#jd-input').value = data.text;
    toast(`✅ 已提取 ${data.charCount} 字${data.truncated ? ' (内容较长已截断)' : ''}`);
  } catch(e) {
    const msg = e.message || String(e);
    if (msg && msg !== 'undefined') {
      toast('扒取失败: ' + msg);
    }
  } finally {
    btn.disabled = false; btn.textContent = '🔗 扒取';
  }
});

// ===== Navigation =====
function switchTab(tabName) {
  $$('.nav-tab').forEach(t => t.classList.remove('active'));
  $$('.tab-content').forEach(t => t.classList.remove('active'));
  const tab = document.querySelector(`.nav-tab[data-tab="${tabName}"]`);
  if (tab) tab.classList.add('active');
  const content = document.getElementById(`tab-${tabName}`);
  if (content) content.classList.add('active');

  // Record tab activation for lazy loading
  if (!content?.dataset.loaded) {
    content?.setAttribute('data-loaded', '1');
    if (tabName === 'behavioral') loadBehavioralQuestions();
    if (tabName === 'company') { renderCompanyResearchHistory(); }
  }

  if (tabName === 'dashboard') { loadDashboard(); loadReadinessScore(); }
  if (tabName === 'interview') renderInterviewTabHistory();
  if (tabName === 'practice') {
    if (state.analysis) renderPracticeQuestions();
    renderPracticeHistory();
  }
  if (tabName === 'resume' && state.analysis) {
    $('#resume-opt-empty').classList.remove('hidden');
    checkAndAutoScore();
  }
  if (tabName === 'mianjing') autoFillMianjingFields();
  if (tabName === 'drill') {
    if (state.analysis) { renderDrillQuestions(); renderDrillMode(); }
    loadDrillStats();
  }
  if (tabName === 'wrongbook') { loadWrongBook(); }
  if (tabName === 'group') {
    // 检查是否有分析结果，有则启用开始按钮
    var btnStart = document.getElementById('btn-group-start');
    var hint = document.getElementById('group-start-hint');
    if (state.analysis && state.analysis.jdParsed) {
      if (btnStart) btnStart.disabled = false;
      if (hint) hint.textContent = '已检测到JD分析结果，可以开始群面模拟';
    } else {
      if (btnStart) btnStart.disabled = true;
      if (hint) hint.textContent = '请先在"分析&押题"中完成JD分析';
    }
  }
  if (tabName === 'studyplan') {
    var btn = document.getElementById('btn-studyplan-generate');
    var hint = document.getElementById('studyplan-hint');
    if (state.analysis && state.sessionId) {
      if (btn) btn.disabled = false;
      if (hint) hint.textContent = '✅ 已检测到JD分析结果，点击生成备考方案';
    } else {
      if (btn) btn.disabled = true;
      if (hint) hint.textContent = '⚠️ 需要先完成JD分析';
    }
  }
  if (tabName === 'review') {
    loadReviewHistory();
  }
  if (tabName === 'code-interview') {
    if (typeof window.CodeInterview !== 'undefined' && window.CodeInterview.init) {
      window.CodeInterview.init();
    }
  }
  if (tabName === 'admin') {
    if (typeof window.Admin !== 'undefined' && window.Admin.init) {
      window.Admin.init();
    }
  }
  if (tabName === 'resume-builder') {
    var rbFrame = document.getElementById('resume-agent-frame');
    if (rbFrame && !rbFrame.dataset.loaded) {
      rbFrame.src = 'resume-agent/index.html?embed=1';
      rbFrame.dataset.loaded = '1';
    }
  }
}

$$('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

// ============================================================
// API Calls
// ============================================================
async function apiAnalyze(jdText, resumeText, useMianjing, quickMode, manualUrls = [], resumeFileName = '', resumeSourceType = '') {
  setStatus('🔄 分析中...');

  // 显示进度条
  const pb = $('#progress-bar-wrap');
  const ps = $('#progress-steps');
  const pd = $('#progress-detail');
  pb.classList.remove('hidden');
  ps.innerHTML = '';
  pd.textContent = '正在启动分析...';

  const STEPS = quickMode
    ? ['jd_parse','resume_parse','gap_analysis','question_gen','done']
    : ['jd_parse','resume_parse','gap_analysis','question_gen','done'];
  const labels = { jd_parse:'解析JD', resume_parse:'解析简历', gap_analysis:'差距分析', question_gen:'生成押题', done:'完成' };

  // 渲染步骤条
  ps.innerHTML = STEPS.map(s => `<span class="pstep" id="pstep-${s}">${labels[s]}</span>`).join('');
  if (quickMode) {
    pd.textContent = '⚡ 快速模式：跳过面经采集，3类核心题型并行生成...';
  } else {
    pd.textContent = '正在启动分析...';
  }

  // — 计时 &
  const startTime = Date.now();
  let completedSteps = 0; let okSteps = new Set();
  const totalSteps = STEPS.length;
  const etaEl = document.createElement('span');
  etaEl.id = 'progress-eta';
  etaEl.style.cssText = 'font-size:0.78rem;color:var(--muted);display:block;margin-top:0.3rem;';
  pd.after(etaEl);

  function updateEta() {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const el = document.getElementById('progress-eta');
    if (!el) return;
    if (completedSteps === 0) {
      el.textContent = `⏱ 已等待 ${elapsed}s...`;
    } else if (completedSteps >= totalSteps) {
      el.textContent = `✅ 完成，总耗时 ${elapsed}s`;
    } else {
      const avgPerStep = elapsed / Math.max(1, completedSteps);
      const remaining = Math.ceil(avgPerStep * (totalSteps - completedSteps));
      el.textContent = `⏱ 已过 ${elapsed}s · 预计还需 ${remaining}s (${completedSteps}/${totalSteps} 步)`;
    }
  }
  const etaTimer = setInterval(updateEta, 2000);

  let result = null;

  try {
    const resp = await fetch(`${API}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jdText, resumeText, useMianjing, quickMode, manualUrls, resumeFileName, resumeSourceType })
    });

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // 解析SSE消息
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.error) { throw new Error(data.error); }
            if (data._done) { result = data; continue; }

            // 更新步骤状态
            if (data.step) {
              const idx = STEPS.indexOf(data.step);
              completedSteps = Math.max(completedSteps, idx);
              for (let i = 0; i < idx; i++) {
                const el = document.getElementById(`pstep-${STEPS[i]}`);
                if (el) el.classList.add('done');
              }
              const cur = document.getElementById(`pstep-${data.step}`);
              if (cur) {
                if (data.status === 'warn') {
                  cur.classList.add('warn');
                  cur.classList.remove('active');
                } else if (data.status === 'ok') {
                  cur.classList.add('done');
                  cur.classList.remove('active');
                } else {
                  cur.classList.add('active');
                }
              }
              if (data.detail) pd.textContent = data.detail;
            }
            if (data.status === 'ok') {
              okSteps.add(data.step);
              completedSteps = okSteps.size;
            }
          } catch(e) { /* skip malformed events */ }
        }
      }
    }
  } catch(e) {
    clearInterval(etaTimer);
    pb.classList.add('hidden');
    throw e;
  }

  if (!result) { clearInterval(etaTimer); throw new Error('未收到分析结果'); }

  clearInterval(etaTimer);
  updateEta();
  // 标记全部完成
  STEPS.forEach(s => {
    const el = document.getElementById(`pstep-${s}`);
    if (el) el.classList.add('done');
  });
  pd.textContent = '分析完成！查看押题清单 →';
  setTimeout(() => pb.classList.add('hidden'), 1500);

  return {
    sessionId: result.sessionId,
    jd: result.jd, resume: result.resume, gap: result.gap,
    questions: result.questions, insights: result.insights,
    mianjing: result.mianjing, kb_supplement: result.kb_supplement
  };
}

async function apiInterviewStart() {
  setStatus('🔄 面试启动中...');
  const resp = await fetchRetry(`${API}/interview/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: state.sessionId })
  });
  if (!resp.ok) throw new Error((await resp.json()).error);
  return resp.json();
}

async function apiInterviewAnswer(answer) {
  const resp = await fetchRetry(`${API}/interview/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: state.sessionId, answer })
  });
  if (!resp.ok) throw new Error((await resp.json()).error);
  return resp.json();
}

async function apiInterviewSkip() {
  const resp = await fetchRetry(`${API}/interview/skip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: state.sessionId })
  });
  if (!resp.ok) throw new Error((await resp.json()).error);
  return resp.json();
}

async function apiInterviewEvaluate() {
  setStatus('🔄 生成报告...');
  const resp = await fetchRetry(`${API}/interview/evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: state.sessionId })
  });
  if (!resp.ok) throw new Error((await resp.json()).error);
  return resp.json();
}

async function apiEvaluateSingle(question, answer, jdSummary, resumeText) {
  const resp = await fetchRetry(`${API}/evaluate-single`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, answer, jdSummary: jdSummary || '', resumeText: resumeText || '' })
  });
  if (!resp.ok) throw new Error((await resp.json()).error);
  return resp.json();
}

async function apiOptimizeResume() {
  setStatus('🔄 优化中...');
  // 使用原始简历文本（state.resumeText），而非分析结果
  const rawResume = state.resumeText || $('#resume-input').value.trim() || '';
  const resp = await fetchRetry(`${API}/optimize-resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: state.sessionId,
      resumeText: rawResume
    })
  });
  if (!resp.ok) throw new Error((await resp.json()).error);
  return resp.json();
}

async function apiSavePhrase(data) {
  const resp = await fetchRetry(`${API}/phrases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return resp.json();
}

async function apiLoadPhrases() {
  const resp = await fetchRetry(`${API}/phrases`);
  return resp.json();
}

async function apiDeletePhrase(id) {
  await fetchRetry(`${API}/phrases/${id}`, { method: 'DELETE' });
}

// ============================================================
// Tab 1: 分析 & 押题
// ============================================================
$('#btn-analyze').addEventListener('click', async () => {
  const jdText = $('#jd-input').value.trim();
  const resumeText = $('#resume-input').value.trim();
  const quickMode = $('#use-quick-mode')?.checked || false;

  if (!jdText || !resumeText) return toast('请同时填写JD和简历内容');

  const btn = $('#btn-analyze');
  btn.disabled = true;
  const modeLabel = quickMode ? '⚡快速' : '完整';
  btn.textContent = `${modeLabel}分析中...`;

  try {
    const result = await apiAnalyze(jdText, resumeText, false, quickMode, [], state.resumeFileName, state.resumeSourceType);
    state.sessionId = result.sessionId;
    state.analysis = result;
    state.jdText = jdText;
    state.resumeText = resumeText;
    // resume metadata already in state from upload (or '' from text paste)
    state.resumeFileName = state.resumeFileName || '';
    state.resumeSourceType = state.resumeSourceType || '';
    setStatus('✅ 分析完成，渲染结果...');
    toast('分析完成！查看押题清单');
    // 延迟渲染，让浏览器先消化最后一条 SSE 事件 + 更新状态文字
    setTimeout(() => {
      renderAnalysisResult(result);
      refreshSessionList();
      $('#nav-session-label').textContent = result.jd?.position || result.jd?.company || '当前岗位';
      $('#phrase-banner').style.display = 'none';
    }, 80);
  } catch (e) { 
    toast('❌ 分析失败: ' + e.message); 
    $('#analysis-result').innerHTML = '<div class="card" style="text-align:center;padding:2rem;color:var(--red);">' +
      '<p style="font-size:1.1rem;font-weight:600;margin-bottom:0.5rem;">❌ 分析请求失败</p>' +
      '<p style="color:var(--muted);margin-bottom:1rem;">' + e.message + '</p>' +
      '<p style="font-size:0.82rem;color:var(--muted);">💡 请检查：<br>1) AI 供应商是否已在⚙️设置中连接<br>2) 网络是否正常<br>3) API Key 是否有效</p>' +
      '</div>';
  } finally {
    btn.disabled = false; btn.textContent = '重新分析 →';
  }
});

// ---- JD 文本格式化 (显示用) ----
function formatJdText(text) {
  if (!text) return '';
  // 兜底：双反斜杠换行 → 真正换行
  text = text.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  const lines = text.split('\n');
  const parts = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      parts.push('<div style="height:0.4rem;"></div>');
      continue;
    }
    // 检测标题行: 【...】, ##..., 短行以】或：结尾, 2-8个纯中文标题
    const isHeader = /^【[^】]+】/.test(trimmed) ||
      /^##\s/.test(trimmed) ||
      (/[】：]$/.test(trimmed) && trimmed.length <= 30) ||
      /^[\u4e00-\u9fff]{2,8}$/.test(trimmed);
    // 检测列表项
    const isListItem = /^[-•·]/.test(trimmed) || /^\d+[.、)）]/.test(trimmed);

    if (isHeader) {
      parts.push('<span class="jd-section-header">' + trimmed + '</span>');
    } else if (isListItem) {
      parts.push('<span class="jd-list-item">' + trimmed + '</span>');
    } else {
      parts.push('<span class="jd-text-line">' + trimmed + '</span>');
    }
  }
  return parts.join('');
}

// ---- JD 文本框内快速排版 (本地) ----
function reformatJdInTextarea() {
  const raw = $('#jd-input').value.trim();
  if (!raw) return toast('请先粘贴JD文本');
  $('#btn-jd-format').disabled = true; $('#btn-jd-format').textContent = '⏳';
  
  fetchRetry('/api/jd-format', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: raw })
  }).then(r => r.json()).then(data => {
    if (data.text) { $('#jd-input').value = data.text; toast(data.changed ? '✅ 已排版' : '✓ 格式已良好'); }
  }).catch(e => toast('排版失败: ' + e.message))
    .finally(() => { $('#btn-jd-format').disabled = false; $('#btn-jd-format').textContent = '✨ 排版'; });
}

function renderAnalysisResult(data) {
  $('#analysis-result').classList.remove('hidden');
  const jd = data.jd || {};
  const gap = data.gap || {};

  // ---- 原始 JD / 简历卡片（可折叠） ----
  const rawJdText = state.jdText || '';
  const rawResumeText = state.resumeText || '';
  const isPdfResume = state.resumeSourceType === 'pdf';
  if (rawJdText || rawResumeText) {
    let jdHtml = '';
    if (rawJdText) {
      jdHtml += `
        <div class="raw-jd-section">
          <div class="raw-jd-title" onclick="this.parentElement.classList.toggle('collapsed')">
            📋 岗位JD原文 <span class="raw-jd-toggle">▼</span>
          </div>
          <div class="raw-jd-body">${formatJdText(rawJdText)}</div>
        </div>`;
    }
    if (rawResumeText) {
      const pdfBadge = isPdfResume ? ' <span class="pdf-badge" style="font-size:0.75rem;background:#e74c3c;color:#fff;padding:1px 6px;border-radius:3px;margin-left:4px;">PDF</span>' : '';
      const resumeHtml = isPdfResume
        ? `<div class="raw-jd-body">${formatJdText(rawResumeText)}</div>`
        : `<div class="raw-jd-body"><pre>${rawResumeText}</pre></div>`;
      jdHtml += `
        <div class="raw-jd-section">
          <div class="raw-jd-title" onclick="this.parentElement.classList.toggle('collapsed')">
            📄 简历原文${pdfBadge} <span class="raw-jd-toggle">▼</span>
          </div>
          ${resumeHtml}
        </div>`;
    }
    $('#result-meta').innerHTML = jdHtml + `
      <span style="font-size:0.85rem;">
        岗位: <strong>${jd.position || '未知'}</strong> ·
        公司: <strong>${jd.company || '未知'}</strong> ·
        匹配度: <strong>${gap.match_score || '--'}分</strong>
      </span>
    `;
  } else {
    $('#result-meta').innerHTML = `
      岗位: <strong>${jd.position || '未知'}</strong> ·
      公司: <strong>${jd.company || '未知'}</strong> ·
      匹配度: <strong>${gap.match_score || '--'}分</strong>
    `;
  }

  if (gap.match_points || gap.advantage_points || gap.weak_points) {
    const gc = $('#gap-card');
    gc.style.display = 'block';
    $('#gap-content').innerHTML = `
      <div class="gap-row">
        <div class="gap-col">
          <h4>匹配点</h4>
          ${(gap.match_points || []).map(p => `<span class="tag">${p}</span>`).join('')}
        </div>
        <div class="gap-col">
          <h4>优势点</h4>
          ${(gap.advantage_points || []).map(p => `<span class="tag advantage">${p}</span>`).join('')}
        </div>
        <div class="gap-col">
          <h4>薄弱点</h4>
          ${(gap.weak_points || []).map(p => `<span class="tag weak">${p}</span>`).join('')}
        </div>
      </div>
      ${gap.interview_strategy ? `<p style="font-size:0.85rem;color:var(--muted);">💡 ${gap.interview_strategy}</p>` : ''}
    `;
  }

  const questions = data.questions || [];
  const kbSupp = data.kb_supplement || [];
  const allQ = [...questions];
  for (const kq of kbSupp) {
    if (!allQ.find(q => q.question === kq.question)) {
      allQ.push({ ...kq, type: kq.type || '通用', source: '知识库' });
    }
  }

  const types = [...new Set(allQ.map(q => q.type || '其他'))];
  $('#q-filters').innerHTML = `
    <span class="q-filter active" data-type="all">全部(${allQ.length})</span>
    ${types.map(t => `<span class="q-filter" data-type="${t}">${t}</span>`).join('')}
  `;
  renderQuestionList(allQ, 'all');

  $$('#q-filters .q-filter').forEach(f => {
    f.addEventListener('click', () => {
      $$('#q-filters .q-filter').forEach(x => x.classList.remove('active'));
      f.classList.add('active');
      renderQuestionList(allQ, f.dataset.type);
    });
  });

  // 延迟滚动，避免和渲染竞争
  setTimeout(() => {
    $('#analysis-result').scrollIntoView({ behavior: 'smooth' });
  }, 120);

  // 下一步引导卡片（先移除旧的，避免重复）
  const oldCard = document.getElementById('next-steps-card');
  if (oldCard) oldCard.remove();
  const actions = $('#analysis-result');
  const actionCard = document.createElement('div');
  actionCard.id = 'next-steps-card';
  actionCard.className = 'card';
  actionCard.style.cssText = 'text-align:center;margin-top:1.5rem;border:2px dashed var(--accent2);background:linear-gradient(135deg, rgba(6,182,212,0.05), rgba(79,70,229,0.05));';
  actionCard.innerHTML = 
    '<h3 style="margin-bottom:0.8rem;">🎯 接下来做什么？</h3>' +
    '<div style="display:flex;gap:0.6rem;justify-content:center;flex-wrap:wrap;">' +
    '<button onclick="switchTab(\'practice\')" class="btn-primary" style="font-size:0.82rem;">💪 开始单题练习</button>' +
    '<button onclick="switchTab(\'mianjing\')" class="btn-outline" style="font-size:0.82rem;">📡 采集面经真题</button>' +
    '<button onclick="switchTab(\'interview\')" class="btn-outline" style="font-size:0.82rem;">🎤 全真模拟面试</button>' +
    '</div>';
  actions.appendChild(actionCard);
}

const PAGE_SIZE = 6; // 默认每页显示条数

function renderQuestionList(questions, filterType) {
  const filtered = filterType === 'all'
    ? questions : questions.filter(q => (q.type || '').includes(filterType));

  const wrapper = document.getElementById('questions-list');
  wrapper.innerHTML = '';

  const pageSize = PAGE_SIZE;
  const total = filtered.length;
  const pages = Math.ceil(total / pageSize);
  let currentPage = 1;

  const container = document.createElement('div');
  container.id = 'questions-grid';
  wrapper.appendChild(container);

  const paginationEl = document.createElement('div');
  paginationEl.className = 'q-pagination';
  wrapper.appendChild(paginationEl);

  function renderPage(page) {
    currentPage = page;
    const start = (page - 1) * pageSize;
    const pageItems = filtered.slice(start, start + pageSize);

    // 渲染题目卡片
    container.innerHTML = pageItems.map((q, i) => {
      const realIdx = start + i + 1;
      return `
    <div class="q-card" data-idx="${start + i}" data-question="${encodeURIComponent(q.question)}">
      <span class="q-card-num">${realIdx}</span>
      <div class="q-card-body">
        <div class="q-card-header">
          <span class="q-type ${getTypeClass(q.type)}">${q.type || '其他'}</span>
          ${q.frequency_in_mianjing ? `<span class="q-freq-badge">🔥 ${q.frequency_in_mianjing}次</span>` : ''}
          ${q.source === '知识库' ? '<span class="q-kb-badge">📚 知识库</span>' : ''}
        </div>
        <div class="q-card-q">${q.question}</div>
        <div class="q-card-intent">🎯 ${q.examiner_intent || '考察综合能力'}</div>
        <button class="btn-bookmark" data-q="${encodeURIComponent(q.question)}" data-type="${q.type||''}">⭐ 收藏</button>
      </div>
    </div>`;
    }).join('');

    // 收藏按钮
    $$('.q-card .btn-bookmark').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const question = decodeURIComponent(btn.dataset.q);
        const type = btn.dataset.type;
        btn.textContent = '⏳'; btn.disabled = true;
        try {
          const analysis = state.analysis || {};
          const resp = await fetchRetry('/api/bank/bookmark', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question, type, company: analysis.jd?.company || '', position: analysis.jd?.position || '', sessionId: state.sessionId })
          });
          if (!resp.ok) throw new Error((await resp.json()).error);
          btn.textContent = '✅ 已收藏'; toast('已收藏');
        } catch(e) {
          btn.textContent = '⭐ 收藏'; btn.disabled = false;
          toast('收藏失败: ' + e.message);
        }
      });
    });
    // 点击卡片跳转练习
    $$('.q-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        const question = decodeURIComponent(card.dataset.question);
        switchTab('practice');
        // Ensure practice area is visible before selecting question
        setTimeout(() => {
          $('#practice-area').classList.remove('hidden');
          $('#practice-empty').classList.add('hidden');
          selectPracticeQuestion(question);
        }, 400);
      });
    });

    // 分页：直接用 data-page 属性渲染，用事件委托处理点击
    if (pages <= 1) { paginationEl.innerHTML = ''; paginationEl.onclick = null; return; }
    let html = `<span class="q-page-info">${total} 道题 · ${page}/${pages} 页</span>`;
    if (page > 1) html += `<button class="q-page-btn" data-page="${page - 1}">◀ 上一页</button>`;
    if (page < pages) html += `<button class="q-page-btn" data-page="${page + 1}">下一页 ▶</button>`;
    paginationEl.innerHTML = html;
    // 事件委托：点击分页容器内的按钮统一处理（避免 innerHTML 替换导致监听器丢失）
    paginationEl.onclick = (e) => {
      const btn = e.target.closest('.q-page-btn');
      if (!btn) return;
      const targetPage = parseInt(btn.dataset.page);
      if (!isNaN(targetPage)) renderPage(targetPage);
    };
  }

  renderPage(1);
}

function getTypeClass(type) {
  if (!type) return '';
  if (type.includes('行为')) return 'behavioral';
  if (type.includes('专业') || type.includes('能力')) return 'professional';
  if (type.includes('项目') || type.includes('深挖')) return 'project';
  if (type.includes('压力') || type.includes('陷阱')) return 'pressure';
  return '';
}

// ============================================================
// Tab 2: 单题练习 + 话术库
// ============================================================
function renderPracticeQuestions() {
  if (!state.analysis) return;
  const qs = state.analysis.questions || [];
  const kb = state.analysis.kb_supplement || [];
  const mj = state.analysis.mianjing || [];
  const custom = (state._customQuestions || []);
  
  // Build combined list with source labels
  const allQs = [];
  qs.forEach(q => allQs.push({ ...q, _source: '' }));
  kb.forEach(q => allQs.push({ ...q, _source: '📚知识库' }));
  mj.forEach(q => allQs.push({ ...q, _source: '📡面经' }));
  custom.forEach(q => allQs.push({ ...q, _source: '✏️自定义' }));
  
  if (allQs.length === 0) return;
  
  // 收集所有分类
  const types = [...new Set(allQs.map(q => q.type || '其他').filter(Boolean))];
  const sources = [...new Set(allQs.map(q => q._source).filter(Boolean))];
  
  // 渲染分类筛选按钮
  const filterEl = $('#practice-q-filters');
  if (filterEl) {
    filterEl.innerHTML = `
      <span class="q-filter active" data-type="all">全部(${allQs.length})</span>
      ${types.map(t => `<span class="q-filter" data-type="${t}">${t}</span>`).join('')}
      ${sources.length > 0 ? '<span style="margin:0 2px;color:var(--rule);">|</span>' : ''}
      ${sources.map(s => `<span class="q-filter" data-source="${s.replace(/[^\u4e00-\u9fa5]/g,'')}">${s}</span>`).join('')}
    `;
    // 绑定筛选事件
    filterEl.querySelectorAll('.q-filter').forEach(f => {
      f.addEventListener('click', () => {
        filterEl.querySelectorAll('.q-filter').forEach(x => x.classList.remove('active'));
        f.classList.add('active');
        const filterType = f.dataset.type;
        const filterSource = f.dataset.source;
        renderFilteredPracticeList(allQs, filterType || 'all', filterSource || '');
      });
    });
  }
  
  // 默认渲染全部
  renderFilteredPracticeList(allQs, 'all', '');
  
  $('#practice-empty').classList.add('hidden');
  $('#practice-area').classList.remove('hidden');
}

function renderFilteredPracticeList(allQs, filterType, filterSource) {
  let filtered = allQs;
  
  // 按题型筛选
  if (filterType !== 'all') {
    filtered = filtered.filter(q => (q.type || '其他') === filterType);
  }
  // 按来源筛选
  if (filterSource) {
    filtered = filtered.filter(q => {
      const src = (q._source || '').replace(/[^\u4e00-\u9fa5]/g, '');
      return src === filterSource;
    });
  }
  
  // 渲染列表
  const qSection = filtered.length;
  const countEl = document.getElementById('practice-q-count');
  if (countEl) countEl.textContent = filtered.length;
  
  $('#practice-question-list').innerHTML = filtered.map((q, i) => `
    <li data-idx="${i}" data-question="${encodeURIComponent(q.question||'')}" style="${q._source ? 'background:var(--tag-bg);border-radius:4px;margin:2px 0;' : ''}">
      <span class="q-num">${i + 1}</span>
      ${q._source ? `<span style="font-size:0.65rem;color:var(--accent);margin-right:4px;">${q._source}</span>` : ''}
      ${q.type ? `<span class="q-type ${getTypeClass(q.type)}" style="font-size:0.62rem;padding:1px 4px;margin-right:4px;">${q.type}</span>` : ''}
      ${q.question || ''}
    </li>
  `).join('');
  
  $$('#practice-question-list li').forEach(li => {
    li.addEventListener('click', () => selectPracticeQuestion(decodeURIComponent(li.dataset.question)));
  });
}

function selectPracticeQuestion(question) {
  if (!state.analysis) state.analysis = { questions:[], mianjing:[], kb_supplement:[], jd:{}, resume:{} };
  const qs = state.analysis.questions || [];
  const kb = state.analysis.kb_supplement || [];
  const mj = state.analysis.mianjing || [];
  
  // Ensure renderPracticeQuestions has completed
  if (!document.getElementById('practice-area')?.classList.contains('hidden') === false) {
    renderPracticeQuestions();
  }
  
  const allQs = [...qs, ...kb, ...mj];
  let found = allQs.find(q => q && q.question === question);
  
  // Fallback: partial match (question text might differ slightly)
  if (!found && allQs.length > 0) {
    found = allQs.find(q => q && q.question && q.question.includes(question) || (question && question.includes(q.question)));
  }
  
  if (!found) {
    console.warn('[练习] 未找到题目:', question?.slice(0,50));
    $('#practice-q-text').textContent = question || '';
    $('#practice-q-meta').innerHTML = '<span class="q-type">题目</span>';
  } else {
    $('#practice-q-meta').innerHTML = `
      <span class="q-type ${getTypeClass(found.type)}">${found.type || ''}</span>
      <span style="font-size:0.78rem;color:var(--muted);">${found._source || ''} 🎯 ${found.examiner_intent || ''}</span>
    `;
    $('#practice-q-text').textContent = found.question || question;
  }
  
  // 清除上一题的内容：清空回答框、清除评估反馈、移除所有动态插入的标准答案卡片
  $('#practice-answer').value = '';
  $('#practice-feedback').classList.add('hidden');
  $('#practice-feedback').innerHTML = '';
  // 移除所有在 #practice-feedback 外部动态插入的模型答案卡片
  document.querySelectorAll('#practice-area .model-answer-card').forEach(function(el) { el.remove(); });
  // 移除追问/标准答案/反问按钮区域
  document.querySelectorAll('.follow-up-section').forEach(function(el) { el.remove(); });
  // 清除进度指示器
  document.querySelectorAll('[id^="model-answer-progress-"]').forEach(function(el) { el.remove(); });
  
  $('#btn-save-phrase').classList.add('hidden');
  state._practiceQuestion = question;
  state._lastFeedback = null;
  $('#practice-empty').classList.add('hidden');
  $('#practice-area').classList.remove('hidden');
  
  // Highlight the correct item in the list
  $$('#practice-question-list li').forEach(li => {
    const liQ = decodeURIComponent(li.dataset.question || '');
    li.classList.toggle('active', liQ === question || liQ.includes(question) || (question && question.includes(liQ)));
  });
  
  setTimeout(() => { 
    const card = document.getElementById('practice-question-card');
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const ta = document.getElementById('practice-answer'); 
    if (ta) ta.focus(); 
  }, 200);
}

// 回答框自动扩高
(function() {
  const ta = document.getElementById('practice-answer');
  if (ta) {
    ta.addEventListener('input', debounce(() => {
      ta.style.height = 'auto';
      ta.style.height = Math.max(100, ta.scrollHeight) + 'px';
    }));
  }
})();

$('#btn-practice-submit').addEventListener('click', async () => {
  const answer = $('#practice-answer').value.trim();
  const question = state._practiceQuestion;
  if (!question) return toast('请先选择题面');
  if (!answer || answer.length < 5) return toast('请写下你的回答（至少5个字）');

  const btn = $('#btn-practice-submit');
  btn.disabled = true; btn.textContent = '评估中...';
  setStatus('🔄 评估中...');

  // 显示进度指示器
  $('#practice-feedback').classList.remove('hidden');
  $('#practice-feedback').innerHTML = '<div id="practice-eval-progress" style="display:none;"></div>';
  var progress = showAiProgress('practice-eval-progress', [
    '正在分析你的回答...',
    '正在逐句评估...',
    '正在生成改进建议...',
    '评估完成'
  ]);

  try {
    // 构建 JD 摘要 + 简历上下文
    progress.update(0);
    await new Promise(function(r) { setTimeout(r, 200); });

    const jd = state.analysis?.jd || {};
    const jdSummary = jd.position
      ? `${jd.company || ''} ${jd.position} | ${jd.requirements || jd.responsibilities || ''}`.slice(0, 400)
      : (jd.requirements || jd.responsibilities || '');
    const resumeText = state.resumeText || '';

    progress.update(1);
    const result = await apiEvaluateSingle(question, answer, jdSummary, resumeText.slice(0, 3000));

    progress.update(2);
    await new Promise(function(r) { setTimeout(r, 200); });
    progress.done();

    state._lastFeedback = result;
    setTimeout(function() { progress.hide(); }, 500);
    renderSingleFeedback(result);
    // 根据用户选择决定是否保存练习记录
    const saveHistory = document.getElementById('chk-save-history')?.checked !== false;
    if (saveHistory) {
      autoSavePracticeRecord(question, answer, result);
    }
    if ((result.overall_score || 0) >= 85) {
      $('#btn-save-phrase').classList.remove('hidden');
    }
    // 小红点标记
    showTabDot('practice');
    setStatus('✅ 评估完成');
    // 追问按钮
    showFollowUpButton('practice', question, answer, result);
  } catch (e) {
    toast('评估失败: ' + e.message);
    if (progress) progress.hide();
  } finally {
    btn.disabled = false; btn.textContent = '重新提交';
  }
});

function renderSingleFeedback(data) {
  const scores = data.scores || {};
  const lines = data.line_by_line || [];
  $('#practice-feedback').classList.remove('hidden');
  $('#practice-feedback').innerHTML = `
    <div class="card feedback-card">
      <h3>评估结果 — 综合 ${data.overall_score || '--'}分</h3>
      <div class="feedback-scores">
        ${['star_completeness','quantification','position_match','structure','highlight'].map(k => `
          <div class="feedback-score">
            <div class="num">${scores[k] || '--'}</div>
            <div class="label">${{star_completeness:'STAR完整性',quantification:'量化程度',position_match:'岗位匹配',structure:'表达结构',highlight:'亮点突出'}[k]}</div>
          </div>
        `).join('')}
      </div>
      <div class="feedback-lines">
        ${lines.map(l => `
          <div class="feedback-line ${l.is_good ? 'good' : 'bad'}">
            ${l.is_good ? '✅' : '⚠️'} "${l.quote}" — ${l.comment}
          </div>
        `).join('')}
      </div>
      ${data.improved_version ? `
      <div class="feedback-improved">
        <strong>改进版参考：</strong><br>${data.improved_version}
      </div>` : ''}
      ${data.key_takeaways ? `
      <div style="font-size:0.82rem;color:var(--muted);">
        <strong>关键改进点：</strong>${data.key_takeaways.join('；')}
      </div>` : ''}
    </div>
  `;
  $('#practice-feedback').scrollIntoView({ behavior: 'smooth' });
}

// 话术库保存
$('#btn-save-phrase').addEventListener('click', async () => {
  if (!state._lastFeedback) return;
  const fb = state._lastFeedback;
  try {
    await apiSavePhrase({
      question: state._practiceQuestion,
      answer: $('#practice-answer').value.trim(),
      improvedVersion: fb.improved_version || fb.raw || '',
      score: fb.overall_score || 0,
      tags: ['练习']
    });
    toast('✅ 已存入话术库');
    $('#btn-save-phrase').textContent = '✅ 已保存';
    // 自动打开话术库面板
    const pp = document.getElementById('phrase-panel');
    if (pp) { pp.open = true; pp.classList.remove('hidden'); refreshPhraseList(); }
    setTimeout(() => { $('#btn-save-phrase').classList.add('hidden'); }, 2000);
  } catch (e) { toast('保存失败: ' + e.message); }
});

// 话术库面板（使用 <details> 原生折叠，自动加载）
(function() {
  const panel = document.getElementById('phrase-panel');
  if (panel) {
    panel.addEventListener('toggle', () => {
      if (panel.open) refreshPhraseList();
    });
  }
})();
$('#phrase-score-filter')?.addEventListener('change', () => refreshPhraseList());

async function refreshPhraseList() {
  try {
    const minScore = parseInt($('#phrase-score-filter')?.value || '0') || 0;
    const data = await apiLoadPhrases();
    let phrases = data.phrases;
    if (minScore > 0) phrases = phrases.filter(p => (p.score || 0) >= minScore);
    if (phrases.length === 0) {
      $('#phrase-list').innerHTML = '<p style="color:var(--muted);">' + (minScore > 0 ? '没有 ≥' + minScore + '分 的话术' : '话术库为空。练习中得分85+的回答可手动存入。') + '</p>';
      return;
    }
    $('#phrase-list').innerHTML = phrases.map(p => `
      <div class="phrase-item">
        <div class="phrase-header">
          <span class="phrase-score">${p.score}分</span>
          <span class="phrase-date">${new Date(p.createdAt).toLocaleDateString('zh-CN')}</span>
          <button class="phrase-del" data-id="${p.id}" title="删除">✕</button>
        </div>
        <div class="phrase-q">Q: ${p.question}</div>
        <details><summary>查看回答</summary><div class="phrase-a">${p.answer}</div></details>
        ${p.improvedVersion ? `<details><summary>改进版</summary><div class="phrase-a improved">${p.improvedVersion}</div></details>` : ''}
      </div>
    `).join('');
    $$('.phrase-del').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await apiDeletePhrase(btn.dataset.id);
        await refreshPhraseList();
      });
    });
  } catch (e) { /* ignore */ }
}

// ============================================================
// Tab 3: 全真模拟面试
// ============================================================
$('#btn-interview-start').addEventListener('click', async () => {
  if (!state.sessionId) {
    toast('⚠️ 请先在「分析 & 押题」完成JD分析，或在「单题练习」中逐题练习');
    return;
  }
  const btn = $('#btn-interview-start');
  btn.disabled = true; btn.textContent = '启动中...';
  try {
    const result = await apiInterviewStart();
    state.interviewActive = true;
    $('#interview-empty').classList.add('hidden');
    $('#interview-area').classList.remove('hidden');
    $('#interview-report').classList.add('hidden');
    $('#interview-chat').innerHTML = '';
    addChatMsg('interviewer', result.message, result.stage);
    setStatus('🎤 面试中');
    setTimeout(function() { showInterviewModelAnswerButton(); }, 300);
    // 显示标准答案按钮
    showInterviewModelAnswerButton();
  } catch (e) { toast('启动失败: ' + e.message); }
  finally { btn.disabled = false; btn.textContent = '开始模拟面试'; }
});

// ============================================================
// 多轮面试 — 事件绑定
// ============================================================
$('#btn-interview-multi-start').addEventListener('click', async () => {
  if (!state.sessionId) {
    toast('⚠️ 请先在「分析 & 押题」完成JD分析');
    return;
  }
  const btn = $('#btn-interview-multi-start');
  btn.disabled = true; btn.textContent = '加载中...';
  try {
    // 获取多轮面试信息
    const infoRes = await fetchRetry('/api/interview/multi/info?sessionId=' + encodeURIComponent(state.sessionId)).then(r => r.json());
    if (infoRes.error) { toast('无法启动多轮面试: ' + infoRes.error); return; }
    if (!infoRes.enabled) { toast('当前岗位不支持多轮面试模式'); return; }
    
    if (!infoRes.hasEnoughQuestions && !infoRes.activeMultiRound) {
      toast('分析题目不足，至少需要' + (infoRes.totalRounds * 2) + '道题才能开启多轮面试');
      return;
    }

    // 启动多轮面试（从第1轮开始）
    const startRes = await fetchRetry('/api/interview/multi/start', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ sessionId: state.sessionId, roundNumber: 1 })
    }).then(r => r.json());

    if (startRes.error) { toast('启动失败: ' + startRes.error); return; }

    state.multiRoundActive = true;
    state.interviewActive = true;
    
    // 隐藏空状态，显示面试区域
    $('#interview-empty').classList.add('hidden');
    $('#interview-area').classList.remove('hidden');
    $('#interview-report').classList.add('hidden');
    $('#interview-chat').innerHTML = '';
    
    // 显示多轮面试进度条
    var multiBar = $('#multi-round-bar');
    multiBar.classList.remove('hidden');
    updateMultiRoundBar(infoRes.rounds || [], 1, infoRes.totalRounds);
    
    // 显示模式标记
    var modeBadge = document.createElement('div');
    modeBadge.id = 'multi-round-mode-badge';
    modeBadge.style.cssText = 'text-align:center;padding:0.3rem;background:var(--accent);color:#fff;font-size:0.78rem;border-radius:6px;margin-bottom:0.5rem;font-weight:600;';
    modeBadge.textContent = '🎯 多轮面试模式 — 第1轮: ' + (startRes.roundInfo?.roundLabel || '') + '（共' + infoRes.totalRounds + '轮）';
    $('#interview-chat').appendChild(modeBadge);
    
    addChatMsg('interviewer', startRes.message, startRes.stage);
    setStatus('🎤 多轮面试中');
    setTimeout(function() { showInterviewModelAnswerButton(); }, 300);
  } catch (e) { toast('启动失败: ' + e.message); }
  finally { btn.disabled = false; btn.textContent = '多轮面试 (推荐)'; }
});

// ============================================================
// 压力面试（对抗练习）— 事件绑定
// ============================================================
$('#btn-interview-stress-start').addEventListener('click', async () => {
  if (!state.sessionId) {
    toast('⚠️ 请先在「分析 & 押题」完成JD分析');
    return;
  }
  const btn = $('#btn-interview-stress-start');
  btn.disabled = true; btn.textContent = '启动中...';
  try {
    const res = await fetchRetry('/api/interview/stress/start', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ sessionId: state.sessionId })
    }).then(r => r.json());

    if (res.error) { toast('启动失败: ' + res.error); return; }

    state.stressInterviewActive = true;
    $('#interview-empty').classList.add('hidden');
    $('#interview-area').classList.remove('hidden');
    $('#interview-report').classList.add('hidden');
    $('#interview-chat').innerHTML = '';

    // 显示压力面试模式标记
    var modeBadge = document.createElement('div');
    modeBadge.id = 'stress-mode-badge';
    modeBadge.style.cssText = 'text-align:center;padding:0.3rem;background:#DC2626;color:#fff;font-size:0.78rem;border-radius:6px;margin-bottom:0.5rem;font-weight:600;';
    modeBadge.textContent = '🔥 压力面试模式 — AI面试官会打断、质疑、施压，保持冷静！';
    $('#interview-chat').appendChild(modeBadge);

    if (res.tips) {
      var tipMsg = document.createElement('div');
      tipMsg.className = 'chat-msg system';
      tipMsg.textContent = res.tips;
      $('#interview-chat').appendChild(tipMsg);
    }

    addChatMsg('interviewer', res.message, '压力面试');
    setStatus('🔥 压力面试中');
    showInterviewModelAnswerButton();
  } catch (e) { toast('启动失败: ' + e.message); }
  finally { btn.disabled = false; btn.textContent = '🔥 压力面试'; }
});

// 压力面试提交回答（覆盖原有提交逻辑）
async function submitStressInterviewAnswer() {
  const answer = $('#interview-answer').value.trim();
  if (!answer || answer.length < 3) return toast('请输入你的回答');
  if (!state.stressInterviewActive) return;
  addChatMsg('candidate', answer);
  $('#interview-answer').value = '';
  const btn = $('#btn-interview-submit');
  btn.disabled = true;
  try {
    const res = await fetchRetry('/api/interview/stress/respond', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ sessionId: state.sessionId, answer })
    }).then(r => r.json());

    if (res.error) { toast('处理失败: ' + res.error); return; }

    if (res.type === 'end') {
      state.stressInterviewActive = false;
      addChatMsg('system', '压力面试结束！正在生成评估报告...');
      // 加载评估报告
      try {
        const evalRes = await fetchRetry('/api/interview/stress/evaluate', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ sessionId: state.sessionId })
        }).then(r => r.json());
        if (evalRes.report) {
          renderStressReport(evalRes.report);
        }
      } catch {}
    } else if (res.type === 'interrupt') {
      addChatMsg('system', '⛔ 面试官打断了你');
      addChatMsg('interviewer', res.message, '压力追问');
    } else if (res.type === 'challenge') {
      addChatMsg('system', '❓ 面试官提出质疑');
      addChatMsg('interviewer', res.message, '质疑');
    } else if (res.type === 'silence') {
      addChatMsg('system', '🕐 面试官沉默了几秒...');
      addChatMsg('interviewer', res.message, '施压');
    } else {
      addChatMsg('interviewer', res.question || res.message, '压力面试');
      showInterviewModelAnswerButton();
    }
  } catch (e) { toast('处理失败: ' + e.message); }
  finally { btn.disabled = false; }
}

// 渲染压力面试报告
function renderStressReport(report) {
  if (!report) return;
  $('#interview-report').classList.remove('hidden');
  var scores = report.scores || {};
  var html = '<div class="card"><h3>📊 压力面试评估报告</h3>';
  html += '<div style="display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:1rem;">';
  var dims = [
    { key: 'stress_resistance', label: '抗压能力', color: '#4F46E5' },
    { key: 'adaptability', label: '应变能力', color: '#10B981' },
    { key: 'answer_quality', label: '回答质量', color: '#F59E0B' },
    { key: 'emotion_control', label: '情绪控制', color: '#8B5CF6' },
    { key: 'overall', label: '整体表现', color: '#22d3ee' }
  ];
  dims.forEach(function(d) {
    var v = scores[d.key] || 0;
    html += '<div style="flex:1;min-width:120px;text-align:center;padding:0.8rem;background:var(--bg1);border-radius:8px;">' +
      '<div style="font-size:1.5rem;font-weight:700;color:' + d.color + ';">' + v + '</div>' +
      '<div style="font-size:0.72rem;color:var(--muted);">' + d.label + '</div></div>';
  });
  html += '</div>';
  if (report.total_score) {
    html += '<div style="text-align:center;margin-bottom:0.8rem;"><span style="font-size:1.2rem;font-weight:700;">总分: ' + report.total_score + '</span></div>';
  }
  if (report.strengths && report.strengths.length) {
    html += '<div style="margin-bottom:0.5rem;"><strong>✅ 优势</strong><ul>' + report.strengths.map(function(s) { return '<li>' + s + '</li>'; }).join('') + '</ul></div>';
  }
  if (report.weaknesses && report.weaknesses.length) {
    html += '<div style="margin-bottom:0.5rem;"><strong>⚠️ 待改进</strong><ul>' + report.weaknesses.map(function(w) { return '<li>' + w + '</li>'; }).join('') + '</ul></div>';
  }
  if (report.advice) {
    html += '<div style="padding:0.6rem;background:var(--bg1);border-radius:6px;"><strong>💡 建议：</strong>' + report.advice + '</div>';
  }
  html += '</div><div style="margin-top:0.5rem;display:flex;gap:0.4rem;justify-content:flex-end;">' +
    '<button onclick="resetInterviewUI()" class="btn-primary" style="font-size:0.78rem;">重新开始</button></div>';
  $('#interview-report').innerHTML = html;
}

// ============================================================
// 面试陪练模式 — 自由对话
// ============================================================
$('#btn-practice-free-start').addEventListener('click', async () => {
  if (!state.sessionId) {
    toast('⚠️ 请先在「分析 & 押题」完成JD分析');
    return;
  }
  const btn = $('#btn-practice-free-start');
  btn.disabled = true; btn.textContent = '启动中...';
  try {
    const res = await fetchRetry('/api/practice/free/start', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ sessionId: state.sessionId })
    }).then(r => r.json());

    if (res.error) { toast('启动失败: ' + res.error); return; }

    state.freePracticeActive = true;
    $('#interview-empty').classList.add('hidden');
    $('#interview-area').classList.remove('hidden');
    $('#interview-report').classList.add('hidden');
    $('#interview-chat').innerHTML = '';

    // 显示陪练模式标记
    var modeBadge = document.createElement('div');
    modeBadge.id = 'free-mode-badge';
    modeBadge.style.cssText = 'text-align:center;padding:0.3rem;background:#10B981;color:#fff;font-size:0.78rem;border-radius:6px;margin-bottom:0.5rem;font-weight:600;';
    modeBadge.textContent = '💬 面试陪练模式 — 自由对话，随时反问、换话题';
    $('#interview-chat').appendChild(modeBadge);

    if (res.tips) {
      var tipMsg = document.createElement('div');
      tipMsg.className = 'chat-msg system';
      tipMsg.textContent = res.tips;
      $('#interview-chat').appendChild(tipMsg);
    }

    addChatMsg('coach', res.message, '陪练');
    setStatus('💬 陪练中');
  } catch (e) { toast('启动失败: ' + e.message); }
  finally { btn.disabled = false; btn.textContent = '💬 面试陪练'; }
});

// 陪练模式提交回答
async function submitFreePracticeAnswer() {
  const answer = $('#interview-answer').value.trim();
  if (!answer || answer.length < 3) return toast('请输入你的回答');
  if (!state.freePracticeActive) return;
  addChatMsg('candidate', answer);
  $('#interview-answer').value = '';
  const btn = $('#btn-interview-submit');
  btn.disabled = true;
  try {
    const res = await fetchRetry('/api/practice/free/respond', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ sessionId: state.sessionId, message: answer })
    }).then(r => r.json());

    if (res.error) { toast('处理失败: ' + res.error); return; }

    // 显示反馈
    if (res.feedback) {
      var feedbackDiv = document.createElement('div');
      feedbackDiv.className = 'chat-msg system';
      feedbackDiv.textContent = '💡 ' + res.feedback;
      $('#interview-chat').appendChild(feedbackDiv);
    }

    // 显示陪练跟进
    if (res.followUp) {
      addChatMsg('coach', res.followUp, '陪练');
    }

    if (res.canEnd) {
      // 显示结束确认按钮
      var endDiv = document.createElement('div');
      endDiv.style.cssText = 'text-align:center;margin:0.5rem 0;';
      endDiv.innerHTML = '<button onclick="endFreePractice()" class="btn-outline" style="font-size:0.78rem;color:#10B981;border-color:#10B981;">📊 结束陪练并查看评估</button>';
      $('#interview-chat').appendChild(endDiv);
    }
  } catch (e) { toast('处理失败: ' + e.message); }
  finally { btn.disabled = false; }
}

// 结束陪练模式
async function endFreePractice() {
  try {
    const res = await fetchRetry('/api/practice/free/evaluate', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ sessionId: state.sessionId })
    }).then(r => r.json());

    state.freePracticeActive = false;
    addChatMsg('system', '陪练结束！正在生成评估...');

    if (res.report) {
      renderFreePracticeReport(res.report);
    }
  } catch (e) { toast('评估失败: ' + e.message); }
}

// 渲染陪练报告
function renderFreePracticeReport(report) {
  if (!report) return;
  $('#interview-report').classList.remove('hidden');
  var scores = report.scores || {};
  var html = '<div class="card"><h3>📊 面试陪练评估报告</h3>';
  html += '<div style="display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:1rem;">';
  var dims = [
    { key: 'clarity', label: '表达清晰度', color: '#4F46E5' },
    { key: 'depth', label: '内容深度', color: '#10B981' },
    { key: 'interaction', label: '互动质量', color: '#F59E0B' },
    { key: 'learning', label: '学习能力', color: '#8B5CF6' },
    { key: 'overall', label: '整体表现', color: '#22d3ee' }
  ];
  dims.forEach(function(d) {
    var v = scores[d.key] || 0;
    html += '<div style="flex:1;min-width:120px;text-align:center;padding:0.8rem;background:var(--bg1);border-radius:8px;">' +
      '<div style="font-size:1.5rem;font-weight:700;color:' + d.color + ';">' + v + '</div>' +
      '<div style="font-size:0.72rem;color:var(--muted);">' + d.label + '</div></div>';
  });
  html += '</div>';
  if (report.total_score) {
    html += '<div style="text-align:center;margin-bottom:0.8rem;"><span style="font-size:1.2rem;font-weight:700;">总分: ' + report.total_score + '</span></div>';
  }
  if (report.strengths && report.strengths.length) {
    html += '<div style="margin-bottom:0.5rem;"><strong>✅ 优势</strong><ul>' + report.strengths.map(function(s) { return '<li>' + s + '</li>'; }).join('') + '</ul></div>';
  }
  if (report.suggestions && report.suggestions.length) {
    html += '<div style="margin-bottom:0.5rem;"><strong>💡 改进建议</strong><ul>' + report.suggestions.map(function(s) { return '<li>' + s + '</li>'; }).join('') + '</ul></div>';
  }
  if (report.practice_tips) {
    html += '<div style="padding:0.6rem;background:var(--bg1);border-radius:6px;"><strong>📝 后续练习建议：</strong>' + report.practice_tips + '</div>';
  }
  html += '</div><div style="margin-top:0.5rem;display:flex;gap:0.4rem;justify-content:flex-end;">' +
    '<button onclick="resetInterviewUI()" class="btn-primary" style="font-size:0.78rem;">重新开始</button></div>';
  $('#interview-report').innerHTML = html;
}

// 重置面试UI到初始状态
function resetInterviewUI() {
  state.interviewActive = false;
  state.stressInterviewActive = false;
  state.freePracticeActive = false;
  state.multiRoundActive = false;
  $('#interview-area').classList.add('hidden');
  $('#interview-report').classList.add('hidden');
  $('#interview-empty').classList.remove('hidden');
  $('#interview-chat').innerHTML = '';
  $('#interview-answer').value = '';
  setStatus('⚪ 就绪');
  var badge = $('#stress-mode-badge');
  if (badge) badge.remove();
  var badge2 = $('#free-mode-badge');
  if (badge2) badge2.remove();
  var multiBadge = $('#multi-round-mode-badge');
  if (multiBadge) multiBadge.remove();
  $('#multi-round-bar').classList.add('hidden');
}

function addChatMsg(role, content, stage) {
  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;
  if (stage) div.innerHTML = `<div class="chat-stage">${stage}</div>${content}`;
  else div.textContent = content;
  // Add speak button for interviewer messages
  if (role === 'interviewer') {
    var speakBtn = document.createElement('button');
    speakBtn.className = 'btn-speak';
    speakBtn.textContent = '🔊';
    speakBtn.dataset.text = content;
    speakBtn.style.cssText = 'margin-left:0.4rem;width:28px;height:28px;font-size:0.8rem;flex-shrink:0;';
    div.style.display = 'flex';
    div.style.alignItems = 'flex-start';
    div.style.gap = '0.3rem';
    var textSpan = document.createElement('span');
    textSpan.style.flex = '1';
    if (stage) textSpan.innerHTML = `<div class="chat-stage">${stage}</div>${content}`;
    else textSpan.textContent = content;
    div.textContent = '';
    div.appendChild(textSpan);
    div.appendChild(speakBtn);
  }
  $('#interview-chat').appendChild(div);
  $('#interview-chat').scrollTop = $('#interview-chat').scrollHeight;
}

async function submitInterviewAnswer() {
  const answer = $('#interview-answer').value.trim();
  if (!answer || answer.length < 3) return toast('请输入你的回答');
  if (!state.interviewActive) return;
  addChatMsg('candidate', answer);
  $('#interview-answer').value = '';
  const btn = $('#btn-interview-submit');
  btn.disabled = true;
  try {
    const result = await apiInterviewAnswer(answer);
    if (result.type === 'end') {
      addChatMsg('system', '面试结束！正在生成评估报告...');
      state.interviewActive = false;
      await loadInterviewReport();
    } else if (result.type === 'follow_up') {
      addChatMsg('system', `追问 — ${result.followUpType || ''}`);
      addChatMsg('interviewer', result.message);
    } else {
      addChatMsg('interviewer', result.message, result.stage);
      // 更新标准答案按钮的题目
      showInterviewModelAnswerButton();
    }
  } catch (e) { toast('处理失败: ' + e.message); }
  finally { btn.disabled = false; }
}

$('#btn-interview-submit').addEventListener('click', () => {
  if (state.stressInterviewActive) submitStressInterviewAnswer();
  else if (state.freePracticeActive) submitFreePracticeAnswer();
  else submitInterviewAnswer();
});
$('#interview-answer').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
    e.preventDefault();
    if (state.stressInterviewActive) submitStressInterviewAnswer();
    else if (state.freePracticeActive) submitFreePracticeAnswer();
    else submitInterviewAnswer();
  }
  // Ctrl+Enter / Shift+Enter = 换行
});

$('#btn-interview-skip').addEventListener('click', async () => {
  if (!state.interviewActive) return;
  try {
    const result = await apiInterviewSkip();
    if (result.type === 'end') {
      addChatMsg('system', '面试结束！正在生成评估报告...');
      state.interviewActive = false;
      await loadInterviewReport();
    } else { addChatMsg('interviewer', result.message, result.stage); }
  } catch (e) { toast('跳过失败: ' + e.message); }
});

$('#btn-interview-end').addEventListener('click', async () => {
  if (!state.sessionId) return;

  // 压力面试结束
  if (state.stressInterviewActive) {
    try {
      const res = await fetchRetry('/api/interview/stress/evaluate', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ sessionId: state.sessionId })
      }).then(r => r.json());
      state.stressInterviewActive = false;
      addChatMsg('system', '压力面试已结束，正在生成评估报告...');
      if (res.report) renderStressReport(res.report);
    } catch (e) { toast('评估失败: ' + e.message); }
    return;
  }

  // 陪练模式结束
  if (state.freePracticeActive) {
    await endFreePractice();
    return;
  }

  // 多轮面试结束当前轮
  if (state.multiRoundActive) {
    try {
      const chat = $('#interview-chat');
      const inputArea = document.querySelector('.interview-input');
      if (inputArea) inputArea.style.display = 'none';
      
      chat.innerHTML += '<div class="card" style="text-align:center;padding:2rem;border:2px dashed var(--accent2);"><div class="spinner" style="margin:0 auto 1rem;"></div><p style="font-size:1rem;font-weight:600;">第' + (state._multiRoundCurrent || 1) + '轮结束 · AI 正在评估...</p></div>';
      chat.scrollTop = chat.scrollHeight;
      
      const resp = await fetchRetry('/api/interview/multi/round-evaluate', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ sessionId: state.sessionId })
      }).then(r => r.json());
      
      if (resp.error) { toast('评估失败: ' + resp.error); return; }
      
      // 显示轮次评估
      setTimeout(() => {
        chat.innerHTML = '';
        chat.insertAdjacentHTML('beforeend', '<div class="card" style="text-align:center;padding:1rem;background:linear-gradient(135deg, rgba(79,70,229,0.08), rgba(6,182,212,0.08));border:1px solid var(--accent);"><p style="font-size:1.05rem;font-weight:600;">第' + resp.currentRound + '轮 · ' + (resp.roundLabel || '') + ' 完成</p><p style="font-size:0.85rem;color:var(--muted);">得分: ' + resp.roundScore + '</p></div>');
        renderInterviewReport(resp.report);
        if (inputArea) inputArea.style.display = '';
      }, 800);
      
      // 更新进度条
      updateMultiRoundBar(null, resp.currentRound, resp.totalRounds);
      
      // 如果不是最后一轮，显示继续下一轮按钮
      if (!resp.isLastRound && resp.nextRound) {
        setTimeout(() => {
          $('#interview-report').insertAdjacentHTML('beforeend', '<div class="card" style="text-align:center;margin-top:0.5rem;padding:0.8rem;"><p style="font-size:0.9rem;margin-bottom:0.5rem;">下一轮: ' + resp.nextRound.label + '</p><button id="btn-multi-next-round" class="btn-primary" style="font-size:0.85rem;">🚀 进入第' + resp.nextRound.round + '轮</button></div>');
          $('#btn-multi-next-round').addEventListener('click', async function() {
            startNextMultiRound(resp.nextRound.round);
          });
        }, 1000);
      } else if (resp.allCompleted) {
        // 所有轮次完成，显示综合报告
        setTimeout(() => {
          loadMultiRoundFinalReport();
        }, 1000);
      }
      
    } catch (e) { toast('评估失败: ' + e.message); }
    return;
  }
  
  // Check if there are answered questions
  const interview = state._interviewState;
  const hasAnswers = interview?.history?.some(m => m.role === 'candidate');
  
  if (!hasAnswers) {
    // No answers yet - just reset
    resetInterviewUI();
    toast('面试已取消');
    return;
  }
  
  // Show graceful transition UI
  const chat = $('#interview-chat');
  const inputArea = document.querySelector('.interview-input');
  if (inputArea) inputArea.style.display = 'none';
  
  chat.innerHTML += `
    <div class="card" style="text-align:center;padding:2rem;border:2px dashed var(--accent2);">
      <div class="spinner" style="margin:0 auto 1rem;"></div>
      <p style="font-size:1rem;font-weight:600;">面试结束 · AI 正在整理评估报告...</p>
      <p style="font-size:0.8rem;color:var(--muted);margin-top:0.5rem;">
        已回答 ${interview?.askedQuestions?.length || 0} 题，即将生成五维能力雷达图与逐题点评
      </p>
    </div>
  `;
  chat.scrollTop = chat.scrollHeight;
  
  try {
    const resp = await fetchRetry('/api/interview/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: state.sessionId })
    });
    if (!resp.ok) throw new Error((await resp.json()).error);
    const data = await resp.json();
    
    // Replace spinner with report
    setTimeout(() => {
      chat.innerHTML = '';
      chat.insertAdjacentHTML('beforeend', `
        <div class="card" style="text-align:center;padding:1rem;background:linear-gradient(135deg, rgba(79,70,229,0.08), rgba(6,182,212,0.08));border:1px solid var(--accent);">
          <p style="font-size:1.05rem;font-weight:600;">面试完毕</p>
          <p style="font-size:0.85rem;color:var(--muted);">共回答 ${interview?.askedQuestions?.length || '?'} 题 · 综合评分 ${data.report?.overall_score || '--'}</p>
        </div>
      `);
      renderInterviewReport(data);
      if (inputArea) inputArea.style.display = '';
      resetInterviewUI(true);
    }, 800);
    
  } catch (e) { 
    toast('评估失败: ' + e.message); 
    if (inputArea) inputArea.style.display = '';
  }
});

// 更新多轮面试进度条
function updateMultiRoundBar(rounds, currentRound, totalRounds) {
  var bar = $('#multi-round-bar');
  if (!bar) return;
  bar.classList.remove('hidden');
  var titleEl = $('#multi-round-title');
  var currentEl = $('#multi-round-current');
  var progressText = $('#multi-round-progress-text');
  var stepsEl = $('#multi-round-steps');
  
  if (titleEl) titleEl.textContent = (state._positionLabel || '多轮面试') + ' · 多轮面试';
  if (currentEl) currentEl.textContent = '第' + currentRound + '轮';
  if (progressText) progressText.textContent = currentRound + ' / ' + totalRounds;
  
  state._multiRoundCurrent = currentRound;
  state._multiRoundTotal = totalRounds;
  
  if (stepsEl && rounds && rounds.length) {
    stepsEl.innerHTML = rounds.map(function(r, i) {
      var status = i + 1 < currentRound ? 'completed' : (i + 1 === currentRound ? 'active' : 'pending');
      var cls = status === 'completed' ? 'color:var(--green);' : (status === 'active' ? 'color:var(--accent);font-weight:600;' : 'color:var(--muted);opacity:0.5;');
      var icon = status === 'completed' ? '✅' : (status === 'active' ? '🔵' : '⚪');
      return '<span style="display:flex;align-items:center;gap:0.2rem;font-size:0.72rem;' + cls + '">' + icon + ' ' + r.label + '</span>';
    }).join(' → ');
  }
}

// 启动下一轮多轮面试
async function startNextMultiRound(roundNumber) {
  try {
    $('#interview-report').classList.add('hidden');
    $('#interview-report').innerHTML = '';
    $('#interview-area').classList.remove('hidden');
    $('#interview-chat').innerHTML = '';
    
    var inputArea = document.querySelector('.interview-input');
    if (inputArea) inputArea.style.display = '';
    
    // 显示模式标记
    var modeBadge = document.createElement('div');
    modeBadge.id = 'multi-round-mode-badge';
    modeBadge.style.cssText = 'text-align:center;padding:0.3rem;background:var(--accent);color:#fff;font-size:0.78rem;border-radius:6px;margin-bottom:0.5rem;font-weight:600;';
    modeBadge.textContent = '🎯 多轮面试模式 — 第' + roundNumber + '轮进行中';
    $('#interview-chat').appendChild(modeBadge);
    
    setStatus('🎤 多轮面试中');
    
    const res = await fetchRetry('/api/interview/multi/start', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ sessionId: state.sessionId, roundNumber: roundNumber })
    }).then(r => r.json());
    
    if (res.error) { toast('启动失败: ' + res.error); return; }
    
    state.multiRoundActive = true;
    state.interviewActive = true;
    
    addChatMsg('interviewer', res.message, res.stage);
    updateMultiRoundBar(null, roundNumber, state._multiRoundTotal || 3);
    setTimeout(function() { showInterviewModelAnswerButton(); }, 300);
  } catch (e) { toast('启动下一轮失败: ' + e.message); }
}

// 加载多轮面试综合报告
async function loadMultiRoundFinalReport() {
  try {
    const res = await fetchRetry('/api/interview/multi/report?sessionId=' + encodeURIComponent(state.sessionId)).then(r => r.json());
    if (!res.enabled || !res.roundReports || !res.roundReports.length) return;
    
    $('#interview-report').classList.remove('hidden');
    var html = '<div class="card"><h2>🏆 多轮面试综合报告</h2>';
    html += '<div style="text-align:center;margin:1rem 0;"><div style="font-size:2.5rem;font-weight:800;color:var(--accent);">' + (res.overallScore || '--') + '</div><div style="font-size:0.85rem;color:var(--muted);">综合评分 · 共' + res.completedRounds + '/' + res.totalRounds + '轮</div></div>';
    
    // 各维度平均分
    var dims = [
      { key: 'star_completeness', label: 'STAR完整性' },
      { key: 'quantification', label: '量化程度' },
      { key: 'position_match', label: '岗位匹配' },
      { key: 'structure', label: '表达结构' },
      { key: 'highlight', label: '亮点突出' }
    ];
    html += '<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:1rem;">';
    dims.forEach(function(d) {
      var v = (res.averageScores && res.averageScores[d.key]) || '--';
      html += '<div style="flex:1;min-width:80px;text-align:center;padding:0.5rem;background:var(--bg1);border-radius:6px;"><div style="font-size:1.2rem;font-weight:600;">' + v + '</div><div style="font-size:0.7rem;color:var(--muted);">' + d.label + '</div></div>';
    });
    html += '</div>';
    
    // 轮次对比
    if (res.roundReports.length > 0) {
      html += '<h3 style="margin-bottom:0.5rem;">轮次对比</h3>';
      html += '<div style="display:flex;gap:0.5rem;flex-wrap:wrap;">';
      res.roundReports.forEach(function(r) {
        html += '<div style="flex:1;min-width:120px;padding:0.5rem;background:var(--bg1);border-radius:6px;border-left:3px solid var(--accent);"><div style="font-size:0.78rem;font-weight:600;">' + (r.label || '第' + r.round + '轮') + '</div><div style="font-size:1.1rem;font-weight:700;color:var(--accent);">' + (r.score || '--') + '</div><div style="font-size:0.7rem;color:var(--muted);">' + (r.totalQuestions || 0) + '题</div></div>';
      });
      html += '</div>';
    }
    
    html += '<div style="margin-top:1rem;display:flex;gap:0.5rem;justify-content:flex-end;"><button onclick="resetInterviewUI()" class="btn-primary" style="font-size:0.78rem;">返回首页</button></div>';
    html += '</div>';
    $('#interview-report').innerHTML = html;
    
    state.multiRoundActive = false;
    state.interviewActive = false;
    setStatus('✅ 多轮面试完成');
  } catch (e) { toast('加载综合报告失败: ' + e.message); }
}

function resetInterviewUI(keepReport = false) {
  const chat = $('#interview-chat');
  chat.innerHTML = '';
  const inputArea = document.querySelector('.interview-input');
  if (inputArea) inputArea.style.display = 'none';
  if (!keepReport) {
    $('#interview-report').classList.add('hidden');
    $('#interview-report').innerHTML = '';
    $('#interview-report-actions').classList.add('hidden');
  }
  $('#interview-area').classList.add('hidden');
  $('#interview-empty').classList.remove('hidden');
  $('#btn-interview-start').disabled = false;
  $('#btn-interview-start').textContent = '开始模拟面试';
  state.multiRoundActive = false;
  var multiBadge = $('#multi-round-mode-badge');
  if (multiBadge) multiBadge.remove();
  $('#multi-round-bar').classList.add('hidden');
}

async function loadInterviewReport() {
  try {
    const result = await apiInterviewEvaluate();
    renderInterviewReport(result.report);
    setStatus('✅ 报告已生成');
  } catch (e) { toast('报告生成失败: ' + e.message); setStatus('❌ 报告失败'); }
}

function renderInterviewReport(report) {
  if (!report) return;
  const avg = report.average_scores || {};
  const perQ = report.per_question || [];

  let html = `
    <div class="card report-card">
      <h2>面试评估报告</h2>
      <div class="report-overall">
        <div class="big-score">${report.overall_score || '--'}</div>
        <div class="big-label">综合评分 · 共${report.total_questions || 0}题</div>
      </div>
      <!-- 雷达图 -->
      <div style="display:flex;justify-content:center;margin:1rem 0;">
        <div id="radar-chart" style="width:100%;max-width:480px;height:380px;"></div>
      </div>
      <div class="report-scores">
        ${['star_completeness','quantification','position_match','structure','highlight'].map(k => `
          <div class="report-score-item">
            <div class="s-num">${avg[k] || '--'}</div>
            <div class="s-label">${{star_completeness:'STAR完整性',quantification:'量化程度',position_match:'岗位匹配',structure:'表达结构',highlight:'亮点突出'}[k]}</div>
          </div>
        `).join('')}
      </div>
      ${perQ.map((q, i) => `
        <div class="card" style="background:var(--bg);">
          <h4>#${i+1} — 综合 ${q.overall_score || '--'}分</h4>
          ${(q.line_by_line || []).map(l => `
            <div class="feedback-line ${l.is_good ? 'good' : 'bad'}" style="font-size:0.82rem;">
              ${l.is_good ? '✅' : '⚠️'} "${l.quote}" — ${l.comment}
            </div>
          `).join('')}
        </div>
      `).join('')}
    </div>
  `;

  $('#interview-report').innerHTML = html;
  $('#interview-report').classList.remove('hidden');
  $('#interview-report').scrollIntoView({ behavior: 'smooth' });
  $('#interview-report-actions').classList.remove('hidden');

  // Save to interview history
  try {
    const history = JSON.parse(localStorage.getItem('interview_history') || '[]');
    history.unshift({
      date: new Date().toISOString(),
      score: report.overall_score || '--',
      questions: state._interviewState?.askedQuestions?.length || 0,
      position: state.analysis?.jd?.position || '未知岗位'
    });
    localStorage.setItem('interview_history', JSON.stringify(history.slice(0, 20)));
  } catch {}

  // 渲染雷达图
  setTimeout(() => renderInterviewRadarChart(avg), 200);
}

function renderInterviewRadarChart(avg) {
  const el = document.getElementById('radar-chart');
  if (!el || !window.echarts) return;
  const chart = echarts.init(el, null, { renderer: 'svg' });
  const labels = ['STAR完整性', '量化程度', '岗位匹配', '表达结构', '亮点突出'];
  const keys = ['star_completeness', 'quantification', 'position_match', 'structure', 'highlight'];
  const values = keys.map(k => avg[k] || 0);
  chart.setOption({
    animation: false,
    radar: {
      center: ['50%', '50%'],
      radius: '70%',
      indicator: labels.map(label => ({ name: label, max: 100 })),
      axisName: { color: '#71748A', fontSize: 11 },
      splitArea: { areaStyle: { color: ['rgba(79,70,229,0.02)', 'rgba(79,70,229,0.04)'] } }
    },
    series: [{
      type: 'radar',
      data: [{ value: values, name: '你的得分', areaStyle: { color: 'rgba(79,70,229,0.15)' } }],
      symbol: 'circle', symbolSize: 5,
      lineStyle: { color: '#4F46E5', width: 2 },
      itemStyle: { color: '#4F46E5' }
    }]
  });
  window.addEventListener('resize', () => chart.resize());
}

// 全真模拟面试 — 反问按钮事件
$('#btn-interview-counter')?.addEventListener('click', async function() {
  var btn = $('#btn-interview-counter');
  btn.disabled = true; btn.textContent = '⏳ 生成中...';
  try {
    var questions = state._interviewState?.askedQuestions || [];
    var lastQ = questions.length > 0 ? questions[questions.length - 1].question : '';
    var jd = state.analysis ? (state.analysis.jd || {}) : {};
    var jdSummary = jd.position ? (jd.company || '') + ' ' + jd.position + ' | ' + (jd.requirements || '') : '';
    var resp = await fetchRetry('/api/generate-counter-questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: lastQ || '整场面试',
        answer: '',
        jdSummary: jdSummary.slice(0, 400),
        resumeText: (state.resumeText || '').slice(0, 3000)
      })
    }).then(function(r) { return r.json(); });
    renderCounterQuestions('interview', resp);
  } catch(e) {
    toast('反问生成失败: ' + e.message);
  }
  btn.disabled = false; btn.textContent = '🔄 生成反问问题';
});

// ============================================================
// Tab 4: 简历优化
// ============================================================
$('#btn-optimize-resume').addEventListener('click', async () => {
  if (!state.sessionId) return toast('请先完成分析');
  const btn = $('#btn-optimize-resume');
  btn.disabled = true; btn.textContent = '优化中...';
  const emptyEl = $('#resume-opt-empty');
  emptyEl.classList.remove('hidden');
  emptyEl.innerHTML = '<div style="text-align:center;padding:2rem;">'
    + '<div class="spinner"></div>'
    + '<p style="margin-top:0.8rem;color:var(--muted);" id="opt-status-text">AI 正在分析简历并生成优化建议...</p>'
    + '<div id="opt-stream-preview" style="max-height:200px;overflow-y:auto;margin-top:0.8rem;text-align:left;font-size:0.82rem;color:var(--muted);background:var(--bg);border-radius:8px;padding:0.8rem;display:none;"></div>'
    + '</div>';

  const statusEl = document.getElementById('opt-status-text');
  const previewEl = document.getElementById('opt-stream-preview');

  const updateStatus = (msg) => { if (statusEl) statusEl.textContent = msg; };

  // 阶段指示器：显示当前优化阶段
  var phases = [
    '正在解析JD与简历的匹配度...',
    '正在分析硬技能要求...',
    '正在逐段优化工作经历...',
    '正在优化项目经验表述...',
    '正在生成自我评价建议...',
    '正在整理最终优化结果...'
  ];
  var phaseIdx = 0;
  var phaseTimer = setInterval(function() {
    if (statusEl && phaseIdx < phases.length) {
      statusEl.textContent = phases[phaseIdx];
      phaseIdx++;
    }
  }, 8000);

  // 超时保护：90秒后强制中断
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
    if (phaseTimer) clearInterval(phaseTimer);
    btn.disabled = false; btn.textContent = '重新生成';
    emptyEl.innerHTML = '<p style="text-align:center;color:var(--red);padding:2rem;">❌ AI 响应超时，请检查网络或 AI 供应商连接后重试</p>';
  }, 90000);

  try {
    const resp = await fetch(`${API}/optimize-resume-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: state.sessionId }),
      signal: controller.signal
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || 'HTTP ' + resp.status);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            switch (data.type) {
              case 'start':
              case 'progress':
                updateStatus(data.message);
                break;
              case 'stream':
                // Phase indicator: silently accumulate, no display jumping
                break;
              case 'done':
                result = data.result;
                break;
              case 'error':
                throw new Error(data.message);
            }
          } catch (e) {
            if (e.message && !e.message.startsWith('Unexpected')) throw e;
          }
        }
      }
    }

    clearTimeout(timeoutId);
    if (phaseTimer) clearInterval(phaseTimer);

    if (!result || (!result.optimizations?.length && !result.elevator_pitch && !result.raw)) {
      emptyEl.innerHTML = '<p style="text-align:center;color:#D97706;padding:2rem;">⚠️ AI 返回了空结果，请确认AI供应商连接正常后重试</p>';
      btn.disabled = false; btn.textContent = '重新生成';
      return;
    }
    renderResumeOptimization(result);
    setStatus('✅ 优化完成');
    showTabDot('tab-optimize');
  } catch (e) {
    clearTimeout(timeoutId);
    if (phaseTimer) clearInterval(phaseTimer);
    emptyEl.innerHTML = '<p style="text-align:center;color:var(--red);padding:2rem;">❌ 优化失败: ' + (e.message || '网络错误') + '</p>';
    toast('优化失败: ' + e.message);
  }
  finally {
    if (phaseTimer) clearInterval(phaseTimer);
    clearTimeout(timeoutId);
    btn.disabled = false; btn.textContent = '重新生成';
  }
});

function renderResumeOptimization(data) {
  $('#resume-opt-empty').classList.add('hidden');
  $('#resume-opt-area').classList.remove('hidden');

  // Elevator pitch + 自我介绍脚本
  if (data.elevator_pitch || data.self_intro_script) {
    const el = $('#resume-elevator');
    el.style.display = 'block';
    el.innerHTML = `
      <h3>🎤 一句话自我介绍</h3>
      <p style="font-size:1rem;font-weight:600;color:var(--accent);">${data.elevator_pitch || ''}</p>
      ${data.self_intro_script ? `
      <h3 style="margin-top:1rem;">📝 1分钟自我介绍脚本</h3>
      <p style="background:var(--tag-bg);padding:1rem;border-radius:8px;font-size:0.88rem;line-height:1.7;">${data.self_intro_script}</p>` : ''}
    `;
  }

  // 逐段优化建议
  const opts = data.optimizations || [];
  $('#resume-opt-list').innerHTML = opts.map((o, i) => `
    <div class="card opt-card">
      <h4>#${i + 1} 优化建议</h4>
      <div class="opt-row">
        <div class="opt-col">
          <div class="opt-label">原文</div>
          <div class="opt-text original" style="max-height:none;white-space:pre-wrap;word-break:break-word;">${o.original || ''}</div>
        </div>
        <div class="opt-arrow">→</div>
        <div class="opt-col">
          <div class="opt-label">优化后</div>
          <div class="opt-text improved" style="max-height:none;white-space:pre-wrap;word-break:break-word;line-height:1.8;">${o.suggestion || ''}</div>
        </div>
      </div>
      <div class="opt-reason">💡 ${o.reason || ''}</div>
    </div>
  `).join('');

  if (opts.length === 0) {
    $('#resume-opt-list').innerHTML = '<div class="card"><p style="color:var(--muted);">暂无优化建议返回，请尝试重新生成。</p></div>';
  }

  $('#resume-opt-area').scrollIntoView({ behavior: 'smooth' });
}

// ============================================================
// 📊 简历评分
// ============================================================

async function scoreResume() {
  const resumeText = $('#resume-input').value.trim() || state.resumeText || '';
  if (!resumeText) return toast('请先在分析页输入简历内容');
  const btn = $('#btn-score-resume');
  btn.disabled = true; btn.textContent = '⏳ 评分中...';
  try {
    const resp = await fetchRetry('/api/score-resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resumeText })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error);
    renderResumeScore(data);
  } catch (e) { toast('评分失败: ' + e.message); }
  finally { btn.disabled = false; btn.textContent = '🔄 重新评分'; }
}

function renderResumeScore(data) {
  const card = $('#resume-score-card');
  card.style.display = 'block';

  const scores = data.scores || {};
  const bars = [
    { key: 'format', label: '格式规范', color: '#4F46E5' },
    { key: 'completeness', label: '内容完整', color: '#10B981' },
    { key: 'quantification', label: '量化程度', color: '#F59E0B' },
    { key: 'star_structure', label: 'STAR结构', color: '#8B5CF6' },
    { key: 'position_alignment', label: '岗位对齐', color: '#EC4899' },
  ];

  $('#resume-score-detail').innerHTML = bars.map(b => {
    const v = scores[b.key] || 0;
    return '<div style="display:flex;align-items:center;gap:0.5rem;margin:0.4rem 0;">' +
      '<span style="width:80px;font-size:0.8rem;">' + b.label + '</span>' +
      '<div style="flex:1;height:10px;background:var(--bg2);border-radius:5px;overflow:hidden;">' +
      '<div style="height:100%;width:' + v + '%;background:' + b.color + ';border-radius:5px;transition:width 0.5s;"></div></div>' +
      '<span style="width:35px;font-size:0.8rem;text-align:right;">' + v + '</span></div>';
  }).join('');

  $('#resume-score-overall').innerHTML = '<strong>综合评分：' + data.overall_score + '分</strong>' +
    (data.suggestion ? '<p style="margin-top:0.3rem;color:var(--muted);font-size:0.82rem;">💡 ' + data.suggestion + '</p>' : '');
}

$('#btn-score-resume').addEventListener('click', scoreResume);

async function checkAndAutoScore() {
  const card = $('#resume-score-card');
  const resumeText = $('#resume-input').value.trim() || state.resumeText || '';
  if (!resumeText) {
    card.style.display = 'none';
    return;
  }
  // If card is already populated, don't re-score
  const detail = $('#resume-score-detail');
  if (detail.innerHTML.trim() && card.style.display !== 'none') return;
  card.style.display = 'block';
}

// ============================================================
// ============================================================
// 自我介绍生成
// ============================================================
function checkAndShowSelfIntroCard() {
  var card = document.getElementById('self-intro-card');
  if (!card) return;
  var resumeText = (document.getElementById('resume-input')?.value?.trim() || state.resumeText || '');
  if (resumeText.length > 20) {
    card.style.display = 'block';
  }
}

// 切换到简历页时检查
var _origSwitchTab = switchTab;
switchTab = function(tabName) {
  _origSwitchTab(tabName);
  if (tabName === 'resume') {
    setTimeout(checkAndShowSelfIntroCard, 200);
  }
};

// 生成自我介绍按钮
document.getElementById('btn-generate-self-intro')?.addEventListener('click', async function() {
  var btn = document.getElementById('btn-generate-self-intro');
  var resultEl = document.getElementById('self-intro-result');
  var saveBtn = document.getElementById('btn-save-self-intro');
  if (!btn || !resultEl) return;

  btn.disabled = true;
  btn.innerHTML = '<span class="ai-action-icon">⏳</span>AI正在生成自我介绍...';
  resultEl.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--muted);"><div class="spinner" style="margin:0 auto 0.5rem;"></div>正在分析简历并生成自我介绍...</div>';
  if (saveBtn) saveBtn.style.display = 'none';

  try {
    var jd = state.analysis ? (state.analysis.jd || {}) : {};
    var jdSummary = jd.position
      ? (jd.company || '') + ' ' + jd.position + ' | ' + (jd.requirements || jd.responsibilities || '')
      : (jd.requirements || jd.responsibilities || '');
    var resumeText = (document.getElementById('resume-input')?.value?.trim() || state.resumeText || '');
    var customPrompt = document.getElementById('self-intro-custom-prompt')?.value?.trim() || '';
    var styleEl = document.getElementById('self-intro-style');
    var durationEl = document.getElementById('self-intro-duration');
    var style = styleEl ? styleEl.value : '稳重专业型';
    var duration = durationEl ? durationEl.value : '1.5分钟';

    var result = await fetchRetry('/api/generate-self-intro', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jdSummary: jdSummary.slice(0, 400),
        resumeText: resumeText.slice(0, 4000),
        customPrompt: customPrompt.slice(0, 500),
        style: style,
        duration: duration
      })
    }).then(function(r) { return r.json(); });

    if (result.self_intro) {
      var highlights = result.highlights && result.highlights.length > 0
        ? '<div class="self-intro-highlights">' + result.highlights.map(function(h) { return '<span class="anchor-tag">' + h + '</span>'; }).join('') + '</div>'
        : '';
      var duration = result.duration_estimate ? '<span class="self-intro-duration">⏱ ' + result.duration_estimate + '</span>' : '';

      resultEl.innerHTML = '<div class="model-answer-card">' +
        '<div class="model-answer-header">🎙️ AI生成的自我介绍 ' + duration + ' <button class="btn-speak" data-text="' + result.self_intro.replace(/"/g, '&quot;').replace(/\n/g, ' ') + '" style="width:24px;height:24px;font-size:0.7rem;margin-left:0.4rem;vertical-align:middle;">🔊</button></div>' +
        '<div class="model-answer-body">' + result.self_intro.replace(/\n/g, '<br>') + '</div>' +
        (result.tips ? '<div class="model-answer-tips">💡 ' + result.tips + '</div>' : '') +
        highlights +
        '</div>';

      window._currentSelfIntro = result.self_intro;
      if (saveBtn) saveBtn.style.display = 'inline-flex';
      resultEl.scrollIntoView({ behavior: 'smooth' });
    } else {
      resultEl.innerHTML = '<p style="color:var(--red);padding:1rem;">生成失败：未获取到内容，请重试</p>';
    }
  } catch (e) {
    resultEl.innerHTML = '<p style="color:var(--red);padding:1rem;">生成失败: ' + e.message + '</p>';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="ai-action-icon">✨</span>重新生成';
  }
});

// 保存自我介绍到话术库
document.getElementById('btn-save-self-intro')?.addEventListener('click', async function() {
  var btn = document.getElementById('btn-save-self-intro');
  if (!btn || !window._currentSelfIntro) return toast('请先生成自我介绍');

  btn.disabled = true;
  btn.innerHTML = '<span class="ai-action-icon">⏳</span>保存中...';

  try {
    await fetchRetry('/api/phrases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: '面试自我介绍',
        answer: window._currentSelfIntro,
        tags: ['自我介绍', '简历'],
        type: '自我介绍',
        score: 0
      })
    });
    toast('✅ 自我介绍已保存到话术库');
    btn.innerHTML = '<span class="ai-action-icon">✅</span>已保存';
    setTimeout(function() {
      btn.innerHTML = '<span class="ai-action-icon">💾</span>保存';
      btn.disabled = false;
    }, 2000);
  } catch (e) {
    toast('保存失败: ' + e.message);
    btn.disabled = false;
    btn.innerHTML = '<span class="ai-action-icon">💾</span>保存';
  }
});

// ============================================================
// 设置面板
// ============================================================

// 打开/关闭设置
$('#btn-open-settings')?.addEventListener('click', async () => {
  $('#settings-modal').classList.remove('hidden');
  loadSettingsData();
  loadTemperatures();
  // 默认显示当前版本号（从 Electron 主进程获取或使用注入值）
  const showVersion = async () => {
    try {
      if (window.electronAPI?.getVersion) {
        const ver = await window.electronAPI.getVersion();
        $('#current-version').textContent = 'v' + ver;
      } else if (window.__ELECTRON_VERSION__) {
        $('#current-version').textContent = 'v' + window.__ELECTRON_VERSION__;
      }
    } catch { /* fallback */ }
  };
  showVersion();
  // 同时加载 opencli 环境状态
  try {
    const h = await fetchRetry('/api/health').then(r => r.json());
    renderEnvPanel(h);
  } catch {}
});

// Temperature 滑块
$('#settings-temperature').addEventListener('input', () => {
  $('#settings-temp-val').textContent = $('#settings-temperature').value;
});

async function loadTemperatures() {
  try {
    const data = await fetchRetry('/api/providers/temperatures').then(r => r.json());
    _settingsTemperatures = data.temperatures || {};
    applyStoredTemperatures();
  } catch {}
}
let _settingsTemperatures = {};

function applyStoredTemperatures() {
  // 设置 temperature 滑块到当前选中连接的存储值（如果有），否则 0.7
  const connId = _settingsSelectedConnectionId;
  const t = connId && _settingsTemperatures[connId] != null ? _settingsTemperatures[connId] : 0.7;
  $('#settings-temperature').value = t;
  $('#settings-temp-val').textContent = t;
}
let _settingsSelectedConnectionId = null;
$('#btn-close-settings').addEventListener('click', () => $('#settings-modal').classList.add('hidden'));
$('#settings-modal').addEventListener('click', (e) => {
  if (e.target === $('#settings-modal')) $('#settings-modal').classList.add('hidden');
});
const opencliSetupBtn = $('#btn-opencli-setup-settings');
if (opencliSetupBtn) opencliSetupBtn.onclick = () => startOpencliSetup();

async function loadSettingsData() {
  // 加载供应商预设
  try {
    const p = await fetchRetry('/api/providers/list').then(r => r.json());
    const sel = $('#settings-provider');
    sel.innerHTML = (p.providers || []).map(pr =>
      `<option value="${pr.id}" data-baseurl="${pr.baseUrl || ''}" data-model="${pr.defaultModel || ''}" data-protocol="${pr.protocol || 'openai-compatible'}">${pr.name} (${pr.id})</option>`
    ).join('');
    // 监听供应商切换，自动填 Base URL 和模型
    sel.addEventListener('change', () => {
      const opt = sel.selectedOptions[0];
      $('#settings-baseurl').value = opt.dataset.baseurl || '';
      const s = $('#settings-model-select');
      s.innerHTML = opt.dataset.model ? `<option value="${opt.dataset.model}">${opt.dataset.model}</option>` : '<option value="">需拉取</option>';
      $('#settings-name').placeholder = `如：我的${opt.textContent.trim()}`;
      // 隐藏手动输入模型框
      $('#settings-model-manual').style.display = 'none';
      _settingsLastApiKey = '';
    });
    sel.dispatchEvent(new Event('change'));

    // 监听API Key输入框：失去焦点时自动拉取模型
    const apikeyInput = $('#settings-apikey');
    apikeyInput.addEventListener('blur', () => autoFetchModelsOnKeyInput());
  } catch {}

  // 加载已保存的连接
  await refreshConnectionList();
}

let _settingsLastApiKey = '';

async function autoFetchModelsOnKeyInput() {
  const apiKey = $('#settings-apikey').value.trim();
  if (!apiKey || apiKey === _settingsLastApiKey) return;
  _settingsLastApiKey = apiKey;

  const sel = $('#settings-provider');
  const opt = sel.selectedOptions[0];
  const baseUrl = $('#settings-baseurl').value.trim() || opt.dataset.baseurl || '';
  const protocol = opt.dataset.protocol || 'openai-compatible';

  if (!baseUrl) return;

  const s = $('#settings-model-select');
  s.innerHTML = '<option value="">⏳ 正在拉取模型列表...</option>';
  s.disabled = true;

  try {
    const result = await fetchRetry('/api/providers/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiBaseUrl: baseUrl, apiKey, protocol, providerId: sel.value })
    }).then(r => r.json());

    if (result.models?.length) {
      s.innerHTML = result.models.map(m => `<option value="${m}">${m}</option>`).join('');
      $('#settings-model').value = result.models[0];
      toast(`✅ 发现 ${result.models.length} 个可用模型`);
    } else {
      s.innerHTML = '<option value="">⚠️ 未获取到模型，请手动输入</option>';
    }
  } catch(e) {
    s.innerHTML = '<option value="">❌ 拉取失败，请手动输入</option>';
    $('#settings-model-manual').style.display = 'block';
  } finally {
    s.disabled = false;
  }
}

async function refreshConnectionList() {
  try {
    const c = await fetchRetry('/api/providers/connections').then(r => r.json());
    const connections = c.connections || [];
    const activeId = c.activeConnectionId;

    // 状态栏
    if (activeId && connections.length > 0) {
      const active = connections.find(x => x.id === activeId);
      $('#settings-connections-status').innerHTML = active
        ? `<p><span class="conn-badge active">✅ 已连接</span> ${active.name} · ${active.providerId} · ${active.hasApiKey ? '已配置Key' : '⚠️ 未配置Key'}</p>`
        : '<p style="color:var(--muted);">未设置激活连接，将使用第一个可用连接</p>';
    } else {
      $('#settings-connections-status').innerHTML = '<p style="color:var(--muted);">⚠️ 尚未配置任何AI连接</p>';
    }

    // 连接列表
    if (connections.length === 0) {
      $('#settings-connections-list').innerHTML = '<p style="color:var(--muted);">暂无连接，请在下方添加</p>';
      return;
    }
    $('#settings-connections-list').innerHTML = connections.map(conn => {
      const t = _settingsTemperatures[conn.id] != null ? _settingsTemperatures[conn.id] : 0.7;
      return `
      <div class="conn-item">
        <div class="conn-info">
          <span class="conn-provider">${conn.name || conn.providerId}</span>
          <span class="conn-key">${conn.providerId} · ${conn.hasApiKey ? '🔑 已配置' : '⚠️ 无Key'} · 模型: ${conn.model || '未设置'} · 创意度: ${t}${conn.id === activeId ? ' · <strong style="color:var(--accent);">激活</strong>' : ''}</span>
          ${conn.models?.length ? `<span class="conn-key" style="display:block;margin-top:2px;">可用模型: ${conn.models.slice(0,10).join(', ')}${conn.models.length > 10 ? '...等' + conn.models.length + '个' : ''}</span>` : ''}
        </div>
        <div class="conn-actions">
          <button onclick="fetchModelsForConn('${conn.id}')" title="拉取模型列表">📡</button>
          ${conn.id !== activeId ? `<button onclick="activateConnection('${conn.id}')">激活</button>` : ''}
          <button onclick="editConnectionTemp('${conn.id}',${t})" title="调整创意度">🌡️</button>
          <button class="danger" onclick="deleteConnection('${conn.id}')">删除</button>
        </div>
      </div>
    `}).join('');
  } catch {}
}

window.activateConnection = async function(id) {
  try {
    await fetchRetry('/api/providers/connections/active', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    await refreshConnectionList();
    toast('✅ 已切换激活连接');
  } catch(e) { toast('切换失败'); }
};

// 为已保存的连接拉取模型列表
window.fetchModelsForConn = async function(connectionId) {
  toast('📡 正在拉取模型列表...');
  try {
    const result = await fetchRetry('/api/providers/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectionId })
    }).then(r => r.json());
    if (result.models?.length) {
      toast(`✅ 发现 ${result.models.length} 个模型`);
    } else {
      toast('⚠️ 未获取到模型列表');
    }
    await refreshConnectionList();
  } catch(e) { toast('拉取模型失败: ' + e.message); }
};

window.deleteConnection = async function(id) {
  if (!confirm('确定删除此连接？')) return;
  try {
    const resp = await fetchRetry(`/api/providers/connections/${id}`, { method: 'DELETE' });
    const result = await resp.json();
    if (!result.ok) throw new Error(result.error || '删除失败');
    toast('✅ 已删除');
    await refreshConnectionList();
    const c = await fetchRetry('/api/providers/connections').then(r => r.json());
    if (!c.activeConnectionId) setStatus('⚠️ 未配置AI — 点击 ⚙️ 设置');
  } catch(e) { toast('删除失败: ' + e.message); }
};

// 快速调整创意度
window.editConnectionTemp = async function(id, current) {
  const val = prompt('创意度 (0=精确, 1=平衡, 2=创意):', current);
  if (val == null) return;
  const t = Math.max(0, Math.min(2, parseFloat(val) || 0.7));
  try {
    await fetchRetry('/api/providers/temperature', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectionId: id, temperature: t })
    });
    _settingsTemperatures[id] = t;
    await refreshConnectionList();
    toast(`✅ 创意度已设为 ${t}`);
  } catch(e) { toast('调整失败: ' + e.message); }
};

// 添加/保存连接
$('#settings-add-connection').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const sel = $('#settings-provider');
    const opt = sel.selectedOptions[0];
    const result = await fetchRetry('/api/providers/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: $('#settings-name').value.trim(),
        providerId: sel.value,
        protocol: opt.dataset.protocol || 'openai-compatible',
        apiBaseUrl: $('#settings-baseurl').value.trim() || opt.dataset.baseurl || '',
        apiKey: $('#settings-apikey').value.trim(),
        model: $('#settings-model-select').value || $('#settings-model-manual').value.trim() || $('#settings-model').value.trim() || opt.dataset.model || '',
        setActive: $('#settings-set-active').checked
      })
    });
    if (!result.ok && result.error) throw new Error(result.error);
    toast('✅ 连接已保存');
    $('#settings-apikey').value = '';
    await refreshConnectionList();

    // 保存 temperature
    const savedId = result.activeConnectionId || (result.connections?.length && result.connections[result.connections.length - 1]?.id);
    if (savedId) {
      const t = parseFloat($('#settings-temperature').value) || 0.7;
      await fetchRetry('/api/providers/temperature', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: savedId, temperature: t })
      });
      _settingsTemperatures[savedId] = t;
    }

    // 自动拉取模型列表
    if (savedId) {
      toast('📡 正在自动拉取可用模型...');
      try {
        const modelsResp = await fetchRetry('/api/providers/models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionId: savedId })
        }).then(r => r.json());
        if (modelsResp.models?.length) {
          toast(`✅ 连接成功！发现 ${modelsResp.models.length} 个可用模型`);
          const models = modelsResp.models;
          const s = $('#settings-model-select');
          s.innerHTML = models.map(m => `<option value="${m}">${m}</option>`).join('');
          s.value = models[0];
          $('#settings-model').value = models[0];
          await refreshConnectionList();
        }
      } catch { /* 模型拉取失败不阻塞 */ }
    }

    setStatus('✅ 已连接');
  } catch(e) { toast('保存失败: ' + e.message); }
});

// 测试连接
$('#btn-test-connection').addEventListener('click', async () => {
  const sel = $('#settings-provider');
  const opt = sel.selectedOptions[0];
  const btn = $('#btn-test-connection');
  const res = $('#settings-test-result');
  btn.disabled = true; btn.textContent = '测试中...';
  res.classList.remove('hidden', 'ok', 'fail');
  res.textContent = '⏳ 正在测试...';

  try {
    const result = await fetchRetry('/api/providers/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerId: sel.value,
        apiBaseUrl: $('#settings-baseurl').value.trim() || opt.dataset.baseurl || '',
        apiKey: $('#settings-apikey').value.trim(),
        model: $('#settings-model-select').value || $('#settings-model').value.trim() || opt.dataset.model || '',
        protocol: opt.dataset.protocol || 'openai-compatible'
      })
    }).then(r => r.json());

    if (result.ok) {
      res.classList.add('ok');
      res.textContent = `✅ 连接成功！发现 ${result.models?.length || 0} 个模型`;
      // 自动填充模型下拉
      if (result.models?.length) {
        const s = $('#settings-model-select');
        s.innerHTML = result.models.map(m => `<option value="${m}">${m}</option>`).join('');
        s.value = result.models[0];
      }
    } else {
      res.classList.add('fail');
      res.textContent = `❌ 连接失败: ${result.message || '未知错误'}`;
    }
  } catch(err) {
    res.classList.add('fail');
    res.textContent = `❌ 网络错误: ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = '测试连接';
    res.classList.remove('hidden');
  }
});

// ============================================================
// 会话管理 — 岗位切换
// ============================================================
let _refreshingSessions = false;
async function refreshSessionList() {
  if (_refreshingSessions) return;
  _refreshingSessions = true;
  const sel = $('#nav-session-select');
  try {
    const data = await fetchRetry('/api/sessions').then(r => r.json());
    const list = data.sessions || [];
    sel.innerHTML = list.length ? list.map(s =>
      `<option value="${s.id}" ${s.isActive ? 'selected' : ''}>${s.label} · ${s.matchScore}分</option>`
    ).join('') : '<option value="">暂无面试</option>';
    if (!state.sessionId && list.length > 0) {
      await switchToSession(list[0].id);
    }
    if (!list.length) {
      // 所有会话被删除：清空界面
      state.sessionId = null;
      state.analysis = null;
      $('#nav-session-label').textContent = '当前岗位';
      $('#analysis-result').classList.add('hidden');
      $('#practice-area').classList.add('hidden');
      $('#practice-empty').classList.remove('hidden');
      $('#interview-area').classList.add('hidden');
      $('#interview-empty').classList.remove('hidden');
      $('#interview-chat').innerHTML = '';
      state.interviewActive = false;
    }
  } catch {} finally {
    _refreshingSessions = false;
  }
}
async function switchToSession(sessionId) {
  if (!sessionId) return;
  const data = await fetchRetry('/api/sessions/switch', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId })
  }).then(r => r.json());
  if (!data.ok) return toast('切换失败');
  state.sessionId = sessionId;
  state.jdText = data.jdText || '';
  state.resumeText = data.resumeText || '';
  state.resumeFileName = data.resumeFileName || '';
  state.resumeSourceType = data.resumeSourceType || '';
  state.analysis = { jd: data.jd, resume: data.resume, gap: data.gap,
    questions: data.questions, insights: data.insights, mianjing: data.mianjing, kb_supplement: data.kb_supplement };
  $('#nav-session-label').textContent = data.label || '当前岗位';
  // 恢复 textarea
  $('#jd-input').value = state.jdText;
  $('#resume-input').value = state.resumeText;
  renderAnalysisResult(state.analysis);
  // 刷新专项训练完成度
  renderDrillQuestions();
  toast(`已切换到: ${data.label}`);
  setStatus('✅ ' + (data.label || ''));
}

// 安全绑定：使用可选链防止元素未就绪时报错
$('#nav-session-select')?.addEventListener('change', async () => {
  if (_refreshingSessions) return;
  const id = $('#nav-session-select')?.value;
  if (id && id !== state.sessionId) await switchToSession(id);
});

// 删除当前会话
$('#btn-delete-session')?.addEventListener('click', async () => {
  const id = $('#nav-session-select')?.value;
  if (!id) return toast('没有可删除的会话');
  if (!confirm('确定删除此岗位的所有面试数据？不可恢复。')) return;
  try {
    await fetchRetry(`/api/sessions/${id}`, { method: 'DELETE' });
    state.sessionId = null;
    state.analysis = null;
    await refreshSessionList();
    $('#analysis-result')?.classList.add('hidden');
    $('#practice-area')?.classList.add('hidden');
    $('#practice-empty')?.classList.remove('hidden');
    $('#nav-session-label').textContent = '当前岗位';
    toast('已删除');
  } catch(e) { toast('删除失败: ' + e.message); }
});

// 弹出自定义输入模态框（替代prompt，兼容Electron和浏览器）
function showPromptModal(title, defaultValue, onConfirm, onCancel) {
  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
  var modal = document.createElement('div');
  modal.style.cssText = 'background:var(--bg);border-radius:12px;padding:1.5rem;max-width:400px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.2);';
  modal.innerHTML =
    '<h3 style="margin:0 0 1rem 0;font-size:1rem;">' + escapeHtml(title) + '</h3>' +
    '<input id="prompt-modal-input" type="text" value="' + escapeHtml(defaultValue || '') + '" placeholder="请输入..." style="width:100%;padding:0.5rem 0.7rem;border:1px solid var(--rule);border-radius:6px;background:var(--bg);font-size:0.9rem;box-sizing:border-box;margin-bottom:1rem;">' +
    '<div style="display:flex;gap:0.5rem;justify-content:flex-end;">' +
    '<button id="prompt-modal-cancel" class="btn-outline" style="font-size:0.85rem;">取消</button>' +
    '<button id="prompt-modal-confirm" class="btn-primary" style="font-size:0.85rem;">确认</button>' +
    '</div>';
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  var input = document.getElementById('prompt-modal-input');
  input.focus();
  input.select();

  function cleanup() {
    overlay.remove();
  }

  document.getElementById('prompt-modal-confirm').addEventListener('click', function() {
    var val = input.value;
    cleanup();
    if (onConfirm) onConfirm(val);
  });
  document.getElementById('prompt-modal-cancel').addEventListener('click', function() {
    cleanup();
    if (onCancel) onCancel();
  });
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      var val = input.value;
      cleanup();
      if (onConfirm) onConfirm(val);
    } else if (e.key === 'Escape') {
      cleanup();
      if (onCancel) onCancel();
    }
  });
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) { cleanup(); if (onCancel) onCancel(); }
  });
}

// 编辑岗位名称（仅改标签）- 仅用事件委托，避免重复绑定
var _editLabelBusy = false;
document.addEventListener('click', async (e) => {
  if (!e.target.closest('#btn-edit-session-label')) return;
  if (_editLabelBusy) return;
  _editLabelBusy = true;
  const id = $('#nav-session-select')?.value;
  if (!id) { toast('请先选择一个岗位'); _editLabelBusy = false; return; }
  const currentLabel = $('#nav-session-label')?.textContent || '当前岗位';
  showPromptModal('请输入新的岗位名称', currentLabel === '当前岗位' ? '' : currentLabel,
    async function(newLabel) {
      if (!newLabel || !newLabel.trim()) { _editLabelBusy = false; return; }
      try {
        await fetchRetry(`/api/sessions/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: newLabel.trim() })
        });
        if ($('#nav-session-label')) $('#nav-session-label').textContent = newLabel.trim();
        await refreshSessionList();
        toast('✅ 岗位名称已更新');
      } catch(e) { toast('更新失败: ' + e.message); }
      _editLabelBusy = false;
    },
    function() {
      _editLabelBusy = false;
    }
  );
});

// ============================================================
// Tab: 通用题库
// ============================================================
let _behavioralQuestions = null;
let _behavioralAnswers = {}; // { qId: { answer, key_points, tips } }
let _behavioralActiveId = null; // 当前选中的题目ID
let _behavioralFilterCategory = '';
let _behavioralUserAnswers = {}; // 用户输入的答题文本
let _behavioralEvalResults = {}; // 评估结果缓存

// 通用进度提示工具
function showAiProgress(containerId, steps) {
  var container = document.getElementById(containerId);
  if (!container) return null;
  container.innerHTML = '<div class="ai-progress-area">' +
    '<div class="ai-progress-spinner"></div>' +
    '<div class="ai-progress-text">' + steps[0] + '</div>' +
    '</div>' +
    '<div class="ai-progress-steps">' +
    steps.map(function(s, i) {
      return '<span class="ai-progress-step ' + (i === 0 ? 'active' : '') + '" data-idx="' + i + '">' + s + '</span>';
    }).join('') +
    '</div>';
  container.style.display = 'block';
  return {
    update: function(idx) {
      var stepsEl = container.querySelectorAll('.ai-progress-step');
      stepsEl.forEach(function(el, i) {
        el.classList.remove('active', 'done');
        if (i < idx) el.classList.add('done');
        else if (i === idx) el.classList.add('active');
      });
      var textEl = container.querySelector('.ai-progress-text');
      if (textEl && idx < steps.length) textEl.textContent = steps[idx];
    },
    done: function() {
      var stepsEl = container.querySelectorAll('.ai-progress-step');
      stepsEl.forEach(function(el) {
        el.classList.remove('active');
        el.classList.add('done');
      });
      var textEl = container.querySelector('.ai-progress-text');
      if (textEl) textEl.textContent = '✅ 完成';
      var spinner = container.querySelector('.ai-progress-spinner');
      if (spinner) spinner.style.display = 'none';
    },
    hide: function() {
      container.style.display = 'none';
      container.innerHTML = '';
    }
  };
}

async function loadBehavioralQuestions(filterCategory = '') {
  _behavioralFilterCategory = filterCategory;

  if (!state.analysis) {
    $('#behavioral-empty').style.display = 'block';
    $('#behavioral-area').style.display = 'none';
    return;
  }

  if (!_behavioralQuestions) {
    try {
      _behavioralQuestions = await fetch('/api/behavioral-questions').then(r => r.json());
    } catch(e) {
      $('#behavioral-empty').style.display = 'block';
      $('#behavioral-area').style.display = 'none';
      return;
    }
  }

  $('#behavioral-empty').style.display = 'none';
  $('#behavioral-area').style.display = 'block';

  // 分类筛选标签
  const categories = ['全部', ...new Set(_behavioralQuestions.map(q => q.category))];
  const filterEl = $('#behavioral-filters');
  filterEl.innerHTML = categories.map(c =>
    `<span class="q-filter${c === filterCategory || (c === '全部' && !filterCategory) ? ' active' : ''}" data-cat="${c}">${c}</span>`
  ).join('');
  filterEl.querySelectorAll('.q-filter').forEach(f => {
    f.addEventListener('click', () => loadBehavioralQuestions(f.dataset.cat === '全部' ? '' : f.dataset.cat));
  });

  renderBehavioralSidebar();
}

function renderBehavioralSidebar(searchText = '') {
  // 筛选
  let qs = _behavioralFilterCategory
    ? _behavioralQuestions.filter(q => q.category === _behavioralFilterCategory)
    : _behavioralQuestions;

  if (searchText) {
    const kw = searchText.toLowerCase();
    qs = qs.filter(q => q.question.toLowerCase().includes(kw) || q.category.toLowerCase().includes(kw));
  }

  $('#behavioral-search-count').textContent = `共 ${qs.length} 题`;

  // 按分类分组
  const groups = {};
  qs.forEach(q => {
    if (!groups[q.category]) groups[q.category] = [];
    groups[q.category].push(q);
  });

  const sidebarEl = $('#behavioral-sidebar');
  let html = '';

  // 统计
  var answeredCount = Object.keys(_behavioralAnswers).length;
  var totalCount = _behavioralQuestions.length;
  html += `<div style="display:flex;align-items:center;gap:0.5rem;padding:0.4rem 0.5rem;margin-bottom:0.5rem;background:var(--bg0);border-radius:6px;font-size:0.78rem;">
    <span style="color:var(--muted);">进度</span>
    <span style="font-weight:700;color:var(--accent);">${answeredCount}/${totalCount}</span>
    <div style="flex:1;height:4px;background:var(--bg2);border-radius:2px;overflow:hidden;">
      <div style="height:100%;background:var(--accent);border-radius:2px;width:${totalCount > 0 ? Math.round(answeredCount/totalCount*100) : 0}%;transition:width 0.3s;"></div>
    </div>
  </div>`;

  for (const [cat, items] of Object.entries(groups)) {
    var answeredInCat = items.filter(q => _behavioralAnswers[q.id]).length;
    var hasAnswer = answeredInCat > 0;
    html += `<details class="behavioral-cat-group" ${_behavioralFilterCategory || items.length <= 5 ? 'open' : ''}>
      <summary style="cursor:pointer;font-weight:600;font-size:0.82rem;padding:0.4rem 0.5rem;display:flex;align-items:center;gap:0.3rem;border-radius:6px;background:var(--bg0);margin-bottom:0.2rem;transition:background 0.15s;">
        <span>${cat}</span>
        <span style="font-size:0.7rem;color:var(--muted);margin-left:auto;">${answeredInCat}/${items.length}</span>
        ${hasAnswer ? `<span style="font-size:0.65rem;background:var(--accent);color:#fff;padding:1px 5px;border-radius:8px;margin-left:0.3rem;">已答</span>` : ''}
      </summary>`;

    for (const q of items) {
      const saved = _behavioralAnswers[q.id];
      const isActive = _behavioralActiveId === q.id;
      html += `<div class="behavioral-q-item${isActive ? ' active' : ''}" data-id="${q.id}"
        style="padding:0.5rem 0.6rem;margin:2px 0;border-radius:6px;cursor:pointer;font-size:0.82rem;line-height:1.4;
        ${isActive ? 'background:var(--accent-glow);border-left:3px solid var(--accent);' : 'background:var(--bg2);border-left:3px solid transparent;'}
        transition:all 0.15s;"
        title="${q.question}">
        <div style="display:flex;align-items:flex-start;gap:0.3rem;">
          <span style="color:var(--muted);font-size:0.68rem;flex-shrink:0;">${q.id.replace('gb','#')}</span>
          <span style="flex:1;">${q.question.length > 40 ? q.question.slice(0,40)+'...' : q.question}</span>
          ${saved ? '<span style="font-size:0.65rem;color:var(--accent);flex-shrink:0;">✅</span>' : ''}
        </div>
      </div>`;
    }

    html += '</details>';
  }

  sidebarEl.innerHTML = html;

  // 绑定点击事件
  sidebarEl.querySelectorAll('.behavioral-q-item').forEach(item => {
    item.addEventListener('click', () => {
      _behavioralActiveId = item.dataset.id;
      renderBehavioralSidebar(searchText);
      renderBehavioralDetail(item.dataset.id);
    });
  });
}

function renderBehavioralDetail(qId) {
  const q = _behavioralQuestions.find(x => x.id === qId);
  if (!q) return;

  const saved = _behavioralAnswers[qId];
  const detailEl = $('#behavioral-detail');
  const evalResult = _behavioralEvalResults[qId];

  // 格式化 answer 文本
  let answerHtml = '';
  if (saved?.answer) {
    answerHtml = formatBehavioralAnswer(saved.answer);
  }

  var evalResultHtml = '';
  if (evalResult) {
    evalResultHtml = renderBehavioralEvalResult(evalResult, qId);
  }

  detailEl.innerHTML = `
    <div class="card" style="border-left:4px solid var(--accent);">
      <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem;">
        <span class="q-type" style="font-size:0.7rem;padding:2px 7px;">${q.category}</span>
        <span style="font-size:0.72rem;color:var(--muted);">${q.id.replace('gb','#')}</span>
      </div>
      <div class="q-text" style="font-size:1.05rem;font-weight:600;line-height:1.6;margin-bottom:0.8rem;">${q.question}</div>

      <!-- 回答框架 -->
      <details style="margin-bottom:0.8rem;font-size:0.82rem;">
        <summary style="cursor:pointer;font-weight:600;color:var(--accent);">📋 回答框架 & 危险区</summary>
        <div style="margin-top:0.4rem;padding:0.5rem;background:var(--bg0);border-radius:6px;line-height:1.6;">
          <div style="margin-bottom:0.4rem;"><strong>框架：</strong>${q.framework || '无'}</div>
          <div style="color:var(--red);"><strong>⚠️ 危险区：</strong>${q.danger_zones || '无'}</div>
        </div>
      </details>

      <!-- 已生成答案 -->
      ${answerHtml ? `
      <div class="behavioral-answer-box" style="background:var(--bg0);padding:0.8rem;border-radius:8px;margin-bottom:0.6rem;">
        <div style="font-weight:600;font-size:0.82rem;color:var(--accent);margin-bottom:0.5rem;">✨ 标准化回答</div>
        <div class="behavioral-answer-content" style="font-size:0.88rem;line-height:1.8;color:var(--fg);">
          ${answerHtml}
        </div>
        ${saved.key_points?.length ? `
        <div style="margin-top:0.6rem;display:flex;flex-wrap:wrap;gap:0.3rem;">
          ${saved.key_points.map(kp => `<span style="font-size:0.72rem;background:var(--accent-glow);color:var(--accent);padding:2px 8px;border-radius:10px;">${kp}</span>`).join('')}
        </div>` : ''}
        <div style="display:flex;gap:0.5rem;margin-top:0.6rem;flex-wrap:wrap;align-items:center;">
          <span style="font-size:0.75rem;color:var(--accent);">⏱ ${saved.duration_estimate || ''}</span>
          ${saved.tips ? `<span style="font-size:0.75rem;color:var(--muted);">💡 ${saved.tips}</span>` : ''}
        </div>
      </div>` : ''}

    </div>

    <!-- ===== 答题区 ===== -->
    <div class="behavioral-answer-section">
      <h3>✍️ 练习回答</h3>
      <textarea class="behavioral-answer-input" id="behavioral-answer-input" rows="6" placeholder="写下你的回答，然后点击提交获取AI评估...">${_behavioralUserAnswers[qId] || ''}</textarea>
      <div class="behavioral-answer-actions">
        <button class="btn-primary" id="btn-behavioral-submit" style="font-size:0.82rem;padding:0.4rem 1rem;">✅ 提交回答</button>
        <button class="btn-ai-action btn-ai-model" id="btn-model-answer-behavioral" title="AI基于你的简历生成标准答案参考"><span class="ai-action-icon">✨</span>AI标准答案</button>
        <label class="switch-label" style="font-size:0.78rem;">
          <input type="checkbox" id="chk-behavioral-save" checked> 纳入练习记录
        </label>
      </div>
      <!-- 标准答案显示区域 -->
      <div id="behavioral-model-answer-area"></div>
      <!-- 进度指示器 -->
      <div id="behavioral-eval-progress" style="display:none;"></div>
      <!-- 评估结果 -->
      <div id="behavioral-eval-result" class="behavioral-eval-result">${evalResultHtml}</div>
    </div>
  `;

  // 保存用户输入内容
  var inputTa = $('#behavioral-answer-input');
  if (inputTa) {
    inputTa.addEventListener('input', function() {
      _behavioralUserAnswers[qId] = this.value;
    });
  }

  // 绑定AI标准答案按钮（点击题目后立即可见，无需先提交评估）
  var modelAnswerArea = document.getElementById('behavioral-model-answer-area');
  if (modelAnswerArea) {
    loadModelAnswerHandler('behavioral', q.question, modelAnswerArea);
  }

  // 绑定生成答案按钮事件
  const genBtn = detailEl.querySelector('.btn-gen-behavioral');
  if (genBtn) {
    genBtn.addEventListener('click', async () => {
      genBtn.disabled = true; genBtn.textContent = '⏳ 生成中...';
      try {
        const jd = state.analysis?.jd || {};
        const jdSummary = jd.position ? `${jd.company||''} ${jd.position} | ${jd.requirements||''}`.slice(0,400) : '';
        const resp = await fetch('/api/generate-behavioral-answer', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: q.question, framework: q.framework, danger_zones: q.danger_zones,
            jdSummary, resumeText: state.resumeText || ''
          })
        });
        const data = await resp.json();
        if (data.error) throw new Error(data.error);
        _behavioralAnswers[qId] = data;
        renderBehavioralDetail(qId);
        renderBehavioralSidebar($('#behavioral-search')?.value || '');
      } catch(e) {
        toast('生成失败: ' + e.message);
        genBtn.disabled = false; genBtn.textContent = '✨ AI 生成标准答案';
      }
    });
  }

  const copyBtn = detailEl.querySelector('.btn-copy-behavioral');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const s = _behavioralAnswers[qId];
      if (!s?.answer) return;
      try {
        await navigator.clipboard.writeText(s.answer);
        copyBtn.textContent = '✅ 已复制';
        setTimeout(() => { copyBtn.textContent = '📋 复制'; }, 1500);
      } catch(e) {
        toast('复制失败');
      }
    });
  }

  // 绑定提交回答按钮事件
  var submitBtn = $('#btn-behavioral-submit');
  if (submitBtn) {
    submitBtn.addEventListener('click', async function() {
      var answer = _behavioralUserAnswers[qId] || '';
      if (!answer || answer.length < 5) {
        toast('请先写下你的回答（至少5个字）');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ 评估中...';

      // 显示进度
      var progress = showAiProgress('behavioral-eval-progress', [
        '正在分析你的回答...',
        '正在逐句评估...',
        '正在生成改进建议...',
        '评估完成'
      ]);

      var jd = state.analysis?.jd || {};
      var jdSummary = jd.position ? (jd.company || '') + ' ' + jd.position : '';
      var resumeText = state.resumeText || '';

      try {
        // 步骤1: 准备数据
        progress.update(0);
        await new Promise(function(r) { setTimeout(r, 300); });

        // 步骤2: 调用评估API
        progress.update(1);
        var result = await fetchRetry('/api/evaluate-single', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: q.question,
            answer: answer,
            jdSummary: jdSummary.slice(0, 400),
            resumeText: resumeText.slice(0, 3000)
          })
        }).then(function(r) { return r.json(); });

        if (result.error) throw new Error(result.error);

        // 步骤3: 生成改进建议
        progress.update(2);
        await new Promise(function(r) { setTimeout(r, 200); });

        // 保存评估结果
        _behavioralEvalResults[qId] = result;
        progress.done();

        // 更新侧边栏显示已答状态
        renderBehavioralSidebar($('#behavioral-search')?.value || '');

        // 显示评估结果
         var evalEl = $('#behavioral-eval-result');
         evalEl.innerHTML = renderBehavioralEvalResult(result, qId);

         // 绑定后续操作按钮
         setTimeout(function() {
           bindBehavioralFollowUp(qId, q.question, answer);
         }, 50);

         // 保存练习记录
        var saveHistory = $('#chk-behavioral-save')?.checked !== false;
        if (saveHistory) {
          try {
            await autoSavePracticeRecord(q.question, answer, result);
          } catch(e) { /* 静默失败 */ }
        }

        // 隐藏进度
        setTimeout(function() { progress.hide(); }, 1500);
        setStatus('✅ 评估完成');
        showTabDot('behavioral');
      } catch(e) {
        toast('评估失败: ' + e.message);
        progress.hide();
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '✅ 重新提交';
      }
    });
  }
}

// 渲染通用题库评估结果
function renderBehavioralEvalResult(data, qId) {
  var scores = data.scores || {};
  var lines = data.line_by_line || [];
  var html = '<div class="card feedback-card" style="margin-top:0;">';
  html += '<h3 style="font-size:1rem;">评估结果 — 综合 ' + (data.overall_score || '--') + '分</h3>';
  html += '<div class="feedback-scores">';
  ['star_completeness','quantification','position_match','structure','highlight'].forEach(function(k) {
    var labels = {star_completeness:'STAR完整性',quantification:'量化程度',position_match:'岗位匹配',structure:'表达结构',highlight:'亮点突出'};
    html += '<div class="feedback-score"><div class="num">' + (scores[k] || '--') + '</div><div class="label">' + labels[k] + '</div></div>';
  });
  html += '</div>';
  html += '<div class="feedback-lines">';
  lines.forEach(function(l) {
    html += '<div class="feedback-line ' + (l.is_good ? 'good' : 'bad') + '">' +
      (l.is_good ? '✅' : '⚠️') + ' "' + (l.quote || '') + '" — ' + (l.comment || '') + '</div>';
  });
  html += '</div>';
  if (data.improved_version) {
    html += '<div class="feedback-improved"><strong>改进版参考：</strong><br>' + data.improved_version + '</div>';
  }
  if (data.key_takeaways) {
    html += '<div style="font-size:0.82rem;color:var(--muted);margin-top:0.5rem;"><strong>关键改进点：</strong>' + (data.key_takeaways.join ? data.key_takeaways.join('；') : data.key_takeaways) + '</div>';
  }
  html += '</div>';

  // 后续操作按钮（反问按钮，标准答案按钮已在答题区上方常驻显示）
  html += '<div class="follow-up-section" id="behavioral-followup-' + qId + '">';
  html += '<div class="ai-action-row">';
  html += '<button class="btn-ai-action btn-ai-counter" id="btn-behavioral-counter" title="AI生成你可以反问面试官的问题"><span class="ai-action-icon">🔄</span>生成反问</button>';
  html += '</div></div>';

  return html;
}

// 在通用题库评估结果渲染后绑定后续按钮事件
function bindBehavioralFollowUp(qId, question, answer) {
  var section = document.getElementById('behavioral-followup-' + qId);
  if (!section) return;
  // 反问按钮（标准答案按钮已在答题区上方常驻显示）
  var counterBtn = document.getElementById('btn-behavioral-counter');
  if (counterBtn) {
    counterBtn.addEventListener('click', async function() {
      counterBtn.disabled = true;
      counterBtn.innerHTML = '<span class="ai-action-icon">⏳</span>生成中...';
      try {
        var jd = state.analysis ? (state.analysis.jd || {}) : {};
        var jdSummary = jd.position ? (jd.company || '') + ' ' + jd.position : '';
        var result = await fetchRetry('/api/generate-counter-questions', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: question,
            answer: answer,
            jdSummary: jdSummary,
            resumeText: (state.resumeText || '').slice(0, 2000),
            fullExperiences: state._fullExperiences || []
          })
        }).then(function(r) { return r.json(); });
        if (result.counter_questions) {
          var html = '<div class="model-answer-card" style="margin-top:0.5rem;">' +
            '<div class="model-answer-header">🔄 你可以反问面试官的问题</div>' +
            '<div class="model-answer-body">' + result.counter_questions.replace(/\n/g, '<br>') + '</div></div>';
          section.insertAdjacentHTML('afterend', html);
        } else {
          toast('生成失败');
        }
      } catch(e) {
        toast('反问生成失败: ' + e.message);
      } finally {
        counterBtn.disabled = false;
        counterBtn.innerHTML = '<span class="ai-action-icon">🔄</span>生成反问';
      }
    });
  }
}

// 格式化通用题库答案：Markdown 风格 → 高质量 HTML
function formatBehavioralAnswer(text) {
  if (!text) return '';
  var t = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // 按段落分割
  var paragraphs = t.split(/\n\n+/);
  var result = '';

  for (var i = 0; i < paragraphs.length; i++) {
    var p = paragraphs[i].trim();
    if (!p) continue;

    // 处理标题 (### 开头)
    if (/^#{1,3}\s/.test(p)) {
      var level = p.match(/^(#{1,3})\s/)[1].length;
      var titleText = p.replace(/^#{1,3}\s+/, '');
      var fontSize = level === 1 ? '1.05rem' : level === 2 ? '0.95rem' : '0.88rem';
      result += '<h4 style="font-size:' + fontSize + ';font-weight:700;color:var(--accent);margin:0.8rem 0 0.4rem 0;line-height:1.4;">' + titleText + '</h4>';
      continue;
    }

    // 处理有序列表
    if (/^\d+[\.\、]\s/.test(p)) {
      var items = p.split(/\n/).filter(function(l) { return /^\d+[\.\、]\s/.test(l.trim()); });
      if (items.length > 0) {
        result += '<ol style="margin:0.3rem 0;padding-left:1.5rem;line-height:1.8;">';
        for (var j = 0; j < items.length; j++) {
          var itemText = items[j].replace(/^\d+[\.\、]\s*/, '');
          result += '<li style="margin-bottom:0.2rem;">' + itemText + '</li>';
        }
        result += '</ol>';
        continue;
      }
    }

    // 处理无序列表
    if (/^[-•\*]\s/.test(p)) {
      var bulletItems = p.split(/\n/).filter(function(l) { return /^[-•\*]\s/.test(l.trim()); });
      if (bulletItems.length > 0) {
        result += '<ul style="margin:0.3rem 0;padding-left:1.5rem;line-height:1.8;">';
        for (var k = 0; k < bulletItems.length; k++) {
          var bulletText = bulletItems[k].replace(/^[-•\*]\s*/, '');
          result += '<li style="margin-bottom:0.2rem;">' + bulletText + '</li>';
        }
        result += '</ul>';
        continue;
      }
    }

    // 普通段落
    // 处理加粗
    p = p.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // 处理单行换行
    p = p.replace(/\n/g, '<br>');
    result += '<p style="margin:0.4rem 0;line-height:1.8;">' + p + '</p>';
  }

  return result || '<p style="margin:0.4rem 0;">' + t + '</p>';
}

// 搜索事件
document.addEventListener('DOMContentLoaded', () => {
  const searchInput = $('#behavioral-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      renderBehavioralSidebar(searchInput.value.trim());
    });
  }
});

// ============================================================
// 📡 面经采集
// ============================================================
$('#btn-mj-search').addEventListener('click', async () => {
  let company = $('#mj-company-input').value.trim();
  let position = $('#mj-position-input').value.trim();
  if ((!company || !position) && state.analysis?.jd) {
    company = company || state.analysis.jd.company || '';
    position = position || state.analysis.jd.position || '';
    $('#mj-company-input').value = company;
    $('#mj-position-input').value = position;
  }
  if (!company && !position) return toast('请输入公司名或岗位，或先完成分析');

  const pw = $('#mj-progress-wrap'); const pd = $('#mj-progress-detail');
  pw.style.display = 'block'; pd.innerHTML = '';
  const btn = $('#btn-mj-search'); btn.disabled = true; btn.textContent = '⏳ 采集中...';

  try {
    const manualUrls = ($('#mj-manual-urls').value || '').trim().split(/[\n\r]+/).map(u => u.trim()).filter(Boolean);
    const resp = await fetch('/api/mianjing-collect', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: state.sessionId, company, position, manualUrls })
    });
    const reader = resp.body.getReader(); const decoder = new TextDecoder();
    let buffer = '', result = null;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n'); buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const ev = JSON.parse(line.slice(6));
          pd.innerHTML += '🟢 ' + (ev.detail || '') + '<br>';
          pd.parentElement.scrollTop = pd.parentElement.scrollHeight;
          if (ev.step === 'done') result = ev.result;
          if (ev.step === 'error') throw new Error(ev.detail);
        } catch {}
      }
    }
    if (result?.mianjing?.questions?.length) {
      window._mjQuestions = result.mianjing.questions;
      renderMianjingResults(result.mianjing);
      toast(`采集完成: ${result.mianjing.questions.length} 题`);
      showTabDot('mianjing');
    } else { renderMianjingResults({ questions: [], sources: [] }); toast('未采集到面经题目'); }
  } catch (e) { pd.innerHTML += '<br>❌ 采集失败: ' + (e.message || '未知'); toast('采集失败'); }
  finally { btn.disabled = false; btn.textContent = '🔍 开始采集'; }
});

function renderMianjingResults(mData) {
  $('#mj-result').style.display = 'block';
  const qs = mData.questions || [];
  $('#mj-q-count').textContent = qs.length;
  $('#mj-question-list').innerHTML = qs.map((q, i) => `
    <div class="card" style="padding:0.8rem;margin-bottom:0.5rem;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem;">
        <div style="flex:1;">
          <span style="font-size:0.75rem;color:var(--accent);background:var(--tag-bg);padding:1px 6px;border-radius:3px;">${q.type || '未知'}</span>
          <span style="margin-left:0.5rem;font-size:0.85rem;">${i+1}. ${q.question || ''}</span>
          ${q.sample_answer_points?.length ? '<div style="font-size:0.75rem;color:var(--muted);margin-top:0.3rem;">💡 ' + q.sample_answer_points.join(' / ') + '</div>' : ''}
        </div>
        <div style="display:flex;gap:0.3rem;flex-shrink:0;">
          <button class="btn-outline mj-add-practice" data-idx="${i}" style="font-size:0.7rem;padding:0.15rem 0.4rem;">➕练习</button>
          <button class="btn-outline mj-add-bank" data-idx="${i}" style="font-size:0.7rem;padding:0.15rem 0.4rem;">📚入库</button>
        </div>
      </div>
    </div>
  `).join('');
  document.querySelectorAll('.mj-add-practice').forEach(b => b.addEventListener('click', () => {
    const q = window._mjQuestions?.[parseInt(b.dataset.idx)]; if (q) addMjToPractice(q);
  }));
  document.querySelectorAll('.mj-add-bank').forEach(b => b.addEventListener('click', () => {
    const q = window._mjQuestions?.[parseInt(b.dataset.idx)]; if (q) addMjToBank(q);
  }));
  updateMjButtonStates();

  // Add sync button
  const resultDiv = $('#mj-result');
  if (resultDiv && !document.getElementById('btn-mj-sync-questions')) {
    const syncBtn = document.createElement('button');
    syncBtn.id = 'btn-mj-sync-questions';
    syncBtn.className = 'btn-outline';
    syncBtn.style.cssText = 'font-size:0.78rem;margin-top:0.5rem;';
    syncBtn.textContent = '📋 同步到押题清单';
    syncBtn.addEventListener('click', () => {
      if (!state.analysis) state.analysis = { questions:[], mianjing:[], kb_supplement:[], jd:{}, resume:{} };
      const mj = window._mjQuestions || [];
      const existing = new Set((state.analysis.questions || []).map(q => q.question));
      mj.forEach(q => {
        if (!existing.has(q.question)) {
          state.analysis.questions.push({ ...q, _source: '📡面经' });
          existing.add(q.question);
        }
      });
      toast(`已同步 ${mj.length} 道题到押题清单`);
      switchTab('analyze');
    });
    const card = resultDiv.querySelector('.card');
    if (card) card.appendChild(syncBtn);
  }
}

function addMjToPractice(q) {
  if (!state.analysis) state.analysis = { questions:[],mianjing:[],kb_supplement:[],jd:{},resume:{} };
  state.analysis.mianjing = state.analysis.mianjing || [];
  if (state.analysis.mianjing.find(mq => mq.question === q.question)) return toast('已在练习列表中');
  state.analysis.mianjing.push({ 
    question: q.question||'', type: q.type||'面经', tags: q.tags||[],
    _source: '📡面经',
    sample_answer_points: q.sample_answer_points || [],
    examiner_intent: q.examiner_intent || '',
    tips: q.tips || []
  });
  toast('已加入练习'); updateMjButtonStates();
  if (document.getElementById('tab-practice').classList.contains('active')) renderPracticeQuestions();
}

$('#btn-mj-add-all-practice').addEventListener('click', () => {
  if (!window._mjQuestions?.length) return toast('无题目');
  window._mjQuestions.forEach(q => addMjToPractice(q));
});

function updateMjButtonStates() {
  document.querySelectorAll('.mj-add-practice').forEach(b => {
    const q = window._mjQuestions?.[parseInt(b.dataset.idx)];
    if (q && (state.analysis?.mianjing||[]).find(mq => mq.question===q.question)) { b.textContent='✅'; b.disabled=true; b.style.opacity='0.5'; }
  });
}

function autoFillMianjingFields() {
  if (state.analysis?.jd) {
    if (!$('#mj-company-input').value) $('#mj-company-input').value = state.analysis.jd.company||'';
    if (!$('#mj-position-input').value) $('#mj-position-input').value = state.analysis.jd.position||'';
  }
}

// ============================================================
// 公司调研 — 面试导向 · 进度条 + 知识图谱
// ============================================================

// 公司调研历史记录
async function saveCompanyResearchHistory(company, position, result) {
  try {
    const resp = await fetchRetry('/api/company-research/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company, position, result })
    });
    const data = await resp.json();
    if (data.ok) renderCompanyResearchHistory();
  } catch { /* 静默失败 */ }
}

async function loadCompanyResearchHistory() {
  try {
    const resp = await fetchRetry('/api/company-research/history');
    const data = await resp.json();
    return data.history || [];
  } catch { return []; }
}

async function renderCompanyResearchHistory() {
  const el = document.getElementById('company-history-list');
  if (!el) return;
  const history = await loadCompanyResearchHistory();
  if (!history.length) {
    el.innerHTML = '<p style="color:var(--muted);font-size:0.82rem;">暂无调研记录</p>';
    return;
  }
  el.innerHTML = history.slice(0, 20).map((h, i) => {
    const d = h.createdAt ? new Date(h.createdAt).toLocaleDateString('zh-CN') + ' ' + new Date(h.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';
    return `<div class="company-history-item" data-idx="${i}" style="padding:0.4rem 0.6rem;margin:4px 0;background:var(--tag-bg);border-radius:4px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;font-size:0.82rem;" title="点击查看详情">
      <span>🏢 ${h.company || ''}${h.position ? ' · ' + h.position : ''}</span>
      <span style="color:var(--muted);font-size:0.72rem;">${d}</span>
    </div>`;
  }).join('');

  // 点击历史记录查看详情
  el.querySelectorAll('.company-history-item').forEach(item => {
    item.addEventListener('click', async () => {
      const idx = parseInt(item.dataset.idx);
      const h = history[idx];
      if (h && h.result) {
        renderCompany一键上岸(h.result, h.company);
        // 滚动到结果区域
        const resultEl = document.getElementById('company-result');
        if (resultEl) resultEl.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });
}
async function doCompanyResearch() {
  const company = $('#company-search-input')?.value?.trim();
  if (!company) return toast('请输入公司名');
  const position = $('#company-position-input')?.value?.trim() || '';
  const btn = $('#btn-company-research');
  const pw = $('#company-progress-wrap');
  const ps = $('#company-progress-steps');
  const pd = $('#company-progress-detail');
  const re = $('#company-result');

  re.innerHTML = '';
  btn.disabled = true; btn.textContent = '⏳ 调研中...';
  pw.style.display = 'block';

  // 进度步骤
  const STEPS = ['search', 'llm', 'done'];
  const LABELS = { search: '多维搜索', llm: '面试图谱', done: '完成' };
  ps.innerHTML = STEPS.map(s => `<span class="pstep" id="cr-step-${s}">${LABELS[s]}</span>`).join('');
  pd.textContent = '🔍 启动调研...';

  const t0 = Date.now();
  const totalSteps = STEPS.length;
  let completed = 0;
  function eta() {
    const elapsed = (Date.now() - t0) / 1000;
    const avg = completed > 0 ? elapsed / completed : 10;
    return Math.ceil(avg * (totalSteps - completed));
  }

  try {
    const resp = await fetch('/api/company-research', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company, position })
    });
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.error) throw new Error(data.error);
            if (data._done) { result = data; continue; }

            if (data.step === 'search') {
              // 更新搜索子步骤状态
              const el = document.getElementById('cr-step-search');
              if (el && !el.classList.contains('done')) {
                if (data.status === 'ok') {
                  // 不立即标完成，等全部搜索结束再标
                } else {
                  el.classList.add('active');
                }
              }
              pd.textContent = `🔍 ${data.label}: ${data.detail}  ⏱ 预计剩余 ${eta()}s`;
            }
            if (data.step === 'llm') {
              const el = document.getElementById('cr-step-search');
              if (el) { el.classList.add('done'); el.classList.remove('active'); }
              const el2 = document.getElementById('cr-step-llm');
              if (el2) {
                el2.classList.add(data.status === 'ok' ? 'done' : 'active');
              }
              completed = 1;
              pd.textContent = `🧠 ${data.detail}  ⏱ 预计剩余 ${eta()}s`;
            }
          } catch {}
        }
      }
    }

    if (result) {
      const el2 = document.getElementById('cr-step-llm');
      if (el2) { el2.classList.add('done'); el2.classList.remove('active'); }
      const el3 = document.getElementById('cr-step-done');
      if (el3) el3.classList.add('done');
      pd.textContent = '✅ 调研完成';

      renderCompany一键上岸(result, company);
      // 自动保存到调研历史
      saveCompanyResearchHistory(company, position, result);
    }
  } catch (e) {
    pd.textContent = '❌ ' + e.message;
    toast('公司调研失败: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = '🔍 调研';
    setTimeout(() => { pw.style.display = 'none'; }, 3000);
  }
}

function renderCompany一键上岸(data, company) {
  const el = $('#company-result');
  if (!data || data.error) {
    el.innerHTML = `<div class="empty-state"><p>${data?.error || '暂无数据'}</p></div>`;
    return;
  }

  const html = [];
  html.push(`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
    <h3 style="margin:0;">🎯 「${company}」面试备战手册</h3>
    <button class="btn-outline btn-close-company-result" style="font-size:0.72rem;padding:0.2rem 0.6rem;color:var(--muted);" title="关闭调研结果">✕ 收起</button>
  </div>`);

  // ———— 顶部摘要卡 ————
  if (data._summary) {
    html.push(`<div class="ci-summary-box">${data._summary.replace(/\n/g, '<br>')}</div>`);
  }

  // ———— 核心：面试话术 ————
  if (data.interview_talking_points) {
    const tp = data.interview_talking_points;
    html.push(`<div class="ci-section highlight">
      <div class="ci-section-title">💬 面试话术 — 你的回答框架</div>
      <div class="ci-section-body">
        ${tp.why_join?.length ? `<div class="ci-line"><b>💼 「为什么想加入我们？」</b><br>${tp.why_join.map(p => `• ${p}`).join('<br>')}</div>` : ''}
        ${tp.what_know?.length ? `<div class="ci-line" style="margin-top:0.6rem;"><b>📋 「你对我们了解多少？」</b><br>${tp.what_know.map(p => `• ${p}`).join('<br>')}</div>` : ''}
        ${tp.my_value?.length ? `<div class="ci-line" style="margin-top:0.6rem;"><b>🔧 「你能带来什么？」</b><br>${tp.my_value.map(p => `• ${p}`).join('<br>')}</div>` : ''}
      </div>
    </div>`);
  }

  // ———— 模拟 Q&A ————
  if (data.mock_qa?.length) {
    const qas = data.mock_qa.map(qa => `
      <div class="ci-line" style="margin-bottom:0.6rem;padding:0.4rem 0.6rem;background:var(--bg2);border-radius:4px;">
        <b>❓ ${qa.q}</b><br>
        <span style="color:var(--accent);font-size:0.8rem;">💡 ${qa.a_tips}</span>
      </div>
    `).join('');
    html.push(`<div class="ci-section">
      <div class="ci-section-title">🎯 面试官可能这样问你</div>
      <div class="ci-section-body">${qas}</div>
    </div>`);
  }

  // ———— 公司速览 ————
  if (data.company_basics) {
    const b = data.company_basics;
    const meta = [];
    if (b.one_liner) meta.push(`<div class="ci-summary">${b.one_liner}</div>`);
    const tags = [];
    if (b.founded) tags.push(`📅 ${b.founded}`);
    if (b.headquarters) tags.push(`📍 ${b.headquarters}`);
    if (b.scale) tags.push(`👥 ${b.scale}`);
    if (b.industry) tags.push(`🏭 ${b.industry}`);
    if (tags.length) meta.push(`<div class="ci-meta">${tags.map(t => `<span class="ci-tag">${t}</span>`).join(' ')}</div>`);
    html.push(`<div class="ci-section">
      <div class="ci-section-title">🏢 公司速览</div>
      <div class="ci-section-body">${meta.join('\n')}</div>
    </div>`);
  }

  // ———— 业务洞察 ————
  if (data.business_insight) {
    const bi = data.business_insight;
    const items = [];
    if (bi.main_business?.length) items.push(`<div class="ci-line"><b>核心业务：</b>${bi.main_business.join('、')}</div>`);
    if (bi.flagship_product) items.push(`<div class="ci-line"><b>王牌产品：</b>${bi.flagship_product}</div>`);
    if (bi.business_model) items.push(`<div class="ci-line"><b>商业模式：</b>${bi.business_model}</div>`);
    if (bi.tech_focus?.length) items.push(`<div class="ci-line"><b>技术重点：</b>${bi.tech_focus.map(t => `<code>${t}</code>`).join(' ')}</div>`);
    html.push(`<div class="ci-section">
      <div class="ci-section-title">📦 业务洞察</div>
      <div class="ci-section-body">${items.join('\n')}</div>
    </div>`);
  }

  // ———— 竞品与动态 ————
  if (data.competitive_edge) {
    const ce = data.competitive_edge;
    const items = [];
    if (ce.vs_competitors) items.push(`<div class="ci-line">${ce.vs_competitors}</div>`);
    if (ce.recent_milestones?.length) items.push(`<div class="ci-line"><b>近期里程碑：</b>${ce.recent_milestones.map(m => `<span class="ci-tag">${m}</span>`).join(' ')}</div>`);
    if (ce.risk_awareness?.length) items.push(`<div class="ci-line" style="font-size:0.8rem;"><b>💭 面试中可提及的挑战（显深度）：</b>${ce.risk_awareness.join('、')}</div>`);
    html.push(`<div class="ci-section">
      <div class="ci-section-title">⚔️ 竞争格局</div>
      <div class="ci-section-body">${items.join('\n')}</div>
    </div>`);
  }

  // ———— 文化氛围 ————
  if (data.culture_signals) {
    const cs = data.culture_signals;
    const items = [];
    if (cs.vibe) items.push(`<div class="ci-line"><b>氛围：</b>${cs.vibe}</div>`);
    if (cs.perks?.length) items.push(`<div class="ci-line"><b>福利：</b>${cs.perks.join('、')}</div>`);
    if (cs.watch_out?.length) items.push(`<div class="ci-line" style="color:var(--red);"><b>⚠️ 注意：</b>${cs.watch_out.join('、')}</div>`);
    html.push(`<div class="ci-section">
      <div class="ci-section-title">💡 文化信号</div>
      <div class="ci-section-body">${items.join('\n')}</div>
    </div>`);
  }

  // ———— 面试备战速查 ————
  if (data.hot_prep) {
    const hp = data.hot_prep;
    const items = [];
    if (hp.must_know_3?.length) items.push(`<div class="ci-line"><b>🔑 必知3件事：</b><br>${hp.must_know_3.map(f => `• ${f}`).join('<br>')}</div>`);
    if (hp.green_flags?.length) items.push(`<div class="ci-line" style="color:var(--green);margin-top:0.5rem;"><b>🟢 正面信号：</b>${hp.green_flags.join('、')}</div>`);
    if (hp.red_flags?.length) items.push(`<div class="ci-line" style="color:var(--red);"><b>🔴 警惕：</b>${hp.red_flags.join('、')}</div>`);
    if (hp.suggested_question_to_ask?.length) items.push(`<div class="ci-line" style="margin-top:0.5rem;"><b>🔄 建议反问面试官：</b><br>${hp.suggested_question_to_ask.map(q => `• ${q}`).join('<br>')}</div>`);
    html.push(`<div class="ci-section highlight">
      <div class="ci-section-title">🧠 面试速查清单</div>
      <div class="ci-section-body">${items.join('\n')}</div>
    </div>`);
  }

  el.innerHTML = html.join('\n');
  // 关闭按钮事件
  el.querySelector('.btn-close-company-result')?.addEventListener('click', () => {
    el.innerHTML = '';
    el.scrollIntoView({ behavior: 'smooth' });
  });
  el.scrollIntoView({ behavior: 'smooth' });
}
// ============================================================
// opencli 环境面板 — 内嵌展示 + 一键安装
// ============================================================

function statusIcon(ok) { return ok ? '🟢' : '🔴'; }

/**
 * 渲染 opencli 环境状态面板（替换旧的全屏弹窗引导）
 */
function renderEnvPanel(healthData) {
  const oc = healthData?.opencli || {};
  const itemsContainer = $('#settings-env-items');
  if (!itemsContainer) return;

  const items = [
    { label: 'Node.js', ok: true, detail: oc.node_version || '未知', fix: null },
    { label: 'opencli CLI', ok: oc.installed, detail: oc.installed ? 'v' + oc.version : '未安装', fix: null },
    { label: 'Daemon', ok: oc.daemon_running, detail: oc.daemon_running ? '运行中' : '未运行', fix: null },
    { label: 'Chrome 扩展', ok: oc.ext_installed, detail: oc.ext_installed ? '已连接' : '未连接', fix: 'btn-opencli-setup' },
    { label: '小红书适配器', ok: oc.has_xiaohongshu, detail: oc.has_xiaohongshu ? '可用' : '不可用', fix: oc.installed ? 'btn-opencli-setup' : null },
  ];

  const allOk = oc.installed && oc.browser_ready && oc.has_xiaohongshu;
  const overallStatus = allOk ? '✅ 全部就绪' : (oc.installed ? '⚠️ 部分就绪' : '🔴 需要配置');

  const itemsHtml = items.map(it => '<div style="display:flex;align-items:center;gap:0.5rem;padding:0.3rem 0;">' +
    '<span>' + statusIcon(it.ok) + '</span>' +
    '<span style="flex:1;"><b>' + it.label + '</b>: ' + it.detail + '</span>' +
    (it.fix ? '<span style="color:var(--accent);cursor:pointer;font-size:0.78rem;" data-fix="' + it.fix + '">🔧 修复</span>' : '') +
    '</div>').join('');

  itemsContainer.innerHTML = '<div style="margin-bottom:0.4rem;"><b>' + overallStatus + '</b></div>' + itemsHtml;

  itemsContainer.querySelectorAll('[data-fix]').forEach(el => {
    el.addEventListener('click', () => startOpencliSetup());
  });
}

/**
 * 一键安装 opencli（SSE 流式进度）
 */
async function startOpencliSetup() {
  const progressEl = $('#settings-env-progress');
  const btn = $('#btn-opencli-setup-settings');
  if (!progressEl || !btn) return;

  btn.disabled = true;
  btn.textContent = '⏳ 配置中...';
  progressEl.style.display = 'block';
  progressEl.innerHTML = '<p style="color:var(--muted);font-size:0.8rem;">⏳ 开始环境配置...</p>';

  try {
    const resp = await fetch('/api/opencli-setup', { method: 'POST' });
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const ev = JSON.parse(line.slice(6));
          progressEl.innerHTML = renderSetupProgress(ev);
          if (ev.step === 'done' || ev.step === 'error') {
            btn.disabled = false;
            btn.textContent = ev.status === 'ok' ? '✅ 已完成' : '🔧 重新配置';
            const h = await fetchRetry('/api/health').then(r => r.json());
            renderEnvPanel(h);
          }
        } catch {}
      }
    }
  } catch (e) {
    progressEl.innerHTML = '<p style="color:var(--red);font-size:0.8rem;">❌ 配置失败: ' + e.message + '</p>';
    btn.disabled = false;
    btn.textContent = '🔧 重新配置';
  }
}

function renderSetupProgress(ev) {
  const icon = ev.status === 'ok' ? '✅' : ev.status === 'warn' ? '⚠️' : ev.status === 'error' ? '❌' : '⏳';
  const color = ev.status === 'ok' ? 'var(--green)' : ev.status === 'warn' ? '#e6a817' : ev.status === 'error' ? 'var(--red)' : 'var(--muted)';
  if (ev.step === 'done') {
    return '<p style="color:' + color + ';font-size:0.82rem;white-space:pre-line;">' + icon + ' ' + ev.detail + '</p>';
  }
  return '<p style="color:' + color + ';font-size:0.8rem;margin:0.2rem 0;white-space:pre-line;">' + icon + ' [' + ev.step + '] ' + (ev.detail || '') + '</p>';
}


// 小红书扫码登录
async function openXhsForLogin() {
  const el = document.getElementById('recheck-login');
  if (el) el.textContent = '⏳ 正在打开小红书...';
  try {
    const resp = await fetchRetry('/api/open-xhs-login', { method: 'POST' });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error);
    if (el) el.textContent = '✅ 小红书已打开！请在浏览器中完成扫码登录，登录成功后回到此页面点「已完成登录」';
  } catch(e) {
    if (el) el.textContent = '❌ 打开失败: ' + e.message;
  }
}
async function markXhsLoginDone() {
  state._xhsLoginDone = true;
  try {
    const h = await fetchRetry('/api/health').then(r => r.json());
    await renderEnvPanel(h);
  } catch(e) { /* ignore */ }
}
window.openXhsForLogin = openXhsForLogin;
window.markXhsLoginDone = markXhsLoginDone;

// ============================================================
// 导出功能 — DOCX + Markdown
// ============================================================

function exportMarkdown(title, content, sections) {
  let md = `# ${title}\n\n`;
  md += `> 由 一键上岸 导出 · ${new Date().toLocaleDateString('zh-CN')} ${new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}\n\n`;
  if (sections) {
    for (const [label, text] of Object.entries(sections)) {
      md += `## ${label}\n\n${text}\n\n`;
    }
  } else {
    md += content;
  }
  downloadFile(`${title}.md`, md, 'text/markdown');
}

async function exportDocx(title, content, sections) {
  try {
    const resp = await fetchRetry('/api/export/generate-docx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content, sections })
    });
    if (!resp.ok) throw new Error((await resp.json()).error);
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${title}.docx`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) { toast('导出DOCX失败: ' + e.message); }
}

function exportCurrentQuestionsMD() {
  if (!state.analysis) return toast('请先完成分析');
  const qs = (state.analysis.questions || []).concat(state.analysis.kb_supplement || []).concat(state.analysis.mianjing || []);
  if (!qs.length) return toast('没有题目可导出');
  const sections = {};
  sections['押题清单'] = qs.map((q,i) => `${i+1}. [${q.type||'通用'}] ${q.question}\n   🎯 ${q.examiner_intent || ''}${q.sample_answer_points?.length ? '\n   💡 ' + q.sample_answer_points.join(' / ') : ''}${q.tips?.length ? '\n   🔧 ' + q.tips.join(' / ') : ''}`).join('\n\n');
  const company = state.analysis.jd?.company || '未知';
  const position = state.analysis.jd?.position || '面试';
  exportMarkdown(`${company} ${position} 押题清单`, '', sections);
}

async function exportCurrentQuestionsDocx() {
  if (!state.analysis) return toast('请先完成分析');
  const qs = (state.analysis.questions || []).concat(state.analysis.kb_supplement || []).concat(state.analysis.mianjing || []);
  if (!qs.length) return toast('没有题目可导出');
  const sections = {};
  sections['押题清单'] = qs.map((q,i) => `${i+1}. [${q.type||'通用'}] ${q.question}\n   🎯 ${q.examiner_intent || ''}${q.sample_answer_points?.length ? '\n   💡 ' + q.sample_answer_points.join(' / ') : ''}${q.tips?.length ? '\n   🔧 ' + q.tips.join(' / ') : ''}`).join('\n\n');
  const company = state.analysis.jd?.company || '未知';
  const position = state.analysis.jd?.position || '面试';
  await exportDocx(`${company} ${position} 押题清单`, '', sections);
}

function exportPracticeHistoryMD() {
  const el = $('#phrase-panel');
  if (!el || el.classList.contains('hidden')) { 
    // Force load phrases
    loadPhrasesForExport().then(phrases => {
      if (!phrases.length) return toast('暂无练习记录');
      const sections = {};
      sections['练习历史'] = phrases.map((p,i) => `${i+1}. **${p.question||''}** (${p.score||0}分)\n   回答: ${(p.answer||'').slice(0, 200)}${(p.answer||'').length>200?'...':''}\n   ${p.improvedVersion ? '改进版: ' + p.improvedVersion + '\n' : ''}${p.keyTakeaways ? '关键点: ' + p.keyTakeaways : ''}`).join('\n\n');
      exportMarkdown('练习历史记录', '', sections);
    });
    return;
  }
  // Read from rendered DOM
  const items = document.querySelectorAll('#phrase-list .phrase-item');
  if (!items.length) return toast('暂无练习记录');
  const sections = {};
  sections['练习历史'] = Array.from(items).map((item, i) => {
    const qEl = item.querySelector('.phrase-q');
    const aEl = item.querySelector('.phrase-a');
    const scoreEl = item.querySelector('.phrase-score');
    return `${i+1}. ${qEl?.textContent?.replace(/^Q:\s*/,'')||''} (${scoreEl?.textContent||'0分'})\n   ${aEl?.textContent?.slice(0,300)||''}`;
  }).join('\n\n');
  exportMarkdown('练习历史记录', '', sections);
}

async function loadPhrasesForExport() {
  try {
    const data = await fetchRetry('/api/phrases?tag=练习');
    return data.phrases || [];
  } catch { return []; }
}

function exportInterviewReportMD() {
  const reportEl = $('#interview-report');
  if (!reportEl || reportEl.classList.contains('hidden')) return toast('暂无面试报告可导出');
  const sections = {};
  sections['面试报告'] = reportEl.innerText;
  exportMarkdown('面试评估报告', '', sections);
}

async function exportInterviewReportDocx() {
  const reportEl = $('#interview-report');
  const reportText = reportEl?.innerText || '';
  if (!reportText) return toast('暂无面试报告可导出');
  await exportDocx('面试评估报告', reportText);
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob(['\uFEFF' + content], { type: mimeType + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  a.click(); URL.revokeObjectURL(url);
  toast('✅ 已导出 ' + filename);
}

// 导出按钮事件绑定
(function() {
  const btnQMd = document.getElementById('btn-export-questions-md');
  const btnQDocx = document.getElementById('btn-export-questions-docx');
  const btnPMd = document.getElementById('btn-export-practice-md');
  const btnIMd = document.getElementById('btn-export-interview-md');
  const btnIDocx = document.getElementById('btn-export-interview-docx');
  
  if (btnQMd) btnQMd.addEventListener('click', exportCurrentQuestionsMD);
  if (btnQDocx) btnQDocx.addEventListener('click', exportCurrentQuestionsDocx);
  if (btnPMd) btnPMd.addEventListener('click', exportPracticeHistoryMD);
  if (btnIMd) btnIMd.addEventListener('click', exportInterviewReportMD);
  if (btnIDocx) btnIDocx.addEventListener('click', exportInterviewReportDocx);
})();

// ============================================================
(async () => {
  await refreshSessionList();

  // 公司调研按钮
  $('#btn-company-research')?.addEventListener('click', () => doCompanyResearch());
  $('#btn-jd-format')?.addEventListener('click', () => reformatJdInTextarea());

  try {
    const h = await fetchRetry('/api/health').then(r => r.json());

    // 状态栏 — 同步更新 opencli 状态
    const oc = h.opencli || {};
    let statusParts = [];
    if (h.provider && h.provider !== '未连接' && h.provider !== '未配置激活连接') {
      statusParts.push('✅ ' + h.provider);
    } else {
      statusParts.push('⚠️ 未配置AI — 点击 ⚙️ 设置');
    }
    if (!oc.installed) {
      statusParts.push('❌ opencli 未安装');
    } else if (!oc.browser_ready) {
      statusParts.push('⚠️ 浏览器未绑定');
    }
    // Token 用量
    const usage = h.usage;
    if (usage && usage.total > 0) {
      const k = usage.total >= 1000 ? (usage.total / 1000).toFixed(1) + 'k' : usage.total;
      statusParts.push(`📊 ${k} tokens`);
    }
    setStatus(statusParts.join(' · '));
} catch { setStatus('\u26aa 就绪 — 请填写JD和简历开始'); }

})();
  // ============================================================
  // 专项训练模块
  // ============================================================
  function renderDrillMode() {
    document.querySelectorAll('.drill-mode-btn').forEach(function(btn) {
      btn.classList.toggle('active', btn.dataset.mode === state._drillMode);
    });
    // 恢复模式偏好后刷新筛选
    loadDrillTypeFilter();
    renderDrillQuestions();
  }

  function loadDrillTypeFilter() {
    var allQs = getAllDrillQuestions();
    var types = {};
    allQs.forEach(function(q) { var t = q.type || '其他'; types[t] = (types[t] || 0) + 1; });
    var filterEl = document.getElementById('drill-filter');
    if (!filterEl) return;
    var html = '<button class="btn-filter drill-filter-btn active" data-type="">全部 (' + allQs.length + ')</button>';
    Object.keys(types).forEach(function(t) {
      html += '<button class="btn-filter drill-filter-btn" data-type="' + t + '">' + t + ' (' + types[t] + ')</button>';
    });
    filterEl.innerHTML = html;
    // 恢复已保存的筛选类型
    var savedType = localStorage.getItem('drill_pref_type');
    document.querySelectorAll('.drill-filter-btn').forEach(function(btn) {
      if (savedType && btn.dataset.type === savedType) {
        btn.classList.add('active');
        document.querySelector('.drill-filter-btn[data-type=""]')?.classList.remove('active');
        state._drillType = savedType;
      }
      btn.addEventListener('click', function() {
        document.querySelectorAll('.drill-filter-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        state._drillType = btn.dataset.type;
        localStorage.setItem('drill_pref_type', state._drillType || '');
        renderDrillQuestions();
      });
    });
  }

  function getAllDrillQuestions() {
    if (!state.analysis) return [];
    var qs = state.analysis.questions || [];
    var kb = state.analysis.kb_supplement || [];
    var mj = state.analysis.mianjing || [];
    var all = [];
    qs.forEach(function(q) { all.push(Object.assign({}, q, { _source: '' })); });
    kb.forEach(function(q) { all.push(Object.assign({}, q, { _source: '知识库' })); });
    mj.forEach(function(q) { all.push(Object.assign({}, q, { _source: '面经' })); });
    return all;
  }

  function renderDrillQuestions() {
    var allQs = getAllDrillQuestions();
    var drillEmpty = document.getElementById('drill-empty');
    var drillArea = document.getElementById('drill-area');
    if (!allQs.length) {
      if (drillEmpty) drillEmpty.classList.remove('hidden');
      if (drillArea) drillArea.classList.add('hidden');
      return;
    }
    if (drillEmpty) drillEmpty.classList.add('hidden');
    if (drillArea) drillArea.classList.remove('hidden');
    var filtered = state._drillType ? allQs.filter(function(q) { return (q.type || '') === state._drillType; }) : allQs;
    var listEl = document.getElementById('drill-question-list');
    var countEl = document.getElementById('drill-q-count');
    if (countEl) countEl.textContent = filtered.length;

    // 完成度指标：从 drill records 计算已答题数
    var completedCount = 0;
    try {
      var stored = localStorage.getItem('drill_completed_' + (state.sessionId || ''));
      if (stored) {
        var completedSet = JSON.parse(stored) || {};
        completedCount = filtered.filter(function(q) { return completedSet[q.question]; }).length;
      }
    } catch(e) {}
    var completionHtml = '';
    if (completedCount > 0) {
      var pct = Math.round(completedCount / filtered.length * 100);
      completionHtml = '<div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.3rem;">' +
        '<span style="font-size:0.72rem;color:var(--muted);">完成度：' + completedCount + '/' + filtered.length + ' (' + pct + '%)</span>' +
        '<div style="flex:1;max-width:200px;height:4px;background:var(--rule);border-radius:2px;overflow:hidden;">' +
        '<div style="width:' + pct + '%;height:100%;background:var(--green);border-radius:2px;transition:width 0.3s;"></div>' +
        '</div></div>';
    }

    listEl.innerHTML = filtered.map(function(q, i) {
      var source = q._source ? '<span style="font-size:0.65rem;color:var(--accent);margin-right:4px;">' + q._source + '</span>' : '';
      var done = false;
      try {
        var stored2 = localStorage.getItem('drill_completed_' + (state.sessionId || ''));
        if (stored2) {
          var cs = JSON.parse(stored2) || {};
          done = cs[q.question];
        }
      } catch(e) {}
      return '<li data-question="' + encodeURIComponent(q.question || '') + '" style="' + (done ? 'opacity:0.7;' : '') + '">' +
        '<span class="num">' + (i + 1) + '</span>' + source + (q.question || '') + (done ? ' <span style="font-size:0.65rem;color:var(--green);">✅</span>' : '') + '</li>';
    }).join('') + (completionHtml ? '<div style="padding:0.5rem 0.8rem 0 0.8rem;">' + completionHtml + '</div>' : '');
    listEl.querySelectorAll('li').forEach(function(li) {
      li.addEventListener('click', function() { selectDrillQuestion(decodeURIComponent(li.dataset.question)); });
    });
  }

  function selectDrillQuestion(question) {
    var allQs = getAllDrillQuestions();
    var found = null;
    for (var i = 0; i < allQs.length; i++) {
      if (allQs[i].question === question) { found = allQs[i]; break; }
    }
    if (!found) {
      for (var j = 0; j < allQs.length; j++) {
        if (allQs[j].question.indexOf(question) !== -1 || (question && question.indexOf(allQs[j].question) !== -1)) {
          found = allQs[j]; break;
        }
      }
    }
    state._drillQuestion = question;
    state._drillFeedback = null;
    clearDrillTimer();
    var taskCard = document.getElementById('drill-task-card');
    var taskType = document.getElementById('drill-task-type');
    var taskQ = document.getElementById('drill-task-question');
    var taskPoints = document.getElementById('drill-task-points');
    if (found) {
      taskType.innerHTML = '<span class="' + getTypeClass(found.type) + '">' + (found.type || '') + '</span>';
      taskQ.textContent = found.question || question;
      taskPoints.innerHTML = '<strong>回答要点：</strong>使用 STAR 框架，量化成果，突出你的贡献，控制在 2 分钟内';
    } else {
      taskType.innerHTML = '<span>题目</span>';
      taskQ.textContent = question || '';
      taskPoints.innerHTML = '<strong>回答要点：</strong>使用 STAR 框架，量化成果，突出你的贡献';
    }
    taskCard.style.display = 'block';
    document.getElementById('drill-timer-card').style.display = 'block';
    document.getElementById('drill-answer-card').style.display = 'none';
    document.getElementById('drill-feedback').classList.add('hidden');
    document.getElementById('drill-history-card').style.display = 'none';
    document.getElementById('btn-drill-retry').classList.add('hidden');
    document.getElementById('drill-timer-phase').textContent = '准备作答';
    document.getElementById('drill-timer-display').textContent = '0:30';
    document.getElementById('drill-timer-display').className = '';
    document.getElementById('drill-timer-actions').style.display = 'flex';
    document.getElementById('drill-answer').value = '';
    loadDrillAttemptInfo(question);
    loadDrillHistory(question);
    document.querySelectorAll('#drill-question-list li').forEach(function(li) {
      var liQ = decodeURIComponent(li.dataset.question || '');
      li.classList.toggle('active', liQ === question);
    });
    var idx = -1;
    for (var k = 0; k < allQs.length; k++) { if (allQs[k].question === question) { idx = k; break; } }
    var currentEl = document.getElementById('drill-current-type');
    if (currentEl) currentEl.textContent = '当前：第 ' + (idx + 1) + ' / ' + allQs.length + ' 题';
    setTimeout(function() {
      document.getElementById('drill-task-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }

  async function loadDrillAttemptInfo(question) {
    try {
      var data = await fetchRetry('/api/drill/records?question=' + encodeURIComponent(question)).then(function(r) { return r.json(); });
      var total = data.total || 0;
      var el = document.getElementById('drill-attempt-info');
      if (!el) return;
      if (total > 0) {
        var latest = data.records[0];
        el.innerHTML = '已练习 <b>' + total + '</b> 次' + (latest ? ' · 上次 ' + latest.overallScore + '分' : '');
      } else {
        el.textContent = '首次练习';
      }
    } catch(e) { /* ignore */ }
  }

  // ===== Timer =====
  document.getElementById('btn-drill-start-prepare').addEventListener('click', function() {
    startDrillTimer('prepare', 30);
  });
  document.getElementById('btn-drill-skip-prepare').addEventListener('click', function() {
    startDrillTimer('answer', 120);
  });
  function clearDrillTimer() {
    if (state._drillTimer) {
      clearInterval(state._drillTimer);
      state._drillTimer = null;
      state._drillPhase = null;
    }
  }
  function startDrillTimer(phase, seconds) {
    clearDrillTimer();
    state._drillPhase = phase;
    var display = document.getElementById('drill-timer-display');
    var phaseEl = document.getElementById('drill-timer-phase');
    var actions = document.getElementById('drill-timer-actions');
    var answerCard = document.getElementById('drill-answer-card');
    var answerTimer = document.getElementById('drill-answer-timer');
    actions.style.display = 'none';
    display.className = '';
    if (phase === 'prepare') {
      phaseEl.textContent = '准备时间 — 思考你的回答结构';
      answerCard.style.display = 'none';
    } else {
      phaseEl.textContent = '作答时间 — 开始回答';
      answerCard.style.display = 'block';
      document.getElementById('drill-answer').focus();
    }
    var remaining = seconds;
    var updateDisplay = function() {
      var mins = Math.floor(remaining / 60);
      var secs = remaining % 60;
      display.textContent = mins + ':' + (secs < 10 ? '0' : '') + secs;
      if (remaining <= 10) display.className = 'danger';
      else if (remaining <= 20) display.className = 'warning';
      if (phase === 'answer' && answerTimer) {
        answerTimer.textContent = '（剩余 ' + mins + ':' + (secs < 10 ? '0' : '') + secs + '）';
      }
    };
    updateDisplay();
    state._drillTimer = setInterval(function() {
      remaining--;
      updateDisplay();
      if (remaining <= 0) {
        clearDrillTimer();
        if (phase === 'prepare') {
          phaseEl.textContent = '准备时间结束，开始作答';
          startDrillTimer('answer', 120);
        } else {
          phaseEl.textContent = '时间到！';
          display.className = 'danger';
          if (answerTimer) answerTimer.textContent = '（时间到）';
        }
      }
    }, 1000);
  }

  // ===== Submit =====
  document.getElementById('btn-drill-submit').addEventListener('click', async function() {
    var answer = document.getElementById('drill-answer').value.trim();
    var question = state._drillQuestion;
    if (!question) { toast('请先选择一道题目'); return; }
    if (!answer || answer.length < 5) { toast('请写下你的回答（至少5个字）'); return; }
    var btn = document.getElementById('btn-drill-submit');
    btn.disabled = true; btn.textContent = '评估中...';
    setStatus('评估中...');

    // 显示进度指示器
    var fb = document.getElementById('drill-feedback');
    if (fb) {
      fb.classList.remove('hidden');
      fb.innerHTML = '<div id="drill-eval-progress" style="display:none;"></div>';
    }
    var progress = showAiProgress('drill-eval-progress', [
      '正在分析你的回答...',
      '正在逐句评估...',
      '正在生成改进建议...',
      '评估完成'
    ]);

    try {
      clearDrillTimer();
      progress.update(0);
      await new Promise(function(r) { setTimeout(r, 200); });

      var jd = state.analysis ? (state.analysis.jd || {}) : {};
      var jdSummary = jd.position
        ? (jd.company || '') + ' ' + jd.position + ' | ' + (jd.requirements || jd.responsibilities || '')
        : (jd.requirements || jd.responsibilities || '');
      var resumeText = (state.resumeText || '').slice(0, 3000);

      progress.update(1);
      var result = await apiEvaluateSingle(question, answer, jdSummary, resumeText);

      progress.update(2);
      await new Promise(function(r) { setTimeout(r, 200); });
      progress.done();

      state._drillFeedback = result;
      // 标记为已完成
      try {
        var key = 'drill_completed_' + (state.sessionId || '');
        var cs = JSON.parse(localStorage.getItem(key) || '{}');
        cs[question] = true;
        localStorage.setItem(key, JSON.stringify(cs));
      } catch(e) {}

      setTimeout(function() { if (progress) progress.hide(); }, 500);
      renderDrillFeedback(result);
      var allQs = getAllDrillQuestions();
      var found = null;
      for (var i = 0; i < allQs.length; i++) { if (allQs[i].question === question) { found = allQs[i]; break; } }
      var questionType = found ? (found.type || '') : '';
      await saveDrillRecord(question, questionType, answer, result);
      // 同时保存到话术库（练习历史），确保仪表盘和练习历史都能看到
      await autoSavePracticeRecord(question, answer, result);
      document.getElementById('btn-drill-retry').classList.remove('hidden');
      loadDrillAttemptInfo(question);
      loadDrillHistory(question);
      showTabDot('drill');
      setStatus('评估完成');
      // 追问按钮
      showFollowUpButton('drill', question, answer, result);
    } catch (e) {
      toast('评估失败: ' + e.message);
      if (progress) progress.hide();
    } finally {
      btn.disabled = false; btn.textContent = '重新提交';
    }
  });

  async function saveDrillRecord(question, questionType, answer, result) {
    try {
      var sc = result.scores || {};
      var scores = {
        star_completeness: sc.star_completeness || 0,
        quantification: sc.quantification || 0,
        position_match: sc.position_match || 0,
        structure: sc.structure || 0,
        highlight: sc.highlight || 0
      };
      await fetchRetry('/api/drill/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: question, questionType: questionType, answer: answer, scores: scores,
          overallScore: result.overall_score || result.over_score || 0,
          improvedVersion: result.improved_version || '',
          keyTakeaways: result.key_takeaways || [],
          lineByLine: result.line_by_line || []
        })
      });
    } catch(e) { /* silent */ }
  }

  function renderDrillFeedback(data) {
    var scores = data.scores || {};
    var lines = data.line_by_line || [];
    var fb = document.getElementById('drill-feedback');
    fb.classList.remove('hidden');
    var labelMap = {star_completeness: 'STAR', quantification: '量化', position_match: '匹配', structure: '结构', highlight: '亮点'};
    fb.innerHTML = '<div class="card feedback-card">' +
      '<h3>评估结果 — 综合 ' + (data.overall_score || data.over_score || '--') + '分</h3>' +
      '<div class="feedback-scores">' +
      ['star_completeness', 'quantification', 'position_match', 'structure', 'highlight'].map(function(k) {
        return '<div class="feedback-score"><div class="num">' + (scores[k] || '--') + '</div><div class="label">' + labelMap[k] + '</div></div>';
      }).join('') +
      '</div>' +
      '<div class="feedback-lines">' + lines.map(function(l) {
        return '<div class="feedback-line ' + (l.is_good ? 'good' : 'bad') + '">' +
        (l.is_good ? '✓' : '✗') + ' "' + (l.quote || '') + '" — ' + (l.comment || '') + '</div>';
      }).join('') + '</div>' +
      (data.improved_version ? '<div class="feedback-improved"><strong>改进参考：</strong><br>' + data.improved_version + '</div>' : '') +
      (data.key_takeaways ? '<div style="font-size:0.82rem;color:var(--muted);"><strong>关键改进点：</strong>' + (Array.isArray(data.key_takeaways) ? data.key_takeaways.join('；') : data.key_takeaways) + '</div>' : '') +
      '</div>';
    fb.scrollIntoView({ behavior: 'smooth' });
  }

  // ===== Retry =====
  document.getElementById('btn-drill-retry').addEventListener('click', function() {
    document.getElementById('drill-answer').value = '';
    document.getElementById('drill-feedback').classList.add('hidden');
    document.getElementById('btn-drill-retry').classList.add('hidden');
    document.getElementById('drill-timer-card').style.display = 'block';
    document.getElementById('drill-timer-phase').textContent = '准备作答';
    document.getElementById('drill-timer-display').textContent = '0:30';
    document.getElementById('drill-timer-display').className = '';
    document.getElementById('drill-timer-actions').style.display = 'flex';
    document.getElementById('drill-answer-card').style.display = 'none';
    document.getElementById('drill-task-card').scrollIntoView({ behavior: 'smooth' });
  });

  // ===== Skip =====
  document.getElementById('btn-drill-skip').addEventListener('click', function() {
    var allQs = getAllDrillQuestions();
    var filtered = state._drillType ? allQs.filter(function(q) { return (q.type || '') === state._drillType; }) : allQs;
    var currentIdx = -1;
    for (var i = 0; i < filtered.length; i++) { if (filtered[i].question === state._drillQuestion) { currentIdx = i; break; } }
    var nextIdx = (currentIdx + 1) % filtered.length;
    if (filtered[nextIdx]) {
      selectDrillQuestion(filtered[nextIdx].question);
    }
  });

  // ===== Mode Switch =====
  document.querySelectorAll('.drill-mode-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      state._drillMode = btn.dataset.mode;
      localStorage.setItem('drill_pref_mode', state._drillMode);
      renderDrillMode();
    });
  });

  // 恢复偏好设置
  var savedMode = localStorage.getItem('drill_pref_mode');
  if (savedMode && ['type', 'free'].indexOf(savedMode) >= 0) {
    state._drillMode = savedMode;
  }
  var savedType = localStorage.getItem('drill_pref_type');
  if (savedType) {
    state._drillType = savedType;
  }

  // ===== Drill History =====
  async function loadDrillHistory(question) {
    var card = document.getElementById('drill-history-card');
    var list = document.getElementById('drill-history-list');
    if (!card || !list) return;
    try {
      var data = await fetchRetry('/api/drill/records?question=' + encodeURIComponent(question)).then(function(r) { return r.json(); });
      var records = data.records || [];
      if (records.length === 0) { card.style.display = 'none'; return; }
      card.style.display = 'block';
      list.innerHTML = records.map(function(r, i) {
        var prev = records[i + 1];
        var trend = '';
        if (prev) {
          var diff = (r.overallScore || 0) - (prev.overallScore || 0);
          if (diff > 0) trend = '<span class="drill-score-trend-up">↑' + diff + '</span>';
          else if (diff < 0) trend = '<span class="drill-score-trend-down">↓' + Math.abs(diff) + '</span>';
          else trend = '<span class="drill-score-trend-same">→</span>';
        }
        var date = r.createdAt ? new Date(r.createdAt).toLocaleDateString('zh-CN') + ' ' + new Date(r.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';
        return '<div class="drill-history-item">' +
          '<span class="drill-attempt-badge">#' + (r.attemptNumber || '-') + '</span>' +
          '<span style="flex:1;">' + date + '</span>' +
          '<span style="font-weight:700;font-size:1.1rem;color:var(--accent);">' + (r.overallScore || '-') + '分</span>' +
          trend + '</div>';
      }).join('');
      var chartEl = document.getElementById('drill-history-chart');
      if (chartEl && typeof echarts !== 'undefined') {
        renderDrillHistoryChart(chartEl, records);
      }
    } catch(e) { card.style.display = 'none'; }
  }

  function renderDrillHistoryChart(el, records) {
    var sorted = [].concat(records).reverse();
    var labels = sorted.map(function(r, i) { return '#' + (i + 1); });
    var scores = sorted.map(function(r) { return r.overallScore || 0; });
    if (typeof echarts === 'undefined') {
      el.innerHTML = '<p style="text-align:center;color:var(--muted);padding:2rem;">图表加载中...</p>';
      return;
    }
    var chart = echarts.init(el);
    chart.setOption({
      tooltip: { trigger: 'axis' },
      grid: { left: 40, right: 20, top: 20, bottom: 30 },
      xAxis: { type: 'category', data: labels, axisLabel: { fontSize: 11 } },
      yAxis: { type: 'value', min: 0, max: 100, axisLabel: { fontSize: 11 } },
      series: [{
        data: scores, type: 'line', smooth: true,
        lineStyle: { color: '#4F46E5', width: 2 },
        itemStyle: { color: '#4F46E5' },
        areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(79,70,229,0.2)' }, { offset: 1, color: 'rgba(79,70,229,0.02)' }] } },
        markLine: { silent: true, data: [{ yAxis: 60, lineStyle: { color: '#F59E0B', type: 'dashed' }, label: { formatter: '及格线 60' } }] }
      }]
    });
    var resizeFn = function() { try { chart.resize(); } catch(e) {} };
    window.addEventListener('resize', resizeFn);
    el._chart = chart;
    el._resizeFn = resizeFn;
  }

  // ===== Drill Stats =====
  function loadDrillStats() {
    var panel = document.getElementById('drill-stats-panel');
    var content = document.getElementById('drill-stats-content');
    if (!panel || !content) return;
    panel.addEventListener('toggle', function() {
      if (panel.open && !content.dataset.loaded) {
        content.dataset.loaded = '1';
        fetchRetry('/api/drill/stats').then(function(r) { return r.json(); }).then(function(data) {
          var html = '<div class="drill-stats-grid">' +
            '<div class="drill-stat-card"><div class="num">' + (data.totalDrills || 0) + '</div><div class="label">总训练次数</div></div>';
          Object.keys(data.typeStats || {}).forEach(function(t) {
            var s = data.typeStats[t];
            html += '<div class="drill-stat-card"><div class="num">' + s.avgScore + '</div><div class="label">' + t + '平均分</div></div>';
          });
          html += '</div>';
          if (data.topQuestions && data.topQuestions.length > 0) {
            html += '<h4 style="margin-bottom:0.5rem;">刻意练习最多</h4>';
            data.topQuestions.forEach(function(q) {
              var trendIcon = q.trend > 0 ? ' <span class="drill-score-trend-up">↑' + q.trend + '</span>' :
                q.trend < 0 ? ' <span class="drill-score-trend-down">↓' + Math.abs(q.trend) + '</span>' : '';
              html += '<div class="drill-history-item">' +
                '<span class="drill-attempt-badge">' + q.attemptCount + '次</span>' +
                '<span style="flex:1;font-size:0.82rem;">' + (q.question || '').slice(0, 60) + '</span>' +
                '<span style="font-size:0.78rem;color:var(--muted);">' + q.firstScore + '→' + q.latestScore + '</span>' +
                trendIcon + '</div>';
            });
          }
          content.innerHTML = html;
        }).catch(function(e) { content.innerHTML = '<p style="color:var(--muted);">加载失败</p>'; });
      }
    });
  }

  // ===== Drill Answer Auto-resize =====
  (function() {
    var ta = document.getElementById('drill-answer');
    if (ta) {
      ta.addEventListener('input', debounce(function() {
        ta.style.height = 'auto';
        ta.style.height = Math.max(100, ta.scrollHeight) + 'px';
      }, 300));
    }
  })();

// ===== Voice Recording =====
  var voiceBtn = document.getElementById('btn-drill-voice');
  var voiceStatus = document.getElementById('drill-voice-status');
  var voiceRecognition = null;
  var voiceIsRecording = false;

  if (voiceBtn) {
    // Check browser support
    var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      voiceBtn.style.display = 'flex';
      voiceBtn.addEventListener('click', function() {
        if (voiceIsRecording) {
          stopVoiceRecording();
        } else {
          startVoiceRecording();
        }
      });

      function startVoiceRecording() {
        voiceRecognition = new SpeechRecognition();
        voiceRecognition.lang = 'zh-CN';
        voiceRecognition.interimResults = true;
        voiceRecognition.continuous = true;
        voiceRecognition.maxAlternatives = 1;

        var finalTranscript = '';
        var ta = document.getElementById('drill-answer');

        voiceRecognition.onresult = function(event) {
          var interim = '';
          for (var i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i].isFinal) {
              finalTranscript += event.results[i][0].transcript;
            } else {
              interim += event.results[i][0].transcript;
            }
          }
          ta.value = (finalTranscript + interim).trim();
          ta.style.height = 'auto';
          ta.style.height = Math.max(100, ta.scrollHeight) + 'px';
        };

        voiceRecognition.onerror = function(event) {
          if (event.error === 'no-speech') return;
          console.warn('Speech recognition error:', event.error);
          stopVoiceRecording();
          if (event.error === 'not-allowed') {
            toast('麦克风权限被拒绝，请在浏览器设置中允许麦克风访问');
          }
        };

        voiceRecognition.onend = function() {
          if (voiceIsRecording) {
            // Auto-restart for continuous recording
            try { voiceRecognition.start(); } catch(e) {}
          }
        };

        try {
          voiceRecognition.start();
          voiceIsRecording = true;
          voiceBtn.classList.add('recording');
          voiceBtn.textContent = '⏹';
          if (voiceStatus) voiceStatus.style.display = 'block';
          // Also start the answer timer if not already started
          var answerCard = document.getElementById('drill-answer-card');
          if (answerCard && answerCard.style.display === 'block' && !state._drillTimer) {
            startDrillTimer('answer', 120);
          }
        } catch(e) {
          toast('语音识别启动失败: ' + e.message);
        }
      }

      function stopVoiceRecording() {
        voiceIsRecording = false;
        if (voiceRecognition) {
          try { voiceRecognition.stop(); } catch(e) {}
          voiceRecognition = null;
        }
        voiceBtn.classList.remove('recording');
        voiceBtn.textContent = '🎤';
        if (voiceStatus) voiceStatus.style.display = 'none';
      }
    } else {
      voiceBtn.style.display = 'none';
      console.log('Speech Recognition not supported in this browser');
    }
  }

  // ===== Smart Recommendation =====
  var smartBtn = document.createElement('button');
  smartBtn.className = 'drill-smart-btn';
  smartBtn.textContent = '🎯 智能推荐';
  smartBtn.style.display = 'none';
  smartBtn.addEventListener('click', function() {
    var isActive = smartBtn.classList.toggle('active');
    if (isActive) {
      loadSmartRecommendation();
    } else {
      state._drillType = '';
      renderDrillQuestions();
      // Reset filter buttons
      document.querySelectorAll('.drill-filter-btn').forEach(function(b) { b.classList.remove('active'); });
      var allBtn = document.querySelector('.drill-filter-btn[data=""]');
      if (allBtn) allBtn.classList.add('active');
    }
  });

  var filterContainer = document.getElementById('drill-filter');
  if (filterContainer) {
    filterContainer.parentNode.insertBefore(smartBtn, filterContainer.nextSibling);
  }

  async function loadSmartRecommendation() {
    try {
      smartBtn.textContent = '⏳ 分析中...';
      var data = await fetchRetry('/api/drill/weakness').then(function(r) { return r.json(); });
      var weakQs = data.weakQuestions || [];
      if (weakQs.length === 0) {
        toast('暂无足够数据，请先完成几次练习');
        smartBtn.classList.remove('active');
        smartBtn.textContent = '🎯 智能推荐';
        return;
      }
      state._smartQuestions = weakQs.map(function(q) { return q.question; });
      renderDrillQuestions();
      smartBtn.textContent = '🎯 智能推荐 (' + weakQs.length + '题)';
    } catch(e) {
      toast('智能推荐加载失败');
      smartBtn.classList.remove('active');
      smartBtn.textContent = '🎯 智能推荐';
    }
  }

  // Override getAllDrillQuestions to support smart sort
  var _origGetAllDrillQuestions = getAllDrillQuestions;
  getAllDrillQuestions = function() {
    var all = _origGetAllDrillQuestions();
    if (smartBtn.classList.contains('active') && state._smartQuestions && state._smartQuestions.length > 0) {
      var smartSet = {};
      state._smartQuestions.forEach(function(q, i) { smartSet[q] = i; });
      all.sort(function(a, b) {
        var aIdx = smartSet.hasOwnProperty(a.question) ? smartSet[a.question] : 999;
        var bIdx = smartSet.hasOwnProperty(b.question) ? smartSet[b.question] : 999;
        return aIdx - bIdx;
      });
    }
    return all;
  };

  // ===== Weakness Card on Dashboard =====
  var _origLoadDashboard = loadDashboard;
  loadDashboard = async function() {
    await _origLoadDashboard();
    renderWeaknessCard();
  };

  async function renderWeaknessCard() {
    var container = document.getElementById('tab-dashboard');
    if (!container) return;
    // Remove existing weakness card
    var existing = document.getElementById('dash-weakness-card');
    if (existing) existing.remove();

    try {
      var data = await fetchRetry('/api/drill/weakness').then(function(r) { return r.json(); });
      var weaknesses = data.weaknesses || [];
      if (weaknesses.length === 0) return;

      var card = document.createElement('div');
      card.id = 'dash-weakness-card';
      card.className = 'card weakness-card';
      var emojiMap = { star_completeness: '📋', quantification: '📊', position_match: '🎯', structure: '🗂️', highlight: '✨' };

      var html = '<h3 style="margin-bottom:0.8rem;">⚠️ 待提升维度</h3>';
      weaknesses.forEach(function(w) {
        var pct = Math.max(5, w.avgScore);
        html += '<div class="weakness-dim">' +
          '<span class="weakness-dim-label">' + (emojiMap[w.key] || '') + ' ' + w.label + '</span>' +
          '<div class="weakness-dim-bar"><div class="weakness-dim-fill" style="width:' + pct + '%;"></div></div>' +
          '<span class="weakness-dim-score">' + w.avgScore + '分</span>' +
          '</div>';
      });
      html += '<p style="font-size:0.75rem;color:var(--muted);margin-top:0.5rem;">💡 去「专项训练」使用「智能推荐」针对性练习</p>';

      card.innerHTML = html;
      var statsEl = document.getElementById('dash-stats');
      if (statsEl) {
        statsEl.parentNode.insertBefore(card, statsEl.nextSibling);
      } else {
        container.appendChild(card);
      }
    } catch(e) { /* ignore */ }
  }

  

// ============================================================
// P1: Custom Question Management
// ============================================================
(function() {
  var customPanel = document.getElementById('custom-question-panel');
  if (!customPanel) return;

  customPanel.addEventListener('toggle', function() {
    if (customPanel.open) loadCustomQuestionList();
  });

  document.getElementById('btn-custom-q-add').addEventListener('click', async function() {
    var text = document.getElementById('custom-q-text').value.trim();
    var type = document.getElementById('custom-q-type').value;
    if (!text) { toast('请输入题目内容'); return; }
    try {
      await fetchRetry('/api/custom-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text, type: type })
      });
      document.getElementById('custom-q-text').value = '';
      toast('题目已添加');
      loadCustomQuestionList();
      if (typeof renderDrillQuestions === 'function') renderDrillQuestions();
      if (typeof renderPracticeQuestions === 'function') renderPracticeQuestions();
    } catch(e) { toast('添加失败: ' + e.message); }
  });

  async function loadCustomQuestionList() {
    var el = document.getElementById('custom-q-list');
    try {
      var data = await fetchRetry('/api/custom-questions').then(function(r) { return r.json(); });
      var qs = data.questions || [];
      if (qs.length === 0) {
        el.innerHTML = '<p style=\"color:var(--muted);\">暂无自定义题目，在上方添加</p>';
        return;
      }
      el.innerHTML = qs.map(function(q) {
        return '<div class=\"custom-q-item\">' +
          '<span style=\"flex:1;\">[' + (q.type || '') + '] ' + (q.question || '') + '</span>' +
          '<button class=\"custom-q-del\" data-id=\"' + q.id + '\">x</button>' +
          '</div>';
      }).join('');
      el.querySelectorAll('.custom-q-del').forEach(function(btn) {
        btn.addEventListener('click', async function(e) {
          e.stopPropagation();
          var id = btn.dataset.id;
          try {
            await fetchRetry('/api/custom-questions/' + id, { method: 'DELETE' });
            loadCustomQuestionList();
            if (typeof renderDrillQuestions === 'function') renderDrillQuestions();
            if (typeof renderPracticeQuestions === 'function') renderPracticeQuestions();
          } catch(e) { toast('删除失败'); }
        });
      });
    } catch(e) { el.innerHTML = '<p style=\"color:var(--red);\">加载失败</p>'; }
  }

  // Load custom questions eagerly into state for sync access
  (async function() {
    try {
      var data = await fetchRetry('/api/custom-questions').then(function(r) { return r.json(); });
      state._customQuestions = (data.questions || []).map(function(q) {
        return {
          question: q.question,
          type: q.type || '自定义',
          category: q.category || '',
          examiner_intent: q.examiner_intent || '',
          difficulty: q.difficulty || '中等',
          _source: '自定义'
        };
      });
    } catch(e) { state._customQuestions = []; }
  })();

  // Patch getAllDrillQuestions to include custom questions (sync, not async)
  if (typeof getAllDrillQuestions === 'function') {
    var _origGetAllDrill = getAllDrillQuestions;
    getAllDrillQuestions = function() {
      var all = _origGetAllDrill();
      if (state._customQuestions && state._customQuestions.length > 0) {
        all = all.concat(state._customQuestions);
      }
      return all;
    };
  }
})();

// ============================================================
// P2: Review Cards (Flashcard)
// ============================================================
(function() {
  var reviewCards = [];
  var reviewIndex = 0;
  var reviewCard = document.getElementById('review-card');
  var reviewSection = document.getElementById('review-cards-section');

  async function loadReviewCards() {
    try {
      var data = await fetchRetry('/api/review/cards').then(function(r) { return r.json(); });
      reviewCards = data.cards || [];
      if (reviewCards.length === 0) {
        if (reviewSection) reviewSection.style.display = 'none';
        return;
      }
      if (reviewSection) reviewSection.style.display = 'block';
      reviewIndex = 0;
      renderReviewCard();
    } catch(e) {
      if (reviewSection) reviewSection.style.display = 'none';
    }
  }

  function renderReviewCard() {
    if (!reviewCard || reviewCards.length === 0) return;
    var card = reviewCards[reviewIndex];
    var indexEl = document.getElementById('review-card-index');
    if (indexEl) indexEl.textContent = (reviewIndex + 1) + '/' + reviewCards.length;

    document.getElementById('review-card-type').textContent = card.questionType || '题目';
    document.getElementById('review-card-question').textContent = card.question || '';

    var sc = card.latestScores || {};
    var dimLabels = { star_completeness: 'STAR', quantification: '量化', position_match: '匹配', structure: '结构', highlight: '亮点' };
    var scoresHtml = Object.keys(dimLabels).map(function(k) {
      var v = sc[k] || 0;
      var cls = v < 60 ? ' weak' : '';
      return '<span class=\"review-score-item' + cls + '\">' + dimLabels[k] + ': ' + v + '</span>';
    }).join('');
    document.getElementById('review-card-scores').innerHTML = scoresHtml;
    document.getElementById('review-card-improved').innerHTML = '<strong>改进参考：</strong><br>' + (card.latestImproved || '暂无');
    var takeaways = card.latestTakeaways || [];
    document.getElementById('review-card-takeaways').innerHTML = takeaways.length > 0 ?
      '<strong>关键改进点：</strong><ul>' + takeaways.map(function(t) { return '<li>' + t + '</li>'; }).join('') + '</ul>' :
      '<strong>关键改进点：</strong>暂无';
  }

  if (reviewCard) {
    reviewCard.addEventListener('click', function() {
      reviewCard.classList.toggle('flipped');
    });
  }

  document.getElementById('btn-review-prev').addEventListener('click', function(e) {
    e.stopPropagation();
    if (reviewCards.length === 0) return;
    reviewIndex = (reviewIndex - 1 + reviewCards.length) % reviewCards.length;
    if (reviewCard) reviewCard.classList.remove('flipped');
    renderReviewCard();
  });

  document.getElementById('btn-review-next').addEventListener('click', function(e) {
    e.stopPropagation();
    if (reviewCards.length === 0) return;
    reviewIndex = (reviewIndex + 1) % reviewCards.length;
    if (reviewCard) reviewCard.classList.remove('flipped');
    renderReviewCard();
  });

  if (typeof loadDashboard === 'function') {
    var _origLoadDashboard2 = loadDashboard;
    loadDashboard = async function() {
      await _origLoadDashboard2();
      loadReviewCards();
      loadStudyPlan();
    };
  }
})();

// ============================================================
// P2: Study Plan
// ============================================================
(function() {
  async function loadStudyPlan() {
    try {
      var data = await fetchRetry('/api/study-plan').then(function(r) { return r.json(); });
      var plan = data.plan || {};
      var empty = document.getElementById('study-plan-empty');
      var active = document.getElementById('study-plan-active');

      if (!plan.targetDate) {
        if (empty) empty.style.display = 'block';
        if (active) active.style.display = 'none';
        return;
      }

      if (empty) empty.style.display = 'none';
      if (active) active.style.display = 'block';

      var days = data.daysRemaining || 0;
      document.getElementById('study-countdown').textContent = days + '天';
      document.getElementById('study-streak').textContent = data.streak || 0;
      document.getElementById('study-today').textContent = (data.todayCount || 0) + '/' + (data.todayGoal || 5);

      var pct = Math.min(100, data.progress || 0);
      document.getElementById('study-progress-fill').style.width = pct + '%';
      document.getElementById('study-progress-text').textContent = '总进度 ' + pct + '%';

      document.getElementById('study-target-date').value = plan.targetDate ? plan.targetDate.slice(0, 10) : '';
      document.getElementById('study-daily-goal').value = plan.dailyGoal || 5;
    } catch(e) { /* ignore */ }
  }
  window.loadStudyPlan = loadStudyPlan; // 导出到全局

  document.getElementById('btn-study-plan-save').addEventListener('click', async function() {
    var targetDate = document.getElementById('study-target-date').value;
    var dailyGoal = parseInt(document.getElementById('study-daily-goal').value) || 5;
    if (!targetDate) { toast('请选择目标面试日期'); return; }
    try {
      await fetchRetry('/api/study-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetDate: targetDate, dailyGoal: dailyGoal })
      });
      toast('计划已保存');
      loadStudyPlan();
    } catch(e) { toast('保存失败: ' + e.message); }
  });

  document.getElementById('btn-study-plan-edit').addEventListener('click', function() {
    var empty = document.getElementById('study-plan-empty');
    var active = document.getElementById('study-plan-active');
    if (empty) empty.style.display = 'block';
    if (active) active.style.display = 'none';
  });

})();

// ============================================================
// Phase 1: Keyboard Shortcuts
// ============================================================
(function initKeyboardShortcuts() {
  var shortcuts = {
    ' ': function() { var btn = document.getElementById('btn-pause'); if (btn && btn.offsetParent) btn.click(); },
    '1': function() { var el = document.getElementById('score-1'); if (el && el.offsetParent) el.click(); },
    '2': function() { var el = document.getElementById('score-2'); if (el && el.offsetParent) el.click(); },
    '3': function() { var el = document.getElementById('score-3'); if (el && el.offsetParent) el.click(); },
    '4': function() { var el = document.getElementById('score-4'); if (el && el.offsetParent) el.click(); },
    '5': function() { var el = document.getElementById('score-5'); if (el && el.offsetParent) el.click(); },
    'Enter': function() { var btn = document.getElementById('btn-submit-answer'); if (btn && !btn.disabled) btn.click(); },
    'Escape': function() {
      var modal = document.querySelector('.modal-overlay.show');
      if (modal) { var close = modal.querySelector('.modal-close'); if (close) close.click(); else modal.remove(); }
    }
  };
  document.addEventListener('keydown', function(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    var handler = shortcuts[e.key];
    if (handler) { e.preventDefault(); handler(); }
  });
  function updateShortcutHints() {
    var existing = document.getElementById('shortcut-hints');
    if (existing) existing.remove();
    var isPractice = document.getElementById('tab-practice') && document.getElementById('tab-practice').classList.contains('active');
    var isInterview = document.getElementById('tab-interview') && document.getElementById('tab-interview').classList.contains('active');
    if (isPractice || isInterview) {
      var hints = document.createElement('div');
      hints.id = 'shortcut-hints';
      hints.style.cssText = 'position:fixed;bottom:12px;right:12px;display:flex;gap:6px;flex-wrap:wrap;z-index:100;pointer-events:none;';
      hints.innerHTML = '<span class="shortcut-tag">Space \u6682\u505C</span><span class="shortcut-tag">1-5 \u8BC4\u5206</span><span class="shortcut-tag">Enter \u63D0\u4EA4</span><span class="shortcut-tag">Esc \u5173\u95ED</span>';
      document.body.appendChild(hints);
    }
  }
  var observer = new MutationObserver(updateShortcutHints);
  document.querySelectorAll('.tab-content').forEach(function(el) { observer.observe(el, { attributes: true, attributeFilter: ['class'] }); });
  updateShortcutHints();
})();

// ============================================================
// Phase 1: Auto Theme
// ============================================================
(function initAutoTheme() {
  var setting = localStorage.getItem('autoTheme');
  if (setting === 'off') return;
  function applyAutoTheme() {
    var hour = new Date().getHours();
    var isDark = hour < 6 || hour >= 18;
    var currentIsDark = document.documentElement.classList.contains('dark');
    if (isDark !== currentIsDark) {
      document.documentElement.classList.toggle('dark', isDark);
      var moonBtn = document.getElementById('btn-toggle-theme');
      if (moonBtn) moonBtn.textContent = isDark ? '\u2600' : '\uD83C\uDF19';
    }
  }
  applyAutoTheme();
  setInterval(applyAutoTheme, 3600000);
  var moonBtn = document.getElementById('btn-toggle-theme');
  if (moonBtn) {
    moonBtn.addEventListener('click', function() {
      localStorage.setItem('autoTheme', 'off');
      setTimeout(function() { localStorage.removeItem('autoTheme'); }, 3600000);
    });
  }
})();

// ============================================================
// Phase 1: Readiness Score
// ============================================================
async function loadReadinessScore() {
  try {
    var resp = await fetch(API + '/dashboard/readiness-score');
    if (!resp.ok) return;
    var data = await resp.json();
    var scoreEl = document.getElementById('readiness-score');
    var levelEl = document.getElementById('readiness-level');
    if (scoreEl) scoreEl.textContent = data.overall;
    if (levelEl) {
      levelEl.textContent = data.level === 'ready' ? 'ready' : data.level === 'approaching' ? 'approaching' : 'need work';
      levelEl.style.color = data.level === 'ready' ? 'var(--green)' : data.level === 'approaching' ? 'var(--accent)' : 'var(--red)';
    }
    var dims = data.dimensions;
    var dimNames = { practice_volume: '\u7EC3\u4E60\u91CF', score_quality: '\u5F97\u5206\u8D28\u91CF', consistency: '\u8FDE\u7EED\u6027', breadth: '\u5E7F\u5EA6', mock_experience: '\u6A21\u62DF\u7ECF\u9A8C', improvement: '\u8FDB\u6B65\u8D8B\u52BF' };
    var dimHTML = '';
    Object.entries(dims).forEach(function(entry) {
      var key = entry[0], val = entry[1];
      var color = val >= 80 ? 'var(--green)' : val >= 50 ? 'var(--accent)' : 'var(--red)';
      dimHTML += '<div style="margin-bottom:4px;"><span style="font-size:0.72rem;color:var(--muted);">' + (dimNames[key]||key) + '</span><div style="background:var(--rule);border-radius:3px;height:6px;margin-top:2px;"><div style="background:' + color + ';border-radius:3px;height:100%;width:' + val + '%;transition:width 0.8s ease;"></div></div></div>';
    });
    var dimEl = document.getElementById('readiness-dimensions');
    if (dimEl) dimEl.innerHTML = dimHTML;
    var sugHTML = '';
    (data.suggestions || []).slice(0, 3).forEach(function(s) { sugHTML += '<div style="font-size:0.76rem;color:var(--muted);margin-bottom:3px;">\uD83D\uDCA1 ' + escapeHtml(s) + '</div>'; });
    var sugEl = document.getElementById('readiness-suggestions');
    if (sugEl) sugEl.innerHTML = sugHTML || '<div style="font-size:0.76rem;color:var(--muted);">\u6682\u65E0\u5EFA\u8BAE</div>';
  } catch (e) { console.warn('Readiness score load failed:', e); }
}

// ============================================================
// Phase 1: Comparison View
// ============================================================
function showComparisonView(question, userAnswer, modelAnswer, feedback) {
  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay show';
  overlay.innerHTML = '<div class="modal-card" style="max-width:900px;max-height:85vh;overflow-y:auto;">' +
    '<div class="modal-header"><h3>\u56DE\u7B54\u5BF9\u6BD4\u5206\u6790</h3><button class="modal-close" onclick="this.closest(\'.modal-overlay\').remove()">\u2715</button></div>' +
    '<div class="modal-body" style="padding:1rem;">' +
    '<div style="background:var(--bg);border-radius:8px;padding:0.8rem;margin-bottom:1rem;"><strong>\u9898\u76EE: </strong>' + escapeHtml(question) + '</div>' +
    (feedback ? '<div style="background:rgba(200,135,43,0.06);border-radius:8px;padding:0.8rem;margin-bottom:1rem;font-size:0.82rem;"><strong>AI \u70B9\u8BC4: </strong>' + escapeHtml(feedback) + '</div>' : '') +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">' +
    '<div><h4 style="color:var(--muted);margin-bottom:0.5rem;">\u4F60\u7684\u56DE\u7B54</h4><div style="background:var(--bg);border:1px solid var(--rule);border-radius:8px;padding:0.8rem;font-size:0.82rem;line-height:1.7;white-space:pre-line;min-height:100px;">' + escapeHtml(userAnswer || '(\u672A\u4F5C\u7B54)') + '</div></div>' +
    '<div><h4 style="color:var(--accent);margin-bottom:0.5rem;">AI \u6807\u51C6\u7B54\u6848</h4><div style="background:rgba(200,135,43,0.04);border:1px solid rgba(200,135,43,0.15);border-radius:8px;padding:0.8rem;font-size:0.82rem;line-height:1.7;white-space:pre-line;min-height:100px;">' + escapeHtml(modelAnswer || '(\u6682\u65E0)') + '</div></div>' +
    '</div></div></div>';
  document.body.appendChild(overlay);
  overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
}

// ============================================================
// Phase 2: Batch Questions
// ============================================================
async function generateBatchQuestions(jdText, resumeText) {
  var btn = document.createElement('button');
  btn.textContent = '\u6279\u91CF\u751F\u621015\u9898';
  btn.className = 'btn-primary';
  btn.style.cssText = 'margin-top:0.5rem;';
  btn.onclick = async function() {
    btn.disabled = true;
    btn.textContent = '\u751F\u6210\u4E2D...';
    try {
      var resp = await fetch(API + '/generate-questions-batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jdText: jdText, resumeText: resumeText, count: 15 }) });
      var data = await resp.json();
      if (data.questions && data.questions.length) {
        renderBatchResults(data.questions);
        btn.textContent = '\u5DF2\u5B8C\u6210 ' + data.total + ' \u9898';
      } else { btn.textContent = '\u5931\u8D25\uFF0C\u91CD\u8BD5'; }
    } catch (e) { btn.textContent = '\u7F51\u7EDC\u9519\u8BEF'; }
    btn.disabled = false;
  };
  return btn;
}
function renderBatchResults(questions) {
  var byType = {};
  questions.forEach(function(q) { var t = q._type || '\u5176\u4ED6'; if (!byType[t]) byType[t] = []; byType[t].push(q); });
  var html = '<div class="card" style="margin-top:1rem;"><h3>\u6279\u91CF\u751F\u6210\u7ED3\u679C</h3>';
  Object.entries(byType).forEach(function(entry) {
    var type = entry[0], qs = entry[1];
    html += '<h4 style="margin-top:0.8rem;">' + type + ' (' + qs.length + ' \u9898)</h4>';
    qs.forEach(function(q, i) {
      html += '<div style="background:var(--bg);border-radius:6px;padding:0.6rem;margin-bottom:0.4rem;"><div style="font-weight:600;font-size:0.82rem;">' + (i+1) + '. ' + escapeHtml(q.question) + '</div><div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.3rem;font-size:0.72rem;color:var(--muted);"><span>\u96BE\u5EA6: ' + (q.difficulty||'\u4E2D\u7B49') + '</span><span>\u610F\u56FE: ' + (q.examiner_intent||'--') + '</span></div></div>';
    });
  });
  html += '</div>';
  var container = document.getElementById('batch-questions-container');
  if (container) container.innerHTML = html;
}

// ============================================================
// Phase 2: WrongBook
// ============================================================
async function loadWrongBook() {
  var minScore = (document.getElementById('wrongbook-score-filter') ? document.getElementById('wrongbook-score-filter').value : '60');
  var type = (document.getElementById('wrongbook-type-filter') ? document.getElementById('wrongbook-type-filter').value : '');
  try {
    var resp = await fetch(API + '/drill/wrong-answers?min_score=' + minScore + (type ? '&type=' + encodeURIComponent(type) : ''));
    if (!resp.ok) return;
    var data = await resp.json();
    var statsEl = document.getElementById('wrongbook-stats');
    if (statsEl) {
      statsEl.innerHTML = '<div style="display:flex;gap:1rem;flex-wrap:wrap;">' +
        '<div class="card" style="flex:1;min-width:120px;text-align:center;"><div style="font-size:2rem;font-weight:700;color:var(--red);">' + data.stats.wrong_count + '</div><div style="font-size:0.78rem;color:var(--muted);">\u9519\u9898</div></div>' +
        '<div class="card" style="flex:1;min-width:120px;text-align:center;"><div style="font-size:2rem;font-weight:700;color:var(--green);">' + data.stats.improvement_rate + '%</div><div style="font-size:0.78rem;color:var(--muted);">\u8FDB\u6B65\u7387</div></div>' +
        '<div class="card" style="flex:1;min-width:120px;text-align:center;"><div style="font-size:2rem;font-weight:700;color:var(--accent);">' + data.stats.total_practice + '</div><div style="font-size:0.78rem;color:var(--muted);">\u603B\u7EC3\u4E60</div></div></div>';
    }
    var typeFilter = document.getElementById('wrongbook-type-filter');
    if (typeFilter) typeFilter.innerHTML = '<option value="">\u5168\u90E8\u9898\u578B</option>' + (data.all_types || []).map(function(t) { return '<option value="' + t + '">' + t + '</option>'; }).join('');
    var listHTML = '';
    (data.wrong || []).forEach(function(q, i) {
      var color = q.bestScore < 40 ? 'var(--red)' : q.bestScore < 60 ? 'var(--accent)' : 'var(--green)';
      listHTML += '<div class="card" style="margin-bottom:0.6rem;"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem;"><div style="flex:1;"><div style="font-weight:600;font-size:0.85rem;">' + (i+1) + '. ' + escapeHtml(q.question) + '</div><div style="display:flex;gap:0.5rem;margin-top:0.3rem;flex-wrap:wrap;"><span style="font-size:0.72rem;background:rgba(200,135,43,0.1);color:var(--accent);padding:0.1rem 0.4rem;border-radius:3px;">' + q.questionType + '</span><span style="font-size:0.72rem;color:' + color + ';font-weight:600;">\u6700\u4F73: ' + q.bestScore + '</span><span style="font-size:0.72rem;color:var(--muted);">\u5C1D\u8BD5: ' + q.attempts.length + ' \u6B21</span></div></div><button class="btn-ai-action btn-ai-followup" onclick="redoWrongQuestion(\'' + escapeHtml(q.question).replace(/'/g, "\\'") + '\')" style="flex-shrink:0;">\u91CD\u505A</button></div></div>';
    });
    var listEl = document.getElementById('wrongbook-list');
    if (listEl) listEl.innerHTML = listHTML || '<p style="color:var(--muted);text-align:center;padding:2rem;">\u6CA1\u6709\u9519\u9898\uFF01</p>';
  } catch (e) { console.warn('Wrong book load failed:', e); }
}
function redoWrongQuestion(question) {
  switchTab('practice');
  setTimeout(function() { var input = document.getElementById('practice-question'); if (input) input.value = question; }, 300);
}

// ============================================================
// Phase 2: JD URL Parse
// ============================================================
(function initJdUrlParse() {
  var btn = document.getElementById('btn-jd-fetch');
  if (!btn) return;
  btn.addEventListener('click', async function() {
    var url = (document.getElementById('jd-url-input') ? document.getElementById('jd-url-input').value : '').trim();
    if (!url) { toast('\u8BF7\u8F93\u5165URL'); return; }
    btn.disabled = true;
    btn.textContent = '\u89E3\u6790\u4E2D...';
    try {
      var resp = await fetch(API + '/parse-jd-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url }) });
      var data = await resp.json();
      // 优先使用 jd_text 判断是否成功（LLM 有时会同时返回 error 提示和有效数据）
      if (data.jd_text && data.jd_text.length > 20) {
        var jdInput = document.getElementById('jd-input');
        if (jdInput) jdInput.value = data.jd_text;
        toast('\u5DF2\u89E3\u6790: ' + (data.company || '') + ' ' + (data.position || ''));
      } else if (data.error && !data.jd_text) {
        toast('\u89E3\u6790\u5931\u8D25: ' + data.error);
      } else {
        toast('\u65E0\u6CD5\u8BC6\u522BJD\uFF0C\u8BF7\u624B\u52A8\u7C98\u8D34');
      }
    } catch (e) { toast('\u7F51\u7EDC\u9519\u8BEF: ' + e.message); }
    btn.disabled = false;
    btn.textContent = '\u89E3\u6790\u94FE\u63A5';
  });
})();

// ============================================================
// Phase 3: Voice Input (Web Speech API)
// ============================================================
var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
var recognition = null;
var currentVoiceTarget = null;

function initSpeechRecognition() {
  if (!SpeechRecognition) { console.warn('\u6D4F\u89C8\u5668\u4E0D\u652F\u6301\u8BED\u97F3\u8BC6\u522B'); return; }
  recognition = new SpeechRecognition();
  recognition.lang = 'zh-CN';
  recognition.interimResults = true;
  recognition.continuous = false;
  
  recognition.onresult = function(event) {
    var final = '', interim = '';
    for (var i = 0; i < event.results.length; i++) {
      if (event.results[i].isFinal) final += event.results[i][0].transcript;
      else interim += event.results[i][0].transcript;
    }
    if (currentVoiceTarget) {
      currentVoiceTarget.value = (currentVoiceTarget.dataset.origValue || '') + final;
      if (interim) currentVoiceTarget.placeholder = '\u8BC6\u522B\u4E2D: ' + interim;
    }
  };
  
  recognition.onend = function() {
    if (currentVoiceTarget) {
      var btn = document.querySelector('[data-voice-target=\"' + currentVoiceTarget.id + '\"]');
      if (btn) btn.textContent = '\uD83C\uDFA4';
    }
  };
  
  recognition.onerror = function() {
    if (currentVoiceTarget) {
      var btn = document.querySelector('[data-voice-target=\"' + currentVoiceTarget.id + '\"]');
      if (btn) btn.textContent = '\uD83C\uDFA4';
    }
    currentVoiceTarget = null;
  };
}

function startVoiceInput(targetId) {
  if (!recognition) { alert('\u60A8\u7684\u6D4F\u89C8\u5668\u4E0D\u652F\u6301\u8BED\u97F3\u8BC6\u522B\uFF0C\u8BF7\u4F7F\u7528Chrome/Edge'); return; }
  var el = document.getElementById(targetId);
  if (!el) return;
  currentVoiceTarget = el;
  el.dataset.origValue = el.value;
  var btn = document.querySelector('[data-voice-target=\"' + targetId + '\"]');
  if (btn) btn.textContent = '\uD83D\uDD34';
  try { recognition.start(); } catch(e) {}
}

// Global binding: all .btn-mic click triggers voice input
document.addEventListener('click', function(e) {
  var btn = e.target.closest('.btn-mic');
  if (!btn) return;
  var targetId = btn.dataset.voiceTarget;
  if (targetId) startVoiceInput(targetId);
});

// Initialize voice recognition on load
initSpeechRecognition();

// ============================================================
// Phase 3: TTS (SpeechSynthesis)
// ============================================================
function speakText(text, btn) {
  if (!window.speechSynthesis) { alert('\u6D4F\u89C8\u5668\u4E0D\u652F\u6301\u8BED\u97F3\u6717\u8BFB'); return; }
  window.speechSynthesis.cancel();
  var utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'zh-CN';
  utter.rate = 1.0;
  utter.pitch = 1.0;
  // Select Chinese voice
  var voices = window.speechSynthesis.getVoices();
  var zhVoice = voices.find(function(v) { return v.lang.startsWith('zh'); });
  if (zhVoice) utter.voice = zhVoice;

  utter.onstart = function() {
    if (btn) {
      btn.textContent = '🔴';
      btn.dataset.speaking = '1';
      btn.title = '点击停止朗读';
    }
  };
  utter.onend = function() {
    if (btn) {
      btn.textContent = '🔊';
      btn.dataset.speaking = '0';
      btn.title = '朗读';
    }
  };
  utter.onerror = function() {
    if (btn) {
      btn.textContent = '🔊';
      btn.dataset.speaking = '0';
      btn.title = '朗读';
    }
  };
  window.speechSynthesis.speak(utter);
}

function stopSpeaking() {
  window.speechSynthesis.cancel();
  // 重置所有朗读按钮状态
  document.querySelectorAll('.btn-speak').forEach(function(b) {
    b.textContent = '🔊';
    b.dataset.speaking = '0';
    b.title = '朗读';
  });
}

// Global binding: all .btn-speak click reads data-text content
document.addEventListener('click', function(e) {
  var btn = e.target.closest('.btn-speak');
  if (!btn) return;
  // 如果正在朗读，点击则停止
  if (btn.dataset.speaking === '1') {
    stopSpeaking();
    return;
  }
  var text = btn.dataset.text;
  if (text) speakText(text, btn);
});

// ============================================================
// Phase 3: Group Interview (群面模拟)
// ============================================================
var groupSession = null;
var groupTimer = null;

function getCurrentSession() {
  return { sessionId: state.sessionId, analysis: state.analysis };
}

async function startGroupInterview() {
  var session = getCurrentSession();
  if (!session || !session.analysis) { alert('\u8BF7\u5148\u5728\u201C\u5206\u6790&\u62BC\u9898\u201D\u4E2D\u5B8C\u6210JD\u5206\u6790'); return; }
  
  try {
    var resp = await fetchRetry('/api/group-interview/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jdParsed: session.analysis.jdParsed, resumeParsed: session.analysis.resumeParsed })
    });
    var data = await resp.json();
    if (data.error) { alert(data.error); return; }
    
    groupSession = data;
    renderGroupTopic(data.topic);
    document.getElementById('group-start-card').style.display = 'none';
    document.getElementById('group-discussion-card').style.display = '';
    document.getElementById('group-discussion-log').innerHTML = '';
    
    // Add interviewer opening
    addGroupMessage('\u9762\u8BD5\u5B98', '\u9762\u8BD5\u5B98', '\u9898\u76EE\uFF1A' + data.topic.topic + '\n\n\u80CC\u666F\uFF1A' + data.topic.background + '\n\n\u8BF7\u5404\u4F4D\u5019\u9009\u4EBA\u75282\u5206\u949F\u65F6\u95F4\u601D\u8003\uFF0C\u7136\u540E\u81EA\u7531\u8BA8\u8BBA\u3002\u8BA8\u8BBA\u65F6\u95F415\u5206\u949F\u3002');
    startGroupTimer(900); // 15 min
  } catch(e) { alert('\u542F\u52A8\u7FA4\u9762\u5931\u8D25: ' + e.message); }
}

function addGroupMessage(speaker, role, message) {
  var log = document.getElementById('group-discussion-log');
  var isUser = speaker === '\u6211';
  var div = document.createElement('div');
  div.className = 'group-msg' + (isUser ? ' group-msg-user' : '');
  div.innerHTML = 
    '<div class=\"group-msg-header\">' +
    '<span class=\"group-msg-speaker\" style=\"color:' + getGroupRoleColor(role) + '\">' + speaker + '</span>' +
    '<span class=\"group-msg-role\">' + role + '</span>' +
    '</div>' +
    '<div class=\"group-msg-body\">' + escapeHtml(message) + '</div>' +
    (!isUser ? '<button class=\"btn-speak\" data-text=\"' + escapeHtml(message).replace(/\"/g, '&quot;') + '\" style=\"width:24px;height:24px;font-size:0.7rem;margin-top:0.3rem;\">\uD83D\uDD0A</button>' : '');
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function getGroupRoleColor(role) {
  if (role === '\u9762\u8BD5\u5B98') return '#6366f1';
  if (role === '\u6FC0\u8FDB\u578B') return '#ef4444';
  if (role === '\u534F\u4F5C\u578B') return '#22c55e';
  if (role === '\u5206\u6790\u578B') return '#3b82f6';
  return 'var(--accent)';
}

async function submitGroupMessage() {
  var input = document.getElementById('group-input');
  var msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  
  addGroupMessage('\u6211', '\u5019\u9009\u4EBA', msg);
  
  try {
    var resp = await fetchRetry('/api/group-interview/respond', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg })
    });
    var data = await resp.json();
    if (data.error) { alert(data.error); return; }
    addGroupMessage(data.speaker, data.role, data.message);
  } catch(e) { alert('\u53D1\u8A00\u5931\u8D25: ' + e.message); }
}

async function endGroupInterview() {
  clearInterval(groupTimer);
  try {
    var resp = await fetchRetry('/api/group-interview/evaluate', { method: 'POST' });
    var data = await resp.json();
    document.getElementById('group-discussion-card').style.display = 'none';
    document.getElementById('group-report-card').style.display = '';
    renderGroupReport(data);
  } catch(e) { alert('\u8BC4\u4F30\u5931\u8D25: ' + e.message); }
}

function renderGroupTopic(topic) {
  var info = document.getElementById('group-topic-info');
  info.style.display = '';
  info.innerHTML = 
    '<div style=\"background:var(--tag-bg);padding:0.8rem;border-radius:var(--radius-sm);\">' +
    '<strong>' + escapeHtml(topic.topic) + '</strong>' +
    '<p style=\"margin:0.5rem 0 0;color:var(--muted);\">' + escapeHtml(topic.background) + '</p>' +
    '<span style=\"font-size:0.75rem;color:var(--accent);\">\u9898\u578B\uFF1A' + escapeHtml(topic.type) + '</span>' +
    '</div>';
}

function renderGroupReport(report) {
  var content = document.getElementById('group-report-content');
  var dimsHTML = (report.dimensions || []).map(function(d) {
    return '<div style=\"margin-bottom:0.8rem;\">' +
      '<div style=\"display:flex;justify-content:space-between;\">' +
      '<span>' + d.name + '</span><span style=\"color:var(--accent);\">' + d.score + '/100</span>' +
      '</div>' +
      '<div style=\"background:var(--rule);height:6px;border-radius:3px;margin-top:0.3rem;\">' +
      '<div style=\"background:var(--accent);height:100%;border-radius:3px;width:' + d.score + '%;\"></div>' +
      '</div>' +
      '<div style=\"font-size:0.8rem;color:var(--muted);\">' + d.comment + '</div>' +
      '</div>';
  }).join('');
  content.innerHTML = 
    '<div style=\"text-align:center;margin-bottom:1rem;\">' +
    '<div style=\"font-size:3rem;font-weight:700;color:var(--accent);\">' + report.overall_score + '</div>' +
    '<div style=\"color:var(--muted);\">\u7EFC\u5408\u8BC4\u5206</div>' +
    '</div>' +
    dimsHTML +
    '<div style=\"margin-top:1rem;\">' +
    '<strong>\uD83D\uDCAA \u4F18\u52BF</strong><ul>' + (report.strengths || []).map(function(s) { return '<li>' + escapeHtml(s) + '</li>'; }).join('') + '</ul>' +
    '<strong>\uD83D\uDD27 \u5F85\u6539\u8FDB</strong><ul>' + (report.weaknesses || []).map(function(w) { return '<li>' + escapeHtml(w) + '</li>'; }).join('') + '</ul>' +
    '<strong>\uD83D\uDCA1 \u5EFA\u8BAE</strong><ul>' + (report.suggestions || []).map(function(s) { return '<li>' + escapeHtml(s) + '</li>'; }).join('') + '</ul>' +
    '</div>' +
    '<div style=\"margin-top:1rem;padding:0.8rem;background:var(--tag-bg);border-radius:var(--radius-sm);\">' +
    '<strong>\u89D2\u8272\u5206\u6790\uFF1A</strong>' + escapeHtml(report.role_analysis || '') +
    '</div>';
}

function startGroupTimer(seconds) {
  clearInterval(groupTimer);
  var remaining = seconds;
  updateGroupTimer(remaining);
  groupTimer = setInterval(function() {
    remaining--;
    updateGroupTimer(remaining);
    if (remaining <= 0) { clearInterval(groupTimer); endGroupInterview(); }
  }, 1000);
}

function updateGroupTimer(seconds) {
  var m = Math.floor(seconds / 60);
  var s = seconds % 60;
  document.getElementById('group-timer').textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

// Group interview knowledge base (iframe embed Feishu wiki)
function showGroupKnowledgeBase() {
  var content = document.getElementById('group-kb-content');
  if (content.style.display === 'none') {
    content.style.display = '';
    content.innerHTML = '<iframe src=\"/group-kb-embed.html\" style=\"width:100%;height:600px;border:none;border-radius:var(--radius-sm);\"></iframe>';
  } else {
    content.style.display = 'none';
  }
}

// (removed renderGroupKB and renderKBSection - replaced by iframe embed)
function _unused_renderGroupKB(kb, container) {
  var html = '<div style=\"display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:1rem;\">';
  var sections = ['overview', 'interview_flow', 'roles', 'question_types', 'evaluation_criteria', 'speech_templates', 'classic_cases', 'common_mistakes', 'preparation_checklist'];
  var labels = ['\u6982\u8FF0', '\u9762\u8BD5\u6D41\u7A0B', '\u89D2\u8272\u7B56\u7565', '\u9898\u578B\u5206\u7C7B', '\u8BC4\u5206\u6807\u51C6', '\u8BDD\u672F\u6A21\u677F', '\u7ECF\u5178\u6848\u4F8B', '\u5E38\u89C1\u9519\u8BEF', '\u51C6\u5907\u6E05\u5355'];
  sections.forEach(function(s, i) {
    html += '<button class=\"btn-outline btn-sm kb-tab-btn\" data-kb-section=\"' + s + '\">' + labels[i] + '</button>';
  });
  html += '</div><div id=\"group-kb-detail\"></div>';
  container.innerHTML = html;
  
  document.querySelectorAll('.kb-tab-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var section = btn.dataset.kbSection;
      var detail = document.getElementById('group-kb-detail');
      detail.innerHTML = renderKBSection(kb, section);
    });
  });
  // Default: show overview
  document.getElementById('group-kb-detail').innerHTML = renderKBSection(kb, 'overview');
}

function _unused_renderKBSection(kb, section) {
  var data = kb[section];
  if (!data) return '<p>\u6682\u65E0\u5185\u5BB9</p>';
  
  if (section === 'overview') {
    return '<div style=\"line-height:1.8;\">' +
      '<p><strong>\u5B9A\u4E49\uFF1A</strong>' + data.definition + '</p>' +
      '<p><strong>\u76EE\u7684\uFF1A</strong>' + data.purpose + '</p>' +
      '<p><strong>\u5F62\u5F0F\uFF1A</strong>' + data.typical_format + '</p>' +
      '<p><strong>\u901A\u8FC7\u7387\uFF1A</strong>' + data.pass_rate + '</p>' +
      '<p style=\"color:var(--accent);\"><strong>\u6838\u5FC3\u6D1E\u5BDF\uFF1A</strong>' + data.key_insight + '</p>' +
      '</div>';
  }
  
  if (section === 'interview_flow') {
    return data.stages.map(function(s) {
      return '<div style=\"margin-bottom:1rem;padding:0.8rem;background:var(--tag-bg);border-radius:var(--radius-sm);\">' +
        '<strong>' + s.name + '</strong> <span style=\"color:var(--muted);\">(' + s.duration + ')</span>' +
        '<p style=\"margin:0.3rem 0;\">' + s.description + '</p>' +
        '<ul>' + s.tips.map(function(t) { return '<li>' + t + '</li>'; }).join('') + '</ul>' +
        '</div>';
    }).join('');
  }
  
  if (section === 'roles') {
    return '<p style=\"margin-bottom:0.8rem;\">' + data.description + '</p>' +
      data.roles.map(function(r) {
        return '<div style=\"margin-bottom:0.8rem;padding:0.8rem;background:var(--tag-bg);border-radius:var(--radius-sm);\">' +
          '<strong>' + r.icon + ' ' + r.name + '</strong>' +
          '<p style=\"margin:0.3rem 0;\">' + r.responsibility + '</p>' +
          '<p style=\"font-size:0.85rem;color:var(--accent);\">\uD83D\uDCA1 ' + r.how_to + '</p>' +
          '<p style=\"font-size:0.8rem;color:var(--red);\">\u26A0 ' + r.risk + '</p>' +
          '</div>';
      }).join('') + '<p style=\"color:var(--muted);\">' + data.role_selection_advice + '</p>';
  }
  
  if (section === 'question_types') {
    return data.types.map(function(t) {
      return '<div style=\"margin-bottom:0.8rem;padding:0.8rem;background:var(--tag-bg);border-radius:var(--radius-sm);\">' +
        '<strong>' + t.name + '</strong> <span style=\"color:var(--accent);\">\u96BE\u5EA6\uFF1A' + t.difficulty + '</span>' +
        '<p style=\"margin:0.3rem 0;\"><em>\u793A\u4F8B\uFF1A' + t.example + '</em></p>' +
        '<p style=\"font-size:0.85rem;\">' + t.characteristics + '</p>' +
        '<p style=\"font-size:0.85rem;color:var(--accent2);\">\u7B56\u7565\uFF1A' + t.strategy + '</p>' +
        '</div>';
    }).join('');
  }
  
  if (section === 'evaluation_criteria') {
    return data.dimensions.map(function(d) {
      return '<div style=\"margin-bottom:0.6rem;display:flex;justify-content:space-between;align-items:center;\">' +
        '<span>' + d.name + ' (' + d.weight + ')</span>' +
        '<span style=\"font-size:0.8rem;color:var(--muted);\">' + d.description + '</span>' +
        '</div>';
    }).join('');
  }
  
  if (section === 'speech_templates') {
    return Object.entries(data.templates).map(function(entry) {
      var key = entry[0], templates = entry[1];
      var labelMap = { ice_breaker: '\u7834\u51B0\u53D1\u8A00', time_management: '\u65F6\u95F4\u7BA1\u7406', building_on_others: '\u627F\u63A5\u4ED6\u4EBA', polite_disagreement: '\u793C\u8C8C\u53CD\u9A73', redirecting: '\u62C9\u56DE\u6B63\u9898', building_consensus: '\u5EFA\u7ACB\u5171\u8BC6', summary: '\u603B\u7ED3\u9648\u8FF0' };
      return '<div style=\"margin-bottom:1rem;\">' +
        '<strong>' + (labelMap[key] || key) + '</strong>' +
        templates.map(function(t) { return '<p style=\"font-size:0.85rem;padding:0.4rem;background:var(--tag-bg);border-radius:4px;margin:0.3rem 0;\">' + t + '</p>'; }).join('') +
        '</div>';
    }).join('');
  }
  
  if (section === 'classic_cases') {
    return data.map(function(c) {
      return '<div style=\"margin-bottom:1rem;padding:0.8rem;background:var(--tag-bg);border-radius:var(--radius-sm);\">' +
        '<strong>' + c.title + '</strong> <span style=\"color:var(--accent);\">[' + c.type + ']</span>' +
        '<p style=\"margin:0.3rem 0;\">' + c.scenario + '</p>' +
        (c.analysis_framework ? '<p style=\"font-size:0.85rem;color:var(--accent2);\">\u5206\u6790\u6846\u67B6\uFF1A' + c.analysis_framework + '</p>' : '') +
        (c.items ? '<p style=\"font-size:0.8rem;color:var(--muted);\">\u7269\u54C1\uFF1A' + c.items + '</p>' : '') +
        '<p style=\"font-size:0.85rem;color:var(--accent);\">\uD83D\uDCA1 ' + c.key_insight + '</p>' +
        '</div>';
    }).join('');
  }
  
  if (section === 'common_mistakes') {
    return data.mistakes.map(function(m) {
      return '<div style=\"margin-bottom:0.6rem;padding:0.6rem;background:var(--tag-bg);border-radius:var(--radius-sm);\">' +
        '<strong style=\"color:var(--red);\">\u274C ' + m.mistake + '</strong>' +
        '<p style=\"margin:0.2rem 0;font-size:0.85rem;\">\u540E\u679C\uFF1A' + m.consequence + '</p>' +
        '<p style=\"font-size:0.85rem;color:var(--accent2);\">\u2705 \u5BF9\u7B56\uFF1A' + m.fix + '</p>' +
        '</div>';
    }).join('');
  }
  
  if (section === 'preparation_checklist') {
    return '<ul>' + data.map(function(item) { return '<li>' + item + '</li>'; }).join('') + '</ul>';
  }
  
  return '<p>\u6682\u65E0\u5185\u5BB9</p>';
}

// ============================================================
// Phase 3: Mianjing Analysis (面经整合分析)
// ============================================================
async function doMianjingAnalysis() {
  var company = document.getElementById('mj-analysis-company').value.trim();
  var position = document.getElementById('mj-analysis-position').value.trim();
  if (!company && !position) { alert('\u8BF7\u81F3\u5C11\u8F93\u5165\u516C\u53F8\u540D\u6216\u5C97\u4F4D\u540D'); return; }
  
  var result = document.getElementById('mj-analysis-result');
  result.style.display = '';
  result.innerHTML = '<p>\u6B63\u5728\u5206\u6790\u4E2D...</p>';
  
  try {
    var resp = await fetchRetry('/api/mianjing-analysis', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company: company, position: position })
    });
    
    var body = resp.body;
    var reader = body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    
    while (true) {
      var readResult = await reader.read();
      if (readResult.done) break;
      buffer += decoder.decode(readResult.value, { stream: true });
      var lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (line.startsWith('data: ')) {
          try {
            var data = JSON.parse(line.slice(6));
            if (data._done) break;
            if (data.error) { result.innerHTML = '<p style=\"color:var(--red);\">' + data.error + '</p>'; return; }
            renderMianjingAnalysis(data, result);
          } catch(e) {}
        }
      }
    }
  } catch(e) { result.innerHTML = '<p style=\"color:var(--red);\">\u5206\u6790\u5931\u8D25: ' + e.message + '</p>'; }
}

function renderMianjingAnalysis(data, container) {
  var html = '';
  if (data.company_analysis) {
    html += '<div style=\"margin-bottom:1rem;\"><h4>\uD83C\uDFE2 ' + (data.company_analysis.company || '\u516C\u53F8\u5206\u6790') + '</h4>';
    html += '<p>\u9762\u8BD5\u6D41\u7A0B\uFF1A' + (data.company_analysis.interview_rounds || '\u6682\u65E0\u6570\u636E') + '</p>';
    html += '<p>\u96BE\u5EA6\uFF1A' + (data.company_analysis.difficulty_level || '\u6682\u65E0\u6570\u636E') + '</p>';
    html += '<p>\u85AA\u8D44\u8303\u56F4\uFF1A' + (data.company_analysis.salary_range || '\u6682\u65E0\u6570\u636E') + '</p>';
    html += '<p>\u9762\u8BD5\u98CE\u683C\uFF1A' + (data.company_analysis.interview_style || '\u6682\u65E0\u6570\u636E') + '</p>';
    if (data.company_analysis.common_questions) {
      html += '<strong>\u9AD8\u9891\u9898\uFF1A</strong><ul>' + data.company_analysis.common_questions.slice(0, 10).map(function(q) { return '<li>' + escapeHtml(q.question) + ' (' + q.frequency + '\u6B21)</li>'; }).join('') + '</ul>';
    }
    html += '</div>';
  }
  if (data.position_analysis) {
    html += '<div style=\"margin-bottom:1rem;\"><h4>\uD83D\uDCBC \u5C97\u4F4D\u5206\u6790</h4>';
    if (data.position_analysis.skill_requirements) {
      html += '<strong>\u6280\u80FD\u8981\u6C42\uFF1A</strong>' + data.position_analysis.skill_requirements.map(function(s) { return '<span style=\"display:inline-block;background:var(--tag-bg);padding:0.2rem 0.5rem;border-radius:4px;margin:0.2rem;\">' + escapeHtml(s.skill) + ' (' + s.frequency + '\u6B21)</span>'; }).join('');
    }
    html += '</div>';
  }
  if (data.preparation_advice) {
    html += '<div><h4>\uD83D\uDCA1 \u51C6\u5907\u5EFA\u8BAE</h4><ul>' + data.preparation_advice.map(function(a) { return '<li>' + escapeHtml(a) + '</li>'; }).join('') + '</ul></div>';
  }
  container.innerHTML = html;
}

// ============================================================
// Phase 3: Group Interview Event Bindings
// ============================================================
(function() {
  var btnStart = document.getElementById('btn-group-start');
  if (btnStart) btnStart.addEventListener('click', startGroupInterview);
  
  var btnSpeak = document.getElementById('btn-group-speak');
  if (btnSpeak) btnSpeak.addEventListener('click', submitGroupMessage);
  
  var btnEnd = document.getElementById('btn-group-end');
  if (btnEnd) btnEnd.addEventListener('click', endGroupInterview);
  
  var btnSkip = document.getElementById('btn-group-skip');
  if (btnSkip) btnSkip.addEventListener('click', function() {
    submitGroupMessage(); // For now, skip just sends an empty or placeholder
  });
  
  var btnMjAnalysis = document.getElementById('btn-mj-analysis');
  if (btnMjAnalysis) btnMjAnalysis.addEventListener('click', doMianjingAnalysis);
  
  // Enter key in group input submits message
  var groupInput = document.getElementById('group-input');
  if (groupInput) {
    groupInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        submitGroupMessage();
      }
    });
  }
})();

// ============================================================
// 预答题标准答案按钮（始终可见）
// ============================================================
(function() {
  var practiceBtn = document.getElementById('btn-practice-model-answer-pre');
  if (practiceBtn) {
    practiceBtn.addEventListener('click', function() {
      var question = state._practiceQuestion || document.getElementById('practice-q-text')?.textContent || '';
      if (!question) { toast('请先选择一道题目'); return; }
      var section = document.createElement('div');
      section.style.display = 'contents';
      var feedbackEl = document.getElementById('practice-feedback');
      if (feedbackEl && feedbackEl.parentNode) {
        feedbackEl.parentNode.insertBefore(section, feedbackEl);
      }
      loadModelAnswerHandler('practice-pre', question, section, practiceBtn);
    });
  }

  var drillBtn = document.getElementById('btn-drill-model-answer-pre');
  if (drillBtn) {
    drillBtn.addEventListener('click', function() {
      var question = state._drillQuestion || document.getElementById('drill-task-question')?.textContent || '';
      if (!question) { toast('请先选择一道题目'); return; }
      var section = document.createElement('div');
      section.style.display = 'contents';
      var feedbackEl = document.getElementById('drill-feedback');
      if (feedbackEl && feedbackEl.parentNode) {
        feedbackEl.parentNode.insertBefore(section, feedbackEl);
      }
      loadModelAnswerHandler('drill-pre', question, section, drillBtn);
    });
  }
})();

// ============================================================
// 完整经历补充模块
// ============================================================
(function() {
  // 初始化：加载已有经历
  var _experiences = [];
  var _saveTimer = null;

  function loadExperiences() {
    var sid = state.sessionId;
    if (!sid) { 
      renderExperienceList([]);
      return;
    }
    fetchRetry('/api/sessions/' + sid + '/experiences')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        _experiences = data.experiences || [];
        state._fullExperiences = _experiences;
        renderExperienceList(_experiences);
      })
      .catch(function() { renderExperienceList([]); });
  }

  function renderExperienceList(list) {
    var container = document.getElementById('experience-list');
    if (!container) return;
    if (!list || list.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--muted);font-size:0.82rem;">暂无补充经历，点击「AI 经历访谈」让AI根据你的简历生成引导问题</div>';
      document.getElementById('btn-save-experiences').style.display = 'none';
      return;
    }
    document.getElementById('btn-save-experiences').style.display = 'inline-flex';
    container.innerHTML = list.map(function(exp, i) {
      return '<div style="background:var(--bg0);border-radius:8px;padding:0.6rem 0.8rem;border-left:3px solid var(--accent2);">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;margin-bottom:0.3rem;">' +
        '<input class="experience-name-input" data-idx="' + i + '" type="text" value="' + escapeHtml(exp.name || '') + '" placeholder="经历名称（如：字节跳动实习）" style="flex:1;padding:0.3rem 0.5rem;border:1px solid var(--rule);border-radius:4px;background:var(--bg);font-size:0.82rem;font-weight:600;">' +
        '<button class="btn-delete-experience" data-idx="' + i + '" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:0.78rem;padding:0.2rem 0.4rem;">✕</button>' +
        '</div>' +
        '<textarea class="experience-detail-input" data-idx="' + i + '" rows="3" placeholder="补充该经历的详细内容（具体任务、团队规模、困难、量化成果等）" style="width:100%;padding:0.4rem;border:1px solid var(--rule);border-radius:4px;background:var(--bg);font-size:0.82rem;line-height:1.6;resize:vertical;font-family:var(--font-body);">' + escapeHtml(exp.detail || '') + '</textarea>' +
        '</div>';
    }).join('');

    // 绑定删除事件
    container.querySelectorAll('.btn-delete-experience').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var idx = parseInt(btn.dataset.idx);
        _experiences.splice(idx, 1);
        renderExperienceList(_experiences);
        scheduleSave();
      });
    });

    // 自动保存：输入变更时触发
    container.querySelectorAll('.experience-name-input, .experience-detail-input').forEach(function(el) {
      el.addEventListener('input', function() {
        var idx = parseInt(el.dataset.idx);
        if (el.classList.contains('experience-name-input')) {
          _experiences[idx].name = el.value;
        } else {
          _experiences[idx].detail = el.value;
        }
        scheduleSave();
      });
    });
  }

  function scheduleSave() {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(doSaveExperiences, 1000);
  }

  async function doSaveExperiences() {
    var sid = state.sessionId;
    if (!sid) return;
    try {
      await fetchRetry('/api/sessions/' + sid + '/experiences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ experiences: _experiences })
      });
      state._fullExperiences = _experiences;
    } catch(e) { /* silent */ }
  }

  // AI 经历访谈
  document.getElementById('btn-experience-interview')?.addEventListener('click', async function() {
    var btn = document.getElementById('btn-experience-interview');
    var resumeText = state.resumeText || document.getElementById('resume-input')?.value?.trim() || '';
    if (!resumeText) return toast('请先在「分析 & 押题」页上传简历');

    btn.disabled = true;
    btn.innerHTML = '<span class="ai-action-icon">⏳</span>AI正在分析简历...';

    try {
      var resp = await fetchRetry('/api/generate-experience-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeText: resumeText.slice(0, 3000) })
      }).then(function(r) { return r.json(); });

      var questions = resp.questions || [];
      if (!questions.length) { toast('AI未能生成问题，请重试'); return; }

      // 显示问题选择弹窗
      var overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';

      var modal = document.createElement('div');
      modal.style.cssText = 'background:var(--bg);border-radius:12px;padding:1.5rem;max-width:600px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.2);';
      modal.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">' +
        '<h3 style="margin:0;">🤖 AI 经历访谈</h3>' +
        '<button id="btn-close-experience-modal" style="background:none;border:none;font-size:1.2rem;cursor:pointer;color:var(--muted);">✕</button>' +
        '</div>' +
        '<p style="font-size:0.82rem;color:var(--muted);margin-bottom:1rem;">AI根据你的简历生成了以下问题，选择你想补充的经历，填写详细内容后会自动保存</p>' +
        '<div style="display:flex;flex-direction:column;gap:0.8rem;">' +
        questions.map(function(q, i) {
          return '<div style="background:var(--bg0);border-radius:8px;padding:0.8rem;border-left:3px solid var(--accent2);">' +
            '<div style="font-weight:600;font-size:0.88rem;margin-bottom:0.3rem;">' + (i+1) + '. ' + escapeHtml(q.experience_ref || '') + '</div>' +
            '<div style="font-size:0.82rem;color:var(--fg);margin-bottom:0.4rem;line-height:1.5;">' + escapeHtml(q.question || '') + '</div>' +
            (q.hint ? '<div style="font-size:0.75rem;color:var(--muted);margin-bottom:0.5rem;">💡 ' + escapeHtml(q.hint) + '</div>' : '') +
            '<textarea class="experience-interview-answer" data-ref="' + escapeHtml(q.experience_ref || '') + '" rows="3" placeholder="在此输入你的完整经历..." style="width:100%;padding:0.4rem;border:1px solid var(--rule);border-radius:4px;background:var(--bg);font-size:0.82rem;line-height:1.6;resize:vertical;font-family:var(--font-body);"></textarea>' +
            '</div>';
        }).join('') +
        '</div>' +
        '<div style="margin-top:1rem;display:flex;gap:0.5rem;justify-content:flex-end;">' +
        '<button id="btn-cancel-experience-modal" class="btn-outline" style="font-size:0.82rem;">取消</button>' +
        '<button id="btn-confirm-experience-modal" class="btn-primary" style="font-size:0.82rem;">✅ 添加到经历库</button>' +
        '</div>';

      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      document.getElementById('btn-close-experience-modal').addEventListener('click', function() { overlay.remove(); });
      document.getElementById('btn-cancel-experience-modal').addEventListener('click', function() { overlay.remove(); });

      document.getElementById('btn-confirm-experience-modal').addEventListener('click', function() {
        var answers = modal.querySelectorAll('.experience-interview-answer');
        var added = 0;
        answers.forEach(function(textarea) {
          var val = textarea.value.trim();
          if (val.length > 10) {
            var ref = textarea.dataset.ref || '经历' + (added + 1);
            // 检查是否已存在同名经历，有则更新
            var existing = -1;
            for (var k = 0; k < _experiences.length; k++) {
              if (_experiences[k].name === ref) { existing = k; break; }
            }
            var exp = { name: ref, detail: val };
            if (existing >= 0) {
              _experiences[existing] = exp;
            } else {
              _experiences.push(exp);
            }
            added++;
          }
        });
        if (added > 0) {
          renderExperienceList(_experiences);
          doSaveExperiences();
          toast('✅ 已添加 ' + added + ' 条完整经历');
        } else {
          toast('请至少填写一条经历的详细内容（10字以上）');
        }
        overlay.remove();
      });

      btn.disabled = false;
      btn.innerHTML = '<span class="ai-action-icon">🤖</span>AI 经历访谈';
    } catch(e) {
      btn.disabled = false;
      btn.innerHTML = '<span class="ai-action-icon">🤖</span>AI 经历访谈';
      toast('生成失败: ' + e.message);
    }
  });

  // 手动添加经历
  document.getElementById('btn-add-experience')?.addEventListener('click', function() {
    _experiences.push({ name: '', detail: '' });
    renderExperienceList(_experiences);
  });

  // 保存按钮
  document.getElementById('btn-save-experiences')?.addEventListener('click', async function() {
    await doSaveExperiences();
    toast('✅ 经历已保存');
  });

  // 监听会话切换，重新加载经历
  var origSwitch = window.switchToSession;
  if (origSwitch) {
    var _origSwitch = origSwitch;
    window.switchToSession = function(sessionId) {
      return _origSwitch(sessionId).then(function() {
        loadExperiences();
      }).catch(function() {});
    };
  }

  // ============================================================
// Tab: 面试备考方案
// ============================================================

// 生成备考方案
async function generateStudyPlan() {
  if (!state.sessionId) {
    toast('⚠️ 请先在「分析 & 押题」完成JD分析');
    return;
  }
  var btn = document.getElementById('btn-studyplan-generate');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 生成中...'; }

  try {
    toast('正在生成个性化备考方案...');
    var result = await fetchRetry('/api/study-plan/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: state.sessionId })
    }).then(function(r) { return r.json(); });

    if (result.error) {
      toast('生成失败: ' + result.error);
      if (btn) { btn.disabled = false; btn.textContent = '生成备考方案'; }
      return;
    }

    state._studyPlan = result;
    renderStudyPlan(result);
    toast('✅ 备考方案已生成');

    // 显示方案区域，隐藏空状态
    document.getElementById('studyplan-empty')?.classList.add('hidden');
    document.getElementById('studyplan-area')?.classList.remove('hidden');
  } catch (e) {
    toast('生成失败: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = '生成备考方案'; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '生成备考方案'; }
  }
}

// 渲染备考方案
function renderStudyPlan(plan) {
  if (!plan) return;

  // 标题和元数据
  var titleEl = document.getElementById('studyplan-title');
  var metaEl = document.getElementById('studyplan-meta');
  if (titleEl) titleEl.textContent = '📋 ' + (plan.position || '') + ' · 备考方案';
  if (metaEl) metaEl.textContent = '🏢 ' + (plan.company || '') + ' | 一键生成，为你量身定制';

  // 整体策略
  var strategyEl = document.getElementById('studyplan-strategy');
  if (strategyEl && plan.overall_strategy) {
    strategyEl.innerHTML = '<h3 style="margin:0 0 0.5rem 0;">🎯 整体备考策略</h3><p style="font-size:0.88rem;line-height:1.8;color:var(--ink);">' + plan.overall_strategy.replace(/\n/g, '<br>') + '</p>';
  }

  // JD 逐条拆解
  var jdEl = document.getElementById('studyplan-jd-breakdown');
  if (jdEl && plan.jd_breakdown && plan.jd_breakdown.length) {
    jdEl.innerHTML = plan.jd_breakdown.map(function(item) {
      var typeMap = { hard_skill: '🔧 硬技能', soft_skill: '💬 软素质', experience: '📁 经验', education: '🎓 学历' };
      var typeLabel = typeMap[item.type] || item.type;
      var impColor = item.importance === '核心' ? 'var(--red)' : (item.importance === '重要' ? 'var(--accent)' : 'var(--muted)');
      return '<div style="display:flex;gap:0.5rem;padding:0.5rem 0;border-bottom:1px solid var(--rule);font-size:0.85rem;">' +
        '<span style="flex-shrink:0;font-size:0.72rem;padding:0.1rem 0.4rem;border-radius:4px;background:' + impColor + '20;color:' + impColor + ';font-weight:600;">' + item.importance + '</span>' +
        '<span style="flex-shrink:0;font-size:0.72rem;padding:0.1rem 0.4rem;border-radius:4px;background:var(--tag-bg);color:var(--muted);">' + typeLabel + '</span>' +
        '<div style="flex:1;"><div style="font-weight:600;">' + item.requirement + '</div>' +
        (item.detail ? '<div style="font-size:0.78rem;color:var(--muted);margin-top:0.15rem;">' + item.detail + '</div>' : '') + '</div></div>';
    }).join('');
  }

  // 能力匹配度
  var matchEl = document.getElementById('studyplan-match');
  if (matchEl && plan.capability_match && plan.capability_match.length) {
    matchEl.innerHTML = plan.capability_match.map(function(item) {
      var icon = item.match === '完全匹配' ? '✅' : (item.match === '部分匹配' ? '⚠️' : '❌');
      var color = item.match === '完全匹配' ? 'var(--green)' : (item.match === '部分匹配' ? 'var(--accent)' : 'var(--red)');
      return '<div style="padding:0.5rem 0;border-bottom:1px solid var(--rule);">' +
        '<div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.2rem;">' +
        '<span style="font-size:0.9rem;">' + icon + '</span>' +
        '<span style="font-size:0.72rem;padding:0.1rem 0.4rem;border-radius:4px;background:' + color + '20;color:' + color + ';font-weight:600;">' + item.match + '</span>' +
        '<span style="font-weight:600;font-size:0.85rem;">' + item.requirement + '</span></div>' +
        (item.match_detail ? '<div style="font-size:0.8rem;color:var(--muted);margin-left:1.5rem;">' + item.match_detail + '</div>' : '') +
        (item.evidence ? '<div style="font-size:0.78rem;color:var(--accent);margin-left:1.5rem;margin-top:0.15rem;">📎 ' + item.evidence + '</div>' : '') + '</div>';
    }).join('');
  }

  // 需要补充什么
  var gapsEl = document.getElementById('studyplan-gaps');
  if (gapsEl && plan.gaps_to_fill && plan.gaps_to_fill.length) {
    var catColor = { '知识短板': 'var(--red)', '经历缺口': 'var(--accent)', '表达准备': '#7C3AED', '面试技巧': '#2563EB' };
    gapsEl.innerHTML = plan.gaps_to_fill.map(function(item) {
      var catLabel = item.category || '其他';
      var color = catColor[catLabel] || 'var(--muted)';
      return '<div style="padding:0.6rem;border:1px solid var(--rule);border-radius:8px;margin-bottom:0.5rem;border-left:3px solid ' + color + ';">' +
        '<div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.3rem;">' +
        '<span style="font-size:0.72rem;padding:0.1rem 0.4rem;border-radius:4px;background:' + color + '20;color:' + color + ';font-weight:600;">' + catLabel + '</span>' +
        '<span style="font-weight:600;font-size:0.85rem;">' + item.area + '</span></div>' +
        '<div style="font-size:0.8rem;color:var(--muted);">现状：' + (item.current_status || '') + '</div>' +
        '<div style="font-size:0.8rem;color:var(--green);">目标：' + (item.target || '') + '</div></div>';
    }).join('');
  }

  // 行动方案
  var actionsEl = document.getElementById('studyplan-actions');
  if (actionsEl && plan.action_plan && plan.action_plan.length) {
    var priColor = { '高': 'var(--red)', '中': 'var(--accent)', '低': 'var(--muted)' };
    actionsEl.innerHTML = plan.action_plan.map(function(item) {
      var color = priColor[item.priority] || 'var(--muted)';
      return '<div style="padding:0.6rem;border:1px solid var(--rule);border-radius:8px;margin-bottom:0.5rem;">' +
        '<div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.3rem;">' +
        '<span style="font-size:0.72rem;padding:0.1rem 0.4rem;border-radius:4px;background:' + color + '20;color:' + color + ';font-weight:600;">🔴 ' + item.priority + '优先级</span>' +
        '<span style="font-weight:600;font-size:0.85rem;">' + item.action + '</span></div>' +
        (item.resource ? '<div style="font-size:0.8rem;color:var(--accent);margin-bottom:0.15rem;">📚 ' + item.resource + '</div>' : '') +
        (item.estimated_time ? '<div style="font-size:0.78rem;color:var(--muted);">⏱ ' + item.estimated_time + '</div>' : '') +
        (item.tips ? '<div style="font-size:0.78rem;color:var(--muted);margin-top:0.15rem;">💡 ' + item.tips + '</div>' : '') + '</div>';
    }).join('');
  }

  // 周计划
  var scheduleEl = document.getElementById('studyplan-schedule');
  if (scheduleEl && plan.weekly_schedule && plan.weekly_schedule.length) {
    scheduleEl.innerHTML = plan.weekly_schedule.map(function(week) {
      return '<div style="padding:0.6rem;border:1px solid var(--rule);border-radius:8px;margin-bottom:0.5rem;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.3rem;">' +
        '<span style="font-weight:700;font-size:0.9rem;color:var(--accent);">' + week.week + '</span>' +
        '<span style="font-size:0.78rem;color:var(--muted);">🎯 ' + (week.goal || '') + '</span></div>' +
        '<div style="font-size:0.82rem;font-weight:500;margin-bottom:0.3rem;">📌 ' + (week.focus || '') + '</div>' +
        '<ul style="margin:0;padding-left:1.2rem;font-size:0.8rem;color:var(--muted);">' +
        (week.tasks || []).map(function(t) { return '<li>' + t + '</li>'; }).join('') + '</ul></div>';
    }).join('');
  } else {
    if (scheduleEl) scheduleEl.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--muted);">备考周计划生成中，请稍后查看...</div>';
  }

  // 核心建议
  var adviceEl = document.getElementById('studyplan-advice');
  if (adviceEl && plan.key_advice) {
    var adviceList = typeof plan.key_advice === 'string' ? plan.key_advice.split('\n').filter(Boolean) : (plan.key_advice || []);
    adviceEl.innerHTML = '<ul style="margin:0;padding-left:1.2rem;font-size:0.88rem;line-height:2;">' +
      adviceList.map(function(a) { return '<li>' + (a.startsWith('-') || a.startsWith('•') ? a.substring(1).trim() : a) + '</li>'; }).join('') + '</ul>';
  }
}

// 绑定事件
(function() {
  var btnGenerate = document.getElementById('btn-studyplan-generate');
  if (btnGenerate) {
    btnGenerate.addEventListener('click', function() {
      generateStudyPlan();
    });
  }

  var btnRegenerate = document.getElementById('btn-studyplan-regenerate');
  if (btnRegenerate) {
    btnRegenerate.addEventListener('click', function() {
      // 隐藏已有结果，重新生成
      document.getElementById('studyplan-area')?.classList.add('hidden');
      document.getElementById('studyplan-empty')?.classList.remove('hidden');
      document.getElementById('studyplan-empty')?.querySelector('p')?.classList.add('hidden');
      generateStudyPlan();
    });
  }
})();

  // ============================================================
// 面试复盘模块
// ============================================================
(function() {
  var _currentReview = null;
  var _currentSourceText = '';

  // 上传文件
  document.getElementById('btn-review-upload')?.addEventListener('click', function() {
    document.getElementById('review-file-input')?.click();
  });

  document.getElementById('review-file-input')?.addEventListener('change', function(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    document.getElementById('review-file-name').textContent = '📄 ' + file.name;
    document.getElementById('review-hint').textContent = '⏳ 正在解析文件...';

    var formData = new FormData();
    formData.append('file', file);

    fetch('/api/interview-review/upload', { method: 'POST', body: formData })
      .then(function(r) { return r.json(); })
      .then(function(result) {
        if (result.error) {
          toast('文件解析失败: ' + result.error);
          document.getElementById('review-hint').textContent = '❌ 文件解析失败: ' + result.error;
          return;
        }
        document.getElementById('review-text-input').value = result.text || '';
        _currentSourceText = result.text || '';
        document.getElementById('review-hint').textContent = '✅ 已解析 ' + (result.fileName || '文件') + '，共 ' + (result.text || '').length + ' 字，可编辑后生成复盘';
        checkReviewGenerateReady();
      })
      .catch(function(err) {
        toast('上传失败: ' + err.message);
        document.getElementById('review-hint').textContent = '❌ 上传失败: ' + err.message;
      });
  });

  // 文本输入变化
  document.getElementById('review-text-input')?.addEventListener('input', function() {
    _currentSourceText = this.value;
    checkReviewGenerateReady();
  });

  // 检查是否可生成
  function checkReviewGenerateReady() {
    var text = document.getElementById('review-text-input').value.trim();
    var btn = document.getElementById('btn-review-generate');
    if (btn) btn.disabled = !text;
    var hint = document.getElementById('review-hint');
    if (hint) {
      if (text) hint.textContent = '✅ 已输入 ' + text.length + ' 字，点击「生成复盘」开始分析';
      else hint.textContent = '请上传文件或粘贴面试记录文本';
    }
  }

  // 生成复盘
  document.getElementById('btn-review-generate')?.addEventListener('click', function() {
    generateReview();
  });

  document.getElementById('btn-review-regenerate')?.addEventListener('click', function() {
    generateReview();
  });

  async function generateReview() {
    var text = document.getElementById('review-text-input').value.trim();
    if (!text) {
      toast('请先粘贴面试记录或上传文件');
      return;
    }

    var btn = document.getElementById('btn-review-generate');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 生成中...'; }

    toast('🔄 正在分析面试记录...');
    try {
      var result = await fetch('/api/interview-review/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interviewText: text })
      }).then(function(r) { return r.json(); });

      if (result.error) {
        toast('生成失败: ' + result.error);
        if (btn) { btn.disabled = false; btn.textContent = '🔄 生成复盘'; }
        return;
      }

      _currentReview = result;
      _currentSourceText = text;
      renderReview(result);
      toast('✅ 复盘报告已生成');
    } catch (e) {
      toast('生成失败: ' + e.message);
      if (btn) { btn.disabled = false; btn.textContent = '🔄 生成复盘'; }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🔄 生成复盘'; }
    }
  }

  // 渲染复盘报告
  function renderReview(review) {
    if (!review) return;
    document.getElementById('review-result')?.classList.remove('hidden');

    var info = review.interview_info || {};
    var titleEl = document.getElementById('review-info-title');
    if (titleEl) {
      titleEl.textContent = '📝 ' + (info.company || '') + ' · ' + (info.position || '') + ' · ' + (info.round || '') + ' 复盘';
    }
    var metaEl = document.getElementById('review-info-meta');
    if (metaEl) {
      var parts = [];
      if (info.duration) parts.push('⏱ ' + info.duration);
      if (info.format) parts.push('📹 ' + info.format);
      if (info.interviewer_style) parts.push('👤 ' + info.interviewer_style);
      metaEl.textContent = parts.join(' | ');
    }

    // 整体评分
    var scoreEl = document.getElementById('review-overall-score');
    if (scoreEl) scoreEl.textContent = review.overall_score || '--';

    var dimsEl = document.getElementById('review-score-dims');
    if (dimsEl && review.overall_scores) {
      var dimLabels = {
        preparation: '准备充分度',
        answer_quality: '回答质量',
        technical_ability: '技术能力',
        communication: '沟通表达',
        adaptability: '应变能力'
      };
      dimsEl.innerHTML = Object.keys(dimLabels).map(function(key) {
        var score = review.overall_scores[key];
        if (score === undefined || score === null) return '';
        var color = score >= 80 ? 'var(--green)' : (score >= 60 ? 'var(--accent)' : 'var(--red)');
        return '<div style="display:flex;align-items:center;gap:0.5rem;">' +
          '<span style="width:5rem;font-size:0.78rem;color:var(--muted);flex-shrink:0;">' + dimLabels[key] + '</span>' +
          '<div style="flex:1;height:6px;background:var(--bg1);border-radius:3px;overflow:hidden;">' +
          '<div style="height:100%;width:' + score + '%;background:' + color + ';border-radius:3px;transition:width 0.5s;"></div></div>' +
          '<span style="width:2rem;text-align:right;font-size:0.78rem;font-weight:600;color:' + color + ';">' + score + '</span></div>';
      }).join('');
    }

    // 总结
    var summaryEl = document.getElementById('review-summary');
    if (summaryEl && review.summary) {
      summaryEl.innerHTML = '💬 ' + review.summary;
    }

    // 逐题复盘
    var qEl = document.getElementById('review-questions');
    if (qEl && review.questions && review.questions.length) {
      qEl.innerHTML = review.questions.map(function(q, i) {
        var scoreColor = q.score >= 80 ? 'var(--green)' : (q.score >= 60 ? 'var(--accent)' : 'var(--red)');
        var followUpHtml = q.follow_up ? '<div style="font-size:0.8rem;color:var(--accent);margin-top:0.2rem;">🔍 追问：' + q.follow_up + '</div>' : '';
        var feedbackHtml = q.interviewer_feedback ? '<div style="font-size:0.8rem;color:var(--muted);margin-top:0.2rem;">📌 面试官反馈：' + q.interviewer_feedback + '</div>' : '';
        var strengthsHtml = q.strengths && q.strengths.length ? q.strengths.map(function(s) { return '<span style="display:inline-block;font-size:0.72rem;padding:0.1rem 0.4rem;border-radius:4px;background:var(--green)15;color:var(--green);margin:0.15rem;">✅ ' + s + '</span>'; }).join('') : '';
        var weaknessesHtml = q.weaknesses && q.weaknesses.length ? q.weaknesses.map(function(w) { return '<span style="display:inline-block;font-size:0.72rem;padding:0.1rem 0.4rem;border-radius:4px;background:var(--red)15;color:var(--red);margin:0.15rem;">⚠️ ' + w + '</span>'; }).join('') : '';
        var improvedHtml = q.improved_answer ? '<div style="margin-top:0.4rem;padding:0.5rem;background:var(--bg1);border-radius:6px;border-left:3px solid var(--accent);">' +
          '<div style="font-size:0.78rem;font-weight:600;color:var(--accent);margin-bottom:0.2rem;">💡 改进版回答</div>' +
          '<div style="font-size:0.8rem;color:var(--ink);line-height:1.6;">' + q.improved_answer.replace(/\n/g, '<br>') + '</div></div>' : '';

        return '<div style="padding:0.8rem;border:1px solid var(--rule);border-radius:8px;margin-bottom:0.6rem;">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.3rem;">' +
          '<div style="font-weight:600;font-size:0.85rem;flex:1;">Q' + (i + 1) + ': ' + q.question + '</div>' +
          '<span style="flex-shrink:0;font-size:0.85rem;font-weight:700;padding:0.1rem 0.5rem;border-radius:999px;background:' + scoreColor + '20;color:' + scoreColor + ';margin-left:0.5rem;">' + (q.score || '--') + '</span></div>' +
          (q.intent ? '<div style="font-size:0.78rem;color:var(--muted);margin-bottom:0.3rem;">🎯 考察意图：' + q.intent + '</div>' : '') +
          (q.your_answer ? '<div style="font-size:0.8rem;color:var(--ink);margin-bottom:0.3rem;padding:0.3rem 0.5rem;background:var(--bg1);border-radius:4px;">你的回答：' + q.your_answer + '</div>' : '') +
          followUpHtml + feedbackHtml +
          '<div style="margin-top:0.3rem;display:flex;gap:0.3rem;flex-wrap:wrap;">' + strengthsHtml + weaknessesHtml + '</div>' +
          improvedHtml + '</div>';
      }).join('');
    }

    // 核心改进建议
    var imprEl = document.getElementById('review-improvements');
    if (imprEl && review.key_improvements && review.key_improvements.length) {
      var priColor = { '高': 'var(--red)', '中': 'var(--accent)', '低': 'var(--muted)' };
      imprEl.innerHTML = review.key_improvements.map(function(item) {
        var color = priColor[item.priority] || 'var(--muted)';
        return '<div style="padding:0.6rem;border:1px solid var(--rule);border-radius:8px;margin-bottom:0.5rem;">' +
          '<div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.3rem;">' +
          '<span style="font-size:0.72rem;padding:0.1rem 0.4rem;border-radius:4px;background:' + color + '20;color:' + color + ';font-weight:600;">🔴 ' + item.priority + '优先级</span>' +
          '<span style="font-weight:600;font-size:0.85rem;">' + (item.area || '') + '</span></div>' +
          '<div style="font-size:0.8rem;color:var(--muted);">' + (item.suggestion || '') + '</div>' +
          (item.practice_method ? '<div style="font-size:0.78rem;color:var(--accent);margin-top:0.2rem;">📖 ' + item.practice_method + '</div>' : '') + '</div>';
      }).join('');
    }

    // 准备清单
    var checklistEl = document.getElementById('review-checklist');
    if (checklistEl && review.preparation_checklist && review.preparation_checklist.length) {
      checklistEl.innerHTML = review.preparation_checklist.map(function(item) {
        return '<div style="padding:0.3rem 0;font-size:0.85rem;">☐ ' + item + '</div>';
      }).join('');
    }

    // 面试技巧
    var tipsEl = document.getElementById('review-tips');
    if (tipsEl && review.interview_tips) {
      tipsEl.innerHTML = review.interview_tips.replace(/\n/g, '<br>');
    }
  }

  // 保存复盘
  document.getElementById('btn-review-save')?.addEventListener('click', function() {
    if (!_currentReview) {
      toast('⚠️ 没有可保存的复盘报告');
      return;
    }
    var btn = this;
    btn.disabled = true;
    btn.textContent = '⏳ 保存中...';

    fetch('/api/interview-review/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        review: _currentReview,
        sourceText: _currentSourceText,
        fileName: document.getElementById('review-file-name').textContent.replace('📄 ', '')
      })
    }).then(function(r) { return r.json(); })
      .then(function(result) {
        if (result.ok) {
          toast('✅ 复盘已保存');
          loadReviewHistory();
        } else {
          toast('保存失败: ' + (result.error || ''));
        }
      }).catch(function(err) {
        toast('保存失败: ' + err.message);
      }).finally(function() {
        btn.disabled = false;
        btn.textContent = '💾 保存复盘';
      });
  });

  // 清空
  document.getElementById('btn-review-clear')?.addEventListener('click', function() {
    document.getElementById('review-text-input').value = '';
    document.getElementById('review-file-name').textContent = '未选择文件';
    document.getElementById('review-file-input').value = '';
    _currentSourceText = '';
    _currentReview = null;
    document.getElementById('review-result')?.classList.add('hidden');
    document.getElementById('review-hint').textContent = '请上传文件或粘贴面试记录文本';
    checkReviewGenerateReady();
  });

  // 加载历史复盘
  async function loadReviewHistory() {
    var container = document.getElementById('review-history');
    if (!container) return;
    try {
      var list = await fetch('/api/interview-review/history').then(function(r) { return r.json(); });
      if (!list || !list.length) {
        container.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--muted);font-size:0.82rem;">暂无复盘记录，导入面试记录后生成</div>';
        return;
      }
      container.innerHTML = list.map(function(item) {
        var scoreColor = item.overallScore >= 80 ? 'var(--green)' : (item.overallScore >= 60 ? 'var(--accent)' : 'var(--red)');
        var dateStr = item.createdAt ? item.createdAt.slice(0, 10) : '';
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:0.6rem;border:1px solid var(--rule);border-radius:8px;margin-bottom:0.4rem;cursor:pointer;" class="review-history-item" data-id="' + item.id + '">' +
          '<div style="flex:1;">' +
          '<div style="font-weight:600;font-size:0.85rem;">' + (item.company || '未知公司') + ' · ' + (item.position || '未知岗位') + ' · ' + (item.round || '') + '</div>' +
          '<div style="font-size:0.75rem;color:var(--muted);margin-top:0.15rem;">' + dateStr + (item.fileName ? ' | ' + item.fileName : '') + '</div></div>' +
          '<div style="display:flex;align-items:center;gap:0.5rem;">' +
          '<span style="font-size:0.85rem;font-weight:700;color:' + scoreColor + ';">' + (item.overallScore || '--') + '分</span>' +
          '<button class="btn-review-delete" data-id="' + item.id + '" style="font-size:0.72rem;padding:0.1rem 0.4rem;border:1px solid var(--rule);border-radius:4px;background:none;cursor:pointer;color:var(--muted);" title="删除">🗑</button></div></div>';
      }).join('');

      // 点击历史项查看详情
      container.querySelectorAll('.review-history-item').forEach(function(el) {
        el.addEventListener('click', function(e) {
          if (e.target.closest('.btn-review-delete')) return;
          var id = this.dataset.id;
          loadReviewDetail(id);
        });
      });

      // 删除按钮
      container.querySelectorAll('.btn-review-delete').forEach(function(el) {
        el.addEventListener('click', function(e) {
          e.stopPropagation();
          var id = this.dataset.id;
          if (!confirm('确定删除这条复盘记录吗？')) return;
          fetch('/api/interview-review/' + id, { method: 'DELETE' })
            .then(function(r) { return r.json(); })
            .then(function(result) {
              if (result.ok) {
                toast('✅ 已删除');
                loadReviewHistory();
              } else {
                toast('删除失败: ' + (result.error || ''));
              }
            });
        });
      });
    } catch (e) {
      container.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--muted);font-size:0.82rem;">加载历史记录失败</div>';
    }
  }

  // 加载复盘详情
  async function loadReviewDetail(id) {
    try {
      var data = await fetch('/api/interview-review/detail/' + id).then(function(r) { return r.json(); });
      if (data.error) {
        toast('加载失败: ' + data.error);
        return;
      }
      _currentReview = data.review;
      _currentSourceText = data.sourceText || '';
      document.getElementById('review-text-input').value = data.sourceText || '';
      renderReview(data.review);
      document.getElementById('review-result')?.classList.remove('hidden');
      document.getElementById('review-hint').textContent = '📂 已加载历史复盘记录';
      // 滚动到结果区
      setTimeout(function() {
        document.getElementById('review-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 200);
    } catch (e) {
      toast('加载失败: ' + e.message);
    }
  }

  // 暴露给全局（供 switchTab 调用）
  window.loadReviewHistory = loadReviewHistory;
})();

// 初始加载
  setTimeout(loadExperiences, 1000);
})();

// ============================================================
// 一键上岸：简历助手 <-> 面试助手 桥接（2026-08-14 新增）
// 数据通道：localStorage['jobseeker-bridge-v1'] + postMessage
// ============================================================
(function initJobseekerBridge() {
  var LS_BRIDGE = 'jobseeker-bridge-v1';

  function readBridge() {
    try {
      return JSON.parse(localStorage.getItem(LS_BRIDGE) || 'null');
    } catch (e) { return null; }
  }

  function fillFromBridge(bridge) {
    if (!bridge) return false;
    if (bridge.jdText) {
      var jd = document.getElementById('jd-input');
      if (jd) jd.value = bridge.jdText;
    }
    if (bridge.resumeText) {
      var r = document.getElementById('resume-input');
      if (r) r.value = bridge.resumeText;
      var hint = document.getElementById('resume-hint');
      if (hint) {
        var who = bridge.resumeName || '未命名';
        var when = bridge.updatedAt ? new Date(bridge.updatedAt).toLocaleString('zh-CN') : '';
        hint.textContent = '📥 已从简历助手导入：' + who + (when ? ' · ' + when : '');
      }
    }
    return true;
  }

  // 「分析 & 押题」页：从简历助手导入按钮
  var btn = document.getElementById('btn-import-resume');
  if (btn) {
    btn.addEventListener('click', function () {
      var bridge = readBridge();
      if (!bridge || !bridge.resumeText) {
        toast('简历助手中还没有可导入的简历：请先在「📄 简历助手」页生成简历，再点「同步到面试助手」');
        return;
      }
      fillFromBridge(bridge);
      toast('已从简历助手导入 ✅ 确认/填写 JD 后即可开始押题分析');
      switchTab('analyze');
    });
  }

  // 接收简历助手 iframe 的同步消息
  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || d.type !== 'jobseeker-bridge' || d.action !== 'import') return;
    if (d.payload) {
      try { localStorage.setItem(LS_BRIDGE, JSON.stringify(d.payload)); } catch (e) {}
    }
    var bridge = d.payload || readBridge();
    if (fillFromBridge(bridge)) {
      toast('✅ 已从简历助手同步简历，可开始押题分析');
    }
    switchTab('analyze');
  });

  // 已有桥接数据时高亮导入按钮
  var b = readBridge();
  if (b && b.resumeText && btn) {
    btn.style.borderColor = 'var(--accent)';
    btn.style.color = 'var(--accent)';
  }
})();