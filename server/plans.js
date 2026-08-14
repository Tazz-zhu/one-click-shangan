/**
 * 套餐管理 + LemonSqueezy 支付集成
 */
const fs = require('fs');
const path = require('path');
const { addCredits } = require('./credits');
const { requireAuth } = require('./auth');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..');
const ORDERS_FILE = path.join(DATA_DIR, '.data', 'orders.json');

const PLANS = [
  {
    id: 'starter',
    name: '入门包',
    price: 19.9,
    credits: 100,
    description: '适合偶尔练习，约30次单题评估',
    popular: false,
    lemonSqueezyVariantId: process.env.LEMONSQUEEZY_VARIANT_STARTER || 'starter_variant_id'
  },
  {
    id: 'pro',
    name: '进阶包',
    price: 49.9,
    credits: 300,
    description: '适合高频练习，约100次单题评估',
    popular: true,
    lemonSqueezyVariantId: process.env.LEMONSQUEEZY_VARIANT_PRO || 'pro_variant_id'
  },
  {
    id: 'premium',
    name: '尊享包',
    price: 99.9,
    credits: 800,
    description: '全面备战，含完整模拟面试和群面',
    popular: false,
    lemonSqueezyVariantId: process.env.LEMONSQUEEZY_VARIANT_PREMIUM || 'premium_variant_id'
  },
  {
    id: 'monthly',
    name: '月卡',
    price: 29.9,
    credits: -1,
    description: '30天不限次数使用全部功能',
    popular: false,
    lemonSqueezyVariantId: process.env.LEMONSQUEEZY_VARIANT_MONTHLY || 'monthly_variant_id'
  },
  {
    id: 'yearly',
    name: '年卡',
    price: 199,
    credits: -1,
    description: '365天不限次数，平均每天不到6毛',
    popular: false,
    lemonSqueezyVariantId: process.env.LEMONSQUEEZY_VARIANT_YEARLY || 'yearly_variant_id'
  }
];

function loadOrders() {
  try {
    if (fs.existsSync(ORDERS_FILE)) {
      return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));
    }
  } catch (e) { console.error('Load orders failed:', e.message); }
  return [];
}

function saveOrders(orders) {
  try {
    const dir = path.dirname(ORDERS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), 'utf8');
  } catch (e) { console.error('Save orders failed:', e.message); }
}

function addOrder(order) {
  const orders = loadOrders();
  orders.push(order);
  saveOrders(orders);
}

function hasActiveSubscription(userId) {
  const orders = loadOrders();
  const now = new Date();
  return orders.some(o => {
    if (o.userId !== userId || o.status !== 'completed') return false;
    if (o.planId === 'monthly') {
      const expiresAt = new Date(o.createdAt);
      expiresAt.setDate(expiresAt.getDate() + 30);
      return now < expiresAt;
    }
    if (o.planId === 'yearly') {
      const expiresAt = new Date(o.createdAt);
      expiresAt.setDate(expiresAt.getDate() + 365);
      return now < expiresAt;
    }
    return false;
  });
}

function registerPlanRoutes(app) {
  const LEMONSQUEEZY_STORE_ID = process.env.LEMONSQUEEZY_STORE_ID || '';
  const LEMONSQUEEZY_API_KEY = process.env.LEMONSQUEEZY_API_KEY || '';

  app.get('/api/plans', (req, res) => {
    const safePlans = PLANS.map(p => ({
      id: p.id,
      name: p.name,
      price: p.price,
      credits: p.credits,
      description: p.description,
      popular: p.popular
    }));
    res.json(safePlans);
  });

  app.get('/api/subscription/status', requireAuth, (req, res) => {
    const active = hasActiveSubscription(req.user.userId);
    if (active) {
      const orders = loadOrders();
      const now = new Date();
      const sub = orders.find(o => {
        if (o.userId !== req.user.userId || o.status !== 'completed') return false;
        if (o.planId === 'monthly') {
          const expiresAt = new Date(o.createdAt);
          expiresAt.setDate(expiresAt.getDate() + 30);
          return now < expiresAt;
        }
        if (o.planId === 'yearly') {
          const expiresAt = new Date(o.createdAt);
          expiresAt.setDate(expiresAt.getDate() + 365);
          return now < expiresAt;
        }
        return false;
      });
      if (sub) {
        const expiresAt = new Date(sub.createdAt);
        expiresAt.setDate(expiresAt.getDate() + (sub.planId === 'monthly' ? 30 : 365));
        return res.json({ active: true, planId: sub.planId, expiresAt: expiresAt.toISOString() });
      }
    }
    res.json({ active: false });
  });

  app.post('/api/payment/create-checkout', requireAuth, async (req, res) => {
    try {
      const { planId } = req.body;
      const plan = PLANS.find(p => p.id === planId);
      if (!plan) {
        return res.status(400).json({ error: '无效的套餐' });
      }

      if (!LEMONSQUEEZY_STORE_ID || !LEMONSQUEEZY_API_KEY) {
        const mockOrderId = 'dev_' + Date.now().toString(36);
        addOrder({
          orderId: mockOrderId,
          userId: req.user.userId,
          planId: plan.id,
          credits: plan.credits,
          amount: plan.price,
          status: 'pending',
          createdAt: new Date().toISOString()
        });
        return res.json({
          checkoutUrl: `/api/payment/mock-checkout?orderId=${mockOrderId}`,
          orderId: mockOrderId
        });
      }

      const response = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${LEMONSQUEEZY_API_KEY}`
        },
        body: JSON.stringify({
          data: {
            type: 'checkouts',
            attributes: {
              checkout_data: {
                custom: {
                  user_id: req.user.userId,
                  plan_id: plan.id
                }
              },
              product_options: {
                redirect_url: process.env.APP_URL ? `${process.env.APP_URL}/?payment=success` : '/?payment=success'
              }
            },
            relationships: {
              store: { data: { type: 'stores', id: LEMONSQUEEZY_STORE_ID } },
              variant: { data: { type: 'variants', id: plan.lemonSqueezyVariantId } }
            }
          }
        })
      });

      const data = await response.json();
      if (!response.ok) {
        console.error('LemonSqueezy checkout error:', data);
        return res.status(500).json({ error: '创建支付链接失败' });
      }

      const checkoutUrl = data.data.attributes.url;
      const orderId = data.data.id;

      addOrder({
        orderId,
        userId: req.user.userId,
        planId: plan.id,
        credits: plan.credits,
        amount: plan.price,
        status: 'pending',
        createdAt: new Date().toISOString()
      });

      res.json({ checkoutUrl, orderId });
    } catch (e) {
      console.error('Create checkout error:', e);
      res.status(500).json({ error: '创建支付链接失败' });
    }
  });

  app.get('/api/payment/mock-checkout', (req, res) => {
    const { orderId } = req.query;
    handleSuccessfulPayment(orderId);
    res.send(`
      <html><head><meta charset="utf-8"><title>支付成功</title>
      <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#fdfaf5;}
      .card{background:#fff;padding:2rem;border-radius:8px;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,0.1);}
      h2{color:#c8872b;}</style></head>
      <body><div class="card"><h2>支付成功！</h2><p>点数已充值到你的账户</p>
      <p><a href="/">返回应用</a></p></div>
      <script>setTimeout(function(){window.location.href='/?payment=success'},2000);</script></body></html>
    `);
  });

  app.post('/api/payment/webhook', (req, res) => {
    try {
      const event = req.body;
      if (event.meta.event_name === 'order_created' || event.meta.event_name === 'order_paid') {
        const orderId = event.data.id;
        handleSuccessfulPayment(orderId);
      }
      res.json({ received: true });
    } catch (e) {
      console.error('Webhook error:', e);
      res.status(500).json({ error: '处理失败' });
    }
  });

  function handleSuccessfulPayment(orderId) {
    const orders = loadOrders();
    const order = orders.find(o => o.orderId === orderId);
    if (!order || order.status === 'completed') return;

    order.status = 'completed';
    saveOrders(orders);

    if (order.credits > 0) {
      addCredits(order.userId, order.credits, 'purchase', `套餐: ${order.planId}`);
    }
  }
}

module.exports = { registerPlanRoutes, hasActiveSubscription, PLANS, loadOrders, saveOrders, addOrder };
