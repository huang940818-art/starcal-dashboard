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

/* ── 期間 ──────────────────────────────────────────────
 *
 * 她要「可以看月或週或是年，可以自訂」。
 *
 * **週從星期日開始**，跟月曆那邊同一套。兩邊不一樣的話
 * 「這週花了多少」和月曆上圈起來的那七天會對不上。
 *
 * 算式全部用 "yyyy-MM-dd" 字串比大小，不用 Date 物件比——
 * 時區和日光節約會讓 Date 的比較在跨月那幾天出錯，字串不會。
 */

const Range = {
    /** 這個粒度、包含某一天的那一段 */
    make(kind, day = todayStr()) {
        const d = parseYmd(day);
        if (kind === 'week') {
            const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay());
            const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
            return { kind, start: ymd(start), end: ymd(end) };
        }
        if (kind === 'year') {
            return { kind, start: `${d.getFullYear()}-01-01`, end: `${d.getFullYear()}-12-31` };
        }
        if (kind === 'custom') {
            return { kind, start: day, end: day };
        }
        // 月
        const start = new Date(d.getFullYear(), d.getMonth(), 1);
        const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
        return { kind: 'month', start: ymd(start), end: ymd(end) };
    },

    /** 往前／往後一段。自訂區間不給翻——翻到哪裡都不會是她要的。 */
    shift(range, delta) {
        if (range.kind === 'custom') return range;
        const d = parseYmd(range.start);
        if (range.kind === 'week') {
            return this.make('week', ymd(new Date(d.getFullYear(), d.getMonth(),
                                                  d.getDate() + delta * 7)));
        }
        if (range.kind === 'year') {
            return this.make('year', `${d.getFullYear() + delta}-06-15`);
        }
        return this.make('month', ymd(new Date(d.getFullYear(), d.getMonth() + delta, 1)));
    },

    /** 標題。**要看得出是哪一段**——「這個月」在翻過去之後就是謊話。 */
    label(range) {
        const a = parseYmd(range.start), b = parseYmd(range.end);
        if (range.kind === 'year') return `${a.getFullYear()} 年`;
        if (range.kind === 'month') return `${a.getFullYear()} 年 ${a.getMonth() + 1} 月`;
        const same = a.getFullYear() === b.getFullYear();
        const fmt = (d, withYear) =>
            (withYear ? `${d.getFullYear()}/` : '') + `${d.getMonth() + 1}/${d.getDate()}`;
        return `${fmt(a, !same)}–${fmt(b, !same)}`;
    },

    /** 這一段是不是包含今天。包含的話「下一段」要停住，不給看未來。 */
    hasToday(range) {
        const t = todayStr();
        return range.start <= t && t <= range.end;
    },

    contains(range, day) {
        return !!day && range.start <= day && day <= range.end;
    },
};

const Money = {
    data: null,
    /** 現在在看哪個月，"2026-09"。切月份影響上半部那幾張卡。 */


    async init() {
        this.data = await Store.load('記帳');
        this.range = Range.make('month');
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

    /* ── 存錢罐 ────────────────────────────────────────
     *
     * 她要的是「生活費另外記」「存錢要再轉進銀行」「銀行裡的如果有要算，
     * 另外記」——三句話講的是同一件事：**錢要分成幾個桶，但總數還是要
     * 看得到。**
     *
     * 所以不做「分帳本」（那會讓兩邊完全看不到彼此），做「存錢罐帳戶」：
     * 標成存錢罐的帳戶還是算進總資產，但**不算進「可以花的」**。
     * 存錢的動作是轉帳（本來就不算收支），所以存進去不會被當成花掉。
     */

    /** 可以花的：不含存錢罐 */
    spendable() {
        return this.data.accounts
            .filter(a => a.includeInTotal !== false && !a.isSavings)
            .reduce((s, a) => s + this.balance(a.name), 0);
    },

    /** 存起來的 */
    saved() {
        return this.data.accounts
            .filter(a => a.includeInTotal !== false && a.isSavings)
            .reduce((s, a) => s + this.balance(a.name), 0);
    },

    hasSavings() {
        return this.data.accounts.some(a => a.isSavings);
    },

    /* ── 對帳 ──────────────────────────────────────────
     *
     * 她的原話是「如果有差價，要計算一下為什麼」。
     *
     * **「為什麼」我沒辦法真的知道**——漏記的那筆已經不在資料裡了。
     * 能做的是把範圍縮到最小：記下上次對帳的時間點，下次對帳時
     * 就變成「9/1 對過一次，之後記了 12 筆，帳上該少 1,404，
     * 但實際少了 1,604 —— 那 200 是 9/1 之後漏掉的」。
     *
     * 從「不知道哪裡不見了」變成「9/1 之後漏了 200」，
     * 那才是幫得上忙的答案。
     */

    /** 上次對帳之後這個帳戶的變動（照帳目算出來的） */
    changeSince(name, sinceDate) {
        let sum = 0;
        for (const t of this.data.transactions) {
            if (sinceDate && t.date < sinceDate) continue;
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

    /** 上次對帳之後記了幾筆 */
    countSince(name, sinceDate) {
        return this.data.transactions.filter(t =>
            (!sinceDate || t.date >= sinceDate)
            && (t.account === name || t.toAccount === name)).length;
    },

    /**
     * 對一次帳。
     *
     * @param name    帳戶名
     * @param actual  她從銀行 App 或錢包裡數出來的實際金額
     * @returns 差額和能講得出來的範圍
     */
    reconcile(name, actual) {
        const acc = this.data.accounts.find(a => a.name === name);
        const computed = this.balance(name);
        const diff = Number(actual) - computed;
        const since = acc?.checkedAt || null;

        return {
            computed,
            actual: Number(actual),
            diff,
            since,
            // 上次對帳之後的變動和筆數。**沒對過帳的話這兩個沒有意義**——
            // 差額可能來自任何時候，講「最近漏了多少」會是騙人的。
            changeSince: since ? this.changeSince(name, since) : null,
            countSince: since ? this.countSince(name, since) : null,
        };
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

    /** 一段期間的收入與支出。轉帳一樣兩者都不算。 */
    summaryIn(range) {
        let income = 0, expense = 0;
        for (const t of this.data.transactions) {
            if (!Range.contains(range, t.date)) continue;
            const amt = Number(t.amount) || 0;
            if (t.kind === 'income') income += amt;
            else if (t.kind === 'expense') expense += amt;
        }
        return { income, expense, net: income - expense };
    },

    /** 一段期間各分類花了多少，多的在前 */
    byCategoryIn(range) {
        const map = new Map();
        for (const t of this.data.transactions) {
            if (t.kind !== 'expense' || !Range.contains(range, t.date)) continue;
            const key = t.category || '未分類';
            map.set(key, (map.get(key) || 0) + (Number(t.amount) || 0));
        }
        return [...map.entries()]
            .map(([category, amount]) => ({ category, amount }))
            .sort((a, b) => b.amount - a.amount);
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

    /** 現在在看哪一段。預設是這個月。 */
    range: null,

    isNow() { return Range.hasToday(this.range); },

    /** 講到這一段的時候用哪個詞。看「這一週」卻寫「這個月」會很怪。 */
    rangeWord() {
        const now = this.isNow();
        switch (this.range.kind) {
            case 'week': return now ? '這一週' : '那一週';
            case 'year': return now ? '今年' : '那一年';
            case 'custom': return '這段期間';
            default: return now ? '這個月' : '那個月';
        }
    },

    /** 有帳目的最早日期，用來擋住「一直往回翻到空的」 */
    earliestDate() {
        let min = null;
        for (const t of this.data.transactions) {
            if (!min || t.date < min) min = t.date;
        }
        return min;
    },

    setRange(kind, day) {
        this.range = Range.make(kind, day);
        this.render();
    },

    shiftRange(delta) {
        this.range = Range.shift(this.range, delta);
        this.render();
    },

    /**
     * 期間列。
     *
     * 她要「可以看月或週或是年，可以自訂」。粒度做成分段控制而不是下拉，
     * 因為要一眼看得出還有別的粒度可以選——下拉會把它們藏起來。
     */
    renderRangeNav() {
        const box = $('#month-nav');
        clear(box);

        const kinds = [
            { k: 'week', name: '週' },
            { k: 'month', name: '月' },
            { k: 'year', name: '年' },
            { k: 'custom', name: '自訂' },
        ];

        box.append(el('div', { class: 'view-switch range-kinds', role: 'tablist' },
            kinds.map(x => el('button', {
                type: 'button', role: 'tab',
                class: 'view-btn' + (this.range.kind === x.k ? ' on' : ''),
                'aria-selected': String(this.range.kind === x.k),
                text: x.name,
                onclick: () => {
                    if (x.k === 'custom') {
                        // 自訂就從現在這一段開始，不要跳回今天——
                        // 她通常是「看著這個月，想微調成 8/15 到 9/15」
                        this.range = { kind: 'custom', start: this.range.start,
                                       end: this.range.end };
                        this.render();
                    } else {
                        this.setRange(x.k, Range.hasToday(this.range) ? todayStr()
                                                                      : this.range.start);
                    }
                },
            }))));

        const custom = this.range.kind === 'custom';
        const earliest = this.earliestDate();

        const nav = el('div', { class: 'month-nav' }, [
            custom ? null : el('button', {
                class: 'btn icon', text: '‹', 'aria-label': '上一段',
                // 沒有更早的帳目就不給再往回翻——翻進一片空白沒有意義
                disabled: earliest ? this.range.start <= earliest : true,
                onclick: () => this.shiftRange(-1),
            }),
            el('div', { class: 'month-label' }, [
                el('span', { text: Range.label(this.range) }),
                this.isNow() && !custom
                    ? el('span', { class: 'tag', text: '現在' }) : null,
            ]),
            custom ? null : el('button', {
                class: 'btn icon', text: '›', 'aria-label': '下一段',
                disabled: this.isNow(),      // 未來還沒發生，沒得看
                onclick: () => this.shiftRange(1),
            }),
            !this.isNow() && !custom
                ? el('button', {
                    class: 'btn small ghost', text: '回到現在',
                    onclick: () => this.setRange(this.range.kind, todayStr()),
                })
                : null,
        ]);

        if (custom) {
            const from = el('input', {
                type: 'date', value: this.range.start, 'aria-label': '從',
                onchange: e => {
                    this.range.start = e.target.value;
                    // 開始比結束晚的話把結束推過去，不要留一段不存在的期間
                    if (this.range.start > this.range.end) this.range.end = this.range.start;
                    this.render();
                },
            });
            const to = el('input', {
                type: 'date', value: this.range.end, 'aria-label': '到',
                onchange: e => {
                    this.range.end = e.target.value;
                    if (this.range.end < this.range.start) this.range.start = this.range.end;
                    this.render();
                },
            });
            nav.append(el('div', { class: 'custom-range' }, [from, el('span', { text: '–' }), to]));
        }

        box.append(nav);

        // 這幾張卡的標題要跟著期間走，不然翻到七月還寫「這個月」
        const title = this.isNow() && this.range.kind === 'month'
            ? '這個月' : Range.label(this.range);
        $('#month-card-title').textContent = title;
        $('#by-category-title').textContent = `${title}花在哪`;
    },

    render() {
        this.renderRangeNav();
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

        // 有存錢罐才拆開講。沒有的話多兩個數字只是噪音。
        if (this.hasSavings()) {
            total.append(el('div', { class: 'split-row' }, [
                el('div', {}, [
                    el('div', { class: 'sub', text: '可以花的' }),
                    el('div', { class: 'money-num', text: money(this.spendable()) }),
                ]),
                el('div', {}, [
                    el('div', { class: 'sub', text: '存起來的' }),
                    el('div', { class: 'money-num saved', text: money(this.saved()) }),
                ]),
            ]));
        }
        list.style.marginTop = '14px';

        const kindName = { cash: '現金', bank: '銀行', credit: '信用卡', invest: '投資', other: '其他' };
        for (const a of [...this.data.accounts].sort((x, y) => (x.order ?? 0) - (y.order ?? 0))) {
            const bal = this.balance(a.name);
            list.append(el('div', { class: 'account-row' }, [
                el('div', { class: 'grow' }, [
                    el('div', { class: 'ellipsis', text: a.name }),
                    el('div', { class: 'sub' },
                        [kindName[a.kind] || '其他',
                         a.isSavings ? '　存錢罐' : '',
                         a.includeInTotal === false ? '　不計入總額' : '']
                            .join('')),
                ]),
                el('div', {
                    class: 'money-num' + (bal < 0 ? ' negative' : ''),
                    text: money(bal),
                }),
                el('button', {
                    class: 'btn small ghost', text: '對帳',
                    title: a.checkedAt ? `上次對帳 ${a.checkedAt}` : '還沒對過帳',
                    onclick: () => this.openReconcile(a),
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
        const s = this.summaryIn(this.range);
        box.append(
            el('div', { class: 'big money-num' + (s.net < 0 ? ' negative' : ''), text: money(s.net, true) }),
            el('div', { class: 'sub', text: this.rangeWord() + '收支相抵' }),
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
            if (t.kind !== 'expense' || !Range.contains(this.range, t.date)) continue;
            const amt = Number(t.amount) || 0;
            if (this.natureOf(t.category) === 'fixed') fixed += amt;
            else flexible += amt;
        }

        const sum = fixed + flexible;
        if (!sum) {
            box.append(el('div', { class: 'empty' }, [
                icon('scale', 26), this.rangeWord() + '沒有支出',
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

        // **預算是「每個月」的上限，不能照選的期間算。**
        // 看「這一週」的時候拿一週的花費去比月預算，會顯示「還有很多」——
        // 那是錯的，而且錯得讓人放心。所以一律用期間所在的那個月，
        // 並且在非月粒度的時候講清楚看的是哪個月。
        const budgetMonth = monthOf(this.range.start);
        const spent = new Map(this.byCategory(budgetMonth).map(c => [c.category, c.amount]));

        if (this.range.kind !== 'month') {
            const [y, m] = budgetMonth.split('-');
            box.append(el('p', { class: 'sub budget-note',
                text: `預算是按月算的，這裡看的是 ${y} 年 ${Number(m)} 月。` }));
        }

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

        const rows = this.byCategoryIn(this.range);
        if (!rows.length) {
            box.append(el('div', { class: 'empty' }, [
                icon('list', 26), this.rangeWord() + '沒有支出',
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

        const kindNow = () => $('#t-kind').value;

        const syncKind = () => {
            const kind = $('#t-kind').value;
            const transfer = kind === 'transfer';
            $('#t-category-field').hidden = transfer;
            $('#t-to-field').hidden = !transfer;
            $('#t-account-label').textContent = transfer ? '從' : '帳戶';
            const list = kind === 'income' ? this.data.categories.income : this.data.categories.expense;
            // 新的一筆沒有分類，`value = ''` 對不到任何選項，下拉會顯示一片空白——
            // 看起來像壞掉的，而且存下去會變成「未分類」。**預設選第一個。**
            const names = list.map(c => c.name);
            const want = names.includes(t.category) ? t.category : names[0];
            fillSelect($('#t-category'), names, want);
        };
        $('#t-kind').onchange = syncKind;
        syncKind();

        // ── 自動分類 ──
        //
        // 她的原話是「不知道怎麼分」。問題不是分類不夠，是每記一筆
        // 都要停下來想「這算飲食還是日用」。
        //
        // **猜完要看得見。** 猜出來的分類直接填進下拉、旁邊寫一句
        // 「照『全家』猜的」——她一眼看得出這是猜的不是她選的。
        // 完全不猜的話每一筆都要自己選，那才是真正的成本。
        //
        // **她自己動過分類就不再猜。** 猜的東西把人選好的蓋掉，
        // 比不猜還糟。
        const hint = $('#t-cat-hint');
        let pickedByHand = !isNew;      // 改舊的那筆本來就有分類，不要動它

        $('#t-category').addEventListener('change', () => {
            pickedByHand = true;
            hint.hidden = true;
        });

        const autoCategory = () => {
            if (pickedByHand || kindNow() === 'transfer') return;
            const guess = AutoCat.guess(
                $('#t-note').value,
                // 新的排前面：同一家店改記到別的分類之後，照新的那個
                [...this.data.transactions].reverse(),
                (kindNow() === 'income' ? this.data.categories.income
                                        : this.data.categories.expense).map(c => c.name));
            if (!guess) { hint.hidden = true; return; }
            $('#t-category').value = guess.category;
            hint.textContent = `自動選了「${guess.category}」・${guess.reason}`;
            hint.hidden = false;
        };

        $('#t-note').oninput = autoCategory;
        hint.hidden = true;

        // 帳戶下拉的最後一項是「＋ 新增帳戶」。
        //
        // 為什麼要有這個：她說「紀錄支出的時候沒辦法選擇帳戶」——
        // 下拉本身是好的，問題是**裡面只有一個選項，而且當下沒辦法加**。
        // 要加得先取消這一筆、捲到「存款總額」那張卡、按加帳戶、填完、
        // 再回來從頭記一次。那不叫「可以加」。
        const NEW = '\u0000new';      // 不可能跟帳戶名撞到的值
        const fillAccounts = (sel, value) => {
            const names = this.data.accounts.map(a => a.name);
            fillSelect(sel, [...names.map(n => ({ value: n, label: n })),
                             { value: NEW, label: '＋ 新增帳戶…' }],
                       value !== undefined && names.includes(value) ? value : names[0]);
            // 一個帳戶都沒有的時候，下拉會停在「＋ 新增帳戶…」上——那正好，
            // 它自己就在說「這裡要先開一個」。
            if (!names.length) sel.value = NEW;
        };

        const newBox = $('#t-new-account');
        const nameInput = $('#t-new-account-name');
        let pendingFor = null;          // 建好之後要填回哪一個下拉

        const closeNew = () => { newBox.hidden = true; pendingFor = null; };
        const openNew = sel => {
            pendingFor = sel;
            newBox.hidden = false;
            nameInput.value = '';
            $('#t-new-account-kind').value = 'cash';
            nameInput.focus();
        };

        const watchNew = sel => {
            sel.onchange = () => {
                if (sel.value === NEW) openNew(sel);
                else if (pendingFor === sel) closeNew();
            };
        };

        fillAccounts($('#t-account'), t.account);
        fillAccounts($('#t-to-account'), t.toAccount || this.data.accounts[1]?.name);
        watchNew($('#t-account'));
        watchNew($('#t-to-account'));
        closeNew();

        $('#t-new-account-cancel').onclick = () => {
            // 取消就退回原本選的那個；本來就沒有帳戶的話留在「＋ 新增帳戶…」
            const names = this.data.accounts.map(a => a.name);
            if (pendingFor && names.length) pendingFor.value = t.account && names.includes(t.account)
                ? t.account : names[0];
            closeNew();
        };

        $('#t-new-account-add').onclick = () => {
            const name = nameInput.value.trim();
            if (!name) return toast('帳戶要有名字', true);
            if (this.data.accounts.some(a => a.name === name))
                return toast('已經有同名的帳戶了', true);

            this.data.accounts.push({
                id: uid(), name, kind: $('#t-new-account-kind').value,
                // 起始餘額先當成 0。在記帳記到一半的時候問「這個戶頭現在有多少」
                // 是打斷；之後在「存款總額」那張卡按「改」補就好。
                opening: 0, includeInTotal: true, order: this.data.accounts.length,
            });
            this.save();

            const target = pendingFor;
            fillAccounts($('#t-account'), $('#t-account').value === NEW ? name : $('#t-account').value);
            fillAccounts($('#t-to-account'), $('#t-to-account').value === NEW ? name : $('#t-to-account').value);
            if (target) target.value = name;
            closeNew();
            this.render();
            Overview.render();
            toast(`加好了：${name}`);
        };

        const dlg = openDialog('#dlg-txn');

        $('#t-save').onclick = () => {
            const amount = Number($('#t-amount').value);
            if (!amount || amount <= 0) return toast('金額要填', true);

            if ($('#t-account').value === NEW
                || (kindNow() === 'transfer' && $('#t-to-account').value === NEW))
                return toast('先把新帳戶建起來，或選一個現有的', true);

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

    /* ── 對帳的畫面 ─────────────────────────────────── */

    openReconcile(a) {
        $('#dlg-reconcile-title').textContent = `對帳・${a.name}`;
        $('#rc-computed').value = money(this.balance(a.name));
        $('#rc-actual').value = '';
        clear($('#rc-result'));

        const dlg = openDialog('#dlg-reconcile');
        const show = () => {
            const box = $('#rc-result');
            clear(box);
            const raw = $('#rc-actual').value;
            if (raw === '') return;

            const r = this.reconcile(a.name, raw);
            if (r.diff === 0) {
                box.append(el('p', { class: 'rc-ok', text: '對得起來，一塊錢都沒差。' }));
                return;
            }

            const more = r.diff > 0;
            box.append(el('p', { class: 'rc-diff' }, [
                `實際${more ? '多' : '少'}了 `,
                el('strong', { text: money(Math.abs(r.diff)) }),
                more ? '　（有筆收入沒記到）' : '　（有筆支出沒記到）',
            ]));

            // **範圍是這裡最有用的東西。** 差額本身她自己看銀行也知道，
            // 「9/1 之後漏了 200」才是幫得上忙的答案。
            if (r.since) {
                box.append(el('p', { class: 'sub' },
                    `${r.since} 對過一次，之後記了 ${r.countSince} 筆、`
                    + `合計 ${money(r.changeSince, true)}。`
                    + `這 ${money(Math.abs(r.diff))} 是那之後漏掉的。`));
            } else {
                // 沒對過帳就不要假裝知道範圍——那個差額可能來自任何時候
                box.append(el('p', { class: 'sub' },
                    '這是第一次對帳，所以沒辦法說是什麼時候漏的。'
                    + '補完這一筆之後，下次就只要找這次到下次之間。'));
            }
        };

        $('#rc-actual').oninput = show;

        $('#rc-adjust').onclick = () => {
            const raw = $('#rc-actual').value;
            if (raw === '') return toast('先填實際有多少', true);
            const r = this.reconcile(a.name, raw);
            if (r.diff !== 0) {
                // 補一筆把帳做平。**分類寫清楚是「對帳補的」**——
                // 混在飲食裡的話，月底統計會多出一筆她沒花過的錢。
                this.data.transactions.push({
                    id: uid(),
                    date: todayStr(),
                    kind: r.diff > 0 ? 'income' : 'expense',
                    amount: Math.abs(r.diff),
                    category: '其他',
                    account: a.name,
                    note: `對帳補的差額（${r.since ? r.since + ' 之後' : '第一次對帳'}）`,
                    updatedAt: stamp(),
                });
            }
            a.checkedBalance = Number(raw);
            a.checkedAt = todayStr();
            a.updatedAt = stamp();
            this.save();
            dlg.close();
            this.render();
            Overview.render();
            toast(r.diff === 0 ? '對過了' : `補了一筆 ${money(Math.abs(r.diff))}`);
        };

        $('#rc-save').onclick = () => {
            const raw = $('#rc-actual').value;
            a.checkedBalance = raw === '' ? undefined : Number(raw);
            a.checkedAt = todayStr();
            a.updatedAt = stamp();
            this.save();
            dlg.close();
            this.render();
            toast('記下對過了，差額沒有補');
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
        $('#a-savings').checked = !!a.isSavings;
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
                isSavings: $('#a-savings').checked,
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
