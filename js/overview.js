/* 總覽。
 *
 * 這一頁只回答一件事：**現在需要我注意什麼。**
 *
 * 原本這裡是三張一樣大的卡片。每一張都同樣重要，等於沒有一張重要——
 * 那是後台管理系統的長相，不是自己的儀表板。
 * 所以現在最上面有一句話，大到不用找；剩下的才是卡片。
 *
 * 那句話是有排序的（過期 > 今天到期 > 超支 > 還有待辦 > 沒事），
 * 一次只講最要緊的一件。全部列出來等於沒有排序。
 */

const Overview = {
    render() {
        this.renderHero();

        const grid = $('#overview-grid');
        clear(grid);
        this.renderAttention(grid);
        this.renderMoney(grid);
        this.renderUpcoming(grid);
        this.renderMemo(grid);
        // 小克那塊放最後：它不是待辦事項，不該排在「現在需要注意什麼」前面。
        // 展示模式時 Ke.render 自己會早退，這裡不用判斷。
        Ke.render(grid);
    },

    /* ── 今天 ──────────────────────────────────────── */

    renderHero() {
        const box = $('#hero');
        clear(box);

        const now = new Date();
        const dateText = `${now.getMonth() + 1} 月 ${now.getDate()} 日　`
            + '日一二三四五六'[now.getDay()].replace(/^/, '週');

        const late = Agenda.overdue(true);   // 總覽看全部，不吃「接下來」那邊的分類篩選
        const overdue = [...late.events, ...late.todos];
        // 今天的事＝今天的行程 ＋ 今天到期的待辦。
        // 分開算就等於要人自己在腦子裡合併，那正是這條線要解決的問題。
        const todayEvents = Cal.on(todayStr());
        const dueToday = Todo.data.items.filter(i => !i.done && i.due === todayStr());
        const todayAll = [...todayEvents, ...dueToday];
        const open = Todo.open();

        const spent = new Map(Money.byCategory(thisMonth()).map(c => [c.category, c.amount]));
        const over = Money.data.budgets
            .filter(b => Number(b.limit) > 0 && (spent.get(b.category) || 0) > b.limit)
            .map(b => ({ ...b, used: spent.get(b.category) || 0 }));

        // 今天的課。**不算進「今天有幾件事」**——課表是每週固定的，
        // 每天四五堂加進去的話那個數字永遠是兩位數，「今天只有三件事」
        // 這個訊息就消失了。課單獨講一句，講的是「哪幾個時段被佔走了」。
        const classes = Timetable.on(todayStr());

        const empty = !Money.data.transactions.length && !open.length
            && !Cal.data.events.length && !Timetable.slots().length
            && !Memo.data.items.length && !Wall.data.notes.length;

        // 一次只講最要緊的那一件
        let headline, note = null, tone = '';
        if (empty) {
            headline = ['還是空的'];
            note = '從記一筆、加一件待辦，或在想法牆上貼一張開始。';
        } else if (overdue.length) {
            headline = ['有 ', em(overdue.length), ' 件過期了'];
            tone = 'alert';
            note = overdue.map(i => i.title).slice(0, 3).join('、');
        } else if (todayAll.length) {
            headline = ['今天有 ', em(todayAll.length), ' 件事'];
            // 把它們列出來。「三件事」是抽象的，看到是哪三件才會變小。
            note = todayAll.map(i => i.title).slice(0, 4).join('、');
        } else if (over.length) {
            headline = [over[0].category, '超出預算 ', em(money(over[0].used - over[0].limit))];
            tone = 'alert';
            note = over.length > 1 ? `另外還有 ${over.length - 1} 類也超了` : null;
        } else if (open.length) {
            headline = ['還有 ', em(open.length), ' 件待辦'];
            note = '今天沒有到期的，慢慢來。';
        } else {
            headline = ['今天沒有到期的事'];
        }

        // 課的那一句接在後面，不搶上面那句的位置。
        if (classes.length) {
            // 節次沒設時間的話講節次，不要生一個「–」出來假裝有時間
            const a = Timetable.startOf(classes[0]);
            const b = Timetable.endOf(classes[classes.length - 1]);
            const span = a
                ? `${a}–${b || ''}`
                : Timetable.whenText(classes[0])
                  + (classes.length > 1 ? `～${Timetable.whenText(classes[classes.length - 1])}` : '');
            const line = `今天 ${classes.length} 堂課・${span}`;
            note = note ? `${note}　｜　${line}` : line;
        }

        function em(text) {
            return el('em', { text: String(text) });
        }

        // hero 已經講過的那一條，下面「要注意的」就不要再講一次。
        // 同一句話講兩遍，兩遍都會被當成背景。
        this.heroSaid = tone === 'alert' && over.length ? over[0].category : null;

        box.append(el('div', { class: 'hero' + (tone === 'alert' ? ' has-alert' : '') }, [
            el('div', { class: 'glow' }, [icon('star', 190)]),
            el('div', { class: 'date', text: dateText }),
            el('div', {
                class: 'headline' + (headline.length === 1 && !note ? ' calm' : ''),
            }, headline),
            note ? el('div', { class: 'note ' + tone, text: note }) : null,
            this.heroStats(open.length, todayAll.length),
        ]));
    },

    heroStats(openCount, todayCount) {
        const s = Money.monthSummary(thisMonth());
        const stats = [
            {
                hue: 'var(--accent)', ico: 'calendar', name: '今天',
                value: String(todayCount), unit: '件',
            },
            {
                hue: 'var(--good)', ico: 'todo', name: '待辦',
                value: String(openCount), unit: openCount ? '件沒做' : null,
            },
            {
                hue: 'var(--money)', ico: 'money', name: '這個月',
                value: money(s.net, true), unit: null,
                negative: s.net < 0,
            },
            {
                hue: 'var(--calendar)', ico: 'clock', name: '今天的課',
                value: String(Timetable.on(todayStr()).length), unit: '堂',
            },
            {
                hue: 'var(--memo)', ico: 'memo', name: '備忘',
                value: String(Memo.data.items.length), unit: '則',
            },
            {
                hue: 'var(--sleep)', ico: 'wall', name: '想法牆',
                value: String(Wall.data.notes.length), unit: '張',
            },
        ];

        return el('div', { class: 'stats' }, stats.map(x => el('div', {
            class: 'stat', style: `--hue:${x.hue}`,
        }, [
            el('div', { class: 'k' }, [icon(x.ico, 14), x.name]),
            el('div', { class: 'v' + (x.negative ? ' negative' : '') }, [
                x.value,
                x.unit ? el('span', { class: 'unit', text: x.unit }) : null,
            ]),
        ])));
    },

    /* ── 卡片 ──────────────────────────────────────── */

    /** 卡片標題：有顏色的圖示 + 名字，右邊放動作 */
    head(ico, title, action = null) {
        return el('h2', {}, [
            el('span', { class: 'label' }, [icon(ico), title]),
            action,
        ]);
    },

    /** 需要注意的事。沒有的話這張卡整個不出現。 */
    renderAttention(grid) {
        const items = [];

        const spent = new Map(Money.byCategory(thisMonth()).map(c => [c.category, c.amount]));
        for (const b of Money.data.budgets) {
            const used = spent.get(b.category) || 0;
            if (!b.limit) continue;
            if (used > b.limit) {
                if (b.category === this.heroSaid) continue;
                items.push(`${b.category}超出預算 ${money(used - b.limit)}`);
            } else if (used / b.limit > 0.85) {
                items.push(`${b.category}快到預算了，剩 ${money(b.limit - used)}`);
            }
        }

        const soon = Money.data.subscriptions
            .filter(s => s.active !== false)
            .map(s => ({ ...s, next: Money.nextCharge(s) }))
            .filter(s => {
                const days = (parseYmd(s.next) - parseYmd(todayStr())) / 86400000;
                return days >= 0 && days <= 3;
            });
        for (const s of soon) {
            items.push(`${s.name} ${relativeDay(s.next)}扣 ${money(s.amount)}`);
        }

        if (!items.length) return;

        grid.append(el('div', { class: 'card wide', 'data-hue': 'alert' }, [
            this.head('alert', '要注意的'),
            ...items.map(text => el('div', { style: 'padding:7px 0', text: '・' + text })),
        ]));
    },

    renderMoney(grid) {
        const s = Money.monthSummary(thisMonth());
        const top = Money.byCategory(thisMonth())[0];

        grid.append(el('div', { class: 'card', 'data-hue': 'money' }, [
            this.head('money', '這個月',
                el('button', { class: 'btn primary small', text: '記一筆', onclick: () => Money.editTxn(null) })),
            el('div', { class: 'big' + (s.net < 0 ? ' negative' : '') }, [money(s.net, true)]),
            el('div', { class: 'sub', text: `收 ${money(s.income)}　支 ${money(s.expense)}` }),
            top ? el('div', { class: 'sub', style: 'margin-top:12px',
                              text: `花最多的是${top.category}　${money(top.amount)}` })
                : null,
        ]));
    },

    /** 總覽上的「接下來」：今天和明天，行程和待辦混在一起。 */
    renderUpcoming(grid) {
        const today = todayStr();
        const tomorrow = ymd(new Date(Date.now() + 86400000));
        const rows = [];

        for (const day of [today, tomorrow]) {
            for (const e of Cal.on(day)) rows.push({ kind: 'event', day, item: e });
            for (const t of Todo.data.items.filter(x => !x.done && x.due === day)) {
                rows.push({ kind: 'todo', day, item: t });
            }
        }

        const open = Todo.open();

        grid.append(el('div', { class: 'card', 'data-hue': 'todo' }, [
            this.head('todo', '接下來',
                el('button', {
                    class: 'btn small', text: '加一件',
                    onclick: () => { showPanel('agenda'); Cal.edit(null); },
                })),
            rows.length
                ? el('div', {}, rows.slice(0, 6).map(r => r.kind === 'event'
                    ? el('div', { class: 'event-row compact', onclick: () => Cal.edit(r.item) }, [
                        el('div', { class: 'event-time', text: r.item.time || '整天' }),
                        el('div', { class: 'grow' }, [
                            el('div', { class: 'title ellipsis', text: r.item.title }),
                            el('div', { class: 'meta', text: relativeDay(r.day) }),
                        ]),
                    ])
                    : el('div', { class: 'todo-row' }, [
                        el('button', {
                            class: 'check', role: 'checkbox', 'aria-checked': 'false',
                            'aria-label': '標成完成',
                            onclick: () => { Todo.toggle(r.item); },
                        }),
                        el('div', { class: 'grow', style: 'cursor:pointer',
                                    onclick: () => { showPanel('agenda'); Todo.edit(r.item); } }, [
                            el('div', { class: 'title ellipsis', text: r.item.title }),
                            el('div', {
                                class: 'meta' + (r.day === today ? ' today' : ''),
                                text: relativeDay(r.day),
                            }),
                        ]),
                    ])))
                : el('div', { class: 'empty' }, [
                    icon('calendar', 26),
                    open.length ? '今明兩天沒有排定的事' : '還沒有行程或待辦',
                    el('div', { class: 'hint',
                                text: open.length ? `另外有 ${open.length} 件沒有期限的待辦`
                                                  : '行程和待辦會排在同一條線上' }),
                ]),
            rows.length > 6
                ? el('div', { class: 'sub', style: 'margin-top:10px', text: `還有 ${rows.length - 6} 件` })
                : null,
        ]));
    },

    renderMemo(grid) {
        const pinned = Memo.data.items.filter(m => m.pinned);
        const shown = (pinned.length ? pinned : Memo.sorted()).slice(0, 3);

        grid.append(el('div', { class: 'card', 'data-hue': 'memo' }, [
            this.head('memo', pinned.length ? '釘住的備忘' : '最近的備忘',
                el('button', { class: 'btn small', text: '新增',
                               onclick: () => { showPanel('memo'); Memo.edit(null); } })),
            shown.length
                ? el('div', {}, shown.map(m => el('div', {
                    class: 'memo-row', onclick: () => { showPanel('memo'); Memo.edit(m); },
                }, [
                    el('div', { class: 'grow' }, [
                        el('div', { class: 'memo-title ellipsis', text: Memo.titleOf(m.text) }),
                        Memo.previewOf(m.text)
                            ? el('div', { class: 'memo-preview ellipsis', text: Memo.previewOf(m.text) })
                            : null,
                    ]),
                ])))
                : el('div', { class: 'empty' }, [
                    icon('memo', 26),
                    '還沒有備忘',
                    el('div', { class: 'hint', text: '車位號碼、店員說的話、突然想到的事' }),
                ]),
        ]));
    },
};
