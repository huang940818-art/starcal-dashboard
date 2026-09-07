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

    async init() {
        this.place = this.savedPlace() || await this.guessPlace();
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

    useMyLocation() {
        if (!navigator.geolocation || this.asking) return;
        this.asking = true;
        Overview.render();
        navigator.geolocation.getCurrentPosition(async pos => {
            this.place = {
                lat: Number(pos.coords.latitude.toFixed(3)),
                lon: Number(pos.coords.longitude.toFixed(3)),
                name: '我的位置',
            };
            this.savePlace(this.place);
            this.data = null;
            await this.fetchNow();
            this.asking = false;
            Overview.render();
        }, () => {
            // 按了不允許，或抓不到。**不要跳警告**——她已經用行動回答過了。
            this.asking = false;
            Overview.render();
        }, { timeout: 8000, maximumAge: 10 * 60 * 1000 });
    },

    usingDefault() { return !this.savedPlace(); },
};
