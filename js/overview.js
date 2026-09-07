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
    /* ── 卡片的順序 ────────────────────────────────────
     *
     * **預設的順序是有理由的，但那是我的理由。**
     *
     * 「要注意的」擺第一，因為它是整排寬的——整排寬的卡片會把上一排
     * 切斷，夾在中間的話，前一排旁邊就空著兩格（她回報過「有地方空空的」）。
     * 排第一還剛好是「整排寬的一排 ＋ 兩排各三張」，三欄二欄都填得滿。
     *
     * 但「先看到什麼」是很個人的事。她問「我可以自主調整他們的順序嗎」，
     * 所以順序存在設定裡（不是 localStorage：電腦和手機該一樣），
     * 畫面上按「排順序」就能改。
     *
     * **名字寫死，順序才存得住。** 存的是這幾個 id，不是位置——
     * 位置會因為「今天沒有要注意的事」而整個位移。
     */
    CARDS: [
        { id: 'attention',   name: '要注意的', wide: true },
        { id: 'weather',     name: '今天的天氣' },
        { id: 'classes',     name: '今天的課' },
        { id: 'money',       name: '這個月' },
        { id: 'today',       name: '今天的收支' },
        { id: 'todaybudget', name: '今天的預算' },
        { id: 'balance',     name: '存款總額' },
        { id: 'spending',    name: '這個月花在哪' },
        { id: 'subs',        name: '訂閱' },
        { id: 'upcoming',    name: '接下來' },
        { id: 'memo',        name: '備忘' },
        // 想法牆只在寬螢幕有意義（見 app.js 的 WALL_MIN_WIDTH），
        // 窄螢幕上這張卡跟著整個分頁一起收起來。
        { id: 'wall',        name: '想法牆', wide: false },
        // 小克那塊預設放最後：它不是待辦事項，不該排在
        // 「現在需要注意什麼」前面。展示模式時它自己不會出現。
        { id: 'ke',          name: '小克' },
    ],

    /* 一開始就放上去的那幾張。
     *
     * **不是全部都預設放。** 十三張卡全部打開的話，總覽會變成一面牆，
     * 而這一頁只回答一件事：現在需要我注意什麼。所以預設是一組
     * 「大部分人每天都會看」的，其他的在排版裡自己開。
     */
    DEFAULT_ON: ['attention', 'weather', 'money', 'today', 'todaybudget',
                 'upcoming', 'memo', 'ke'],

    /** 現在排順序中 */
    arranging: false,
    /** 這一次有畫出來的卡片 id。render() 每次重算。 */
    shown: new Set(),

    /**
     * 存起來的順序套到預設清單上。
     *
     * **兩邊都要容錯**：存的裡面有已經不存在的 id（改版拿掉的卡）要忽略，
     * 預設裡有存的時候還沒有的（新加的卡）要接在後面——不然加一張新卡，
     * 用過排序的人就永遠看不到它。
     */
    orderedIds(saved) {
        const all = this.CARDS.map(c => c.id);
        const kept = (saved || []).filter(id => all.includes(id));
        return [...kept, ...all.filter(id => !kept.includes(id))];
    },

    savedOrder() { return this.orderedIds(Prefs.data?.overviewOrder); },

    /**
     * 現在放上去的是哪幾張。
     *
     * **存的是「關掉了哪幾張」，不是「開著哪幾張」。** 存開著的那些的話，
     * 之後加一張新卡，所有動過設定的人都不會看到它——除非他們自己想到
     * 要去排版裡找。存關掉的，新卡就會自己出現（要的人留著，不要的關掉，
     * 兩種人都只要動一次）。
     *
     * `null` 是「從來沒動過」，那時候用預設那一組；空陣列是
     * 「動過，而且一張都沒關」——這兩件事不一樣。
     */
    onSet() {
        const off = Prefs.data?.overviewOff;
        if (!Array.isArray(off)) {
            return new Set(this.DEFAULT_ON);
        }
        return new Set(this.CARDS.map(c => c.id).filter(id => !off.includes(id)));
    },

    isOn(id) { return this.onSet().has(id); },

    /** 開或關一張卡。 */
    toggleCard(id) {
        const on = this.onSet();
        on.has(id) ? on.delete(id) : on.add(id);
        Prefs.data.overviewOff = this.CARDS.map(c => c.id).filter(x => !on.has(x));
        Prefs.save();
        this.render();
    },

    render() {
        this.renderHero();

        const grid = $('#overview-grid');
        clear(grid);

        // 先把每一張畫進自己的小盒子，再照順序放上去。
        // 有些卡片沒東西就整張不畫（天氣抓不到、沒有要注意的事），
        // 那種情況它自己不會 append，這裡就跳過。
        const on = this.onSet();
        const drawn = new Map();
        for (const c of this.CARDS) {
            if (!on.has(c.id)) continue;      // 關掉的連畫都不用畫
            const box = el('div');
            this.renderCard(c.id, box);
            if (box.firstChild) drawn.set(c.id, box.firstChild);
        }

        // 這次真的有畫出來的是哪幾張。排順序時的上下鄰居要照這個算，
        // 不是照完整清單。
        this.shown = new Set(drawn.keys());

        for (const id of this.savedOrder()) {
            const node = drawn.get(id);
            if (!node) continue;
            grid.append(this.arranging ? this.wrapForArrange(id, node) : node);
        }

        // 排版的時候，關掉的那幾張列在最下面——**看不到的東西沒辦法被打開**，
        // 沒有這一排的話，關掉一張卡就等於永遠關掉了。
        if (this.arranging) this.renderOffShelf(grid);
    },

    /** 排版模式最下面那一排「還沒放上去的」 */
    renderOffShelf(grid) {
        const on = this.onSet();
        const off = this.CARDS.filter(c => !on.has(c.id));
        // 想法牆在窄螢幕上整個分頁都是收起來的，這裡也不該給
        const usable = off.filter(c => c.id !== 'wall' || wallUsable());

        grid.append(el('div', { class: 'card wide off-shelf', 'data-hue': 'todo' }, [
            el('h2', {}, [el('span', { class: 'label' }, [icon('wall'), '還沒放上去的'])]),
            usable.length
                ? el('div', { class: 'chips' }, usable.map(c => el('button', {
                    type: 'button', class: 'chip', text: '＋ ' + c.name,
                    onclick: () => this.toggleCard(c.id),
                })))
                : el('p', { class: 'sub', style: 'margin:0',
                            text: '全部都放上去了。用每張卡上的 ✕ 可以拿掉。' }),
        ]));
    },

    renderCard(id, box) {
        if (id === 'attention') return this.renderAttention(box);
        if (id === 'weather') return this.renderWeather(box);
        if (id === 'money') return this.renderMoney(box);
        if (id === 'today') return this.renderToday(box);
        if (id === 'todaybudget') return this.renderTodayBudget(box);
        if (id === 'upcoming') return this.renderUpcoming(box);
        if (id === 'memo') return this.renderMemo(box);
        if (id === 'classes') return this.renderClasses(box);
        if (id === 'balance') return this.renderBalance(box);
        if (id === 'spending') return this.renderSpending(box);
        if (id === 'subs') return this.renderSubs(box);
        if (id === 'wall') return this.renderWall(box);
        if (id === 'ke') return Ke.render(box);
    },

    /* ── 排順序 ────────────────────────────────────────
     *
     * **平常不要有箭頭。** 七張卡各掛兩顆按鈕，等於每天都在看一組
     * 只有偶爾才用得到的東西。所以做成一個模式：按「排順序」才出現，
     * 排完按「好了」收起來。
     *
     * 用上下箭頭不用拖曳：拖曳在手機上要長按、要捲動，
     * 而這件事一輩子做不到五次。
     */
    toggleArrange() {
        this.arranging = !this.arranging;
        this.render();
        this.syncArrangeButton();
    },

    syncArrangeButton() {
        const b = $('#arrange-cards');
        if (!b) return;
        b.textContent = this.arranging ? '好了' : '排版';
        b.classList.toggle('primary', this.arranging);
        b.setAttribute('aria-pressed', String(this.arranging));
    },

    /** 把一張卡包起來，上面加一條「上／下」的工具列 */
    wrapForArrange(id, node) {
        const card = this.CARDS.find(c => c.id === id);
        const order = this.savedOrder().filter(x => this.shown.has(x));
        const at = order.indexOf(id);

        const wrap = el('div', { class: 'arrange' + (card?.wide ? ' wide' : '') }, [
            el('div', { class: 'arrange-bar' }, [
                el('span', { class: 'arrange-name', text: card?.name || id }),
                el('button', {
                    class: 'btn small ghost', type: 'button', text: '↑',
                    'aria-label': `${card?.name} 往前`,
                    disabled: at <= 0,
                    onclick: () => this.move(id, -1),
                }),
                el('button', {
                    class: 'btn small ghost', type: 'button', text: '↓',
                    'aria-label': `${card?.name} 往後`,
                    disabled: at < 0 || at >= order.length - 1,
                    onclick: () => this.move(id, 1),
                }),
                el('button', {
                    class: 'btn small ghost', type: 'button', text: '✕',
                    'aria-label': `把${card?.name}拿掉`,
                    title: '從總覽拿掉（之後可以再加回來）',
                    onclick: () => this.toggleCard(id),
                }),
            ]),
            node,
        ]);
        return wrap;
    },

    /**
     * 往前或往後一格。
     *
     * **只在「這次有出現的卡片」之間換位置。** 照完整清單換的話，
     * 按一下箭頭可能跟一張今天沒出現的卡對調——畫面上什麼事都沒發生，
     * 看起來就像按鈕壞了。
     */
    move(id, delta) {
        const full = this.savedOrder();
        const visible = full.filter(x => this.shown.has(x));
        const at = visible.indexOf(id);
        const to = at + delta;
        if (at < 0 || to < 0 || to >= visible.length) return;

        // 在「看得見的那幾張」裡跟鄰居對調，再把結果寫回完整清單裡
        // 它們各自原本的位置上。
        const other = visible[to];
        const swapped = full.map(x => x === id ? other : x === other ? id : x);

        Prefs.data.overviewOrder = swapped;
        Prefs.save();
        this.render();
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

    /* ── 可以自己開關的那幾張 ──────────────────────────
     *
     * 她說「把所有可能會在意的卡片都做出來，讓用戶決定要不要放」。
     * 下面這幾張都是**既有資料的另一種看法**，不是新功能——
     * 每一張都要能回答一個具體的問題，答不出來的就不該做成卡片。
     */

    /** 今天的課。hero 那句只講「幾堂、幾點到幾點」，這張講「哪幾堂、在哪」。 */
    renderClasses(grid) {
        const list = Timetable.activeOn(todayStr());

        grid.append(el('div', { class: 'card', 'data-hue': 'calendar' }, [
            this.head('clock', '今天的課',
                el('button', { class: 'btn small ghost', text: '看課表',
                               onclick: () => this.goAgenda('class') })),
            list.length
                ? el('div', {}, list.map(c => el('div', { class: 'event-row compact' }, [
                    // 節次沒設時間就寫節次。**不要生一個「–」出來假裝有時間**
                    el('div', { class: 'event-time', text: Timetable.startOf(c)
                        ? `${Timetable.startOf(c)}` : Timetable.whenText(c) }),
                    el('div', { class: 'grow' }, [
                        el('div', { class: 'title ellipsis', text: c.name }),
                        el('div', { class: 'meta ellipsis',
                                    text: [c.place, c.teacher].filter(Boolean).join('　') }),
                    ]),
                ])))
                : el('div', { class: 'empty' }, [
                    icon('clock', 26), '今天沒有課',
                ]),
        ]));
    },

    /** 存款總額。**遮金額那個開關要一起吃**，不然遮了記帳頁卻在總覽上大字寫出來。 */
    renderBalance(grid) {
        const accounts = Money.data.accounts;

        grid.append(el('div', { class: 'card', 'data-hue': 'money' }, [
            this.head('wallet', '存款總額',
                el('button', { class: 'btn small ghost', text: '看記帳',
                               onclick: () => showPanel('money') })),
            accounts.length
                ? el('div', {}, [
                    el('div', { class: 'big money-num' + (Money.hideBalance ? ' masked' : ''),
                                text: Money.secret(Money.total()) }),
                    el('div', { class: 'sub', text: '算進總額的帳戶合計' }),
                    Money.hasSavings()
                        ? el('div', { class: 'split-row' }, [
                            el('div', {}, [
                                el('div', { class: 'sub', text: '可以花的' }),
                                el('div', { class: 'money-num' + (Money.hideBalance ? ' masked' : ''),
                                            text: Money.secret(Money.spendable()) }),
                            ]),
                            el('div', {}, [
                                el('div', { class: 'sub', text: '存起來的' }),
                                el('div', { class: 'money-num' + (Money.hideBalance ? ' masked' : ' saved'),
                                            text: Money.secret(Money.saved()) }),
                            ]),
                        ])
                        : null,
                ])
                // 沒有帳戶不等於存款是零，那是兩件事
                : el('div', { class: 'empty' }, [
                    icon('wallet', 26), '還沒有帳戶',
                    el('div', { class: 'hint', text: '在記帳那頁加一個，帳目才有地方去' }),
                ]),
        ]));
    },

    /** 這個月花在哪。前五名加一條比例，回答「錢跑去哪了」。 */
    renderSpending(grid) {
        const rows = Money.byCategory(thisMonth());
        const total = rows.reduce((s, r) => s + r.amount, 0);
        const shown = rows.slice(0, 5);

        grid.append(el('div', { class: 'card', 'data-hue': 'money' }, [
            this.head('list', '這個月花在哪',
                el('button', { class: 'btn small ghost', text: '看報表',
                               onclick: () => showPanel('money') })),
            shown.length
                ? el('div', {}, shown.map(r => el('div', { class: 'quota-row' }, [
                    el('span', { class: 'dot', style: `background:${Money.colorOf(r.category)}` }),
                    el('span', { class: 'grow ellipsis', text: r.category }),
                    el('span', { class: 'sub', text: `${Math.round(r.amount / total * 100)}%` }),
                    el('span', { class: 'money-num', text: money(r.amount) }),
                ])))
                : el('div', { class: 'empty' }, [
                    icon('money', 26), '這個月還沒有支出',
                ]),
            rows.length > shown.length
                ? el('div', { class: 'sub', style: 'margin-top:8px',
                              text: `還有 ${rows.length - shown.length} 類` })
                : null,
        ]));
    },

    /** 接下來要扣的訂閱。**只看往後 30 天**——再遠的現在提醒沒有用。 */
    renderSubs(grid) {
        const soon = Money.data.subscriptions
            .filter(s => s.active !== false)
            .map(s => ({ ...s, next: Money.nextCharge(s) }))
            .filter(s => (parseYmd(s.next) - parseYmd(todayStr())) / 86400000 <= 30)
            .sort((a, b) => a.next.localeCompare(b.next));

        grid.append(el('div', { class: 'card', 'data-hue': 'sub' }, [
            this.head('sub', '訂閱',
                el('button', { class: 'btn small ghost', text: '管理',
                               onclick: () => showPanel('money') })),
            soon.length
                ? el('div', {}, soon.slice(0, 5).map(s => el('div', { class: 'quota-row' }, [
                    el('span', { class: 'grow ellipsis', text: s.name }),
                    el('span', { class: 'sub', text: relativeDay(s.next) }),
                    el('span', { class: 'money-num', text: money(s.amount) }),
                ])))
                : el('div', { class: 'empty' }, [
                    icon('sub', 26), '接下來 30 天沒有要扣的',
                ]),
        ]));
    },

    /** 想法牆最近幾張。**窄螢幕不給**——跟分頁本身同一條規矩。 */
    renderWall(grid) {
        if (!wallUsable()) return;
        const notes = [...Wall.data.notes].slice(-4).reverse();

        grid.append(el('div', { class: 'card', 'data-hue': 'wall' }, [
            this.head('wall', '想法牆',
                el('button', { class: 'btn small ghost', text: '打開',
                               onclick: () => showPanel('wall') })),
            notes.length
                ? el('div', {}, notes.map(n => el('div', {
                    class: 'memo-row', onclick: () => showPanel('wall'),
                }, [
                    el('span', { class: 'dot', style: `background:${n.color || 'var(--sleep)'}` }),
                    el('div', { class: 'grow ellipsis',
                                text: (n.text || '').split('\n')[0] || '（空白）' }),
                ])))
                : el('div', { class: 'empty' }, [
                    icon('wall', 26), '牆上還沒有便利貼',
                ]),
        ]));
    },

    /* ── 今天的天氣 ────────────────────────────────────
     *
     * **抓不到就整張不畫。** 天氣是附加的東西，沒有網路的時候
     * 不該在畫面上留一塊「載入失敗」——那一格會變成每天都要看一次的雜訊。
     */
    renderWeather(grid) {
        const w = Weather.data;

        /* **「不知道你在哪裡」跟「抓不到天氣」是兩件事。**
         *
         * 抓不到天氣就整張不畫，那是刻意的：一塊常駐的「載入失敗」
         * 會變成每天都要看一次的雜訊，而它什麼忙也幫不上。
         *
         * 但不知道地點需要一個動作，**而唯一的入口就在這張卡上**——
         * 不畫的話，時區猜不出城市的人（UTC、Etc/GMT+8、把時區設成
         * UTC 的隱私瀏覽器）就永遠沒有天氣，而且不知道為什麼。 */
        if (!Weather.place) {
            grid.append(el('div', { class: 'card', 'data-hue': 'calendar' }, [
                this.head('cloud', '今天的天氣',
                    el('button', {
                        class: 'btn small', text: '選地點',
                        onclick: () => Weather.openPicker(),
                    })),
                el('div', { class: 'empty' }, [
                    icon('cloud', 26), '還不知道你在哪裡',
                    el('div', { class: 'hint',
                                text: '從你的時區猜不出來。按右上角挑一個地方。' }),
                ]),
            ]));
            return;
        }

        if (!w) return;

        const d = Weather.describe(w.code);
        const stamp = Weather.stampText();

        // 下半排的細節。缺的欄位就不寫，不要印「--」。
        const bits = [];
        if (w.high !== null && w.low !== null) bits.push(`${w.high}° / ${w.low}°`);
        if (w.rain !== null) bits.push(`降雨 ${w.rain}%`);
        if (w.feels !== null && w.feels !== w.now) bits.push(`體感 ${w.feels}°`);

        grid.append(el('div', { class: 'card', 'data-hue': 'calendar' }, [
            // **一顆按鈕，兩條路。** 本來這裡是「用我的位置」，但那個在
            // http 的網址上（手機看本機那份就是）根本不會動，按了沒反應。
            // 改成開一個視窗：裡面可以用打的，也可以用定位。
            this.head(d.ico, '今天的天氣',
                el('button', {
                    class: 'btn small' + (Weather.usingDefault() ? '' : ' ghost'),
                    text: Weather.asking ? '定位中…' : '改地點',
                    disabled: Weather.asking,
                    onclick: () => Weather.openPicker(),
                })),
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

    /**
     * 一列額度右邊要寫什麼。
     *
     * **「0 / 0」是壞掉的長相。** 那發生在「這一類這個月已經超支，
     * 所以今天推算出來沒有額度」——那是一句話，不是一個分數。
     */
    quotaValue(q) {
        if (q.source === 'month' && q.limit <= 0) {
            return el('span', { class: 'sub', text: '這個月的額度用完了' });
        }
        return el('span', {
            class: 'money-num' + (q.left < 0 ? ' negative' : ''),
            text: `${money(q.spent)} / ${money(q.limit)}`,
        });
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
        const SHOWN = 6;
        // 額度不寫在這裡——旁邊「今天的預算」那張卡整張都在講它。
        // 同一個數字在同一頁講兩次，兩次都會被當成背景。

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
                el('div', { class: 'hint', text: '按右上角的「記一筆」' }),
            ]));
        }

        /* ── 今天的額度 ──
         *
         * 她的原話：「我希望可以放在今日收支，比如支出食物 155/300 這種的」。
         *
         * 「花了 155」自己回答不了「還能不能再吃一餐」，要旁邊那個 300
         * 才行。所以額度就貼在明細下面，不用切到別的地方。
         */
        const quotas = Money.todayQuotas();
        const totalQ = Money.todayTotalQuota();
        if (quotas.length || totalQ) {
            body.push(el('div', { class: 'quota has-total' }, [
                totalQ ? el('div', { class: 'quota-row strong' }, [
                    el('span', { class: 'grow', text: '今天總共' }),
                    el('span', {
                        class: 'money-num' + (totalQ.left < 0 ? ' negative' : ''),
                        text: `${money(totalQ.spent)} / ${money(totalQ.limit)}`,
                    }),
                ]) : null,
                ...quotas.map(q => el('div', { class: 'quota-row' }, [
                    el('span', { class: 'dot', style: `background:${Money.colorOf(q.category)}` }),
                    el('span', { class: 'grow ellipsis', text: q.category }),
                    // **要看得出這個額度是她定的還是我算的。** 兩個長得一樣的
                    // 數字，一個是決定一個是推算，分不出來就沒辦法信任任何一個。
                    q.source === 'month'
                        ? el('span', { class: 'sub tiny', text: '照月預算' })
                        : null,
                    this.quotaValue(q),
                ])),
            ]));
        }

        grid.append(el('div', { class: 'card', 'data-hue': 'money' }, [
            this.head('list', '今天的收支',
                el('button', { class: 'btn primary small', text: '記一筆',
                               onclick: () => Money.editTxn(null) })),
            ...body,
        ]));
    },

    /* ── 今天的預算 ────────────────────────────────────
     *
     * 她說「今天預算可以放總覽」。
     *
     * 記帳那頁的預算卡回答的是「這個月」——月初看它很寬裕，月底才發現
     * 早就爆了。**站在超商前面要的是「今天還能花多少」**，而那個數字
     * 本來要切到記帳頁才看得到。
     *
     * 分類**照分類清單的固定順序**排，不照「今天超支的排前面」——
     * 順序每天跳動的話，每天都要重新找一次「吃的在哪一行」。
     * 要注意的那幾個用紅色抓眼睛，位置不動。
     */
    renderTodayBudget(grid) {
        const ym = thisMonth();
        const pace = Money.budgetPace(ym);
        // 自己定的每日額度優先，沒定的才拿月預算推——跟「今天的收支」
        // 那張同一套，兩張卡不該給出兩個不一樣的數字。
        const quotas = Money.todayQuotas();
        const totalQ = Money.todayTotalQuota();

        const head = this.head('budget', '今天的預算',
            el('button', {
                class: 'btn small ghost', text: '設定',
                onclick: () => { showPanel('money'); Money.editBudgets(); },
            }));

        if (!totalQ && !quotas.length) {
            grid.append(el('div', { class: 'card', 'data-hue': 'budget' }, [
                head,
                el('div', { class: 'empty' }, [
                    icon('budget', 26), '還沒設預算',
                    el('div', { class: 'hint',
                                text: '設一個總額，這裡就會寫「今天可以用多少」' }),
                ]),
            ]));
            return;
        }

        const body = [];

        if (totalQ) {
            // 這個月的總額已經沒了的話，「今天還能花多少」是騙人的
            if (pace && pace.over && totalQ.source === 'month') {
                // 這個月的總額已經沒了。**不要印一個「今天可以用 0」**，
                // 那看起來像算壞了，而且它要講的是一句話不是一個數字。
                body.push(
                    el('div', { class: 'pace-word', text: '這個月的額度用完了' }),
                    el('div', { class: 'sub', style: 'margin-top:4px',
                        text: `超出 ${money(pace.used - pace.limit)}`
                            + (pace.daysLeft > 0 ? `，還有 ${pace.daysLeft} 天` : '') }));
            } else {
                const ratio = totalQ.limit ? totalQ.spent / totalQ.limit : 0;
                body.push(
                    el('div', { class: 'big money-num' + (totalQ.left < 0 ? ' negative' : ''),
                                text: money(totalQ.left) }),
                    el('div', { class: 'sub', text: (totalQ.left < 0 ? '今天超出了　' : '今天還可以花　')
                        + `${money(totalQ.spent)} / ${money(totalQ.limit)}`
                        + (totalQ.source === 'month' ? '（照月預算算的）' : '') }),
                    el('div', { class: 'track', style: 'margin-top:12px' }, [
                        el('div', {
                            class: 'fill' + (ratio > 1 ? ' over' : ratio > 0.8 ? ' warn' : ''),
                            style: `width:${Math.min(ratio, 1) * 100}%`,
                        }),
                    ]));
            }
        }

        if (quotas.length) {
            const shown = quotas.slice(0, 6);
            body.push(el('div', { class: 'quota' + (totalQ ? ' has-total' : '') },
                shown.map(q => el('div', { class: 'quota-row' }, [
                    el('span', { class: 'dot', style: `background:${Money.colorOf(q.category)}` }),
                    el('span', { class: 'grow ellipsis', text: q.category }),
                    q.source === 'month' ? el('span', { class: 'sub tiny', text: '照月預算' }) : null,
                    this.quotaValue(q),
                ]))));
            if (quotas.length > shown.length) {
                body.push(el('div', { class: 'sub', style: 'margin-top:8px',
                    text: `還有 ${quotas.length - shown.length} 類` }));
            }
        }

        grid.append(el('div', { class: 'card', 'data-hue': 'budget' }, [head, ...body]));
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
