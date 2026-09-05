/* 程式換了就自己更新。
 *
 * 為什麼需要這個：加到主畫面之後這頁是全螢幕的，**沒有網址列、
 * 也沒有重整鍵**。server 每個回應都送 Cache-Control: no-store，
 * 所以重整一定拿到新版——問題是得先想到要重整，而且要知道怎麼重整。
 *
 * 所以改成頁面自己問。什麼時候問：
 *
 *   1. 從別的 App 切回來的時候（visibilitychange）——這是最準的時機，
 *      因為程式通常就是在她沒看著的那段時間換掉的。
 *   2. 一直開著的話，每十分鐘問一次。
 *
 * 換了之後不是無條件重載：**正在打字或對話框開著的時候硬重載，
 * 會把她手上那件事弄掉。** 那種時候改成跳一條可以點的提示，
 * 讓她自己決定時機。
 *
 * 展示模式（GitHub Pages）沒有 /api，整支早退，什麼都不做。
 */

const Update = {
    version: null,
    asked: null,        // 已經提示過的版本，同一版不要一直吵
    dataAsked: null,    // 同上，但問的是「資料」被別的地方改過
    timer: null,

    /** 一直開著的話多久問一次 */
    EVERY: 10 * 60 * 1000,

    async init() {
        if (Store.mode !== 'local') return;

        // 版本端點拿不到不代表要整支早退——**資料**那條檢查跟程式版本無關，
        // 而且那條更要緊：程式舊了頂多少一個功能，資料舊了會蓋掉別人剛寫的。
        this.version = await this.fetch();

        addEventListener('visibilitychange', () => {
            if (document.visibilityState !== 'visible') return;
            this.check();
            this.checkData();
        });
        this.timer = setInterval(() => { this.check(); this.checkData(); }, this.EVERY);
    },

    // MARK: 資料被別的地方改過
    //
    // 手機那支星歷同步過來、或者我直接動了 ~/星歷資料/ 底下的檔案，
    // 開著的頁面完全不知道——**它手上那份是舊的，一存就把新的蓋掉**。
    // server 現在會用 409 擋住（見 store.js 的 _baseQuery），
    // 但等到她按下存才發現太晚了，畫面上那些改動已經沒地方去。所以先講。

    async checkData() {
        const stale = await Store.checkFresh();
        if (!stale.length) return;

        // 她沒有正在做的事，也沒有還沒寫出去的東西——直接換成最新的就好，
        // **不要 flushAll**：手上這份是舊的，送出去正是要避免的那件事。
        if (!this.busy() && !Store.hasPending()) {
            location.reload();
            return;
        }
        const key = stale.join(',');
        if (this.dataAsked === key) return;
        this.dataAsked = key;
        this.offerData(stale);
    },

    offerData(stale) {
        const old = $('#update-bar');
        if (old) old.remove();

        const bar = el('div', { class: 'update-bar', id: 'update-bar', role: 'status' }, [
            el('span', { text: `電腦上的「${stale.join('、')}」被改過了` }),
            el('button', {
                type: 'button', class: 'btn small primary', text: '重新載入',
                // 這裡刻意不先 flush：手上這份是舊的，送出去會蓋掉新的。
                onclick: () => location.reload(),
            }),
            el('button', {
                type: 'button', class: 'btn small ghost', text: '等一下',
                'aria-label': '關掉這個提示',
                onclick: () => bar.remove(),
            }),
        ]);
        document.body.append(bar);
    },

    async fetch() {
        try {
            const res = await fetch('api/版本', {
                cache: 'no-store',
                signal: AbortSignal.timeout(4000),
            });
            if (!res.ok) return null;
            const data = await res.json();
            return data.version || null;
        } catch {
            // 網路斷了、Mac 睡著了、Tailscale 沒連上——這些都不是錯，
            // 只是這次問不到。下次再問就好，不要拿這種事去吵她。
            return null;
        }
    },

    async check() {
        const now = await this.fetch();
        if (!now || now === this.version) return;

        if (this.busy()) {
            // 同一版只提示一次。她按掉之後又跳一模一樣的東西，
            // 那不是提醒，是騷擾。
            if (this.asked !== now) {
                this.asked = now;
                this.offer();
            }
            return;
        }
        this.apply();
    },

    /** 現在動她的畫面會弄掉東西嗎 */
    busy() {
        if (document.querySelector('dialog[open]')) return true;

        const node = document.activeElement;
        if (node && /^(TEXTAREA|INPUT|SELECT)$/.test(node.tagName)) {
            // **關掉的對話框裡面的焦點不算。** 對話框 close 之後焦點會留在
            // 那個已經看不見的欄位上，不排掉的話 busy() 從此永遠是 true，
            // 自動更新就再也不會發生了——而且完全沒有徵兆。
            const dlg = node.closest('dialog');
            if (!dlg || dlg.open) return true;
        }

        // 拖到一半的便利貼
        if (document.querySelector('.sticky.dragging')) return true;
        return false;
    },

    apply() {
        // 還沒寫出去的東西先送出去再重載，不然這一步會吃掉她剛打的字
        Store.flushAll();
        setTimeout(() => location.reload(), 150);
    },

    /** 底下那條可以點的提示。用 toast 不行——那個會自己消失，而且點不了。 */
    offer() {
        const old = $('#update-bar');
        if (old) old.remove();

        const bar = el('div', { class: 'update-bar', id: 'update-bar', role: 'status' }, [
            el('span', { text: '星歷更新了' }),
            el('button', {
                type: 'button', class: 'btn small primary', text: '重新載入',
                onclick: () => this.apply(),
            }),
            el('button', {
                type: 'button', class: 'btn small ghost', text: '等一下',
                'aria-label': '關掉這個提示',
                onclick: () => bar.remove(),
            }),
        ]);
        document.body.append(bar);
    },
};
