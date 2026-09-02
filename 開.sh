#!/bin/zsh
# 開星歷儀表板。
#
# 資料在 ~/星歷資料/，程式在這個資料夾。兩個是分開的——
# 這樣把專案推上 GitHub 的時候，資料不可能跟著上去。

cd "$(dirname "$0")"

PORT=${1:-8787}

# 已經開著就不要再開一個，直接把瀏覽器叫出來
if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
    echo "已經開著了。"
    open "http://127.0.0.1:$PORT"
    exit 0
fi

python3 server.py --port "$PORT" &
SERVER=$!

sleep 1
open "http://127.0.0.1:$PORT"

echo
echo "關掉：在這個視窗按 Escape（注音模式下 Ctrl+C 會被吃掉）"
wait $SERVER
