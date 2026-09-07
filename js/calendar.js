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

    /** 排班模式。開著的時候，點格子＝在那天排上／取消目前選的班。 */
    shiftMode: false,
    /** 目前選的班別 id */
    pickedShift: null,

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
            el('button', {
                type: 'button',
                class: 'btn small' + (this.shiftMode ? ' primary' : ' ghost'),
                text: this.shiftMode ? '排完了' : '排班',
                style: 'margin-left:auto',
                onclick: () => {
                    this.shiftMode = !this.shiftMode;
                    // 只有一種班別的話直接幫她選好——多按一下沒有意義
                    if (this.shiftMode && !this.pickedShift) {
                        this.pickedShift = Cal.shifts()[0]?.id || null;
                    }
                    this.render();
                },
            }),
        ]));

        if (this.shiftMode) box.append(this.shiftBar());

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
            if (this.shiftMode && this.pickedShift
                && Cal.hasShift(c.day, this.pickedShift)) cls.push('shift-on');

            grid.append(el('div', {
                class: cls.join(' '),
                role: 'button',
                tabindex: '0',
                'aria-label': `${c.n} 日，${items.length} 件事`,
                onclick: () => {
                    if (this.shiftMode) return this.tapShift(c.day);
                    this.picked = c.day;
                    this.render();
                },
                ondblclick: () => { if (!this.shiftMode) Cal.edit(null, c.day); },
                onkeydown: e => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    if (this.shiftMode) return this.tapShift(c.day);
                    this.picked = c.day;
                    this.render();
                },
            }, [
                el('div', { class: 'cal-head-row' }, [
                    el('div', { class: 'cal-n', text: String(c.n) }),
                    // 有課的日子在日期旁邊點幾個點，一堂一個。
                    //
                    // **課是每週固定的，寫成文字會在整張月曆上重複三十次。**
                    // 先前寫「N 堂課」她說很醜、很單調；改成寫課名之後，
                    // 每個週一都是同樣兩行字，只是換一種方式重複。
                    // 月曆真正要回答的是「這天要不要出門」，那用點就夠了；
                    // 「上什麼課」滑過去看得到，點下去底下那塊有完整的。
                    c.classes.length
                        ? el('div', {
                            class: 'cal-cls-dots',
                            title: c.classes.map(k => {
                                const when = Timetable.whenText(k)
                                    .replace(/^第 /, '').replace(/ 節$/, '');
                                const mark = Timetable.markFor(k.id, c.day);
                                return [when, k.name, k.place,
                                        mark?.off ? '（這次不用上）' : '',
                                        mark?.text || ''].filter(Boolean).join('　');
                            }).join('\n'),
                            'aria-label': `${c.classes.length} 堂課`,
                          }, c.classes.slice(0, 4).map(k => {
                            const l = Prefs.label(k.label);
                            // 停掉的那堂畫成空心。**不是拿掉那個點**——
                            // 拿掉的話「今天本來有課」這件事就消失了，
                            // 看起來會像自己記錯。
                            const off = Timetable.isOff(k.id, c.day);
                            return el('span', {
                                class: 'cls-dot' + (off ? ' off' : ''),
                                style: l ? (off ? `border-color:${l.color}`
                                                : `background:${l.color}`) : '',
                            });
                          }))
                        : null,
                    // 在這天加一件。滑過格子才出現——三十五個常駐的 ＋
                    // 會比那個月真正有事的那幾天還顯眼。
                    el('button', {
                        type: 'button', class: 'cal-add', text: '＋',
                        'aria-label': `在 ${c.n} 日加行程`,
                        title: '在這天加行程',
                        onclick: e => { e.stopPropagation(); Cal.edit(null, c.day); },
                    }),
                ]),
                // 桌機放標題，手機只放色點——同一份資料兩種密度，
                // 由 CSS 決定顯示哪一個
                el('div', { class: 'cal-items' },
                    items.slice(0, 3).map(x => {
                        const l = Prefs.label(x.it.label);
                        // 有時間的把時間寫出來。格子裡只有標題的話，
                        // 「今天下午有事」跟「今天早上有事」看起來一模一樣。
                        const t = x.kind === 'event' ? (x.it.time || '') : '';
                        return el('button', {
                            type: 'button',
                            class: 'cal-item' + (x.kind === 'todo' ? ' todo' : '')
                                + (x.it.done ? ' done' : ''),
                            style: l ? `--line:${l.color}` : '',
                            title: [t, x.it.title, l ? `・${l.name}` : '']
                                .filter(Boolean).join(' ') + '　點一下改',
                            // **點條目直接開編輯。** 原本要先點格子選日期、
                            // 再到底下的清單裡找同一件事點第二次——
                            // 眼睛已經看到它了，卻不能直接動它。
                            onclick: e => {
                                e.stopPropagation();
                                if (x.kind === 'event') Cal.edit(x.it);
                                else Todo.edit(x.it);
                            },
                        }, [
                            t ? el('span', { class: 'cal-t', text: t }) : null,
                            el('span', { class: 'ellipsis', text: x.it.title }),
                        ]);
                    })),
                items.length > 3
                    ? el('button', {
                        type: 'button', class: 'cal-more',
                        text: `＋${items.length - 3} 件`,
                        onclick: e => { e.stopPropagation(); this.picked = c.day; this.render(); },
                    })
                    : null,
                // 課平常用一行摘要，不一堂一堂列——**每天四五堂課列進格子的話，
                // 這個月只剩下上課看得到**，而月曆要回答的是
                // 「這個月哪幾天不一樣」。
                //
                // **但篩了某一個分類就整堂寫出來。** 她的原話是
                // 「比如我按學校 就可以完全顯示課表」——篩選之後格子裡
                // 只剩那一類，量少了就有空間，而且那時候她要看的
                // 就是「這個月的學校課長什麼樣」。
                ...(Agenda.filter
                    ? c.classes.slice(0, 3).map(k => el('div', { class: 'cal-item cls' }, [
                        el('span', {
                            class: 'label-dot',
                            style: `background:${Prefs.label(k.label)?.color || 'var(--lime)'}`,
                        }),
                        el('span', { class: 'ellipsis', text: k.name }),
                      ]))
                    : [c.classes.length
                        ? el('div', { class: 'cal-class', text: `${c.classes.length} 堂課` })
                        : null]),
                Agenda.filter && c.classes.length > 3
                    ? el('div', { class: 'cal-more', text: `＋${c.classes.length - 3} 堂` })
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

    /**
     * 排班那一列。
     *
     * 擺在月曆上面而不是對話框裡：排班的時候眼睛要一直看著月曆
     * （這週排幾天了、下週還空著），把班別藏進對話框就得一直開開關關。
     */
    shiftBar() {
        const shifts = Cal.shifts();

        return el('div', { class: 'shift-bar' }, [
            el('div', { class: 'shift-chips' }, [
                ...shifts.map(s => el('button', {
                    type: 'button',
                    class: 'shift-chip' + (s.id === this.pickedShift ? ' on' : ''),
                    onclick: () => { this.pickedShift = s.id; this.render(); },
                    // 長按／右鍵刪掉這個班別。排出去的班留著。
                    oncontextmenu: e => {
                        e.preventDefault();
                        Cal.removeShift(s.id);
                        if (this.pickedShift === s.id) {
                            this.pickedShift = Cal.shifts()[0]?.id || null;
                        }
                        this.render();
                        toast(`拿掉班別「${s.name}」，已經排出去的班留著`);
                    },
                }, [
                    Prefs.dot(s.label),
                    el('span', { text: s.name }),
                    s.time ? el('span', { class: 'shift-time',
                                          text: s.time + (s.endTime ? '–' + s.endTime : '') })
                           : null,
                ])),
                el('button', {
                    type: 'button', class: 'shift-chip add', text: '＋ 新的班別',
                    onclick: () => this.editShift(),
                }),
            ]),
            el('div', { class: 'shift-hint', text: shifts.length
                ? (this.pickedShift ? '點日期排上去，再點一次取消。' : '先選一個班別。')
                : '先開一個班別：它是重複用的樣板，之後點日期就排得上去。' }),
        ]);
    },

    tapShift(day) {
        if (!this.pickedShift) {
            const first = Cal.shifts()[0];
            if (!first) return this.editShift();
            this.pickedShift = first.id;
        }
        const on = Cal.toggleShift(day, this.pickedShift);
        this.render();
        Agenda.renderTimeline?.();
        Overview.render();

        // 排到哪一天要講出來。整個月的格子長得很像，點錯一天不容易發現。
        const d = parseYmd(day);
        const name = Cal.shift(this.pickedShift)?.name || '班';
        toast(`${d.getMonth() + 1}/${d.getDate()} ${on ? '排上' : '取消'}${name}`);
    },

    editShift() {
        $('#sf-name').value = '';
        $('#sf-time').value = '';
        $('#sf-end').value = '';
        Prefs.fillSelect($('#sf-label'), null);

        const dlg = openDialog('#dlg-shift');
        $('#sf-save').onclick = () => {
            const time = $('#sf-time').value;
            const endTime = $('#sf-end').value;
            if (time && endTime && endTime < time) return toast('結束時間比開始還早', true);

            const s = Cal.addShift({
                name: $('#sf-name').value,
                time, endTime,
                label: $('#sf-label').value || null,
            });
            if (!s) return toast('這個班叫什麼？', true);

            this.pickedShift = s.id;
            this.shiftMode = true;
            dlg.close();
            this.render();
        };
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
                    // 課要帶上日期，點下去才知道是「標記這一天」而不是改整學期
                    ...Agenda.mergeTimed(events, classes).map(r => r.kind === 'class'
                        ? Agenda.classRow(r.item, day)
                        : Agenda.eventRow(r.item)),
                    ...todos.map(t => Todo.row(t)),
                  ]
                : [el('div', { class: 'empty', style: 'padding:20px 4px' }, ['這天沒有排事'])]),
        ]);
    },
};
