#!/usr/bin/env python3
"""把星歷排出去的班，同步到 macOS／iCloud 行事曆。

    python3 同步到行事曆.py            # 只看會做什麼，不動任何東西
    python3 同步到行事曆.py --做下去     # 真的寫進行事曆

## 為什麼需要這支

排班存在 ~/星歷資料/行事曆.json，iPhone 的行事曆存在 iCloud，
**兩個是完全獨立的系統**。2026-09-20 就出過事：她在星歷把 9/6、9/13
的週日早班改成 8 點，iPhone 那邊還是 6 點，兩份班表各說各話。

## 三個刻意的決定

**1. 單向：星歷 → 行事曆。**
雙向同步要解「兩邊都改了誰贏」，而那個問題沒有不痛的答案。
星歷是她排班的地方，行事曆是拿來看的——來源只有一個就不會打架。
反過來說：**在 iPhone 行事曆上改班是不會傳回星歷的**，改完下次同步
還會被蓋回去。要改就在星歷改。

**2. 不刪，只列出來。**
星歷刪掉的班，這支不會去行事曆刪——刪掉的東西救不回來，而同步腳本
判斷錯的時候沒有人會發現。它會把「行事曆有、星歷沒有」的列出來，
讓她自己決定。（記帳和待辦那邊的刪除傳播是另外做的，有足跡比對
和保險絲；班表還沒做到那個程度。）

**3. 第一次跑會「認領」，不是重建。**
她的行事曆裡本來就有幾十筆手動加的「上班」。只會新增的話，
同步一次就變成每天兩筆。所以同一天、同樣時間的既有事件會被
**認領**（寫上標記變成星歷管的），不是再建一筆。

**4. 只同步時間，不碰標題。**
星歷的班叫「早班」（班別樣板的名字），行事曆上她寫的是「上班」。
同步如果連標題一起蓋，她整本行事曆的字都會被改掉——而那些名字是
她自己取的，不是星歷的資產。要一致的是**幾點到幾點**，不是叫什麼。

## 怎麼認出哪筆是星歷來的

寫在事件的 `url` 欄位：`starcal://<星歷的事件 id>`。

用 url 不用說明欄，是因為說明欄是她自己寫備註的地方——把機器用的
標記混進去，她哪天自己編輯就會不小心刪掉，而且畫面上看了礙眼。
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from datetime import date, timedelta
from pathlib import Path

def parse_ymd(s: str) -> date:
    return date(int(s[:4]), int(s[5:7]), int(s[8:10]))


DATA = Path.home() / "星歷資料" / "行事曆.json"
CAL_NAME = "上班"          # 班寫進哪一本行事曆
MARK = "starcal://"


_launched = False


def ensure_calendar() -> None:
    """確定 Calendar.app 活著。

    **用 launch 不用 activate。** activate 會把行事曆的視窗搶到她面前，
    而這支可能是定時在背景跑的——工作到一半被一個視窗蓋住很惱人。
    launch 只是把程式叫起來，不碰前景。

    沒有這一步的話，行事曆剛好被關掉時整支會炸在 -600
    （「應用程式不在執行中」），而那個錯誤訊息完全看不出要怎麼辦。
    """
    global _launched
    if _launched:
        return
    # **要用 open -g，不能用 AppleScript 的 launch。**
    # 行事曆沒在跑的時候，`tell application "Calendar" to launch` 自己就會
    # 吃 -600（應用程式不在執行中）——它本身也是一個 Apple Event，
    # 送不到一個還沒起來的程式。open 走的是 LaunchServices，不吃這一套。
    # -g 是不要把視窗帶到前景（這支可能在背景定時跑）。
    subprocess.run(["open", "-g", "-a", "Calendar"],
                   capture_output=True, text=True, timeout=120)
    # 剛起來的時候還接不了 Apple Event，等它準備好（最多 15 秒）
    for _ in range(15):
        r = subprocess.run(
            ["osascript", "-e", 'tell application "Calendar" to return (count of calendars)'],
            capture_output=True, text=True, timeout=60)
        if r.returncode == 0:
            break
        time.sleep(1)
    _launched = True


def osa(script: str, tries: int = 3) -> str:
    """跑一段 AppleScript，回傳 stdout。

    **連線斷掉要自己接回去。** Calendar.app 在連續幾十次操作之後會
    斷線（-609）或整個退出（-600），而這支腳本一跑就是幾十筆——
    第一次實測就死在第 20 幾筆。那兩種錯誤重開再試就好，
    不該讓整批同步半途而廢。

    其他錯誤（例如語法寫錯）**不重試**：重試三次只會把同一個錯誤
    印三遍，然後把真正的原因埋在噪音裡。
    """
    global _launched
    for attempt in range(tries):
        ensure_calendar()
        r = subprocess.run(["osascript", "-e", script],
                           capture_output=True, text=True, timeout=600)
        if r.returncode == 0:
            return r.stdout.strip()

        err = r.stderr.strip()
        if ("-609" in err or "-600" in err) and attempt < tries - 1:
            _launched = False          # 逼 ensure_calendar 重開一次
            time.sleep(3)
            continue
        raise SystemExit(f"AppleScript 失敗：{err}")
    return ""


def starcal_shifts() -> list:
    """星歷裡排出去的班。有 shift 欄位的才算（手動加的行程不是班）。"""
    d = json.loads(DATA.read_text(encoding="utf-8"))
    out = []
    for e in d.get("events", []):
        if not e.get("shift"):
            continue
        if not e.get("time") or not e.get("endTime"):
            continue          # 沒有時間的班同步過去只會變成整天事件
        out.append({
            "id": e["id"],
            "date": e["date"],
            "title": e.get("title") or "上班",
            "start": e["time"],
            "end": e["endTime"],
        })
    return sorted(out, key=lambda x: (x["date"], x["start"]))


def calendar_events() -> list:
    """行事曆那本裡的事件。回傳 [{uid, summary, date, start, end, mark}]。

    **一次把整本撈出來，不要一筆一筆去問。** Calendar.app 的每一次
    Apple Event 都很慢，幾十筆分開問會跑到天荒地老。

    ⚠️ **不要「優化」成 `whose start date ≥ lo and ≤ hi`。** 試過了：
    這本兩百多筆的行事曆，撈整本大約三五分鐘，加上日期範圍過濾之後
    跑十分鐘還沒撈完，直接被 timeout 砍掉。

    跟認領那邊的 `whose uid is …` 剛好相反，而兩件事是同一條規則：
    **uid 有索引，日期沒有。** 日期的 whose 等於要 Calendar 對每一筆
    事件做一次日期轉換再比較，比整個吐出來讓 Python 過濾還慢。
    """
    script = f'''
    tell application "Calendar"
      tell calendar "{CAL_NAME}"
        set out to ""
        repeat with e in events
          set sd to start date of e
          set ed to end date of e
          set u to ""
          try
            set u to (url of e) as text
          end try
          set out to out & (uid of e) & "\\t" & (summary of e) & "\\t" ¬
            & (year of sd) & "-" & (my pad(month of sd as integer)) & "-" & (my pad(day of sd)) & "\\t" ¬
            & (my pad(hours of sd)) & ":" & (my pad(minutes of sd)) & "\\t" ¬
            & (my pad(hours of ed)) & ":" & (my pad(minutes of ed)) & "\\t" & u & "\\n"
        end repeat
        return out
      end tell
    end tell

    on pad(n)
      set s to n as text
      if length of s < 2 then return "0" & s
      return s
    end pad
    '''
    rows = []
    for line in osa(script).splitlines():
        p = line.split("\t")
        if len(p) < 5:
            continue
        rows.append({
            "uid": p[0], "summary": p[1], "date": p[2],
            "start": p[3], "end": p[4],
            "mark": p[5] if len(p) > 5 else "",
        })
    return rows


def plan(shifts: list, events: list) -> dict:
    """算出要做什麼。不動任何東西。"""
    by_mark = {e["mark"].replace(MARK, ""): e for e in events
               if e["mark"].startswith(MARK)}
    # 同一天同一個開始時間的既有事件，拿來認領用
    by_slot = {}
    for e in events:
        if not e["mark"].startswith(MARK):
            by_slot.setdefault((e["date"], e["start"]), []).append(e)

    add, update, claim = [], [], []
    seen = set()

    for s in shifts:
        cur = by_mark.get(s["id"])
        if cur:
            seen.add(s["id"])
            # 只比時間，**不比標題**
            if (cur["date"], cur["start"], cur["end"]) != \
               (s["date"], s["start"], s["end"]):
                update.append((s, cur))
            continue

        # 還沒標記過：先看同一天同一個時間有沒有現成的，有就認領
        pool = by_slot.get((s["date"], s["start"]))
        if pool:
            claim.append((s, pool.pop(0)))
            seen.add(s["id"])
            continue

        add.append(s)

    # 行事曆有標記、但星歷已經沒有的——**只列出來，不刪**
    orphans = [e for k, e in by_mark.items() if k not in seen]
    return {"add": add, "update": update, "claim": claim, "orphans": orphans}


def apply_plan(p: dict) -> None:
    """真的寫進去。每一筆一句 AppleScript，出錯就停。"""
    def mkdate(var, ymd_s, hm):
        y, mo, d = ymd_s.split("-")
        h, mi = hm.split(":")
        return (f'set {var} to (current date)\n'
                f'set year of {var} to {int(y)}\n'
                f'set month of {var} to {int(mo)}\n'
                f'set day of {var} to {int(d)}\n'
                f'set hours of {var} to {int(h)}\n'
                f'set minutes of {var} to {int(mi)}\n'
                f'set seconds of {var} to 0\n')

    for s in p["add"]:
        osa(f'''
        {mkdate("sd", s["date"], s["start"])}
        {mkdate("ed", s["date"], s["end"])}
        -- 跨夜班：結束比開始早就是隔天
        if ed < sd then set ed to ed + (1 * days)
        tell application "Calendar"
          tell calendar "{CAL_NAME}"
            make new event with properties {{summary:"{s["title"]}", start date:sd, end date:ed, url:"{MARK}{s["id"]}"}}
          end tell
        end tell''')

    # 認領。**一筆一句 whose，不要自己在 AppleScript 裡跑巢狀迴圈。**
    #
    # 第一版以為「三十幾次 whose ＝ 三十幾次全本掃描」很浪費，改成撈出
    # 全部在 AppleScript 裡比對——結果慢了一個數量級，三十一筆跑超過
    # 十分鐘。AppleScript 的迴圈本來就是出了名的慢，而 whose 是交給
    # Calendar.app 內部去過濾的。
    #
    # 教訓：**在 AppleScript 裡，把工作推給應用程式永遠比自己迴圈快。**
    for s, cur in p["claim"]:
        osa(f'''
        tell application "Calendar"
          tell calendar "{CAL_NAME}"
            set url of (first event whose uid is "{cur["uid"]}") to "{MARK}{s["id"]}"
          end tell
        end tell''')

    for s, cur in p["update"]:
        osa(f'''
        {mkdate("sd", s["date"], s["start"])}
        {mkdate("ed", s["date"], s["end"])}
        if ed < sd then set ed to ed + (1 * days)
        tell application "Calendar"
          tell calendar "{CAL_NAME}"
            set e to (first event whose uid is "{cur["uid"]}")
            set start date of e to sd
            set end date of e to ed
          end tell
        end tell''')


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--做下去", dest="go", action="store_true",
                    help="真的寫進行事曆（不加就只是看看）")
    args = ap.parse_args()

    shifts = starcal_shifts()
    print(f"星歷裡有 {len(shifts)} 筆班", file=sys.stderr)
    if not shifts:
        print("星歷裡沒有排班，沒事可做", file=sys.stderr)
        return

    events = calendar_events()
    print(f"行事曆「{CAL_NAME}」裡有 {len(events)} 筆事件", file=sys.stderr)

    p = plan(shifts, events)

    print()
    print(f"認領既有的　{len(p['claim'])} 筆（同一天同一個時間，不重建）")
    for s, cur in p["claim"][:40]:
        print(f"  {s['date']} {s['start']}-{s['end']}　{s['title']}")
    print(f"新增　　　　{len(p['add'])} 筆")
    for s in p["add"][:40]:
        print(f"  {s['date']} {s['start']}-{s['end']}　{s['title']}")
    print(f"更新時間　　{len(p['update'])} 筆")
    for s, cur in p["update"][:40]:
        print(f"  {s['date']} {cur['start']}-{cur['end']} → {s['start']}-{s['end']}　{s['title']}")
    print(f"行事曆有、星歷沒有　{len(p['orphans'])} 筆（**不會刪**，自己看要不要處理）")
    for e in p["orphans"][:40]:
        print(f"  {e['date']} {e['start']}-{e['end']}　{e['summary']}")

    if not args.go:
        print()
        print("以上只是看看。確定要做的話加 --做下去", file=sys.stderr)
        return

    apply_plan(p)
    print()
    print(f"做完了：認領 {len(p['claim'])}、新增 {len(p['add'])}、更新 {len(p['update'])}",
          file=sys.stderr)


if __name__ == "__main__":
    main()
