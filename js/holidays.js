/* 國定假日與連假。
 *
 * 她的原話：「我覺得國定假日都可以標起來放倒數，比如哪些連假之類的」
 * ＋「還有我的行事曆那邊」。
 *
 * 資料是政府公布的辦公日曆表（人事行政總處），用 `抓假日.py` 抓下來
 * 變成 holidays.json。**不要自己手寫假日表**——補假怎麼補、哪年清明
 * 跟兒童節連在一起，每年都不一樣，憑印象寫一定會錯，而且錯了不會有
 * 任何地方報錯，只會讓她照著一個錯的日子安排事情。
 *
 * 三個刻意的決定：
 *
 * **1. 不寫進她的資料。**
 * 倒數那張卡上會出現連假，但它們不在 ~/星歷資料/倒數.json 裡。
 * 寫進去的話：她手動加的寒假、期中考會被十幾個假日淹掉，
 * 刪掉一個明年又會冒出來，而且每年更新資料就要跟她改過的東西打架。
 * 假日是「本來就會發生的事」，不是她記下來的事。
 *
 * **2. 卡片上最多兩個連假。**
 * 接下來十二個月有十二個連假，全部擠上去的話那張卡就只剩假日，
 * 她自己填的東西一個都看不到——而那些才是她真正要記得的。
 *
 * **3. 只有連假進倒數，單日的不進。**
 * 剛好落在平日的單日假（例如某年的元旦是星期三）在月曆上照樣標出來，
 * 但不值得倒數——「還有 34 天就放一天假」不是一個會改變計畫的訊息。
 */

const Holidays = {
    /** holidays.json 的內容。載入失敗就是 null，所有功能安靜地不出現。 */
    data: null,
    /** "2026-09-25" → { name, breakName, breakDays } */
    byDate: null,

    /** 卡片上最多幾個連假。理由見檔案開頭第 2 點。 */
    CARD_MAX: 2,

    async init() {
        try {
            /* **失敗就整個不出現，不要吵。**
             * 這是附加資訊，跟天氣同一個道理：沒有它這頁照樣能用，
             * 而一塊常駐的「假日載入失敗」只會變成每天都要看一次的雜訊。 */
            const res = await fetch('holidays.json', { cache: 'no-cache' });
            if (!res.ok) return;
            const d = await res.json();
            if (!Array.isArray(d?.連假) || !Array.isArray(d?.假日)) return;
            this.data = d;
            this.index();
        } catch { /* 沒網路、檔案不在、JSON 壞了——一律當作沒有 */ }
    },

    /** 把日期攤平成一張表，月曆每一格查一次，不要每格都掃整個陣列。 */
    index() {
        const map = new Map();
        for (const h of this.data.假日) {
            map.set(h.date, { name: h.name });
        }
        for (const b of this.data.連假) {
            for (const day of this.datesIn(b.start, b.end)) {
                const cur = map.get(day) || {};
                map.set(day, { ...cur, breakName: b.name, breakDays: b.days });
            }
        }
        this.byDate = map;
    },

    /** start ~ end 之間的每一天（含頭尾）。 */
    datesIn(start, end) {
        const out = [];
        for (let d = parseYmd(start), last = parseYmd(end); d <= last;
             d.setDate(d.getDate() + 1)) {
            out.push(ymd(d));
        }
        return out;
    },

    /**
     * 這一天是什麼。
     *
     * @returns null，或 { name, breakName, breakDays }
     *          name       國定假日的名字（補假、週末沒有）
     *          breakName  這天屬於哪個連假（單日假沒有）
     *          breakDays  那個連假幾天
     */
    on(day) { return this.byDate?.get(day) || null; },

    /** 還沒結束的連假，近的在前。 */
    upcomingBreaks(today = todayStr()) {
        return (this.data?.連假 || [])
            .filter(b => b.end >= today)
            .sort((a, b) => a.start.localeCompare(b.start));
    },

    /**
     * 連假變成倒數用的項目，形狀跟她自己填的一樣，多一個 `holiday: true`。
     *
     * **`id` 要穩定**（用日期，不是 uid）：每次重畫都生新 id 的話，
     * 畫面上的 key 每次都變，而且之後要記「這個她按過了」也沒有把手。
     */
    asCountdownItems(today = todayStr(), limit = Infinity) {
        return this.upcomingBreaks(today).slice(0, limit).map(b => ({
            id: `holiday:${b.start}`,
            title: `${b.name}　${b.days} 天`,
            date: b.start,
            endDate: b.end,
            yearly: false,
            holiday: true,
        }));
    },

    /**
     * 資料剩不到 60 天就該重跑 `抓假日.py` 了。
     *
     * **這句話一定要有人講。** 政府的日曆表一年公布一次，這份 JSON 是
     * 建置時抓的——沒有人提醒的話，它會安靜地停在最後一年，
     * 然後某天她發現連假都不見了，卻不知道是資料過期還是功能壞了。
     */
    runningOut(today = todayStr()) {
        const end = this.data?.涵蓋?.[1];
        if (!end) return null;
        const left = Math.round((parseYmd(end) - parseYmd(today)) / 86400000);
        return left <= 60 ? { end, left } : null;
    },
};
