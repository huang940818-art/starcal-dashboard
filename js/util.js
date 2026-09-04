/* 小工具。 */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** 建元素。文字一律走 textContent，不用 innerHTML——
 *  備忘和便利貼的內容是自己打的，但寫成拼字串遲早有一天會拼到別的地方。 */
function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'style') node.style.cssText = v;
        else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
        else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of [].concat(children)) {
        if (c === null || c === undefined || c === false) continue;
        node.append(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
}

function clear(node) { while (node.firstChild) node.firstChild.remove(); }

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* ── 錢 ────────────────────────────────────────────── */

/** 金額。**不用小數**——台幣記到角沒有意義，而且對齊起來難看。 */
function money(n, sign = false) {
    const v = Math.round(Number(n) || 0);
    const s = Math.abs(v).toLocaleString('zh-TW');
    if (sign) return (v > 0 ? '+' : v < 0 ? '−' : '') + s;
    return (v < 0 ? '−' : '') + s;
}

/* ── 日期 ──────────────────────────────────────────── */

const pad = n => String(n).padStart(2, '0');

/** Date → "2026-09-02"。**用本地時間**，不能用 toISOString——
 *  那個會轉成 UTC，台灣時間半夜記的帳會被記到前一天。 */
function ymd(d = new Date()) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "2026-09-02" → Date（當地時間的當天零點） */
function parseYmd(s) {
    const [y, m, d] = String(s).split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
}

const todayStr = () => ymd();
const monthOf = s => String(s).slice(0, 7);          // "2026-09"
const thisMonth = () => monthOf(todayStr());

function monthLabel(ym) {
    const [y, m] = ym.split('-');
    return `${Number(m)}月`;
}

/** 相對日期，給列表用 */
function relativeDay(s) {
    const d = parseYmd(s);
    const today = parseYmd(todayStr());
    const diff = Math.round((d - today) / 86400000);
    if (diff === 0) return '今天';
    if (diff === 1) return '明天';
    if (diff === -1) return '昨天';
    if (diff > 1 && diff <= 7) return `${diff} 天後`;
    if (diff < -1 && diff >= -7) return `${-diff} 天前`;
    const sameYear = d.getFullYear() === today.getFullYear();
    return sameYear ? `${d.getMonth() + 1}/${d.getDate()}`
                    : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

/** 往前推 n 個月的月份字串陣列，舊的在前 */
function recentMonths(n) {
    const out = [];
    const d = new Date();
    d.setDate(1);
    for (let i = n - 1; i >= 0; i--) {
        const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
        out.push(`${m.getFullYear()}-${pad(m.getMonth() + 1)}`);
    }
    return out;
}

/* ── 顏色 ──────────────────────────────────────────── */

/** 相對亮度（sRGB）。 */
function luminance(hex) {
    const n = parseInt(String(hex).slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
        .map(v => v / 255)
        .map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** 兩個顏色的對比度（WCAG 的算法）。1 是一模一樣，21 是黑配白。 */
function contrast(a, b) {
    const la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * 這個底色上該放深字還是淺字。
 *
 * **不要用「亮度超過某個值就配深字」那種門檻**——那個數字是猜的，
 * 而且猜錯的地方剛好是中間調。直接算兩邊的對比度取高的。
 */
const INK_DARK = '#23231C';
const INK_LIGHT = '#F5F2EA';
function inkOn(bg) {
    return contrast(bg, INK_DARK) >= contrast(bg, INK_LIGHT) ? INK_DARK : INK_LIGHT;
}

/* ── 提示 ──────────────────────────────────────────── */

let toastTimer;
function toast(msg, bad = false) {
    const node = $('#toast');
    node.textContent = msg;
    node.classList.toggle('bad', bad);
    node.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('show'), bad ? 4200 : 2000);
}

/* ── 對話框 ────────────────────────────────────────── */

/** 開一個 <dialog>，把第一個輸入框 focus 起來 */
function openDialog(id) {
    const dlg = $(id);
    dlg.showModal();
    const first = dlg.querySelector('input:not([type=checkbox]), textarea, select');
    if (first) setTimeout(() => first.focus(), 40);
    return dlg;
}

/** 下拉選單填選項 */
function fillSelect(sel, options, value) {
    clear(sel);
    for (const o of options) {
        const opt = typeof o === 'string' ? { value: o, label: o } : o;
        sel.append(el('option', { value: opt.value, text: opt.label }));
    }
    if (value !== undefined) sel.value = value;
}
