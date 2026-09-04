/* 月曆格子。
 *
 * **當初刻意沒做這個**，理由寫在 agenda.js 上面：行程不密集的時候，
 * 一個空的月曆每次打開都在說「你什麼都沒有」。那個顧慮還算數，
 * 所以月曆是**另一個檢視，不是取代**——打開分頁預設還是那條時間線，
 * 時間線回答「接下來要做什麼」，月曆回答「這個月長什麼樣子」。
 *
 * 手機上格子只放色點不放字：一格三十幾像素寬，塞進標題只會變成
 * 一堆認不出來的碎字。點下去看那天的完整內容。
 */

const MonthView = {
    ym: null,            // 現在看哪個月，"2026-09"
    picked: null,        // 選中的那一天，"2026-09-04"

    init() {
        this.ym = thisMonth();
        this.picked = todayStr();
    },

    shift(n) {
        const [y, m] = this.ym.split('-').map(Number);
        const d = new Date(y, m - 1 + n, 1);
        this.ym = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
        // 換月之後選中的那天要留在畫面上的月份裡，不然下面那塊
        // 顯示的是別的月份的事，看起來像沒反應
        this.picked = this.ym === thisMonth()
            ? todayStr()
            : `${this.ym}-01`;
        this.render();
    },

    today() {
        this.ym = thisMonth();
        this.picked = todayStr();
        this.render();
    },

    /** 這個月的格子，含前後補滿整週的空格。回傳 42 或 35 格。 */
    cells() {
        const [y, m] = this.ym.split('-').map(Number);
        const first = new Date(y, m - 1, 1);
        const start = new Date(y, m - 1, 1 - first.getDay());     // 補到週日
        const daysInMonth = new Date(y, m, 0).getDate();
        const total = Math.ceil((first.getDay() + daysInMonth) / 7) * 7;

        const out = [];
        for (let i = 0; i < total; i++) {
            const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
            const day = ymd(d);
            out.push({
                day,
                n: d.getDate(),
                outside: monthOf(day) !== this.ym,
                events: Agenda.eventsOn(day),
                todos: Agenda.todosOn(day),
                classes: Timetable.on(day).filter(c => Agenda.match(c)),
            });
        }
        return out;
    },

    render() {
        const box = $('#calendar');
        clear(box);
        if (box.hidden) return;

        const [y, m] = this.ym.split('-').map(Number);
        const isNow = this.ym === thisMonth();

        // 月份切換
        box.append(el('div', { class: 'month-nav' }, [
            el('button', { type: 'button', class: 'btn icon', text: '‹',
                'aria-label': '上個月', onclick: () => this.shift(-1) }),
            el('div', { class: 'month-label' }, [
                icon('calendar', 16), `${y} 年 ${m} 月`,
            ]),
            el('button', { type: 'button', class: 'btn icon', text: '›',
                'aria-label': '下個月', onclick: () => this.shift(1) }),
            isNow ? null : el('button', { type: 'button', class: 'btn small ghost',
                text: '回到這個月', onclick: () => this.today() }),
        ]));

        // 星期列
        box.append(el('div', { class: 'cal-grid cal-head' },
            [...'日一二三四五六'].map((w, i) => el('div', {
                class: 'cal-wd' + (i === 0 || i === 6 ? ' weekend' : ''), text: w,
            }))));

        // 格子
        const grid = el('div', { class: 'cal-grid' });
        for (const c of this.cells()) {
            const items = [...c.events.map(e => ({ kind: 'event', it: e })),
                           ...c.todos.map(t => ({ kind: 'todo', it: t }))];

            const cls = ['cal-cell'];
            if (c.outside) cls.push('outside');
            if (c.day === todayStr()) cls.push('today');
            if (c.day === this.picked) cls.push('picked');

            grid.append(el('div', {
                class: cls.join(' '),
                role: 'button',
                tabindex: '0',
                'aria-label': `${c.n} 日，${items.length} 件事`,
                onclick: () => { this.picked = c.day; this.render(); },
                onkeydown: e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        this.picked = c.day;
                        this.render();
                    }
                },
            }, [
                el('div', { class: 'cal-n', text: String(c.n) }),
                // 桌機放標題，手機只放色點——同一份資料兩種密度，
                // 由 CSS 決定顯示哪一個
                el('div', { class: 'cal-items' },
                    items.slice(0, 3).map(x => el('div', {
                        class: 'cal-item' + (x.kind === 'todo' ? ' todo' : ''),
                    }, [
                        Prefs.dot(x.it.label) || el('span', { class: 'label-dot none' }),
                        el('span', { class: 'ellipsis', text: x.it.title }),
                    ]))),
                items.length > 3
                    ? el('div', { class: 'cal-more', text: `＋${items.length - 3}` })
                    : null,
                // 課用一行摘要，不一堂一堂列。
                // **每天四五堂課列進格子的話，這個月只剩下上課看得到**——
                // 而月曆要回答的是「這個月哪幾天有事」。
                c.classes.length
                    ? el('div', { class: 'cal-class', text: `${c.classes.length} 堂課` })
                    : null,
                el('div', { class: 'cal-dots' },
                    items.slice(0, 5).map(x => {
                        const l = Prefs.label(x.it.label);
                        return el('span', {
                            class: 'label-dot' + (l ? '' : ' none'),
                            style: l ? `background:${l.color}` : '',
                        });
                    })),
            ]));
        }
        box.append(grid);

        box.append(this.dayPanel());
    },

    /** 選中那天的完整內容。月曆格子塞不下的東西全在這裡。 */
    dayPanel() {
        const day = this.picked;
        const events = Agenda.eventsOn(day);
        const todos = Agenda.todosOn(day);
        const classes = Timetable.on(day).filter(c => Agenda.match(c));
        const d = parseYmd(day);

        return el('div', { class: 'cal-day' }, [
            el('div', { class: 'day-head' }, [
                el('span', {
                    class: 'day-name' + (day === todayStr() ? ' now' : ''),
                    text: `${d.getMonth() + 1}/${d.getDate()}　`
                        + '日一二三四五六'[d.getDay()].replace(/^/, '週')
                        + (day === todayStr() ? '・今天' : ''),
                }),
                el('span', {}, [
                    el('button', {
                        type: 'button', class: 'btn small', text: '加行程',
                        onclick: () => Cal.edit(null, day),
                    }),
                    ' ',
                    el('button', {
                        type: 'button', class: 'btn small', text: '加待辦',
                        onclick: () => Todo.edit(null, day),
                    }),
                ]),
            ]),
            ...(events.length || todos.length || classes.length
                ? [
                    // 跟時間線同一套規則：課和行程照時間混排，待辦排最後
                    ...Agenda.mergeTimed(events, classes).map(r => r.kind === 'class'
                        ? Agenda.classRow(r.item)
                        : Agenda.eventRow(r.item)),
                    ...todos.map(t => Todo.row(t)),
                  ]
                : [el('div', { class: 'empty', style: 'padding:20px 4px' }, ['這天沒有排事'])]),
        ]);
    },
};
