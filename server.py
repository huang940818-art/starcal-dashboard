#!/usr/bin/env python3
"""星歷儀表板的本機資料服務。

為什麼需要一支 server，而不是讓網頁自己用 localStorage：

1. **localStorage 會消失。** 清一次瀏覽器快取，記帳資料就沒了。
   備忘錄丟了還能重寫，帳目丟了是真的回不來。
2. **檔案才能被別的東西讀。** 資料存成 JSON 放在家目錄，別的工具
   （例如 Claude Code）就能直接讀寫——「幫我記一筆早餐 65」
   「這個月餐費多少」才做得到。鎖在瀏覽器裡的資料誰都碰不到，
   那就只是個比較漂亮的記事本。
3. **備份就是複製檔案。**

## 安全

記帳和備忘是私人的東西，所以：

- **預設只綁 127.0.0.1**，不對外開。要在手機上看，用 `--host` 指定一個
  私有網路（例如 Tailscale）的位址——那種介面只有同一個網路內看得到。
- 資料檔權限 600。同一台機器上的其他帳號也不該讀得到。
- 檔名走白名單，不接受路徑——`../` 這種東西連進得來的機會都不給。

## 存檔

先寫暫存檔再 rename。中途斷電的話，舊檔還是完整的舊檔，
不會變成寫到一半的壞 JSON。每次覆蓋前留一份備份，保留最近 20 份。
"""

from __future__ import annotations

import argparse
import hashlib
import http.server
import json
import os
import shutil
import socketserver
import sys
import time
import urllib.parse
from pathlib import Path

# 資料放家目錄，**刻意不在專案資料夾裡**。
# 這個專案要放上作品集，資料夾不在 repo 底下就不可能被 commit 上去。
# 可以用環境變數指到別的地方——測試要在乾淨的空資料上跑，
# 不能拿真的帳目當試驗場。平常不設就是家目錄那份。
DATA_DIR = Path(os.environ.get("STARCAL_DATA_DIR") or (Path.home() / "星歷資料"))
BACKUP_DIR = DATA_DIR / "備份"
WEB_DIR = Path(__file__).resolve().parent

# 白名單。前端只認得這幾份，多的不給。
FILES = {
    "記帳": "記帳.json",
    "待辦": "待辦.json",
    "行事曆": "行事曆.json",
    "備忘": "備忘.json",
    "便利貼": "便利貼.json",
    "課表": "課表.json",
    "設定": "設定.json",
    "小克": "小克.json",
}

# 一份資料還不存在時的起始形狀。
# 空字典也可以，但那樣前端每個地方都要寫 `?? []`，很容易漏掉一個就爆掉。
EMPTY = {
    "記帳": {
        "accounts": [],
        "transactions": [],
        "subscriptions": [],
        "budgets": [],
        "categories": {"expense": [], "income": []},
    },
    "待辦": {"items": []},
    "行事曆": {"events": []},
    "備忘": {"items": []},
    "便利貼": {"notes": []},
    # 課表可以有好幾份（這學期、下學期、打工班表），active 說現在用哪一份
    "課表": {"active": None, "periods": [], "sets": []},
    "設定": {"accent": None, "labels": [], "labelsSeeded": False},
    # 小克的額度。這份**不是使用者寫的**，是 ~/.star-bridge/小克額度.sh 產的，
    # 前端唯讀。空的形狀要有 limits，不然畫面每個地方都得寫 `?? []`。
    "小克": {"limits": [], "fetchedAt": None, "problem": None},
}

MAX_BODY = 8 * 1024 * 1024      # 8MB。正常資料離這個很遠，這是防呆不是設計目標
KEEP_BACKUPS = 20

# 前端拿來判斷「程式換了沒」的檔案。
# 只看程式，不看資料——資料本來就一直在變，跟著它一起變的話會一直說有新版。
WEB_FILES = ("index.html", "site.webmanifest")
WEB_DIRS = ("js", "css")


def web_version() -> str:
    """程式檔的指紋。任何一支改了，這個字串就會變。

    用 mtime 和大小，不讀內容——這是本機 server，檔案十幾支，
    但沒必要為了一個「換了沒」把每支都讀進來算雜湊。
    改了內容而大小和 mtime 都不變的情況不存在（存檔就會動到 mtime）。
    """
    parts = []
    paths = [WEB_DIR / f for f in WEB_FILES]
    for d in WEB_DIRS:
        folder = WEB_DIR / d
        if folder.is_dir():
            paths += sorted(folder.iterdir())
    for p in paths:
        try:
            st = p.stat()
        except OSError:
            continue
        parts.append(f"{p.name}:{st.st_mtime_ns}:{st.st_size}")
    return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()[:12]


def ensure_dirs() -> None:
    DATA_DIR.mkdir(mode=0o700, exist_ok=True)
    BACKUP_DIR.mkdir(mode=0o700, exist_ok=True)
    # 資料夾可能是舊版建的，權限補一次
    os.chmod(DATA_DIR, 0o700)
    os.chmod(BACKUP_DIR, 0o700)


def load(name: str) -> dict:
    path = DATA_DIR / FILES[name]
    if not path.exists():
        return json.loads(json.dumps(EMPTY[name]))    # 深拷貝，別讓呼叫端改到樣板
    try:
        with path.open(encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        # **壞掉的檔案不要當成空的回去。** 回空的話前端會顯示「你沒有任何帳目」，
        # 然後下一次存檔就把壞檔覆蓋成真的空檔，資料就真的沒了。
        raise RuntimeError(f"{path.name} 讀不出來：{e}") from e


def save(name: str, payload: dict) -> None:
    path = DATA_DIR / FILES[name]

    if path.exists():
        stamp = time.strftime("%Y%m%d-%H%M%S")
        shutil.copy2(path, BACKUP_DIR / f"{path.stem}-{stamp}.json")
        rotate_backups(path.stem)

    tmp = path.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
        f.flush()
        os.fsync(f.fileno())        # rename 之前先確定內容真的落地了
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)           # 同一個檔案系統上，這一步是原子的


def rotate_backups(stem: str) -> None:
    backups = sorted(BACKUP_DIR.glob(f"{stem}-*.json"))
    for old in backups[:-KEEP_BACKUPS]:
        old.unlink(missing_ok=True)


class Handler(http.server.SimpleHTTPRequestHandler):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    # 預設那行 log 太吵，只留錯誤
    def log_message(self, fmt, *args):
        pass

    def log_error(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    # ── 回應工具 ─────────────────────────────────────────

    def send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        # **每一個回應都不給快取。**
        #
        # 資料不給快取的理由很明顯：改完重整看到舊的，會以為存檔失敗。
        # 但**靜態檔也一樣重要**——這是本機開發用的 server，改完 JS 之後
        # 重整就該看到新的。只送 Last-Modified 的話瀏覽器會啟發式快取，
        # 於是「我明明修好了她卻說沒看到」，而且要記得按 Cmd+Shift+R 才行。
        # 本機讀檔的成本可以忽略，不值得為它換來這種誤會。
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def api_name(self) -> str | None:
        if not self.path.startswith("/api/"):
            return None
        raw = self.path[len("/api/"):].split("?")[0].strip("/")
        # 檔名是中文，瀏覽器送出來一定是 percent-encoded 的
        name = urllib.parse.unquote(raw)
        return name or None

    # ── 路由 ────────────────────────────────────────────

    def do_GET(self):
        name = self.api_name()
        if name is None:
            return super().do_GET()

        if name == "ping":
            # 前端靠這個判斷「我現在是連著本機資料，還是在展示模式」
            return self.send_json({"ok": True, "dir": str(DATA_DIR)})

        if name == "版本":
            # 加到主畫面的全螢幕模式沒有網址列也沒有重整鍵，
            # 所以前端要自己問「程式換了沒」。見 js/update.js。
            return self.send_json({"version": web_version()})

        if name not in FILES:
            return self.send_json({"error": f"沒有這份資料：{name}"}, 404)

        try:
            return self.send_json(load(name))
        except RuntimeError as e:
            return self.send_json({"error": str(e)}, 500)

    def do_PUT(self):
        name = self.api_name()
        if name not in FILES:
            return self.send_json({"error": f"沒有這份資料：{name}"}, 404)

        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return self.send_json({"error": "Content-Length 不是數字"}, 400)

        if length <= 0:
            return self.send_json({"error": "沒有內容"}, 400)
        if length > MAX_BODY:
            return self.send_json({"error": "資料太大"}, 413)

        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as e:
            # **存不進去要講出來。** 前端會把錯誤顯示在畫面上，
            # 靜靜失敗的話，人會以為存好了。
            return self.send_json({"error": f"這不是合法的 JSON：{e}"}, 400)

        if not isinstance(payload, dict):
            return self.send_json({"error": "最外層必須是物件"}, 400)

        try:
            save(name, payload)
        except OSError as e:
            return self.send_json({"error": f"寫不進去：{e}"}, 500)

        return self.send_json({"ok": True})

    # 關分頁時前端用 navigator.sendBeacon 把還沒寫的資料送出來——
    # 那時候 fetch 會被瀏覽器砍掉，beacon 才送得到。
    # 而 sendBeacon 一定是 POST，所以這裡接同一條路。
    do_POST = do_PUT


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main() -> int:
    parser = argparse.ArgumentParser(description="星歷儀表板的本機資料服務")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument(
        "--host", default="127.0.0.1",
        help="預設只綁本機。要在手機上看就填私有網路（例如 Tailscale）的位址，"
             "**不要填 0.0.0.0**——那會把資料開放給整個網路。")
    args = parser.parse_args()

    if args.host in ("0.0.0.0", "::"):
        print("拒絕綁 0.0.0.0——那等於把記帳和備忘開放給整個網路。",
              file=sys.stderr)
        print("要在別的裝置上看的話，填一個私有網路（例如 Tailscale）的位址。",
              file=sys.stderr)
        return 2

    ensure_dirs()

    with Server((args.host, args.port), Handler) as httpd:
        print(f"星歷儀表板　http://{args.host}:{args.port}")
        print(f"資料放在　　{DATA_DIR}")
        print("停止：Ctrl+C（注音模式下用 Escape）")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n停了。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
