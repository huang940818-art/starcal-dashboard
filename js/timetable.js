/* 課表／班表。
 *
 * 跟行程不一樣的地方：行程是「某一天的某件事」，課表是**每週重複的格子**。
 * 把課一堂一堂當成行程存進去，換學期就得刪一百多筆——所以課表自己一份資料，
 * 只存「星期幾、哪幾節」，哪一天有課是算出來的。
 *
 * 「隨時可以換掉」＝ 可以存好幾份（115 上、115 下、打工班表），
 * 切一下就換整份。舊的不刪掉——下學期還會用到同一門課的時間。
 *
 * ── 兩種模式，因為它們本來就是兩種東西 ───────────────
 *
 * **節次制（課表）**：學校的課表是「第 9-10 節」，不是「9:10-12:00」。
 *   要人自己把節次換算成時間再填進去，是把學校的問題丟給使用者。
 *   節次對應幾點可以自己設，**留白也完全能用**——課表本來就是靠節次讀的。
 *
 * **時間制（班表）**：打工沒有節次，就是幾點到幾點。
 *
 * 建課表的時候選一次，之後就不用再想這件事。
 */

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

/** 節次表的起始形狀。名字和時間都能改，時間預設留白。 */
const DEFAULT_PERIODS = () => [
    ...['0', '1', '2', '3', '4'].map(n => ({ id: 'p' + n, name: n, start: '', end: '' })),
    { id: 'pnoon', name: '中午', start: '', end: '' },
    ...['5', '6', '7', '8', '9', '10', '11', '12']
        .map(n => ({ id: 'p' + n, name: n, start: '', end: '' })),
];

const Timetable = {
    data: null,

    /** 手動展開過的空白區段（記起點 index）。這是瀏覽的暫態，不存檔。 */
    opened: new Set(),

    async init() {
        this.data = await Store.load('課表');
        this.data.sets ??= [];
        this.data.active ??= null;
        if (!this.data.periods?.length) this.data.periods = DEFAULT_PERIODS();
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

    /** 這一份是節次制還是時間制。舊資料沒有 mode，看它有沒有 start 來猜。 */
    mode(set = this.active()) {
        if (!set) return 'period';
        if (set.mode) return set.mode;
        return set.slots?.some(s => s.start) ? 'time' : 'period';
    },

    periods() { return this.data?.periods || []; },
    period(id) { return this.periods().find(p => p.id === id) || null; },
    periodIndex(id) { return this.periods().findIndex(p => p.id === id); },

    /** 一堂課佔了哪幾節（index 範圍）。時間制的回 null。 */
    span(s) {
        if (!s.from) return null;
        const a = this.periodIndex(s.from);
        const b = s.to ? this.periodIndex(s.to) : a;
        if (a < 0) return null;
        return { a, b: b < a ? a : b };
    },

    /** 這一堂幾點開始。節次沒設時間就沒有——那不是錯，是還沒填。 */
    startOf(s) {
        if (s.start) return s.start;
        return this.period(s.from)?.start || '';
    },

    endOf(s) {
        if (s.end) return s.end;
        return this.period(s.to || s.from)?.end || '';
    },

    /** 排序用。有時間的照時間，只有節次的照節次順序排在後面。 */
    sortKey(s) {
        const t = this.startOf(s);
        if (t) return mins(t);
        const sp = this.span(s);
        return sp ? 10000 + sp.a : 99999;
    },

    /** 時間線上那一列左邊寫什麼：有時間寫時間，沒有就寫節次 */
    whenText(s) {
        const a = this.startOf(s), b = this.endOf(s);
        if (a) return b ? `${a}–${b}` : a;
        const sp = this.span(s);
        if (!sp) return '';
        const names = this.periods();
        return sp.a === sp.b
            ? `第 ${names[sp.a].name} 節`
            : `${names[sp.a].name}–${names[sp.b].name} 節`;
    },

    /** 星期幾的課，早的排前面 */
    onWeekday(w) {
        return this.slots()
            .filter(s => Number(s.day) === w)
            .sort((a, b) => this.sortKey(a) - this.sortKey(b));
    },

    /** 某一天（"2026-09-04"）有哪些課 */
    on(day) {
        return this.onWeekday(parseYmd(day).getDay());
    },

    /** 網格要畫哪幾個星期。沒課的話給一到五。 */
    days() {
        const used = new Set(this.slots().map(s => Number(s.day)));
        const base = [1, 2, 3, 4, 5];
        for (const d of used) if (!base.includes(d)) base.push(d);
        return base.sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b));
    },

    /**
     * 完全沒課的連續節次。
     *
     * 為什麼要收：課通常擠在一天的某幾節（她的課全在 9-12 節），
     * 前面九列整片空白。全部畫出來的話，這張表拉得比螢幕還長，
     * **要捲過一大片什麼都沒有的格子才看得到重點**。
     *
     * 少於三節不收——收起來省不到多少，反而多一個要點開的東西。
     */
    emptyRuns() {
        const used = new Set();
        for (const s of this.slots()) {
            const sp = this.span(s);
            if (!sp) continue;
            for (let i = sp.a; i <= sp.b; i++) used.add(i);
        }

        const runs = [];
        let start = null;
        const n = this.periods().length;
        for (let i = 0; i <= n; i++) {
            if (i < n && !used.has(i)) {
                if (start === null) start = i;
            } else if (start !== null) {
                if (i - start >= 3) runs.push({ a: start, b: i - 1 });
                start = null;
            }
        }
        // 一堂課都沒有的時候不要把整張表收成一條，
        // 那樣新使用者連一格可以點的地方都看不到
        return used.size ? runs : [];
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

        box.append(this.mode() === 'period' ? this.periodGrid() : this.timeGrid());
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
            this.data.sets.length && this.mode() === 'period' ? el('button', {
                type: 'button', class: 'btn small ghost', text: '節次時間',
                title: '設定每一節幾點到幾點・留白也能用',
                onclick: () => this.editPeriods(),
            }) : null,
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

    /**
     * 節次網格。學校發的課表長什麼樣，這裡就長什麼樣。
     *
     * **空格是可以點的。** 這是這一版最重要的改動：
     * 原本要按「加一堂」再從頭選星期和節次，等於把眼睛已經看到的資訊
     * （我要加在週一第 9 節）再用手輸入一次。點格子的話那兩個欄位已經填好了。
     */
    periodGrid() {
        const days = this.days();
        const periods = this.periods();

        // 欄數走 CSS 變數，不寫死 grid-template-columns——
        // inline style 的優先級最高，寫死的話手機那組 media query
        // 永遠蓋不過它，五欄就會擠到螢幕外面去。
        const grid = el('div', { class: 'tt-p', style: `--cols:${days.length}` });

        // **每一格都明確指定 grid-column / grid-row，不靠自動排版。**
        // 跨節的課會讓下面幾列少掉一格（那些位置被佔走了），
        // auto-placement 就會把後面的格子往前補——結果整列往左位移一格，
        // 星期四的課看起來排在星期三。畫面看起來還是一張整齊的表，
        // 只是內容錯的，這種錯最難發現。
        grid.append(el('div', { class: 'tt-p-corner', text: '節次', style: 'grid-column:1;grid-row:1' }));
        days.forEach((d, di) => {
            grid.append(el('div', {
                class: 'tt-p-wd' + (d === new Date().getDay() ? ' now' : ''),
                style: `grid-column:${di + 2};grid-row:1`,
            }, [
                // 手機上欄寬只有六十幾像素，「星期一」three 個字排不下。
                // 兩個都放進去，由 CSS 決定顯示哪一個。
                el('span', { class: 'wd-long', text: `星期${WEEK[d]}` }),
                el('span', { class: 'wd-short', text: WEEK[d] }),
            ]));
        });

        // 哪些格子已經被跨節的課佔走了，不要在上面再畫一個空格
        const taken = new Set();
        for (const s of this.slots()) {
            const sp = this.span(s);
            if (!sp) continue;
            for (let i = sp.a; i <= sp.b; i++) taken.add(`${s.day}:${i}`);
        }

        // 完全沒課的連續節次收成一條。點一下展開。
        const folded = new Map();       // period index → 這一段的起點
        for (const r of this.emptyRuns()) {
            if (this.opened.has(r.a)) continue;
            for (let i = r.a; i <= r.b; i++) folded.set(i, r);
        }

        // 折起來的一段只佔一列，所以後面每一列的列號都要往前挪，
        // 不然中間會留下一大片沒有人畫的空列。
        const rowOf = [];
        let r = 2;
        for (let i = 0; i < periods.length; i++) {
            const run = folded.get(i);
            rowOf[i] = r;
            if (!run || run.b === i) r++;
        }

        periods.forEach((p, i) => {
            const row = rowOf[i];                   // 第 1 列是星期表頭

            const run = folded.get(i);
            if (run) {
                // 一段只畫一條，畫在起點那一列
                if (run.a !== i) return;
                grid.append(el('button', {
                    type: 'button',
                    class: 'tt-p-fold',
                    style: `grid-column:1 / -1;grid-row:${row}`,
                    onclick: () => { this.opened.add(run.a); this.render(); },
                }, [
                    `第 ${periods[run.a].name}–${periods[run.b].name} 節沒有課`,
                    el('span', { class: 'sub', text: '　點一下展開' }),
                ]));
                return;
            }

            grid.append(el('div', { class: 'tt-p-n', style: `grid-column:1;grid-row:${row}` }, [
                el('div', { class: 'tt-p-name', text: p.name }),
                p.start ? el('div', { class: 'tt-p-time', text: p.start }) : null,
            ]));

            days.forEach((d, di) => {
                const col = di + 2;
                const here = this.slots().find(s => {
                    const sp = this.span(s);
                    return Number(s.day) === d && sp && sp.a === i;
                });

                if (here) {
                    const sp = this.span(here);
                    const l = Prefs.label(here.label);
                    grid.append(el('button', {
                        type: 'button',
                        class: 'tt-p-slot',
                        style: `grid-column:${col};grid-row:${row} / ${rowOf[sp.b] + 1};`
                            + (l ? `--slot:${l.color}` : ''),
                        title: '點一下改這一堂',
                        onclick: () => this.editSlot(here),
                    }, [
                        el('div', { class: 'tt-p-title', text: here.name }),
                        here.teacher ? el('div', { class: 'tt-p-sub', text: here.teacher }) : null,
                        here.place ? el('div', { class: 'tt-p-sub', text: here.place }) : null,
                    ]));
                    return;
                }

                if (taken.has(`${d}:${i}`)) return;

                grid.append(el('button', {
                    type: 'button',
                    class: 'tt-p-empty',
                    style: `grid-column:${col};grid-row:${row}`,
                    'aria-label': `星期${WEEK[d]} 第 ${p.name} 節・加一堂`,
                    title: '點一下加一堂',
                    onclick: () => this.editSlot(null, { day: d, from: p.id }),
                }, [el('span', { class: 'plus', text: '＋' })]));
            });
        });

        return el('div', { class: 'tt-wrap' }, [grid]);
    },

    /** 時間軸網格（班表用）。按實際時間擺，所以 9:10 的班就真的在 9:10。 */
    timeGrid() {
        let lo = 8 * 60, hi = 18 * 60;
        for (const s of this.slots()) {
            lo = Math.min(lo, mins(this.startOf(s)) || lo);
            hi = Math.max(hi, mins(this.endOf(s) || this.startOf(s)));
        }
        lo = Math.floor(lo / 60) * 60;
        hi = Math.ceil(hi / 60) * 60;

        const PX = 1.05;
        const days = this.days();
        const grid = el('div', {
            class: 'tt-grid',
            style: `--cols:${days.length}; --h:${(hi - lo) * PX}px`,
        });

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
            for (let t = lo; t <= hi; t += 60) {
                col.append(el('div', { class: 'tt-line', style: `top:${(t - lo) * PX}px` }));
            }
            for (const s of this.onWeekday(d)) {
                const a = mins(this.startOf(s));
                const b = mins(this.endOf(s) || this.startOf(s));
                const l = Prefs.label(s.label);
                col.append(el('button', {
                    type: 'button',
                    class: 'tt-slot',
                    title: [s.name, this.whenText(s), s.place, s.teacher].filter(Boolean).join('　'),
                    style: `top:${(a - lo) * PX}px; height:${Math.max(26, (b - a) * PX)}px;`
                        + (l ? `--slot:${l.color}` : ''),
                    onclick: () => this.editSlot(s),
                }, [
                    el('div', { class: 'tt-name ellipsis', text: s.name }),
                    el('div', { class: 'tt-time', text: this.whenText(s) }),
                    s.place ? el('div', { class: 'tt-place ellipsis', text: s.place }) : null,
                ]));
            }
            grid.append(col);
        }

        return el('div', { class: 'tt-wrap' }, [grid]);
    },

    /**
     * 網格底下的清單。
     *
     * 手機上格子放不下老師和教室（`.tt-p-sub` 在小螢幕是收起來的），
     * 這份補的就是那些細節。
     *
     * **但它預設是闔上的。** 之前直接攤開，手機上等於同一週的課
     * 從頭到尾講兩遍——先看一張網格，再往下捲過五個星期的清單，
     * 頁面長度翻倍卻沒有多講幾個字。要老師教室的時候再打開。
     */
    list() {
        const count = this.slots().length;

        // **時間制的時候不能收。** 手機上時間軸網格是整個藏起來的
        // （橫捲的表在手機上讀不了），這份清單就是唯一看得到課的地方，
        // 收起來等於課表整個不見。節次制才收——上面已經有一張網格了。
        const foldable = this.mode() === 'period' && count > 0;

        const box = el('details', {
            class: 'tt-list' + (foldable ? '' : ' plain'), open: !foldable,
        }, [
            el('summary', { class: 'tt-more',
                text: foldable ? `老師、教室（${count} 堂）` : '這禮拜的課' }),
        ]);
        if (!count) {
            box.append(el('div', { class: 'empty', style: 'padding:26px 4px' }, [
                icon('clock', 24), '這份還是空的',
                el('div', { class: 'hint', text: this.mode() === 'period'
                    ? '在上面的格子點一下就能加一堂' : '按「加一堂」填幾點到幾點' }),
            ]));
            return box;
        }
        for (const d of this.days()) {
            const rows = this.onWeekday(d);
            if (!rows.length) continue;
            box.append(el('div', { class: 'day-group' }, [
                el('div', { class: 'day-head' }, [
                    el('span', {
                        class: 'day-name' + (d === new Date().getDay() ? ' now' : ''),
                        text: `星期${WEEK[d]}`,
                    }),
                    el('span', { class: 'day-count', text: `${rows.length} 堂` }),
                ]),
                ...rows.map(s => el('div', {
                    class: 'event-row', onclick: () => this.editSlot(s),
                }, [
                    el('div', { class: 'event-time', text: this.whenText(s) }),
                    el('div', { class: 'grow' }, [
                        el('div', { class: 'title ellipsis' }, [
                            Prefs.dot(s.label), el('span', { text: s.name }),
                        ]),
                        el('div', { class: 'meta ellipsis',
                            text: [s.teacher, s.place].filter(Boolean).join('　') || null }),
                    ]),
                ])),
            ]));
        }
        return box;
    },

    /* ── 一堂課 ─────────────────────────────────── */

    /** @param at 從格子點進來時帶的 {day, from}，那兩欄就不用再選一次 */
    editSlot(s, at = null) {
        const isNew = !s;
        const isPeriod = this.mode() === 'period';
        s = s || {
            id: uid(), name: '', day: at?.day ?? 1,
            from: at?.from ?? this.periods()[0]?.id, to: at?.from ?? this.periods()[0]?.id,
            start: '', end: '', place: '', teacher: '', label: null,
        };

        $('#dlg-slot-title').textContent = isNew ? '加一堂' : '改這一堂';
        $('#k-name').value = s.name;
        fillSelect($('#k-day'), WEEK.map((w, i) => ({ value: String(i), label: `星期${w}` })), String(s.day));

        $('#k-period-fields').hidden = !isPeriod;
        $('#k-time-fields').hidden = isPeriod;
        if (isPeriod) {
            const opts = this.periods().map(p => ({ value: p.id, label: `第 ${p.name} 節` }));
            fillSelect($('#k-from'), opts, s.from || opts[0]?.value);
            fillSelect($('#k-to'), opts, s.to || s.from || opts[0]?.value);
        } else {
            $('#k-start').value = s.start || '';
            $('#k-end').value = s.end || '';
        }

        $('#k-place').value = s.place || '';
        $('#k-teacher').value = s.teacher || '';
        Prefs.fillSelect($('#k-label'), s.label);
        $('#k-delete').hidden = isNew;

        const dlg = openDialog('#dlg-slot');

        $('#k-save').onclick = () => {
            const name = $('#k-name').value.trim();
            if (!name) return toast('這堂叫什麼？', true);

            const patch = {
                name,
                day: Number($('#k-day').value),
                place: $('#k-place').value.trim(),
                teacher: $('#k-teacher').value.trim(),
                label: $('#k-label').value || null,
            };

            if (isPeriod) {
                const from = $('#k-from').value;
                let to = $('#k-to').value;
                // 反過來選（第 10 節到第 9 節）就自己調回來，不要丟錯誤給她。
                // 這是「我看得出你的意思」的情況，不是「你填錯了」。
                if (this.periodIndex(to) < this.periodIndex(from)) to = from;
                Object.assign(patch, { from, to, start: '', end: '' });
            } else {
                const start = $('#k-start').value;
                const end = $('#k-end').value;
                if (!start) return toast('幾點開始？', true);
                if (end && end <= start) return toast('結束時間不能比開始早', true);
                Object.assign(patch, { start, end, from: null, to: null });
            }

            Object.assign(s, patch, { updatedAt: stamp() });
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

    /* ── 節次時間 ───────────────────────────────── */

    editPeriods() {
        const box = $('#period-editor');
        const draft = this.periods().map(p => ({ ...p }));

        clear(box);
        for (const p of draft) {
            box.append(el('div', { class: 'period-row' }, [
                el('input', {
                    class: 'period-name', value: p.name, 'aria-label': '節次名稱',
                    oninput: e => { p.name = e.target.value; },
                }),
                el('input', {
                    type: 'time', value: p.start, 'aria-label': `第 ${p.name} 節開始`,
                    oninput: e => { p.start = e.target.value; },
                }),
                el('span', { class: 'sub', text: '–' }),
                el('input', {
                    type: 'time', value: p.end, 'aria-label': `第 ${p.name} 節結束`,
                    oninput: e => { p.end = e.target.value; },
                }),
            ]));
        }

        const dlg = openDialog('#dlg-periods');
        $('#pd-save').onclick = () => {
            this.data.periods = draft;
            this.save();
            dlg.close();
            this.render();
            Agenda.render();
            Overview.render();
            toast('存好了');
        };
    },

    /* ── 整份課表 ───────────────────────────────── */

    editSet(set) {
        const isNew = !set;
        $('#dlg-set-title').textContent = isNew ? '新的課表' : '改課表';
        $('#p-name').value = set?.name || '';
        $('#p-mode').value = set ? this.mode(set) : 'period';
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
            const mode = $('#p-mode').value;

            if (isNew) {
                // 複製的話要換掉每一堂的 id，不然兩份課表共用同一個 id，
                // 改其中一份會連另一份一起改掉
                const from = $('#p-copy-field').hidden ? '' : $('#p-copy').value;
                const src = from ? this.set(from)?.slots || [] : [];
                const fresh = {
                    id: uid(), name, mode, updatedAt: stamp(),
                    // 複製的話每一堂都要換 id 和時間戳，不然兩份課表
                    // 共用同一個 id，改其中一份會連另一份一起改掉
                    slots: src.map(s => ({ ...s, id: uid(), updatedAt: stamp() })),
                };
                this.data.sets.push(fresh);
                this.data.active = fresh.id;
            } else {
                set.name = name;
                set.mode = mode;
                set.updatedAt = stamp();
            }
            this.save();
            dlg.close();
            this.render();
            Agenda.render();
            Overview.render();
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
                        el('div', { class: 'sub',
                            text: `${s.slots.length} 堂・`
                                + (this.mode(s) === 'period' ? '節次制' : '按時間') }),
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
                            if (!confirmTwice(`刪掉「${s.name}」和裡面的 ${s.slots.length} 堂？`)) return;
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
function confirmTwice(msg) {
    if (_armed === msg) { _armed = null; return true; }
    _armed = msg;
    toast(msg + '　再按一次確定', true);
    setTimeout(() => { if (_armed === msg) _armed = null; }, 4000);
    return false;
}
