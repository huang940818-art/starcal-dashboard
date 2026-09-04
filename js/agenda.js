/* 接下來：行程和待辦排在同一條線上。
 *
 * 為什麼不做成月曆：月曆格子只有在行程密集的時候才有用。
 * 行程不密集的話，一個空的月曆每次打開都在說「你什麼都沒有」——
 * 那會變成另一個讓人覺得自己沒做好的東西。
 *
 * 為什麼行程和待辦要混在一起：**它們是同一件事的兩個面向。**
 * 「明天要交回函」和「明天下午開會」都是明天要處理的事，
 * 分成兩個分頁看，就得自己在腦子裡合併——而那正是最容易漏掉東西的地方。
 *
 * 這條線真正要解決的問題：事情捆成一團的時候，人會高估它的量。
 * 按時間排開之後，「今天其實只有三件事」是看得見的。
 */

const Cal = {
    data: null,

    async init() {
        this.data = await Store.load('行事曆');
        this.data.events ??= [];
    },

    save() { Store.save('行事曆'); },

    /** 某一天的行程，有時間的排前面 */
    on(day) {
        return this.data.events
            .filter(e => e.date === day)
            .sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
    },

    edit(e, defaultDay = null) {
        const isNew = !e;
        e = e || { id: uid(), date: defaultDay || todayStr(), time: '', endTime: '',
                   title: '', note: '', label: null };

        $('#dlg-event-title').textContent = isNew ? '加行程' : '改行程';
        $('#e-title').value = e.title;
        $('#e-date').value = e.date;
        $('#e-time').value = e.time || '';
        $('#e-end').value = e.endTime || '';
        $('#e-note').value = e.note || '';
        Prefs.fillSelect($('#e-label'), e.label);
        $('#e-delete').hidden = isNew;

        const dlg = openDialog('#dlg-event');

        $('#e-save').onclick = () => {
            const title = $('#e-title').value.trim();
            if (!title) return toast('這是什麼行程？', true);

            const time = $('#e-time').value;
            const endTime = $('#e-end').value;
            if (time && endTime && endTime < time) return toast('結束時間比開始還早', true);

            Object.assign(e, {
                title,
                date: $('#e-date').value || todayStr(),
                time, endTime,
                note: $('#e-note').value.trim(),
                label: $('#e-label').value || null,
            });
            if (isNew) this.data.events.push(e);
            this.save();
            dlg.close();
            Agenda.render();
            Overview.render();
        };

        $('#e-delete').onclick = () => {
            this.data.events = this.data.events.filter(x => x.id !== e.id);
            this.save();
            dlg.close();
            Agenda.render();
            Overview.render();
        };
    },
};


const Agenda = {
    /** 往後看幾天。再遠的都算「之後」，列出來只會讓這條線變長。 */
    DAYS: 14,

    /** 'timeline' | 'month' | 'class' —— 預設永遠是時間線。
     *
     *  月曆和課表是「這個月／這週長什麼樣」，時間線是「接下來要做什麼」。
     *  一打開先回答後者：那才是打開這個分頁的原因。 */
    view: 'timeline',

    /** 只看某一個分類。null ＝ 全部。 */
    filter: null,

    async init() {
        $('#add-event').onclick = () => Cal.edit(null);
        $('#add-todo').onclick = () => Todo.edit(null);
        $('#clear-done').onclick = () => Todo.clearDone();
        $('#manage-labels').onclick = () => Prefs.openLabels();
        MonthView.init();
    },

    /** 分類篩選套在這裡，三個檢視就自動一起被篩到——
     *  各自篩一次的話，遲早有一個會漏掉。 */
    match(x) {
        return !this.filter || x.label === this.filter;
    },

    eventsOn(day) { return Cal.on(day).filter(e => this.match(e)); },

    todosOn(day) {
        return Todo.data.items.filter(t => !t.done && t.due === day && this.match(t));
    },

    /** 上面那一排：看哪一種、只看哪一類。 */
    tools() {
        const box = $('#agenda-tools');
        clear(box);

        const views = [
            { k: 'timeline', name: '時間線', ico: 'todo' },
            { k: 'month', name: '月曆', ico: 'calendar' },
            { k: 'class', name: '課表', ico: 'clock' },
        ];
        box.append(el('div', { class: 'view-switch', role: 'tablist' },
            views.map(v => el('button', {
                type: 'button', role: 'tab',
                class: 'view-btn' + (this.view === v.k ? ' on' : ''),
                'aria-selected': String(this.view === v.k),
                onclick: () => { this.view = v.k; this.render(); },
            }, [icon(v.ico, 15), v.name]))));

        // 分類列。一個分類都沒有的時候整條不出現——
        // 空的篩選列只是在佔位置。
        const labels = Prefs.labels();
        const chips = el('div', { class: 'chips' });
        if (labels.length) {
            chips.append(el('button', {
                type: 'button',
                class: 'chip' + (this.filter ? '' : ' on'),
                text: '全部',
                onclick: () => { this.filter = null; this.render(); },
            }));
            for (const l of labels) {
                chips.append(el('button', {
                    type: 'button',
                    class: 'chip' + (this.filter === l.id ? ' on' : ''),
                    style: `--chip:${l.color}`,
                    onclick: () => {
                        // 再按一次取消，不用另外找「清除」在哪
                        this.filter = this.filter === l.id ? null : l.id;
                        this.render();
                    },
                }, [el('span', { class: 'label-dot', style: `background:${l.color}` }), l.name]));
            }
        }
        chips.append(el('button', {
            type: 'button', class: 'chip ghost', id: 'manage-labels-btn',
            text: labels.length ? '管理分類' : '設定分類',
            onclick: () => Prefs.openLabels(),
        }));
        box.append(chips);
    },

    /**
     * 一條線上的一格：某一天有哪些事。
     * 回傳 [{day, events, todos}]，只含真的有東西的那幾天。
     */
    days() {
        const out = [];
        const start = parseYmd(todayStr());
        for (let i = 0; i < this.DAYS; i++) {
            const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
            const day = ymd(d);
            const events = this.eventsOn(day);
            const todos = this.todosOn(day);
            const classes = Timetable.on(day).filter(c => this.match(c));
            if (events.length || todos.length || classes.length) {
                out.push({ day, todos, timed: this.mergeTimed(events, classes) });
            }
        }
        return out;
    },

    /**
     * 課和行程排在同一條時間軸上。
     *
     * **一定要混排，不能課一批、行程一批接起來。** 分批的話 9:30 的考試
     * 會排在 13:20 的課後面——這條線唯一的用途就是「照時間讀」，
     * 順序錯了它連清單都不如。
     *
     * 沒有時間的（整天的行程）排最後，跟 Cal.on 的規則一致。
     */
    mergeTimed(events, classes) {
        return [
            ...events.map(e => ({ kind: 'event', t: e.time || '', item: e })),
            ...classes.map(c => ({ kind: 'class', t: c.start || '', item: c })),
        ].sort((a, b) => (a.t || '99:99').localeCompare(b.t || '99:99'));
    },

    /** 視野的最後一天。超過這天的東西要另外列，不能讓它們消失。 */
    horizon() {
        const d = parseYmd(todayStr());
        return ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + this.DAYS - 1));
    },

    /**
     * 超過 14 天視野的行程和待辦。
     *
     * **這一段是後來補的，因為少了它會出大事**：東西存進去了、資料也在，
     * 但畫面上完全看不到——使用者會以為存檔失敗，或者以為刪不掉
     * （點不到的東西當然刪不掉）。看不到比壞掉更糟，因為壞掉至少會報錯。
     *
     * 不併進上面那條時間線，是因為時間線要維持「接下來這兩週」的密度；
     * 更遠的東西列出來就好，日期直接寫在每一列上。
     */
    later() {
        const h = this.horizon();
        const events = Cal.data.events
            .filter(e => e.date > h && this.match(e))
            .map(e => ({ kind: 'event', day: e.date, item: e }));
        const todos = Todo.data.items
            .filter(t => !t.done && t.due && t.due > h && this.match(t))
            .map(t => ({ kind: 'todo', day: t.due, item: t }));
        return [...events, ...todos].sort((a, b) =>
            a.day.localeCompare(b.day)
            || (a.kind === 'event' ? -1 : 1));
    },

    /**
     * 已經過去但還沒處理的。這些要排在最前面，不然會一直被往下推。
     *
     * @param all  true ＝ 不套用分類篩選。
     *             總覽要用 true：**總覽是全貌，不該被別的分頁上的篩選改掉。**
     *             在「接下來」按了「只看學校」之後回總覽，看到「有 2 件過期」
     *             而實際上有 5 件——那是最糟的一種錯，因為它看起來是對的。
     */
    overdue(all = false) {
        const today = todayStr();
        const ok = x => all || this.match(x);
        return {
            events: Cal.data.events.filter(e => e.date < today && ok(e))
                .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10),
            todos: Todo.data.items.filter(t => !t.done && t.due && t.due < today && ok(t))
                .sort((a, b) => a.due.localeCompare(b.due)),
        };
    },

    /** 分頁的總入口：畫工具列，然後把場子交給選中的那個檢視。 */
    render() {
        if ($('#panel-agenda').hidden) return;
        this.tools();

        $('#agenda-list').hidden = this.view !== 'timeline';
        $('#calendar').hidden = this.view !== 'month';
        $('#timetable').hidden = this.view !== 'class';

        if (this.view === 'timeline') this.renderTimeline();
        else if (this.view === 'month') MonthView.render();
        else Timetable.render();
    },

    renderTimeline() {
        const box = $('#agenda-list');
        clear(box);

        const late = this.overdue();
        const upcoming = this.days();
        const later = this.later();
        const someday = Todo.open().filter(t => !t.due && this.match(t));
        const done = Todo.data.items.filter(t => t.done && this.match(t))
            .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

        if (!late.todos.length && !late.events.length && !upcoming.length
            && !later.length && !someday.length && !done.length) {
            box.append(el('div', { class: 'empty' }, [
                icon('todo', 26),
                this.filter ? '這個分類接下來沒有事' : '接下來沒有事',
                el('div', { class: 'hint', text: this.filter
                    ? '按上面的「全部」看其他分類'
                    : '加一個行程或一件待辦，它們會排在同一條線上' }),
            ]));
            return;
        }

        // 過期的
        if (late.todos.length || late.events.length) {
            box.append(el('div', { class: 'day-group overdue-group' }, [
                el('div', { class: 'day-head' }, [
                    el('span', { class: 'day-name alert', text: '過期了' }),
                    el('span', { class: 'day-count', text: `${late.todos.length + late.events.length} 件` }),
                ]),
                ...late.events.map(e => this.eventRow(e, true)),
                ...late.todos.map(t => Todo.row(t)),
            ]));
        }

        // 接下來幾天
        for (const { day, timed, todos } of upcoming) {
            const isToday = day === todayStr();
            box.append(el('div', { class: 'day-group' + (isToday ? ' today' : '') }, [
                el('div', { class: 'day-head' }, [
                    el('span', { class: 'day-name' + (isToday ? ' now' : ''), text: relativeDay(day) }),
                    el('span', { class: 'day-count', text: this.dayLabel(day) }),
                ]),
                ...timed.map(r => r.kind === 'class'
                    ? this.classRow(r.item)
                    : this.eventRow(r.item)),
                ...todos.map(t => Todo.row(t)),
            ]));
        }

        if (!upcoming.length && !late.todos.length && !late.events.length) {
            box.append(el('div', { class: 'empty' }, [
                icon('todo', 24), '接下來這兩週沒有排定的事',
            ]));
        }

        // 兩週之後的。每一列自己寫日期，因為「三天後」那種說法在這裡沒有意義。
        if (later.length) {
            box.append(el('div', { class: 'day-group' }, [
                el('div', { class: 'day-head' }, [
                    el('span', { class: 'day-name', text: '更遠' }),
                    el('span', { class: 'day-count', text: `${later.length} 件` }),
                ]),
                ...later.map(r => r.kind === 'event'
                    ? this.eventRow(r.item, false, true)
                    : Todo.row(r.item, true)),
            ]));
        }

        // 沒有期限的
        if (someday.length) {
            box.append(el('div', { class: 'day-group muted' }, [
                el('div', { class: 'day-head' }, [
                    el('span', { class: 'day-name', text: '之後再說' }),
                    el('span', { class: 'day-count', text: `${someday.length} 件` }),
                ]),
                ...someday.map(t => Todo.row(t)),
            ]));
        }

        if (done.length) {
            box.append(el('div', { class: 'day-group muted' }, [
                el('div', { class: 'day-head' }, [
                    el('span', { class: 'day-name', text: '完成的' }),
                    el('span', { class: 'day-count', text: `${done.length} 件` }),
                ]),
                ...done.slice(0, 15).map(t => Todo.row(t)),
            ]));
        }
    },

    /** 日期那一行右邊的小字：幾月幾號星期幾 */
    dayLabel(day) {
        const d = parseYmd(day);
        return `${d.getMonth() + 1}/${d.getDate()}　`
            + '日一二三四五六'[d.getDay()].replace(/^/, '週');
    },

    eventRow(e, late = false, showDate = false) {
        // 在「更遠」那一區，左欄要放日期不是時間——那邊沒有按日期分組
        const time = showDate
            ? this.dayLabel(e.date).split('　')[0]
            : (e.time ? (e.endTime ? `${e.time}–${e.endTime}` : e.time) : '整天');

        return el('div', {
            class: 'event-row' + (late ? ' late' : ''),
            onclick: () => Cal.edit(e),
        }, [
            el('div', { class: 'event-time', text: time }),
            el('div', { class: 'grow' }, [
                el('div', { class: 'title ellipsis' }, [
                    Prefs.dot(e.label), el('span', { text: e.title }),
                ]),
                el('div', { class: 'meta ellipsis' },
                    [showDate && e.time ? e.time : '', e.note || '']
                        .filter(Boolean).join('　') || null),
            ]),
        ]);
    },

    /**
     * 時間線裡的一堂課。
     *
     * **樣式刻意比行程輕。** 課表是每週固定的，每天都會出現四五堂——
     * 跟行程和待辦一樣重的話，這條線上唯一看得到的東西就只剩上課，
     * 真正要處理的事會被淹掉。這裡只是提醒「那幾個時段被佔走了」。
     *
     * 點下去跳到課表，不在時間線上改：改一堂課是改「每個禮拜」，
     * 從單一天的畫面上做那件事很容易改錯。
     */
    classRow(c) {
        return el('div', {
            class: 'event-row class-row',
            title: '課表裡的固定時段・點一下去課表改',
            onclick: () => { this.view = 'class'; this.render(); },
        }, [
            el('div', { class: 'event-time', text: `${c.start}–${c.end || ''}` }),
            el('div', { class: 'grow' }, [
                el('div', { class: 'title ellipsis' }, [
                    Prefs.dot(c.label), el('span', { text: c.name }),
                ]),
                el('div', { class: 'meta ellipsis',
                    text: [c.place, c.teacher].filter(Boolean).join('　') || null }),
            ]),
        ]);
    },
};
