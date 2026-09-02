/* 記帳。
 *
 * iOS 星歷已經有帳戶、收支、訂閱、發薪提醒。這裡多做的是那邊沒有的五件事：
 *
 *   1. 預算與超支     只知道「花了多少」不夠，要知道「還剩多少」
 *   2. 跨月趨勢       單月看不出「哪一類在慢慢變貴」
 *   3. 搜尋與篩選     「上次那家店花多少」翻不到就等於沒記
 *   4. 固定 vs 彈性   非花不可的和可以省的混在一起，看不出真正的彈性
 *   5. 自訂分類       寫死的分類遲早會缺一個，缺了就只能記到「其他」
 */

/* 全新的資料要有一組起始分類。
 *
 * 分類做成可自訂是對的，但**新使用者拿到空陣列就等於整個記帳都不能用**：
 * 預算對話框一個欄位都沒有、記一筆的分類下拉是空的。
 * 「可以自己加」不等於「一開始就該是空的」。
 *
 * 固定＝非花不可（房租、交通、訂閱、醫療），彈性＝可以省的。
 */
const DEFAULT_CATEGORIES = {
    expense: [
        { name: '餐飲', nature: 'flexible' },
        { name: '交通', nature: 'fixed' },
        { name: '日用品', nature: 'flexible' },
        { name: '娛樂', nature: 'flexible' },
        { name: '學習', nature: 'flexible' },
        { name: '醫療', nature: 'fixed' },
        { name: '衣服', nature: 'flexible' },
        { name: '房租', nature: 'fixed' },
        { name: '訂閱', nature: 'fixed' },
        { name: '其他', nature: 'flexible' },
    ],
    income: [
        { name: '打工' }, { name: '獎學金' }, { name: '家裡給的' }, { name: '其他' },
    ],
};

const Money = {
    data: null,
    /** 現在在看哪個月，"2026-09"。切月份影響上半部那幾張卡。 */
    viewMonth: null,

    async init() {
        this.data = await Store.load('記帳');
        this.viewMonth = thisMonth();
        this.migrate();
        this.bind();
    },

    /** 舊資料補上後來才加的欄位。少一個欄位就整頁爆掉是最沒必要的當機。 */
    migrate() {
        const d = this.data;
        d.accounts ??= [];
        d.transactions ??= [];
        d.subscriptions ??= [];
        d.budgets ??= [];
        d.categories ??= { expense: [], income: [] };
        // 分類原本可能只是字串陣列，補上「固定／彈性」這個性質
        d.categories.expense = (d.categories.expense ?? []).map(
            c => typeof c === 'string' ? { name: c, nature: 'flexible' } : c);
        d.categories.income = (d.categories.income ?? []).map(
            c => typeof c === 'string' ? { name: c } : c);

        // 完全空的才補。使用者自己刪光的話就尊重它，不要偷偷長回來。
        if (!d.categories.expense.length && !d.categories.income.length
            && !d.transactions.length) {
            d.categories = structuredClone(DEFAULT_CATEGORIES);
            this.save();
        }
    },

    save() { Store.save('記帳'); },

    /* ── 算術 ──────────────────────────────────────── */

    /** 一個帳戶現在有多少。信用卡花錢會變負的，那正好等於欠款。 */
    balance(name) {
        const acc = this.data.accounts.find(a => a.name === name);
        let sum = acc ? Number(acc.opening) || 0 : 0;
        for (const t of this.data.transactions) {
            const amt = Number(t.amount) || 0;
            if (t.kind === 'income' && t.account === name) sum += amt;
            else if (t.kind === 'expense' && t.account === name) sum -= amt;
            else if (t.kind === 'transfer') {
                if (t.account === name) sum -= amt;
                if (t.toAccount === name) sum += amt;
            }
        }
        return sum;
    },

    total() {
        return this.data.accounts
            .filter(a => a.includeInTotal !== false)
            .reduce((s, a) => s + this.balance(a.name), 0);
    },

    /** 某個月的收入與支出。**轉帳兩者都不算**——錢從左口袋到右口袋，
     *  算成支出的話每轉一次帳就多花一次錢。 */
    monthSummary(ym) {
        let income = 0, expense = 0;
        for (const t of this.data.transactions) {
            if (monthOf(t.date) !== ym) continue;
            const amt = Number(t.amount) || 0;
            if (t.kind === 'income') income += amt;
            else if (t.kind === 'expense') expense += amt;
        }
        return { income, expense, net: income - expense };
    },

    /** 某個月各分類花了多少，多的在前 */
    byCategory(ym) {
        const map = new Map();
        for (const t of this.data.transactions) {
            if (t.kind !== 'expense' || monthOf(t.date) !== ym) continue;
            const key = t.category || '未分類';
            map.set(key, (map.get(key) || 0) + (Number(t.amount) || 0));
        }
        return [...map.entries()]
            .map(([category, amount]) => ({ category, amount }))
            .sort((a, b) => b.amount - a.amount);
    },

    natureOf(category) {
        return this.data.categories.expense.find(c => c.name === category)?.nature || 'flexible';
    },

    /* ── 畫面 ──────────────────────────────────────── */

    isThisMonth() { return this.viewMonth === thisMonth(); },

    /** 有帳目的最早月份，用來擋住「一直往回翻到空的」 */
    earliestMonth() {
        let min = null;
        for (const t of this.data.transactions) {
            const m = monthOf(t.date);
            if (!min || m < min) min = m;
        }
        return min;
    },

    shiftMonth(delta) {
        const [y, m] = this.viewMonth.split('-').map(Number);
        const d = new Date(y, m - 1 + delta, 1);
        this.viewMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
        this.render();
    },

    renderMonthNav() {
        const box = $('#month-nav');
        clear(box);

        const [y, m] = this.viewMonth.split('-');
        const label = this.isThisMonth() ? '這個月' : `${y} 年 ${Number(m)} 月`;
        const earliest = this.earliestMonth();

        box.append(el('div', { class: 'month-nav' }, [
            el('button', {
                class: 'btn icon', text: '‹', 'aria-label': '上個月',
                // 沒有更早的帳目就不給再往回翻——翻進一片空白沒有意義
                disabled: earliest ? this.viewMonth <= earliest : true,
                onclick: () => this.shiftMonth(-1),
            }),
            el('div', { class: 'month-label' }, [
                el('span', { text: `${y} 年 ${Number(m)} 月` }),
                this.isThisMonth() ? el('span', { class: 'tag', text: '這個月' }) : null,
            ]),
            el('button', {
                class: 'btn icon', text: '›', 'aria-label': '下個月',
                disabled: this.isThisMonth(),      // 未來還沒發生，沒得看
                onclick: () => this.shiftMonth(1),
            }),
            !this.isThisMonth()
                ? el('button', {
                    class: 'btn small ghost', text: '回到這個月',
                    onclick: () => { this.viewMonth = thisMonth(); this.render(); },
                })
                : null,
        ]));
        // 這幾張卡的標題要跟著月份走，不然翻到七月還寫「這個月」
        const title = this.isThisMonth() ? '這個月' : `${Number(m)} 月`;
        $('#month-card-title').textContent = title;
        $('#by-category-title').textContent = `${title}花在哪`;
    },

    render() {
        this.renderMonthNav();
        this.renderAccounts();
        this.renderMonth();
        this.renderFixedFlexible();
        this.renderBudgets();
        this.renderTrend();
        this.renderByCategory();
        this.renderSubs();
        this.renderFilters();
        this.renderTxns();
    },

    renderAccounts() {
        const total = $('#accounts-total');
        const list = $('#accounts-list');
        clear(total);
        clear(list);

        // 一個帳戶都沒有的時候不要報「0」——那看起來像「你的存款是零」，
        // 但實際上是「還沒告訴我有哪些帳戶」。這兩件事差很多。
        if (!this.data.accounts.length) {
            list.append(el('div', { class: 'empty' }, [
                icon('wallet', 26), '還沒有帳戶',
                el('div', { class: 'hint', text: '先加一個，帳目才有地方去' }),
            ]));
            return;
        }

        total.append(
            el('div', { class: 'big money-num', text: money(this.total()) }),
            el('div', { class: 'sub', text: '算進總額的帳戶合計' }));
        list.style.marginTop = '14px';

        const kindName = { cash: '現金', bank: '銀行', credit: '信用卡', invest: '投資', other: '其他' };
        for (const a of [...this.data.accounts].sort((x, y) => (x.order ?? 0) - (y.order ?? 0))) {
            const bal = this.balance(a.name);
            list.append(el('div', { class: 'account-row' }, [
                el('div', { class: 'grow' }, [
                    el('div', { class: 'ellipsis', text: a.name }),
                    el('div', { class: 'sub' },
                        [kindName[a.kind] || '其他', a.includeInTotal === false ? '　不計入總額' : '']
                            .join('')),
                ]),
                el('div', {
                    class: 'money-num' + (bal < 0 ? ' negative' : ''),
                    text: money(bal),
                }),
                el('button', {
                    class: 'btn small ghost', text: '改',
                    onclick: () => this.editAccount(a),
                }),
            ]));
        }
    },

    renderMonth() {
        const box = $('#month-summary');
        clear(box);
        const s = this.monthSummary(this.viewMonth);
        box.append(
            el('div', { class: 'big money-num' + (s.net < 0 ? ' negative' : ''), text: money(s.net, true) }),
            el('div', { class: 'sub', text: this.isThisMonth() ? '這個月收支相抵' : '這個月份收支相抵' }),
            el('div', { style: 'display:flex;gap:22px;margin-top:16px' }, [
                el('div', {}, [
                    el('div', { class: 'sub', text: '收入' }),
                    el('div', { class: 'money-num income', style: 'font-size:19px', text: money(s.income) }),
                ]),
                el('div', {}, [
                    el('div', { class: 'sub', text: '支出' }),
                    el('div', { class: 'money-num', style: 'font-size:19px', text: money(s.expense) }),
                ]),
            ]));
    },

    /** 固定 vs 彈性。這張卡回答的是「我真正能省的有多少」。 */
    renderFixedFlexible() {
        const box = $('#fixed-flexible');
        clear(box);

        let fixed = 0, flexible = 0;
        for (const t of this.data.transactions) {
            if (t.kind !== 'expense' || monthOf(t.date) !== this.viewMonth) continue;
            const amt = Number(t.amount) || 0;
            if (this.natureOf(t.category) === 'fixed') fixed += amt;
            else flexible += amt;
        }

        const sum = fixed + flexible;
        if (!sum) {
            box.append(el('div', { class: 'empty' }, [
                icon('scale', 26), this.isThisMonth() ? '這個月還沒有支出' : '這個月份沒有支出',
            ]));
            return;
        }

        box.append(
            el('div', { class: 'track', style: 'height:11px' }, [
                el('div', {
                    class: 'fill',
                    style: `width:${(fixed / sum * 100).toFixed(1)}%;background:var(--water)`,
                }),
            ]),
            el('div', { style: 'display:flex;justify-content:space-between;margin-top:12px;gap:14px' }, [
                el('div', {}, [
                    el('div', {}, [el('span', { class: 'tag fixed', text: '固定' })]),
                    el('div', { class: 'money-num', style: 'font-size:19px;margin-top:6px', text: money(fixed) }),
                    el('div', { class: 'sub', text: '非花不可' }),
                ]),
                el('div', { style: 'text-align:right' }, [
                    el('div', {}, [el('span', { class: 'tag flexible', text: '彈性' })]),
                    el('div', { class: 'money-num', style: 'font-size:19px;margin-top:6px', text: money(flexible) }),
                    el('div', { class: 'sub', text: `佔 ${Math.round(flexible / sum * 100)}%　可以省的部分` }),
                ]),
            ]));
    },

    renderBudgets() {
        const box = $('#budgets');
        clear(box);

        const budgets = this.data.budgets.filter(b => Number(b.limit) > 0);
        if (!budgets.length) {
            box.append(el('div', { class: 'empty' }, [
                icon('budget', 26), '還沒設預算',
                el('div', { class: 'hint', text: '設了才看得到「還剩多少」，不然只看得到「花了多少」' }),
            ]));
            return;
        }

        const spent = new Map(this.byCategory(this.viewMonth).map(c => [c.category, c.amount]));

        for (const b of budgets) {
            const used = spent.get(b.category) || 0;
            const limit = Number(b.limit);
            const ratio = used / limit;
            const over = used > limit;
            const cls = over ? 'over' : ratio > 0.8 ? 'warn' : '';

            box.append(el('div', { class: 'budget' }, [
                el('div', { class: 'budget-head' }, [
                    el('span', { text: b.category }),
                    el('span', {
                        class: 'money-num ' + (over ? 'negative' : 'sub'),
                        text: over ? `超支 ${money(used - limit)}`
                                   : `還有 ${money(limit - used)}`,
                    }),
                ]),
                el('div', { class: 'track' }, [
                    el('div', { class: `fill ${cls}`, style: `width:${Math.min(ratio, 1) * 100}%` }),
                ]),
                el('div', { class: 'sub', style: 'margin-top:4px', text: `${money(used)} / ${money(limit)}` }),
            ]));
        }
    },

    renderTrend() {
        const box = $('#trend');
        clear(box);

        const range = $('#trend-range').value;
        let months;
        if (range === 'year') {
            const y = new Date().getFullYear();
            months = [];
            for (let m = 0; m <= new Date().getMonth(); m++) months.push(`${y}-${pad(m + 1)}`);
        } else {
            months = recentMonths(Number(range));
        }

        const rows = months.map(ym => ({ ym, ...this.monthSummary(ym) }));
        const peak = Math.max(1, ...rows.map(r => Math.max(r.income, r.expense)));

        if (!rows.some(r => r.income || r.expense)) {
            box.append(el('div', { class: 'empty', text: '這段期間沒有帳目' }));
            return;
        }

        box.append(
            el('div', { class: 'chart' }, rows.map(r => el('div', { class: 'chart-col' }, [
                el('div', { class: 'bars' }, [
                    el('div', {
                        class: 'bar in', style: `height:${r.income / peak * 100}%`,
                        title: `${r.ym} 收入 ${money(r.income)}`,
                    }),
                    el('div', {
                        class: 'bar out', style: `height:${r.expense / peak * 100}%`,
                        title: `${r.ym} 支出 ${money(r.expense)}`,
                    }),
                ]),
                el('div', { class: 'chart-label', text: monthLabel(r.ym) }),
            ]))),
            el('div', { class: 'legend' }, [
                el('span', {}, [el('i', { style: 'background:var(--good)' }), '收入']),
                el('span', {}, [el('i', { style: 'background:var(--money)' }), '支出']),
            ]));

        // 年度回顧：把這段期間總結成一句話
        const income = rows.reduce((s, r) => s + r.income, 0);
        const expense = rows.reduce((s, r) => s + r.expense, 0);
        const active = rows.filter(r => r.income || r.expense).length;
        const worst = rows.reduce((a, b) => b.expense > a.expense ? b : a, rows[0]);

        box.append(el('div', { class: 'sub', style: 'margin-top:14px;line-height:1.9' }, [
            el('div', { text: `這段期間收入 ${money(income)}，支出 ${money(expense)}，` +
                              `相抵 ${money(income - expense, true)}。` }),
            el('div', { text: `平均每月支出 ${money(expense / Math.max(active, 1))}，` +
                              `花最多的是 ${monthLabel(worst.ym)}（${money(worst.expense)}）。` }),
        ]));
    },

    renderByCategory() {
        const box = $('#by-category');
        clear(box);

        const rows = this.byCategory(this.viewMonth);
        if (!rows.length) {
            box.append(el('div', { class: 'empty' }, [
                icon('list', 26), this.isThisMonth() ? '這個月還沒有支出' : '這個月份沒有支出',
            ]));
            return;
        }

        const peak = rows[0].amount;
        const sum = rows.reduce((s, r) => s + r.amount, 0);

        for (const r of rows.slice(0, 8)) {
            box.append(el('div', { class: 'cat-row' }, [
                el('span', {}, [
                    r.category,
                    ' ',
                    el('span', {
                        class: 'tag ' + this.natureOf(r.category),
                        text: this.natureOf(r.category) === 'fixed' ? '固定' : '彈性',
                    }),
                ]),
                el('span', { class: 'money-num', text: `${money(r.amount)}　${Math.round(r.amount / sum * 100)}%` }),
                el('div', { class: 'cat-bar', style: `width:${r.amount / peak * 100}%` }),
            ]));
        }
    },

    renderSubs() {
        const box = $('#subs');
        clear(box);

        const active = this.data.subscriptions.filter(s => s.active !== false);
        if (!active.length) {
            box.append(el('div', { class: 'empty' }, [
                icon('sub', 26), '沒有訂閱',
                el('div', { class: 'hint', text: '年繳季繳的會自動換算成每月' }),
            ]));
            return;
        }

        const perMonth = { weekly: a => a * 52 / 12, monthly: a => a, quarterly: a => a / 3, yearly: a => a / 12 };
        const monthly = active.reduce((s, x) => s + perMonth[x.cycle || 'monthly'](Number(x.amount) || 0), 0);
        const cycleName = { weekly: '每週', monthly: '每月', quarterly: '每季', yearly: '每年' };

        box.append(
            el('div', {}, [
                el('span', { class: 'big money-num', text: money(monthly) }),
                el('span', { class: 'sub', text: '／月' }),
            ]),
            el('div', { class: 'sub', style: 'margin-bottom:10px', text: '年繳、季繳的都已換算成每月' }));

        for (const s of active) {
            box.append(el('div', { class: 'sub-row' }, [
                el('div', { class: 'grow' }, [
                    el('div', { class: 'ellipsis', text: s.name }),
                    el('div', { class: 'sub', text: `${cycleName[s.cycle] || '每月'}　下次 ${relativeDay(this.nextCharge(s))}` }),
                ]),
                el('div', { class: 'money-num', text: money(s.amount) }),
                el('button', { class: 'btn small ghost', text: '改', onclick: () => this.editSub(s) }),
            ]));
        }
    },

    /** 下一次扣款日。從第一次扣款往後推，推到今天之後為止。 */
    nextCharge(sub) {
        let d = parseYmd(sub.first || todayStr());
        const today = parseYmd(todayStr());
        let guard = 0;
        while (d < today && guard++ < 500) {
            if (sub.cycle === 'weekly') d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7);
            else if (sub.cycle === 'quarterly') d = new Date(d.getFullYear(), d.getMonth() + 3, d.getDate());
            else if (sub.cycle === 'yearly') d = new Date(d.getFullYear() + 1, d.getMonth(), d.getDate());
            else d = new Date(d.getFullYear(), d.getMonth() + 1, d.getDate());
        }
        return ymd(d);
    },

    /* ── 搜尋與篩選 ────────────────────────────────── */

    renderFilters() {
        const cats = ['', ...new Set(this.data.transactions.map(t => t.category).filter(Boolean))];
        fillSelect($('#f-category'),
            cats.map(c => ({ value: c, label: c || '分類不限' })), $('#f-category').value || '');

        const accs = ['', ...this.data.accounts.map(a => a.name)];
        fillSelect($('#f-account'),
            accs.map(a => ({ value: a, label: a || '帳戶不限' })), $('#f-account').value || '');
    },

    filtered() {
        const q = $('#q').value.trim().toLowerCase();
        const kind = $('#f-kind').value;
        const category = $('#f-category').value;
        const account = $('#f-account').value;
        const when = $('#f-when').value;

        const now = new Date();
        const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastYm = `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}`;
        const cutoff = ymd(new Date(Date.now() - 90 * 86400000));

        return this.data.transactions.filter(t => {
            if (kind && t.kind !== kind) return false;
            if (category && t.category !== category) return false;
            if (account && t.account !== account && t.toAccount !== account) return false;

            if (when === 'month' && monthOf(t.date) !== thisMonth()) return false;
            if (when === 'last' && monthOf(t.date) !== lastYm) return false;
            if (when === 'year' && t.date.slice(0, 4) !== String(now.getFullYear())) return false;
            if (when === '90' && t.date < cutoff) return false;

            if (q) {
                const hay = [t.note, t.category, t.account, t.toAccount, String(t.amount)]
                    .filter(Boolean).join(' ').toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        }).sort((a, b) => b.date.localeCompare(a.date) || (b.id > a.id ? 1 : -1));
    },

    renderTxns() {
        const box = $('#txns');
        clear(box);

        const rows = this.filtered();
        const summary = $('#txn-result-summary');

        if (!rows.length) {
            summary.textContent = '';
            box.append(this.data.transactions.length
                ? el('div', { class: 'empty' }, [icon('list', 26), '沒有符合的帳目'])
                : el('div', { class: 'empty' }, [
                    icon('money', 26), '還沒有任何帳目',
                    el('div', { class: 'hint', text: '按右上角的「記一筆」開始' }),
                ]));
            return;
        }

        // 篩選出來的結果自己就是一個答案：「這半年在藥局花了多少」
        const income = rows.filter(t => t.kind === 'income').reduce((s, t) => s + (+t.amount || 0), 0);
        const expense = rows.filter(t => t.kind === 'expense').reduce((s, t) => s + (+t.amount || 0), 0);
        summary.textContent = `${rows.length} 筆　` +
            (income ? `收入 ${money(income)}　` : '') +
            (expense ? `支出 ${money(expense)}` : '');

        const shown = rows.slice(0, 200);
        for (const t of shown) {
            const isIncome = t.kind === 'income';
            const isTransfer = t.kind === 'transfer';
            box.append(el('div', { class: 'txn-row', onclick: () => this.editTxn(t) },
                [
                    el('div', { class: 'grow' }, [
                        el('div', { class: 'ellipsis', text: t.note || t.category || '（沒有備註）' }),
                        el('div', { class: 'sub' },
                            isTransfer ? `${t.account} → ${t.toAccount}　${relativeDay(t.date)}`
                                       : `${t.category || '未分類'}　${t.account || ''}　${relativeDay(t.date)}`),
                    ]),
                    el('div', {
                        class: 'money-num ' + (isIncome ? 'income' : ''),
                        text: isTransfer ? money(t.amount) : money(isIncome ? +t.amount : -t.amount, true),
                    }),
                ]));
        }

        if (rows.length > shown.length) {
            box.append(el('div', { class: 'sub', style: 'padding-top:12px;text-align:center' },
                `只顯示最近 ${shown.length} 筆，還有 ${rows.length - shown.length} 筆。縮小篩選範圍看更早的。`));
        }
    },

    /* ── 編輯 ──────────────────────────────────────── */

    editTxn(t) {
        const isNew = !t;
        t = t || { id: uid(), date: todayStr(), kind: 'expense', amount: '', category: '', account: '', note: '' };

        $('#dlg-txn-title').textContent = isNew ? '記一筆' : '改這筆';
        $('#t-kind').value = t.kind;
        $('#t-amount').value = t.amount;
        $('#t-date').value = t.date;
        $('#t-note').value = t.note || '';
        $('#t-delete').hidden = isNew;

        const syncKind = () => {
            const kind = $('#t-kind').value;
            const transfer = kind === 'transfer';
            $('#t-category-field').hidden = transfer;
            $('#t-to-field').hidden = !transfer;
            $('#t-account-label').textContent = transfer ? '從' : '帳戶';
            const list = kind === 'income' ? this.data.categories.income : this.data.categories.expense;
            fillSelect($('#t-category'), list.map(c => c.name), t.category);
        };
        $('#t-kind').onchange = syncKind;
        syncKind();

        const accNames = this.data.accounts.map(a => a.name);
        fillSelect($('#t-account'), accNames, t.account || accNames[0]);
        fillSelect($('#t-to-account'), accNames, t.toAccount || accNames[1] || accNames[0]);

        const dlg = openDialog('#dlg-txn');

        $('#t-save').onclick = () => {
            const amount = Number($('#t-amount').value);
            if (!amount || amount <= 0) return toast('金額要填', true);

            Object.assign(t, {
                kind: $('#t-kind').value,
                amount,
                date: $('#t-date').value || todayStr(),
                note: $('#t-note').value.trim(),
                account: $('#t-account').value,
            });
            if (t.kind === 'transfer') {
                t.category = '';
                t.toAccount = $('#t-to-account').value;
                if (t.account === t.toAccount) return toast('轉給自己沒有意義', true);
            } else {
                t.category = $('#t-category').value;
                delete t.toAccount;
            }

            if (isNew) this.data.transactions.push(t);
            this.save();
            dlg.close();
            this.render();
            Overview.render();
            toast(isNew ? '記好了' : '改好了');
        };

        $('#t-delete').onclick = () => {
            this.data.transactions = this.data.transactions.filter(x => x.id !== t.id);
            this.save();
            dlg.close();
            this.render();
            Overview.render();
            toast('刪掉了');
        };
    },

    editAccount(a) {
        const isNew = !a;
        const old = a?.name;
        a = a || { id: uid(), name: '', kind: 'bank', opening: 0, includeInTotal: true, order: this.data.accounts.length };

        $('#dlg-account-title').textContent = isNew ? '加帳戶' : '改帳戶';
        $('#a-name').value = a.name;
        $('#a-kind').value = a.kind;
        $('#a-opening').value = a.opening;
        $('#a-include').checked = a.includeInTotal !== false;
        $('#a-delete').hidden = isNew;

        const dlg = openDialog('#dlg-account');

        $('#a-save').onclick = () => {
            const name = $('#a-name').value.trim();
            if (!name) return toast('名稱要填', true);
            if (this.data.accounts.some(x => x.name === name && x.id !== a.id))
                return toast('已經有同名的帳戶了', true);

            Object.assign(a, {
                name, kind: $('#a-kind').value,
                opening: Number($('#a-opening').value) || 0,
                includeInTotal: $('#a-include').checked,
            });

            // 改名的話，帳目裡的帳戶名要一起改，不然那些帳會變成孤兒
            if (old && old !== name) {
                for (const t of this.data.transactions) {
                    if (t.account === old) t.account = name;
                    if (t.toAccount === old) t.toAccount = name;
                }
                for (const s of this.data.subscriptions) if (s.account === old) s.account = name;
            }

            if (isNew) this.data.accounts.push(a);
            this.save();
            dlg.close();
            this.render();
            Overview.render();
        };

        $('#a-delete').onclick = () => {
            const used = this.data.transactions.some(t => t.account === a.name || t.toAccount === a.name);
            if (used) return toast('這個帳戶還有帳目，刪掉會讓那些帳沒有歸屬', true);
            this.data.accounts = this.data.accounts.filter(x => x.id !== a.id);
            this.save();
            dlg.close();
            this.render();
            Overview.render();
        };
    },

    editSub(s) {
        const isNew = !s;
        s = s || { id: uid(), name: '', amount: '', cycle: 'monthly', first: todayStr(), account: '', active: true };

        $('#dlg-sub-title').textContent = isNew ? '加訂閱' : '改訂閱';
        $('#s-name').value = s.name;
        $('#s-amount').value = s.amount;
        $('#s-cycle').value = s.cycle || 'monthly';
        $('#s-first').value = s.first || todayStr();
        $('#s-active').checked = s.active !== false;
        $('#s-delete').hidden = isNew;

        const dlg = openDialog('#dlg-sub');

        $('#s-save').onclick = () => {
            const name = $('#s-name').value.trim();
            const amount = Number($('#s-amount').value);
            if (!name) return toast('名稱要填', true);
            if (!amount || amount <= 0) return toast('金額要填', true);

            Object.assign(s, {
                name, amount, cycle: $('#s-cycle').value,
                first: $('#s-first').value || todayStr(),
                active: $('#s-active').checked,
            });
            if (isNew) this.data.subscriptions.push(s);
            this.save();
            dlg.close();
            this.render();
        };

        $('#s-delete').onclick = () => {
            this.data.subscriptions = this.data.subscriptions.filter(x => x.id !== s.id);
            this.save();
            dlg.close();
            this.render();
        };
    },

    editBudgets() {
        const box = $('#budget-fields');
        clear(box);

        const current = new Map(this.data.budgets.map(b => [b.category, b.limit]));
        for (const c of this.data.categories.expense) {
            box.append(el('label', { class: 'field' }, [
                el('span', {}, [
                    c.name, ' ',
                    el('span', { class: 'tag ' + (c.nature || 'flexible'),
                                 text: c.nature === 'fixed' ? '固定' : '彈性' }),
                ]),
                el('input', {
                    type: 'number', min: '0', step: '100', 'data-cat': c.name,
                    value: current.get(c.name) ?? '', placeholder: '不設限',
                }),
            ]));
        }

        const dlg = openDialog('#dlg-budget');

        $('#b-save').onclick = () => {
            this.data.budgets = $$('#budget-fields input')
                .map(i => ({ category: i.dataset.cat, limit: Number(i.value) || 0 }))
                .filter(b => b.limit > 0);
            this.save();
            dlg.close();
            this.render();
            toast('預算存好了');
        };
    },

    /** 自訂分類。寫死的分類遲早會缺一個，缺了就只能記到「其他」。 */
    editCategories() {
        const box = $('#category-editor');

        const draw = () => {
            clear(box);
            for (const group of ['expense', 'income']) {
                box.append(el('div', { class: 'section-title', text: group === 'expense' ? '支出' : '收入' }));

                for (const c of this.data.categories[group]) {
                    const used = this.data.transactions.some(t => t.category === c.name);
                    box.append(el('div', { class: 'row', style: 'margin-bottom:8px' }, [
                        el('input', {
                            value: c.name,
                            oninput: e => { c.name = e.target.value; },
                        }),
                        group === 'expense' ? el('select', {
                            class: 'shrink', style: 'width:auto',
                            onchange: e => { c.nature = e.target.value; },
                        }, [
                            el('option', { value: 'flexible', text: '彈性', selected: c.nature !== 'fixed' }),
                            el('option', { value: 'fixed', text: '固定', selected: c.nature === 'fixed' }),
                        ]) : null,
                        el('button', {
                            type: 'button',
                            class: 'btn small shrink ' + (used ? 'ghost' : 'danger'),
                            text: used ? '有帳目' : '刪',
                            title: used ? '已經有帳目用這個分類，改名可以，刪掉不行' : '',
                            onclick: () => {
                                if (used) return toast('這個分類已經有帳目了，改名可以，刪掉會讓那些帳沒有分類', true);
                                this.data.categories[group] =
                                    this.data.categories[group].filter(x => x !== c);
                                draw();
                            },
                        }),
                    ]));
                }

                box.append(el('button', {
                    type: 'button', class: 'btn small', text: '＋ 加一個',
                    onclick: () => {
                        this.data.categories[group].push(
                            group === 'expense' ? { name: '', nature: 'flexible' } : { name: '' });
                        draw();
                    },
                }));
            }
        };

        // 取消要能還原，所以先留一份副本
        const backup = structuredClone(this.data.categories);
        draw();
        const dlg = openDialog('#dlg-categories');

        dlg.addEventListener('close', () => {
            if (dlg.returnValue === 'cancel') {
                this.data.categories = backup;
                this.render();
            }
        }, { once: true });

        $('#c-save').onclick = () => {
            // 空白的直接丟掉，不然下拉選單會出現一個沒有名字的選項
            for (const group of ['expense', 'income']) {
                this.data.categories[group] = this.data.categories[group]
                    .filter(c => c.name.trim())
                    .map(c => ({ ...c, name: c.name.trim() }));
            }
            this.save();
            dlg.close();
            this.render();
            toast('分類存好了');
        };
    },

    /* ── 綁事件 ────────────────────────────────────── */

    bind() {
        $('#add-txn').onclick = () => this.editTxn(null);
        $('#add-account').onclick = () => this.editAccount(null);
        $('#add-sub').onclick = () => this.editSub(null);
        $('#edit-budgets').onclick = () => this.editBudgets();
        $('#manage-categories').onclick = () => this.editCategories();

        $('#trend-range').onchange = () => this.renderTrend();

        let t;
        const refilter = () => { clearTimeout(t); t = setTimeout(() => this.renderTxns(), 120); };
        $('#q').oninput = refilter;
        for (const id of ['#f-kind', '#f-category', '#f-account', '#f-when']) $(id).onchange = refilter;

        $('#clear-filters').onclick = () => {
            $('#q').value = '';
            for (const id of ['#f-kind', '#f-category', '#f-account', '#f-when']) $(id).value = '';
            this.renderTxns();
        };
    },
};
