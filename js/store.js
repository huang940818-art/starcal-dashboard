/* 資料層。
 *
 * 同一份前端要在兩個地方跑，資料來源不一樣：
 *
 *   本機模式　開 localhost，資料在 ~/星歷資料/*.json，經過 server.py 讀寫。
 *             這是自己用的那份，真實資料。
 *   展示模式　放在 GitHub Pages 上，沒有 server 可以連。改用內建的示範資料，
 *             存在瀏覽器的 localStorage。**別人在作品集上怎麼點都不影響任何人**，
 *             也永遠碰不到私人資料——那些檔案根本不在這個 repo 裡。
 *
 * 判斷方式是開場打一次 /api/ping。連得到就是本機，連不到就是展示。
 * 不用網址判斷（localhost 也可能是別人在跑靜態檔），問後端最準。
 */

const Store = {
    mode: null,          // 'local' | 'demo'
    cache: {},
    _timers: {},
    _pending: {},

    async init() {
        try {
            // 幾百毫秒還沒回應就當作沒有 server。放在 Pages 上時
            // /api/ping 會是 404，那也走同一條路。
            const res = await fetch('api/ping', { signal: AbortSignal.timeout(1500) });
            if (!res.ok) throw new Error('no api');
            const info = await res.json();
            this.mode = 'local';
            this.dir = info.dir || '';
        } catch {
            this.mode = 'demo';
        }
        return this.mode;
    },

    /** 讀一份資料。讀過的留在記憶體，之後都直接用。 */
    async load(name) {
        if (this.cache[name]) return this.cache[name];

        if (this.mode === 'local') {
            const res = await fetch(`api/${encodeURIComponent(name)}`, { cache: 'no-store' });
            const data = await res.json();
            if (!res.ok || data.error) {
                // **讀不出來不要當成空的。** 當成空的話畫面會說「你沒有任何帳目」，
                // 接著下一次存檔就把壞檔覆蓋成真的空檔。
                throw new Error(data.error || `讀取失敗（${res.status}）`);
            }
            this.cache[name] = data;
        } else {
            const raw = localStorage.getItem(`星歷:${name}`);
            if (raw) {
                this.cache[name] = JSON.parse(raw);
            } else if (localStorage.getItem('星歷:自己用')) {
                // 已經按過「清空，我要自己用」了。沒有這個旗標的話，
                // 重整一次示範資料就整份長回來，等於清不掉。
                this.cache[name] = structuredClone(EMPTY_DATA[name]);
            } else {
                this.cache[name] = structuredClone(DEMO[name]);
            }
        }
        return this.cache[name];
    },

    /**
     * 存檔。合併成一次寫入——拖便利貼的時候一秒會叫好幾十次，
     * 每次都寫檔的話硬碟和備份都會被洗版。
     */
    save(name, { immediate = false } = {}) {
        this._pending[name] = true;
        clearTimeout(this._timers[name]);
        if (immediate) return this._flush(name);
        this._timers[name] = setTimeout(() => this._flush(name), 400);
    },

    async _flush(name) {
        if (!this._pending[name]) return;
        delete this._pending[name];
        const data = this.cache[name];
        if (!data) return;

        if (this.mode !== 'local') {
            try {
                localStorage.setItem(`星歷:${name}`, JSON.stringify(data));
            } catch (e) {
                // 無痕視窗、或容量滿了。講出來，別讓人以為存好了。
                toast('這個瀏覽器不讓我存資料，重整就會不見', true);
            }
            return;
        }

        try {
            const res = await fetch(`api/${encodeURIComponent(name)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            const out = await res.json().catch(() => ({}));
            if (!res.ok || out.error) throw new Error(out.error || `存檔失敗（${res.status}）`);
        } catch (e) {
            toast(`存不進去：${e.message}`, true);
        }
    },

    /** 關掉分頁前把還沒寫的寫掉 */
    flushAll() {
        for (const name of Object.keys(this._pending)) {
            const data = this.cache[name];
            if (!data) continue;
            if (this.mode === 'local') {
                // 關頁面的時候 fetch 會被砍掉，sendBeacon 才送得出去
                navigator.sendBeacon?.(
                    `api/${encodeURIComponent(name)}`,
                    new Blob([JSON.stringify(data)], { type: 'application/json' }));
            } else {
                try { localStorage.setItem(`星歷:${name}`, JSON.stringify(data)); } catch {}
            }
        }
    },
};
