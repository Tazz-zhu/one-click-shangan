/**
 * 管理后台模块
 * 仅管理员可见
 */
(function() {
  'use strict';

  // ─── 状态 ────────────────────────────────────────────
  var state = {
    currentPage: 'dashboard',
    usersPage: 1,
    usersSearch: '',
    selectedUserId: null
  };

  function $(sel) { return document.querySelector(sel); }

  // ─── 导航切换 ─────────────────────────────────────────

  function switchAdminPage(page) {
    state.currentPage = page;
    document.querySelectorAll('.admin-nav-item').forEach(function(el) {
      el.classList.toggle('active', el.dataset.page === page);
    });
    if (page === 'dashboard') renderDashboard();
    else if (page === 'users') renderUsers();
    else if (page === 'costs') renderCostConfig();
  }

  // ─── 仪表盘 ──────────────────────────────────────────

  async function renderDashboard() {
    var container = $('#admin-content');
    if (!container) return;
    container.innerHTML = '<div class="admin-loading">加载中...</div>';

    try {
      var stats = await window.Auth.apiCall('GET', '/admin/stats');
      container.innerHTML = buildDashboardHTML(stats);
      // 渲染图表
      setTimeout(function() { renderDashboardCharts(stats); }, 100);
    } catch (e) {
      container.innerHTML = '<div class="admin-error">加载失败: ' + escHtml(e.message) + '</div>';
    }
  }

  function buildDashboardHTML(stats) {
    return '<div class="admin-dashboard">' +
      '<div class="admin-stat-cards">' +
        '<div class="admin-stat-card"><div class="admin-stat-value">' + (stats.totalUsers || 0) + '</div><div class="admin-stat-label">总用户数</div></div>' +
        '<div class="admin-stat-card"><div class="admin-stat-value">' + (stats.activeUsers7d || 0) + '</div><div class="admin-stat-label">近7天新增</div></div>' +
        '<div class="admin-stat-card"><div class="admin-stat-value">' + (stats.totalCreditsIssued || 0) + '</div><div class="admin-stat-label">已发放点数</div></div>' +
        '<div class="admin-stat-card"><div class="admin-stat-value">' + (stats.totalCreditsSpent || 0) + '</div><div class="admin-stat-label">已消耗点数</div></div>' +
      '</div>' +
      '<div class="admin-chart-row">' +
        '<div class="admin-chart-box"><h4 style="margin:0 0 12px;font-size:14px;">功能使用分布</h4><div id="admin-feature-chart" style="height:260px;"></div></div>' +
        '<div class="admin-chart-box"><h4 style="margin:0 0 12px;font-size:14px;">近7天新增用户</h4><div id="admin-user-chart" style="height:260px;"></div></div>' +
      '</div>' +
    '</div>';
  }

  function renderDashboardCharts(stats) {
    if (typeof echarts === 'undefined') return;

    // 功能使用分布饼图
    var featureChart = echarts.init($('#admin-feature-chart'));
    var featureData = [];
    var featureNames = {
      'analyze': '一键分析', 'evaluate-single': '单题评估', 'follow-up': 'AI追问',
      'generate-model-answer': 'AI标准答案', 'generate-self-intro': '自我介绍',
      'interview-start': '面试开始', 'interview-evaluate': '面试评估',
      'optimize-resume': '简历优化', 'mianjing-collect': '面经采集',
      'company-research': '公司调研', 'interview-review': '面试复盘',
      'group-interview': '群面模拟', 'drill-evaluate': '专项训练',
      'behavioral-answer': '通用题库', 'study-plan': '备考方案',
      'code-interview-generate': '代码题生成', 'code-interview-review': '代码审查'
    };
    Object.keys(stats.featureUsage || {}).forEach(function(k) {
      featureData.push({ name: featureNames[k] || k, value: stats.featureUsage[k] });
    });
    featureData.sort(function(a, b) { return b.value - a.value; });

    featureChart.setOption({
      tooltip: { trigger: 'item' },
      series: [{
        type: 'pie', radius: ['40%', '70%'], center: ['50%', '50%'],
        data: featureData.slice(0, 10),
        label: { fontSize: 11 },
        emphasis: { label: { fontSize: 14, fontWeight: 'bold' } }
      }]
    });

    // 近7天新增用户柱状图
    var userChart = echarts.init($('#admin-user-chart'));
    var dates = Object.keys(stats.dailyNewUsers || {}).sort();
    userChart.setOption({
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: dates.map(function(d) { return d.slice(5); }) },
      yAxis: { type: 'value', minInterval: 1 },
      series: [{
        type: 'bar', data: dates.map(function(d) { return stats.dailyNewUsers[d] || 0; }),
        itemStyle: { color: '#a78bfa', borderRadius: [4, 4, 0, 0] }
      }]
    });

    window.addEventListener('resize', function() {
      try { featureChart.resize(); userChart.resize(); } catch(e) {}
    });
  }

  // ─── 用户管理 ────────────────────────────────────────

  async function renderUsers() {
    var container = $('#admin-content');
    if (!container) return;
    container.innerHTML = '<div class="admin-loading">加载中...</div>';

    try {
      var data = await window.Auth.apiCall('GET', '/admin/users?page=' + state.usersPage + '&limit=20&search=' + encodeURIComponent(state.usersSearch));
      container.innerHTML = buildUsersHTML(data);
    } catch (e) {
      container.innerHTML = '<div class="admin-error">加载失败: ' + escHtml(e.message) + '</div>';
    }
  }

  function buildUsersHTML(data) {
    var rows = (data.users || []).map(function(u) {
      return '<tr>' +
        '<td class="admin-td-email" title="' + escHtml(u.email) + '">' + escHtml(u.email) + '</td>' +
        '<td style="font-size:11px;color:var(--text-secondary);">' + escHtml(u.userId) + '</td>' +
        '<td>' + (u.balance || 0) + ' 🪙</td>' +
        '<td>' + (u.isAdmin ? '<span class="admin-badge">管理员</span>' : '用户') + '</td>' +
        '<td style="font-size:12px;">' + formatDate(u.createdAt) + '</td>' +
        '<td><button class="admin-btn-sm" onclick="window.Admin.viewUser(\'' + u.userId + '\')">详情</button></td>' +
      '</tr>';
    }).join('');

    var totalPages = Math.ceil((data.total || 0) / (data.limit || 20));

    return '<div class="admin-users">' +
      '<div class="admin-toolbar">' +
        '<input type="text" id="admin-user-search" class="admin-search" placeholder="搜索邮箱或用户ID..." value="' + escHtml(state.usersSearch) + '" />' +
        '<button class="admin-btn-sm" style="margin-left:8px;" onclick="window.Admin.doSearch()">搜索</button>' +
      '</div>' +
      '<table class="admin-table">' +
        '<thead><tr><th>邮箱</th><th>用户ID</th><th>点数</th><th>角色</th><th>注册时间</th><th>操作</th></tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="6" class="admin-empty">暂无用户</td></tr>') + '</tbody>' +
      '</table>' +
      '<div class="admin-pagination">' +
        '<button ' + (data.page <= 1 ? 'disabled' : '') + ' onclick="window.Admin.prevUsersPage()">上一页</button>' +
        '<span>第 ' + data.page + ' / ' + totalPages + ' 页 (共 ' + data.total + ' 条)</span>' +
        '<button ' + (data.page >= totalPages ? 'disabled' : '') + ' onclick="window.Admin.nextUsersPage()">下一页</button>' +
      '</div>' +
    '</div>';
  }

  function doSearch() {
    var input = document.getElementById('admin-user-search');
    state.usersSearch = input ? input.value : '';
    state.usersPage = 1;
    renderUsers();
  }

  // ─── 用户详情弹窗 ────────────────────────────────────

  async function viewUser(userId) {
    state.selectedUserId = userId;
    var modal = document.getElementById('admin-user-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'admin-user-modal';
      modal.className = 'modal-overlay';
      modal.onclick = function(e) { if (e.target === modal) modal.classList.add('hidden'); };
      document.body.appendChild(modal);
    }
    modal.classList.remove('hidden');
    modal.innerHTML = '<div class="modal-content admin-modal-content"><div class="admin-loading">加载中...</div></div>';

    try {
      var user = await window.Auth.apiCall('GET', '/admin/users/' + userId);
      modal.querySelector('.modal-content').innerHTML = buildUserDetailHTML(user);
    } catch (e) {
      modal.querySelector('.modal-content').innerHTML = '<div class="admin-error">加载失败: ' + escHtml(e.message) + '</div>';
    }
  }

  function buildUserDetailHTML(user) {
    var logsHTML = (user.recentLogs || []).map(function(l) {
      var sign = l.amount > 0 ? '+' : '';
      return '<tr>' +
        '<td style="font-size:12px;">' + formatDate(l.createdAt) + '</td>' +
        '<td>' + escHtml(l.feature || l.action || '') + '</td>' +
        '<td class="' + (l.amount > 0 ? 'admin-credit-plus' : 'admin-credit-minus') + '">' + sign + l.amount + '</td>' +
        '<td>' + (l.balanceAfter !== undefined ? l.balanceAfter : '-') + '</td>' +
      '</tr>';
    }).join('');

    return '<div class="admin-user-detail">' +
      '<h3>用户详情</h3>' +
      '<button class="admin-close-btn" onclick="document.getElementById(\'admin-user-modal\').classList.add(\'hidden\')">&times;</button>' +
      '<div class="admin-user-info">' +
        '<p><strong>邮箱:</strong> ' + escHtml(user.email) + '</p>' +
        '<p><strong>用户ID:</strong> ' + escHtml(user.userId) + '</p>' +
        '<p><strong>注册时间:</strong> ' + formatDate(user.createdAt) + '</p>' +
        '<p><strong>角色:</strong> ' + (user.isAdmin ? '<span class="admin-badge">管理员</span>' : '普通用户') + '</p>' +
        '<p><strong>当前点数:</strong> ' + ((user.credits && user.credits.balance) || 0) + ' 🪙</p>' +
      '</div>' +
      '<div class="admin-credit-actions">' +
        '<h4>点数操作</h4>' +
        '<div class="admin-credit-form">' +
          '<input type="number" id="admin-credit-amount" placeholder="点数" min="1" value="100" />' +
          '<input type="text" id="admin-credit-reason" placeholder="操作原因" />' +
          '<button class="admin-btn admin-btn-grant" onclick="window.Admin.grantCredits(\'' + user.userId + '\')">充值</button>' +
          '<button class="admin-btn admin-btn-deduct" onclick="window.Admin.deductCredits(\'' + user.userId + '\')">扣减</button>' +
        '</div>' +
      '</div>' +
      '<h4>最近记录</h4>' +
      '<table class="admin-table" style="max-height:300px;display:block;overflow-y:auto;">' +
        '<thead><tr><th>时间</th><th>功能</th><th>变动</th><th>余额</th></tr></thead>' +
        '<tbody>' + (logsHTML || '<tr><td colspan="4" class="admin-empty">暂无记录</td></tr>') + '</tbody>' +
      '</table>' +
    '</div>';
  }

  async function grantCredits(userId) {
    var amount = parseInt(document.getElementById('admin-credit-amount').value);
    var reason = document.getElementById('admin-credit-reason').value || '管理员充值';
    if (!amount || amount <= 0) { alert('请输入有效点数'); return; }
    try {
      await window.Auth.apiCall('POST', '/admin/credits/grant', { userId: userId, amount: amount, reason: reason });
      alert('充值成功！');
      viewUser(userId);
    } catch (e) {
      alert('充值失败: ' + e.message);
    }
  }

  async function deductCredits(userId) {
    var amount = parseInt(document.getElementById('admin-credit-amount').value);
    var reason = document.getElementById('admin-credit-reason').value || '管理员扣减';
    if (!amount || amount <= 0) { alert('请输入有效点数'); return; }
    try {
      await window.Auth.apiCall('POST', '/admin/credits/deduct', { userId: userId, amount: amount, reason: reason });
      alert('扣减成功！');
      viewUser(userId);
    } catch (e) {
      alert('扣减失败: ' + e.message);
    }
  }

  // ─── 消耗配置 ────────────────────────────────────────

  async function renderCostConfig() {
    var container = $('#admin-content');
    if (!container) return;
    container.innerHTML = '<div class="admin-loading">加载中...</div>';

    try {
      var costs = await window.Auth.apiCall('GET', '/admin/cost-config');
      container.innerHTML = buildCostConfigHTML(costs);
    } catch (e) {
      container.innerHTML = '<div class="admin-error">加载失败: ' + escHtml(e.message) + '</div>';
    }
  }

  function buildCostConfigHTML(costs) {
    var costNames = {
      'analyze': '一键分析（押题生成）', 'evaluate-single': '单题评估', 'follow-up': 'AI追问',
      'generate-model-answer': 'AI标准答案', 'generate-self-intro': '自我介绍生成',
      'interview-start': '面试开始', 'interview-evaluate': '面试评估',
      'optimize-resume': '简历优化', 'mianjing-collect': '面经采集',
      'company-research': '公司调研', 'interview-review': '面试复盘',
      'group-interview': '群面模拟', 'drill-evaluate': '专项训练评估',
      'behavioral-answer': '通用题库回答', 'study-plan': '备考方案',
      'counter-questions': '反问生成', 'code-interview-generate': '代码题生成',
      'code-interview-review': '代码审查'
    };

    var rows = Object.keys(costs).map(function(key) {
      return '<tr><td>' + (costNames[key] || key) + '</td><td><code>' + key + '</code></td><td>' + costs[key] + ' 🪙</td></tr>';
    }).join('');

    return '<div class="admin-costs">' +
      '<h3>各功能点数消耗配置</h3>' +
      '<p style="color:var(--text-secondary);font-size:13px;margin-bottom:16px;">当前消耗为只读展示，修改需在代码中调整 <code>server/credits.js</code> 的 API_COSTS 对象</p>' +
      '<table class="admin-table">' +
        '<thead><tr><th>功能</th><th>Key</th><th>消耗点数</th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
    '</div>';
  }

  // ─── 初始化 ───────────────────────────────────────────

  function init() {
    switchAdminPage('dashboard');
  }

  // ─── 工具函数 ─────────────────────────────────────────

  function escHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  function formatDate(iso) {
    if (!iso) return '-';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '-';
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0') + ' ' +
      String(d.getHours()).padStart(2, '0') + ':' +
      String(d.getMinutes()).padStart(2, '0');
  }

  // ─── 暴露全局 API ─────────────────────────────────────

  window.Admin = {
    init: init,
    switchPage: switchAdminPage,
    viewUser: viewUser,
    grantCredits: grantCredits,
    deductCredits: deductCredits,
    doSearch: doSearch,
    prevUsersPage: function() { if (state.usersPage > 1) { state.usersPage--; renderUsers(); } },
    nextUsersPage: function() { state.usersPage++; renderUsers(); }
  };

})();