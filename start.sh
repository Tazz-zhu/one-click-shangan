# Render 启动脚本 — 确保数据目录存在
mkdir -p .local .data 2>/dev/null
node server.js
