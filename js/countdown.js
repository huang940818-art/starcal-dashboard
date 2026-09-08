/* 倒數。
 *
 * 她的原話：「我要增加　離寒假　暑假　國定假日或是期中期末考還有幾天
 * 這樣的東西　可以自訂」。
 *
 * 跟行程刻意分開。行程是「那天要去做某件事」，倒數是「那天會到」——
 * 寒假不是一個要赴的約，它是一個在遠處慢慢靠近的日子。放進「接下來」的
 * 時間線會被明天的早班擠掉，而它的意義正是**離現在很遠**。
 *
 * 三件事這個模組要答對，答錯了都不會報錯：
 *
 *   1. 剩幾天　　用日曆上的天數差，不是毫秒除以 86400000。夏令時間、
 *                月底、閏年都會讓後者少一天或多一天。
 *   2. 期間　　　寒假不是一個點，是一段。開始了要說「進行中」，
 *                不是消失，也不是繼續說「還有 -3 天」。
 *   3. 每年　　　國定假日明年還會再來一次。過完就自己跳到明年，
 *                不用她每年重填一次。
 */

const Countdown = {
    data: null,

    async init() {
        this.data = await Store.load('倒數');
        this.data.items ??= [];
        const add = $('#add-countdown');
        if (add) add.onclick = () => this.edit(null);
    },

    save() { Store.save('倒數'); },

    /* ── 算日子 ────────────────────────────────────────
     *
     * **用日曆天數差，不要拿毫秒去除。**
     * `(b - a) / 86400000` 在跨過日光節約時間的那一天會少一小時，
     * 除出來變成 x.96 天，取整之後整整少一天。台灣現在沒有日光節約，
     * 但這個函式不該建立在「使用者永遠在台灣」上面。
     */
    daysBetween(fromYmd, toYmd) {
        const a = parseYmd(fromYmd), b = parseYmd(toYmd);
        return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
                         - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()))
                          / 86400000);
    },

    /** 把 "2026-01-20" 換成指定年份的同一天。2/29 落在平年就退到 2/28。 */
    onYear(dateStr, year) {
        const d = parseYmd(dateStr);
        const m = d.getMonth(), day = d.getDate();
        const last = new Date(year, m + 1, 0).getDate();
        return ymd(new Date(year, m, Math.min(day, last)));
    },

    /**
     * 這一筆這次要算的是哪一段日期。
     *
     * 不是每年重複的就是原本填的那組。每年重複的要往前推到「還沒過完的
     * 那一次」：今年的已經過完就換明年。
     *
     * **跨年的期間要接起來。** 例如 12/25 到 1/5，結束的月日比開始小，
     * 那個 1/5 是隔年的 1/5——不接的話會算出一段負長度的假期，
     * 畫面上會變成「還有 -354 天結束」。
     */
    occurrence(item, today = todayStr()) {
        const span = (startY) => {
            const start = this.onYear(item.date, startY);
            if (!item.endDate) return { start, end: start };
            // 結束的月日比開始小＝跨年
            const crosses = item.endDate.slice(5) < item.date.slice(5);
            return { start, end: this.onYear(item.endDate, startY + (crosses ? 1 : 0)) };
        };

        if (!item.yearly) {
            const start = item.date;
            const end = item.endDate && item.endDate >= start ? item.endDate : start;
            return { start, end };
        }

        const thisYear = parseYmd(today).getFullYear();
        // 從去年開始找：跨年的假期（12/25–1/5）在 1 月的時候，
        // 還在進行中的那一次是**去年**開始的。
        for (const y of [thisYear - 1, thisYear, thisYear + 1]) {
            const s = span(y);
            if (s.end >= today) return s;
        }
        return span(thisYear + 1);
    },

    /**
     * 一筆倒數現在長什麼樣。
     *
     * `phase`：
     *   before  還沒開始，`days` 是還有幾天
     *   today   就是今天開始
     *   during  已經開始、還沒結束，`days` 是還有幾天結束
     *   past    整個過完了（只有不重複的才會走到這裡）
     */
    statusOf(item, today = todayStr()) {
        const { start, end } = this.occurrence(item, today);
        if (today < start) {
            return { start, end, phase: 'before', days: this.daysBetween(today, start) };
        }
        if (today > end) {
            return { start, end, phase: 'past', days: this.daysBetween(end, today) };
        }
        if (today === start) {
            return { start, end, phase: 'today', days: 0 };
        }
        return { start, end, phase: 'during', days: this.daysBetween(today, end) };
    },

    /** 畫面上那句話。**只有這裡決定文案**，卡片和清單共用同一句。 */
    wordOf(st) {
        if (st.phase === 'past') return `${st.days} 天前就過了`;
        if (st.phase === 'today') return '就是今天';
        if (st.phase === 'during') {
            return st.days === 1 ? '明天最後一天' : `進行中　還有 ${st.days} 天`;
        }
        if (st.days === 1) return '明天';
        return `還有 ${st.days} 天`;
    },

    /**
     * 排好順序的清單，每一筆帶上狀態。
     *
     * 進行中的排在最前面（那是「現在」，比任何未來都近），
     * 其餘照還有幾天由近到遠。過完的排最後——不重複的過期項目
     * 還留在清單裡是故意的：**要讓她自己決定刪掉還是改日期**，
     * 自動清掉的話她只會發現東西不見了。
     */
    sorted(today = todayStr()) {
        const rank = { during: 0, today: 0, before: 1, past: 2 };
        return this.data.items
            .map(item => ({ item, st: this.statusOf(item, today) }))
            .sort((a, b) => (rank[a.st.phase] - rank[b.st.phase])
                         || (a.st.days - b.st.days)
                         || a.item.title.localeCompare(b.item.title, 'zh-TW'));
    },

    /** 總覽卡片上要出現的：過完的不算。 */
    upcoming(today = todayStr()) {
        return this.sorted(today).filter(r => r.st.phase !== 'past');
    },

    /* ── 畫面 ──────────────────────────────────────── */

    /**
     * 日期本身怎麼寫。
     *
     * **這裡不用 `relativeDay()`。** 那個對一週內的日子會回「3 天後」，
     * 而右邊那格已經寫著「還有 3 天」——同一件事講兩次。
     * 這一行要回答的是另一個問題：**那天是幾號**。
     */
    dateLabel(s) {
        const d = parseYmd(s);
        const sameYear = d.getFullYear() === new Date().getFullYear();
        return (sameYear ? '' : `${d.getFullYear()}/`)
             + `${d.getMonth() + 1}/${d.getDate()}`;
    },

    /** 一列：名字 ＋ 那句話。卡片和管理清單長得一樣，只差點下去做什麼。 */
    row(r, onclick) {
        const { item, st } = r;
        return el('div', {
            class: 'countdown-row' + (st.phase === 'past' ? ' past' : ''),
            ...(onclick ? { style: 'cursor:pointer', onclick } : {}),
        }, [
            el('div', { class: 'grow' }, [
                el('div', { class: 'title ellipsis', text: item.title }),
                el('div', { class: 'meta',
                            text: (st.start === st.end
                                     ? this.dateLabel(st.start)
                                     : `${this.dateLabel(st.start)} – ${this.dateLabel(st.end)}`)
                                  + (item.yearly ? '　每年' : '') }),
            ]),
            el('div', {
                class: 'countdown-days'
                     + (st.phase === 'today' || st.phase === 'during' ? ' now' : ''),
                text: this.wordOf(st),
            }),
        ]);
    },

    render() {
        const box = $('#countdown-list');
        if (!box) return;
        clear(box);

        const rows = this.sorted();
        if (!rows.length) {
            box.append(el('div', { class: 'empty' }, [
                icon('calendar', 26), '還沒有要倒數的日子',
                el('div', { class: 'hint',
                            text: '寒假、期中考、國定假日——填一個日期就會開始數' }),
            ]));
            return;
        }
        box.append(...rows.map(r => this.row(r, () => this.edit(r.item))));
    },

    /* ── 改一筆 ────────────────────────────────────── */

    edit(item) {
        const isNew = !item;
        item = item || { id: uid(), title: '', date: todayStr(),
                         endDate: '', yearly: false };

        $('#dlg-countdown-title').textContent = isNew ? '加一個倒數' : '改倒數';
        $('#cd-title').value = item.title;
        $('#cd-date').value = item.date;
        $('#cd-end').value = item.endDate || '';
        $('#cd-yearly').checked = !!item.yearly;
        $('#cd-delete').hidden = isNew;

        $('#cd-delete').onclick = () => {
            this.data.items = this.data.items.filter(x => x.id !== item.id);
            this.save();
            this.refresh();
            $('#dlg-countdown').close();
            toastAction(`${item.title}刪掉了`, '復原', () => {
                this.data.items.push(item);
                this.save();
                this.refresh();
            });
        };

        $('#cd-save').onclick = () => {
            const title = $('#cd-title').value.trim();
            if (!title) return toast('要有名字才知道在數什麼', true);
            const date = $('#cd-date').value;
            if (!date) return toast('要有日期才數得出來', true);
            const endDate = $('#cd-end').value;
            // 不重複的才擋：每年重複的「結束比開始早」是跨年，不是打錯
            if (endDate && !$('#cd-yearly').checked && endDate < date) {
                return toast('結束日期比開始還早', true);
            }

            Object.assign(item, {
                title, date, endDate,
                yearly: $('#cd-yearly').checked,
            });
            if (isNew) this.data.items.push(item);
            this.save();
            this.refresh();
            $('#dlg-countdown').close();
        };

        openDialog('#dlg-countdown');
    },

    /** 改完兩邊都要重畫：管理清單在「接下來」，卡片在總覽。 */
    refresh() {
        this.render();
        Overview.render();
    },
};
