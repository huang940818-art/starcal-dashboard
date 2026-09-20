#!/usr/bin/env python3
"""把政府公布的辦公日曆表抓下來，算出連假，存成 holidays.json。

    python3 抓假日.py

## 為什麼是建置時抓，不是打開網頁才抓

那份 CSV 在 www.dgpa.gov.tw 上**沒有 CORS 標頭**，瀏覽器直接 fetch 會被擋。
繞過去的方法只有兩種：讓 server.py 代抓（那展示模式就沒有，因為那邊
根本沒有 server），或是先抓下來變成專案的一部分。

選後者還有兩個好處：離線也有（這份儀表板本來就要能離線看），
而且不會因為政府網站當天壞掉就少一塊。

代價是**每年要跑一次**。所以 holidays.json 裡有 `涵蓋` 欄位，
前端發現資料快用完了會自己講一句，不用誰記得。

## 資料來源

data.gov.tw 的 dataset 14718「中華民國政府行政機關辦公日曆表」，
人事行政總處發布，每年更新。欄位是：

    西元日期,星期,是否放假,備註

「是否放假」0 = 上班、2 = 放假（這是它自己 notes 裡寫的）。
備註只有國定假日跟補假才有，平常的週末是空的。

**不要自己手寫假日表。** 補假怎麼補、颱風怎麼調、哪年清明跟兒童節
連在一起，每年都不一樣，憑印象寫一定會錯，而且錯了不會有任何地方報錯——
只會讓她看著一個錯的日子規劃行程。
"""

from __future__ import annotations

import json
import re
import ssl
import sys
import urllib.request
from collections import Counter
from datetime import date
from pathlib import Path

DATASET = "https://data.gov.tw/api/v2/rest/dataset/14718"
# **檔名用英文。** 這份要被網頁 fetch、被 service worker 快取，
# 中文檔名在 URL 裡會變成一長串 percent-encoding，而快取比對是比字串——
# 編碼方式差一點就變成兩個不同的網址，離線時就少這一塊。
# 專案裡其他中文檔名（檢查.mjs、開.sh）都是本機工具，不走網路。
OUT = Path(__file__).resolve().parent / "holidays.json"

# 連假的門檻。兩天是週末，不是連假——
# 每個月都有四次的東西不值得倒數。
MIN_RUN = 3


def ssl_context():
    """驗證照做，只放寬「嚴格模式」。

    www.dgpa.gov.tw 的憑證少了 Subject Key Identifier 這個欄位。
    那個欄位在 RFC 5280 裡是 SHOULD 不是 MUST，但 Python 3.13 起
    預設開 `VERIFY_X509_STRICT`，於是握手直接失敗
    （curl 用系統驗證，寬鬆一點，所以同一個網址 curl 抓得到）。

    **不要改成 `_create_unverified_context()`。** 那是把整個驗證關掉，
    連「對方是不是真的 dgpa.gov.tw」都不查了——為了一個可有可無的
    欄位把中間人攻擊的門一起打開，代價差太多。這裡只拿掉那一個旗標，
    憑證鏈、有效期、主機名稱照驗。
    """
    ctx = ssl.create_default_context()
    ctx.verify_flags &= ~ssl.VERIFY_X509_STRICT
    return ctx


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "starcal/1.0"})
    with urllib.request.urlopen(req, timeout=60, context=ssl_context()) as r:
        return r.read()


def find_csv_urls() -> dict:
    """{ 西元年: 下載網址 }。只要正式那一份，不要 Google 行事曆專用的。"""
    meta = json.loads(fetch(DATASET))["result"]
    out = {}
    for r in meta.get("distribution", []):
        desc = r.get("resourceDescription", "")
        if "Google" in desc or r.get("resourceFormat") != "CSV":
            continue
        m = re.match(r"^(\d+)年中華民國政府行政機關辦公日曆表", desc)
        if not m:
            continue
        year = int(m.group(1)) + 1911          # 民國 → 西元
        url = r.get("resourceDownloadUrl")
        if not url:
            continue
        # 同一年可能有好幾份（例如「(1141020更新)」），後面的比較新，蓋掉前面的
        out[year] = url
    return out


def parse(raw: bytes) -> list:
    """→ [{date, week, off, note}]，date 是 "2026-01-01"。"""
    text = None
    for enc in ("utf-8-sig", "cp950", "big5hkscs"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        raise SystemExit("這份 CSV 三種編碼都解不開，格式可能換了")

    rows = []
    for line in text.strip().splitlines()[1:]:      # 跳掉標題列
        parts = [p.strip() for p in line.strip().split(",")]
        if len(parts) < 3 or not re.fullmatch(r"\d{8}", parts[0]):
            continue
        d = parts[0]
        rows.append({
            "date": f"{d[0:4]}-{d[4:6]}-{d[6:8]}",
            "week": parts[1],
            "off": parts[2] == "2",
            "note": parts[3] if len(parts) > 3 else "",
        })
    return rows


def tidy(note: str) -> str:
    """「孔子誕辰紀念日/教師節」→「教師節」。斜線是兩個名字，取常用的那個。"""
    return note.split("/")[-1].strip()


def runs(rows: list) -> list:
    """連續放假的區段。回傳 [{start, end, days, notes}]。

    **一定要拿合併過、排好序的三年份進來。** 一年一份分開算的話，
    跨年的連假會在兩份裡各剩半截——2027 的元旦連假就是從 1/1 開始的
    三天，但如果前一年的 12/31 也放假，那實際上是四天。
    """
    out, cur = [], []

    for r in rows:
        if r["off"]:
            cur.append(r)
            continue
        if cur:
            out.append(cur)
            cur = []
    if cur:
        out.append(cur)

    return [{
        "start": seg[0]["date"],
        "end": seg[-1]["date"],
        "days": len(seg),
        "notes": [tidy(x["note"]) for x in seg if x["note"] and x["note"] != "補假"],
    } for seg in out]


def name_of(notes: list) -> str:
    """一段連假叫什麼。

    **取出現次數最多的那個名字**：春節那一段裡有小年夜、除夕、春節×3、補假，
    最多的是春節，那它就是春節連假。

    平手就全部串起來，不要挑一個：兒童節跟清明節連在一起的那年，
    挑哪一個都是在替她決定那幾天叫什麼，而「兒童節・清明節」是事實。
    """
    if not notes:
        return "連假"
    c = Counter(notes)
    top = c.most_common(1)[0][1]
    winners = [n for n in dict.fromkeys(notes) if c[n] == top]
    return "・".join(winners)


def main() -> None:
    urls = find_csv_urls()
    if not urls:
        raise SystemExit("data.gov.tw 上找不到任何一年的 CSV，格式可能換了")

    # 只留今年以後的。往前留一年，跨年連假才接得起來。
    this_year = date.today().year
    years = sorted(y for y in urls if y >= this_year - 1)

    all_rows = []
    for y in years:
        print(f"抓 {y} 年…", file=sys.stderr)
        all_rows += parse(fetch(urls[y]))
    all_rows.sort(key=lambda r: r["date"])

    # 國定假日（有備註、而且真的放假的）。補假也留著——
    # 它是連假的一部分，只是不會單獨變成一個倒數。
    holidays = [{"date": r["date"], "name": tidy(r["note"])}
                for r in all_rows if r["off"] and r["note"]]

    # 連假：連續放假 MIN_RUN 天以上，而且裡面至少有一個國定假日
    #（純粹補班調來的三天不算，那不是在過節）
    long_runs = [s for s in runs(all_rows) if s["days"] >= MIN_RUN and s["notes"]]
    breaks = [{
        "start": s["start"], "end": s["end"], "days": s["days"],
        "name": name_of(s["notes"]),
    } for s in long_runs]

    data = {
        "來源": "data.gov.tw dataset 14718（人事行政總處・中華民國政府行政機關辦公日曆表）",
        "抓的日期": date.today().isoformat(),
        "涵蓋": [f"{years[0]}-01-01", f"{years[-1]}-12-31"],
        "連假": breaks,
        "假日": holidays,
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n",
                   encoding="utf-8")

    print(f"寫好 {OUT.name}：{len(breaks)} 個連假、{len(holidays)} 個假日，"
          f"涵蓋 {data['涵蓋'][0]} ~ {data['涵蓋'][1]}", file=sys.stderr)
    for b in breaks:
        print(f"  {b['start']} ~ {b['end']}　{b['days']} 天　{b['name']}", file=sys.stderr)


if __name__ == "__main__":
    main()
