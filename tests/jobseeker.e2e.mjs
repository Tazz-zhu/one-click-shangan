/* ============================================================
 * jobseeker.e2e.mjs — 一键上岸 整合流程端到端测试
 * 依赖：系统 Edge/Chrome + ai-resume-agent/node_modules/playwright-core
 * 运行：node tests/jobseeker.e2e.mjs
 * 前置：interview-prep 服务已启动（http://127.0.0.1:3456）
 * ============================================================ */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const BASE = 'http://127.0.0.1:3456';
const pw = await import(pathToFileURL('C:/Users/Tazz1/Desktop/简历/ai-resume-agent/node_modules/playwright-core/index.mjs').href);
const candidates = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
].find(p => fs.existsSync(p));
if (!candidates) { console.error('[SKIP] 未找到本机 Edge/Chrome'); process.exit(0); }

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log((ok ? '✅' : '❌') + ' ' + name + (extra ? '  ' + extra : ''));
};

const browser = await pw.chromium.launch({ headless: true, executablePath: candidates });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const errs = [];
page.on('pageerror', e => errs.push('PAGE: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

try {
  // ---------- 1) 主页加载 + 品牌 ----------
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.nav-tab', { timeout: 10000 });
  const title = await page.title();
  check('主页标题为一键上岸', title.includes('一键上岸'), title);
  const brand = await page.textContent('.nav-brand');
  check('导航品牌为一键上岸', brand.includes('一键上岸'), brand.trim());
  const hasTab = await page.locator('.nav-tab[data-tab="resume-builder"]').count();
  check('存在「📄 简历助手」Tab', hasTab === 1);
  const hasImport = await page.locator('#btn-import-resume').count();
  check('分析页存在「从简历助手导入」按钮', hasImport === 1);

  // ---------- 2) 切换到简历助手 Tab，iframe 加载 ----------
  await page.click('.nav-tab[data-tab="resume-builder"]');
  await page.waitForSelector('#resume-agent-frame[data-loaded]', { timeout: 10000 });
  let frame = null;
  for (let i = 0; i < 40; i++) {
    frame = page.frames().find(f => (f.url() || '').includes('/resume-agent/index.html'));
    if (frame) break;
    await new Promise(r => setTimeout(r, 400));
  }
  check('iframe 已加载简历助手', !!frame);
  if (frame) {
    await frame.waitForLoadState('domcontentloaded');
    await frame.waitForSelector('#topbar', { timeout: 15000 });
    const bannerVisible = await frame.locator('#embed-banner').isVisible();
    check('嵌入模式横幅显示', bannerVisible);
    const embedMode = await frame.evaluate(() => document.body.classList.contains('embed-mode'));
    check('body 标记 embed-mode', embedMode === true);
    const brandName = await frame.textContent('.brand-name');
    check('简历助手品牌加载', brandName.trim() === '一键上岸', brandName.trim());
    const homeVisible = await frame.locator('#view-home.active').count();
    check('简历助手首页可见', homeVisible === 1);

    // ---------- 3) 简历 → 面试 一键同步（postMessage 桥接） ----------
    const synced = await frame.evaluate(() => {
      S.resume = {
        name: '张三',
        phone: '13800000000',
        email: 'zhangsan@example.com',
        education: { school: '测试大学', major: '计算机科学与技术', degree: '本科', gradDate: '2026.06' },
        intention: { position: '前端开发工程师', city: '北京', salary: '15k-20k' },
        experiences: [{
          id: 'exp1', title: '某科技公司', role: '前端实习生', start: '2025.06', end: '2025.09',
          bullets: ['使用 Vue3 开发 3 个业务模块，页面性能提升 40%', '参与组件库建设，沉淀 12 个通用组件']
        }],
        skills: [{ group: '前端', items: ['JavaScript', 'Vue3', 'TypeScript'] }],
        summary: '热爱前端开发的应届生，具备扎实的工程实践能力。'
      };
      S.jdText = '岗位JD：负责公司前端页面开发，熟悉 Vue3 / TypeScript 优先。';
      window.JobseekerBridge.syncToInterview();
      return { embed: window.JobseekerBridge.embed };
    });
    check('iframe 内执行同步成功', synced && synced.embed === true);
    await page.waitForFunction(() => {
      const t = document.getElementById('tab-analyze');
      return t && t.classList.contains('active');
    }, { timeout: 10000 });
    const resumeVal = await page.inputValue('#resume-input');
    const jdVal = await page.inputValue('#jd-input');
    check('父页面自动切到「分析 & 押题」', true);
    check('简历已填入「我的简历」', resumeVal.includes('张三') && resumeVal.includes('Vue3'), resumeVal.slice(0, 40));
    check('JD 已填入「岗位JD」', jdVal.includes('前端页面开发'), jdVal.slice(0, 40));
    const bridge = await page.evaluate(() => JSON.parse(localStorage.getItem('jobseeker-bridge-v1') || 'null'));
    check('共享键 jobseeker-bridge-v1 已写入', !!(bridge && bridge.resumeText && bridge.resumeText.includes('张三')));
  }

  // ---------- 4) 手动「从简历助手导入」按钮 ----------
  await page.evaluate(() => {
    localStorage.setItem('jobseeker-bridge-v1', JSON.stringify({
      resumeText: '李四\n电话：13900000000\n【教育背景】示例大学 · 软件工程 · 本科',
      jdText: '手动导入的JD文本',
      resumeName: '李四',
      updatedAt: new Date().toISOString(),
      source: 'ai-resume-agent'
    }));
  });
  await page.click('.nav-tab[data-tab="analyze"]');
  await page.waitForSelector('#btn-import-resume', { state: 'visible', timeout: 8000 });
  await page.click('#btn-import-resume');
  await page.waitForFunction(() => document.getElementById('tab-analyze').classList.contains('active'), { timeout: 8000 });
  const resumeVal2 = await page.inputValue('#resume-input');
  const jdVal2 = await page.inputValue('#jd-input');
  check('导入按钮填充简历', resumeVal2.includes('李四'), resumeVal2.slice(0, 30));
  check('导入按钮填充 JD', jdVal2.includes('手动导入的JD文本'));
  check('导入后切到分析页', true);

  // ---------- 5) 简历助手独立模式（非嵌入）不受影响 ----------
  const p2 = await browser.newPage();
  const errs2 = [];
  p2.on('pageerror', e => errs2.push(e.message));
  await p2.goto(BASE + '/resume-agent/index.html', { waitUntil: 'domcontentloaded' });
  await p2.waitForSelector('#topbar', { timeout: 15000 });
  const bannerHidden = await p2.locator('#embed-banner').isHidden();
  check('独立模式不显示嵌入横幅', bannerHidden);
  const embedCls = await p2.evaluate(() => document.body.classList.contains('embed-mode'));
  check('独立模式无 embed-mode 类', embedCls === false);
  check('独立模式无 JS 报错', errs2.length === 0, errs2.join(' | '));
  await p2.close();
} catch (e) {
  console.error('❌ 测试执行异常：', e.message);
  results.push({ name: '测试执行', ok: false, extra: e.message });
} finally {
  await page.screenshot({ path: path.join(os.tmpdir(), 'jobseeker-e2e-final.png') }).catch(() => {});
  await browser.close();
}

const failed = results.filter(r => !r.ok);
console.log('\n===== 汇总 =====');
console.log(`通过 ${results.length - failed.length}/${results.length}`);
if (errs.length) { console.log('\n页面 JS 报错：'); errs.slice(0, 10).forEach(e => console.log('  ' + e)); }
process.exit(failed.length ? 1 : 0);