/* 打工的工時與薪水。
 *
 * 她的原話：「假設今天我上班是 PT，按我的工時去算我今天賺了多少，
 * 然後還可以顯示我今天花了多少」，以及「這個為大學生做的，
 * 大學生大部分都是 PT」。
 *
 * ## 為什麼這是划算的
 *
 * **她不用多輸入任何東西。** 班別樣板上本來就有幾點到幾點，排班就是
 * 在月曆上點日期。加兩個欄位（時薪、休息幾分鐘）就算得出來——
 * 大部分「算收入」的功能都要人每天再記一次，這個不用。
 *
 * ## 三件刻意的事
 *
 * **1. 時薪和休息抄一份到每一筆班上，不是只存在班別樣板裡。**
 * 六月加薪，如果只存在樣板上，三到五月的預估會全部用新時薪重算——
 * 跟她當時實際領的對不起來，而且對不起來的原因完全看不出來。
 * 排班的時候本來就會把名字和時間抄進行程裡（「排出來的就是普通行程」），
 * 時薪和休息一起抄。改樣板只影響之後排的班。
 *
 * **2. 休息時間不自動填。** 法定是「連續工作 4 小時至少休息 30 分鐘」，
 * 但**扣不扣薪是店家的做法，法律決定不了**——有的店吃飯時間照算。
 * 自動填 30 會給出一個少算的薪水，而且她不知道是我填的。
 * 所以預設 0，改成把算出來的工時即時寫在旁邊：八小時的班休息留 0，
 * 她會看到「實際工時 8 小時」，自己就發現了。
 * **用量的，不要丟一個開關給她選。**
 *
 * **3. 賺到的不是入帳的。** 今天賺的 800 下個月才發。這裡算出來的一律
 * 是「預估」，而且畫面上要寫「還沒入帳」——跟「今天花了 440」並排的話，
 * 很容易讀成「我今天淨賺 360」，那是假的。
 * 而且**預估絕對不會寫進記帳**：那不是一筆帳，混進去會把收支弄髒。
 */

const Shifts = {

    /* ── 工時 ──────────────────────────────────────────
     *
     * 全部用「分鐘」算再換成小時。小時用浮點數一路加下去，
     * 十五分鐘的班加二十次就會跑出 .0000001 那種尾巴。
     */

    /**
     * 一段 "HH:MM"–"HH:MM" 有幾分鐘。
     *
     * **結束比開始早＝跨夜。** 大夜班 22:00–06:00 不處理的話會算出
     * 負八小時，而負的工時會讓整個月的合計變小——**錯得看不出來**，
     * 因為畫面上只會顯示一個比較小的數字，不會顯示負號。
     */
    minutesBetween(start, end) {
        const m = t => {
            const [h, min] = String(t || '').split(':').map(Number);
            return Number.isFinite(h) && Number.isFinite(min) ? h * 60 + min : null;
        };
        const a = m(start), b = m(end);
        if (a === null || b === null) return null;
        return b >= a ? b - a : b + 24 * 60 - a;
    },

    /**
     * 一筆班實際有薪的分鐘數。休息扣掉。
     *
     * @returns null＝算不出來（沒填時間）。**不是 0**——
     *          「這天沒工時」和「這天算不出工時」是兩件事，
     *          後者要講出來讓她去補，回 0 的話它會安靜地被當成沒上班。
     */
    paidMinutes(row) {
        const total = this.minutesBetween(row.time, row.endTime);
        if (total === null) return null;
        // 休息比班還長是打錯字。扣到 0 為止，不要變成負的。
        return Math.max(total - (Number(row.breakMin) || 0), 0);
    },

    hours(row) {
        const m = this.paidMinutes(row);
        return m === null ? null : m / 60;
    },

    /** 這一筆班賺多少。沒填時薪或算不出工時就是 null。 */
    pay(row) {
        const h = this.hours(row);
        const rate = Number(row.rate) || 0;
        if (h === null || rate <= 0) return null;
        return h * rate;
    },

    /** 工時寫給人看。「3.5 小時」比「210 分鐘」好讀，整數不要拖 .0 */
    hoursText(h) {
        if (h === null || h === undefined) return '—';
        const r = Math.round(h * 100) / 100;
        return (Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0$/, '')) + ' 小時';
    },

    /* ── 哪些行程算班 ──────────────────────────────────
     *
     * 有 `shift` 欄位的才算。手動加的行程即使叫「打工」也不算——
     * 它沒有時薪也沒有休息時間，算進去只會讓時數對不起來。
     */

    isShift(e) { return !!e && !!e.shift; },

    /** 某一段期間的班，早的在前 */
    inRange(events, start, end) {
        return (events || [])
            .filter(e => this.isShift(e) && e.date >= start && e.date <= end)
            .sort((a, b) => a.date === b.date
                ? (a.time || '').localeCompare(b.time || '')
                : a.date.localeCompare(b.date));
    },

    /** 某個月（"yyyy-MM"）的班 */
    inMonth(events, ym) {
        return this.inRange(events, ym + '-01', ym + '-31');
    },

    onDay(events, day) {
        return this.inRange(events, day, day);
    },

    /**
     * 一批班的合計。
     *
     * @returns days       有排班的天數（同一天兩個班算一天）
     *          hours      算得出來的總工時
     *          pay        算得出來的總預估
     *          noRate     有工時但沒填時薪的筆數
     *          noTime     連時間都沒填、算不出工時的筆數
     *
     * **noRate／noTime 一定要回出去。** 少算的錢不會有任何地方報錯，
     * 只會讓合計安靜地變小——而「我這個月怎麼才賺這麼少」是查不出原因的。
     */
    total(rows) {
        let hours = 0, pay = 0, noRate = 0, noTime = 0;
        const days = new Set();

        for (const e of rows) {
            days.add(e.date);
            const h = this.hours(e);
            if (h === null) { noTime++; continue; }
            hours += h;
            const p = this.pay(e);
            if (p === null) { noRate++; continue; }
            pay += p;
        }
        return { days: days.size, hours, pay, noRate, noTime, count: rows.length };
    },

    /**
     * 對一下薪水：這一期排的班，跟實際領到的差多少。
     *
     * **這才是主角，不是「今天賺多少」。** 「今天賺 800」看過就忘；
     * 「少了 760」她會去翻是哪一天。而休息時間不算薪正是大學生最容易
     * 被少算的地方。
     *
     * @param actual 實際領到多少。**由她自己輸入，不從記帳猜。**
     *   薪水通常是隔月發的（這個月十號發上個月的），拿「這個月的收入」
     *   去比「這個月排的班」一定對不起來；而且獎學金、家裡給的也會混進來。
     *   猜錯的那個差額比沒有差額更糟——她會去找一筆不存在的漏帳。
     * @returns null＝這一期算不出預估（沒有班，或都沒填時薪）
     */
    reconcile(rows, actual) {
        const t = this.total(rows);
        if (!t.pay) return null;
        const got = Number(actual) || 0;
        return {
            ...t,
            actual: got,
            diff: got - t.pay,          // 負的＝領到的比預估少
        };
    },

    /** 有排過班的月份，新的在前。對帳時給她選哪一期。 */
    monthsWithShifts(events) {
        const set = new Set();
        for (const e of (events || [])) {
            if (this.isShift(e) && e.date) set.add(monthOf(e.date));
        }
        return [...set].sort().reverse();
    },

    /* ── 對帳的畫面 ────────────────────────────────── */

    /** 這一期輸入過的「實際領到」。存在資料裡，不是 localStorage——
     *  她會在手機上對完，回電腦上還要看得到。 */
    actualFor(ym) {
        return Number((Cal.data.payslips || {})[ym]) || 0;
    },

    saveActual(ym, value) {
        Cal.data.payslips ??= {};
        const n = Number(value) || 0;
        if (n > 0) Cal.data.payslips[ym] = n;
        else delete Cal.data.payslips[ym];
        Cal.save();
    },

    openReconcile(ym = thisMonth()) {
        const months = this.monthsWithShifts(Cal.data.events);
        if (!months.length) return toast('還沒有排過班', true);

        const sel = $('#ps-month');
        fillSelect(sel, months.map(m => ({ value: m, label: monthLabel(m) })),
                   months.includes(ym) ? ym : months[0]);

        const actual = $('#ps-actual');
        const draw = () => {
            const m = sel.value;
            actual.value = this.actualFor(m) || '';
            this.renderReconcile(m);
        };
        sel.onchange = draw;
        actual.oninput = () => {
            this.saveActual(sel.value, actual.value);
            this.renderReconcile(sel.value);
            Overview.render();
        };

        draw();
        openDialog('#dlg-payslip');
    },

    renderReconcile(ym) {
        const box = $('#ps-body');
        clear(box);

        const rows = this.inMonth(Cal.data.events, ym);
        const r = this.reconcile(rows, this.actualFor(ym));

        if (!r) {
            box.append(el('div', { class: 'empty' }, [
                icon('clock', 26), monthLabel(ym) + '算不出預估',
                el('div', { class: 'hint', text: '那一期的班還沒填時薪' }),
            ]));
            return;
        }

        /* 差額是主角。**先寫差額，再寫兩個數字**——
         * 「預估 11,780、實際 11,020」要她自己減一次，
         * 而她要的就是那個減出來的數字。 */
        const none = !r.actual;
        box.append(el('div', { class: 'ps-head' }, [
            none
                ? el('div', { class: 'sub', text: '把薪資單上的數字填進去，就看得到差多少' })
                : el('div', {
                    class: 'big money-num' + (r.diff < 0 ? ' negative' : ''),
                    text: r.diff === 0 ? '剛好一樣'
                        : (r.diff < 0 ? '少了 ' : '多了 ') + money(Math.abs(r.diff)),
                  }),
            el('div', { class: 'sub',
                text: `預估 ${money(r.pay)}`
                    + (none ? '' : `　實際 ${money(r.actual)}`)
                    + `　${r.days} 天　${this.hoursText(r.hours)}` }),
        ]));

        if (r.noRate || r.noTime) {
            const parts = [];
            if (r.noRate) parts.push(`${r.noRate} 筆還沒填時薪`);
            if (r.noTime) parts.push(`${r.noTime} 筆沒填時間`);
            box.append(el('p', { class: 'sub shift-warn',
                text: parts.join('、') + '，沒算進預估裡——差額會因此看起來比較大。' }));
        }

        /* 每一天列出來。**這才是差額有用的原因**：
         * 看到「少了 760」之後要查是哪一天被漏掉或被少算，
         * 沒有這張表的話那個數字只能讓人不安，不能讓人行動。 */
        const list = el('div', { class: 'ps-list' });
        for (const e of rows) {
            const h = this.hours(e);
            const p = this.pay(e);
            const d = parseYmd(e.date);
            list.append(el('div', { class: 'ps-row' }, [
                el('div', { class: 'ps-day', text: `${d.getMonth() + 1}/${d.getDate()}`
                    + '　' + '日一二三四五六'[d.getDay()] }),
                el('div', { class: 'grow' }, [
                    el('div', { class: 'ellipsis', text: e.title }),
                    el('div', { class: 'sub', text: [
                        e.time && e.endTime ? `${e.time}–${e.endTime}` : '沒填時間',
                        Number(e.breakMin) ? `休 ${e.breakMin} 分` : null,
                        h === null ? null : this.hoursText(h),
                    ].filter(Boolean).join('　') }),
                ]),
                el('div', { class: 'money-num', text: p === null ? '—' : money(p) }),
            ]));
        }
        box.append(list);
    },
};
