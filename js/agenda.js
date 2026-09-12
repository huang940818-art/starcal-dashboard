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
        this.data.shifts ??= [];
        // 每一期實際領到多少（"yyyy-MM" → 金額）。存在資料裡不是
        // localStorage：她在手機上對完帳，回電腦上還要看得到。
        this.data.payslips ??= {};
    },

    save() { Store.save('行事曆'); },

    // MARK: 班別與排班
    //
    // 打工的班**每週都不一樣**，塞不進課表——課表是「每個禮拜的這個時段」。
    // 但一天一天加行程也不行：排一個禮拜要開七次對話框、打七次同樣的時間。
    //
    // 所以拆成兩層：**班別**是重複用的樣板（名字＋幾點到幾點＋顏色），
    // **排班**是在月曆上點日期，點到哪天就在那天長一筆行程出來。
    // 排一整週＝點五下。
    //
    // 排出來的就是普通行程，不是另一種資料。這樣時間線、過期提醒、
    // 分類篩選、總覽那句話全部自動有——多一種資料型別就要多維護一遍。
    //
    // **班別的名字自己取。** 不寫死「打工」：實驗室、家教、社團、值班都是班。

    shifts() {
        this.data.shifts ??= [];
        return this.data.shifts;
    },

    shift(id) { return this.shifts().find(s => s.id === id) || null; },

    addShift({ name, time = '', endTime = '', label = null, rate = 0, breakMin = 0 }) {
        const clean = (name || '').trim();
        if (!clean) return null;
        const s = { id: uid(), name: clean, time, endTime, label,
                    rate: Number(rate) || 0, breakMin: Number(breakMin) || 0 };
        this.shifts().push(s);
        this.save();
        return s;
    },

    /**
     * 改一個班別。
     *
     * **改的只有樣板，已經排出去的班一個都不動。**
     * 六月加薪就改這裡，三到五月的班還是用當時抄過去的時薪算——
     * 不然過去每一期的預估都會跟著跳，而跟實際領到的對不起來時，
     * 完全看不出來是為什麼。
     */
    updateShift(id, patch) {
        const s = this.shift(id);
        if (!s) return null;
        if (patch.name !== undefined) {
            const clean = String(patch.name).trim();
            if (!clean) return null;
            s.name = clean;
        }
        for (const k of ['time', 'endTime', 'label']) {
            if (patch[k] !== undefined) s[k] = patch[k];
        }
        for (const k of ['rate', 'breakMin']) {
            if (patch[k] !== undefined) s[k] = Number(patch[k]) || 0;
        }
        this.save();
        return s;
    },

    removeShift(id) {
        // **排出去的班留著。** 刪掉一個班別是「以後不用這個樣板了」，
        // 不是「我上個月沒去上班」。連著刪掉的話，過去的紀錄會憑空消失。
        this.data.shifts = this.shifts().filter(s => s.id !== id);
        this.save();
    },

    /** 這一天有沒有排這個班 */
    hasShift(day, shiftId) {
        return this.data.events.some(e => e.date === day && e.shift === shiftId);
    },

    /**
     * 在這一天排上／取消這個班。回傳排完之後有沒有班。
     *
     * 同一個班在同一天只會有一筆——點兩下是「排上去、又拿掉」，
     * 不是「排兩次」。
     */
    toggleShift(day, shiftId) {
        const s = this.shift(shiftId);
        if (!s) return false;

        if (this.hasShift(day, shiftId)) {
            this.data.events = this.data.events.filter(
                e => !(e.date === day && e.shift === shiftId));
            this.save();
            return false;
        }
        /* 時薪和休息**抄一份過來**，不是每次都回去問班別。
         * 理由見 updateShift 上面那段：調薪不能讓過去的預估跟著變。 */
        this.data.events.push({
            id: uid(), date: day, title: s.name,
            time: s.time || '', endTime: s.endTime || '',
            note: '', label: s.label || null, shift: s.id,
            rate: Number(s.rate) || 0, breakMin: Number(s.breakMin) || 0,
        });
        this.save();
        return true;
    },

    /** 某一天的行程，有時間的排前面。**收起來的不算。** */
    on(day) {
        return this.allOn(day).filter(e => !e.done);
    },

    /** 某一天的行程，**含收起來的**。理由見 Agenda.eventsOnWithDone。 */
    allOn(day) {
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

    /**
     * 那一天的行程，**含已經收起來的**。
     *
     * 她的原話：「我希望工作的部分過了之後點點不要消失」。
     *
     * 「收起來」（過期那區的清掉、或單筆按過的）回答的是「這件事不用
     * 再理了」，不是「這件事沒發生過」。月曆問的是後面那個——
     * 她月底翻月曆是要看「這個月上了哪幾天班」，把收起來的拿掉的話，
     * 那幾天會變成空的，看起來像自己沒排到班。
     *
     * 跟停課那顆點同一套處理：**留著，但畫成空心**（見 cls-dot.off
     * 上面那段註解——「拿掉的話『今天本來有課』這件事就消失了」）。
     *
     * **收起來的排最後。** 格子裡只放得下三件，讓已經過去的把今天
     * 真正要做的擠下去，就本末倒置了。
     */
    eventsOnWithDone(day) {
        const rows = Cal.allOn(day).filter(e => this.match(e));
        return [...rows.filter(e => !e.done), ...rows.filter(e => e.done)];
    },

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
            // 做完的自己一個地方。**本來擺在時間線最底下**——
            // 收起來了但還是佔著版面，而且愈積愈長。
            // 她的話：「做完的東西不要留在版面，可以把做完的集合起來
            // 放在某一個地方」。
            { k: 'done', name: '做完的', ico: 'todo' },
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
        // 用數字排序，不用字串。課可能只有節次沒有時間（學校課表本來就是
        // 「第 9-10 節」），那種要排在有時間的後面、彼此照節次順序——
        // 拿字串比的話「第 9 節」和「14:00」根本沒有可比性。
        const key = x => x.kind === 'class'
            ? Timetable.sortKey(x.item)
            : (x.item.time ? mins(x.item.time) : 99999);
        return [
            ...events.map(e => ({ kind: 'event', item: e })),
            ...classes.map(c => ({ kind: 'class', item: c })),
        ].sort((a, b) => key(a) - key(b));
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
            .filter(e => e.date > h && !e.done && this.match(e))
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
            events: Cal.data.events.filter(e => e.date < today && !e.done && ok(e))
                .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10),
            todos: Todo.data.items.filter(t => !t.done && t.due && t.due < today && ok(t))
                .sort((a, b) => a.due.localeCompare(b.due)),
        };
    },

    /** 分頁的總入口：畫工具列，然後把場子交給選中的那個檢視。 */
    render() {
        if ($('#panel-agenda').hidden) return;
        this.tools();

        // 時間線和「做完的」共用同一個容器——兩邊都是一條一條的列表，
        // 各開一個 div 只會讓兩份幾乎一樣的樣式各自漂移
        const isList = this.view === 'timeline' || this.view === 'done';
        $('#agenda-list').hidden = !isList;
        $('#calendar').hidden = this.view !== 'month';
        $('#timetable').hidden = this.view !== 'class';

        // 那段開場白講的是時間線的道理，換到別的檢視就不成立了。
        // 手機上它佔三行，比課表的前四節還高。
        $('#agenda-why').hidden = this.view !== 'timeline';

        // 「清掉完成的」只在「做完的」那一頁出現。做完的已經不在時間線上了，
        // 把它們的刪除鍵留在那裡，等於一顆看不到目標的按鈕。
        $('#clear-done').hidden = this.view !== 'done';

        if (this.view === 'timeline') this.renderTimeline();
        else if (this.view === 'done') this.renderDone();
        else if (this.view === 'month') MonthView.render();
        else Timetable.render();
    },

    /**
     * 把已經過去的行程清掉。
     *
     * 不問「你確定嗎」，改成清完給一顆「復原」——問了也不會讓人更確定，
     * 倒是每次都要多按一次。給得起復原的動作就別問（見 util.js 的 toastAction）。
     *
     * **只清畫面上那幾件。** 過期清單會被上面的分類篩選影響，
     * 按「只看學校」的時候看到 2 件，清掉的就該是那 2 件，
     * 不是連沒顯示的那 3 件一起。看到什麼就清掉什麼。
     */
    /**
     * 把一件過去的行程收掉。
     *
     * 過期那一區本來只有「清掉全部」，單筆要點進去開對話框再按刪除——
     * **她的原話是「過期的我不能按已完成」**。行程沒有「完成」這個狀態
     * （那是待辦的事），但她要的其實是同一件事：**這件我處理完了，
     * 讓它從版面上消失。**
     *
     * 所以給一顆勾，行為是刪掉，但復原留著——按錯了一秒內按得回來。
     */
    doneWithEvent(e) {
        // **收起來，不是刪掉。**
        //
        // 第一版做成刪除，只有幾秒的復原視窗——她問「那些被收掉的待辦
        // 事項去哪裡可以看」，那就是答案：**沒有地方可以看**。
        // 一個按鈕如果會讓東西永遠消失，那顆按鈕就太兇了。
        //
        // 現在標成 done 移到「收起來的」那一區，隨時看得到、放得回去。
        e.done = true;
        e.doneAt = Date.now();
        Cal.save();
        this.render();
        Overview.render();

        toastAction(`收掉「${e.title}」`, '放回去', () => {
            this.undoneEvent(e);
            toast('放回去了');
        });
    },

    undoneEvent(e) {
        delete e.done;
        delete e.doneAt;
        Cal.save();
        this.render();
        Overview.render();
    },

    clearPastEvents() {
        const gone = this.overdue().events;
        if (!gone.length) return;

        // 一樣是收起來不是刪掉。「清掉」聽起來像永久消失，
        // 但它們會待在「收起來的」那一區，隨時放得回去。
        const now = Date.now();
        for (const e of gone) { e.done = true; e.doneAt = now; }
        Cal.save();
        this.render();
        Overview.render();

        toastAction(`收起 ${gone.length} 件過去的行程`, '放回去', () => {
            for (const e of gone) { delete e.done; delete e.doneAt; }
            Cal.save();
            this.render();
            Overview.render();
            toast('放回去了');
        });
    },

    renderTimeline() {
        const box = $('#agenda-list');
        clear(box);

        const late = this.overdue();
        const upcoming = this.days();
        const later = this.later();
        const someday = Todo.open().filter(t => !t.due && this.match(t));

        // 做完的不算在「有沒有事」裡面——它們在「做完的」那個檢視。
        // 算進來的話，只剩做完的東西時這條線會是一片空白而不是
        // 「接下來沒有事」，看起來像壞掉。
        if (!late.todos.length && !late.events.length && !upcoming.length
            && !later.length && !someday.length) {
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
                    // 已經發生過的行程會一直卡在最上面。
                    //
                    // **只清行程，不動待辦。** 過期的行程是「已經過去的事」，
                    // 留著只是擋路；過期的待辦是「還沒做的事」，
                    // 幫她清掉等於幫她假裝沒發生——那個要她自己勾掉。
                    late.events.length
                        ? el('button', {
                            type: 'button', class: 'day-clear',
                            text: `清掉過去的行程（${late.events.length}）`,
                            title: '待辦不會被清掉，那些要自己勾完成',
                            onclick: () => this.clearPastEvents(),
                          })
                        : null,
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
                    ? this.classRow(r.item, day)
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

        // **做完的不畫在這裡。** 它們在「做完的」那個檢視裡，
        // 收掉的東西一定要有地方去（會讓東西永遠消失的按鈕太兇了），
        // 但那個地方不該是這條時間線的尾巴。
    },

    /* ── 做完的 ─────────────────────────────────────
     *
     * 完成的待辦 ＋ 收起來的行程，按「什麼時候做完的」分組。
     *
     * 分組是重點：一年份的已完成排成一長串，跟沒有一樣。
     * 今天做完的那幾件才是她會想看的——證明今天有做事。
     */
    doneGroups() {
        /* **兩邊的欄位名字不一樣。** 待辦是 completedAt（js/todo.js），
         * 行程是 doneAt（這支檔案）。寫錯一邊不會報錯，那一邊會整批
         * 掉進「不知道什麼時候」——看起來像功能壞了，但其實只是讀錯欄位。 */
        const rows = [
            ...Todo.data.items.filter(t => t.done && this.match(t))
                .map(t => ({ at: t.completedAt || 0, kind: 'todo', item: t })),
            ...Cal.data.events.filter(e => e.done && this.match(e))
                .map(e => ({ at: e.doneAt || 0, kind: 'event', item: e })),
        ].sort((a, b) => b.at - a.at);

        const today = parseYmd(todayStr()).getTime();
        const week = today - 6 * 86400000;

        const buckets = [
            { name: '今天', rows: [] },
            { name: '這七天', rows: [] },
            { name: '更早', rows: [] },
            // **沒有時間戳的要有地方去。** doneAt 是後來才加的欄位，
            // 舊資料沒有；掉出所有分組的話那幾件會憑空消失。
            { name: '不知道什麼時候', rows: [] },
        ];
        for (const r of rows) {
            if (!r.at) buckets[3].rows.push(r);
            else if (r.at >= today) buckets[0].rows.push(r);
            else if (r.at >= week) buckets[1].rows.push(r);
            else buckets[2].rows.push(r);
        }
        return buckets.filter(b => b.rows.length);
    },

    renderDone() {
        const box = $('#agenda-list');
        clear(box);

        const groups = this.doneGroups();
        if (!groups.length) {
            box.append(el('div', { class: 'empty' }, [
                icon('todo', 26), '還沒有做完的事',
                el('div', { class: 'hint', text: '打勾之後會收到這裡，不會不見' }),
            ]));
            return;
        }

        const total = groups.reduce((n, g) => n + g.rows.length, 0);
        // 講清楚是點哪裡。整列點下去是開編輯，放回去要點左邊那個勾——
        // 只寫「點一下可以放回去」的話她會點到編輯視窗
        box.append(el('div', { class: 'sub', style: 'margin-bottom:12px' }, [
            `一共 ${total} 件。點左邊的勾可以放回去。`,
        ]));

        for (const g of groups) {
            box.append(el('div', { class: 'day-group muted' }, [
                el('div', { class: 'day-head' }, [
                    el('span', { class: 'day-name', text: g.name }),
                    el('span', { class: 'day-count', text: `${g.rows.length} 件` }),
                ]),
                ...g.rows.map(r => r.kind === 'event'
                    ? this.archivedRow(r.item) : Todo.row(r.item)),
            ]));
        }
    },

    /** 收起來的行程。點一下放回去——不然收掉就等於不見了。 */
    archivedRow(e) {
        return el('div', { class: 'event-row archived' }, [
            el('div', { class: 'event-time', text: this.dayLabel(e.date).split('　')[0] }),
            el('div', { class: 'grow', style: 'cursor:pointer', onclick: () => Cal.edit(e) }, [
                el('div', { class: 'title ellipsis' }, [
                    Prefs.dot(e.label), el('span', { text: e.title }),
                ]),
                el('div', { class: 'meta ellipsis', text: e.note || null }),
            ]),
            el('button', {
                type: 'button', class: 'btn small ghost',
                text: '放回去',
                onclick: ev => { ev.stopPropagation(); this.undoneEvent(e); toast('放回去了'); },
            }),
        ]);
    },

    /** 日期那一行右邊的小字：幾月幾號星期幾 */
    dayLabel(day) {
        const d = parseYmd(day);
        return `${d.getMonth() + 1}/${d.getDate()}　`
            + '日一二三四五六'[d.getDay()].replace(/^/, '週');
    },

    eventRow(e, late = false, showDate = false) {
        // 過期的那幾件才給勾。還沒到的行程不需要「處理掉」，
        // 多一顆勾只會讓人以為那是「完成」而不小心刪掉。
        // 在「更遠」那一區，左欄要放日期不是時間——那邊沒有按日期分組
        const time = showDate
            ? this.dayLabel(e.date).split('　')[0]
            : (e.time ? (e.endTime ? `${e.time}–${e.endTime}` : e.time) : '整天');

        // 收起來的也會出現在月曆底下那塊（見 Cal.dayPanel）。
        // **要看得出它是收起來的，而且放得回去**——長得跟還沒處理的
        // 一模一樣的話，那顆空心點就變成一個查不出來的疑問。
        const gone = !!e.done;

        return el('div', {
            class: 'event-row' + (late ? ' late' : '') + (gone ? ' gone' : ''),
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
            gone ? el('button', {
                type: 'button',
                class: 'btn small ghost',
                title: '放回去，這件事會回到時間線上',
                text: '放回去',
                onclick: ev => { ev.stopPropagation(); this.undoneEvent(e); },
            }) : null,
            late && !gone ? el('button', {
                type: 'button',
                class: 'check event-done',
                'aria-label': `收掉「${e.title}」`,
                title: '處理完了，收起來（可以復原）',
                text: '✓',
                onclick: ev => { ev.stopPropagation(); this.doneWithEvent(e); },
            }) : null,
        ]);
    },

    /**
     * 時間線裡的一堂課。
     *
     * **樣式刻意比行程輕。** 課表是每週固定的，每天都會出現四五堂——
     * 跟行程和待辦一樣重的話，這條線上唯一看得到的東西就只剩上課，
     * 真正要處理的事會被淹掉。這裡只是提醒「那幾個時段被佔走了」。
     *
     * 點下去直接開那一堂的編輯（含刪除）。
     *
     * 本來是「跳到課表分頁讓她自己找」，理由是改一堂課等於改每個禮拜，
     * 從單一天的畫面上做容易改錯。**但那個理由是我的，不是她的**——
     * 看到一件事卻不能動它，比改錯的風險真實得多。
     * 對話框上寫清楚「改的是課表，每個禮拜都會變」就夠了。
     */
    /**
     * 時間線上的一堂課。
     *
     * **點一下開的是「這一天的標記」，不是課表編輯。**
     * 在某一天的畫面上看到一堂課，最常想做的事是「這週停課」或
     * 「這次要交報告」，不是改整學期的上課時間——後者改一次會動到
     * 每個禮拜，放在單日的畫面上很容易誤觸。要改課表，對話框裡有指路。
     *
     * @param day 這一列是哪一天。沒有的話（沒有日期脈絡）就退回改課表。
     */
    classRow(c, day) {
        const mark = day ? Timetable.markFor(c.id, day) : null;
        const off = !!mark?.off;

        return el('div', {
            class: 'event-row class-row' + (off ? ' off' : ''),
            title: day ? '點一下標記這一天（停課、作業、要帶的東西）'
                       : '課表裡的固定時段・點一下改或刪',
            onclick: () => day ? this.editMark(c, day) : Timetable.editSlot(c),
        }, [
            el('div', { class: 'event-time', text: Timetable.whenText(c) }),
            el('div', { class: 'grow' }, [
                el('div', { class: 'title ellipsis' }, [
                    Prefs.dot(c.label),
                    el('span', { text: c.name }),
                    off ? el('span', { class: 'class-off-tag', text: '這次不用上' }) : null,
                ]),
                // 標記的內容直接寫在這裡。**要點開才看得到的提醒等於沒有提醒。**
                mark?.text
                    ? el('div', { class: 'meta class-note', text: mark.text })
                    : null,
                el('div', { class: 'meta ellipsis',
                    text: [c.place, c.teacher].filter(Boolean).join('　') || null }),
            ]),
        ]);
    },

    /** 標記某一天的某一堂課 */
    editMark(c, day) {
        const mark = Timetable.markFor(c.id, day);
        const d = parseYmd(day);

        $('#cm-title').textContent = c.name;
        $('#cm-when').textContent =
            `${d.getMonth() + 1}/${d.getDate()}（${'日一二三四五六'[d.getDay()]}）　`
            + Timetable.whenText(c);
        $('#cm-off').checked = !!mark?.off;
        $('#cm-text').value = mark?.text || '';
        $('#cm-clear').hidden = !mark;

        const dlg = openDialog('#dlg-class-mark');

        $('#cm-save').onclick = () => {
            Timetable.setMark(c.id, day, {
                off: $('#cm-off').checked,
                text: $('#cm-text').value,
            });
            dlg.close();
            this.render();
            Overview.render();
        };

        $('#cm-clear').onclick = () => {
            Timetable.setMark(c.id, day, { off: false, text: '' });
            dlg.close();
            this.render();
            Overview.render();
        };
    },
};
