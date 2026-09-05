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
    const names = ['Money', 'money', 'ymd', 'parseYmd', 'monthOf', 'recentMonths', 'DEMO', 'AutoCat', 'Range', 'Csv', 'uid', 'stamp', 'pad'];
    // 這些檔案是給瀏覽器的全域 script，沒有 export。包一層把要的東西丟出來。
    return new Function(`
        const document = { querySelector: () => null, querySelectorAll: () => [] };
        ${src}
        return { ${names.join(', ')} };
    `)();
}

const { Money, money, ymd, parseYmd, monthOf, recentMonths, DEMO, AutoCat, Range, Csv } =
    load('./js/util.js', './js/demo.js', './js/money.js', './js/autocat.js', './js/csv.js');

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
