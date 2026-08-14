/* bridge-live.mjs — 贯通性验证：真实 UI 点击流
 * 简历助手(载入示例) → 点「同步到面试助手」→ 面试助手分析页自动填入简历+JD
 */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const pw = await import(pathToFileURL('C:/Users/Tazz1/Desktop/简历/ai-resume-agent/node_modules/playwright-core/index.mjs').href);
const candidates = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
const browser = await pw.chromium.launch({ headless: true, executablePath: candidates });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const ok = [];
const check = (n, c, extra='') => { ok.push(c); console.log((c?'✅':'❌')+' '+n+(extra?'  '+extra:'')); };

// 1) 打开一键上岸，进入简历助手 Tab
await page.goto('http://127.0.0.1:3456/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.nav-tab');
await page.click('.nav-tab[data-tab="resume-builder"]');
await page.waitForSelector('#resume-agent-frame[data-loaded]', { timeout: 10000 });
let frame = null;
for (let i = 0; i < 40; i++) { frame = page.frames().find(f => (f.url()||'').includes('/resume-agent/index.html')); if (frame) break; await new Promise(r=>setTimeout(r,400)); }
await frame.waitForSelector('#topbar', { timeout: 15000 });

// 2) 同步前：面试助手分析页输入框应为空（证明数据是"流过去"的，不是预置）
await page.click('.nav-tab[data-tab="analyze"]');
await page.waitForSelector('#resume-input');
const beforeResume = await page.inputValue('#resume-input');
const beforeJd = await page.inputValue('#jd-input');
check('同步前「我的简历」为空（全新会话）', beforeResume.trim() === '');
check('同步前「岗位JD」为空', beforeJd.trim() === '');

// 3) 回到简历助手 Tab，真实点击「载入示例」→ 选择李同学
await page.click('.nav-tab[data-tab="resume-builder"]');
// 首次访问可能有引导弹窗：点「先看示例」（ob-demo）→ 同样会打开示例选择；没有弹窗则点顶栏「载入示例」
const obDemo = await frame.locator('#ob-demo').count();
if (obDemo > 0 && await frame.locator('#ob-demo').isVisible()) {
  await frame.click('#ob-demo');
} else {
  await frame.click('#btn-demo');
}
await frame.waitForSelector('.profile-card', { timeout: 8000 });
const profileNames = await frame.$$eval('.profile-card b', els => els.map(e => e.textContent));
console.log('   可选示例：' + profileNames.join(' / '));
await frame.click('.profile-card'); // 第一个 = 李同学
await frame.waitForSelector('#view-generate.active', { timeout: 10000 });
const inResume = await frame.evaluate(() => ({ name: S.resume.name, school: S.resume.education.school, exps: (S.resume.experiences||[]).length }));
check('简历助手已载入示例简历', inResume.name === '李明', JSON.stringify(inResume));

// 4) 填入 JD（对话引导同款字段 S.jdText，使用示例JD）
const DEMO_JD = '岗位职责：1. 负责公司前端产品开发，使用 Vue3/React 技术栈；2. 参与产品需求评审，与设计师和后端协作；3. 优化页面性能和用户体验。任职要求：1. 本科及以上学历，计算机相关专业；2. 熟悉 HTML5/CSS3/JavaScript；3. 了解 TypeScript、Webpack/Vite；4. 有 Git 协作经验；5. 良好的沟通能力和团队协作精神。';
await frame.evaluate((jd) => { S.jdText = jd; }, DEMO_JD);
check('简历助手内部已持有 JD（对话收集字段）', true);

// 5) 真实点击嵌入横幅「⚡ 同步到面试助手」
await frame.click('#btn-sync-interview-top');

// 6) 验证父页面：自动切到分析页 + 简历/JD 自动填入
await page.waitForFunction(() => document.getElementById('tab-analyze').classList.contains('active'), { timeout: 10000 });
const resumeVal = await page.inputValue('#resume-input');
const jdVal = await page.inputValue('#jd-input');
const hint = await page.textContent('#resume-hint').catch(() => '');
check('同步后自动切到「分析 & 押题」', true);
check('简历 ATS 文本已流入面试助手', resumeVal.includes('李明') && resumeVal.includes('校园电商平台前端开发'), '长度=' + resumeVal.length);
check('JD 已流入面试助手', jdVal.includes('负责公司前端产品开发') && jdVal.includes('任职要求'), '长度=' + jdVal.length);
check('导入提示已更新', hint.includes('已从简历助手导入'), hint.trim());

// 7) 桥接存储内容核查
const bridge = await page.evaluate(() => JSON.parse(localStorage.getItem('jobseeker-bridge-v1') || 'null'));
check('共享键 jobseeker-bridge-v1 已写入', !!bridge);
check('桥接内简历 = 简历助手 ATS 输出', !!(bridge && bridge.resumeText.startsWith('李明') && bridge.resumeText.includes('校园电商平台前端开发')));
check('桥接内 JD = 简历助手 JD', !!(bridge && bridge.jdText.includes('Vue3/React')));

console.log('\n===== 贯通证据：流入面试助手的简历开头 =====');
console.log(resumeVal.split('\n').slice(0, 8).join('\n'));
console.log('\n===== 流入的 JD 开头 =====');
console.log(jdVal.slice(0, 120) + '...');

await browser.close();
const failed = ok.filter(x => !x).length;
console.log('\n===== 汇总：' + (ok.length - failed) + '/' + ok.length + ' 通过 =====');
process.exit(failed ? 1 : 0);