/**
 * 管理后台 API 模块
 * 所有端点需要管理员权限 (isAdmin)
 */
const { loadUsers, saveUsers } = require('./auth');
const { loadCredits, saveCredits, addCredits, deductCredits, loadCreditLogs, API_COSTS } = require('./credits');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..');

function adminAuth(req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ error: '需要管理员权限' });
  }
  next();
}

function registerAdminRoutes(app) {

  // ─── 仪表盘统计 ──────────────────────────────────────

  app.get('/api/admin/stats', adminAuth, (req, res) => {
    try {
      const users = loadUsers();
      const credits = loadCredits();
      const logs = loadCreditLogs();

      const totalUsers = Object.keys(users).length;
      const totalCreditsIssued = Object.values(credits).reduce((sum, c) => sum + (c.totalEarned || 0), 0);
      const totalCreditsSpent = Object.values(credits).reduce((sum, c) => sum + (c.totalSpent || 0), 0);

      // 近7天新增用户
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const activeUsers7d = Object.values(users).filter(u => {
        const created = new Date(u.createdAt).getTime();
        return created > sevenDaysAgo;
      }).length;

      // 各功能使用次数
      const featureUsage = {};
      Object.values(logs).forEach(userLogs => {
        (userLogs || []).forEach(log => {
          if (log.action === 'consume') {
            featureUsage[log.feature] = (featureUsage[log.feature] || 0) + 1;
          }
        });
      });

      // 近7天每日新增用户
      const dailyNewUsers = {};
      for (let i = 6; i >= 0; i--) {
        const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        dailyNewUsers[date] = 0;
      }
      Object.values(users).forEach(u => {
        const date = u.createdAt ? u.createdAt.slice(0, 10) : '';
        if (dailyNewUsers[date] !== undefined) dailyNewUsers[date]++;
      });

      res.json({
        totalUsers,
        activeUsers7d,
        totalCreditsIssued,
        totalCreditsSpent,
        featureUsage,
        dailyNewUsers
      });
    } catch (e) {
      console.error('Admin stats error:', e);
      res.status(500).json({ error: '获取统计数据失败' });
    }
  });

  // ─── 用户管理 ────────────────────────────────────────

  app.get('/api/admin/users', adminAuth, (req, res) => {
    try {
      const users = loadUsers();
      const credits = loadCredits();
      const { page = 1, limit = 20, search = '' } = req.query;
      const pageNum = parseInt(page) || 1;
      const limitNum = Math.min(parseInt(limit) || 20, 100);

      let userList = Object.entries(users).map(([id, u]) => ({
        userId: id,
        email: u.email || '',
        createdAt: u.createdAt || '',
        isAdmin: !!u.isAdmin,
        balance: (credits[id] && credits[id].balance) || 0
      }));

      if (search) {
        const s = search.toLowerCase();
        userList = userList.filter(u => u.email.toLowerCase().includes(s) || u.userId.toLowerCase().includes(s));
      }

      const total = userList.length;
      userList.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const paged = userList.slice((pageNum - 1) * limitNum, pageNum * limitNum);

      res.json({ total, page: pageNum, limit: limitNum, users: paged });
    } catch (e) {
      console.error('Admin users error:', e);
      res.status(500).json({ error: '获取用户列表失败' });
    }
  });

  app.get('/api/admin/users/:userId', adminAuth, (req, res) => {
    try {
      const users = loadUsers();
      const credits = loadCredits();
      const logs = loadCreditLogs();
      const user = users[req.params.userId];
      if (!user) return res.status(404).json({ error: '用户不存在' });

      res.json({
        userId: req.params.userId,
        email: user.email || '',
        createdAt: user.createdAt || '',
        isAdmin: !!user.isAdmin,
        credits: credits[req.params.userId] || { balance: 0, totalEarned: 0, totalSpent: 0 },
        recentLogs: (logs[req.params.userId] || []).slice(-30).reverse()
      });
    } catch (e) {
      console.error('Admin user detail error:', e);
      res.status(500).json({ error: '获取用户详情失败' });
    }
  });

  // ─── 点数管理 ────────────────────────────────────────

  app.post('/api/admin/credits/grant', adminAuth, (req, res) => {
    try {
      const { userId, amount, reason } = req.body;
      if (!userId || !amount || amount <= 0) {
        return res.status(400).json({ error: '参数无效' });
      }
      const users = loadUsers();
      if (!users[userId]) return res.status(404).json({ error: '用户不存在' });

      const result = addCredits(userId, parseInt(amount), 'admin_grant', reason || '管理员手动充值');
      res.json({ success: true, balance: result.balance });
    } catch (e) {
      console.error('Admin grant error:', e);
      res.status(500).json({ error: '充值失败' });
    }
  });

  app.post('/api/admin/credits/deduct', adminAuth, (req, res) => {
    try {
      const { userId, amount, reason } = req.body;
      if (!userId || !amount || amount <= 0) {
        return res.status(400).json({ error: '参数无效' });
      }
      const result = deductCredits(userId, parseInt(amount), reason || '管理员手动扣减');
      if (!result.success) {
        return res.status(400).json({ error: '扣减失败，余额不足', balance: result.balance });
      }
      res.json({ success: true, balance: result.balance });
    } catch (e) {
      console.error('Admin deduct error:', e);
      res.status(500).json({ error: '扣减失败' });
    }
  });

  // ─── 点数消耗配置 ────────────────────────────────────

  app.get('/api/admin/cost-config', adminAuth, (req, res) => {
    res.json(API_COSTS);
  });
}

module.exports = { registerAdminRoutes, adminAuth };