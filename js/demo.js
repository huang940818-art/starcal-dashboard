/* 展示模式的示範資料。
 *
 * 作品集上要有人點得動，所以不能是空白的介面——空的儀表板看不出做了什麼。
 * 但也不能放真實帳目，所以這裡整份是編出來的。
 *
 * 兩個刻意的決定：
 *
 * 1. **日期相對於今天算**，不是寫死。不然過半年打開，趨勢圖會停在去年，
 *    看起來像個沒人維護的東西。
 * 2. **金額用固定亂數種子**，每次打開都一樣。每次重整數字就跳一次的話，
 *    看的人會以為是隨機產生器而不是一份帳。
 */

/** 固定種子的偽隨機。mulberry32，短、夠均勻、不需要相依。 */
function seeded(seed) {
    return function () {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function demoMoney() {
    const rand = seeded(20260902);
    const pick = arr => arr[Math.floor(rand() * arr.length)];
    const between = (a, b) => Math.round(a + rand() * (b - a));

    const expense = [
        { name: '餐飲', nature: 'flexible' },
        { name: '交通', nature: 'fixed' },
        { name: '房租', nature: 'fixed' },
        { name: '訂閱', nature: 'fixed' },
        { name: '日用品', nature: 'flexible' },
        { name: '醫療', nature: 'fixed' },
        { name: '娛樂', nature: 'flexible' },
        { name: '書籍課程', nature: 'flexible' },
        { name: '衣服', nature: 'flexible' },
        { name: '禮物', nature: 'flexible' },
    ];

    const notes = {
        餐飲: ['早餐店', '便當', '超商', '火鍋', '咖啡', '學餐'],
        交通: ['悠遊卡加值', '高鐵', '計程車', '加油'],
        日用品: ['洗髮精', '衛生紙', '藥妝店'],
        娛樂: ['電影', '展覽', 'KTV'],
        書籍課程: ['原文書', '線上課程'],
        衣服: ['外套', '鞋子'],
        禮物: ['生日禮物', '伴手禮'],
        醫療: ['看診', '藥局'],
        房租: ['月租'],
        訂閱: ['月費'],
    };

    const transactions = [];
    const today = new Date();

    for (let back = 11; back >= 0; back--) {
        const first = new Date(today.getFullYear(), today.getMonth() - back, 1);
        const y = first.getFullYear(), m = first.getMonth();
        const lastDay = back === 0 ? today.getDate()
                                   : new Date(y, m + 1, 0).getDate();

        // 收入：打工薪水，固定在 5 號
        if (lastDay >= 5) {
            transactions.push({
                id: uid(), date: ymd(new Date(y, m, 5)), kind: 'income',
                amount: between(18000, 23000), category: '打工',
                account: '郵局', note: '月薪',
            });
        }

        // 固定支出
        if (lastDay >= 3) {
            transactions.push({
                id: uid(), date: ymd(new Date(y, m, 3)), kind: 'expense',
                amount: 8500, category: '房租', account: '郵局', note: '月租',
            });
        }
        if (lastDay >= 8) {
            transactions.push({
                id: uid(), date: ymd(new Date(y, m, 8)), kind: 'expense',
                amount: 268, category: '訂閱', account: '信用卡', note: '音樂串流',
            });
        }

        // 領現金、繳卡費。
        // **少了這兩筆，示範資料就會長成「現金 −89,570、信用卡 −56,948，
        // 錢全積在郵局」**——現金餘額是負的在現實裡不可能，作品集上一眼就假。
        // 順便也把轉帳這個功能展示出來。
        if (lastDay >= 6) {
            // 照上個月現金花掉的量領，跟真的一樣。領固定金額的話
            // 現金餘額會一路往下掉，最後變成負的——現實裡不可能。
            const prevM = new Date(y, m - 1, 1);
            const prevYm = `${prevM.getFullYear()}-${pad(prevM.getMonth() + 1)}`;
            const cashOut = transactions
                .filter(t => t.kind === 'expense' && t.account === '現金'
                             && monthOf(t.date) === prevYm)
                .reduce((sum, t) => sum + t.amount, 0);
            transactions.push({
                id: uid(), date: ymd(new Date(y, m, 6)), kind: 'transfer',
                amount: cashOut ? Math.round(cashOut / 500) * 500 : 6000,
                account: '郵局', toAccount: '現金', note: '領現金',
            });
        }
        if (back < 11 && lastDay >= 15) {
            // 上個月刷的卡這個月繳。第一個月沒有前一期，所以跳過。
            const prev = new Date(y, m - 1, 1);
            const owed = transactions
                .filter(t => t.kind === 'expense' && t.account === '信用卡'
                             && monthOf(t.date) === `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}`)
                .reduce((sum, t) => sum + t.amount, 0);
            if (owed > 0) {
                transactions.push({
                    id: uid(), date: ymd(new Date(y, m, 15)), kind: 'transfer',
                    amount: owed, account: '郵局', toAccount: '信用卡', note: '繳卡費',
                });
            }
        }

        // 日常，一個月十幾筆。
        // 這個月只過了幾天的話要按比例減——整個月的量全塞進前兩天，
        // 「9 月 2 日已經花掉一萬六」，看的人一眼就知道是編的。
        const full = between(13, 20);
        const count = back === 0
            ? Math.max(5, Math.round(full * lastDay / 30))
            : full;

        // 這個月固定放一筆超過娛樂預算的支出。
        // 展示模式在月初打開的話，預算那張卡會四條全空——
        // 「超支會變紅」是這個儀表板最主要的功能之一，看不到就等於沒做。
        // 示範資料本來就是編來展示的，這一筆是刻意的。
        if (back === 0) {
            transactions.push({
                id: uid(), date: ymd(new Date(y, m, Math.min(2, lastDay))),
                kind: 'expense', amount: 1680, category: '娛樂',
                account: '信用卡', note: '展覽',
            });
        }
        for (let i = 0; i < count; i++) {
            const day = between(1, lastDay);
            const cat = pick(expense.filter(c => !['房租', '訂閱'].includes(c.name)));
            const amount = cat.name === '交通' ? between(30, 500)
                         : cat.name === '餐飲' ? between(45, 320)
                         : between(80, 1800);
            transactions.push({
                id: uid(), date: ymd(new Date(y, m, day)), kind: 'expense',
                amount, category: cat.name,
                account: rand() > 0.65 ? '信用卡' : '現金',
                note: pick(notes[cat.name] || ['']),
            });
        }
    }

    transactions.sort((a, b) => b.date.localeCompare(a.date));

    return {
        accounts: [
            { id: uid(), name: '郵局', kind: 'bank', opening: 42000, includeInTotal: true, order: 0 },
            { id: uid(), name: '現金', kind: 'cash', opening: 10000, includeInTotal: true, order: 1 },
            { id: uid(), name: '信用卡', kind: 'credit', opening: 0, includeInTotal: true, order: 2 },
            { id: uid(), name: '定存', kind: 'invest', opening: 60000, includeInTotal: false, order: 3 },
        ],
        transactions,
        subscriptions: [
            {
                id: uid(), name: '音樂串流', amount: 268, cycle: 'monthly',
                first: ymd(new Date(today.getFullYear(), today.getMonth() - 8, 8)),
                account: '信用卡', active: true,
            },
            {
                id: uid(), name: '雲端空間', amount: 90, cycle: 'monthly',
                first: ymd(new Date(today.getFullYear(), today.getMonth() - 5, 22)),
                account: '信用卡', active: true,
            },
            {
                id: uid(), name: '網域', amount: 450, cycle: 'yearly',
                first: ymd(new Date(today.getFullYear() - 1, today.getMonth(), 14)),
                account: '信用卡', active: true,
            },
        ],
        budgets: [
            { category: '餐飲', limit: 6000 },
            { category: '娛樂', limit: 1500 },
            { category: '日用品', limit: 1200 },
            { category: '衣服', limit: 1000 },
        ],
        categories: {
            expense,
            income: [{ name: '打工' }, { name: '獎學金' }, { name: '家裡給的' }, { name: '其他' }],
        },
    };
}

/* 示範用的分類。**id 寫死不用 uid()**——底下的行程、待辦和課表
 * 都要指到這幾個 id，隨機產生的話對不起來，示範資料一打開
 * 就是一堆沒有顏色的列。 */
const DEMO_LABELS = [
    { id: 'demo-school', name: '學校', color: '#7FB4E8' },
    { id: 'demo-lab',    name: '專題', color: '#5FC9C0' },
    { id: 'demo-life',   name: '生活', color: '#B8D96F' },
    { id: 'demo-body',   name: '身體', color: '#EE8FA3' },
    { id: 'demo-money',  name: '錢',   color: '#F0B45F' },
];

const DEMO = {
    記帳: demoMoney(),

    行事曆: {
        events: [
            {
                id: uid(), date: ymd(new Date()), time: '14:00', endTime: '15:30',
                title: '實驗室 meeting', note: '報告上週的進度', label: 'demo-lab',
            },
            {
                id: uid(), date: ymd(new Date()), time: '19:00', endTime: '',
                title: '跟同學吃飯', note: '學校後門那家', label: 'demo-life',
            },
            {
                id: uid(), date: ymd(new Date(Date.now() + 86400000)), time: '',
                endTime: '', title: '回函截止', note: '整天都可以寄', label: 'demo-school',
            },
            {
                id: uid(), date: ymd(new Date(Date.now() + 3 * 86400000)),
                time: '09:30', endTime: '12:00', title: '多益考試', note: '記得帶證件和 2B 鉛筆',
                label: 'demo-school',
            },
            {
                id: uid(), date: ymd(new Date(Date.now() + 6 * 86400000)),
                time: '15:00', endTime: '16:00', title: '牙醫回診', note: '', label: 'demo-body',
            },
        ],
    },

    待辦: {
        items: [
            {
                id: uid(), title: '寄回函給系辦', done: false, priority: 1,
                due: ymd(new Date(Date.now() + 86400000)),
                note: '要附成績單影本', label: 'demo-school', createdAt: Date.now() - 3 * 86400000,
            },
            {
                id: uid(), title: '訂高鐵票', done: false, priority: 0,
                due: ymd(new Date(Date.now() + 4 * 86400000)),
                note: '早鳥票只到週五', label: 'demo-life', createdAt: Date.now() - 86400000,
            },
            {
                id: uid(), title: '約牙醫回診', done: false, priority: 0,
                due: null, note: '', label: 'demo-body', createdAt: Date.now() - 6 * 86400000,
            },
            {
                id: uid(), title: '把電子書載下來', done: false, priority: 0,
                due: null, note: '', createdAt: Date.now() - 2 * 86400000,
            },
            {
                id: uid(), title: '繳網路費', done: true, priority: 0,
                due: ymd(new Date(Date.now() - 2 * 86400000)), note: '', label: 'demo-money',
                createdAt: Date.now() - 8 * 86400000,
                completedAt: Date.now() - 2 * 86400000,
            },
        ],
    },

    備忘: {
        items: [
            {
                id: uid(), pinned: true,
                text: '停車場 B2\nF 區 17 號\n電梯出來往左',
                createdAt: Date.now() - 5 * 86400000,
                updatedAt: Date.now() - 5 * 86400000,
            },
            {
                id: uid(), pinned: false,
                text: '書店店員推薦的\n《設計的心理學》\n說第三章講可視性那段最值得看',
                createdAt: Date.now() - 2 * 86400000,
                updatedAt: Date.now() - 2 * 86400000,
            },
            {
                id: uid(), pinned: false,
                text: '洗衣店老闆說\n羽絨外套要單獨洗\n下次拿去記得先講',
                createdAt: Date.now() - 9 * 86400000,
                updatedAt: Date.now() - 9 * 86400000,
            },
        ],
    },

    便利貼: {
        notes: [
            {
                id: uid(), text: '想做的：\n把每天量到的東西\n變成看得懂的一句話',
                x: 40, y: 30, color: '#F9D984', z: 1, tilt: -1.5,
            },
            {
                id: uid(), text: '問題是\n資料有了\n但沒有人在解讀',
                x: 268, y: 84, color: '#B8D96F', z: 2, tilt: 1.2,
            },
            {
                id: uid(), text: '→ 所以重點不是\n量得更準\n是講得更準',
                x: 500, y: 40, color: '#5FC9C0', z: 3, tilt: -.8,
            },
            {
                id: uid(), text: '下一步\n找三個人試用\n看他們會不會問\n「所以呢？」',
                x: 190, y: 290, color: '#D9B48F', z: 4, tilt: 2,
            },
            {
                id: uid(), text: '（這面牆是示範用的\n拖拖看、改改看\n都不會影響任何人）',
                x: 470, y: 320, color: '#EE8FA3', z: 5, tilt: -2.2,
            },
        ],
    },

    // 示範課表用節次制——學校發的課表就是這樣，示範資料要像真的。
    // 另外附一份時間制的班表，兩種模式都看得到。
    課表: {
        active: 'demo-term',
        periods: [
            ...['0', '1', '2', '3', '4'].map(n => ({ id: 'p' + n, name: n, start: '', end: '' })),
            { id: 'pnoon', name: '中午', start: '', end: '' },
            ...['5', '6', '7', '8', '9', '10', '11', '12']
                .map(n => ({ id: 'p' + n, name: n, start: '', end: '' })),
        ],
        sets: [
            {
                id: 'demo-term', name: '115 上', mode: 'period',
                slots: [
                    { id: 'k1', name: '訊號與系統', day: 1, from: 'p2', to: 'p3',
                      place: '工五 301', teacher: '林老師', label: 'demo-school' },
                    { id: 'k2', name: '專題實作', day: 1, from: 'p9', to: 'p10',
                      place: '實驗室', teacher: '陳老師', label: 'demo-lab' },
                    { id: 'k3', name: '微處理機', day: 2, from: 'p3', to: 'p4',
                      place: '工四 205', teacher: '陳老師', label: 'demo-school' },
                    { id: 'k4', name: '英文閱讀', day: 3, from: 'p1', to: 'p2',
                      place: '人文 102', teacher: '', label: 'demo-school' },
                    { id: 'k5', name: '專題實作', day: 3, from: 'p10', to: 'p12',
                      place: '實驗室', teacher: '陳老師', label: 'demo-lab' },
                    { id: 'k6', name: '電子學實驗', day: 4, from: 'p6', to: 'p8',
                      place: '實驗大樓 B1', teacher: '王老師', label: 'demo-school' },
                    { id: 'k7', name: '體育', day: 5, from: 'p3', to: 'p4',
                      place: '體育館', teacher: '', label: 'demo-body' },
                ],
            },
            {
                id: 'demo-shift', name: '打工班表', mode: 'time',
                slots: [
                    { id: 's1', name: '早班', day: 6, start: '08:00', end: '14:00',
                      place: '', teacher: '', label: 'demo-money' },
                    { id: 's2', name: '晚班', day: 0, start: '15:00', end: '21:00',
                      place: '', teacher: '', label: 'demo-money' },
                ],
            },
        ],
    },

    設定: { accent: '#F9D984', labels: DEMO_LABELS },
};


/* 清空之後的起始形狀。跟 server.py 的 EMPTY 是同一套——
 * 少一個欄位，前端就得到處寫 `?? []`，漏一個就整頁爆掉。 */
const EMPTY_DATA = {
    記帳: {
        accounts: [], transactions: [], subscriptions: [], budgets: [],
        categories: { expense: [], income: [] },
    },
    待辦: { items: [] },
    行事曆: { events: [] },
    備忘: { items: [] },
    便利貼: { notes: [] },
    課表: { active: null, periods: [], sets: [] },
    設定: {},
};
