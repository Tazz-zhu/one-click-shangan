// ============================================================
// opencli 一键安装 & 环境检测节点
// ============================================================

const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

/**
 * 流式报告回调: (step, detail, status) => void
 * status: 'running' | 'ok' | 'warn' | 'error'
 */
function report(cb, step, detail, status) {
  if (cb) cb({ step, detail, status });
}

/**
 * 检测 opencli 所有状态
 */
function detectOpencli() {
  const info = {
    installed: false, version: '', path: '',
    daemon_running: false, ext_installed: false, browser_ready: false,
    has_xiaohongshu: false, has_web: false, has_boss: false,
    node_version: process.version
  };

  // 1) CLI 版本
  try {
    const ver = execSync('opencli --version', { shell: true, timeout: 5000, encoding: 'utf-8' }).trim();
    if (ver) { info.installed = true; info.version = ver; }
  } catch {
    // 尝试通过 npm 全局路径探测
    try {
      const root = execSync('npm root -g', { shell: true, timeout: 5000, encoding: 'utf-8' }).trim();
      if (root) {
        const bin = path.join(root, '.bin', 'opencli.cmd');
        if (fs.existsSync(bin)) {
          const v = execSync(`"${bin}" --version`, { shell: true, timeout: 5000, encoding: 'utf-8' }).trim();
          if (/^\d+\.\d+/.test(v)) { info.installed = true; info.version = v; info.path = bin; }
        }
      }
    } catch {}
  }

  if (info.installed) {
    // 2) 站点适配器
    try {
      const list = execSync('opencli list 2>&1', { shell: true, timeout: 8000, encoding: 'utf-8' });
      info.has_xiaohongshu = list.includes('xiaohongshu');
      info.has_web = list.includes('web');
      info.has_boss = list.includes('boss');
    } catch {}

    // 3) Doctor
    try {
      const d = execSync('opencli doctor 2>&1', { shell: true, timeout: 8000, encoding: 'utf-8' });
      info.daemon_running = /daemon.*running/i.test(d) || /Daemon:.*OK/i.test(d);
      info.ext_installed = /extension.*connected/i.test(d) || /Extension:.*OK/i.test(d);
      info.browser_ready = info.daemon_running && info.ext_installed;
    } catch {}
  }
  return info;
}

/**
 * 获取 Windows 系统默认浏览器
 * 通过注册表读取 HTTP/HTTPS 协议关联的 ProgId
 */
function getDefaultBrowserReg() {
  try {
    // HKCU takes priority over HKLM
    for (const hive of ['HKCU', 'HKLM']) {
      for (const key of ['HTTPS', 'HTTP']) {
        const out = execSync(`reg query "${hive}\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\${key}\\UserChoice" /v ProgId 2>nul`, { shell: true, timeout: 3000, encoding: 'utf-8' }).trim();
        const m = out.match(/ProgId\s+REG_SZ\s+(.+)/i);
        if (m) return m[1].toLowerCase();
      }
    }
  } catch {}
  return '';
}

/**
 * 查找系统上已安装的 Chromium 系浏览器
 * 按默认浏览器优先排序
 * 返回 [{ name, path, type: 'chrome'|'edge'|'brave'|'chromium' }]
 */
function findBrowsers() {
  const defaultProgId = getDefaultBrowserReg();
  const isDefaultEdge = defaultProgId && (defaultProgId.includes('edge') || defaultProgId.includes('mse'));
  const isDefaultChrome = defaultProgId && defaultProgId.includes('chrome');

  const browsers = [];
  const allCandidates = [
    { name: 'Microsoft Edge', paths: [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ], type: 'edge' },
    { name: 'Google Chrome', paths: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      (process.env.LOCALAPPDATA || '') + '\\Google\\Chrome\\Application\\chrome.exe'
    ], type: 'chrome' },
    { name: 'Brave', paths: [
      'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
      (process.env.LOCALAPPDATA || '') + '\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'
    ], type: 'brave' },
    { name: 'Chromium', paths: [
      'C:\\Program Files\\Chromium\\Application\\chrome.exe',
      (process.env.LOCALAPPDATA || '') + '\\Chromium\\Application\\chrome.exe'
    ], type: 'chromium' },
  ];

  // 排序：默认浏览器排到最前面
  if (isDefaultEdge) {
    allCandidates.sort((a, b) => a.type === 'edge' ? -1 : b.type === 'edge' ? 1 : 0);
  } else if (isDefaultChrome) {
    allCandidates.sort((a, b) => a.type === 'chrome' ? -1 : b.type === 'chrome' ? 1 : 0);
  }

  for (const c of allCandidates) {
    for (const p of c.paths) {
      if (p && fs.existsSync(p)) {
        browsers.push({ name: c.name, path: p, type: c.type });
        break;
      }
    }
  }
  return browsers;
}

/**
 * 获取 opencli 最新 release 的扩展 zip 下载 URL
 * 访问 GitHub API 获取 opencli releases
 */
function getExtensionDownloadUrl() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: '/repos/jackwener/opencli/releases/latest',
      headers: { 'User-Agent': 'one-click-shangan', 'Accept': 'application/vnd.github.v3+json' }
    };
    https.get(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const release = JSON.parse(data);
          const extAsset = (release.assets || []).find(a =>
            a.name && (a.name.includes('extension') || a.name.includes('ext')));
          if (extAsset) {
            resolve({ url: extAsset.browser_download_url, tag: release.tag_name || 'latest' });
          } else {
            // Fallback: use the direct download URL pattern
            resolve({
              url: `https://github.com/jackwener/opencli/releases/download/${release.tag_name || 'latest'}/opencli-extension.zip`,
              tag: release.tag_name || 'latest'
            });
          }
        } catch {
          resolve({ url: null, tag: 'latest' });
        }
      });
    }).on('error', () => resolve({ url: null, tag: 'latest' }));
  });
}

/**
 * 下载文件到指定路径，支持 302 重定向
 */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // follow redirect
        downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`下载失败: HTTP ${res.statusCode}`));
        return;
      }
      const file = fs.createWriteStream(destPath);
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * 通过 CDP 打开 chrome://extensions 并尝试开启开发者模式
 * 使用 opencli CDP 命令（如果 daemon 已运行）
 */
function openExtensionsPage(browserPath) {
  try {
    // 尝试使用 opencli 自带的 browser 命令打开
    execSync(`opencli browser open chrome://extensions`, {
      shell: true, timeout: 10000, encoding: 'utf-8', stdio: ['pipe','pipe','pipe']
    });
    return true;
  } catch {
    // Fallback: 直接用浏览器打开
    try {
      execSync(`start "" "${browserPath}" "chrome://extensions"`, {
        shell: true, timeout: 5000, encoding: 'utf-8', stdio: ['pipe','pipe','pipe']
      });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * 主流程: 一键安装 opencli 扩展
 * @param {function} statusCb - 状态报告回调 ({ step, detail, status })
 * @returns {object} { success, message, details }
 */
async function setupOpencliExtension(statusCb) {
  const r = (step, detail, status) => report(statusCb, step, detail, status);

  // ── Step 1: 检测当前状态 ──
  r('check', '正在检测 opencli 环境...', 'running');
  const initial = detectOpencli();
  console.log('[Setup] 初始检测:', JSON.stringify(initial, null, 2));

  if (!initial.installed) {
    r('check', '❌ opencli 未安装', 'error');
    r('install_cli', '请在终端执行: npm install -g @jackwener/opencli', 'warn');
    return { success: false, message: 'opencli 未安装。请在终端执行: npm install -g @jackwener/opencli，然后重试。', details: initial };
  }
  r('check', `✅ opencli v${initial.version}`, 'ok');

  // ── 如果已经全部就绪，跳过安装流程 ──
  if (initial.browser_ready && initial.has_xiaohongshu) {
    r('verify', '✅ opencli 环境已全部就绪，无需配置', 'ok');
    r('done', 'Daemon运行中 · 扩展已连接 · 小红书可用', 'ok');
    return { success: true, message: '环境已就绪', details: initial };
  }

  // ── Step 2: 确保 daemon 运行 ──
  if (!initial.daemon_running) {
    r('daemon', '正在启动 opencli daemon...', 'running');
    try {
      execSync('opencli daemon start', { shell: true, timeout: 10000, encoding: 'utf-8', stdio: ['pipe','pipe','pipe'] });
      await sleep(2000);
      const dt = detectOpencli();
      if (dt.daemon_running) {
        r('daemon', '✅ Daemon 已启动', 'ok');
      } else {
        r('daemon', '⚠️ Daemon 可能未正常启动，继续尝试...', 'warn');
      }
    } catch (e) {
      console.warn('[Setup] daemon start error:', e.message);
      r('daemon', '⚠️ Daemon 启动失败: ' + e.message.slice(0, 60), 'warn');
    }
  } else {
    r('daemon', '✅ Daemon 已运行', 'ok');
  }
  await sleep(300);

  // ── Step 3: 下载扩展 ──
  const extDir = path.join(
    process.env.APPDATA || path.join(require('os').homedir(), 'AppData', 'Roaming'),
    'one-click-shangan', 'opencli-extension'
  );
  r('download', '正在获取扩展下载地址...', 'running');
  const { url: downloadUrl, tag } = await getExtensionDownloadUrl();

  if (!downloadUrl) {
    r('download', '⚠️ 无法获取下载地址，将手动引导', 'warn');
  } else {
    r('download', `正在下载扩展 (${tag})...`, 'running');
    try {
      const zipPath = path.join(require('os').tmpdir(), 'opencli-extension.zip');
      // clean old
      try { fs.unlinkSync(zipPath); } catch {}
      await downloadFile(downloadUrl, zipPath);

      r('download', '正在解压...', 'running');
      await extractZip(zipPath, extDir);
      try { fs.unlinkSync(zipPath); } catch {}

      r('download', `✅ 扩展已解压到 ${extDir}`, 'ok');
    } catch (e) {
      console.warn('[Setup] 下载/解压失败:', e.message);
      r('download', `⚠️ 下载失败: ${e.message.slice(0, 60)}`, 'warn');
    }
  }
  await sleep(300);

  // ── Step 4: 查找浏览器并打开扩展页 ──
  const browsers = findBrowsers();
  if (browsers.length === 0) {
    r('browser', '❌ 未找到 Chrome/Edge/Brave', 'error');
    return { success: false, message: '未检测到 Chrome 系浏览器，请确保已安装 Chrome 或 Edge。', details: initial };
  }
  const primaryBrowser = browsers[0];
  r('browser', `检测到 ${primaryBrowser.name}`, 'running');

  r('ext_page', `正在打开扩展管理页面...`, 'running');
  const opened = openExtensionsPage(primaryBrowser.path);
  if (opened) {
    r('ext_page', `✅ 已打开 ${primaryBrowser.name} 扩展管理页`, 'ok');
  } else {
    r('ext_page', `⚠️ 无法自动打开，请手动在浏览器地址栏输入 chrome://extensions`, 'warn');
  }

  // 拖拽安装说明
  r('ext_install', '', 'running');
  const extExists = fs.existsSync(extDir) && fs.readdirSync(extDir).some(f => f === 'manifest.json' || f.endsWith('.json'));
  if (extExists) {
    r('ext_install',
      `📂 扩展文件已准备就绪\n\n请按以下步骤操作：\n1. 在扩展管理页面开启「开发者模式」（右上角开关）\n2. 点击「加载已解压的扩展」\n3. 选择文件夹:\n   ${extDir}\n\n或直接将该文件夹拖入扩展页面`,
      'warn');
  } else {
    // 引导到 Chrome Web Store
    r('ext_install',
      `📎 请前往 Chrome 应用商店安装 OpenCLI 扩展\n\nhttps://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk`,
      'warn');
  }

  r('ext_install_wait', '等待扩展安装完成...', 'running');

  // ── Step 5: 轮询验证（最多 30 秒） ──
  let verified = false;
  for (let i = 0; i < 15; i++) {
    await sleep(2000);
    const cur = detectOpencli();
    if (cur.ext_installed) {
      r('verify', '✅ 扩展已连接！opencli 环境就绪', 'ok');
      verified = true;
      break;
    }
    if (i % 3 === 2) {
      r('verify', `⏳ 等待扩展连接 (${(i+1)*2}s)...`, 'running');
    }
  }

  if (!verified) {
    r('verify', '⚠️ 扩展未检测到连接', 'warn');
    r('verify_tip', `已尝试安装到: ${extDir}\n如扩展已手动安装，请尝试:\n1. 关闭浏览器\n2. 终端执行: opencli daemon restart\n3. 重新打开浏览器\n4. 回来点「重新检测」`, 'warn');
  }

  const final = detectOpencli();
  return {
    success: final.browser_ready,
    message: final.browser_ready ? 'opencli 环境配置完成！' : '部分步骤需要手动操作',
    details: final
  };
}

// ─── Helpers ───

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractZip(zipPath, destDir) {
  if (fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });

  // Try 7z first
  try {
    execSync(`7z x "${zipPath}" -o"${destDir}" -y`, { stdio: 'pipe', timeout: 30000, encoding: 'utf-8' });
    return;
  } catch {}

  // Try PowerShell Expand-Archive
  try {
    // PowerShell Expand-Archive needs .zip extension explicitly
    const psZip = zipPath.endsWith('.zip') ? zipPath : zipPath + '.zip';
    if (!fs.existsSync(psZip)) fs.copyFileSync(zipPath, psZip);
    execSync(`powershell -Command "Expand-Archive -Path '${psZip}' -DestinationPath '${destDir}' -Force"`, { stdio: 'pipe', timeout: 30000, encoding: 'utf-8' });
    return;
  } catch {}

  // Try tar
  try {
    execSync(`tar -xf "${zipPath}" -C "${destDir}"`, { stdio: 'pipe', timeout: 30000, encoding: 'utf-8' });
    return;
  } catch {}

  throw new Error('无法解压 zip 文件');
}

module.exports = { detectOpencli, setupOpencliExtension, findBrowsers };
