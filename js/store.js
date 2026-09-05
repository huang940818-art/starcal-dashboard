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
    /** 每一份資料「我手上這份是哪一版」。存檔時帶上去，對不上就不給存。 */
    versions: {},
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
            this.versions[name] = res.headers.get('X-Star-Version') || '';
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
            const res = await fetch(`api/${encodeURIComponent(name)}${this._baseQuery(name)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            const out = await res.json().catch(() => ({}));
            if (res.status === 409 || out.conflict) {
                // **不要自作主張重新載入。** 那會把她螢幕上剛打的東西換掉。
                // 講清楚發生什麼事，讓她自己決定什麼時候重整。
                this.conflicted = name;
                toast(`「${name}」在別的地方被改過了。重新整理才會看到最新的，`
                      + `在這裡繼續改會存不進去。`, true);
                return;
            }
            if (!res.ok || out.error) throw new Error(out.error || `存檔失敗（${res.status}）`);
            if (out.version) this.versions[name] = out.version;
        } catch (e) {
            toast(`存不進去：${e.message}`, true);
        }
    },

    /** 還有沒有沒寫出去的改動。決定「可不可以直接重載」時要問這個。 */
    hasPending() {
        return Object.keys(this._pending).length > 0;
    },

    /** 存檔時附上「我根據的是哪一版」。用網址帶，因為 sendBeacon 設不了 header。 */
    _baseQuery(name) {
        const v = this.versions[name];
        return v ? `?base=${encodeURIComponent(v)}` : '';
    },

    /**
     * 回到這個分頁時，確認手上這幾份還是不是最新的。
     *
     * 為什麼需要：手機那支星歷同步過來、或者直接動了 ~/星歷資料/ 底下的檔案，
     * 開著的頁面完全不知道。等到她在舊頁面上按存才發現，那時已經來不及了
     * （現在會被 409 擋住，但她會覺得莫名其妙）。先講比較好。
     */
    async checkFresh() {
        if (this.mode !== 'local') return [];
        let latest;
        try {
            const res = await fetch('api/資料版本', { cache: 'no-store',
                                                    signal: AbortSignal.timeout(1500) });
            if (!res.ok) return [];
            latest = await res.json();
        } catch {
            return [];      // server 沒回應不是錯誤，安靜就好
        }
        const stale = Object.keys(this.versions)
            .filter(n => latest[n] && latest[n] !== this.versions[n]);
        return stale;
    },

    /** 關掉分頁前把還沒寫的寫掉 */
    flushAll() {
        for (const name of Object.keys(this._pending)) {
            const data = this.cache[name];
            if (!data) continue;
            if (this.mode === 'local') {
                // 關頁面的時候 fetch 會被砍掉，sendBeacon 才送得出去
                navigator.sendBeacon?.(
                    `api/${encodeURIComponent(name)}${this._baseQuery(name)}`,
                    new Blob([JSON.stringify(data)], { type: 'application/json' }));
            } else {
                try { localStorage.setItem(`星歷:${name}`, JSON.stringify(data)); } catch {}
            }
        }
    },
};
