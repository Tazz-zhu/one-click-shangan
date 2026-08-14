// ============================================================
// 一键上岸 Auth Module
// 用户认证、点数管理、套餐购买
// ============================================================

(function() {
  'use strict';

  const API = '/api';

  // ─── State ──────────────────────────────────────────────────
  let _token = localStorage.getItem('auth_token') || null;
  let _user = null;
  let _credits = { balance: 0, totalEarned: 0, totalSpent: 0 };
  let _freeQuota = null;
  let _loggedIn = false;

  // ─── Helpers ────────────────────────────────────────────────
  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return document.querySelectorAll(sel); }

  function showEl(id) { var el = $(id); if (el) el.classList.remove('hidden'); }
  function hideEl(id) { var el = $(id); if (el) el.classList.add('hidden'); }

  function toast(msg, ms) {
    // Use global toast if available
    if (typeof window.toast === 'function') {
      window.toast(msg, ms);
      return;
    }
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:2rem;left:50%;transform:translateX(-50%);background:#1a1a2e;color:#fff;padding:0.6rem 1.5rem;border-radius:8px;z-index:9999;font-size:0.85rem;pointer-events:none;';
    document.body.appendChild(t);
    setTimeout(function() { t.remove(); }, ms || 2500);
  }

  // ─── API Calls ──────────────────────────────────────────────
  function apiHeaders() {
    var h = { 'Content-Type': 'application/json' };
    if (_token) h['Authorization'] = 'Bearer ' + _token;
    return h;
  }

  async function apiCall(method, url, body) {
    var opts = { method: method, headers: apiHeaders() };
    if (body) opts.body = JSON.stringify(body);
    var resp = await fetch(API + url, opts);
    var data = await resp.json().catch(function() { return { error: '请求失败' }; });
    if (!resp.ok) throw new Error(data.error || '请求失败 (' + resp.status + ')');
    return data;
  }

  // ─── Auth Operations ────────────────────────────────────────
  async function login(email, password) {
    var data = await apiCall('POST', '/auth/login', { email: email, password: password });
    _token = data.token;
    _user = { userId: data.userId, email: data.email, isAdmin: data.isAdmin || false };
    localStorage.setItem('auth_token', _token);
    _loggedIn = true;
    updateNavUI();
    loadCredits();
    loadFreeQuota();
    return data;
  }

  async function register(email, password) {
    var data = await apiCall('POST', '/auth/register', { email: email, password: password });
    _token = data.token;
    _user = { userId: data.userId, email: data.email, isAdmin: data.isAdmin || false };
    localStorage.setItem('auth_token', _token);
    _loggedIn = true;
    updateNavUI();
    loadCredits();
    loadFreeQuota();
    return data;
  }

  function logout() {
    _token = null;
    _user = null;
    _credits = { balance: 0, totalEarned: 0, totalSpent: 0 };
    _freeQuota = null;
    _loggedIn = false;
    localStorage.removeItem('auth_token');
    updateNavUI();
    toast('已退出登录');
  }

  async function loadCredits() {
    if (!_loggedIn) return;
    try {
      var data = await apiCall('GET', '/user/credits');
      _credits = data;
      updateCreditsUI();
    } catch (e) {
      console.warn('Load credits failed:', e.message);
    }
  }

  async function loadFreeQuota() {
    try {
      var data = await apiCall('GET', '/auth/free-quota');
      _freeQuota = data;
      _loggedIn = data.loggedIn;
      updateQuotaBanners();
    } catch (e) {
      console.warn('Load free quota failed:', e.message);
    }
  }

  async function loadPlans() {
    try {
      var data = await apiCall('GET', '/plans');
      return data;
    } catch (e) {
      console.warn('Load plans failed:', e.message);
      return [];
    }
  }

  // ─── UI Updates ─────────────────────────────────────────────
  function updateNavUI() {
    var btnLogin = $('#btn-open-auth');
    var userInfo = $('#nav-user-info');
    var userEmail = $('#nav-user-email');
    var creditsEl = $('#nav-credits');

    if (_loggedIn && _user) {
      if (btnLogin) btnLogin.classList.add('hidden');
      if (userInfo) userInfo.classList.remove('hidden');
      if (userEmail) userEmail.textContent = _user.email;
      if (creditsEl) creditsEl.classList.remove('hidden');
      // 显示/隐藏管理后台 Tab
      var adminTab = $('#tab-admin');
      if (adminTab) adminTab.style.display = _user.isAdmin ? '' : 'none';
    } else {
      if (btnLogin) btnLogin.classList.remove('hidden');
      if (userInfo) userInfo.classList.add('hidden');
      if (creditsEl) creditsEl.classList.add('hidden');
      // 隐藏管理后台 Tab
      var adminTab = $('#tab-admin');
      if (adminTab) adminTab.style.display = 'none';
    }
  }

  function updateCreditsUI() {
    var num = $('#nav-credits-num');
    if (num) num.textContent = _credits.balance || 0;
    var plansNum = $('#plans-balance-num');
    if (plansNum) plansNum.textContent = _credits.balance || 0;
  }

  function updateQuotaBanners() {
    // Update all quota banners on the page
    var banners = $$('.quota-banner');
    banners.forEach(function(b) { updateQuotaBanner(b); });
  }

  function updateQuotaBanner(banner) {
    if (!_freeQuota) return;
    var freeType = banner.getAttribute('data-quota-type'); // 'evaluation' or 'analysis'
    var free = _freeQuota.free || {};
    var used = freeType === 'analysis' ? (free.usedAnalyses || 0) : (free.usedEvaluations || 0);
    var total = freeType === 'analysis' ? (free.dailyAnalyses || 1) : (free.dailyEvaluations || 3);
    var remaining = total - used;

    var label = freeType === 'analysis' ? '分析' : '评估';
    var countEl = banner.querySelector('.quota-count');
    if (countEl) countEl.textContent = remaining + '/' + total;

    var buyLink = banner.querySelector('a[id^="quota-buy-link-"]');
    banner.classList.remove('free', 'low', 'exhausted');
    if (remaining <= 0) {
      banner.classList.add('exhausted');
      var msgEl = banner.querySelector('.quota-msg');
      if (msgEl) msgEl.textContent = '今日免费' + label + '次数已用完，请购买点数继续使用';
      if (buyLink) buyLink.style.display = 'inline';
    } else if (remaining <= 1) {
      banner.classList.add('low');
      var msgEl2 = banner.querySelector('.quota-msg');
      if (msgEl2) msgEl2.textContent = '今日免费' + label + '仅剩 ' + remaining + ' 次';
      if (buyLink) buyLink.style.display = 'inline';
    } else {
      banner.classList.add('free');
      var msgEl3 = banner.querySelector('.quota-msg');
      if (msgEl3) msgEl3.textContent = '今日免费' + label + '剩余 ' + remaining + ' 次';
      if (buyLink) buyLink.style.display = 'none';
    }
  }

  // ─── Auth Modal ─────────────────────────────────────────────
  function openAuthModal(tab) {
    tab = tab || 'login';
    var modal = $('#auth-modal');
    if (!modal) return;
    modal.classList.remove('hidden');

    var title = $('#auth-modal-title');
    var loginForm = $('#auth-login-form');
    var regForm = $('#auth-register-form');
    var tabs = $$('.auth-tab');

    tabs.forEach(function(t) {
      t.classList.toggle('active', t.getAttribute('data-auth-tab') === tab);
    });

    if (tab === 'login') {
      if (title) title.textContent = '登录';
      if (loginForm) loginForm.classList.remove('hidden');
      if (regForm) regForm.classList.add('hidden');
    } else {
      if (title) title.textContent = '注册';
      if (loginForm) loginForm.classList.add('hidden');
      if (regForm) regForm.classList.remove('hidden');
    }

    // Clear errors
    var errEl = $('#auth-error');
    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
    var regErrEl = $('#auth-reg-error');
    if (regErrEl) { regErrEl.style.display = 'none'; regErrEl.textContent = ''; }
  }

  function closeAuthModal() {
    var modal = $('#auth-modal');
    if (modal) modal.classList.add('hidden');
  }

  // ─── Plans Modal ────────────────────────────────────────────
  async function openPlansModal() {
    if (!_loggedIn) {
      toast('请先登录');
      openAuthModal('login');
      return;
    }

    var modal = $('#plans-modal');
    if (!modal) return;
    modal.classList.remove('hidden');

    // Update balance
    var balNum = $('#plans-balance-num');
    if (balNum) balNum.textContent = _credits.balance || 0;

    // Load plans
    var plans = await loadPlans();
    var grid = $('#plans-grid');
    if (!grid) return;

    grid.innerHTML = '';
    plans.forEach(function(plan) {
      var card = document.createElement('div');
      card.className = 'plans-card' + (plan.popular ? ' popular' : '');
      var creditsLabel = plan.credits === -1 ? '不限次数' : plan.credits + ' 点数';
      var priceLabel = '¥' + plan.price;
      card.innerHTML =
        (plan.popular ? '<div class="popular-badge">推荐</div>' : '') +
        '<div class="plan-name">' + plan.name + '</div>' +
        '<div class="plan-price">' + priceLabel + '</div>' +
        '<div class="plan-credits">' + creditsLabel + '</div>' +
        '<div class="plan-desc">' + plan.description + '</div>' +
        '<button class="plan-cta">立即购买</button>';

      card.querySelector('.plan-cta').addEventListener('click', function(e) {
        e.stopPropagation();
        purchasePlan(plan.id);
      });

      grid.appendChild(card);
    });
  }

  function closePlansModal() {
    var modal = $('#plans-modal');
    if (modal) modal.classList.add('hidden');
  }

  async function purchasePlan(planId) {
    try {
      toast('正在创建支付链接...');
      var data = await apiCall('POST', '/payment/create-checkout', { planId: planId });
      if (data.checkoutUrl) {
        // 开发模式：模拟支付
        if (data.checkoutUrl.startsWith('/api/payment/mock-checkout')) {
          window.open(data.checkoutUrl, '_blank');
          // 延迟刷新点数
          setTimeout(function() {
            loadCredits();
            closePlansModal();
            toast('点数充值成功！');
          }, 3000);
        } else {
          // 生产模式：跳转到 LemonSqueezy
          window.open(data.checkoutUrl, '_blank');
          toast('请在支付页面完成支付，支付成功后点数将自动到账');
        }
      }
    } catch (e) {
      toast('创建支付失败：' + e.message);
    }
  }

  // ─── Credit Logs Modal ──────────────────────────────────────
  var _creditLogs = [];

  async function openCreditLogsModal() {
    if (!_loggedIn) {
      toast('请先登录');
      return;
    }
    var modal = $('#credit-logs-modal');
    if (!modal) return;
    modal.classList.remove('hidden');

    // Update balance
    var balEl = $('#credit-logs-balance');
    if (balEl) {
      balEl.innerHTML = '当前点数：<b style="font-size:1.2rem;color:var(--accent);">' + (_credits.balance || 0) + '</b> 🪙';
    }

    // Load logs
    var listEl = $('#credit-logs-list');
    if (!listEl) return;
    listEl.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--muted);">加载中...</div>';

    try {
      var logs = await apiCall('GET', '/user/credit-logs');
      _creditLogs = logs;
      renderCreditLogs();
    } catch (e) {
      listEl.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--red);">加载失败：' + e.message + '</div>';
    }
  }

  function renderCreditLogs() {
    var listEl = $('#credit-logs-list');
    if (!listEl) return;

    if (_creditLogs.length === 0) {
      listEl.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--muted);">暂无点数记录</div>';
      return;
    }

    var html = '';
    _creditLogs.forEach(function(log) {
      var isEarn = log.amount > 0;
      var amountClass = isEarn ? 'earn' : 'consume';
      var amountStr = (isEarn ? '+' : '') + log.amount;
      var timeStr = new Date(log.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      var featureLabels = {
        'purchase': '充值',
        'analyze': '押题分析',
        'evaluate-single': '单题评估',
        'follow-up': 'AI追问',
        'generate-model-answer': 'AI标准答案',
        'generate-self-intro': '自我介绍',
        'interview-start': '模拟面试',
        'interview-evaluate': '面试评估',
        'optimize-resume': '简历优化',
        'mianjing-collect': '面经采集',
        'company-research': '公司调研',
        'interview-review': '面试复盘',
        'group-interview': '群面模拟',
        'drill-evaluate': '专项训练',
        'behavioral-answer': '通用题库',
        'study-plan': '备考方案',
        'counter-questions': '反问生成'
      };
      var featureLabel = featureLabels[log.feature] || log.feature || '未知';

      html += '<div class="credit-log-item">';
      html += '<span class="log-amount ' + amountClass + '">' + amountStr + '</span>';
      html += '<span class="log-feature">' + featureLabel + '</span>';
      html += '<span class="log-time">' + timeStr + '</span>';
      html += '<span class="log-balance">余额 ' + log.balanceAfter + '</span>';
      html += '</div>';
    });
    listEl.innerHTML = html;
  }

  function closeCreditLogsModal() {
    var modal = $('#credit-logs-modal');
    if (modal) modal.classList.add('hidden');
  }

  // ─── Subscription Check ─────────────────────────────────────
  var _subscription = null;

  async function checkSubscription() {
    if (!_loggedIn) return;
    try {
      var data = await apiCall('GET', '/subscription/status');
      _subscription = data;
      updateSubscriptionUI();
    } catch (e) {
      console.warn('Subscription check failed:', e.message);
    }
  }

  function updateSubscriptionUI() {
    // Remove existing subscription banners
    var existing = $$('.sub-banner');
    existing.forEach(function(b) { b.remove(); });

    if (!_subscription || !_subscription.active) return;

    var now = new Date();
    var expiresAt = new Date(_subscription.expiresAt);
    var daysLeft = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));

    var banner = document.createElement('div');
    var planName = _subscription.planId === 'monthly' ? '月卡' : '年卡';

    if (daysLeft <= 0) {
      banner.className = 'sub-banner expired';
      banner.innerHTML = '<span class="sub-dot"></span><span class="sub-msg">' + planName + '已过期，请续费继续享受不限次数使用</span><a href="#" class="sub-renew" style="margin-left:auto;color:var(--red);font-weight:600;text-decoration:none;">续费 →</a>';
    } else if (daysLeft <= 3) {
      banner.className = 'sub-banner expiring';
      banner.innerHTML = '<span class="sub-dot"></span><span class="sub-msg">' + planName + '即将到期（剩余 ' + daysLeft + ' 天），请及时续费</span><a href="#" class="sub-renew" style="margin-left:auto;color:var(--yellow);font-weight:600;text-decoration:none;">续费 →</a>';
    } else {
      banner.className = 'sub-banner active';
      banner.innerHTML = '<span class="sub-dot"></span><span class="sub-msg">' + planName + '有效中（剩余 ' + daysLeft + ' 天），不限次数使用全部功能</span>';
    }

    // Insert after the first hero-card in the dashboard
    var dashboard = $('#tab-dashboard');
    if (dashboard && banner) {
      var heroCard = dashboard.querySelector('.hero-card');
      if (heroCard && heroCard.nextSibling) {
        heroCard.parentNode.insertBefore(banner, heroCard.nextSibling);
      }
    }

    // Add click handler for renew link
    var renewLink = banner.querySelector('.sub-renew');
    if (renewLink) {
      renewLink.addEventListener('click', function(e) {
        e.preventDefault();
        openPlansModal();
      });
    }
  }

  // ─── Event Listeners ────────────────────────────────────────
  function init() {
    // Open auth modal
    var btnOpenAuth = $('#btn-open-auth');
    if (btnOpenAuth) {
      btnOpenAuth.addEventListener('click', function() { openAuthModal('login'); });
    }

    // Close auth modal
    var btnCloseAuth = $('#btn-close-auth');
    if (btnCloseAuth) {
      btnCloseAuth.addEventListener('click', closeAuthModal);
    }
    var authModal = $('#auth-modal');
    if (authModal) {
      authModal.addEventListener('click', function(e) {
        if (e.target === authModal) closeAuthModal();
      });
    }

    // Auth tabs
    $$('.auth-tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        openAuthModal(tab.getAttribute('data-auth-tab'));
      });
    });

    // Login form
    var loginForm = $('#auth-login-form');
    if (loginForm) {
      loginForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        var email = $('#auth-email').value.trim();
        var password = $('#auth-password').value;
        var errEl = $('#auth-error');
        if (!email || !password) {
          if (errEl) { errEl.textContent = '请填写邮箱和密码'; errEl.style.display = 'block'; }
          return;
        }
        try {
          if (errEl) errEl.style.display = 'none';
          await login(email, password);
          closeAuthModal();
          toast('登录成功！');
        } catch (e) {
          if (errEl) { errEl.textContent = e.message; errEl.style.display = 'block'; }
        }
      });
    }

    // Register form
    var regForm = $('#auth-register-form');
    if (regForm) {
      regForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        var email = $('#auth-reg-email').value.trim();
        var password = $('#auth-reg-password').value;
        var errEl = $('#auth-reg-error');
        if (!email || !password) {
          if (errEl) { errEl.textContent = '请填写邮箱和密码'; errEl.style.display = 'block'; }
          return;
        }
        if (password.length < 6) {
          if (errEl) { errEl.textContent = '密码至少6位'; errEl.style.display = 'block'; }
          return;
        }
        try {
          if (errEl) errEl.style.display = 'none';
          await register(email, password);
          closeAuthModal();
          toast('注册成功！');
        } catch (e) {
          if (errEl) { errEl.textContent = e.message; errEl.style.display = 'block'; }
        }
      });
    }

    // Logout
    var btnLogout = $('#btn-logout');
    if (btnLogout) {
      btnLogout.addEventListener('click', logout);
    }

    // Open plans modal
    var btnBuyCredits = $('#btn-buy-credits');
    if (btnBuyCredits) {
      btnBuyCredits.addEventListener('click', openPlansModal);
    }
    var navCredits = $('#nav-credits');
    if (navCredits) {
      navCredits.addEventListener('click', openPlansModal);
    }

    // Close plans modal
    var btnClosePlans = $('#btn-close-plans');
    if (btnClosePlans) {
      btnClosePlans.addEventListener('click', closePlansModal);
    }
    var plansModal = $('#plans-modal');
    if (plansModal) {
      plansModal.addEventListener('click', function(e) {
        if (e.target === plansModal) closePlansModal();
      });
    }

    // Payment success detection (from URL param)
    if (window.location.search.includes('payment=success')) {
      toast('支付成功！点数已到账');
      loadCredits();
      // Clean URL
      var url = new URL(window.location);
      url.searchParams.delete('payment');
      window.history.replaceState({}, '', url.toString());
    }

    // Quota banner "购买点数" links
    var buyLinks = $$('[id^="quota-buy-link-"]');
    buyLinks.forEach(function(link) {
      link.addEventListener('click', function(e) {
        e.preventDefault();
        openPlansModal();
      });
    });

    // Credit logs
    var btnCreditLogs = $('#btn-credit-logs');
    if (btnCreditLogs) {
      btnCreditLogs.addEventListener('click', function(e) {
        e.preventDefault();
        openCreditLogsModal();
      });
    }
    var btnCloseCreditLogs = $('#btn-close-credit-logs');
    if (btnCloseCreditLogs) {
      btnCloseCreditLogs.addEventListener('click', closeCreditLogsModal);
    }
    var creditLogsModal = $('#credit-logs-modal');
    if (creditLogsModal) {
      creditLogsModal.addEventListener('click', function(e) {
        if (e.target === creditLogsModal) closeCreditLogsModal();
      });
    }

    // Initial load
    if (_token) {
      loadFreeQuota().then(function() {
        if (_loggedIn) {
          loadCredits();
          checkSubscription();
        } else {
          // Token expired
          _token = null;
          localStorage.removeItem('auth_token');
          updateNavUI();
        }
      });
    } else {
      loadFreeQuota();
    }
  }

  // ─── Public API ─────────────────────────────────────────────
  // Expose functions for app.js to use
  window.Auth = {
    isLoggedIn: function() { return _loggedIn; },
    isAdmin: function() { return _user && _user.isAdmin; },
    getToken: function() { return _token; },
    getUser: function() { return _user; },
    getCredits: function() { return _credits; },
    getFreeQuota: function() { return _freeQuota; },
    refreshCredits: loadCredits,
    refreshQuota: loadFreeQuota,
    login: login,
    logout: logout,
    openPlansModal: openPlansModal,
    apiHeaders: apiHeaders,
    apiCall: apiCall
  };

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();