/* 從別的記帳 App 匯進來。
 *
 * 她要「資料轉移」——從別的記帳 App 搬過來。
 *
 * **不綁定特定 App。** 每家的欄位名和格式都不一樣，寫死一家的話
 * 換一家就要重寫。所以做成：讀 CSV → 猜欄位 → 給她確認 → 預覽 → 匯入。
 *
 * ── 猜錯比猜不到糟嗎 ──────────────────────────────
 *
 * 不會，只要猜完看得見而且改得動。**但匯入錯的資料很糟**——
 * 兩百筆帳混進來之後要一筆一筆挑出來刪，那比重打還累。
 * 所以一定要有預覽，而且解不開的那幾列要講出來，不要安靜地跳過。
 */

const Csv = {

    /**
     * 解析 CSV。
     *
     * 自己寫而不是拉一個函式庫：這裡只需要處理引號和換行兩件事，
     * 為了它載一整包不划算，而且離線要能用。
     */
    parse(text) {
        // BOM 會變成第一個欄位名的一部分，「日期」變成「﻿日期」，
        // 之後所有比對都對不上——而且看起來完全正常。
        const src = String(text || '').replace(/^﻿/, '');
        const rows = [];
        let row = [], field = '', inQuotes = false;

        for (let i = 0; i < src.length; i++) {
            const c = src[i];
            if (inQuotes) {
                if (c === '"') {
                    if (src[i + 1] === '"') { field += '"'; i++; }   // "" 是一個引號
                    else inQuotes = false;
                } else field += c;
                continue;
            }
            if (c === '"') { inQuotes = true; continue; }
            if (c === ',') { row.push(field); field = ''; continue; }
            if (c === '\r') continue;
            if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
            field += c;
        }
        if (field !== '' || row.length) { row.push(field); rows.push(row); }

        // 整列都是空的就丟掉——檔案結尾的空行不該變成一筆帳
        const clean = rows.filter(r => r.some(c => String(c).trim() !== ''));
        if (!clean.length) return { headers: [], rows: [] };

        const headers = clean[0].map(h => String(h).trim());
        return {
            headers,
            rows: clean.slice(1).map(r =>
                Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()]))),
        };
    },

    /** 欄位名的線索。**只放幾乎不會錯的**，猜不準的寧可留給她自己選。 */
    HINTS: {
        date: ['日期', '時間', '交易日期', '記帳日期', 'date', 'time', '年月日'],
        amount: ['金額', '價格', '費用', 'amount', 'price', '金額(元)', '金額（元）'],
        income: ['收入', 'income', '收入金額'],
        expense: ['支出', 'expense', '支出金額', '花費'],
        kind: ['類型', '收支', '種類', 'type', 'kind', '收支類型'],
        category: ['分類', '類別', '項目', 'category', '子分類', '大分類'],
        note: ['備註', '說明', '摘要', '內容', 'note', 'memo', 'description', '商家'],
        account: ['帳戶', '錢包', '付款方式', 'account', 'wallet', '資產'],
    },

    /**
     * 猜每個欄位對到什麼。
     *
     * **完全相同優先於包含。** 「支出金額」同時包含「支出」和「金額」，
     * 先比完整的才不會把它猜成金額欄。
     */
    guessMapping(headers) {
        const used = new Set();
        const out = {};
        const norm = h => String(h).toLowerCase().replace(/[\s　()（）]/g, '');

        // **兩輪：先把所有欄位的完全相同配完，才輪到包含。**
        //
        // 一輪跑完（每個欄位各自先比完整再比包含）會出錯：
        // amount 排在 expense 前面，「支出金額」包含「金額」，
        // 就被 amount 先拿走了——然後支出欄變成沒人認領。
        for (const exact of [true, false]) {
            for (const [field, words] of Object.entries(this.HINTS)) {
                if (out[field]) continue;
                const hit = headers.find(h => !used.has(h) && words.some(w =>
                    exact ? norm(h) === norm(w) : norm(h).includes(norm(w))));
                if (hit) { out[field] = hit; used.add(hit); }
            }
        }
        return out;
    },

    /** "2026/9/5"、"2026-09-05"、"2026.9.5" 都要認得 */
    parseDate(text) {
        const s = String(text || '').trim();
        if (!s) return null;
        const m = s.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
        if (m) return `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;
        // 有的 App 給 "09/05/2026"——**月日的順序猜不出來，一律不收**。
        // 猜錯的話整批帳的日期會錯，而且看起來完全正常。
        return null;
    },

    /** "1,234"、"$1234"、"-1234"、"1234.5" 都要認得 */
    parseAmount(text) {
        const s = String(text || '').replace(/[,，\s$＄元NT]/gi, '');
        if (!s) return null;
        const n = Number(s);
        return Number.isFinite(n) ? n : null;
    },

    /**
     * 把讀進來的列變成帳目。
     *
     * @returns {{ rows, problems }}  problems 是**解不開的那幾列**，
     *          一定要講出來——安靜地跳過等於偷偷少匯了幾筆。
     */
    toTransactions(rows, map, { accounts = [], defaultAccount = '' } = {}) {
        const out = [], problems = [];

        rows.forEach((r, i) => {
            const line = i + 2;      // 加上標題列，跟她在試算表看到的行號對得起來

            const date = this.parseDate(r[map.date]);
            if (!date) { problems.push({ line, why: '看不懂日期', raw: r[map.date] || '' }); return; }

            // 三種常見的金額寫法：收支各一欄／單欄加類型／單欄用正負號
            let amount = null, kind = null;
            if (map.income || map.expense) {
                const inc = this.parseAmount(r[map.income]);
                const exp = this.parseAmount(r[map.expense]);
                if (inc) { amount = Math.abs(inc); kind = 'income'; }
                else if (exp) { amount = Math.abs(exp); kind = 'expense'; }
            }
            if (amount === null) {
                const raw = this.parseAmount(r[map.amount]);
                if (raw === null) {
                    problems.push({ line, why: '看不懂金額', raw: r[map.amount] || '' });
                    return;
                }
                amount = Math.abs(raw);
                const kindText = String(r[map.kind] || '');
                if (/收入|income|\+/i.test(kindText)) kind = 'income';
                else if (/支出|expense|消費|花費|-/i.test(kindText)) kind = 'expense';
                else if (/轉帳|transfer/i.test(kindText)) kind = 'transfer';
                else kind = raw < 0 ? 'expense' : (map.kind ? 'expense' : 'expense');
            }
            if (!amount) { problems.push({ line, why: '金額是零', raw: '' }); return; }

            const account = (r[map.account] || '').trim();
            out.push({
                id: uid(),
                date,
                kind,
                amount,
                category: (r[map.category] || '').trim(),
                // 帳戶對不上現有的就用預設，**不要憑空建一堆帳戶**——
                // 她的「悠遊卡」和那邊的「悠遊卡儲值」不是同一個東西。
                account: accounts.includes(account) ? account : defaultAccount,
                note: (r[map.note] || '').trim(),
                updatedAt: stamp(),
            });
        });

        return { rows: out, problems };
    },

    /**
     * 已經有的就不要再匯一次。
     *
     * 沒有 id 可以比（那邊的 id 跟這邊無關），所以比
     * 日期＋金額＋類型＋備註。**同一天同金額同備註的兩筆會被當成重複**——
     * 那是刻意的取捨：少匯一筆她看得出來，多匯一筆混在兩百筆裡看不出來。
     */
    dedupe(incoming, existing) {
        const key = t => [t.date, t.kind, Math.round(t.amount), (t.note || '').trim()].join('|');
        const have = new Set(existing.map(key));
        const fresh = [], dup = [];
        for (const t of incoming) {
            if (have.has(key(t))) { dup.push(t); continue; }
            have.add(key(t));
            fresh.push(t);
        }
        return { fresh, dup };
    },
};
