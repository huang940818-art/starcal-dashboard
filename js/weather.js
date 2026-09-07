/* 今天的天氣。
 *
 * 資料來自 Open-Meteo（open-meteo.com）：不用金鑰、不用註冊、有 CORS，
 * 而且不會拿到任何身分資訊——它只知道有人問了某個經緯度的天氣。
 * 中央氣象署的開放資料要申請授權碼，那把碼會被編進網頁裡送給每一個
 * 打開它的人，對一個要放進作品集的頁面來說不划算。
 *
 * 三個刻意的決定：
 *
 * **1. 從瀏覽器的時區猜地點，不主動要定位權限。**
 * 一打開就跳「要不要給位置」的頁面很討厭，而且這份儀表板放在
 * GitHub Pages 上給別人看——寫死一個地點的話，打開的人看到的是
 * 別人所在地的天氣，而那個座標還會跟著程式一起公開。
 *
 * IANA 的時區幾乎都是拿城市命名的（Asia/Taipei、Europe/London、
 * America/Argentina/Buenos_Aires），拿最後一段去查座標就好。
 * 不用權限、不用第三方追蹤，而且每個人看到的是自己那一區。
 * 卡片上一定把地名寫出來——**不寫地名的天氣是騙人的**。
 * 要精確到自己站的地方，卡片上有一顆按鈕，按了才問權限。
 *
 * **2. 位置和快取都放 localStorage，不寫進 ~/星歷資料。**
 * 這是「這台裝置的偏好」，不是她的資料。手機和電腦本來就可能在不同地方，
 * 同步過去反而是錯的。
 *
 * **3. 抓不到就整張卡片不畫。**
 * 天氣是附加的東西，沒有網路的時候不該讓它在畫面上留一塊「載入失敗」。
 * 但**已經抓到過的就繼續顯示，並且把時間寫出來**——顯示一個過期的溫度
 * 而不說它過期了，比不顯示還糟（跟小克那塊同一個道理）。
 */

const Weather = {
    PLACE_KEY: '星歷.天氣.地點',
    GUESS_KEY: '星歷.天氣.猜的地點',
    CACHE_KEY: '星歷.天氣.快取',
    /** 快取多久算新鮮。天氣不會分鐘級地變，半小時很夠。 */
    FRESH_MS: 30 * 60 * 1000,

    data: null,      // 這一次要畫的資料
    place: null,
    asking: false,   // 正在問定位權限

    /* ── WMO 天氣代碼 ──────────────────────────────────
     * 只分七類。人要的是「今天要不要帶傘、要不要加件外套」，
     * 不是毛毛雨和小雨的差別。
     */
    CODES: [
        { max: 0, ico: 'sun', text: '晴' },
        { max: 2, ico: 'cloudsun', text: '多雲' },
        { max: 3, ico: 'cloud', text: '陰' },
        { max: 48, ico: 'fog', text: '有霧' },
        { max: 57, ico: 'rain', text: '毛毛雨' },
        { max: 67, ico: 'rain', text: '下雨' },
        { max: 77, ico: 'snow', text: '下雪' },
        { max: 82, ico: 'rain', text: '陣雨' },
        { max: 86, ico: 'snow', text: '陣雪' },
        { max: 99, ico: 'storm', text: '雷雨' },
    ],

    /** 代碼 → { ico, text }。認不得的一律當多雲，不要讓畫面開天窗。
     *
     * **只認 number，不做轉型。** `Number(null)` 是 0，而 0 是「晴」——
     * 欄位缺了會安安靜靜地畫成大太陽，那是最糟的一種錯。
     */
    describe(code) {
        const n = typeof code === 'number' ? code : NaN;
        if (!Number.isFinite(n)) return { ico: 'cloud', text: '—' };
        for (const c of this.CODES) if (n <= c.max) return { ico: c.ico, text: c.text };
        return { ico: 'cloud', text: '—' };
    },

    /* ── 地點 ──────────────────────────────────────── */

    savedPlace() {
        try {
            const raw = localStorage.getItem(this.PLACE_KEY);
            if (!raw) return null;
            const p = JSON.parse(raw);
            // 存壞了就當作沒存過。**不要相信 localStorage 裡的東西**——
            // 它可能是舊版本寫的，也可能被手動改過。
            if (typeof p?.lat !== 'number' || typeof p?.lon !== 'number') return null;
            return { lat: p.lat, lon: p.lon, name: String(p.name || '我的位置') };
        } catch { return null; }
    },

    savePlace(p) {
        try { localStorage.setItem(this.PLACE_KEY, JSON.stringify(p)); } catch { /* 無痕模式 */ }
    },

    /* ── 從時區猜地點 ──────────────────────────────────
     *
     * **查回來的一定要拿時區對過才算數。**
     * 查「New York」，第一筆回的是內布拉斯加州的 York（人口 7,864），
     * 時區是 America/Chicago——直接用第一筆的話，紐約的人會看到一個
     * 地名寫對、但其實差了一千五百公里的天氣。
     * **顯示一個別人的天氣，比不顯示還糟。**
     */

    timeZone() {
        try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; }
        catch { return ''; }
    },

    /** 時區的最後一段就是城市名。"America/Argentina/Buenos_Aires" → "Buenos Aires"。
     *  UTC、Etc/GMT+8 那種沒有城市，回空字串——猜不到就整張卡不畫。 */
    cityOfZone(tz) {
        const last = String(tz || '').split('/').pop() || '';
        if (!last || last === 'UTC' || last.startsWith('GMT')) return '';
        return last.split('_').join(' ').trim();
    },

    /** 猜過的存起來。**存的時候要記住是哪個時區猜的**——
     *  出國之後時區變了，舊的那份就不是同一件事了。 */
    readGuess(tz) {
        try {
            const g = JSON.parse(localStorage.getItem(this.GUESS_KEY) || 'null');
            if (!g || g.tz !== tz) return null;
            const p = g.place;
            if (typeof p?.lat !== 'number' || typeof p?.lon !== 'number') return null;
            return { lat: p.lat, lon: p.lon, name: String(p.name || this.cityOfZone(tz)) };
        } catch { return null; }
    },

    writeGuess(tz, place) {
        try { localStorage.setItem(this.GUESS_KEY, JSON.stringify({ tz, place })); } catch {}
    },

    geoUrl(city, language) {
        const q = new URLSearchParams({
            name: city, count: '10', language, format: 'json',
        });
        return `https://geocoding-api.open-meteo.com/v1/search?${q}`;
    },

    /** 一堆查詢結果裡，挑時區對得上的那一個。挑不到就回 null。 */
    pickByZone(results, tz) {
        const hit = (results || []).find(r =>
            r && r.timezone === tz
            && typeof r.latitude === 'number' && typeof r.longitude === 'number');
        if (!hit) return null;
        return {
            lat: Number(hit.latitude.toFixed(3)),
            lon: Number(hit.longitude.toFixed(3)),
            name: String(hit.name || ''),
        };
    },

    async lookupCity(city, tz, language) {
        const res = await fetch(this.geoUrl(city, language));
        if (!res.ok) return null;
        const json = await res.json();
        const p = this.pickByZone(json?.results, tz);
        return p && p.name ? p : null;
    },

    async guessPlace() {
        const tz = this.timeZone();
        const city = this.cityOfZone(tz);
        if (!city) return null;

        const cached = this.readGuess(tz);
        if (cached) return cached;

        try {
            // **中文和英文查的是兩個不一樣的索引。** 用中文查 New York
            // 根本找不到紐約（前十筆裡一個 America/New_York 都沒有），
            // 用英文查第一筆就是。所以中文沒中就用英文再問一次：
            // 中文的地名好看，但查得到比較重要。
            const place = await this.lookupCity(city, tz, 'zh')
                       || await this.lookupCity(city, tz, 'en');
            if (place) this.writeGuess(tz, place);
            return place;
        } catch {
            return null;    // 沒網路。天氣是附加的，整張不畫就好
        }
    },

    /* ── 快取 ──────────────────────────────────────── */

    readCache() {
        try {
            const c = JSON.parse(localStorage.getItem(this.CACHE_KEY) || 'null');
            if (!c || typeof c.at !== 'number' || !c.data) return null;
            return c;
        } catch { return null; }
    },

    writeCache(place, data) {
        try {
            localStorage.setItem(this.CACHE_KEY,
                JSON.stringify({ at: Date.now(), key: this.keyOf(place), data }));
        } catch { /* 存不進去就算了，下次重抓 */ }
    },

    /** 快取是綁地點的——換了地方，舊的那份就不是同一件事了。 */
    keyOf(p) { return `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`; },

    /* ── 抓資料 ────────────────────────────────────── */

    url(p) {
        const q = new URLSearchParams({
            latitude: String(p.lat),
            longitude: String(p.lon),
            current: 'temperature_2m,apparent_temperature,weather_code',
            daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max',
            // **跟著座標走，不要寫死時區。** 高低溫和降雨機率是「今天」
            // 的統計，而「今天」在倫敦和台北是不同的二十四小時——
            // 寫死 Asia/Taipei 的話，別人拿到的是切在半夜的那一天。
            timezone: 'auto',
            forecast_days: '1',
        });
        return `https://api.open-meteo.com/v1/forecast?${q}`;
    },

    /** 回傳畫得出來的形狀。任何一個欄位缺了就回 null，不要半張卡片。 */
    shape(json) {
        const c = json?.current, d = json?.daily;
        if (!c || !d) return null;
        const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
        const now = num(c.temperature_2m);
        if (now === null) return null;
        return {
            now: Math.round(now),
            feels: num(c.apparent_temperature) === null ? null : Math.round(num(c.apparent_temperature)),
            code: c.weather_code,
            high: num(d.temperature_2m_max?.[0]) === null ? null : Math.round(d.temperature_2m_max[0]),
            low: num(d.temperature_2m_min?.[0]) === null ? null : Math.round(d.temperature_2m_min[0]),
            rain: num(d.precipitation_probability_max?.[0]),
        };
    },

    /* ── 三層地點 ──────────────────────────────────────
     *
     * 1. 這台裝置自己抓到的（localStorage）——「我現在在哪」
     * 2. 她指定的預設（設定.json）——「我平常要看哪裡」，跨裝置一樣
     * 3. 猜的（瀏覽器時區）
     *
     * 本來只有 1 和 3，理由是「地點是這台裝置的偏好」。那個理由在
     * 手機上垮掉了：**手機開的是 http，瀏覽器不給定位**，所以第 1 層
     * 永遠拿不到，手機上就只能一直看猜出來的城市。
     * 所以中間加一層她自己指定的，手打的地點跟著設定走。
     */
    pickedPlace() {
        const p = Prefs.data?.weatherPlace;
        if (typeof p?.lat !== 'number' || typeof p?.lon !== 'number') return null;
        return { lat: p.lat, lon: p.lon, name: String(p.name || '指定的地點') };
    },

    /** 手打／查出來的地點存設定（跨裝置）。定位抓的存 localStorage（這台）。 */
    savePicked(p) {
        Prefs.data.weatherPlace = p;
        Prefs.save();
    },

    /** 瀏覽器肯不肯給定位。**http 上一律不行**（localhost 除外）。 */
    canLocate() {
        return !!navigator.geolocation && window.isSecureContext === true;
    },

    async init() {
        this.place = this.savedPlace() || this.pickedPlace() || await this.guessPlace();
        // 猜不到（沒網路、時區裡沒有城市名、查回來的時區對不上）就
        // 整張卡片不畫。**寧可沒有，也不要給一個別人的天氣。**
        if (!this.place) return;

        // 先把快取畫出來，不要讓卡片等網路。
        const cached = this.readCache();
        if (cached && cached.key === this.keyOf(this.place)) {
            this.data = cached.data;
            this.at = cached.at;
            if (Date.now() - cached.at < this.FRESH_MS) return;   // 還新鮮，不用再抓
        }
        await this.fetchNow();
    },

    async fetchNow() {
        try {
            const res = await fetch(this.url(this.place), { cache: 'no-store' });
            if (!res.ok) return;
            const shaped = this.shape(await res.json());
            if (!shaped) return;
            this.data = shaped;
            this.at = Date.now();
            this.writeCache(this.place, shaped);
        } catch {
            // 沒網路、被擋、逾時——都留著舊的那份，卡片會標時間
        }
    },

    /** 「幾點抓的」。今天以內只寫時間，跨天就寫日期。 */
    stampText() {
        if (!this.at) return '';
        const d = new Date(this.at);
        const fresh = Date.now() - this.at < this.FRESH_MS;
        if (fresh) return '';
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return ymd(d) === todayStr() ? `${hh}:${mm} 抓的` : `${ymd(d)} 抓的`;
    },

    /* ── 換成自己的位置 ───────────────────────────────── */

    /**
     * 用瀏覽器的定位。
     *
     * **失敗一定要講出來。**
     *
     * 本來這裡的錯誤回呼什麼都不做，註解寫著「她已經用行動回答過了」
     * ——那句話只有在「她按了不允許」的時候成立。實際上失敗有好幾種，
     * 全部走同一條路被吞掉：她在 http 的網址上按了那顆按鈕，
     * 瀏覽器根本不給定位，畫面上什麼都沒發生。
     * **「按了沒反應」是最難查的一種壞掉**，因為它跟「沒按到」長得一樣。
     */
    useMyLocation() {
        if (this.asking) return;

        if (!navigator.geolocation) {
            toast('這個瀏覽器沒有定位功能', true);
            return;
        }
        // 這一條要提前擋，不然瀏覽器回的錯是「使用者拒絕」——
        // 她根本沒看到權限視窗，卻被告知是自己拒絕的。
        if (!window.isSecureContext) {
            toast('這個網址不是 https，瀏覽器不給定位。用底下的搜尋直接指定地點。', true);
            return;
        }

        this.asking = true;
        Overview.render();
        this.renderPicker();

        navigator.geolocation.getCurrentPosition(async pos => {
            this.place = {
                lat: Number(pos.coords.latitude.toFixed(3)),
                lon: Number(pos.coords.longitude.toFixed(3)),
                name: '我的位置',
            };
            /* 兩個都寫。
             *
             * localStorage 是「這台裝置現在在哪」，設定是「平常看哪裡」。
             * 只寫前者的話，**手機永遠拿不到**——手機開的是 http，
             * 那顆按鈕在手機上根本按不動。她在電腦上按一次，
             * 手機才跟得到同一個地方。 */
            this.savePlace(this.place);
            this.savePicked(this.place);
            this.data = null;
            await this.fetchNow();
            this.asking = false;
            Overview.render();
            this.renderPicker();
            toast('換成你現在的位置了');
        }, err => {
            this.asking = false;
            Overview.render();
            this.renderPicker();
            // 三種失敗要分開講：能不能重試、該去哪裡開權限，答案不一樣
            const why = err?.code === 1
                ? '定位被擋住了。到瀏覽器（或手機的系統設定）把這個網站的位置權限打開。'
                : err?.code === 3
                    ? '等太久了，沒抓到位置。再按一次試試。'
                    : '抓不到位置。可以用底下的搜尋直接指定地點。';
            toast(why, true);
        }, { timeout: 8000, maximumAge: 10 * 60 * 1000 });
    },

    /* ── 自己指定地點 ─────────────────────────────────
     *
     * 定位在 http 上永遠拿不到，所以一定要有一條用打的路。
     *
     * ⚠️ **地名庫對台灣的鄉鎮不完整**（查「屏東」是零筆）。查不到的時候
     * 要講出來並且建議改查附近的市鎮，不要只給一句「找不到」——
     * 那會讓人以為是自己打錯字。
     */
    /** 「22.645, 120.605」這種直接當座標用。查不到的地方只剩這條路。 */
    parseCoords(q) {
        const parts = String(q || '').split(/[\s,，]+/).filter(Boolean);
        if (parts.length !== 2) return null;
        const lat = Number(parts[0]), lon = Number(parts[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
        return { lat: Number(lat.toFixed(3)), lon: Number(lon.toFixed(3)),
                 name: '自訂位置', where: '直接用你打的座標' };
    },

    async searchPlaces(q) {
        const name = String(q || '').trim();
        if (!name) return [];

        // **地名庫對台灣的鄉鎮不完整**（查「屏東」是零筆，查「內埔」
        // 五筆裡沒有屏東那個）。查不到的地方，直接打經緯度是唯一的路。
        const coords = this.parseCoords(name);
        if (coords) return [coords];

        const out = [];
        for (const lang of ['zh', 'en']) {
            try {
                const res = await fetch(this.geoUrl(name, lang));
                if (!res.ok) continue;
                const json = await res.json();
                for (const r of json?.results || []) {
                    if (typeof r.latitude !== 'number' || typeof r.longitude !== 'number') continue;
                    const lat = Number(r.latitude.toFixed(3));
                    const lon = Number(r.longitude.toFixed(3));
                    // 中文和英文查的是兩個索引，會有重複
                    if (out.some(p => p.lat === lat && p.lon === lon)) continue;
                    out.push({
                        lat, lon,
                        name: String(r.name || name),
                        where: [r.admin1, r.country].filter(Boolean).join('・'),
                    });
                }
            } catch { /* 沒網路就給已經拿到的 */ }
            if (out.length >= 8) break;
        }
        return out.slice(0, 8);
    },

    /* ── 挑地點的畫面 ────────────────────────────────── */

    openPicker() {
        this.found = null;
        this.searching = false;
        this.renderPicker();
        openDialog('#dlg-place');
    },

    renderPicker() {
        const box = $('#place-body');
        if (!box || !$('#dlg-place')) return;
        clear(box);

        box.append(el('p', { class: 'sub', style: 'margin:-6px 0 14px' }, [
            '現在看的是 ',
            el('b', { text: this.place ? this.place.name : '（還沒有地點）' }),
            this.savedPlace() ? '（這台裝置抓到的）'
                : this.pickedPlace() ? '（你指定的）'
                : '（照瀏覽器的時區猜的）',
        ]));

        // ── 用打的 ──
        const input = el('input', {
            type: 'search', id: 'place-q',
            'aria-label': '搜尋地點',
            // 查不到的鄉鎮還有經緯度這條路，提示裡就要講，
            // 不然她只會得到一句「找不到」然後以為是自己打錯
            placeholder: '打城市名，或經緯度 22.645, 120.605',
            onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); this.doSearch(); } },
        });
        box.append(el('div', { class: 'row', style: 'margin-bottom:12px' }, [
            input,
            el('button', {
                type: 'button', class: 'btn shrink',
                text: this.searching ? '查…' : '查',
                disabled: this.searching,
                onclick: () => this.doSearch(),
            }),
        ]));

        if (this.found) {
            if (!this.found.length) {
                // 查不到要講清楚原因，不然她會以為是自己打錯字
                box.append(el('p', { class: 'sub', style: 'margin:0 0 12px' },
                    '找不到。這個地名資料庫對台灣的鄉鎮不完整（查「屏東」是零筆），'
                    + '改查附近大一點的市鎮通常就有了。'));
            } else {
                for (const p of this.found) {
                    box.append(el('button', {
                        type: 'button', class: 'pick-row place-row',
                        onclick: () => this.choose(p),
                    }, [
                        el('div', { class: 'grow' }, [
                            el('div', { class: 'ellipsis', text: p.name }),
                            el('div', { class: 'sub ellipsis', text: p.where || '' }),
                        ]),
                        el('div', { class: 'sub money-num', text: `${p.lat}, ${p.lon}` }),
                    ]));
                }
            }
        }

        // ── 用定位 ──
        box.append(el('div', { class: 'place-locate' }, [
            el('button', {
                type: 'button', class: 'btn small',
                text: this.asking ? '定位中…' : '用我現在的位置',
                disabled: this.asking || !this.canLocate(),
                onclick: () => this.useMyLocation(),
            }),
            el('div', { class: 'sub', style: 'margin-top:8px', text: this.canLocate()
                ? '會問一次權限。抓到的位置也會變成其他裝置的預設'
                  + '——手機上按不動這顆，只能跟著這裡設的走。'
                : '這個網址不是 https，瀏覽器不給定位。'
                  + '用上面的搜尋，或直接打經緯度（例如 22.645, 120.605）。' }),
        ]));
    },

    async doSearch() {
        const q = $('#place-q')?.value || '';
        if (!q.trim()) return;
        this.searching = true;
        this.renderPicker();
        $('#place-q').value = q;          // 重畫之後把打的字放回去
        this.found = await this.searchPlaces(q);
        this.searching = false;
        this.renderPicker();
        $('#place-q').value = q;
    },

    async choose(p) {
        this.place = { lat: p.lat, lon: p.lon, name: p.name };
        // 手打指定的跟著設定走，換一台裝置也一樣
        this.savePicked(this.place);
        try { localStorage.removeItem(this.PLACE_KEY); } catch {}
        this.data = null;
        this.renderPicker();
        await this.fetchNow();
        Overview.render();
        this.renderPicker();
        toast(`天氣換成${p.name}了`);
    },

    /** 平常顯示「用我的位置」那顆——只有還沒指定過才顯示 */
    usingDefault() { return !this.savedPlace() && !this.pickedPlace(); },
};
