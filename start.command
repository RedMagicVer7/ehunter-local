#!/bin/zsh
# 双击启动 eHunter Local：按需构建 → 启动本地书库服务 → 在 Chrome 中打开
LIBRARY="${EHUNTER_LIBRARY:-$HOME/Downloads/南斯拉夫四部曲/阅读版CBZ}"
PORT="${PORT:-5177}"
URL="http://127.0.0.1:$PORT"

cd "$(dirname "$0")" || exit 1
mkdir -p .tmp

if ! curl -s -o /dev/null "$URL/api/library"; then
    [ -d node_modules ] || npm install --no-audit --no-fund || exit 1
    if [ ! -f dist/index.html ] || [ -n "$(find src core index.html -newer dist/index.html -print -quit)" ]; then
        npm run build-only || exit 1
    fi
    PORT="$PORT" nohup node server/index.mjs "$LIBRARY" > .tmp/server.log 2>&1 &
    for _ in {1..50}; do
        curl -s -o /dev/null "$URL/api/library" && break
        sleep 0.2
    done
fi

open -a "Google Chrome" "$URL"
