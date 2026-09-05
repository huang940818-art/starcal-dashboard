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
    const names = ['Money', 'money', 'ymd', 'parseYmd', 'monthOf', 'recentMonths', 'DEMO', 'AutoCat'];
    // 這些檔案是給瀏覽器的全域 script，沒有 export。包一層把要的東西丟出來。
    return new Function(`
        const document = { querySelector: () => null, querySelectorAll: () => [] };
        ${src}
        return { ${names.join(', ')} };
    `)();
}

const { Money, money, ymd, parseYmd, monthOf, recentMonths, DEMO, AutoCat } =
    load('./js/util.js', './js/demo.js', './js/money.js', './js/autocat.js');

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
