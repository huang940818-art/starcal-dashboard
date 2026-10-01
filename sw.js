/* 離線快取。**只做一件事：Mac 關著的時候，讓 App 還打得開。**
 *
 * 策略是「**網路優先，連不到才用快取**」，不是反過來。
 * 快取優先才是「改了程式卻一直看到舊版」那類 bug 的來源；
 * 網路優先的話，只要 Mac 開著就永遠拿最新的，快取純粹是保險。
 *
 * api/ 一律不碰：資料的離線版走 store.js 的快照，
 * 由它負責標示「這是什麼時候的資料」並且擋住存檔。
 * 在這裡快取 api 回應的話，離線時看起來像連得上，然後存檔靜靜失敗。
 */
const CACHE = '星歷殼-v1';

self.addEventListener('install', (e) => {
    self.skipWaiting();
    e.waitUntil(caches.open(CACHE).then((c) => c.addAll([
        './', './index.html', './site.webmanifest',
        './css/style.css',
        './js/app.js', './js/store.js', './js/util.js', './js/data.js',
        './js/money.js', './js/todo.js', './js/memo.js', './js/wall.js',
        './js/calendar.js', './js/timetable.js', './js/overview.js',
        './js/charts.js', './js/agenda.js', './js/countdown.js',
        './js/holidays.js', './holidays.json', './js/gcal.js', './js/ics.js',
        './js/prefs.js', './js/themes.js', './js/icons.js', './js/md.js',
        './js/csv.js', './js/autocat.js', './js/shifts.js', './js/ke.js',
        './js/update.js', './js/weather.js', './js/demo.js', './js/review.js',
    ]).catch(() => {
        // 少一兩個檔不要讓整個安裝失敗——有快取總比沒有好
    })));
});

self.addEventListener('activate', (e) => {
    e.waitUntil(caches.keys().then((ks) =>
        Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);
    if (e.request.method !== 'GET') return;
    if (url.origin !== self.location.origin) return;
    if (url.pathname.includes('/api/')) return;   // 資料走快照，不走這裡

    const fromCache = () => caches.match(e.request).then((hit) => hit
        || caches.match('./index.html'));

    e.respondWith(
        fetch(e.request)
            .then((res) => {
                if (res && res.ok) {
                    const copy = res.clone();
                    caches.open(CACHE).then((c) => c.put(e.request, copy));
                    return res;
                }
                // **5xx 也算連不到。** 手機走 4G、Tailscale 剛好斷掉的時候，
                // 100.x 會被電信的代理接走，回一頁「500 Internal Privoxy Error」。
                // 那不是網路錯誤，不會進 catch，以前就直接把那頁錯誤秀給她看。
                if (res && res.status >= 500) {
                    return fromCache().then((hit) => hit || res);
                }
                return res;
            })
            .catch(fromCache)
    );
});
