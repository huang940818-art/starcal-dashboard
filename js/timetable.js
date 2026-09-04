/* 課表／班表。
 *
 * 跟行程不一樣的地方：行程是「某一天的某件事」，課表是**每週重複的格子**。
 * 把課一堂一堂當成行程存進去，換學期就得刪一百多筆——所以課表自己一份資料，
 * 只存「星期幾、幾點到幾點」，哪一天有課是算出來的。
 *
 * 「隨時可以換掉」＝ 可以存好幾份（115 上、115 下、打工班表），
 * 切一下就換整份。舊的不刪掉——下學期還會用到同一門課的時間。
 *
 * 時間是自己填的，不是節次表。大學的課不一定對齊節次
 * （有的 9:10 開始、有的 13:20），寫死節次會有課擺不進去。
 */

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

const Timetable = {
    data: null,

    async init() {
        this.data = await Store.load('課表');
        this.data.sets ??= [];
        this.data.active ??= null;
        // active 指到一份不存在的課表（被刪掉了）就掉回第一份，
        // 不然畫面會空著但下拉選單有東西，看起來像壞了
        if (this.data.active && !this.set(this.data.active)) {
            this.data.active = this.data.sets[0]?.id || null;
        }
        if (!this.data.active && this.data.sets.length) {
            this.data.active = this.data.sets[0].id;
        }
    },

    save() { Store.save('課表'); },

    set(id) { return this.data.sets.find(s => s.id === id) || null; },

    active() { return this.set(this.data.active); },

    slots() { return this.active()?.slots || []; },

    /** 星期幾的課，早的排前面 */
    onWeekday(w) {
        return this.slots()
            .filter(s => Number(s.day) === w)
            .sort((a, b) => (a.start || '99:99').localeCompare(b.start || '99:99'));
    },

    /** 某一天（"2026-09-04"）有哪些課 */
    on(day) {
        return this.onWeekday(parseYmd(day).getDay());
    },

    /** 時間軸的上下界。至少 8:00–18:00，有更早或更晚的課就撐開。 */
    bounds() {
        let lo = 8 * 60, hi = 18 * 60;
        for (const s of this.slots()) {
            lo = Math.min(lo, mins(s.start));
            hi = Math.max(hi, mins(s.end || s.start));
        }
        return { lo: Math.floor(lo / 60) * 60, hi: Math.ceil(hi / 60) * 60 };
    },

    /** 有課的星期。全部沒課的話給週一到週五，不然網格會是空的一條。 */
    days() {
        const used = new Set(this.slots().map(s => Number(s.day)));
        if (!used.size) return [1, 2, 3, 4, 5];
        const base = [1, 2, 3, 4, 5];
        for (const d of used) if (!base.includes(d)) base.push(d);
        return base.sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b));
    },

    /* ── 畫面 ───────────────────────────────────── */

    render() {
        const box = $('#timetable');
        clear(box);
        if (box.hidden) return;

        box.append(this.bar());

        if (!this.data.sets.length) {
            box.append(el('div', { class: 'empty', style: 'padding:34px 4px' }, [
                icon('clock', 26), '還沒有課表',
                el('div', { class: 'hint', text: '按「新的課表」開一份，例如「115 上」或「打工班表」' }),
            ]));
            return;
        }
        if (!this.slots().length) {
            box.append(el('div', { class: 'empty', style: 'padding:34px 4px' }, [
                icon('clock', 26), '這份課表還是空的',
                el('div', { class: 'hint', text: '按「加一堂」，填星期幾和幾點到幾點' }),
            ]));
            return;
        }

        box.append(this.grid());
        box.append(this.list());
    },

    /** 上面那一排：選哪一份、動作 */
    bar() {
        const sel = el('select', { class: 'shrink', style: 'width:auto', 'aria-label': '選課表' });
        fillSelect(sel, this.data.sets.map(s => ({ value: s.id, label: s.name })), this.data.active || '');
        sel.onchange = () => {
            this.data.active = sel.value;
            this.save();
            this.render();
            Agenda.render();
            Overview.render();
        };

        return el('div', { class: 'tt-bar' }, [
            this.data.sets.length ? sel : null,
            el('span', { class: 'grow' }),
            this.data.sets.length ? el('button', {
                type: 'button', class: 'btn small ghost', text: '管理',
                onclick: () => this.manage(),
            }) : null,
            el('button', {
                type: 'button', class: 'btn small', text: '新的課表',
                onclick: () => this.editSet(null),
            }),
            this.data.sets.length ? el('button', {
                type: 'button', class: 'btn small primary', text: '加一堂',
                onclick: () => this.editSlot(null),
            }) : null,
        ]);
    },

    /** 週網格。按實際時間擺，所以 9:10 的課就真的在 9:10 那個位置。 */
    grid() {
        const { lo, hi } = this.bounds();
        const span = hi - lo;
        const PX = 1.05;                       // 一分鐘幾像素
        const height = span * PX;
        const days = this.days();

        const wrap = el('div', { class: 'tt-wrap' });
        const grid = el('div', {
            class: 'tt-grid',
            style: `--cols:${days.length}; --h:${height}px`,
        });

        // 左邊的時間刻度
        const ruler = el('div', { class: 'tt-ruler' });
        for (let t = lo; t <= hi; t += 60) {
            ruler.append(el('div', {
                class: 'tt-tick', style: `top:${(t - lo) * PX}px`,
                text: `${Math.floor(t / 60)}:00`,
            }));
        }
        grid.append(el('div', { class: 'tt-corner' }), ruler);

        for (const d of days) {
            const isToday = d === new Date().getDay();
            grid.append(el('div', {
                class: 'tt-wd' + (isToday ? ' now' : ''), text: `週${WEEK[d]}`,
                style: `grid-column:${days.indexOf(d) + 2}`,
            }));

            const col = el('div', {
                class: 'tt-col' + (isToday ? ' now' : ''),
                style: `grid-column:${days.indexOf(d) + 2}`,
            });
            // 整點橫線。沒有這個的話課會浮在半空中，看不出幾點。
            for (let t = lo; t <= hi; t += 60) {
                col.append(el('div', { class: 'tt-line', style: `top:${(t - lo) * PX}px` }));
            }
            for (const s of this.onWeekday(d)) {
                const top = (mins(s.start) - lo) * PX;
                const h = Math.max(26, (mins(s.end || s.start) - mins(s.start)) * PX);
                const l = Prefs.label(s.label);
                col.append(el('button', {
                    type: 'button',
                    class: 'tt-slot',
                    // 格子高度不一定塞得下老師和分類，掛在 title 上
                    // 至少滑過去看得到——點進去當然也看得到。
                    title: [s.name, `${s.start}–${s.end || ''}`, s.place, s.teacher,
                            l ? `分類：${l.name}` : '']
                        .filter(Boolean).join('　'),
                    style: `top:${top}px; height:${h}px;`
                        + (l ? `--slot:${l.color}` : ''),
                    onclick: () => this.editSlot(s),
                }, [
                    el('div', { class: 'tt-name ellipsis', text: s.name }),
                    el('div', { class: 'tt-time', text: `${s.start}–${s.end || ''}` }),
                    s.place ? el('div', { class: 'tt-place ellipsis', text: s.place }) : null,
                ]));
            }
            grid.append(col);
        }

        wrap.append(grid);
        return wrap;
    },

    /** 網格底下的清單。手機上網格太窄，這份才是真正讀得到的。 */
    list() {
        const box = el('div', { class: 'tt-list' });
        for (const d of this.days()) {
            const rows = this.onWeekday(d);
            if (!rows.length) continue;
            box.append(el('div', { class: 'day-group' }, [
                el('div', { class: 'day-head' }, [
                    el('span', {
                        class: 'day-name' + (d === new Date().getDay() ? ' now' : ''),
                        text: `週${WEEK[d]}`,
                    }),
                    el('span', { class: 'day-count', text: `${rows.length} 堂` }),
                ]),
                ...rows.map(s => el('div', {
                    class: 'event-row', onclick: () => this.editSlot(s),
                }, [
                    el('div', { class: 'event-time', text: `${s.start}–${s.end || ''}` }),
                    el('div', { class: 'grow' }, [
                        el('div', { class: 'title ellipsis' }, [
                            Prefs.dot(s.label), el('span', { text: s.name }),
                        ]),
                        el('div', { class: 'meta ellipsis',
                            text: [s.place, s.teacher].filter(Boolean).join('　') || null }),
                    ]),
                ])),
            ]));
        }
        return box;
    },

    /* ── 一堂課 ─────────────────────────────────── */

    editSlot(s) {
        const isNew = !s;
        s = s || { id: uid(), name: '', day: 1, start: '09:10', end: '10:00',
                   place: '', teacher: '', label: null };

        $('#dlg-slot-title').textContent = isNew ? '加一堂' : '改這一堂';
        $('#k-name').value = s.name;
        fillSelect($('#k-day'), WEEK.map((w, i) => ({ value: String(i), label: `週${w}` })), String(s.day));
        $('#k-start').value = s.start || '';
        $('#k-end').value = s.end || '';
        $('#k-place').value = s.place || '';
        $('#k-teacher').value = s.teacher || '';
        Prefs.fillSelect($('#k-label'), s.label);
        $('#k-delete').hidden = isNew;

        const dlg = openDialog('#dlg-slot');

        $('#k-save').onclick = () => {
            const name = $('#k-name').value.trim();
            if (!name) return toast('這堂叫什麼？', true);
            const start = $('#k-start').value;
            const end = $('#k-end').value;
            if (!start) return toast('幾點開始？', true);
            if (end && end <= start) return toast('結束時間不能比開始早', true);

            Object.assign(s, {
                name, start, end,
                day: Number($('#k-day').value),
                place: $('#k-place').value.trim(),
                teacher: $('#k-teacher').value.trim(),
                label: $('#k-label').value || null,
            });
            if (isNew) this.active().slots.push(s);
            this.save();
            dlg.close();
            this.render();
            Agenda.render();
            Overview.render();
        };

        $('#k-delete').onclick = () => {
            const set = this.active();
            set.slots = set.slots.filter(x => x.id !== s.id);
            this.save();
            dlg.close();
            this.render();
            Agenda.render();
            Overview.render();
        };
    },

    /* ── 整份課表 ───────────────────────────────── */

    editSet(set) {
        const isNew = !set;
        $('#dlg-set-title').textContent = isNew ? '新的課表' : '改課表名稱';
        $('#p-name').value = set?.name || '';
        $('#p-copy-field').hidden = !isNew || !this.data.sets.length;
        if (!$('#p-copy-field').hidden) {
            fillSelect($('#p-copy'), [
                { value: '', label: '從空白開始' },
                ...this.data.sets.map(s => ({ value: s.id, label: `複製「${s.name}」` })),
            ], '');
        }

        const dlg = openDialog('#dlg-set');

        $('#p-save').onclick = () => {
            const name = $('#p-name').value.trim();
            if (!name) return toast('這份課表叫什麼？', true);

            if (isNew) {
                // 複製的話要換掉每一堂的 id，不然兩份課表共用同一個 id，
                // 改其中一份會連另一份一起改掉
                const from = $('#p-copy-field').hidden ? '' : $('#p-copy').value;
                const src = from ? this.set(from)?.slots || [] : [];
                const fresh = { id: uid(), name, slots: src.map(s => ({ ...s, id: uid() })) };
                this.data.sets.push(fresh);
                this.data.active = fresh.id;
            } else {
                set.name = name;
            }
            this.save();
            dlg.close();
            this.render();
            Agenda.render();
        };
    },

    manage() {
        const box = $('#set-editor');
        const draw = () => {
            clear(box);
            for (const s of this.data.sets) {
                const on = s.id === this.data.active;
                box.append(el('div', { class: 'label-edit-row' }, [
                    el('div', { class: 'grow' }, [
                        el('div', {}, [
                            el('span', { text: s.name }),
                            on ? el('span', { class: 'tag-now', text: '使用中' }) : null,
                        ]),
                        el('div', { class: 'sub', text: `${s.slots.length} 堂` }),
                    ]),
                    on ? null : el('button', {
                        type: 'button', class: 'btn ghost small', text: '換成這份',
                        onclick: () => {
                            this.data.active = s.id;
                            this.save();
                            draw();
                            this.render();
                            Agenda.render();
                            Overview.render();
                        },
                    }),
                    el('button', {
                        type: 'button', class: 'btn ghost small', text: '改名',
                        onclick: () => { $('#dlg-sets').close(); this.editSet(s); },
                    }),
                    el('button', {
                        type: 'button', class: 'btn ghost small danger', text: '刪掉',
                        onclick: () => {
                            // 刪整份課表是刪掉一學期的資料，要問一次。
                            // 這個沒有復原，跟刪一堂課不是同一個量級。
                            if (!confirmTwice(box, `刪掉「${s.name}」和裡面的 ${s.slots.length} 堂？`)) return;
                            this.data.sets = this.data.sets.filter(x => x.id !== s.id);
                            if (this.data.active === s.id) this.data.active = this.data.sets[0]?.id || null;
                            this.save();
                            draw();
                            this.render();
                            Agenda.render();
                            Overview.render();
                        },
                    }),
                ]));
            }
            box.append(el('button', {
                type: 'button', class: 'btn small', text: '新的課表',
                style: 'margin-top:12px',
                onclick: () => { $('#dlg-sets').close(); this.editSet(null); },
            }));
        };
        draw();
        openDialog('#dlg-sets');
    },
};

/** "09:10" → 550。空的當 0。 */
function mins(t) {
    if (!t) return 0;
    const [h, m] = String(t).split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
}

/** 危險動作的二次確認。做成 toast + 再按一次，
 *  不用 window.confirm——那個會擋住整個頁面，而且很容易被順手按掉。 */
let _armed = null;
function confirmTwice(scope, msg) {
    if (_armed === msg) { _armed = null; return true; }
    _armed = msg;
    toast(msg + '　再按一次確定', true);
    setTimeout(() => { if (_armed === msg) _armed = null; }, 4000);
    return false;
}
