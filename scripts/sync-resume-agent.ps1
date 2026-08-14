# ============================================================
# sync-resume-agent.ps1 — 把「一键上岸 简历助手」同步进一键上岸
# 用法：powershell -ExecutionPolicy Bypass -File scripts\sync-resume-agent.ps1
# 来源：../ai-resume-agent（本仓库同级目录）
# 目标：public/resume-agent（由 一键上岸 服务端直接托管）
# ============================================================
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$src  = Join-Path (Split-Path -Parent $root) 'ai-resume-agent'
$dst  = Join-Path $root 'public\resume-agent'

if (-not (Test-Path $src)) {
  Write-Host "未找到简历助手源码：$src" -ForegroundColor Red
  exit 1
}
New-Item -ItemType Directory -Force -Path $dst | Out-Null
foreach ($item in @('index.html','help.html','privacy.html','terms.html','css','js')) {
  $p = Join-Path $src $item
  if (Test-Path $p) { Copy-Item -Path $p -Destination $dst -Recurse -Force }
}
Write-Host "✅ 简历助手已同步到 $dst" -ForegroundColor Green