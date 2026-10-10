#!/bin/zsh -l
cd "${0:A:h}" || exit 1
if ! command -v node >/dev/null 2>&1; then
  print '请先安装 Node.js 20 或更新版本，再双击此文件。'
  read '?按回车退出…'
  exit 1
fi
if [[ ! -d node_modules/three || ! -d node_modules/ws ]]; then
  print '首次启动，正在安装游戏依赖…'
  npm ci --no-audit --no-fund || { read '?安装失败，请检查网络。按回车退出…'; exit 1; }
fi
node server.js
read '?游戏服务已停止，按回车退出…'
