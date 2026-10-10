#!/bin/zsh
cd "${0:A:h}"
if ! command -v node >/dev/null 2>&1; then
  echo '需要先安装 Node.js 20 或以上版本。'
  read '?按回车关闭窗口…'
  exit 1
fi
if [[ ! -d node_modules/three || ! -d node_modules/ws ]]; then
  npm install --no-audit --no-fund || exit 1
fi
npm start
read '?按回车关闭窗口…'
