/* 記帳算術的測試。
 *
 *   node --test 測試.mjs
 *
 * 只測算得出對錯的東西——餘額、月結、分類、預算、篩選、下次扣款。
 * 畫面長怎樣用眼睛看比較快，但「這個月到底花了多少」用眼睛看不出來，
 * 而且算錯了不會有任何地方報錯，只會安靜地給一個錯的數字。
 *
 * 測試不載入 store.js（那支要 fetch 和 localStorage），
 * 只把純算術的部分挖出來跑。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/** 把幾支瀏覽器用的 script 在同一個作用域裡跑起來，回傳裡面的全域。 */
function load(...files) {
    const src = files.map(f => readFileSync(new URL(f, import.meta.url), 'utf-8')).join('\n');
    const names = ['Charts', 'Money', 'money', 'ymd', 'parseYmd', 'monthOf', 'recentMonths', 'DEMO', 'AutoCat', 'Range', 'Csv', 'uid', 'stamp', 'pad', 'Weather', 'Overview'];
    // 這些檔案是給瀏覽器的全域 script，沒有 export。包一層把要的東西丟出來。
    // **沒定義的名字要給 undefined，不能直接丟出去。** names 是所有 load()
    // 共用的一份清單，只載其中一支檔案的時候，其他名字本來就不存在——
    // 直接 `return { Weather }` 會 ReferenceError，而且錯在 eval 出來的
    // <anonymous_script> 裡，行號對不回任何一個檔案，很難查。
    const pick = names.map(n => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`);
    return new Function(`
        const document = { querySelector: () => null, querySelectorAll: () => [] };
        ${src}
        return { ${pick.join(', ')} };
    `)();
}

const { Charts, Money, money, ymd, parseYmd, monthOf, recentMonths, DEMO, AutoCat, Range, Csv } =
    load('./js/util.js', './js/demo.js', './js/money.js', './js/autocat.js', './js/csv.js',
         './js/charts.js');

// overview.js 只是宣告一個物件，載進來不會跑任何畫面的東西。
// 這裡要的是卡片順序那段純算的邏輯。
const { Overview } = load('./js/overview.js');

/** 給一份乾淨的資料，避免測試互相影響 */
function setup(overrides = {}) {
    Money.data = {
        accounts: [
            { id: 'a1', name: '郵局', kind: 'bank', opening: 1000, includeInTotal: true },
            { id: 'a2', name: '現金', kind: 'cash', opening: 500, includeInTotal: true },
            { id: 'a3', name: '定存', kind: 'invest', opening: 9000, includeInTotal: false },
        ],
        transactions: [],
        subscriptions: [],
        budgets: [],
        categories: {
            expense: [
                { name: '餐飲', nature: 'flexible' },
                { name: '房租', nature: 'fixed' },
            ],
            income: [{ name: '打工' }],
        },
        ...overrides,
    };
    return Money;
}

const thisMonthStr = ymd().slice(0, 7);
const day = n => `${thisMonthStr}-${String(n).padStart(2, '0')}`;

/* ── 餘額 ──────────────────────────────────────────── */

test('沒有帳目時，餘額就是起始餘額', () => {
    const m = setup();
    assert.equal(m.balance('郵局'), 1000);
});

test('收入加、支出減', () => {
    const m = setup();
    m.data.transactions = [
        { id: '1', date: day(1), kind: 'income', amount: 500, account: '郵局' },
        { id: '2', date: day(2), kind: 'expense', amount: 200, account: '郵局' },
    ];
    assert.equal(m.balance('郵局'), 1300);
});

test('轉帳是一邊減一邊加，總額不變', () => {
    const m = setup();
    m.data.transactions = [
        { id: '1', date: day(1), kind: 'transfer', amount: 300, account: '郵局', toAccount: '現金' },
    ];
    assert.equal(m.balance('郵局'), 700);
    assert.equal(m.balance('現金'), 800);
    assert.equal(m.total(), 1500, '轉帳不該改變存款總額');
});

test('不計入總額的帳戶真的不算進去', () => {
    const m = setup();
    assert.equal(m.total(), 1500, '定存的 9000 不該被算進來');
});

test('信用卡花錢會變負的，那正好是欠款', () => {
    const m = setup();
    m.data.accounts.push({ id: 'a4', name: '信用卡', kind: 'credit', opening: 0, includeInTotal: true });
    m.data.transactions = [
        { id: '1', date: day(3), kind: 'expense', amount: 1200, account: '信用卡' },
    ];
    assert.equal(m.balance('信用卡'), -1200);
    assert.equal(m.total(), 300, '欠的錢要從總額裡扣掉');
});

/* ── 月結 ──────────────────────────────────────────── */

test('轉帳不算收入也不算支出', () => {
    const m = setup();
    m.data.transactions = [
        { id: '1', date: day(1), kind: 'income', amount: 1000, account: '郵局' },
        { id: '2', date: day(2), kind: 'expense', amount: 300, account: '郵局' },
        { id: '3', date: day(3), kind: 'transfer', amount: 5000, account: '郵局', toAccount: '現金' },
    ];
    const s = m.monthSummary(thisMonthStr);
    assert.equal(s.income, 1000, '轉帳被算成收入的話，每轉一次帳就多賺一次');
    assert.equal(s.expense, 300, '轉帳被算成支出的話，每轉一次帳就多花一次');
    assert.equal(s.net, 700);
});

test('別的月份的帳不會混進來', () => {
    const m = setup();
    m.data.transactions = [
        { id: '1', date: day(5), kind: 'expense', amount: 100, account: '現金' },
        { id: '2', date: '2020-01-05', kind: 'expense', amount: 9999, account: '現金' },
    ];
    assert.equal(m.monthSummary(thisMonthStr).expense, 100);
});

/* ── 分類與固定／彈性 ──────────────────────────────── */

test('分類統計由多到少排', () => {
    const m = setup();
    m.data.transactions = [
        { id: '1', date: day(1), kind: 'expense', amount: 100, category: '餐飲', account: '現金' },
        { id: '2', date: day(2), kind: 'expense', amount: 800, category: '房租', account: '郵局' },
        { id: '3', date: day(3), kind: 'expense', amount: 50, category: '餐飲', account: '現金' },
    ];
    const rows = m.byCategory(thisMonthStr);
    assert.deepEqual(rows, [
        { category: '房租', amount: 800 },
        { category: '餐飲', amount: 150 },
    ]);
});

test('沒有分類的帳目歸到「未分類」，不是被丟掉', () => {
    const m = setup();
    m.data.transactions = [
        { id: '1', date: day(1), kind: 'expense', amount: 60, category: '', account: '現金' },
    ];
    assert.deepEqual(m.byCategory(thisMonthStr), [{ category: '未分類', amount: 60 }]);
});

test('分類的性質查得到，查不到的當彈性', () => {
    const m = setup();
    assert.equal(m.natureOf('房租'), 'fixed');
    assert.equal(m.natureOf('餐飲'), 'flexible');
    assert.equal(m.natureOf('不存在的分類'), 'flexible',
        '查不到就當彈性——當成固定會讓「可以省的」看起來比實際少');
});

/* ── 下次扣款 ──────────────────────────────────────── */

test('每月訂閱會推到今天之後', () => {
    const m = setup();
    const next = m.nextCharge({ cycle: 'monthly', first: '2020-03-15' });
    assert.ok(next >= ymd(), `下次扣款 ${next} 應該在今天之後`);
    assert.equal(next.slice(-2), '15', '日期要維持 15 號');
});

test('年繳訂閱不會被推成每月', () => {
    const m = setup();
    const next = m.nextCharge({ cycle: 'yearly', first: '2020-06-10' });
    assert.equal(next.slice(5), '06-10');
    assert.ok(next >= ymd());
});

test('第一次扣款還沒到的話，下次就是那一天', () => {
    const m = setup();
    const future = ymd(new Date(Date.now() + 30 * 86400000));
    assert.equal(m.nextCharge({ cycle: 'monthly', first: future }), future);
});

/* ── 格式化 ────────────────────────────────────────── */

test('金額不留小數，負數用減號', () => {
    assert.equal(money(1234.6), '1,235');
    assert.equal(money(-500), '−500');
    assert.equal(money(1000, true), '+1,000');
    assert.equal(money(0, true), '0', '零不該有正負號');
});

test('ymd 用本地時間，不是 UTC', () => {
    // 台灣時間半夜記的帳，用 toISOString 會掉到前一天
    const midnight = new Date(2026, 8, 2, 0, 30);
    assert.equal(ymd(midnight), '2026-09-02');
});

test('parseYmd 和 ymd 對得起來', () => {
    assert.equal(ymd(parseYmd('2026-09-02')), '2026-09-02');
});

test('recentMonths 回傳連續的月份，舊的在前', () => {
    const ms = recentMonths(3);
    assert.equal(ms.length, 3);
    assert.ok(ms[0] < ms[1] && ms[1] < ms[2]);
    assert.equal(ms[2], monthOf(ymd()), '最後一個是這個月');
});

/* ── 示範資料 ──────────────────────────────────────── */

test('示範資料自己是一致的', () => {
    const m = setup(DEMO.記帳);
    Object.assign(m.data, DEMO.記帳);

    const names = new Set(m.data.accounts.map(a => a.name));
    for (const t of m.data.transactions) {
        assert.ok(names.has(t.account), `帳目指到不存在的帳戶：${t.account}`);
    }

    const cats = new Set(m.data.categories.expense.map(c => c.name));
    for (const t of m.data.transactions.filter(x => x.kind === 'expense')) {
        assert.ok(cats.has(t.category), `帳目用了沒定義的分類：${t.category}`);
    }

    const budgetCats = m.data.budgets.map(b => b.category);
    for (const c of budgetCats) {
        assert.ok(cats.has(c), `預算設在不存在的分類上：${c}`);
    }

    assert.ok(m.data.transactions.length > 100, '示範資料要夠多，趨勢圖才有東西看');

    // 總預算要比分類加起來大，不然作品集上一打開就掛著一句
    // 「分類加起來超過總預算」，看的人會以為是壞的
    const sum = m.data.budgets.reduce((s, b) => s + b.limit, 0);
    assert.ok(m.totalBudgetFor(thisMonthStr) > sum,
        `示範的總預算 ${m.totalBudgetFor(thisMonthStr)} 不該小於分類加總 ${sum}`);
});

test('示範資料涵蓋近 12 個月，趨勢圖不會有空洞', () => {
    const m = setup();
    Object.assign(m.data, DEMO.記帳);
    for (const ym of recentMonths(12)) {
        const s = m.monthSummary(ym);
        assert.ok(s.income || s.expense, `${ym} 沒有任何帳目`);
    }
});

/* ── 自動分類 ─────────────────────────────────────────
 *
 * 猜錯不會有任何地方報錯，只會安靜地把一筆帳記到錯的分類裡，
 * 然後月底的統計就是錯的。所以每一條規則都要釘住。
 */

// 她真正記過的那幾筆，拿來當歷史
const 她的帳 = [
    { note: '7-11', category: '飲食' },
    { note: '全家', category: '飲食' },
    { note: '健康餐盒', category: '飲食' },
    { note: '調理水', category: '日用' },
    { note: 'Mac訂金', category: '日用' },
    { note: '萊爾富', category: '飲食' },
];
const 她的分類 = ['飲食', '交通', '居家', '日用', '醫療', '服飾', '娛樂', '學習', '人情', '其他'];

test('她自己記過的贏過內建的表', () => {
    // 「調理水」照常識是喝的，但她記在日用——她的分法說了算
    const g = AutoCat.guess('調理水', 她的帳, 她的分類);
    assert.equal(g.category, '日用');
});

test('完全一樣的備註直接對上', () => {
    assert.equal(AutoCat.guess('全家', 她的帳, 她的分類).category, '飲食');
});

test('打得比較長也對得上（包含關係）', () => {
    assert.equal(AutoCat.guess('全家買飲料', 她的帳, 她的分類).category, '飲食');
});

test('大小寫和空白不影響', () => {
    assert.equal(AutoCat.guess(' 7-11 ', 她的帳, 她的分類).category, '飲食');
    assert.equal(AutoCat.guess('mac訂金', 她的帳, 她的分類).category, '日用');
});

test('她沒記過的用內建關鍵字', () => {
    assert.equal(AutoCat.guess('星巴克', 她的帳, 她的分類).category, '飲食');
    assert.equal(AutoCat.guess('高鐵票', 她的帳, 她的分類).category, '交通');
    assert.equal(AutoCat.guess('房租', 她的帳, 她的分類).category, '居家');
});

test('猜不到就回 null，不要硬塞一個', () => {
    assert.equal(AutoCat.guess('asdfghjkl', 她的帳, 她的分類), null);
    assert.equal(AutoCat.guess('', 她的帳, 她的分類), null);
    assert.equal(AutoCat.guess('   ', 她的帳, 她的分類), null);
});

test('不在她分類名單裡的一律不猜', () => {
    // 她把「交通」刪掉了，就不該猜出一個不存在的分類
    const 少了交通 = 她的分類.filter(c => c !== '交通');
    assert.equal(AutoCat.guess('高鐵票', [], 少了交通), null);
});

test('會講出理由——她要看得出這是猜的', () => {
    assert.match(AutoCat.guess('全家', 她的帳, 她的分類).reason, /全家/);
    assert.match(AutoCat.guess('星巴克', [], 她的分類).reason, /星巴克/);
});

test('歷史裡沒有分類的那幾筆跳過，不要拿空的來猜', () => {
    const 髒資料 = [{ note: '全家', category: '' }, { note: '全家', category: '飲食' }];
    assert.equal(AutoCat.guess('全家', 髒資料, 她的分類).category, '飲食');
});

test('新的記錄排前面就贏——同一家店改記到別的分類，之後照新的', () => {
    const 改過 = [{ note: '全家', category: '日用' }, { note: '全家', category: '飲食' }];
    assert.equal(AutoCat.guess('全家', 改過, 她的分類).category, '日用');
});

/* ── 對帳 ─────────────────────────────────────────────
 *
 * 「為什麼會有差價」沒辦法真的知道——漏記的那筆已經不在資料裡了。
 * 能做的是把範圍縮到最小：從「不知道哪裡不見了」變成
 * 「9/1 之後漏了 200」。
 */

function 對帳用的帳() {
    return {
        accounts: [{ name: '郵局', kind: 'bank', opening: 1000, includeInTotal: true }],
        transactions: [
            { id: 'a', date: '2026-08-20', kind: 'expense', amount: 100, account: '郵局', category: '飲食' },
            { id: 'b', date: '2026-09-02', kind: 'expense', amount: 300, account: '郵局', category: '飲食' },
            { id: 'c', date: '2026-09-03', kind: 'income', amount: 500, account: '郵局', category: '打工' },
        ],
        subscriptions: [], budgets: [], categories: { expense: [], income: [] },
    };
}

test('對得起來的時候差額是零', () => {
    Money.data = 對帳用的帳();
    const r = Money.reconcile('郵局', 1100);   // 1000 - 100 - 300 + 500
    assert.equal(r.computed, 1100);
    assert.equal(r.diff, 0);
});

test('實際比帳上少，差額是負的', () => {
    Money.data = 對帳用的帳();
    const r = Money.reconcile('郵局', 900);
    assert.equal(r.diff, -200);
});

test('沒對過帳的話不講「最近漏了多少」——那會是騙人的', () => {
    Money.data = 對帳用的帳();
    const r = Money.reconcile('郵局', 900);
    assert.equal(r.since, null);
    assert.equal(r.changeSince, null);
    assert.equal(r.countSince, null);
});

test('對過帳之後，範圍縮到上次對帳那天以後', () => {
    Money.data = 對帳用的帳();
    Money.data.accounts[0].checkedAt = '2026-09-01';
    const r = Money.reconcile('郵局', 900);
    // 9/1 之後：-300 +500 = +200，兩筆
    assert.equal(r.changeSince, 200);
    assert.equal(r.countSince, 2);
    assert.equal(r.since, '2026-09-01');
});

test('轉帳兩邊都算——只算一邊的話對帳永遠對不起來', () => {
    Money.data = 對帳用的帳();
    Money.data.accounts.push({ name: '現金', kind: 'cash', opening: 0, includeInTotal: true });
    Money.data.transactions.push({
        id: 'd', date: '2026-09-04', kind: 'transfer',
        amount: 200, account: '郵局', toAccount: '現金',
    });
    assert.equal(Money.balance('郵局'), 900);
    assert.equal(Money.balance('現金'), 200);
});

test('上次對帳之後的筆數含轉出和轉入', () => {
    Money.data = 對帳用的帳();
    Money.data.accounts[0].checkedAt = '2026-09-01';
    Money.data.transactions.push({
        id: 'd', date: '2026-09-04', kind: 'transfer',
        amount: 200, account: '現金', toAccount: '郵局',
    });
    assert.equal(Money.countSince('郵局', '2026-09-01'), 3);
});

/* ── 存錢罐 ───────────────────────────────────────────
 *
 * 「生活費另外記」「存錢要再轉進銀行」「銀行裡的如果有要算，另外記」
 * 講的是同一件事：錢要分成幾個桶，但總數還是要看得到。
 */

function 有存錢罐的帳() {
    return {
        accounts: [
            { name: '現金', kind: 'cash', opening: 3000, includeInTotal: true },
            { name: '存錢罐', kind: 'bank', opening: 10000, includeInTotal: true, isSavings: true },
            { name: '不算的', kind: 'other', opening: 999, includeInTotal: false },
        ],
        transactions: [],
        subscriptions: [], budgets: [], categories: { expense: [], income: [] },
    };
}

test('總資產含存錢罐', () => {
    Money.data = 有存錢罐的帳();
    assert.equal(Money.total(), 13000);
});

test('可以花的不含存錢罐', () => {
    Money.data = 有存錢罐的帳();
    assert.equal(Money.spendable(), 3000);
});

test('存起來的只算存錢罐', () => {
    Money.data = 有存錢罐的帳();
    assert.equal(Money.saved(), 10000);
});

test('不計入總額的帳戶兩邊都不算', () => {
    Money.data = 有存錢罐的帳();
    assert.equal(Money.spendable() + Money.saved(), Money.total());
});

test('存錢是轉帳，不會被當成花掉', () => {
    Money.data = 有存錢罐的帳();
    Money.data.transactions.push({
        id: 'x', date: '2026-09-05', kind: 'transfer',
        amount: 1000, account: '現金', toAccount: '存錢罐',
    });
    // 總資產不變，只是從一個桶挪到另一個
    assert.equal(Money.total(), 13000);
    assert.equal(Money.spendable(), 2000);
    assert.equal(Money.saved(), 11000);
    // 而且這個月沒有多花一毛
    assert.equal(Money.monthSummary('2026-09').expense, 0);
});

test('沒有存錢罐的時候不要多講兩個數字', () => {
    Money.data = 有存錢罐的帳();
    Money.data.accounts = Money.data.accounts.filter(a => !a.isSavings);
    assert.equal(Money.hasSavings(), false);
});

/* ── 期間 ─────────────────────────────────────────────
 *
 * 跨月、跨年、閏年那幾天最容易錯，而且錯了只會安靜地少算幾筆帳。
 */

test('這個月是從一號到月底', () => {
    const r = Range.make('month', '2026-09-15');
    assert.equal(r.start, '2026-09-01');
    assert.equal(r.end, '2026-09-30');
});

test('二月的月底認得出來，閏年也是', () => {
    assert.equal(Range.make('month', '2026-02-10').end, '2026-02-28');
    assert.equal(Range.make('month', '2028-02-10').end, '2028-02-29');
});

test('週從星期日開始——跟月曆同一套，不然兩邊圈的七天對不上', () => {
    // 2026-09-05 是星期六
    const r = Range.make('week', '2026-09-05');
    assert.equal(r.start, '2026-08-30');   // 星期日
    assert.equal(r.end, '2026-09-05');     // 星期六
});

test('星期日那天自己就是那一週的開頭', () => {
    const r = Range.make('week', '2026-08-30');
    assert.equal(r.start, '2026-08-30');
    assert.equal(r.end, '2026-09-05');
});

test('一年是從一月一號到十二月三十一號', () => {
    const r = Range.make('year', '2026-06-15');
    assert.equal(r.start, '2026-01-01');
    assert.equal(r.end, '2026-12-31');
});

test('往前翻一個月不會卡在月底', () => {
    // 3/31 往前一個月，天真的實作會給 3/3
    const r = Range.shift(Range.make('month', '2026-03-31'), -1);
    assert.equal(r.start, '2026-02-01');
    assert.equal(r.end, '2026-02-28');
});

test('往前翻一週就是往前七天', () => {
    const r = Range.shift(Range.make('week', '2026-09-05'), -1);
    assert.equal(r.start, '2026-08-23');
    assert.equal(r.end, '2026-08-29');
});

test('跨年翻得過去', () => {
    const r = Range.shift(Range.make('month', '2026-01-10'), -1);
    assert.equal(r.start, '2025-12-01');
    assert.equal(Range.label(r), '2025 年 12 月');
});

test('自訂區間不給翻——翻到哪都不會是她要的', () => {
    const r = { kind: 'custom', start: '2026-01-01', end: '2026-03-15' };
    assert.deepEqual(Range.shift(r, 1), r);
});

test('標題看得出是哪一段', () => {
    assert.equal(Range.label(Range.make('month', '2026-09-05')), '2026 年 9 月');
    assert.equal(Range.label(Range.make('year', '2026-09-05')), '2026 年');
    assert.equal(Range.label(Range.make('week', '2026-09-05')), '8/30–9/5');
});

test('跨年的自訂區間標題要帶年份，不然看不出來', () => {
    const r = { kind: 'custom', start: '2025-12-20', end: '2026-01-10' };
    assert.equal(Range.label(r), '2025/12/20–2026/1/10');
});

test('包不包含今天判斷得出來——不給看未來要靠它', () => {
    assert.equal(Range.hasToday(Range.make('month')), true);
    assert.equal(Range.hasToday({ kind: 'custom', start: '2020-01-01', end: '2020-12-31' }), false);
});

test('日期在不在區間裡，邊界那兩天算在裡面', () => {
    const r = { kind: 'custom', start: '2026-09-01', end: '2026-09-30' };
    assert.equal(Range.contains(r, '2026-09-01'), true);
    assert.equal(Range.contains(r, '2026-09-30'), true);
    assert.equal(Range.contains(r, '2026-08-31'), false);
    assert.equal(Range.contains(r, '2026-10-01'), false);
    assert.equal(Range.contains(r, null), false);
});

/* ── 從別的記帳 App 匯進來 ────────────────────────────
 *
 * 匯錯的資料很糟：兩百筆混進來之後要一筆一筆挑出來刪，比重打還累。
 * 所以每一種格式都要釘住，解不開的要講出來而不是安靜跳過。
 */

test('引號裡的逗號不會被當成分隔', () => {
    const { headers, rows } = Csv.parse('日期,金額,備註\n2026-09-05,120,"全家,買飲料"');
    assert.deepEqual(headers, ['日期', '金額', '備註']);
    assert.equal(rows[0]['備註'], '全家,買飲料');
});

test('兩個引號是一個引號', () => {
    const { rows } = Csv.parse('備註\n"他說""好"""');
    assert.equal(rows[0]['備註'], '他說"好"');
});

test('BOM 不會黏在第一個欄位名上', () => {
    // 有 BOM 的話「日期」會變成「﻿日期」，之後所有比對都對不上
    const { headers } = Csv.parse('﻿日期,金額\n2026-09-05,120');
    assert.deepEqual(headers, ['日期', '金額']);
});

test('結尾的空行不會變成一筆帳', () => {
    const { rows } = Csv.parse('日期,金額\n2026-09-05,120\n\n');
    assert.equal(rows.length, 1);
});

test('欄位猜得出來', () => {
    const m = Csv.guessMapping(['日期', '金額', '分類', '備註', '帳戶']);
    assert.equal(m.date, '日期');
    assert.equal(m.amount, '金額');
    assert.equal(m.category, '分類');
    assert.equal(m.note, '備註');
    assert.equal(m.account, '帳戶');
});

test('完整相同優先——「支出金額」不該被猜成金額欄', () => {
    const m = Csv.guessMapping(['日期', '收入金額', '支出金額']);
    assert.equal(m.income, '收入金額');
    assert.equal(m.expense, '支出金額');
});

test('英文欄位名也認得', () => {
    const m = Csv.guessMapping(['Date', 'Amount', 'Category', 'Note']);
    assert.equal(m.date, 'Date');
    assert.equal(m.amount, 'Amount');
});

test('一個欄位不會被猜成兩種用途', () => {
    const m = Csv.guessMapping(['日期', '金額']);
    const used = Object.values(m);
    assert.equal(used.length, new Set(used).size);
});

test('三種日期寫法都認得', () => {
    assert.equal(Csv.parseDate('2026/9/5'), '2026-09-05');
    assert.equal(Csv.parseDate('2026-09-05'), '2026-09-05');
    assert.equal(Csv.parseDate('2026.9.5'), '2026-09-05');
    assert.equal(Csv.parseDate('2026年9月5日'), '2026-09-05');
});

test('猜不出月日順序的日期一律不收——猜錯的話整批都錯', () => {
    assert.equal(Csv.parseDate('09/05/2026'), null);
    assert.equal(Csv.parseDate(''), null);
    assert.equal(Csv.parseDate('昨天'), null);
});

test('金額的千分位、貨幣符號、負號都認得', () => {
    assert.equal(Csv.parseAmount('1,234'), 1234);
    assert.equal(Csv.parseAmount('$1234'), 1234);
    assert.equal(Csv.parseAmount('NT1,234'), 1234);
    assert.equal(Csv.parseAmount('-120'), -120);
    assert.equal(Csv.parseAmount('120.5'), 120.5);
    assert.equal(Csv.parseAmount('abc'), null);
});

test('收入和支出分成兩欄的格式', () => {
    const { rows } = Csv.parse('日期,收入,支出,備註\n2026-09-05,,120,全家\n2026-09-06,5000,,打工');
    const map = Csv.guessMapping(['日期', '收入', '支出', '備註']);
    const out = Csv.toTransactions(rows, map);
    assert.equal(out.rows.length, 2);
    assert.equal(out.rows[0].kind, 'expense');
    assert.equal(out.rows[0].amount, 120);
    assert.equal(out.rows[1].kind, 'income');
    assert.equal(out.rows[1].amount, 5000);
});

test('單欄金額加類型欄的格式', () => {
    const { rows } = Csv.parse('日期,類型,金額\n2026-09-05,支出,120\n2026-09-06,收入,5000');
    const map = Csv.guessMapping(['日期', '類型', '金額']);
    const out = Csv.toTransactions(rows, map);
    assert.equal(out.rows[0].kind, 'expense');
    assert.equal(out.rows[1].kind, 'income');
});

test('解不開的那幾列要講出來，不能安靜跳過', () => {
    const { rows } = Csv.parse('日期,金額\n2026-09-05,120\n昨天,50\n2026-09-07,abc');
    const map = Csv.guessMapping(['日期', '金額']);
    const out = Csv.toTransactions(rows, map);
    assert.equal(out.rows.length, 1);
    assert.equal(out.problems.length, 2);
    assert.equal(out.problems[0].line, 3);      // 行號要跟試算表對得起來
    assert.match(out.problems[0].why, /日期/);
    assert.match(out.problems[1].why, /金額/);
});

test('帳戶對不上現有的就用預設，不要憑空建一堆帳戶', () => {
    const { rows } = Csv.parse('日期,金額,帳戶\n2026-09-05,120,悠遊卡儲值');
    const map = Csv.guessMapping(['日期', '金額', '帳戶']);
    const out = Csv.toTransactions(rows, map,
        { accounts: ['現金', '郵局'], defaultAccount: '現金' });
    assert.equal(out.rows[0].account, '現金');
});

test('帳戶名對得上就用那個', () => {
    const { rows } = Csv.parse('日期,金額,帳戶\n2026-09-05,120,郵局');
    const map = Csv.guessMapping(['日期', '金額', '帳戶']);
    const out = Csv.toTransactions(rows, map,
        { accounts: ['現金', '郵局'], defaultAccount: '現金' });
    assert.equal(out.rows[0].account, '郵局');
});

test('已經有的不要再匯一次', () => {
    const existing = [{ date: '2026-09-05', kind: 'expense', amount: 120, note: '全家' }];
    const incoming = [
        { date: '2026-09-05', kind: 'expense', amount: 120, note: '全家' },
        { date: '2026-09-06', kind: 'expense', amount: 90, note: '7-11' },
    ];
    const { fresh, dup } = Csv.dedupe(incoming, existing);
    assert.equal(fresh.length, 1);
    assert.equal(dup.length, 1);
    assert.equal(fresh[0].note, '7-11');
});

test('同一批裡面自己重複的也只留一筆', () => {
    const incoming = [
        { date: '2026-09-05', kind: 'expense', amount: 120, note: '全家' },
        { date: '2026-09-05', kind: 'expense', amount: 120, note: '全家' },
    ];
    const { fresh, dup } = Csv.dedupe(incoming, []);
    assert.equal(fresh.length, 1);
    assert.equal(dup.length, 1);
});

test('同一天同金額但備註不同的是兩筆，不能當成重複', () => {
    const incoming = [
        { date: '2026-09-05', kind: 'expense', amount: 50, note: '早餐' },
        { date: '2026-09-05', kind: 'expense', amount: 50, note: '飲料' },
    ];
    assert.equal(Csv.dedupe(incoming, []).fresh.length, 2);
});

/* ── 每個月自己的預算 ────────────────────────────────
 *
 * 平常一份，某個月可以另外設。查錯了不會報錯，只會安靜地
 * 拿平常的數字去比九月的花費，然後告訴她「還沒超支」。
 */

test('沒有另外設的月份，用平常那份', () => {
    const m = setup({ budgets: [{ category: '餐飲', limit: 3000 }] });
    const out = m.budgetsFor('2026-09');
    assert.equal(out.length, 1);
    assert.equal(out[0].limit, 3000);
});

test('那個月另外設過就用那個月的', () => {
    const m = setup({ budgets: [
        { category: '餐飲', limit: 3000 },
        { category: '餐飲', limit: 5000, month: '2026-09' },
    ] });
    assert.equal(m.budgetsFor('2026-09')[0].limit, 5000);
    assert.equal(m.budgetsFor('2026-10')[0].limit, 3000);
});

test('那個月沒提到的分類，還是照平常的走', () => {
    const m = setup({ budgets: [
        { category: '餐飲', limit: 3000 },
        { category: '房租', limit: 6000 },
        { category: '餐飲', limit: 5000, month: '2026-09' },
    ] });
    const out = new Map(m.budgetsFor('2026-09').map(b => [b.category, b.limit]));
    assert.equal(out.get('餐飲'), 5000);
    assert.equal(out.get('房租'), 6000);
});

test('別的月份設的不會漏到這個月', () => {
    const m = setup({ budgets: [{ category: '餐飲', limit: 5000, month: '2026-09' }] });
    assert.equal(m.budgetsFor('2026-10').length, 0);
});

test('查得出這個月有沒有自己的一套', () => {
    const m = setup({ budgets: [
        { category: '餐飲', limit: 3000 },
        { category: '餐飲', limit: 5000, month: '2026-09' },
    ] });
    assert.ok(m.hasOwnBudget('2026-09'));
    assert.ok(!m.hasOwnBudget('2026-10'));
});

/* ── 總預算與「一天可以用多少」──────────────────────
 *
 * 這幾條算錯了最危險：它會給一個看起來很合理的數字，
 * 照著花到月底才發現早就爆了。
 */

test('沒設總預算就是 null，不是 0', () => {
    const m = setup({ totalBudgets: [] });
    assert.equal(m.totalBudgetFor(thisMonthStr), null);
    assert.equal(m.budgetPace(thisMonthStr), null);
});

test('總預算也是平常一份、某個月可以另外設', () => {
    const m = setup({ totalBudgets: [
        { limit: 15000 },
        { limit: 22000, month: '2026-09' },
    ] });
    assert.equal(m.totalBudgetFor('2026-09'), 22000);
    assert.equal(m.totalBudgetFor('2026-10'), 15000);
    assert.ok(m.hasOwnTotalBudget('2026-09'));
    assert.ok(!m.hasOwnTotalBudget('2026-10'));
});

test('一開始的每日額度是總預算除以整個月的天數', () => {
    const m = setup({ totalBudgets: [{ limit: 15000 }] });
    const p = m.budgetPace(thisMonthStr);
    const days = new Date(Number(thisMonthStr.slice(0, 4)),
                          Number(thisMonthStr.slice(5, 7)), 0).getDate();
    assert.equal(p.days, days);
    assert.equal(p.perDay, 15000 / days);
});

test('今天可以用＝扣掉今天以前花的，再除以含今天的剩餘天數', () => {
    const m = setup({
        totalBudgets: [{ limit: 15000 }],
        // 這一筆是「今天以前」的（1 號；如果今天就是 1 號，下面那條測試
        // 會涵蓋到，這裡只驗天數和分母）
        transactions: [{ id: 't1', date: day(1), kind: 'expense', amount: 3000, category: '餐飲', account: '現金' }],
    });
    const p = m.budgetPace(thisMonthStr);
    const today = new Date().getDate();
    assert.equal(p.used, 3000);
    assert.equal(p.left, 12000);
    // **今天要算進剩餘天數**：剩下的錢本來就得撐過今天
    assert.equal(p.daysLeft, p.days - today + 1);
    assert.equal(p.perDayLeft, (15000 - (3000 - p.spentToday)) / p.daysLeft);
});

test('今天的額度不含今天已經花的，花掉的從額度裡扣', () => {
    // 本來是拿「剩下的錢 ÷ 剩下的天數」，而剩下的錢已經扣掉今天花的了——
    // 結果今天花 2,000，那個數字只掉一點點（被攤平到剩下的每一天），
    // 「今天的預算」對今天等於沒有回饋。
    const base = setup({ totalBudgets: [{ limit: 15000 }] }).budgetPace(thisMonthStr);
    const m = setup({
        totalBudgets: [{ limit: 15000 }],
        transactions: [{ id: 't1', date: ymd(), kind: 'expense', amount: 2000, category: '餐飲', account: '現金' }],
    });
    const after = m.budgetPace(thisMonthStr);

    assert.equal(after.spentToday, 2000);
    assert.equal(after.perDayLeft, base.perDayLeft, '今天的額度是今天一開始就定好的');
    assert.equal(after.todayLeft, base.perDayLeft - 2000, '花掉的要從今天的額度裡扣');
    assert.equal(after.daysLeft, base.daysLeft, '同一天，剩餘天數不該變');
});

test('今天花超過額度，剩下的是負的（要看得見）', () => {
    const m = setup({
        totalBudgets: [{ limit: 3000 }],   // 一天一百出頭
        transactions: [{ id: 't1', date: ymd(), kind: 'expense', amount: 900, category: '餐飲', account: '現金' }],
    });
    const p = m.budgetPace(thisMonthStr);
    assert.ok(p.todayLeft < 0, '今天花超了要看得見，那是這個數字唯一有用的時刻');
    assert.equal(p.todayLeft, p.perDayLeft - 900);
});

/* ── 分類也有今天的額度 ────────────────────────────────
 *
 * 她的原話：「沒有分類，比如今天的預算，吃的、交通這種」。
 */

test('分類的今天額度跟總預算同一套算法', () => {
    const m = setup({
        budgets: [{ category: '餐飲', limit: 3000 }],
        transactions: [
            { id: 't1', date: day(1), kind: 'expense', amount: 300, category: '餐飲', account: '現金' },
            { id: 't2', date: ymd(), kind: 'expense', amount: 120, category: '餐飲', account: '現金' },
            // 別的分類不該混進來
            { id: 't3', date: ymd(), kind: 'expense', amount: 999, category: '房租', account: '郵局' },
        ],
    });
    const p = m.categoryPace(thisMonthStr, '餐飲', 3000);
    const sameDay = day(1) === ymd();
    assert.equal(p.used, sameDay ? 420 : 420, '這個月餐飲總共花的');
    assert.equal(p.spentToday, sameDay ? 420 : 120, '今天餐飲花的（別類不算）');
    assert.equal(p.todayLeft, p.perDayLeft - p.spentToday);
});

test('某一天某一類花多少，只算那一天那一類', () => {
    const m = setup({ transactions: [
        { id: 't1', date: ymd(), kind: 'expense', amount: 120, category: '餐飲', account: '現金' },
        { id: 't2', date: ymd(), kind: 'expense', amount: 80, category: '餐飲', account: '現金' },
        { id: 't3', date: ymd(), kind: 'expense', amount: 999, category: '房租', account: '郵局' },
        { id: 't4', date: '2025-01-10', kind: 'expense', amount: 500, category: '餐飲', account: '現金' },
        // 轉帳不是支出
        { id: 't5', date: ymd(), kind: 'transfer', amount: 5000, account: '郵局', toAccount: '現金' },
    ] });
    assert.equal(m.dayCategoryExpense('餐飲'), 200);
    assert.equal(m.dayCategoryExpense('房租'), 999);
    assert.equal(m.dayCategoryExpense('沒這一類'), 0);
});

test('沒有分類的帳目算在「未分類」，不是被丟掉', () => {
    const m = setup({ transactions: [
        { id: 't1', date: ymd(), kind: 'expense', amount: 60, category: '', account: '現金' },
    ] });
    assert.equal(m.dayCategoryExpense('未分類'), 60);
});

test('超支的時候每日額度是 0，不會變成負的', () => {
    const m = setup({
        totalBudgets: [{ limit: 5000 }],
        transactions: [{ id: 't1', date: day(1), kind: 'expense', amount: 8000, category: '餐飲', account: '現金' }],
    });
    const p = m.budgetPace(thisMonthStr);
    assert.ok(p.over);
    assert.equal(p.left, -3000, '超出多少要看得到');
    assert.equal(p.perDayLeft, 0, '不能給一個負的「每天可以用」');
});

test('轉帳不算進總預算——換個口袋不是花掉', () => {
    const m = setup({
        totalBudgets: [{ limit: 15000 }],
        transactions: [
            { id: 't1', date: day(2), kind: 'transfer', amount: 6000, account: '郵局', toAccount: '現金' },
        ],
    });
    assert.equal(m.budgetPace(thisMonthStr).used, 0);
});

test('過去的月份沒有「還能用多少」，只有平均花了多少', () => {
    const m = setup({
        totalBudgets: [{ limit: 3100 }],
        transactions: [{ id: 't1', date: '2025-01-10', kind: 'expense', amount: 1550, category: '餐飲', account: '現金' }],
    });
    const p = m.budgetPace('2025-01');
    assert.equal(p.days, 31);
    assert.equal(p.daysLeft, 0);
    assert.equal(p.perDayLeft, null, '過去的月份不該給「今天起每天可以用」');
    assert.equal(p.spentPerDay, 50);
});

test('二月的天數要對，額度才不會算錯', () => {
    const m = setup({ totalBudgets: [{ limit: 2900 }] });
    assert.equal(m.budgetPace('2024-02').days, 29, '閏年');
    assert.equal(m.budgetPace('2025-02').days, 28);
});

/* ── 今天的收支 ────────────────────────────────────── */

test('今天的收支只算今天，轉帳兩邊都不算', () => {
    const m = setup({ transactions: [
        { id: 't1', date: ymd(), kind: 'expense', amount: 155, category: '交通', account: '現金' },
        { id: 't2', date: ymd(), kind: 'income', amount: 500, category: '打工', account: '郵局' },
        { id: 't3', date: ymd(), kind: 'transfer', amount: 9000, account: '郵局', toAccount: '現金' },
        // 別的日子。**寫死一個很久以前的日期**，不能用 day(1)——
        // 每個月的 1 號跑這支測試的時候，那就是今天。
        { id: 't4', date: '2025-01-10', kind: 'expense', amount: 999, category: '餐飲', account: '現金' },
    ] });
    const f = m.dayFlow();
    assert.equal(f.expense, 155);
    assert.equal(f.income, 500);
    assert.equal(f.net, 345);
    assert.equal(m.onDay().length, 3, '轉帳不算收支，但明細上還是要看得到');
});

test('今天沒記帳就是空的，不是 0 筆假資料', () => {
    const m = setup({ transactions: [
        { id: 't1', date: '2025-01-10', kind: 'expense', amount: 100, category: '餐飲', account: '現金' },
    ] });
    assert.equal(m.onDay().length, 0);
    assert.equal(m.dayFlow().expense, 0);
});

/* ── 報表：帳戶篩選 ─────────────────────────────────
 *
 * 篩錯了不會報錯，只會給一個看起來很合理的小數字。
 */

test('不篩帳戶就是全部', () => {
    const m = setup({ transactions: [
        { id: '1', date: day(3), kind: 'expense', amount: 100, category: '餐飲', account: '郵局' },
        { id: '2', date: day(4), kind: 'expense', amount: 50, category: '餐飲', account: '現金' },
    ] });
    assert.equal(m.summaryIn(Range.make('month'), '').expense, 150);
});

test('篩了帳戶只算那個帳戶', () => {
    const m = setup({ transactions: [
        { id: '1', date: day(3), kind: 'expense', amount: 100, category: '餐飲', account: '郵局' },
        { id: '2', date: day(4), kind: 'expense', amount: 50, category: '餐飲', account: '現金' },
    ] });
    assert.equal(m.summaryIn(Range.make('month'), '郵局').expense, 100);
    assert.equal(m.summaryIn(Range.make('month'), '現金').expense, 50);
});

test('分類統計也吃帳戶篩選', () => {
    const m = setup({ transactions: [
        { id: '1', date: day(3), kind: 'expense', amount: 100, category: '餐飲', account: '郵局' },
        { id: '2', date: day(4), kind: 'expense', amount: 80, category: '房租', account: '現金' },
    ] });
    const rows = m.byCategoryIn(Range.make('month'), '郵局');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].category, '餐飲');
});

test('每月收支也吃帳戶篩選', () => {
    const m = setup({ transactions: [
        { id: '1', date: day(3), kind: 'expense', amount: 100, category: '餐飲', account: '郵局' },
        { id: '2', date: day(4), kind: 'expense', amount: 80, category: '餐飲', account: '現金' },
    ] });
    assert.equal(m.monthSummary(thisMonthStr, '現金').expense, 80);
});

test('轉帳不算收入也不算支出，篩了帳戶還是一樣', () => {
    const m = setup({ transactions: [
        { id: '1', date: day(3), kind: 'transfer', amount: 500, account: '郵局', toAccount: '現金' },
    ] });
    const s = m.summaryIn(Range.make('month'), '郵局');
    assert.equal(s.income, 0);
    assert.equal(s.expense, 0);
});

/* ── 圖表的幾何 ─────────────────────────────────────
 *
 * 角度算錯、點位算錯，畫出來只是「有點怪」，不會有任何錯誤訊息。
 */

test('圓餅每一塊照比例，而且首尾接得起來', () => {
    const p = Charts.slices([50, 30, 20]);
    assert.equal(p.length, 3);
    assert.equal(p[0].fraction, 0.5);
    assert.equal(p[0].start, 0);
    assert.ok(Math.abs(p[2].end - 1) < 1e-9);
});

test('全部是零的時候圓餅不畫，也不會除以零', () => {
    assert.deepEqual(Charts.slices([0, 0]), []);
    assert.deepEqual(Charts.slices([]), []);
});

test('負數當成零，不能把別塊撐大', () => {
    const p = Charts.slices([-100, 50, 50]);
    assert.equal(p[0].fraction, 0);
    assert.equal(p[1].fraction, 0.5);
});

test('折線的底從零起算，不是從最小值', () => {
    // 30000 和 31000 差 3%，畫出來也該只差一點點，
    // 不能因為「最小值當底」被拉成谷底到山頂
    const pts = Charts.points([30000, 31000], 100, 100, 0);
    assert.ok(Math.abs(pts[0].y - pts[1].y) < 5,
              `兩點差 ${Math.abs(pts[0].y - pts[1].y)}，太誇張了`);
});

test('折線最高的那點貼著上緣，最低的貼著下緣', () => {
    const pts = Charts.points([0, 100], 100, 100, 0);
    assert.equal(pts[1].y, 0);
    assert.equal(pts[0].y, 100);
});

test('只有一個點的時候擺中間，不會除以零', () => {
    for (const mode of ['center', 'edge']) {
        const pts = Charts.points([500], 100, 100, 0, 0, mode);
        assert.equal(pts.length, 1, mode);
        assert.equal(pts[0].x, 50, mode);
        assert.ok(Number.isFinite(pts[0].y), mode);
    }
});

test('點站在自己那一格的中間，才對得上底下等寬的月份', () => {
    // 四格、寬 100 → 格寬 25，中心在 12.5 / 37.5 / 62.5 / 87.5
    const pts = Charts.points([1, 1, 1, 1], 100, 100, 0);
    assert.deepEqual(pts.map(p => p.x), [12.5, 37.5, 62.5, 87.5]);
});

test('edge 模式頭尾貼著兩端', () => {
    const pts = Charts.points([1, 1, 1], 100, 100, 0, 0, 'edge');
    assert.deepEqual(pts.map(p => p.x), [0, 50, 100]);
});

test('幾條線共用同一個尺標，才不會三萬和三千一樣高', () => {
    const a = Charts.points([30000], 100, 100, 0, 30000);
    const b = Charts.points([3000], 100, 100, 0, 30000);
    assert.equal(a[0].y, 0);
    assert.ok(b[0].y > 80, `y=${b[0].y} 應該很矮`);
});

test('沒有點就給空字串，不是畫不出來的 M', () => {
    assert.equal(Charts.linePath([]), '');
});

test('點串得成 SVG 的 d', () => {
    const d = Charts.linePath([{ x: 0, y: 10 }, { x: 5, y: 0 }]);
    assert.equal(d, 'M0.0 10.0 L5.0 0.0');
});

/* ── 天氣 ──────────────────────────────────────────────
 *
 * 只測純的那幾支：代碼對照、回傳整形、快取鍵。
 * 抓網路和定位權限測不了，但「API 少給一個欄位的時候會不會畫出半張卡片」
 * 測得到——而那正是最容易出事、又最不會有人報錯的地方。
 */

const { Weather } = load('./js/weather.js');

test('天氣代碼分成七類，看得懂的都對得上', () => {
    assert.equal(Weather.describe(0).text, '晴');
    assert.equal(Weather.describe(1).text, '多雲');
    assert.equal(Weather.describe(2).text, '多雲');
    assert.equal(Weather.describe(3).text, '陰');
    assert.equal(Weather.describe(45).text, '有霧');
    assert.equal(Weather.describe(63).text, '下雨');
    assert.equal(Weather.describe(71).text, '下雪');
    assert.equal(Weather.describe(81).text, '陣雨');
    assert.equal(Weather.describe(95).text, '雷雨');
});

test('認不得的代碼當多雲，不要讓畫面開天窗', () => {
    assert.equal(Weather.describe(999).ico, 'cloud');
    assert.equal(Weather.describe(null).ico, 'cloud');
    assert.equal(Weather.describe('晴天').ico, 'cloud');
    assert.equal(Weather.describe(undefined).text, '—');
});

test('每一類都指到真的存在的圖示名字', () => {
    const names = ['sun', 'cloudsun', 'cloud', 'fog', 'rain', 'snow', 'storm'];
    for (const c of Weather.CODES) {
        assert.ok(names.includes(c.ico), `${c.ico} 不在圖示清單裡`);
    }
});

const FULL = {
    current: { temperature_2m: 28.4, apparent_temperature: 31.2, weather_code: 3 },
    daily: {
        temperature_2m_max: [31.8],
        temperature_2m_min: [24.1],
        precipitation_probability_max: [70],
    },
};

test('完整的回應整形成畫得出來的形狀，溫度四捨五入', () => {
    assert.deepEqual(Weather.shape(FULL), {
        now: 28, feels: 31, code: 3, high: 32, low: 24, rain: 70,
    });
});

test('沒有 current 或 daily 就回 null，不畫半張卡片', () => {
    assert.equal(Weather.shape({ daily: FULL.daily }), null);
    assert.equal(Weather.shape({ current: FULL.current }), null);
    assert.equal(Weather.shape({}), null);
    assert.equal(Weather.shape(null), null);
});

test('連現在的溫度都沒有就整份不要', () => {
    assert.equal(Weather.shape({ current: { weather_code: 0 }, daily: FULL.daily }), null);
});

test('缺的欄位給 null，不要變成 NaN 印在畫面上', () => {
    const s = Weather.shape({
        current: { temperature_2m: 20 },
        daily: {},
    });
    assert.equal(s.now, 20);
    assert.equal(s.feels, null);
    assert.equal(s.high, null);
    assert.equal(s.low, null);
    assert.equal(s.rain, null);
});

test('降雨機率 0% 是資料不是缺值', () => {
    const s = Weather.shape({
        current: { temperature_2m: 20 },
        daily: { precipitation_probability_max: [0] },
    });
    assert.equal(s.rain, 0);
});

test('快取鍵綁地點，換了地方就不是同一份', () => {
    const a = Weather.keyOf({ lat: 25.053, lon: 121.526 });
    const b = Weather.keyOf({ lat: 51.509, lon: -0.126 });
    assert.notEqual(a, b);
    // 小數點後第四位以後不算——那個精度的差別對天氣沒有意義，
    // 只會讓快取每次都失效
    assert.equal(Weather.keyOf({ lat: 25.0531, lon: 121.5262 }), a);
});

test('網址帶得齊要用的欄位', () => {
    const u = Weather.url({ lat: 25.053, lon: 121.526 });
    assert.ok(u.startsWith('https://api.open-meteo.com/'), u);
    for (const k of ['latitude=25.053', 'longitude=121.526', 'temperature_2m',
                     'weather_code', 'precipitation_probability_max', 'forecast_days=1']) {
        assert.ok(u.includes(k), `網址少了 ${k}`);
    }
});

/* ── 從時區猜地點 ──────────────────────────────────
 *
 * 程式裡不再寫死一個地點（那會讓打開的人看到別人所在地的天氣，
 * 而且那個座標會跟著程式一起公開）。改成照瀏覽器的時區猜。
 *
 * 猜錯不會報錯，只會給一個地名寫對、天氣是別人的卡片。
 */

test('程式裡沒有寫死任何座標', () => {
    assert.equal(Weather.DEFAULT, undefined,
        '寫死的預設地點＝公開的位置，也＝別人打開時看到的是你的天氣');
});

test('時區的最後一段就是城市名', () => {
    assert.equal(Weather.cityOfZone('Asia/Taipei'), 'Taipei');
    assert.equal(Weather.cityOfZone('Europe/London'), 'London');
    assert.equal(Weather.cityOfZone('America/New_York'), 'New York', '底線要換成空白');
    assert.equal(Weather.cityOfZone('America/Argentina/Buenos_Aires'), 'Buenos Aires',
        '三段的時區要取最後一段');
});

test('沒有城市名的時區就不猜', () => {
    // 猜不到會整張卡片不畫。**寧可沒有，也不要給一個別人的天氣。**
    assert.equal(Weather.cityOfZone('UTC'), '');
    assert.equal(Weather.cityOfZone('Etc/GMT+8'), '');
    assert.equal(Weather.cityOfZone(''), '');
    assert.equal(Weather.cityOfZone(undefined), '');
});

test('查回來的要拿時區對過才算數', () => {
    // 真的發生過：查「New York」，第一筆是內布拉斯加州的 York
    // （人口 7,864、America/Chicago）。直接用第一筆的話，紐約的人
    // 會看到一個差了一千五百公里的天氣。
    const results = [
        { name: 'York', timezone: 'America/Chicago', latitude: 40.868, longitude: -97.592 },
        { name: 'New York', timezone: 'Europe/London', latitude: 53.079, longitude: -0.14 },
        { name: 'New York', timezone: 'America/New_York', latitude: 40.7143, longitude: -74.006 },
    ];
    const p = Weather.pickByZone(results, 'America/New_York');
    assert.equal(p.name, 'New York');
    assert.equal(p.lat, 40.714, '座標要留三位小數就好');
    assert.equal(p.lon, -74.006);
});

test('一筆都對不上時區就回 null，不要硬挑一個', () => {
    const results = [
        { name: 'York', timezone: 'America/Chicago', latitude: 40.868, longitude: -97.592 },
    ];
    assert.equal(Weather.pickByZone(results, 'America/New_York'), null);
    assert.equal(Weather.pickByZone([], 'Asia/Taipei'), null);
    assert.equal(Weather.pickByZone(undefined, 'Asia/Taipei'), null);
});

test('缺經緯度的那幾筆跳過，不要拿 undefined 去查天氣', () => {
    const results = [
        { name: '怪的', timezone: 'Asia/Taipei' },
        { name: '台北市', timezone: 'Asia/Taipei', latitude: 25.053, longitude: 121.526 },
    ];
    assert.equal(Weather.pickByZone(results, 'Asia/Taipei').name, '台北市');
});

test('手打指定的地點贏過猜的，定位抓到的又贏過手打的', () => {
    // 三層：這台裝置抓到的 > 她指定的 > 猜的。
    // 中間那層是後來加的——手機開的是 http，瀏覽器不給定位，
    // 第一層永遠拿不到，沒有中間層的話手機上只能一直看猜出來的城市。
    const order = ['savedPlace', 'pickedPlace', 'guessPlace'];
    for (const m of order) {
        assert.equal(typeof Weather[m], 'function', `少了 ${m}`);
    }
});

test('http 上不給定位——要提前擋，不要讓她按了沒反應', () => {
    // 瀏覽器在非安全上下文回的錯是「使用者拒絕」，但她根本沒看到
    // 權限視窗，卻被告知是自己拒絕的。
    // Node 自己的 globalThis.navigator 只有 getter，直接指定會 TypeError，
    // 所以用 defineProperty 蓋掉，測完還原。
    const savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const savedNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const fake = (win, nav) => {
        Object.defineProperty(globalThis, 'window', { value: win, configurable: true });
        Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true });
    };
    try {
        fake({ isSecureContext: false }, { geolocation: {} });
        assert.equal(Weather.canLocate(), false, 'http 上不能用');

        fake({ isSecureContext: true }, { geolocation: {} });
        assert.equal(Weather.canLocate(), true);

        fake({ isSecureContext: true }, {});
        assert.equal(Weather.canLocate(), false, '瀏覽器沒有定位功能也算不能用');
    } finally {
        savedWindow ? Object.defineProperty(globalThis, 'window', savedWindow)
                    : delete globalThis.window;
        savedNav ? Object.defineProperty(globalThis, 'navigator', savedNav)
                 : delete globalThis.navigator;
    }
});

test('直接打經緯度就當座標用', () => {
    // 地名庫對台灣的鄉鎮不完整，查不到的地方只剩這條路
    assert.deepEqual(Weather.parseCoords('22.645, 120.605'),
        { lat: 22.645, lon: 120.605, name: '自訂位置', where: '直接用你打的座標' });
    assert.equal(Weather.parseCoords('22.645 120.605').lat, 22.645, '空白隔開也要認');
    assert.equal(Weather.parseCoords('22.645，120.605').lon, 120.605, '全形逗號也要認');
    assert.equal(Weather.parseCoords('-33.868, 151.207').lat, -33.868, '南半球是負的');
});

test('不是座標的就當地名去查', () => {
    assert.equal(Weather.parseCoords('台北'), null);
    assert.equal(Weather.parseCoords('New York'), null, '兩個字的地名不是座標');
    assert.equal(Weather.parseCoords('999, 999'), null, '超出範圍的不是座標');
    assert.equal(Weather.parseCoords('22.645'), null, '只有一個數字不夠');
    assert.equal(Weather.parseCoords(''), null);
});

test('天氣的查詢跟著座標的時區走，不寫死台北', () => {
    // 高低溫和降雨機率是「今天」的統計，而「今天」在倫敦和台北
    // 是不同的二十四小時。寫死的話別人拿到的是切在半夜的那一天。
    const u = Weather.url({ lat: 51.5, lon: -0.1, name: 'London' });
    assert.ok(u.includes('timezone=auto'), u);
    assert.ok(!u.includes('Taipei'), u);
});


/* ── 總覽卡片的順序 ────────────────────────────────────
 *
 * 排錯了不會報錯，只會讓她排好的順序某天自己跑掉，
 * 或是新加的一張卡永遠不出現。
 */

test('沒設過就照預設的順序', () => {
    assert.deepEqual(Overview.orderedIds([]), Overview.CARDS.map(c => c.id));
    assert.deepEqual(Overview.orderedIds(null), Overview.CARDS.map(c => c.id));
});

test('設過就照她排的', () => {
    // **不要把卡片清單寫死在測試裡。** 寫死的話每加一張新卡就要
    // 回來改一次測試，而那正是這支測試該幫忙的事。
    const mine = [...Overview.CARDS.map(c => c.id)].reverse();
    assert.deepEqual(Overview.orderedIds(mine), mine);
});

test('新加的卡片接在後面，不會消失', () => {
    // 她排順序的時候還沒有那張卡——存起來的清單裡沒有它。
    // 接不上去的話，加了新卡片，用過排序的人就永遠看不到。
    const all = Overview.CARDS.map(c => c.id);
    const missing = all[all.length - 1];
    const old = all.slice(0, -1);
    const out = Overview.orderedIds(old);
    assert.ok(out.includes(missing), '新的卡片不見了');
    assert.deepEqual(out.slice(0, old.length), old, '她排的順序要原封不動');
    assert.equal(out[out.length - 1], missing, '新的接在後面');
});

test('已經拿掉的卡片不會留在順序裡', () => {
    const out = Overview.orderedIds(['memo', '早就砍掉的卡', 'weather']);
    assert.ok(!out.includes('早就砍掉的卡'));
    assert.deepEqual(out.slice(0, 2), ['memo', 'weather']);
});

test('每張卡都有 id 和名字，而且 id 不重複', () => {
    // 名字是排順序時唯一看得到的東西——沒有名字就只剩兩顆箭頭
    const ids = Overview.CARDS.map(c => c.id);
    assert.equal(new Set(ids).size, ids.length, 'id 撞名的話順序會存錯');
    for (const c of Overview.CARDS) {
        assert.ok(c.id && c.name, JSON.stringify(c));
    }
});


/* ── 哪幾張卡放在總覽上 ────────────────────────────────
 *
 * 她說「可以快速決定哪些卡片要放總覽，位置，把所有可能會在意的卡片
 * 都做出來，讓用戶決定要不要放」。
 */

/* Overview 讀的是 prefs.js 裡的全域 Prefs，而這裡只載了 overview.js。
 * 給一個假的就好——要驗的是「開關怎麼算」，不是設定怎麼存檔。 */
globalThis.Prefs = { data: null, save() {} };

test('從來沒動過就用預設那一組，不是全開', () => {
    // 十三張全開的話總覽會變成一面牆，而這一頁只回答一件事：
    // 現在需要我注意什麼。
    Prefs.data = {};
    const on = Overview.onSet();
    assert.deepEqual([...on].sort(), [...Overview.DEFAULT_ON].sort());
    assert.ok(on.size < Overview.CARDS.length, '預設不該是全開');
});

test('存的是關掉的那幾張，所以新卡片會自己出現', () => {
    // 存「開著的」的話，以後加一張新卡，動過設定的人都不會看到它。
    Prefs.data = { overviewOff: ['memo'] };
    const on = Overview.onSet();
    assert.ok(!on.has('memo'), '關掉的要真的關掉');
    for (const c of Overview.CARDS) {
        if (c.id === 'memo') continue;
        assert.ok(on.has(c.id), `${c.id} 應該是開著的`);
    }
});

test('空陣列是「動過但一張都沒關」，跟沒動過不一樣', () => {
    Prefs.data = { overviewOff: [] };
    assert.equal(Overview.onSet().size, Overview.CARDS.length, '全開');
});

test('每張卡都畫得出來，沒有漏接的 id', () => {
    // renderCard 是一串 if，漏一個的話那張卡永遠是空的——
    // 而且不會報錯，只是排版設定裡多一個點了沒反應的選項。
    const src = String(Overview.renderCard);
    for (const c of Overview.CARDS) {
        assert.ok(src.includes(`'${c.id}'`), `renderCard 沒有接 ${c.id}`);
    }
});
