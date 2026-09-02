/* 待辦。
 *
 * 分區的邏輯照 iOS 星歷那邊：有期限的才會進「今天」，沒期限的放「之後再說」。
 * 這樣做是因為把所有事情都排進今天，等於今天永遠做不完。
 *
 * 優先級刻意只有兩級（普通／重要）。三級以上沒有人會認真維護，
 * 最後每一件都變成「最高」。
 */

const Todo = {
    data: null,

    async init() {
        this.data = await Store.load('待辦');
        this.data.items ??= [];
        // 按鈕綁在 Agenda 那邊——待辦和行程共用同一個工具列
    },

    save() { Store.save('待辦'); },

    /** 沒做完的，按急迫程度排 */
    open() {
        return this.data.items.filter(i => !i.done).sort((a, b) => {
            if (a.priority !== b.priority) return (b.priority || 0) - (a.priority || 0);
            if (!!a.due !== !!b.due) return a.due ? -1 : 1;
            if (a.due && b.due) return a.due.localeCompare(b.due);
            return (b.createdAt || 0) - (a.createdAt || 0);
        });
    },

    /** 今天到期，或過期還沒做完 */
    dueToday(i) {
        return !!i.due && !i.done && i.due <= todayStr();
    },

    /** 待辦不再自己畫清單——它跟行程排在同一條線上，由 Agenda 統一畫。 */
    render() { Agenda.render(); },

    /**
     * @param showDate 在時間線裡是 false——那邊已經按日期分組了，
     *                 每一列再寫一次「明天」只是噪音。
     */
    row(i, showDate = false) {
        const overdue = !!i.due && !i.done && i.due < todayStr();
        const isToday = !!i.due && !i.done && i.due === todayStr();

        let meta = '';
        if (showDate && i.due) meta = overdue ? `過期了・${relativeDay(i.due)}` : relativeDay(i.due);
        if (i.note) meta += (meta ? '　' : '') + i.note.split('\n')[0];

        return el('div', { class: 'todo-row' + (i.done ? ' done' : '') }, [
            el('button', {
                class: 'check',
                role: 'checkbox',
                'aria-checked': String(!!i.done),
                'aria-label': i.done ? '標成沒做完' : '標成完成',
                text: i.done ? '✓' : '',
                onclick: () => this.toggle(i),
            }),
            el('div', { class: 'grow', style: 'cursor:pointer', onclick: () => this.edit(i) }, [
                el('div', { class: 'title ellipsis', text: i.title }),
                meta ? el('div', {
                    class: 'meta ellipsis' + (overdue ? ' overdue' : isToday ? ' today' : ''),
                    text: meta,
                }) : null,
            ]),
            el('button', {
                class: 'star-btn' + (i.priority ? ' on' : ''),
                'aria-label': i.priority ? '取消重要' : '標成重要',
                text: i.priority ? '★' : '☆',
                onclick: () => {
                    i.priority = i.priority ? 0 : 1;
                    this.save();
                    this.render();
                    Overview.render();
                },
            }),
        ]);
    },

    toggle(i) {
        i.done = !i.done;
        i.completedAt = i.done ? Date.now() : null;
        this.save();
        this.render();
        Overview.render();
    },

    clearDone() {
        const n = this.data.items.filter(i => i.done).length;
        if (!n) return toast('沒有完成的可以清');
        this.data.items = this.data.items.filter(i => !i.done);
        this.save();
        this.render();
        Overview.render();
        toast(`清掉 ${n} 件`);
    },

    edit(i) {
        const isNew = !i;
        i = i || { id: uid(), title: '', done: false, priority: 0, due: null, note: '', createdAt: Date.now() };

        $('#dlg-todo-title').textContent = isNew ? '新增待辦' : '改待辦';
        $('#d-title').value = i.title;
        $('#d-due').value = i.due || '';
        $('#d-priority').checked = !!i.priority;
        $('#d-note').value = i.note || '';
        $('#d-delete').hidden = isNew;

        const dlg = openDialog('#dlg-todo');

        $('#d-save').onclick = () => {
            const title = $('#d-title').value.trim();
            if (!title) return toast('要做什麼總得寫一下', true);

            Object.assign(i, {
                title,
                due: $('#d-due').value || null,
                priority: $('#d-priority').checked ? 1 : 0,
                note: $('#d-note').value.trim(),
            });
            if (isNew) this.data.items.push(i);
            this.save();
            dlg.close();
            this.render();
            Overview.render();
        };

        $('#d-delete').onclick = () => {
            this.data.items = this.data.items.filter(x => x.id !== i.id);
            this.save();
            dlg.close();
            this.render();
            Overview.render();
        };
    },
};
