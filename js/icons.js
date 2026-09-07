/* 圖示。
 *
 * 全是文字的畫面，眼睛掃過去沒有落腳點——每個區塊看起來都一樣重。
 * 圖示不是裝飾，是讓人一眼認出「這塊是錢、那塊是待辦」的錨點。
 *
 * 自己畫 inline SVG，不拉圖示庫：
 * 一來離線要能開，二來為了九個圖示載一整包不划算，
 * 三來 `stroke: currentColor` 讓它自動跟著每個區塊的顏色走。
 *
 * 線條粗細統一 1.6，圓端點——跟 iOS 星歷用的 SF Symbols 是同一種調性。
 */

const ICONS = {
    star: '<path d="M12 3l2.4 5.4 5.6.6-4.2 3.9 1.2 5.6L12 15.7 6.9 18.5l1.2-5.6L4 9l5.6-.6z"/>',
    money: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.6"/><path d="M6 12h.01M18 12h.01"/>',
    todo: '<rect x="3.5" y="4.5" width="17" height="16" rx="3"/><path d="M8 12.5l2.6 2.6L16 9.6"/>',
    memo: '<path d="M6 3.5h8.5L19 8v12.5H6z"/><path d="M14 3.5V8h4.5M9 12.5h6M9 16h4"/>',
    wall: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
    trend: '<path d="M3 17.5l5.5-5.5 3.5 3.5L21 6.5"/><path d="M15.5 6.5H21v5.5"/>',
    budget: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v8.5l6 3"/>',
    sub: '<path d="M20.5 12a8.5 8.5 0 0 1-14.6 5.9M3.5 12A8.5 8.5 0 0 1 18.1 6.1"/><path d="M3.5 17.5v-4h4M20.5 6.5v4h-4"/>',
    scale: '<path d="M12 4v16M4.5 8.5h15"/><path d="M4.5 8.5L2 14h5zM19.5 8.5L17 14h5z"/>',
    alert: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5M12 16h.01"/>',
    list: '<path d="M4 6.5h16M4 12h16M4 17.5h10"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 9.5h17M8 3.5v3M16 3.5v3"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.8"/>',
    signal: '<path d="M12 19.5h.01"/><path d="M8.8 16.3a4.5 4.5 0 0 1 6.4 0"/><path d="M5.6 13.1a9 9 0 0 1 12.8 0"/><path d="M2.5 10a13.5 13.5 0 0 1 19 0"/>',
    wallet: '<path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h11.5v2.5"/><rect x="3.5" y="7.5" width="17" height="12" rx="2.5"/><path d="M16.5 13.5h.01"/>',
    // 遮住存款的那顆。**兩個圖都要有**——只換文字的話，
    // 按下去以後看不出來現在是遮著還是看得到。
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3.1"/>',
    'eye-off': '<path d="M10.2 6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17.6 17.6 0 0 1-3.4 4.2"/><path d="M6.5 8A16.7 16.7 0 0 0 2.5 12S6 18.5 12 18.5c1 0 1.9-.2 2.7-.5"/><path d="M10.1 10.1a2.7 2.7 0 0 0 3.8 3.8"/><path d="M3.5 3.5l17 17"/>',
    // 天氣。**只畫六種**——晴、多雲、陰、雨、雷雨、雪（外加霧）。
    // WMO 有二十幾個代碼，但畫面上分那麼細沒有用：人要的是
    // 「今天要不要帶傘」，不是「毛毛雨和小雨的差別」。
    sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.2 5.2l1.9 1.9M16.9 16.9l1.9 1.9M18.8 5.2l-1.9 1.9M7.1 16.9l-1.9 1.9"/>',
    cloudsun: '<circle cx="8.5" cy="8" r="3"/><path d="M8.5 2.6v1.5M3.1 8h1.5M4.7 4.2l1 1M12.3 4.2l-1 1"/><path d="M9 19.5h8.5a3.2 3.2 0 0 0 .3-6.4 4.4 4.4 0 0 0-8.5-.9A2.9 2.9 0 0 0 9 19.5z"/>',
    cloud: '<path d="M7 19h10.5a3.4 3.4 0 0 0 .3-6.8 4.7 4.7 0 0 0-9.1-1A3.1 3.1 0 0 0 7 19z"/>',
    rain: '<path d="M7.5 15.5h9.5a3.2 3.2 0 0 0 .3-6.4 4.4 4.4 0 0 0-8.5-.9 2.9 2.9 0 0 0-1.3 7.3z"/><path d="M9 18.5l-1 2.5M13 18.5l-1 2.5M17 18.5l-1 2.5"/>',
    storm: '<path d="M7.5 14.5h9.5a3.2 3.2 0 0 0 .3-6.4 4.4 4.4 0 0 0-8.5-.9 2.9 2.9 0 0 0-1.3 7.3z"/><path d="M13 16l-3 3.5h3l-1.5 3"/>',
    snow: '<path d="M7.5 14.5h9.5a3.2 3.2 0 0 0 .3-6.4 4.4 4.4 0 0 0-8.5-.9 2.9 2.9 0 0 0-1.3 7.3z"/><path d="M9.5 18h.01M12 20h.01M14.5 18h.01"/>',
    fog: '<path d="M4 9.5h16M6 13h12M4 16.5h16M7 20h10"/>',
};

/**
 * @param {string} name  ICONS 的鍵
 * @param {number} size  邊長，預設 18
 */
function icon(name, size = 18) {
    const path = ICONS[name];
    if (!path) return document.createTextNode('');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.6');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = path;
    return svg;
}
