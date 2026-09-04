/* 小克的區塊。
 *
 * **這一塊只在本機模式出現。** 展示模式（GitHub Pages）完全不畫，
 * 連空卡片都不留——別人打開作品集看到一塊「小克 8%」只會困惑，
 * 而且那是她的私人東西，不該跟著 repo 上網。
 * 這就是「我的版本」跟「他們的版本」分家最小的做法：
 * 不是兩份程式碼，是一個 `Store.mode !== 'local'` 的早退。
 *
 * 數字不是這裡算的，是 ~/.star-bridge/小克額度.sh 打 Anthropic 官方
 * usage 端點抓回來寫進 ~/星歷資料/小克.json 的，跟 Claude Code 的
 * `/usage` 同一份。前端唯讀，不寫回去。
 *
 * 抓失敗的時候那支腳本會保留舊值並填 problem。所以這裡要把
 * **「這是幾點的數字」講出來**——顯示一個過期的百分比而不說它過期了，
 * 比不顯示還糟。
 */

const Ke = {
    data: null,

    async init() {
        if (Store.mode !== 'local') return;
        try {
            this.data = await Store.load('小克');
        } catch {
            // 讀不到就當作沒有這塊。這是附加的東西，
            // 不該讓它把整個儀表板拖下水（那是 Store.load 丟錯的用途）。
            this.data = null;
        }
    },

    /** 五小時視窗和每週視窗，各取一條。認不得的種類就不畫。 */
    windows() {
        const limits = this.data?.limits || [];
        const pick = kind => limits.find(l => l.kind === kind);
        return [
            { label: '這五小時', l: pick('session') },
            { label: '這禮拜', l: pick('weekly_all') },
        ].filter(x => x.l && typeof x.l.percent === 'number');
    },

    /** 「今天 19:00 重置」「9/6 13:00 重置」。跨日才寫日期。 */
    resetText(iso) {
        if (!iso) return null;
        const d = new Date(iso);
        if (isNaN(d)) return null;
        const t = `${d.getHours()}:${pad(d.getMinutes())}`;
        return ymd(d) === todayStr() ? `今天 ${t} 重置` : `${d.getMonth() + 1}/${d.getDate()} ${t} 重置`;
    },

    /** 資料是幾點抓的。超過一小時就要講，不然看到的是過期的數字。 */
    freshness() {
        const at = this.data?.fetchedAt;
        if (!at) return '還沒抓過';
        const mins = Math.floor((Date.now() - at) / 60000);
        if (mins < 2) return '剛剛更新';
        if (mins < 60) return `${mins} 分鐘前`;
        const hrs = Math.floor(mins / 60);
        return hrs < 24 ? `${hrs} 小時前` : `${Math.floor(hrs / 24)} 天前`;
    },

    /** 藍 → 75% 轉黃 → 90% 轉紅。跟 ai-usage-monitor 同一套門檻。 */
    tone(p) {
        return p >= 90 ? 'alert' : p >= 75 ? 'warn' : '';
    },

    render(grid) {
        if (Store.mode !== 'local' || !this.data) return;

        const wins = this.windows();
        const problem = this.data.problem;
        if (!wins.length && !problem) return;

        const body = [];

        if (this.data.line) {
            body.push(el('p', { class: 'ke-line', text: this.data.line }));
        }

        for (const { label, l } of wins) {
            const p = Math.max(0, Math.min(100, l.percent));
            const reset = this.resetText(l.resetsAt);
            body.push(el('div', { class: 'ke-row' }, [
                el('div', { class: 'ke-head' }, [
                    el('span', { class: 'ke-label', text: label }),
                    el('span', { class: 'ke-pct ' + this.tone(p), text: `${p}%` }),
                ]),
                el('div', { class: 'ke-track' }, [
                    el('div', { class: 'ke-fill ' + this.tone(p), style: `width:${p}%` }),
                ]),
                reset ? el('div', { class: 'ke-reset', text: reset }) : null,
            ]));
        }

        if (problem) {
            // 抓失敗要講清楚，但上面那些數字還是有用的——只是舊的。
            body.push(el('p', { class: 'ke-problem' }, [
                icon('alert', 14), `額度抓不到，上面是舊的數字：${problem}`,
            ]));
        }

        body.push(el('div', { class: 'ke-foot', text: this.freshness() }));

        grid.append(el('div', { class: 'card', 'data-hue': 'ke' }, [
            // 圖示要放進 .label 裡面，不能跟它並排——h2 是 space-between，
            // 兩個並排的孩子會被推到左右兩端，標題就跑到卡片右邊去了。
            el('h2', {}, [el('span', { class: 'label' }, [icon('signal', 18), '小克'])]),
            ...body,
        ]));
    },
};
