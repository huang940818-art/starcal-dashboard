/* Google 日曆（唯讀）。
 *
 * 用的人自己在設定裡決定要不要連自己的 Google 日曆。連了之後，
 * Google 上的行程會跟星歷自己的行程一起出現在月曆、時間線、今天那張卡上。
 *
 * 幾個刻意的決定：
 *
 * **1. 只讀，不寫。** 權限只要 calendar.readonly。星歷不會改、不會刪 Google 上的任何東西；
 *    在星歷裡點 Google 的行程是打開 Google 那一頁，不是打開星歷的編輯框——
 *    在這裡改了卻沒寫回去，比不能改更糟。
 *
 * **2. 不寫進星歷的資料。** 跟國定假日同一個道理（見 js/holidays.js）：
 *    那是別人家的資料，抓來看而已。寫進去的話，Google 那邊刪了、這邊還在，
 *    兩邊永遠對不齊。只在這台瀏覽器留一份快取，重整頁面時先顯示快取。
 *
 * **3. 全部在瀏覽器裡做。** 公開版沒有後端，token 只在這個分頁的 sessionStorage，
 *    關掉分頁就沒了。Google 的 token 一小時過期，過期後要再按一次「更新」——
 *    瀏覽器規定登入視窗只能由使用者按下去的那一下打開，沒辦法偷偷續。
 *
 * **4. 沒有設定 CLIENT_ID 就整個不出現。** 那是網站擁有者去 Google Cloud
 *    申請的 OAuth 用戶端 ID（公開的，不是密碼）。
 */

const GCal = {
    /** Google Cloud 的 OAuth 用戶端 ID。空的＝這個功能不出現。 */
    // 2026-10-01 先關掉：測試中只有名單上的人能登入、發布又會跳未驗證警告，
    // 她選了匯入檔案那條（js/ics.js）。Google Cloud 專案 starcal-dashboard 還在，
    // 用戶端 ID 是 611392870358-6rpgfcvjqdskuf25tk24ahag902rvrje.apps.googleusercontent.com，要開再填回來。
    CLIENT_ID: '',
    SCOPE: 'https://www.googleapis.com/auth/calendar.readonly',

    /** 往前抓幾天、往後抓幾天 */
    PAST_DAYS: 31,
    FUTURE_DAYS: 120,

    ON_KEY: 'gcal:on',
    CACHE_KEY: 'gcal:cache',
    TOKEN_KEY: 'gcal:token',

    /** "2026-10-01" → [事件…] */
    byDate: new Map(),
    events: [],
    fetchedAt: null,
    busy: false,
    tokenClient: null,

    get available() { return !!this.CLIENT_ID; },
    get on() { return this.available && localStorage.getItem(this.ON_KEY) === '1'; },

    init() {
        if (!this.on) return;
        try {
            const c = JSON.parse(localStorage.getItem(this.CACHE_KEY) || 'null');
            if (c?.events) { this.setEvents(c.events); this.fetchedAt = c.fetchedAt; this.redraw(); }
        } catch { /* 快取壞了就當沒有 */ }
        // 同一個分頁裡 token 還沒過期的話，順手更新一次（不用跳視窗）
        if (this.token()) this.refresh();
    },

    /* ── 給畫面用的 ───────────────────────── */

    eventsOn(day) { return this.on ? (this.byDate.get(day) || []) : []; },
    after(day) { return this.on ? this.events.filter(e => e.date > day) : []; },

    /* ── 連結／更新／中斷 ─────────────────── */

    token() {
        try {
            const t = JSON.parse(sessionStorage.getItem(this.TOKEN_KEY) || 'null');
            return t && t.exp > Date.now() + 60_000 ? t.value : null;
        } catch { return null; }
    },

    loadGis() {
        if (window.google?.accounts?.oauth2) return Promise.resolve();
        return new Promise((ok, bad) => {
            const s = document.createElement('script');
            s.src = 'https://accounts.google.com/gsi/client';
            s.onload = ok;
            s.onerror = () => bad(new Error('連不到 Google'));
            document.head.append(s);
        });
    },

    /** 要一個 token。**一定要從按鈕的 onclick 直接呼叫**，不然登入視窗會被擋掉。 */
    async askToken() {
        await this.loadGis();
        return new Promise((ok, bad) => {
            this.tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: this.CLIENT_ID,
                scope: this.SCOPE,
                callback: r => {
                    if (r.error || !r.access_token) return bad(new Error(r.error || '沒有拿到授權'));
                    sessionStorage.setItem(this.TOKEN_KEY, JSON.stringify({
                        value: r.access_token, exp: Date.now() + (r.expires_in || 3600) * 1000,
                    }));
                    ok(r.access_token);
                },
                error_callback: e => bad(new Error(e?.type === 'popup_closed' ? '登入視窗被關掉了' : '登入沒有完成')),
            });
            this.tokenClient.requestAccessToken({ prompt: '' });
        });
    },

    async connect() {
        try {
            await this.askToken();
            localStorage.setItem(this.ON_KEY, '1');
            await this.refresh();
            toast('Google 日曆連好了');
        } catch (e) {
            toast(e.message, true);
        }
    },

    disconnect() {
        const t = this.token();
        if (t && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(t, () => {});
        localStorage.removeItem(this.ON_KEY);
        localStorage.removeItem(this.CACHE_KEY);
        sessionStorage.removeItem(this.TOKEN_KEY);
        this.setEvents([]);
        this.fetchedAt = null;
        this.redraw();
    },

    /** 重新抓。token 過期了就要一個新的（所以也要從按鈕叫）。 */
    async refresh() {
        if (this.busy) return;
        this.busy = true;
        try {
            const token = this.token() || await this.askToken();
            const events = await this.fetchAll(token);
            this.setEvents(events);
            this.fetchedAt = new Date().toISOString();
            localStorage.setItem(this.CACHE_KEY, JSON.stringify({ events, fetchedAt: this.fetchedAt }));
            this.redraw();
        } catch (e) {
            toast(`Google 日曆：${e.message}`, true);
        } finally {
            this.busy = false;
        }
    },

    async api(token, path, params = {}) {
        const url = new URL('https://www.googleapis.com/calendar/v3/' + path);
        for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (res.status === 401) {
            sessionStorage.removeItem(this.TOKEN_KEY);
            throw new Error('登入過期了，再按一次更新');
        }
        if (!res.ok) throw new Error(`Google 回了 ${res.status}`);
        return res.json();
    },

    /** 所有「在 Google 日曆上有勾起來」的日曆，各抓一段時間的行程。 */
    async fetchAll(token) {
        const list = await this.api(token, 'users/me/calendarList', { minAccessRole: 'reader' });
        const cals = (list.items || []).filter(c => c.selected && !c.hidden);

        const now = new Date();
        const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - this.PAST_DAYS);
        const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + this.FUTURE_DAYS);

        const out = [];
        for (const c of cals) {
            let pageToken = '';
            do {
                const r = await this.api(token, `calendars/${encodeURIComponent(c.id)}/events`, {
                    timeMin: from.toISOString(), timeMax: to.toISOString(),
                    singleEvents: 'true', orderBy: 'startTime', maxResults: '250',
                    ...(pageToken ? { pageToken } : {}),
                });
                for (const g of r.items || []) {
                    if (g.status === 'cancelled') continue;
                    out.push(...this.convert(g, c.summaryOverride || c.summary || ''));
                }
                pageToken = r.nextPageToken || '';
            } while (pageToken);
        }
        return out;
    },

    /** Google 的一筆 → 星歷行程的樣子。整天、跨好幾天的攤成每天一筆。 */
    convert(g, calName) {
        const base = {
            ext: 'google',
            title: g.summary || '（沒有標題）',
            note: calName,
            link: g.htmlLink || '',
            label: null,
            done: false,
        };
        if (g.start?.date) {
            // 整天：end 是「不含」的那天
            const rows = [];
            const d = new Date(g.start.date + 'T00:00:00');
            const end = new Date((g.end?.date || g.start.date) + 'T00:00:00');
            do {
                rows.push({ ...base, id: `g:${g.id}:${ymd(d)}`, date: ymd(d), time: '', endTime: '' });
                d.setDate(d.getDate() + 1);
            } while (d < end && rows.length < 60);
            return rows;
        }
        const s = new Date(g.start?.dateTime);
        const e = new Date(g.end?.dateTime || g.start?.dateTime);
        const hm = x => `${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
        return [{ ...base, id: `g:${g.id}`, date: ymd(s), time: hm(s),
                  endTime: ymd(e) === ymd(s) ? hm(e) : '' }];
    },

    setEvents(events) {
        this.events = events;
        this.byDate = new Map();
        for (const e of events) {
            if (!this.byDate.has(e.date)) this.byDate.set(e.date, []);
            this.byDate.get(e.date).push(e);
        }
    },

    redraw() {
        if (typeof Agenda !== 'undefined') Agenda.render();
        if (typeof Overview !== 'undefined') Overview.render();
    },

    /* ── 設定面板裡那一段 ─────────────────── */

    section() {
        if (!this.available) return [];
        const box = el('div', {});
        const draw = () => {
            clear(box);
            if (!this.on) {
                box.append(el('button', {
                    type: 'button', class: 'btn', text: '連結我的 Google 日曆',
                    onclick: async () => { await this.connect(); draw(); },
                }));
                return;
            }
            const when = this.fetchedAt
                ? new Date(this.fetchedAt).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                : '還沒抓過';
            box.append(
                el('p', { class: 'sub', style: 'margin:0 0 10px',
                          text: `已連結，${this.events.length} 筆・${when} 更新` }),
                el('div', { class: 'row', style: 'gap:8px' }, [
                    el('button', { type: 'button', class: 'btn small', text: '更新',
                                   onclick: async () => { await this.refresh(); draw(); } }),
                    el('button', { type: 'button', class: 'btn small ghost', text: '中斷連結',
                                   onclick: () => { this.disconnect(); draw(); } }),
                ]),
            );
        };
        draw();
        return [el('h4', { class: 'sec', text: 'Google 日曆' }), box];
    },
};
