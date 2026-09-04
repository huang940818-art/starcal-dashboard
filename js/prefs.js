/* 外觀與分類。兩件事放同一支，因為它們是同一件事：**顏色**。
 *
 * 主題色決定「這個儀表板是什麼調性」，分類顏色決定
 * 「這一列是哪一種事」。兩邊共用一組色票，
 * 挑出來的東西才不會互相打架。
 *
 * 存在「設定」那份資料裡（server.py 的白名單本來就留了位子）。
 */

/** 主題色。**刻意選色相分得開的**——八個都是暖黃的話，
 *  換了等於沒換，那個選單就只是在浪費她的時間。 */
const ACCENTS = [
    { c: '#F9D984', name: '星星黃' },
    { c: '#E8A87C', name: '暖橘' },
    { c: '#EE8FA3', name: '玫瑰' },
    { c: '#C9A5E8', name: '薰衣草' },
    { c: '#7FB4E8', name: '天藍' },
    { c: '#5FC9C0', name: '湖水' },
    { c: '#B8D96F', name: '青草' },
    { c: '#E6E0CE', name: '米白' },
];

const DEFAULT_ACCENT = ACCENTS[0].c;

/** 分類色票。十二個色相繞一圈，相鄰兩個都分得出來——
 *  分類的用途就是「一眼看出不一樣」，區分度不夠就沒有意義。 */
const LABEL_COLORS = [
    '#EE8FA3', '#E8836F', '#F0B45F', '#F9D984',
    '#B8D96F', '#7FD9A8', '#5FC9C0', '#7FB4E8',
    '#A99BE8', '#D49BE0', '#D9B48F', '#9FB3A6',
];

/** 第一次用的時候給的分類。
 *
 *  **一定要給。** 空的分類清單會讓「分類」下拉是空的，
 *  跟預算那次一樣——打開一個選項都沒有，看起來像壞了。
 *  只在完全沒有分類、也還沒有任何行程待辦的時候才補：
 *  她自己刪光的話要尊重她。 */
const DEFAULT_LABELS = () => [
    { id: uid(), name: '學校',  color: '#7FB4E8' },
    { id: uid(), name: '專題',  color: '#5FC9C0' },
    { id: uid(), name: '生活',  color: '#B8D96F' },
    { id: uid(), name: '身體',  color: '#EE8FA3' },
    { id: uid(), name: '錢',    color: '#F0B45F' },
];

const Prefs = {
    data: null,

    async init() {
        this.data = await Store.load('設定');
        this.data.accent ??= DEFAULT_ACCENT;
        this.data.labels ??= [];

        // 「從來沒有過」和「自己刪光了」是兩件事，要分得出來。
        //
        // 這裡本來的判斷是「已經有行程待辦就不補」，理由是尊重她刪光的選擇。
        // **那個判斷是錯的**：分類是後來才加的功能，本來就在用的人
        // 資料裡當然沒有 labels——結果一打開是一排空的篩選列，
        // 跟「新資料的分類是空的，預算對話框打開一個欄位都沒有」同一種錯。
        //
        // 用一個旗標記「補過了」，補過就不再補，這樣兩種情況都對。
        if (!this.data.labels.length && !this.data.labelsSeeded) {
            this.data.labels = DEFAULT_LABELS();
            this.data.labelsSeeded = true;
            this.save();
        }

        this.apply();
        $('#appearance').onclick = () => this.openAppearance();
    },

    save() { Store.save('設定'); },

    /* ── 主題色 ─────────────────────────────────── */

    accent() { return this.data?.accent || DEFAULT_ACCENT; },

    apply() {
        const c = this.accent();
        const root = document.documentElement;
        root.style.setProperty('--accent', c);
        // 主色按鈕上的字要看得見。深色主題色配深字會整顆糊掉，
        // 所以文字色跟著算，不寫死。
        //
        // **不要用「亮度超過某個值就配深字」那種門檻。** 那個數字是猜的，
        // 而且猜錯的地方剛好是中間調——例如 #7FB4E8 的亮度只有 0.43，
        // 看起來「不夠亮」，但它配深字的對比度是 6.3，配淺字只有 1.9。
        // 直接算兩邊的對比度取高的，就沒有需要猜的東西。
        const dark = '#21331F', light = '#F2EFE4';
        root.style.setProperty('--on-accent',
            contrast(c, dark) >= contrast(c, light) ? dark : light);
    },

    setAccent(c) {
        this.data.accent = c;
        this.save();
        this.apply();
    },

    /* ── 分類 ───────────────────────────────────── */

    labels() { return this.data?.labels || []; },

    label(id) { return id ? this.labels().find(l => l.id === id) || null : null; },

    /** 分類色點。認不得的 id（分類被刪掉了）就不畫，不要留一個灰點騙人。 */
    dot(id) {
        const l = this.label(id);
        if (!l) return null;
        return el('span', {
            class: 'label-dot',
            style: `background:${l.color}`,
            title: l.name,
            'aria-label': `分類：${l.name}`,
        });
    },

    /** 填一個「分類」下拉，第一項永遠是「不分類」 */
    fillSelect(sel, value) {
        fillSelect(sel, [
            { value: '', label: '不分類' },
            ...this.labels().map(l => ({ value: l.id, label: l.name })),
        ], value || '');
    },

    /* ── 外觀對話框 ─────────────────────────────── */

    openAppearance() {
        const box = $('#appearance-body');
        clear(box);

        const custom = el('input', {
            type: 'color', class: 'color-input',
            value: this.accent(),
            'aria-label': '自訂主題色',
            oninput: e => { this.setAccent(e.target.value); mark(); },
        });

        const swatches = el('div', { class: 'accent-row' },
            ACCENTS.map(a => el('button', {
                type: 'button', class: 'accent', style: `background:${a.c}`,
                title: a.name, 'aria-label': a.name, 'data-c': a.c,
                onclick: () => { this.setAccent(a.c); custom.value = a.c; mark(); },
            })));

        const mark = () => {
            const now = this.accent().toLowerCase();
            for (const b of $$('.accent', swatches)) {
                b.setAttribute('aria-pressed', String(b.dataset.c.toLowerCase() === now));
            }
        };

        box.append(
            el('p', { class: 'sub', style: 'margin:0 0 14px', text:
                '主題色會用在星星、重點數字、主要按鈕和今天那條線上。' }),
            swatches,
            el('div', { class: 'row', style: 'align-items:center;gap:10px;margin-top:14px' }, [
                custom,
                el('span', { class: 'sub', text: '自己挑一個顏色' }),
                el('button', {
                    type: 'button', class: 'btn ghost small', text: '恢復預設',
                    style: 'margin-left:auto',
                    onclick: () => { this.setAccent(DEFAULT_ACCENT); custom.value = DEFAULT_ACCENT; mark(); },
                }),
            ]),
        );
        mark();
        openDialog('#dlg-appearance');
    },

    /* ── 分類對話框 ─────────────────────────────── */

    openLabels() {
        const box = $('#label-editor');
        // 改在副本上做，按取消才真的取消得掉
        let draft = this.labels().map(l => ({ ...l }));

        const draw = () => {
            clear(box);
            if (!draft.length) {
                box.append(el('div', { class: 'empty', style: 'padding:18px 4px' }, [
                    '還沒有分類',
                    el('div', { class: 'hint', text: '按下面「加一個」，行程和待辦就能標顏色' }),
                ]));
            }
            draft.forEach((l, idx) => {
                box.append(el('div', { class: 'label-edit-row' }, [
                    el('input', {
                        type: 'color', class: 'color-input', value: l.color,
                        'aria-label': `${l.name || '分類'}的顏色`,
                        oninput: e => { l.color = e.target.value; },
                    }),
                    el('input', {
                        class: 'grow', value: l.name, placeholder: '分類名稱',
                        'aria-label': '分類名稱',
                        oninput: e => { l.name = e.target.value; },
                    }),
                    el('button', {
                        type: 'button', class: 'btn ghost small', text: '刪掉',
                        'aria-label': `刪掉分類 ${l.name}`,
                        onclick: () => { draft.splice(idx, 1); draw(); },
                    }),
                ]));
            });
            box.append(el('button', {
                type: 'button', class: 'btn small', text: '加一個',
                style: 'margin-top:12px',
                onclick: () => {
                    draft.push({
                        id: uid(), name: '',
                        color: LABEL_COLORS[draft.length % LABEL_COLORS.length],
                    });
                    draw();
                },
            }));
        };
        draw();

        const dlg = openDialog('#dlg-labels');

        $('#l-save').onclick = () => {
            const kept = draft.filter(l => l.name.trim());
            for (const l of kept) l.name = l.name.trim();

            // 分類被刪掉的話，指到它的行程和待辦要放掉那個 id——
            // 留著的話那些東西會永遠指向一個不存在的分類，
            // 篩選的時候就查不到，看起來像資料不見了。
            const alive = new Set(kept.map(l => l.id));
            let orphan = 0;
            for (const e of Cal.data.events) if (e.label && !alive.has(e.label)) { e.label = null; orphan++; }
            for (const t of Todo.data.items) if (t.label && !alive.has(t.label)) { t.label = null; orphan++; }
            if (orphan) { Cal.save(); Todo.save(); }

            this.data.labels = kept;
            // 她自己動過分類了（包括刪光），之後就不要再自己長回來
            this.data.labelsSeeded = true;
            this.save();
            dlg.close();
            Agenda.render();
            Overview.render();
            toast(orphan ? `存好了，${orphan} 件事的分類一起清掉了` : '存好了');
        };
    },
};

/** 兩個顏色的對比度（WCAG 的算法）。1 是一模一樣，21 是黑配白。 */
function contrast(a, b) {
    const la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** 相對亮度（sRGB）。 */
function luminance(hex) {
    const n = parseInt(String(hex).slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
        .map(v => v / 255)
        .map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
