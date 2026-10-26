/* 總覽最上面那句「今天要幹嘛」。
 *
 * 「今天有 2 件事」只講了數量，底下列標題也只是一串名字——
 * 看的人還是要自己在腦子裡排：幾點開始、現在在做哪件、中間空多久。
 * 這支把它排成一兩句人話：
 *
 *   早上 → 「今天從 06:00 早班開始，到 12:00。接著 18:00 微積分。」
 *   中間 → 「現在：早班，到 12:00。到 18:00 前都空著，接著是微積分。」
 *   晚上 → 「今天排的都結束了。明天 06:00 早班，早點睡。」
 *
 * **全部是規則，不是 AI。** 給別人用的版本沒有後端，也不該有——
 * 公開網頁上放任何金鑰都等於送人。規則寫死的好處是不會講錯、不會亂編。
 * 本機那邊另外有一句會蓋過這句（見 Overview.fetchLocalLine），
 * 拿不到的時候就是這句，所以這句要自己就站得住。
 *
 * say() 是純函式，吃整理好的資料、吐一個字串，測試直接打它。
 * gather() 才去讀 Cal／Timetable／Todo，把畫面上的資料整理成 say() 要的樣子。
 */

const DayPlan = {
    /** 「已經結束了沒」要一個結束時間。沒填結束的行程當作一小時。 */
    DEFAULT_LEN: 60,

    /** 幾點以後開始講明天。早班的人九點就該想明天了，再晚講就來不及早睡。 */
    EVENING: 20 * 60,

    /** 一段空檔要多長才值得講出來。半小時的空檔講了也只是噪音。 */
    GAP: 120,

    /** 列名字最多列幾個，再多就「等 N 件」。一句話塞五個名字就不是一句話了。 */
    LIST_MAX: 2,

    /**
     * @param p.now       現在是幾分（0–1439）
     * @param p.today     今天的事 [{ start:'HH:MM'|'', end:'HH:MM'|'', title, kind:'event'|'class'|'shift' }]
     *                    start 空的＝沒排時間（整天的行程，或節次沒填時間的課）
     * @param p.off       今天停掉的課名
     * @param p.due       今天到期、還沒做的待辦標題
     * @param p.tomorrow  明天的事，格式同 today
     * @returns 一兩句話；什麼資料都沒有時回空字串（新使用者不要看到一句「今天沒事」）
     */
    say({ now, today = [], off = [], due = [], tomorrow = [] }) {
        const m = t => {
            const [h, mm] = String(t).split(':').map(Number);
            return h * 60 + (mm || 0);
        };
        const timed = today.filter(x => x.start)
            .map(x => {
                const s = m(x.start);
                // 結束比開始早＝跨過半夜（夜班 22:00–06:00），算到今天結束為止
                let e = x.end ? m(x.end) : s + this.DEFAULT_LEN;
                if (e <= s) e = 24 * 60;
                return { ...x, s, e };
            })
            .sort((a, b) => a.s - b.s);
        const untimed = today.filter(x => !x.start);

        const nothing = !today.length && !due.length;
        if (nothing && !off.length && !tomorrow.length) return '';

        const parts = [];
        const list = names => names.length > this.LIST_MAX
            ? `${names.slice(0, this.LIST_MAX).join('、')} 等 ${names.length} 件`
            : names.join('、');

        // 整天的行程先講：「期中考週」「放假」這種是整天的底色，比幾點有什麼更先要知道
        const allDay = untimed.filter(x => x.kind !== 'class');
        if (allDay.length) parts.push(`整天：${list(allDay.map(x => x.title))}`);

        const ongoing = timed.filter(x => x.s <= now && now < x.e);
        const upcoming = timed.filter(x => x.s > now);
        const started = timed.some(x => x.s <= now);

        if (ongoing.length) {
            const o = ongoing[0];
            parts.push(`現在：${o.title}` + (o.end ? `，到 ${o.end}` : ''));
        }

        if (upcoming.length) {
            const [next, after] = upcoming;
            if (!started) {
                // 今天還沒開始：講「從幾點開始」，有結束時間就一起講，
                // 「06:00 早班」跟「06:00 早班，到 12:00」差的是下午能不能排別的事
                parts.push(`今天從 ${next.start} ${next.title}開始` + (next.end ? `，到 ${next.end}` : ''));
                if (after) parts.push(`接著 ${after.start} ${after.title}`);
            } else if (!ongoing.length && next.s - now >= this.GAP) {
                parts.push(`到 ${next.start} 前都空著，接著是${next.title}`);
            } else {
                parts.push(`${ongoing.length ? '接著' : '下一件'} ${next.start} ${next.title}`);
            }
            const rest = upcoming.length - (!started && after ? 2 : 1);
            if (rest > 0) parts.push(`之後還有 ${rest} 件`);
        } else if (timed.length && !ongoing.length) {
            parts.push('今天排的都結束了');
        }

        // 節次沒填時間的課：排不進時間線，但也不能當作沒有
        const loose = untimed.filter(x => x.kind === 'class');
        if (loose.length) parts.push(`還有課：${list(loose.map(x => x.title))}`);

        if (due.length) parts.push(`今天要做完：${list(due)}`);

        // 停課只在還沒過完的時候講——晚上十點才說「那堂不用上」已經沒有用了
        if (off.length && now < this.EVENING) {
            parts.push(off.length === 1 ? `${off[0]}這次不用上` : `${off.length} 堂課這次不用上`);
        }

        if (nothing && !parts.length) parts.push('今天沒有排事，整天是你的');

        // 晚上，或今天的都結束了而且已經過了下午，就開始講明天
        const doneForToday = !upcoming.length && !ongoing.length;
        if (now >= this.EVENING || (doneForToday && now >= 17 * 60)) {
            const t = tomorrow.filter(x => x.start).sort((a, b) => m(a.start) - m(b.start));
            if (t.length) {
                // 明天八點以前就要開始的話，提醒早點睡——這是唯一一句不是在報資料的話，
                // 因為它直接從資料推得出來，不用猜這個人的習慣
                const early = m(t[0].start) < 8 * 60;
                parts.push(`明天 ${t[0].start} ${t[0].title}` + (early ? '，早點睡' : ''));
            } else if (tomorrow.length) {
                parts.push(`明天：${list(tomorrow.map(x => x.title))}`);
            } else if (now >= this.EVENING) {
                parts.push('明天沒有排事');
            }
        }

        return parts.join('。') + '。';
    },

    /** 某一天的事，整理成 say() 要的形狀。班、行程、課混在一起排。 */
    itemsOn(day) {
        const events = Cal.on(day).map(e => ({
            start: e.time || '', end: e.endTime || '',
            title: e.title || '（沒有標題）',
            kind: Shifts.isShift(e) ? 'shift' : 'event',
        }));
        const classes = Timetable.activeOn(day).map(c => {
            const start = Timetable.startOf(c);
            return {
                start, end: Timetable.endOf(c),
                // 沒有時間的課，名字後面掛節次，不然「還有課：體育」不知道是哪一節
                title: (c.name || '課') + (start ? '' : `（${Timetable.whenText(c)}）`),
                kind: 'class',
            };
        });
        return [...events, ...classes];
    },

    gather(now = new Date()) {
        const day = ymd(now);
        const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        return {
            now: now.getHours() * 60 + now.getMinutes(),
            today: this.itemsOn(day),
            off: Timetable.on(day).filter(c => Timetable.isOff(c.id, day)).map(c => c.name || '課'),
            due: Todo.data.items.filter(i => !i.done && i.due === day).map(i => i.title),
            tomorrow: this.itemsOn(ymd(next)),
        };
    },

    text(now = new Date()) {
        return this.say(this.gather(now));
    },
};
