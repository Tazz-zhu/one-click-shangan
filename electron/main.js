// ============================================================
// 一键上岸 — Electron Main Process
// ============================================================
const { app, BrowserWindow, shell, dialog, Menu, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let loadingWindow = null;
let _serverModule = null;

// ── 读取版本号 ──
function getAppVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    return pkg.version || '1.0.0';
  } catch { return '1.0.0'; }
}

// ── 创建主窗口 ──
function createMainWindow(PORT) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 640,
    title: '一键上岸 — 简历助手 + 面试助手（AI押题/模拟面试）',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f172a'
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (loadingWindow) { loadingWindow.close(); loadingWindow = null; }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── 启动加载窗口 ──
function showLoadingWindow() {
  loadingWindow = new BrowserWindow({
    width: 500, height: 360, frame: false, transparent: false,
    resizable: false, alwaysOnTop: true, backgroundColor: '#0f172a',
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });
  loadingWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,'Microsoft YaHei',sans-serif;background:#0f172a;color:#e2e8f0;
display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;overflow:hidden;}
.logo{font-size:2.5rem;margin-bottom:0.3rem}
.title{font-size:1.3rem;font-weight:700;color:#818cf8;margin-bottom:0.2rem}
.sub{font-size:0.78rem;color:#64748b;margin-bottom:1.5rem}
.loader{width:200px;height:3px;background:#1e293b;border-radius:2px;overflow:hidden}
.loader-fill{width:30%;height:100%;background:linear-gradient(90deg,#818cf8,#10b981);border-radius:2px;animation:load 1.2s ease-in-out infinite}
@keyframes load{0%{width:10%;margin-left:0}50%{width:50%;margin-left:25%}100%{width:10%;margin-left:90%}}
.tip{font-size:0.72rem;color:#475569;margin-top:1.2rem}
</style></head><body>
<div class="logo">🎯</div>
<div class="title">一键上岸</div>
<div class="sub">AI 面试押题 · 模拟面试官</div>
<div class="loader"><div class="loader-fill"></div></div>
<div class="tip">正在启动服务...</div>
</body></html>
`)}`);
}

// ── 菜单栏 ──
function buildMenu() {
  const appVersion = getAppVersion();
  const template = [
    {
      label: '应用',
      submenu: [
        { label: '关于 一键上岸', click: () => dialog.showMessageBox(mainWindow, { title: '关于', message: '一键上岸 v' + appVersion + '\n\n简历助手 + 面试助手（AI押题/模拟面试）\n\n基于 OpenCLI + LLM 驱动', type: 'info' }) },
        { type: 'separator' },
        { label: '退出', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '刷新' },
        { role: 'forceReload', label: '强制刷新' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        { label: 'OpenCLI 文档', click: () => shell.openExternal('https://github.com/jackwener/OpenCLI') },
        { label: 'GitHub 项目', click: () => shell.openExternal('https://github.com/Tazz-zhu/one-click-shangan') }
      ]
    }
  ];
  if (process.platform === 'darwin') {
    template.unshift({ label: app.getName(), submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] });
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── IPC: 获取版本号 ──
ipcMain.handle('get-app-version', () => {
  return getAppVersion();
});

// ── App 生命周期 ──
app.whenReady().then(async () => {
  buildMenu();
  showLoadingWindow();

  try {
    // Electron 模式下，数据目录必须指向真实文件系统（asar 只读）
    const userDataPath = app.getPath('userData');
    process.env.DATA_DIR = userDataPath;
    process.env.ELECTRON_MODE = '1';
    // 不让 AI_PROVIDER_KIT_PATH 覆盖代码路径 —— 代码在 asar 内，通过 __dirname/../ai-provider-kit 自动找到
    // 配置文件路径由 ai-provider.js 内部的 DATA_DIR 判断重定向

    // 确保数据目录存在
    try { fs.mkdirSync(path.join(userDataPath, '.data'), { recursive: true }); } catch {}
    try { fs.mkdirSync(path.join(userDataPath, 'logs'), { recursive: true }); } catch {}
    try { fs.mkdirSync(path.join(userDataPath, '.local'), { recursive: true }); } catch {}

    // 直接 require server.js —— Electron 主进程本身就是 Node，无需 spawn 子进程
    _serverModule = require('../server.js');
    await _serverModule.startServer();
    createMainWindow(_serverModule.PORT || 3456);
  } catch (err) {
    if (loadingWindow) loadingWindow.close();
    dialog.showErrorBox('启动失败',
      `无法启动后端服务。\n\n错误: ${err.message}`);
    app.quit();
  }
});

// ── 一键更新：IPC 处理 ──
const UPDATE_TEMP_DIR = path.join(require('os').tmpdir(), 'yijianshangan-update');

// 每次启动时检查是否有待安装的更新
app.whenReady().then(() => {
  try {
    if (fs.existsSync(UPDATE_TEMP_DIR)) {
      const appRoot = path.dirname(path.dirname(__dirname)); // electron/ → mvp root
      copyDirSync(UPDATE_TEMP_DIR, appRoot);
      fs.rmSync(UPDATE_TEMP_DIR, { recursive: true, force: true });
      console.log('[Update] 已安装待处理更新');
    }
  } catch (e) { console.warn('[Update] 安装待处理更新失败:', e.message); }
});

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) { copyDirSync(s, d); }
    else { try { fs.copyFileSync(s, d); } catch {} }
  }
}

ipcMain.handle('install-update', async (_event, downloadUrl) => {
  try {
    const https = require('https');
    const { spawnSync } = require('child_process');
    const zipPath = path.join(require('os').tmpdir(), '一键上岸-update.zip');

    // 1. 下载 zip
    await new Promise((resolve, reject) => {
      const file = fs.createWriteStream(zipPath);
      https.get(downloadUrl, (resp) => {
        if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
          // Follow redirect
          https.get(resp.headers.location, (r2) => {
            r2.pipe(file);
            file.on('finish', () => { file.close(); resolve(); });
          }).on('error', reject);
          return;
        }
        resp.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      }).on('error', reject);
    });

    // 2. 解压到临时目录
    if (fs.existsSync(UPDATE_TEMP_DIR)) fs.rmSync(UPDATE_TEMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(UPDATE_TEMP_DIR, { recursive: true });
    spawnSync('7z', ['x', zipPath, `-o${UPDATE_TEMP_DIR}`, '-y'], { stdio: 'pipe' });

    // 3. 查找解压后的实际内容目录 (可能是 win-unpacked 子目录)
    const extractedDirs = fs.readdirSync(UPDATE_TEMP_DIR, { withFileTypes: true }).filter(d => d.isDirectory());
    let contentDir = UPDATE_TEMP_DIR;
    if (extractedDirs.length === 1 && extractedDirs[0].name === 'win-unpacked') {
      contentDir = path.join(UPDATE_TEMP_DIR, 'win-unpacked');
    }

    // 4. 清理下载文件
    try { fs.unlinkSync(zipPath); } catch {}

    return { success: true, message: '更新已下载，重启后生效。是否立即重启？', contentDir };
  } catch (e) {
    return { success: false, message: '更新失败: ' + (e.message || '未知错误') };
  }
});

ipcMain.on('restart-app', () => {
  app.relaunch();
  app.exit(0);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 确保退出时彻底清理所有进程
app.on('will-quit', () => {
  // 关闭 HTTP 服务器，释放端口
  if (_serverModule && typeof _serverModule.stopServer === 'function') {
    _serverModule.stopServer();
  }
  // 强制退出进程，确保不会有残留（Windows 上尤为重要）
  app.exit(0);
});

app.on('activate', () => {
  if (mainWindow === null) {
    createMainWindow((_serverModule && _serverModule.PORT) || 3456);
  }
});
