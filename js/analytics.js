/* 訪客統計。**只算公開網站上的陌生人，不算自己。**
 *
 * 資料送到 GoatCounter（不放 cookie、不做跨站追蹤、不記 IP，
 * 所以不需要 cookie 同意橫幅）。後台看得到哪一天幾個人、從哪裡連來的。
 *
 * 為什麼不是直接把官方那行 <script> 貼進 index.html：
 * 這個儀表板同一份前端跑兩種模式，而 index.html 就是發佈用的檔案本身
 * （不像教練小幫手有一層 build 腳本可以只在產出時注入）。
 * 直接貼的話，自己在家開也會被算進去，統計就髒了。
 *
 * GoatCounter 的 count.js 自己會擋掉 localhost / 127. / 10. /
 * 172.16-31. / 192.168. / 0.0.0.0（2026-09-14 讀過它的原始碼確認），
 * **但沒有擋 100.64.0.0/10**（CGNAT 那一段，好幾套自架網路都用它）。
 * 從別的裝置連回這台看本機版，官方那層擋不住。
 *
 * 所以這裡用白名單而不是黑名單：**只有列在 HOSTS 裡的網域才回報**，
 * 其他一律不送。以後多一個內網位址、多開一個 port，都不會不小心漏進去。
 */

/** GoatCounter 的站台代號（網址 https://<代號>.goatcounter.com 中間那段）。
 *  **留空＝整個功能關掉**，一個位元組都不會送出去。 */
const GC_SITE = 'starcal';

/** 會回報的網域。只有公開的那個。 */
const GC_HOSTS = ['huang940818-art.github.io'];

(function analytics() {
    if (!GC_SITE) return;
    if (!GC_HOSTS.includes(location.hostname)) return;

    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://gc.zgo.at/count.js';
    s.dataset.goatcounter = `https://${GC_SITE}.goatcounter.com/count`;
    // 擋掉了、或離線，都不該讓它變成畫面上的錯誤
    s.onerror = () => {};
    document.head.append(s);
})();
