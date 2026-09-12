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

/** 「存款遮起來」記在瀏覽器自己身上，不進資料。 */
const HIDE_KEY = '星歷:遮住存款';

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
        // 一天。start 和 end 同一天，後面每一支照期間跑的算術都不用改。
        if (kind === 'day') return { kind, start: day, end: day };
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
        if (range.kind === 'day') {
            return this.make('day', ymd(new Date(d.getFullYear(), d.getMonth(),
                                                 d.getDate() + delta)));
        }
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
        // 一天要寫出星期幾。「9 月 12 日」看不出是平日還是假日，
        // 而「那天我怎麼花這麼多」通常第一個想到的就是那天是週幾。
        if (range.kind === 'day') {
            const w = '日一二三四五六'[a.getDay()];
            const sameYear = a.getFullYear() === new Date().getFullYear();
            return (sameYear ? '' : `${a.getFullYear()} 年 `)
                 + `${a.getMonth() + 1} 月 ${a.getDate()} 日（${w}）`;
        }
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
        this.loadHideBalance();
        this.bind();
    },

    /* ── 遮住存款 ──────────────────────────────────────
     *
     * 「旁邊有人」不是這份帳的性質，是這台裝置此刻的處境——
     * 所以存在瀏覽器裡，不寫進 ~/星歷資料。手機上遮起來，
     * 不會害電腦上那份也跟著看不到。
     */
    hideBalance: false,

    loadHideBalance() {
        try { this.hideBalance = localStorage.getItem(HIDE_KEY) === '1'; } catch {}
    },

    toggleHideBalance() {
        this.hideBalance = !this.hideBalance;
        try { localStorage.setItem(HIDE_KEY, this.hideBalance ? '1' : '0'); } catch {}
        this.renderAccounts();
    },

    /** 遮起來的時候金額換成點點。**連正負也要遮**——
     *  一串紅色的點點等於還是說出了「你是負的」。 */
    secret(n, sign = false) {
        return this.hideBalance ? '••••••' : money(n, sign);
    },

    /** 舊資料補上後來才加的欄位。少一個欄位就整頁爆掉是最沒必要的當機。 */
    migrate() {
        const d = this.data;
        d.accounts ??= [];
        d.transactions ??= [];
        d.subscriptions ??= [];
        d.budgets ??= [];
        // 總預算跟分類預算分開放。塞在 budgets 裡（用一個空的 category）
        // 的話，每一支照分類跑的迴圈都要記得跳過它——漏一個地方，
        // 總預算就會變成一個叫「」的分類混在畫面上。
        d.totalBudgets ??= [];
        /* 每天的預算。**跟月預算是兩件事，不是同一個數字換算。**
         *
         * 月預算除以天數推算得出「今天大概可以用多少」，但她要的是
         * 自己定「吃的一天最多 300」——那是一個決定，不是一個除法。
         * 兩個並存：有自訂的就用自訂的，沒有的才退回月預算去推。
         */
        d.dailyBudgets ??= [];      // [{ category, limit }]
        d.dailyTotal ??= null;      // 一天總共可以花多少
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
    monthSummary(ym, acct = '') {
        let income = 0, expense = 0;
        for (const t of this.data.transactions) {
            if (monthOf(t.date) !== ym) continue;
            if (acct && t.account !== acct) continue;
            const amt = Number(t.amount) || 0;
            if (t.kind === 'income') income += amt;
            else if (t.kind === 'expense') expense += amt;
        }
        return { income, expense, net: income - expense };
    },

    /** 一段期間的收入與支出。轉帳一樣兩者都不算。 */
    summaryIn(range, acct = '') {
        let income = 0, expense = 0;
        for (const t of this.data.transactions) {
            if (!Range.contains(range, t.date)) continue;
            if (acct && t.account !== acct) continue;
            const amt = Number(t.amount) || 0;
            if (t.kind === 'income') income += amt;
            else if (t.kind === 'expense') expense += amt;
        }
        return { income, expense, net: income - expense };
    },

    /** 一段期間各分類花了多少，多的在前 */
    byCategoryIn(range, acct = '') {
        const map = new Map();
        for (const t of this.data.transactions) {
            if (t.kind !== 'expense' || !Range.contains(range, t.date)) continue;
            if (acct && t.account !== acct) continue;
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

    /* ── 預算 ──────────────────────────────────────────
     *
     * 她問「每個月的預算可以自訂嗎」。
     *
     * **平常一份，某個月可以另外設。** 每個月都要重設一次太累，
     * 但九月有註冊費、二月有紅包——那幾個月的預算本來就不該跟平常一樣。
     *
     * 所以 budgets 裡有兩種：沒有 month 的是平常的，有 month 的
     * 只套用那個月。查的時候先找那個月的，沒有才用平常的。
     */
    budgetsFor(ym) {
        const base = this.data.budgets.filter(b => !b.month);
        const override = this.data.budgets.filter(b => b.month === ym);
        if (!override.length) return base;

        // 那個月有設就用那個月的，那個月沒提到的分類還是用平常的
        const map = new Map(base.map(b => [b.category, b]));
        for (const b of override) map.set(b.category, b);
        return [...map.values()];
    },

    /** 這個月有沒有自己的一套 */
    hasOwnBudget(ym) {
        return this.data.budgets.some(b => b.month === ym);
    },

    /* ── 總預算與「一天可以用多少」────────────────────
     *
     * 分類預算回答「餐飲還能花多少」，但那要五條加起來才知道
     * 「今天到底還能不能出去吃」。總預算回答的是後面這個。
     *
     * **兩個都留著，因為它們回答不同的問題**——分類是「錢花去哪」，
     * 總額是「還剩多少」。合成一個的話會失去其中一半。
     */

    /** 這個月的總預算。沒設就是 null（不是 0——那是兩件事）。 */
    totalBudgetFor(ym) {
        // `?? []` 是刻意的：migrate 會補上這個欄位，但這支在畫面上到處被呼叫，
        // 少一個欄位就整頁爆掉是最沒必要的當機。
        const list = this.data.totalBudgets ?? [];
        const own = list.find(b => b.month === ym);
        const base = list.find(b => !b.month);
        const limit = Number((own ?? base)?.limit) || 0;
        return limit > 0 ? limit : null;
    },

    hasOwnTotalBudget(ym) {
        return (this.data.totalBudgets ?? []).some(b => b.month === ym && Number(b.limit) > 0);
    },

    /**
     * 總預算現在的樣子，以及**平均一天可以用多少**。
     *
     * `perDayLeft` 是「剩下的錢 ÷ 含今天在內的剩餘天數」，不是
     * 「總預算 ÷ 整個月」。差別在於它會自己修正：今天多花了，
     * 明天那個數字就會掉下來；前幾天省了，它會升上去。
     * 拿一個固定的「每天 500」看，月底才發現早就爆了。
     *
     * **今天要算進剩餘天數。** 剩下的錢本來就得撐過今天，
     * 而今天已經花掉的也已經從 used 扣掉了。
     */
    /**
     * 一個上限在某個月的進度，含「今天可以用多少」。
     *
     * 總預算和每一個分類都走這一支。**兩邊一定要同一套算法**——
     * 「今天總共可以用 414」和「今天吃的可以用 169」如果是兩種算法，
     * 加起來對不上的時候沒有人查得出來是哪邊錯。
     *
     * @param used        這個月（到現在為止）花掉的
     * @param spentToday  其中今天花掉的
     */
    pace(ym, limit, used, spentToday) {
        const days = daysInMonth(ym);
        const now = thisMonth();
        const isNow = ym === now;

        // 過去的月份整個月都過完了，未來的月份一天都還沒開始
        const passed = ym < now ? days : ym > now ? 0 : new Date().getDate();
        const daysLeft = days - passed + (isNow ? 1 : 0);   // 含今天

        /* **今天的額度要用「今天之前」花掉的算，不能含今天。**
         *
         * 本來是拿「剩下的錢 ÷ 剩下的天數」，而剩下的錢已經扣掉今天花的了。
         * 結果是今天花了 155，那個數字只從 414 掉到 407——分母有 24 天，
         * 今天花的錢被攤平到看不見。**「今天的預算」對今天沒有回饋，
         * 就不是今天的預算。**
         *
         * 改成先扣掉今天以前的，再平均分給含今天在內的剩餘天數：
         * 那就是「今天可以用多少」。今天花掉的從這個額度裡扣，
         * 剩多少一眼看得到；今天花超了，明天的額度會自己掉下來。
         */
        const beforeToday = used - spentToday;
        const perDayLeft = daysLeft > 0
            ? Math.max(limit - beforeToday, 0) / daysLeft
            : null;

        return {
            limit, used, days, daysLeft, isNow,
            left: limit - used,
            over: used > limit,
            perDay: limit / days,                 // 一開始的額度（整個月平分）
            perDayLeft,                           // 今天可以用多少
            spentToday,                           // 今天已經花掉的
            // 今天還剩多少。**可以是負的**——今天花超了要看得見，
            // 那正是這個數字唯一有用的時刻。
            todayLeft: perDayLeft === null ? null : perDayLeft - spentToday,
            spentPerDay: passed > 0 ? used / passed : null,
        };
    },

    /** 總預算的進度。沒設總預算就是 null。 */
    budgetPace(ym) {
        const limit = this.totalBudgetFor(ym);
        if (!limit) return null;
        const isNow = ym === thisMonth();
        return this.pace(ym, limit, this.monthSummary(ym).expense,
                         isNow ? this.dayFlow().expense : 0);
    },

    /* ── 每天的預算（自己定的）────────────────────────
     *
     * 她的原話：「今日預算沒有補上，你給的是這個月的，我希望可以放在
     * 今日收支，比如支出食物 155/300 這種的，還要可以自訂」。
     */

    /** 這一類每天的額度（自己定的）。沒定就是 null。 */
    dailyLimitFor(category) {
        const row = (this.data.dailyBudgets ?? []).find(b => b.category === category);
        const n = Number(row?.limit) || 0;
        return n > 0 ? n : null;
    },

    /** 一天總共可以花多少（自己定的）。沒定就是 null。 */
    dailyTotalLimit() {
        const n = Number(this.data.dailyTotal) || 0;
        return n > 0 ? n : null;
    },

    hasDailyBudget() {
        return !!this.dailyTotalLimit()
            || (this.data.dailyBudgets ?? []).some(b => Number(b.limit) > 0);
    },

    /**
     * 今天這一類的額度和花掉的。
     *
     * **自己定的優先，沒定的才拿月預算去推。** 兩種都要能講出來源，
     * 不然畫面上兩個長得一樣的數字，一個是她決定的、一個是我算的，
     * 分不出來就沒辦法信任任何一個。
     *
     * @returns null＝這一類既沒自訂也沒有月預算，沒有額度可講
     */
    todayQuota(category) {
        const spent = this.dayCategoryExpense(category);

        const own = this.dailyLimitFor(category);
        if (own !== null) {
            return { category, limit: own, spent, left: own - spent, source: 'daily' };
        }

        const month = this.budgetsFor(thisMonth())
            .find(b => b.category === category && Number(b.limit) > 0);
        if (!month) return null;

        const p = this.categoryPace(thisMonth(), category, month.limit);
        if (!p || !p.isNow || p.perDayLeft === null) return null;
        return {
            category, limit: p.perDayLeft, spent, left: p.todayLeft, source: 'month',
        };
    },

    /** 今天總共的額度和花掉的。規則同上。 */
    todayTotalQuota() {
        const spent = this.dayFlow().expense;

        const own = this.dailyTotalLimit();
        if (own !== null) {
            return { limit: own, spent, left: own - spent, source: 'daily' };
        }

        const p = this.budgetPace(thisMonth());
        if (!p || !p.isNow || p.perDayLeft === null) return null;
        return { limit: p.perDayLeft, spent, left: p.todayLeft, source: 'month' };
    },

    /** 今天有額度可以講的那幾類。**照分類清單的順序**，位置每天不動。 */
    todayQuotas() {
        const out = [];
        for (const c of this.data.categories.expense) {
            const q = this.todayQuota(c.name);
            if (q) out.push(q);
        }
        return out;
    },

    /** 某一天某個分類花了多少 */
    dayCategoryExpense(category, day = todayStr()) {
        let sum = 0;
        for (const t of this.data.transactions) {
            if (t.kind !== 'expense' || t.date !== day) continue;
            if ((t.category || '未分類') !== category) continue;
            sum += Number(t.amount) || 0;
        }
        return sum;
    },

    /**
     * 一個分類的進度，含「今天這一類可以用多少」。
     *
     * 她的原話：「沒有分類，比如今天的預算，吃的、交通這種」。
     * 月預算回答「這個月飲食還剩多少」，但站在超商前面要的是
     * **今天這一類還能花多少**——那要自己拿剩下的除以剩下的天數，
     * 六個分類就要算六次。
     */
    categoryPace(ym, category, limit) {
        const used = this.byCategory(ym).find(c => c.category === category)?.amount || 0;
        const isNow = ym === thisMonth();
        return this.pace(ym, Number(limit), used,
                         isNow ? this.dayCategoryExpense(category) : 0);
    },

    /** 今天記了哪幾筆。新的在前面。 */
    onDay(day = todayStr()) {
        return this.data.transactions
            .filter(t => t.date === day)
            .sort((a, b) => String(b.id).localeCompare(String(a.id)));
    },

    /** 某一天的收支合計。轉帳一樣兩邊都不算。 */
    dayFlow(day = todayStr()) {
        let income = 0, expense = 0;
        for (const t of this.data.transactions) {
            if (t.date !== day) continue;
            const amt = Number(t.amount) || 0;
            if (t.kind === 'income') income += amt;
            else if (t.kind === 'expense') expense += amt;
        }
        return { income, expense, net: income - expense };
    },

    /**
     * 分類的顏色。
     *
     * **照分類在清單裡的位置給，不照金額排名。** 照排名的話，
     * 這個月餐飲最多是紅色，下個月房租超過它，紅色就換人了——
     * 翻月份的時候顏色一直在動，等於沒有顏色。
     */
    colorOf(category) {
        const i = this.data.categories.expense.findIndex(c => c.name === category);
        if (i < 0) return 'var(--text-3)';        // 未分類、或已經被刪掉的分類
        return LABEL_COLORS[i % LABEL_COLORS.length];
    },

    natureOf(category) {
        return this.data.categories.expense.find(c => c.name === category)?.nature || 'flexible';
    },

    /* ── 畫面 ──────────────────────────────────────── */

    /** 現在在看哪一段。預設是這個月。 */
    range: null,

    /**
     * 報表只看哪個帳戶（空字串＝全部）。存的是帳戶**名字**，
     * 因為每一筆帳裡記的就是名字。
     *
     * **預算不吃這個篩選。** 只看郵局的花費卻拿全部的預算去比，
     * 會顯示「還有很多」——那是錯的，而且錯得讓人放心。
     */
    reportAccount: '',

    isNow() { return Range.hasToday(this.range); },

    /** 講到這一段的時候用哪個詞。看「這一週」卻寫「這個月」會很怪。 */
    rangeWord() {
        const now = this.isNow();
        switch (this.range.kind) {
            case 'day': return now ? '今天' : '那天';
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
            // 「日」排第一。她要的是「看某一天總共花了多少」——
            // 那是最小的一段，放在最左邊才跟後面由小到大接得上。
            { k: 'day', name: '日' },
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

        /* 只看哪個帳戶。
         *
         * 她的帳戶很多（郵局、學生證、幾張卡、證券），問的是
         * 「這張卡到底花了多少」。放在期間旁邊而不是每張卡各自一個——
         * 分開放的話翻報表要一張一張改，而且很容易兩張卡設得不一樣，
         * 看到的數字對不起來卻不知道為什麼。
         */
        const names = this.data.accounts.map(a => a.name);
        if (names.length > 1) {
            // 帳戶被改名或刪掉之後，篩選卡在一個不存在的名字上會讓
            // 每張報表都空白，看起來像資料不見了
            if (this.reportAccount && !names.includes(this.reportAccount)) {
                this.reportAccount = '';
            }
            const sel = el('select', { class: 'shrink', 'aria-label': '只看哪個帳戶' });
            fillSelect(sel, [{ value: '', label: '全部帳戶' },
                             ...names.map(n => ({ value: n, label: n }))],
                       this.reportAccount);
            sel.onchange = () => { this.reportAccount = sel.value; this.render(); };

            box.append(el('div', { class: 'acct-filter' }, [
                el('span', { class: 'sub', text: '報表只看' }),
                sel,
                this.reportAccount
                    ? el('button', {
                        class: 'btn small ghost', text: '看全部',
                        onclick: () => { this.reportAccount = ''; this.render(); },
                    })
                    : null,
            ]));
        }

        // 這幾張卡的標題要跟著期間走，不然翻到七月還寫「這個月」。
        // 今天和這個月講得出口語就講口語，其他一律寫出是哪一段。
        const title = this.isNow() && this.range.kind === 'month' ? '這個月'
                    : this.isNow() && this.range.kind === 'day' ? '今天'
                    : Range.label(this.range);
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

    /** 眼睛那顆的長相跟著狀態走 */
    syncHideButton() {
        const b = $('#toggle-balance');
        if (!b) return;
        clear(b);
        b.append(icon(this.hideBalance ? 'eye-off' : 'eye', 16));
        b.setAttribute('aria-pressed', String(this.hideBalance));
        b.setAttribute('aria-label', this.hideBalance ? '顯示金額' : '遮住金額');
        b.title = this.hideBalance ? '顯示金額' : '遮住金額';
    },

    renderAccounts() {
        const total = $('#accounts-total');
        const list = $('#accounts-list');
        clear(total);
        clear(list);
        this.syncHideButton();

        // 一個帳戶都沒有的時候不要報「0」——那看起來像「你的存款是零」，
        // 但實際上是「還沒告訴我有哪些帳戶」。這兩件事差很多。
        $('#pick-savings').hidden = !this.data.accounts.length;

        if (!this.data.accounts.length) {
            list.append(el('div', { class: 'empty' }, [
                icon('wallet', 26), '還沒有帳戶',
                el('div', { class: 'hint', text: '先加一個，帳目才有地方去' }),
            ]));
            return;
        }

        total.append(
            el('div', {
                class: 'big money-num' + (this.hideBalance ? ' masked' : ''),
                text: this.secret(this.total()),
            }),
            el('div', { class: 'sub', text: '算進總額的帳戶合計' }));

        // 有存錢罐才拆開講。沒有的話多兩個數字只是噪音。
        if (this.hasSavings()) {
            total.append(el('div', { class: 'split-row' }, [
                el('div', {}, [
                    el('div', { class: 'sub', text: '可以花的' }),
                    el('div', { class: 'money-num' + (this.hideBalance ? ' masked' : ''),
                                text: this.secret(this.spendable()) }),
                ]),
                el('div', {}, [
                    el('div', { class: 'sub', text: '存起來的' }),
                    el('div', { class: 'money-num' + (this.hideBalance ? ' masked' : ' saved'),
                                text: this.secret(this.saved()) }),
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
                    // 遮起來的時候連紅色也要拿掉——一串紅色的點點
                    // 還是說出了「這個戶頭是負的」。
                    class: 'money-num'
                        + (this.hideBalance ? ' masked' : bal < 0 ? ' negative' : ''),
                    text: this.secret(bal),
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
        const s = this.summaryIn(this.range, this.reportAccount);

        /* **看一天的時候主角是支出，不是收支相抵。**
         *
         * 月結問的是「這個月到底有沒有透支」，所以主角是淨額。
         * 但一天幾乎不會有收入，淨額等於支出的負數——那個大大的
         * 「−480」只是把「花了 480」換一個比較難讀的寫法。
         * 她要的是「這一天總共花多少」，所以那個數字自己站出來。
         */
        if (this.range.kind === 'day') {
            const count = this.data.transactions.filter(t =>
                Range.contains(this.range, t.date)
                && (!this.reportAccount || t.account === this.reportAccount)).length;

            box.append(
                el('div', { class: 'big money-num', text: money(s.expense) }),
                el('div', { class: 'sub', text: this.rangeWord() + '花掉的' }),
                el('div', { style: 'display:flex;gap:22px;margin-top:16px' }, [
                    // 沒有收入的日子佔絕大多數，寫出來只是每天看一次「0」
                    s.income ? el('div', {}, [
                        el('div', { class: 'sub', text: '收入' }),
                        el('div', { class: 'money-num income', style: 'font-size:19px',
                                    text: money(s.income) }),
                    ]) : null,
                    s.income ? el('div', {}, [
                        el('div', { class: 'sub', text: '收支相抵' }),
                        el('div', { class: 'money-num' + (s.net < 0 ? ' negative' : ''),
                                    style: 'font-size:19px', text: money(s.net, true) }),
                    ]) : null,
                    el('div', {}, [
                        el('div', { class: 'sub', text: '筆數' }),
                        el('div', { class: 'money-num', style: 'font-size:19px', text: String(count) }),
                    ]),
                ]));
            return;
        }

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
            if (this.reportAccount && t.account !== this.reportAccount) continue;
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
            el('div', { class: 'ff-split' }, [
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

        // **把「哪些算固定」寫出來。**
        //
        // 她的原話是「固定支出不知道怎麼算的」——本來這張卡只給兩個數字，
        // 怎麼分的完全看不到，設定又藏在「所有帳目」那張卡的「管理分類」裡，
        // 等於沒有。
        const fixedNames = this.data.categories.expense
            .filter(c => c.nature === 'fixed').map(c => c.name);
        box.append(el('p', { class: 'sub ff-note' },
            fixedNames.length
                ? `算固定的：${fixedNames.join('、')}。其他都算彈性。`
                : '現在每一類都算彈性。按右上角挑出非花不可的那幾類'
                  + '（房租、訂閱、交通…），才看得出真正能省的有多少。'));
    },

    /**
     * 總預算那一塊。
     *
     * **主角是「每天可以用多少」那個數字，不是「花了多少」。**
     * 「這個月花了 8,200」要自己拿去減、再除以剩幾天，才知道
     * 今天還能不能出去吃一頓；「今天起每天可以用 486」不用。
     */
    paceBlock(p) {
        const ratio = p.used / p.limit;
        const cls = p.over ? 'over' : ratio > 0.8 ? 'warn' : '';

        const block = el('div', { class: 'pace' }, [
            el('div', { class: 'budget-head' }, [
                el('span', { text: '這個月總共可以花' }),
                el('span', {
                    class: 'money-num ' + (p.over ? 'negative' : 'sub'),
                    text: p.over ? `超出 ${money(p.used - p.limit)}` : `還有 ${money(p.left)}`,
                }),
            ]),
            el('div', { class: 'track' }, [
                el('div', { class: `fill ${cls}`, style: `width:${Math.min(ratio, 1) * 100}%` }),
            ]),
            el('div', { class: 'sub', style: 'margin-top:4px',
                        text: `${money(p.used)} / ${money(p.limit)}` }),
        ]);

        if (p.over) {
            // 這裡不寫「每天可以用 0」——那個 0 看起來像算壞了，
            // 而且它要講的其實是一句話不是一個數字。
            block.append(el('div', { class: 'pace-day' }, [
                el('div', { class: 'pace-word', text: '這個月的額度用完了' }),
                p.daysLeft > 0
                    ? el('div', { class: 'sub', text: `還有 ${p.daysLeft} 天` })
                    : null,
            ]));
        } else if (p.perDayLeft !== null) {
            // 今天花掉的要跟額度擺在一起。**分開放就等於要她自己減一次**，
            // 而「今天還能不能吃這一餐」正是要那個減出來的數字。
            const todayLine = !p.isNow ? null
                : p.todayLeft >= 0
                    ? `今天花了 ${money(p.spentToday)}，還剩 ${money(p.todayLeft)}`
                    : `今天花了 ${money(p.spentToday)}，超出 ${money(-p.todayLeft)}`;

            block.append(el('div', { class: 'pace-day' }, [
                el('div', {}, [
                    el('div', { class: 'sub', text: p.isNow ? '今天可以用' : '平均每天可以用' }),
                    el('div', { class: 'pace-num money-num', text: money(p.perDayLeft) }),
                    todayLine
                        ? el('div', { class: 'sub' + (p.todayLeft < 0 ? ' negative' : ''),
                                      style: 'margin-top:4px', text: todayLine })
                        : null,
                ]),
                el('div', { class: 'sub pace-side' }, [
                    p.isNow ? `這個月還有 ${p.daysLeft} 天` : `整個月 ${p.days} 天`,
                    el('br'),
                    `一開始是每天 ${money(p.perDay)}`,
                ]),
            ]));
        } else {
            // 過去的月份：沒有「還能用多少」，只有「後來平均花了多少」
            block.append(el('div', { class: 'pace-day' }, [
                el('div', { class: 'sub', text:
                    `平均每天花了 ${money(p.spentPerDay)}，額度是每天 ${money(p.perDay)}` }),
            ]));
        }

        return block;
    },

    renderBudgets() {
        const box = $('#budgets');
        clear(box);

        const budgetMonthEarly = monthOf(this.range.start);
        const budgets = this.budgetsFor(budgetMonthEarly).filter(b => Number(b.limit) > 0);
        const pace = this.budgetPace(budgetMonthEarly);
        if (!budgets.length && !pace) {
            box.append(el('div', { class: 'empty' }, [
                icon('budget', 26), '還沒設預算',
                el('div', { class: 'hint', text: '設一個總額，就看得到「今天起每天可以用多少」' }),
            ]));
            return;
        }

        // **預算是「每個月」的上限，不能照選的期間算。**
        // 看「這一週」的時候拿一週的花費去比月預算，會顯示「還有很多」——
        // 那是錯的，而且錯得讓人放心。所以一律用期間所在的那個月，
        // 並且在非月粒度的時候講清楚看的是哪個月。
        const budgetMonth = budgetMonthEarly;
        const spent = new Map(this.byCategory(budgetMonth).map(c => [c.category, c.amount]));

        // 這個月另外設過的話要講出來，不然她會以為改到的是平常那份
        if (this.hasOwnBudget(budgetMonth) || this.hasOwnTotalBudget(budgetMonth)) {
            const [y, m] = budgetMonth.split('-');
            box.append(el('p', { class: 'sub budget-note',
                text: `${y} 年 ${Number(m)} 月有自己的一套預算。` }));
        }

        if (this.range.kind !== 'month') {
            const [y, m] = budgetMonth.split('-');
            box.append(el('p', { class: 'sub budget-note',
                text: `預算是按月算的，這裡看的是 ${y} 年 ${Number(m)} 月。` }));
        }

        // 上面篩了帳戶，這張卡卻是全部一起算——不寫出來的話，
        // 她會以為看到的是「郵局還剩多少」
        if (this.reportAccount) {
            box.append(el('p', { class: 'sub budget-note',
                text: '預算是全部帳戶一起算的，不受上面的帳戶篩選影響。' }));
        }

        // 總預算放最上面。分類回答「錢花去哪」，總額回答「今天還能花多少」，
        // 後面那個是每天真的會想知道的，所以它在上面。
        if (pace) {
            box.append(this.paceBlock(pace));

            // 分類加起來比總預算還多的話要講。**兩個數字互相矛盾**，
            // 不講的話她會照著分類花，然後在月底發現總額早就爆了。
            const sum = budgets.reduce((s, b) => s + Number(b.limit), 0);
            if (sum > pace.limit) {
                box.append(el('p', { class: 'sub budget-note', text:
                    `底下的分類加起來是 ${money(sum)}，比總預算多 ${money(sum - pace.limit)}`
                    + '——分類全部花滿的話會超出總額。' }));
            }
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
                /* 底下這一行只寫**這個月**的進度。
                 *
                 * 這裡本來右邊還接一段「今天可以用 169」。算的是對的，
                 * 但一列同時擺兩種期間的數字，六列疊起來就是一面數字牆——
                 * 而且「還有 345」和「今天超出 134」一綠一紅並排，
                 * 看起來像自己跟自己打架。
                 *
                 * **當日的額度歸總覽的「今天的額度」那張卡**（`Overview.renderBudget`），
                 * 那裡本來就是一天一次的視角。這張卡回答的是「這個月剩多少」。
                 * 一張卡一種期間。 */
                el('div', { class: 'budget-foot' }, [
                    el('span', { class: 'sub', text: `${money(used)} / ${money(limit)}` }),
                ]),
            ]));
        }
    },

    /** 每月收支畫成長條還是折線 */
    trendShape: 'bar',

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

        const rows = months.map(ym => ({ ym, ...this.monthSummary(ym, this.reportAccount) }));
        const peak = Math.max(1, ...rows.map(r => Math.max(r.income, r.expense)));

        if (!rows.some(r => r.income || r.expense)) {
            box.append(el('div', { class: 'empty', text: '這段期間沒有帳目' }));
            return;
        }

        if (this.trendShape === 'line') {
            /* 折線。
             *
             * 長條看的是「這個月多少」，折線看的是「一路走下來的形狀」——
             * 看十二個月的時候折線清楚得多，看六個月的時候長條比較好比。
             * 所以給她自己切，不預設哪個比較好。
             */
            // **照容器的實際寬度畫。** 固定比例的 viewBox 在寬螢幕上會把
            // 整條線壓成扁扁一條、下面留一大片空白；用 preserveAspectRatio
            // 硬拉又會把圓點拉成橢圓。量一次最準。
            const w = Math.max(280, box.clientWidth || 320);
            box.append(
                Charts.lines([
                    { values: rows.map(r => r.income), color: 'var(--good)' },
                    { values: rows.map(r => r.expense), color: 'var(--money)' },
                ], { width: w, height: 150 }),
                el('div', { class: 'chart-axis' }, rows.map(r => el('span', {
                    class: 'chart-label',
                    text: rows.length > 8 ? String(Number(r.ym.slice(5))) : monthLabel(r.ym),
                }))));
        } else box.append(
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
                // 十二個月一起看的時候只寫數字。「10月」在一支手機上
                // 塞不下十二欄，而上面已經寫了「近 12 個月」，
                // 每一欄再寫一次「月」是重複的。
                el('div', { class: 'chart-label',
                            text: rows.length > 8 ? String(Number(r.ym.slice(5)))
                                                  : monthLabel(r.ym) }),
            ]))));

        box.append(
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

        const rows = this.byCategoryIn(this.range, this.reportAccount);

        // 換期間或換帳戶之後，原本攤開的那一類可能在這一段根本沒花過。
        // 留著的話會掛一塊空白，看起來像壞掉的。
        // **要在「整段都沒支出」那個 return 之前收**，不然一路翻到空白的
        // 月份再翻回來，它還記著上一次攤開的那一類。
        if (this.openCategory && !rows.some(r => r.category === this.openCategory)) {
            this.openCategory = null;
        }

        if (!rows.length) {
            box.append(el('div', { class: 'empty' }, [
                icon('list', 26), this.rangeWord() + '沒有支出',
            ]));
            return;
        }

        const peak = rows[0].amount;
        const sum = rows.reduce((s, r) => s + r.amount, 0);

        /* 圓餅（甜甜圈）。
         *
         * 條狀圖回答的是「哪一類最多」，圓餅回答的是「這一類佔我多少」——
         * 兩個問題不一樣，所以兩個都留著，不是二選一。
         *
         * 只畫前六類，剩下的併成「其他」。十四類各佔百分之七的話，
         * 畫出來是十四條看不出誰是誰的細縫。
         */
        const TOP = 6;
        const head = rows.slice(0, TOP);
        const tail = rows.slice(TOP);
        const pie = head.map(r => ({
            label: r.category, value: r.amount, color: this.colorOf(r.category),
        }));
        const otherLabel = tail.length ? '其他 ' + tail.length + ' 類' : null;
        if (tail.length) {
            pie.push({
                label: otherLabel,
                value: tail.reduce((a, b) => a + b.amount, 0),
                color: 'var(--text-3)',
            });
        }

        box.append(el('div', { class: 'pie-wrap' }, [
            Charts.donut(pie, {
                center: [
                    el('div', { class: 'money-num', text: money(sum) }),
                    el('div', { class: 'sub', text: '總支出' }),
                ],
            }),
            el('div', { class: 'pie-legend' }, pie.map(p => {
                // 「其他 N 類」不是一個分類，點進去沒有一批帳可以列
                const cat = p.label === otherLabel ? null : p.label;
                return el('div', {
                    class: 'pie-key' + (cat ? ' tappable' : '')
                         + (cat && cat === this.openCategory ? ' on' : ''),
                    onclick: cat ? () => this.toggleCategory(cat) : null,
                }, [
                    el('i', { style: `background:${p.color}` }),
                    el('span', { class: 'ellipsis', text: p.label }),
                    el('span', { class: 'sub', text: Math.round(p.value / sum * 100) + '%' }),
                ]);
            })),
        ]));

        /* 分類點得進去。
         *
         * 她的原話：「圓餅圖下面的分類可以直接點進去看」。
         * 「餐飲 3,240」自己回答不了「那到底是哪幾餐」——要嘛翻到最下面
         * 那張「所有帳目」重設一次篩選，要嘛就算了。**攤開在原地**才是
         * 「直接點進去」：同一段期間、同一個帳戶篩選，不用再對一次條件。
         */
        const SHOWN_CATS = 8;
        for (const r of rows.slice(0, SHOWN_CATS)) {
            const open = r.category === this.openCategory;
            box.append(el('div', {
                class: 'cat-row tappable' + (open ? ' on' : ''),
                role: 'button', tabindex: '0',
                'aria-expanded': String(open),
                onclick: () => this.toggleCategory(r.category),
                onkeydown: e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        this.toggleCategory(r.category);
                    }
                },
            }, [
                el('span', {}, [
                    r.category,
                    ' ',
                    el('span', {
                        class: 'tag ' + this.natureOf(r.category),
                        text: this.natureOf(r.category) === 'fixed' ? '固定' : '彈性',
                    }),
                ]),
                el('span', { class: 'money-num', text: `${money(r.amount)}　${Math.round(r.amount / sum * 100)}%` }),
                // 條的顏色跟上面圓餅同一套——兩張圖講的是同一批分類，
                // 顏色對不起來的話眼睛要重新認一次
                el('div', { class: 'cat-bar',
                            style: `width:${r.amount / peak * 100}%;`
                                 + `background:${this.colorOf(r.category)}` }),
            ]));

            if (open) box.append(this.categoryDetail(r.category));
        }

        // 原本超過八類就安靜地截掉。看不到的不知道自己看不到，
        // 「加起來怎麼不等於總支出」會變成一個查不出來的疑問。
        if (rows.length > SHOWN_CATS) {
            box.append(el('div', { class: 'sub', style: 'margin-top:10px',
                text: `還有 ${rows.length - SHOWN_CATS} 類，合計 `
                    + money(rows.slice(SHOWN_CATS).reduce((a, b) => a + b.amount, 0)) }));
        }
    },

    /** 現在攤開的是哪一類（null＝都收起來）。只記一個，開新的就收舊的。 */
    openCategory: null,

    toggleCategory(category) {
        this.openCategory = this.openCategory === category ? null : category;
        this.renderByCategory();
    },

    /** 這一類在這段期間的每一筆。點一筆就能改，跟「所有帳目」那邊一樣。 */
    categoryDetail(category) {
        const rows = this.data.transactions
            .filter(t => t.kind === 'expense'
                      && Range.contains(this.range, t.date)
                      && (t.category || '未分類') === category
                      && (!this.reportAccount || t.account === this.reportAccount))
            .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));

        const SHOWN = 20;
        const box = el('div', { class: 'cat-detail' });

        for (const t of rows.slice(0, SHOWN)) {
            box.append(el('div', { class: 'txn-row', onclick: () => this.editTxn(t) }, [
                el('div', { class: 'grow' }, [
                    el('div', { class: 'ellipsis', text: t.note || t.category || '（沒有備註）' }),
                    el('div', { class: 'sub ellipsis',
                        // 只看一天的時候每一列的日期都一樣，寫了是廢話
                        text: [this.range.kind === 'day' ? null : relativeDay(t.date), t.account]
                            .filter(Boolean).join('　') }),
                ]),
                el('div', { class: 'money-num', text: money(t.amount) }),
            ]));
        }

        if (rows.length > SHOWN) {
            box.append(el('div', { class: 'sub', style: 'padding-top:8px',
                text: `還有 ${rows.length - SHOWN} 筆，到最下面「所有帳目」用篩選看` }));
        }

        return box;
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

    /* ── 從別的 App 匯進來 ──────────────────────────── */

    openImport() {
        const box = $('#csv-body');
        clear(box);
        $('#csv-go').hidden = true;
        box.append(
            el('p', { class: 'sub', style: 'margin:0 0 14px;line-height:1.75', text:
                '大部分記帳 App 都能把資料匯出成 CSV。選好檔案之後，'
                + '我會先猜每一欄是什麼、給你看前幾筆，確認過才真的匯進來。' }),
            el('button', {
                type: 'button', class: 'btn primary', text: '選一個 CSV 檔',
                onclick: () => $('#csv-file').click(),
            }));
        openDialog('#dlg-csv');
    },

    async handleImportFile(file) {
        const text = await file.text();
        const { headers, rows } = Csv.parse(text);
        const box = $('#csv-body');
        clear(box);

        if (!headers.length || !rows.length) {
            $('#csv-go').hidden = true;
            box.append(el('p', { class: 'rc-diff', text: '這個檔案裡沒有讀得到的資料。' }));
            return;
        }

        const map = Csv.guessMapping(headers);
        const accounts = this.data.accounts.map(a => a.name);
        const fields = [
            ['date', '日期', true],
            ['amount', '金額', false],
            ['income', '收入欄', false],
            ['expense', '支出欄', false],
            ['kind', '收支類型', false],
            ['category', '分類', false],
            ['note', '備註', false],
            ['account', '帳戶', false],
        ];

        const preview = el('div', { id: 'csv-preview' });

        const redraw = () => {
            clear(preview);
            const out = Csv.toTransactions(rows, map, {
                accounts,
                defaultAccount: this.data.accounts[0]?.name || '',
            });
            const { fresh, dup } = Csv.dedupe(out.rows, this.data.transactions);
            this._pendingImport = fresh;
            $('#csv-go').hidden = !fresh.length;
            $('#csv-go').textContent = fresh.length ? `匯進 ${fresh.length} 筆` : '沒有可以匯的';

            preview.append(el('p', { class: 'csv-count' }, [
                `讀到 ${rows.length} 列，可以匯 `,
                el('strong', { text: String(fresh.length) }),
                ' 筆。',
                dup.length ? `　${dup.length} 筆已經有了，會跳過。` : '',
            ]));

            // **解不開的要講出來。** 安靜地跳過等於偷偷少匯了幾筆。
            if (out.problems.length) {
                preview.append(el('details', { class: 'csv-problems' }, [
                    el('summary', { text: `${out.problems.length} 列讀不懂，不會匯進來` }),
                    el('div', {}, out.problems.slice(0, 20).map(p =>
                        el('div', { class: 'sub', text: `第 ${p.line} 列：${p.why}`
                            + (p.raw ? `（${p.raw}）` : '') }))),
                ]));
            }

            if (!fresh.length) return;

            // 前五筆長什麼樣。**看不到就不敢按**——兩百筆錯的混進來
            // 之後要一筆一筆挑出來刪，比重打還累。
            const table = el('table', { class: 'csv-table' }, [
                el('tr', {}, ['日期', '收支', '金額', '分類', '備註', '帳戶']
                    .map(h => el('th', { text: h }))),
                ...fresh.slice(0, 5).map(t => el('tr', {}, [
                    el('td', { text: t.date }),
                    el('td', { text: { income: '收入', expense: '支出', transfer: '轉帳' }[t.kind] }),
                    el('td', { class: 'money-num', text: money(t.amount) }),
                    el('td', { text: t.category || '—' }),
                    el('td', { class: 'ellipsis', text: t.note || '—' }),
                    el('td', { text: t.account || '—' }),
                ])),
            ]);
            preview.append(table);
            if (fresh.length > 5) {
                preview.append(el('p', { class: 'sub', text: `…還有 ${fresh.length - 5} 筆` }));
            }
        };

        box.append(
            el('p', { class: 'sub', style: 'margin:0 0 12px',
                text: `${file.name}・讀到 ${rows.length} 列。下面是我猜的欄位對應，可以改。` }),
            el('div', { class: 'csv-map' }, fields.map(([key, label, required]) =>
                el('label', { class: 'field' }, [
                    el('span', { text: label + (required ? '（一定要）' : '') }),
                    (() => {
                        const sel = el('select', {
                            onchange: e => { map[key] = e.target.value || undefined; redraw(); },
                        });
                        fillSelect(sel, [{ value: '', label: '（沒有）' },
                                         ...headers.map(h => ({ value: h, label: h }))],
                                   map[key] || '');
                        return sel;
                    })(),
                ]))),
            preview);

        redraw();
    },

    doImport() {
        const rows = this._pendingImport || [];
        if (!rows.length) return;

        // 匯進來的分類如果本機沒有，補上去——不然那些帳會變成「未分類」，
        // 統計就白做了。
        const have = new Set(this.data.categories.expense.map(c => c.name));
        const incomeHave = new Set(this.data.categories.income.map(c => c.name));
        for (const t of rows) {
            if (!t.category) continue;
            if (t.kind === 'income' && !incomeHave.has(t.category)) {
                incomeHave.add(t.category);
                this.data.categories.income.push({ name: t.category });
            } else if (t.kind !== 'income' && !have.has(t.category)) {
                have.add(t.category);
                this.data.categories.expense.push({ name: t.category, nature: 'flexible' });
            }
        }

        this.data.transactions.push(...rows);
        this.save();
        $('#dlg-csv').close();
        this.render();
        Overview.render();

        const ids = new Set(rows.map(t => t.id));
        toastAction(`匯進 ${rows.length} 筆`, '全部收回', () => {
            this.data.transactions = this.data.transactions.filter(t => !ids.has(t.id));
            this.save();
            this.render();
            Overview.render();
            toast('收回來了');
        });
        this._pendingImport = null;
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
                // **開這個對話框的時候一定要把現在的值讀進來**（上面那行）。
                // 少了那一行，只是進來改個名字就會把存錢罐的設定洗掉，
                // 而且畫面上要等到下一次看「可以花的」才發現。
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

    /**
     * 挑哪幾個戶頭是存錢罐。
     *
     * **這是「從既有的戶頭裡挑」。** 她的原話：「應該算是從原有的帳戶
     * 裡面挑一個出來」。原本只有「加帳戶」表單裡的一個勾選框，要改一個
     * 已經建好的戶頭，得先想到去按那一列的「改」——看得到卻不能當場動它。
     *
     * 所以另外做一張清單，一次看得到所有戶頭和它們的餘額——
     * 「哪個是我不能動的」本來就是拿全部來比才回答得出來的問題。
     *
     * **兩個入口都留著**（她說的），寫的是同一個欄位：
     * 建戶頭當下就知道的話在那邊勾，之後要重新分配的話在這邊挑。
     */
    editSavings() {
        const box = $('#savings-list');
        clear(box);

        if (!this.data.accounts.length) return;

        const picked = new Set(this.data.accounts.filter(a => a.isSavings).map(a => a.id));

        const draw = () => {
            clear(box);
            for (const a of [...this.data.accounts].sort((x, y) => (x.order ?? 0) - (y.order ?? 0))) {
                const on = picked.has(a.id);
                box.append(el('label', { class: 'pick-row' + (on ? ' on' : '') }, [
                    el('input', {
                        type: 'checkbox', checked: on,
                        onchange: e => {
                            e.target.checked ? picked.add(a.id) : picked.delete(a.id);
                            draw();
                        },
                    }),
                    el('div', { class: 'grow' }, [
                        el('div', { class: 'ellipsis', text: a.name }),
                        el('div', { class: 'sub', text: on ? '存起來的' : '可以花的' }),
                    ]),
                    el('div', { class: 'money-num', text: this.secret(this.balance(a.name)) }),
                ]));
            }

            // 全部都挑成存錢罐 = 可以花的是 0。那多半不是她的意思。
            if (picked.size && picked.size === this.data.accounts.length) {
                box.append(el('p', { class: 'sub cat-hint', style: 'margin-top:10px',
                    text: '全部都標成存錢罐的話，「可以花的」會是 0。' }));
            } else if (this.data.accounts.length === 1) {
                box.append(el('p', { class: 'sub', style: 'margin-top:10px',
                    text: '只有一個戶頭的話用不到這個——錢都在同一個地方，'
                        + '沒有「哪些不能動」的問題。' }));
            }
        };

        draw();
        const dlg = openDialog('#dlg-savings');

        $('#sv-save').onclick = () => {
            for (const a of this.data.accounts) a.isSavings = picked.has(a.id);
            this.save();
            dlg.close();
            this.render();
            Overview.render();
            toast(picked.size ? `標了 ${picked.size} 個存錢罐` : '沒有存錢罐了');
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
        const scopeBox = $('#budget-scope');
        const totalBox = $('#budget-total');
        const box = $('#budget-fields');
        const ym = monthOf(this.range.start);
        const [yy, mm] = ym.split('-');
        const days = daysInMonth(ym);
        // 這個月已經有自己的一套就直接編那一套，不然先編平常的
        let scope = this.hasOwnBudget(ym) || this.hasOwnTotalBudget(ym) ? ym : '';
        /* 現在在編月的還是日的。
         *
         * **兩組數字不能混在同一頁。** 「飲食 5000」和「飲食 300」
         * 擺在一起，隔一天就分不出哪個是月哪個是日了。 */
        let unit = this.hasDailyBudget() ? 'day' : 'month';

        const draw = () => {
            clear(scopeBox);
            clear(totalBox);
            clear(box);

            scopeBox.append(el('div', { class: 'view-switch', style: 'margin-bottom:14px' }, [
                el('button', {
                    type: 'button', class: 'view-btn' + (unit === 'month' ? ' on' : ''),
                    text: '每個月', onclick: () => { unit = 'month'; draw(); },
                }),
                el('button', {
                    type: 'button', class: 'view-btn' + (unit === 'day' ? ' on' : ''),
                    text: '每天', onclick: () => { unit = 'day'; draw(); },
                }),
            ]));

            if (unit === 'day') {
                this.drawDailyFields(scopeBox, totalBox, box);
                return;
            }

            scopeBox.append(el('div', { class: 'view-switch', style: 'margin-bottom:14px' }, [
                el('button', {
                    type: 'button', class: 'view-btn' + (scope === '' ? ' on' : ''),
                    text: '平常',
                    onclick: () => { scope = ''; draw(); },
                }),
                el('button', {
                    type: 'button', class: 'view-btn' + (scope ? ' on' : ''),
                    text: `只有 ${Number(mm)} 月`,
                    onclick: () => { scope = ym; draw(); },
                }),
            ]));

            scopeBox.append(el('p', { class: 'sub', style: 'margin:-6px 0 12px', text: scope
                ? `只改 ${yy} 年 ${Number(mm)} 月。這個月沒填的分類還是照平常的走。`
                : '每個月都套用這一份。某個月不一樣的話，切到右邊那個。' }));

            /* ── 總預算 ──
             *
             * 擺在分類上面，因為它是「一個月總共可以花多少」——
             * 分類是這個數字底下怎麼分配。順序反過來的話，
             * 得把五個分類填完才知道自己答應了多少錢出去。
             */
            const totalBase = this.data.totalBudgets.find(b => !b.month)?.limit;
            const totalOwn = this.data.totalBudgets.find(b => b.month === ym)?.limit;

            const perDay = el('p', { class: 'pace-hint' });
            const input = el('input', {
                type: 'number', min: '0', step: '500', id: 'b-total',
                value: (scope ? totalOwn : totalBase) ?? '',
                placeholder: scope && totalBase ? `平常 ${money(totalBase)}` : '不設限',
            });
            // 一邊打一邊算給她看。**這正是她問的那個數字**，
            // 存完再跳回去看等於要她自己心算一次。
            const showPerDay = () => {
                const v = Number(input.value) || (scope ? Number(totalBase) || 0 : 0);
                perDay.textContent = v > 0
                    ? `${Number(mm)} 月有 ${days} 天，平均一天可以用 ${money(v / days)}`
                    : '填了才算得出「平均一天可以用多少」。';
            };
            input.addEventListener('input', showPerDay);
            showPerDay();

            totalBox.append(
                el('label', { class: 'field' }, [
                    el('span', { text: '這個月總共可以花' }),
                    input,
                ]),
                perDay,
                el('div', { class: 'section-title', text: '分類' }));

            const base = new Map(this.data.budgets.filter(b => !b.month)
                .map(b => [b.category, b.limit]));
            const own = new Map(this.data.budgets.filter(b => b.month === ym)
                .map(b => [b.category, b.limit]));
            const current = scope ? own : base;

        for (const c of this.data.categories.expense) {
            box.append(el('label', { class: 'field' }, [
                el('span', {}, [
                    c.name, ' ',
                    el('span', { class: 'tag ' + (c.nature || 'flexible'),
                                 text: c.nature === 'fixed' ? '固定' : '彈性' }),
                ]),
                el('input', {
                    type: 'number', min: '0', step: '100', 'data-cat': c.name,
                    value: current.get(c.name) ?? '',
                    // 只設這個月的時候，平常那份是背景值——寫出來她才知道
                    // 「留白」不等於「不設限」，而是「照平常的」
                    placeholder: scope && base.get(c.name)
                        ? `平常 ${money(base.get(c.name))}` : '不設限',
                }),
            ]));
        }
        };

        draw();
        const dlg = openDialog('#dlg-budget');

        $('#b-save').onclick = () => {
            if (unit === 'day') return this.saveDailyBudgets(dlg);

            // **只挑有 data-cat 的。** 總預算那格也在這個對話框裡，
            // 掃進來的話會變成一個名字是 undefined 的分類。
            const rows = $$('#budget-fields input[data-cat]')
                .map(i => ({ category: i.dataset.cat, limit: Number(i.value) || 0 }))
                .filter(b => b.limit > 0);

            // 只換掉正在編的那一份，另一份不動
            this.data.budgets = this.data.budgets.filter(b =>
                scope ? b.month !== ym : !!b.month);
            this.data.budgets.push(...rows.map(b => scope ? { ...b, month: ym } : b));

            const total = Number($('#b-total').value) || 0;
            this.data.totalBudgets = this.data.totalBudgets.filter(b =>
                scope ? b.month !== ym : !!b.month);
            if (total > 0) {
                this.data.totalBudgets.push(scope ? { limit: total, month: ym } : { limit: total });
            }

            this.save();
            dlg.close();
            this.render();
            // 總覽上的「今天的收支」也在講每天可以用多少，一起更新
            Overview.render();
            toast(scope ? `${Number(mm)} 月的預算存好了` : '預算存好了');
        };
    },

    /**
     * 「每天」那一頁的欄位。
     *
     * 留白不是 0，是「這一類沒有自己的每日額度」——那時候會退回
     * 月預算去推算（畫面上會標成「照月預算算的」）。**這件事一定要
     * 寫在提示裡**，不然留白看起來像「不設限」。
     */
    drawDailyFields(scopeBox, totalBox, box) {
        scopeBox.append(el('p', { class: 'sub', style: 'margin:-6px 0 12px' },
            '自己定「一天最多花多少」。留白的分類會拿月預算除以剩下的天數'
            + '去推，畫面上會標出來哪個是你定的、哪個是算的。'));

        const totalInput = el('input', {
            type: 'number', min: '0', step: '50', id: 'b-daily-total',
            value: this.dailyTotal ?? this.data.dailyTotal ?? '',
            placeholder: '照月預算算',
        });
        totalBox.append(
            el('label', { class: 'field' }, [
                el('span', { text: '一天總共可以花' }),
                totalInput,
            ]),
            el('div', { class: 'section-title', text: '分類（一天）' }));

        for (const c of this.data.categories.expense) {
            const own = this.dailyLimitFor(c.name);
            // 月預算推出來的數字寫在提示裡，她才知道留白會拿到什麼
            const month = this.budgetsFor(thisMonth())
                .find(b => b.category === c.name && Number(b.limit) > 0);
            const guess = month
                ? this.categoryPace(thisMonth(), c.name, month.limit)?.perDayLeft
                : null;

            box.append(el('label', { class: 'field' }, [
                el('span', {}, [
                    c.name, ' ',
                    el('span', { class: 'tag ' + (c.nature || 'flexible'),
                                 text: c.nature === 'fixed' ? '固定' : '彈性' }),
                ]),
                el('input', {
                    type: 'number', min: '0', step: '10', 'data-daily-cat': c.name,
                    value: own ?? '',
                    placeholder: guess ? `照月預算算是 ${money(guess)}` : '沒有額度',
                }),
            ]));
        }
    },

    saveDailyBudgets(dlg) {
        const rows = $$('#budget-fields input[data-daily-cat]')
            .map(i => ({ category: i.dataset.dailyCat, limit: Number(i.value) || 0 }))
            .filter(b => b.limit > 0);

        this.data.dailyBudgets = rows;
        this.data.dailyTotal = Number($('#b-daily-total').value) || null;

        this.save();
        dlg.close();
        this.render();
        Overview.render();
        toast(rows.length || this.data.dailyTotal ? '每天的預算存好了' : '每天的預算清掉了');
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
                    box.append(el('div', { class: 'cat-edit-row' }, [
                        el('input', {
                            value: c.name,
                            'aria-label': '分類名稱',
                            oninput: e => { c.name = e.target.value; },
                        }),
                        group === 'expense' ? el('select', {
                            'aria-label': `${c.name} 是固定還是彈性`,
                            onchange: e => { c.nature = e.target.value; },
                        }, [
                            el('option', { value: 'flexible', text: '彈性', selected: c.nature !== 'fixed' }),
                            el('option', { value: 'fixed', text: '固定', selected: c.nature === 'fixed' }),
                        ]) : null,
                        el('button', {
                            type: 'button',
                            class: 'btn small ' + (used ? 'ghost' : 'danger'),
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
        $('#toggle-balance').onclick = () => this.toggleHideBalance();
        $('#pick-savings').onclick = () => this.editSavings();
        $('#add-sub').onclick = () => this.editSub(null);
        $('#edit-budgets').onclick = () => this.editBudgets();
        $('#manage-categories').onclick = () => this.editCategories();
        // 「哪些算固定」跟「管理分類」是同一個畫面。入口放兩個地方，
        // 因為她是在看那張卡的時候才想到要問「這是怎麼分的」。
        $('#edit-nature').onclick = () => this.editCategories();
        $('#import-csv').onclick = () => this.openImport();
        $('#csv-go').onclick = () => this.doImport();
        $('#csv-file').onchange = e => {
            const file = e.target.files?.[0];
            e.target.value = '';       // 同一個檔連選兩次也要有反應
            if (file) this.handleImportFile(file);
        };

        $('#trend-range').onchange = () => this.renderTrend();

        /* 折線圖是照容器寬度畫死的，視窗變寬變窄要重畫。
         *
         * 也順便處理「在別的分頁時 clientWidth 是 0」——切回記帳的那一刻
         * 寬度從 0 變成實際值，這裡就會被叫到。 */
        let lastWidth = 0;
        new ResizeObserver(entries => {
            const w = Math.round(entries[0].contentRect.width);
            // 只認寬度。重畫會改高度，跟著高度重畫會沒完沒了
            if (!w || w === lastWidth) return;
            lastWidth = w;
            if (this.trendShape === 'line' && !$('#panel-money').hidden) this.renderTrend();
        }).observe($('#trend'));

        for (const b of $$('#trend-shape .view-btn')) {
            b.onclick = () => {
                this.trendShape = b.dataset.shape;
                for (const x of $$('#trend-shape .view-btn')) {
                    x.classList.toggle('on', x === b);
                }
                this.renderTrend();
            };
        }

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
