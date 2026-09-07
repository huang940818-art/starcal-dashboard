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
        /* **「要注意的」擺第一，因為它是整排寬的。**
         *
         * 它本來夾在天氣後面，而整排寬的卡片會把那一排切斷——
         * 電腦和平板上（三欄）天氣旁邊就空著兩格，最底下那張也一樣。
         * 那就是她說的「有地方空空的」。
         *
         * 排在第一還有一個好處：它叫「要注意的」，本來就不該排在天氣下面。
         * 這樣排完剛好是「整排寬的一排 ＋ 兩排各三張」，三欄二欄都填得滿。 */
        this.renderAttention(grid);
        this.renderWeather(grid);
        this.renderMoney(grid);
        this.renderToday(grid);
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
        // 走 budgetsFor 不是 data.budgets——後者現在同時放著「平常」和
        // 「某個月另外設的」兩種，直接讀會把同一個分類算兩次
        const over = Money.budgetsFor(thisMonth())
            .filter(b => Number(b.limit) > 0 && (spent.get(b.category) || 0) > b.limit)
            .map(b => ({ ...b, used: spent.get(b.category) || 0 }));
        const pace = Money.budgetPace(thisMonth());

        // 今天的課。**不算進「今天有幾件事」**——課表是每週固定的，
        // 每天四五堂加進去的話那個數字永遠是兩位數，「今天只有三件事」
        // 這個訊息就消失了。課單獨講一句，講的是「哪幾個時段被佔走了」。
        // 停掉的那幾堂不算——說「今天有 2 堂課」但其中一堂停了，
        // 那個數字就在騙人，而且是往「你今天很忙」的方向騙。
        const classes = Timetable.activeOn(todayStr());

        const empty = !Money.data.transactions.length && !open.length
            && !Cal.data.events.length && !Timetable.slots().length
            && !Memo.data.items.length && !Wall.data.notes.length;

        // 一次只講最要緊的那一件
        let headline, note = null, tone = '';
        // hero 講掉的那一條，下面「要注意的」就不要再講一次。
        // **要記在分支裡面**：光看 over.length 的話，hero 明明在講總額超支，
        // 卻會把分類那條也一起消音。
        let saidCategory = null, saidTotal = false;
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
        } else if (pace && pace.over) {
            // 總額超了排在單一分類前面：一類超支還可以從別類挪，
            // 總額超了就是真的沒有了。
            headline = ['這個月超出預算 ', em(money(pace.used - pace.limit))];
            tone = 'alert';
            note = pace.daysLeft > 0 ? `而且這個月還有 ${pace.daysLeft} 天` : null;
            saidTotal = true;
        } else if (over.length) {
            headline = [over[0].category, '超出預算 ', em(money(over[0].used - over[0].limit))];
            tone = 'alert';
            note = over.length > 1 ? `另外還有 ${over.length - 1} 類也超了` : null;
            saidCategory = over[0].category;
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

        this.heroSaid = saidCategory;
        this.heroSaidTotal = saidTotal;

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

    /** 切到「接下來」的某一個檢視。網址和分頁鈕都交給 showPanel 處理。 */
    goAgenda(view) {
        Agenda.view = view;
        showPanel('agenda');
    },

    heroStats(openCount, todayCount) {
        const s = Money.monthSummary(thisMonth());
        // **每一格都要有去處。** 底下那句「留一個點不進去的數字只會讓人
        // 找不到入口」講的是想法牆，但同一句話對整排都成立——
        // 一個看得到又進不去的數字，等於逼人自己去猜它住在哪一個分頁。
        const stats = [
            {
                hue: 'var(--accent)', ico: 'calendar', name: '今天',
                value: String(todayCount), unit: '件',
                go: () => this.goAgenda('timeline'),
            },
            {
                hue: 'var(--good)', ico: 'todo', name: '待辦',
                value: String(openCount), unit: openCount ? '件沒做' : null,
                go: () => this.goAgenda('timeline'),
            },
            {
                hue: 'var(--money)', ico: 'money', name: '這個月',
                value: money(s.net, true), unit: null,
                negative: s.net < 0,
                go: () => showPanel('money'),
            },
            {
                hue: 'var(--calendar)', ico: 'clock', name: '今天的課',
                value: String(Timetable.activeOn(todayStr()).length), unit: '堂',
                go: () => this.goAgenda('class'),
            },
            {
                hue: 'var(--memo)', ico: 'memo', name: '備忘',
                value: String(Memo.data.items.length), unit: '則',
                go: () => showPanel('memo'),
            },
            // 想法牆在窄螢幕上整個分頁是收起來的（見 app.js 的 WALL_MIN_WIDTH），
            // 這一格也跟著收——留一個點不進去的數字只會讓人找不到入口。
            wallUsable() ? {
                hue: 'var(--sleep)', ico: 'wall', name: '想法牆',
                value: String(Wall.data.notes.length), unit: '張',
                go: () => showPanel('wall'),
            } : null,
        ].filter(Boolean);

        // 用 <button> 不是 <div onclick>：鍵盤 Tab 進得去、Enter 按得動、
        // 螢幕報讀器會說「按鈕」。長相由 CSS 剝乾淨，看起來還是一格數字。
        return el('div', { class: 'stats' }, stats.map(x => el('button', {
            class: 'stat', type: 'button', style: `--hue:${x.hue}`,
            'aria-label': `${x.name} ${x.value}${x.unit || ''}`,
            onclick: x.go,
        }, [
            el('div', { class: 'k' }, [icon(x.ico, 14), x.name]),
            el('div', { class: 'v' + (x.negative ? ' negative' : '') }, [
                x.value,
                x.unit ? el('span', { class: 'unit', text: x.unit }) : null,
            ]),
        ])));
    },

    /* ── 今天的天氣 ────────────────────────────────────
     *
     * **抓不到就整張不畫。** 天氣是附加的東西，沒有網路的時候
     * 不該在畫面上留一塊「載入失敗」——那一格會變成每天都要看一次的雜訊。
     */
    renderWeather(grid) {
        const w = Weather.data;
        if (!w) return;

        const d = Weather.describe(w.code);
        const stamp = Weather.stampText();

        // 下半排的細節。缺的欄位就不寫，不要印「--」。
        const bits = [];
        if (w.high !== null && w.low !== null) bits.push(`${w.high}° / ${w.low}°`);
        if (w.rain !== null) bits.push(`降雨 ${w.rain}%`);
        if (w.feels !== null && w.feels !== w.now) bits.push(`體感 ${w.feels}°`);

        grid.append(el('div', { class: 'card', 'data-hue': 'calendar' }, [
            this.head(d.ico, '今天的天氣',
                Weather.usingDefault() && navigator.geolocation
                    ? el('button', {
                        class: 'btn small',
                        text: Weather.asking ? '定位中…' : '用我的位置',
                        disabled: Weather.asking,
                        onclick: () => Weather.useMyLocation(),
                    })
                    : null),
            el('div', { class: 'weather-now' }, [
                el('div', { class: 'weather-temp', text: `${w.now}°` }),
                el('div', { class: 'weather-word', text: d.text }),
            ]),
            bits.length ? el('div', { class: 'weather-bits', text: bits.join('　') }) : null,
            // **地名一定要寫出來。** 不寫的話，看的人會以為那是他自己所在地的天氣。
            el('div', { class: 'sub' }, [
                Weather.place.name,
                stamp ? el('span', { class: 'weather-stale', text: '　' + stamp }) : null,
            ]),
        ]));
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

        // 總預算排在分類前面：一類超支還可以從別類挪，總額超了就是沒有了。
        const pace = Money.budgetPace(thisMonth());
        if (pace && !this.heroSaidTotal) {
            if (pace.over) {
                items.push(`這個月總共超出預算 ${money(pace.used - pace.limit)}`
                    + (pace.daysLeft > 0 ? `，還有 ${pace.daysLeft} 天` : ''));
            } else if (pace.used / pace.limit > 0.85) {
                items.push(`總預算快到了，還有 ${money(pace.left)}`
                    + (pace.daysLeft > 0 ? `，要撐 ${pace.daysLeft} 天` : ''));
            }
        }

        const spent = new Map(Money.byCategory(thisMonth()).map(c => [c.category, c.amount]));
        for (const b of Money.budgetsFor(thisMonth())) {
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
            // 「記一筆」搬到旁邊那張「今天的收支」了——記帳記的就是今天，
            // 同一排放兩顆一模一樣的主要按鈕，等於兩顆都不重要。
            this.head('money', '這個月',
                el('button', { class: 'btn small ghost', text: '看報表',
                               onclick: () => showPanel('money') })),
            el('div', { class: 'big' + (s.net < 0 ? ' negative' : '') }, [money(s.net, true)]),
            el('div', { class: 'sub', text: `收 ${money(s.income)}　支 ${money(s.expense)}` }),
            top ? el('div', { class: 'sub', style: 'margin-top:12px',
                              text: `花最多的是${top.category}　${money(top.amount)}` })
                : null,
        ]));
    },

    /* ── 今天的收支 ────────────────────────────────────
     *
     * 總覽本來只有「這個月 −2,228」。那個數字回答不了
     * **「我今天花了多少」**——而那才是打開電腦時真的想知道的。
     * 月結要月底才有意義，今天的帳只有今天看得懂
     * （「那 155 是加油」隔一週就想不起來了）。
     *
     * 所以這張卡是明細不是總額：一筆一筆列出來，點得進去改。
     */
    renderToday(grid) {
        const rows = Money.onDay();
        const flow = Money.dayFlow();
        const pace = Money.budgetPace(thisMonth());
        const SHOWN = 6;

        // 「今天起每天可以用多少」在預算那張卡上也有，這裡再講一次是
        // 刻意的：她要決定「現在這一餐能不能吃」的時候人在總覽，
        // 不會為了這個數字切到記帳去。
        const paceLine = pace && !pace.over && pace.perDayLeft !== null
            ? `今天起每天可以用 ${money(pace.perDayLeft)}`
            : pace && pace.over
                ? `這個月的預算已經超出 ${money(pace.used - pace.limit)}`
                : null;

        const body = [];
        if (rows.length) {
            body.push(el('div', { class: 'today-flow' }, [
                el('div', {}, [
                    el('div', { class: 'sub', text: '支出' }),
                    el('div', { class: 'money-num today-num', text: money(flow.expense) }),
                ]),
                // 收入是 0 的日子佔絕大多數，寫出來只是每天看一次「0」
                flow.income
                    ? el('div', {}, [
                        el('div', { class: 'sub', text: '收入' }),
                        el('div', { class: 'money-num today-num income', text: money(flow.income) }),
                    ])
                    : null,
            ]));

            for (const t of rows.slice(0, SHOWN)) {
                const isIncome = t.kind === 'income';
                const isTransfer = t.kind === 'transfer';
                body.push(el('div', { class: 'txn-row', onclick: () => Money.editTxn(t) }, [
                    el('div', { class: 'grow' }, [
                        el('div', { class: 'ellipsis', text: t.note || t.category || '（沒有備註）' }),
                        // 這裡不寫日期——整張卡都是今天，寫了每一列都一樣
                        el('div', { class: 'sub ellipsis', text: isTransfer
                            ? `${t.account} → ${t.toAccount}`
                            : [t.category || '未分類', t.account].filter(Boolean).join('　') }),
                    ]),
                    el('div', {
                        class: 'money-num ' + (isIncome ? 'income' : ''),
                        text: isTransfer ? money(t.amount)
                                         : money(isIncome ? +t.amount : -t.amount, true),
                    }),
                ]));
            }

            if (rows.length > SHOWN) {
                body.push(el('div', { class: 'sub', style: 'margin-top:10px',
                                      text: `還有 ${rows.length - SHOWN} 筆` }));
            }
        } else {
            body.push(el('div', { class: 'empty' }, [
                icon('money', 26), '今天還沒有記帳',
                el('div', { class: 'hint', text: paceLine || '按右上角的「記一筆」' }),
            ]));
        }

        // 有帳目的時候才把額度掛在下面。空的時候它已經在提示裡了。
        if (rows.length && paceLine) {
            body.push(el('div', { class: 'sub pace-foot', text: paceLine }));
        }

        grid.append(el('div', { class: 'card', 'data-hue': 'money' }, [
            this.head('list', '今天的收支',
                el('button', { class: 'btn primary small', text: '記一筆',
                               onclick: () => Money.editTxn(null) })),
            ...body,
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
