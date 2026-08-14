# ============================================================
# 一键上岸 一键启动脚本（Windows）
# 浏览器打开 http://localhost:3456
# ============================================================
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

if (-not (Test-Path (Join-Path $root 'node_modules'))) {
  Write-Host '首次运行：安装依赖（npm install）...' -ForegroundColor Yellow
  Push-Location $root
  try { npm install } finally { Pop-Location }
}

Write-Host '🚀 一键上岸 启动中...' -ForegroundColor Green
Write-Host '   浏览器打开 → http://localhost:3456' -ForegroundColor Cyan
Push-Location $root
try { node server.js } finally { Pop-Location }