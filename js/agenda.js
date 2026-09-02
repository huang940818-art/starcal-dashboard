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
        e = e || { id: uid(), date: defaultDay || todayStr(), time: '', endTime: '', title: '', note: '' };

        $('#dlg-event-title').textContent = isNew ? '加行程' : '改行程';
        $('#e-title').value = e.title;
        $('#e-date').value = e.date;
        $('#e-time').value = e.time || '';
        $('#e-end').value = e.endTime || '';
        $('#e-note').value = e.note || '';
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

    async init() {
        $('#add-event').onclick = () => Cal.edit(null);
        $('#add-todo').onclick = () => Todo.edit(null);
        $('#clear-done').onclick = () => Todo.clearDone();
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
            const events = Cal.on(day);
            const todos = Todo.data.items.filter(t => !t.done && t.due === day);
            if (events.length || todos.length) out.push({ day, events, todos });
        }
        return out;
    },

    /** 已經過去但還沒處理的。這些要排在最前面，不然會一直被往下推。 */
    overdue() {
        const today = todayStr();
        return {
            events: Cal.data.events.filter(e => e.date < today)
                .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10),
            todos: Todo.data.items.filter(t => !t.done && t.due && t.due < today)
                .sort((a, b) => a.due.localeCompare(b.due)),
        };
    },

    render() {
        const box = $('#agenda');
        clear(box);

        const late = this.overdue();
        const upcoming = this.days();
        const someday = Todo.open().filter(t => !t.due);
        const done = Todo.data.items.filter(t => t.done)
            .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

        if (!late.todos.length && !late.events.length && !upcoming.length
            && !someday.length && !done.length) {
            box.append(el('div', { class: 'empty' }, [
                icon('todo', 26), '接下來沒有事',
                el('div', { class: 'hint', text: '加一個行程或一件待辦，它們會排在同一條線上' }),
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
        for (const { day, events, todos } of upcoming) {
            const isToday = day === todayStr();
            box.append(el('div', { class: 'day-group' + (isToday ? ' today' : '') }, [
                el('div', { class: 'day-head' }, [
                    el('span', { class: 'day-name' + (isToday ? ' now' : ''), text: relativeDay(day) }),
                    el('span', { class: 'day-count', text: this.dayLabel(day) }),
                ]),
                ...events.map(e => this.eventRow(e)),
                ...todos.map(t => Todo.row(t)),
            ]));
        }

        if (!upcoming.length && !late.todos.length && !late.events.length) {
            box.append(el('div', { class: 'empty' }, [
                icon('todo', 24), '接下來這兩週沒有排定的事',
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

    eventRow(e, late = false) {
        const time = e.time
            ? (e.endTime ? `${e.time}–${e.endTime}` : e.time)
            : '整天';

        return el('div', {
            class: 'event-row' + (late ? ' late' : ''),
            onclick: () => Cal.edit(e),
        }, [
            el('div', { class: 'event-time', text: time }),
            el('div', { class: 'grow' }, [
                el('div', { class: 'title ellipsis', text: e.title }),
                e.note ? el('div', { class: 'meta ellipsis', text: e.note }) : null,
            ]),
        ]);
    },
};
