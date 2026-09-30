/* 月底回顧。
 *
 * 她的原話：「做一個月底總回顧」，要看記帳、行程和待辦（健康只放 App）。
 *
 * **只在月底前後出現**：最後三天回顧這個月，下個月一號到七號回顧上個月。
 * 平常一個月有二十天它都不該佔位置——總覽只回答「現在需要我注意什麼」，
 * 而回顧只有在一個月要收尾的時候才是那件事。
 *
 * 這一支只有算術，畫面在 overview.js 的 renderReview。
 * 算術跟畫面分開，是為了測得到：「這個月花了多少」算錯了不會報錯，
 * 只會安靜地給一個錯的數字。
 */

const Review = {
    /** 月底倒數幾天開始出現 */
    TAIL_DAYS: 3,
    /** 下個月前幾天還留著 */
    HEAD_DAYS: 7,

    /** 這一天要回顧哪個月（"yyyy-MM"）。不在月底前後就是 null。 */
    monthFor(day) {
        const ym = monthOf(day);
        const d = Number(day.slice(8, 10));
        if (d > daysInMonth(ym) - this.TAIL_DAYS) return ym;
        if (d <= this.HEAD_DAYS) return this.prevMonth(ym);
        return null;
    },

    prevMonth(ym) {
        let [y, m] = ym.split('-').map(Number);
        m -= 1;
        if (m === 0) { m = 12; y -= 1; }
        return `${y}-${pad(m)}`;
    },

    /** 這個月最後一天（"yyyy-MM-dd"） */
    lastDay(ym) { return `${ym}-${pad(daysInMonth(ym))}`; },

    /** 記帳那一段。M 是 Money（要有 data 和那幾支查詢）。 */
    money(ym, M) {
        const s = M.monthSummary(ym);
        const prev = M.monthSummary(this.prevMonth(ym));

        /* 跟上個月比的是支出，不是淨額——淨額會被「這個月剛好發薪水」
         * 整個翻過來，那不是她花錢習慣的變化。
         * 上個月沒記帳就不比：「比上個月多 ∞%」是沒有意義的數字。 */
        const change = prev.expense > 0 ? (s.expense - prev.expense) / prev.expense : null;

        const cats = M.byCategory(ym);
        const used = new Map(cats.map(c => [c.category, c.amount]));

        // 分類預算：只列有設額度的那幾類，超過的在前面、超最多的最前面
        const budgets = M.budgetsFor(ym)
            .filter(b => Number(b.limit) > 0)
            .map(b => ({ category: b.category, limit: Number(b.limit),
                         used: used.get(b.category) || 0 }))
            .sort((a, b) => (b.used - b.limit) - (a.used - a.limit));

        const totalLimit = M.totalBudgetFor(ym);

        return {
            income: s.income, expense: s.expense, net: s.net,
            prevExpense: prev.expense, change,
            top: cats.slice(0, 3),
            budgets,
            over: budgets.filter(b => b.used > b.limit),
            total: totalLimit ? { limit: totalLimit, used: s.expense } : null,
        };
    },

    /** 打工。整個月排出去的班（跟打工卡的「這個月預計」同一套算法）。 */
    shifts(ym, events, S) {
        return S.total(S.inMonth(events, ym));
    },

    /**
     * 上了幾堂課。T 是 Timetable。
     *
     * **只算到 upto 那天（含）**——月底前三天就會出現，那時候
     * 還沒上的課算成「上了」是在騙人。標了「這次不用上」的另外數，
     * 不是直接扣掉不講：停了幾堂是她會想知道的事。
     */
    classes(ym, T, upto) {
        let held = 0, off = 0;
        const end = upto < this.lastDay(ym) ? upto : this.lastDay(ym);
        for (let d = 1; d <= daysInMonth(ym); d++) {
            const day = `${ym}-${pad(d)}`;
            if (day > end) break;
            for (const c of T.on(day)) {
                if (T.isOff(c.id, day)) off++;
                else held++;
            }
        }
        return { held, off };
    },

    /**
     * 待辦。
     *
     * **做完幾件只算有記下完成時間的。** completedAt 是後來才加的欄位，
     * 更早勾掉的那些不知道是哪一天做完的。拿 updatedAt 去猜的話，
     * 改一個錯字就會讓一件八月做完的事跑進九月——所以不猜，
     * 查不到日期的另外寫出幾件，讓她知道這個數字少算了。
     */
    todos(ym, items, today) {
        const inMonth = ms => ms && monthOf(ymd(new Date(ms))) === ym;
        const done = items.filter(i => i.done && inMonth(i.completedAt));
        const undated = items.filter(i => i.done && !i.completedAt).length;

        // 過期：還沒做、期限在今天以前。**這個月以前就過期的也算**——
        // 拖了兩個月的比這個月才過期的更該被看到。
        const overdue = items
            .filter(i => !i.done && i.due && i.due < today && i.due <= this.lastDay(ym))
            .sort((a, b) => a.due.localeCompare(b.due));

        return { done, undated, overdue, open: items.filter(i => !i.done).length };
    },
};
