/* 圖表。
 *
 * 只畫三種：長條、折線、圓餅。不拉圖表庫——
 * 一來離線要能開，二來那些庫的預設樣式跟這裡的主題怎麼都對不起來，
 * 三來這三種圖的幾何加起來不到一百行，包一整包不划算。
 *
 * **幾何算式跟畫面分開。** 角度算錯、折線的點位算錯，畫出來只是
 * 「有點怪」，不會有任何錯誤訊息。分開之後那些算式可以直接測。
 */

const Charts = {

    /* ── 幾何（純算式，可以測） ────────────────────── */

    /**
     * 圓餅每一塊佔的比例，以及起訖位置（0–1，從十二點鐘順時針）。
     *
     * 負數和零直接當成零——支出不該是負的，但資料是人打的，
     * 一筆負數會把整個圓的總和弄小，剩下每一塊都被撐大。
     */
    slices(values) {
        const safe = values.map(v => Math.max(0, Number(v) || 0));
        const total = safe.reduce((s, v) => s + v, 0);
        if (total <= 0) return [];

        let acc = 0;
        return safe.map(v => {
            const fraction = v / total;
            const s = { value: v, fraction, start: acc, end: acc + fraction };
            acc += fraction;
            return s;
        });
    },

    /**
     * 折線的點座標。
     *
     * 底一律從 0 起算，不從最小值起算——後者會把「三萬和三萬一」
     * 畫成從谷底衝到山頂，看起來像暴增。
     */
    points(values, w, h, pad = 0, sharedPeak = 0, spread = 'center', padX = null) {
        const n = values.length;
        if (!n) return [];
        // 幾條線一起畫的時候要共用同一個峰值，不然收入三萬和支出三千
        // 會畫成一樣高，看起來剛好打平
        const peak = sharedPeak > 0
            ? sharedPeak : Math.max(1, ...values.map(v => Number(v) || 0));
        // 橫的內距可以跟直的不一樣。'center' 模式的點本來就不會碰到邊，
        // 橫的留白只會讓底下那排等寬的月份跟點對不上半格。
        const px = padX === null ? pad : padX;
        const iw = w - px * 2, ih = h - pad * 2;

        /* 'center'：每個點站在自己那一格的正中間，跟長條圖一樣。
         *   下面那排月份是等寬的格子，用這個才對得上——
         *   'edge' 的話第一個點貼著最左邊，月份標籤卻在第一格中間，
         *   整排差半格，而且**看起來只是「有點怪」**，不會有人報錯。
         * 'edge'：頭尾各佔一端，線拉滿整個寬度。 */
        const at = i => spread === 'edge'
            ? (n === 1 ? iw / 2 : iw * i / (n - 1))   // 一個點的時候 n-1 是零
            : iw * (i + 0.5) / n;

        return values.map((v, i) => ({
            x: px + at(i),
            y: pad + ih - ih * (Math.max(0, Number(v) || 0) / peak),
        }));
    },

    /** 把點串成 SVG 的 d。空的時候回空字串，不是 "M"——後者畫不出來但也不報錯。 */
    linePath(pts) {
        if (!pts.length) return '';
        return pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    },

    /* ── 畫（要 DOM） ──────────────────────────────── */

    svg(w, h, extra = {}) {
        const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        node.setAttribute('viewBox', `0 0 ${w} ${h}`);
        node.setAttribute('aria-hidden', 'true');
        for (const [k, v] of Object.entries(extra)) node.setAttribute(k, v);
        return node;
    },

    shape(tag, attrs) {
        const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
        for (const [k, v] of Object.entries(attrs)) {
            if (v === null || v === undefined) continue;
            node.setAttribute(k, v);
        }
        return node;
    },

    /**
     * 甜甜圈。
     *
     * 用 stroke-dasharray 切一個圓，不是用 path 拼弧線——後者要處理
     * 大弧旗標（超過半圈那個），寫錯了在剛好超過 180 度的時候才會現形。
     *
     * @param rows [{ label, value, color }]
     * @param opts { size, thickness, center }  center 是中間那行字
     */
    donut(rows, opts = {}) {
        const size = opts.size || 168;
        const thickness = opts.thickness || 26;
        const r = (size - thickness) / 2;
        const c = size / 2;
        const circumference = 2 * Math.PI * r;

        const svg = this.svg(size, size, { class: 'donut', width: size, height: size });

        // 底環：全部都零的時候至少看得到一個圈，不是一片空白
        svg.append(this.shape('circle', {
            cx: c, cy: c, r, fill: 'none',
            stroke: 'var(--separator)', 'stroke-width': thickness,
        }));

        const parts = this.slices(rows.map(x => x.value));
        parts.forEach((p, i) => {
            // 太小的塊畫出來只有一條縫，反而讓相鄰兩塊看起來像有裂痕
            if (p.fraction <= 0) return;
            const arc = this.shape('circle', {
                cx: c, cy: c, r, fill: 'none',
                stroke: rows[i].color, 'stroke-width': thickness,
                'stroke-dasharray': `${(p.fraction * circumference).toFixed(2)} ${circumference.toFixed(2)}`,
                'stroke-dashoffset': (-p.start * circumference).toFixed(2),
                // 圓從三點鐘開始，轉到十二點鐘——大家看圓餅都從正上方開始讀
                transform: `rotate(-90 ${c} ${c})`,
            });
            arc.append(this.shape('title', {}));
            arc.lastChild.textContent =
                `${rows[i].label} ${Math.round(p.fraction * 100)}%`;
            svg.append(arc);
        });

        const box = el('div', { class: 'donut-box' }, [svg]);
        if (opts.center) {
            box.append(el('div', { class: 'donut-center' }, [].concat(opts.center)));
        }
        return box;
    },

    /**
     * 折線。收入一條、支出一條。
     *
     * 畫在固定的 viewBox 裡再讓 CSS 拉寬，所以手機和電腦是同一份幾何——
     * 不用為了兩種寬度算兩次。
     */
    lines(series, opts = {}) {
        // 尺寸由呼叫的人量好傳進來（容器的實際像素），viewBox 就是 1:1。
        // **不要用 preserveAspectRatio="none" 硬拉一個固定比例的 viewBox**
        // ——那樣圓點會被拉成橢圓，線的粗細也會左右不一樣。
        const w = opts.width || 640, h = opts.height || 160, pad = opts.pad || 12;

        const all = series.flatMap(s => s.values);
        const peak = Math.max(1, ...all.map(v => Number(v) || 0));

        const svg = this.svg(w, h, { class: 'linechart' });

        // 中線，給眼睛一個比例的參考
        svg.append(this.shape('line', {
            x1: 0, x2: w, y1: pad + (h - pad * 2) / 2, y2: pad + (h - pad * 2) / 2,
            stroke: 'var(--separator)', 'stroke-width': 1,
        }));

        for (const s of series) {
            const pts = this.points(s.values, w, h, pad, peak, 'center', 0);

            // 線下面墊一層很淡的面。底是從零起算的，不填的話下半部
            // 那一大片空白看起來像圖沒畫完，而不是「離零還有這麼多」。
            if (pts.length > 1) {
                svg.append(this.shape('path', {
                    d: this.linePath(pts)
                        + ` L${pts[pts.length - 1].x.toFixed(1)} ${(h - pad).toFixed(1)}`
                        + ` L${pts[0].x.toFixed(1)} ${(h - pad).toFixed(1)} Z`,
                    fill: s.color, opacity: .1, stroke: 'none',
                }));
            }

            svg.append(this.shape('path', {
                d: this.linePath(pts),
                fill: 'none', stroke: s.color, 'stroke-width': 2.6,
                'stroke-linecap': 'round', 'stroke-linejoin': 'round',
                'vector-effect': 'non-scaling-stroke',
            }));
            for (const p of pts) {
                svg.append(this.shape('circle', {
                    cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: 3.4, fill: s.color,
                }));
            }
        }
        return svg;
    },
};
