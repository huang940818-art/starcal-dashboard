/* 想法牆。
 *
 * 為什麼不是又一個清單：清單會強迫你先決定順序。想法還沒成形的時候
 * 根本不知道哪個在前面——空間關係才是這個階段需要的東西。
 * 把相關的擺在一起、把還不確定的推到角落，這些動作本身就是在想。
 *
 * 這也是這個儀表板唯一「電腦專屬」的部分。手機螢幕太小，拖不出空間感。
 *
 * 拖曳用 Pointer Events，滑鼠和觸控走同一條路，不用寫兩套。
 */

const COLORS = ['#F9D984', '#B8D96F', '#5FC9C0', '#A99BE8', '#EE8FA3', '#D9B48F'];

const Wall = {
    data: null,
    color: COLORS[0],

    async init() {
        this.data = await Store.load('便利貼');
        this.data.notes ??= [];

        const box = $('#swatches');
        clear(box);
        for (const c of COLORS) {
            box.append(el('button', {
                class: 'swatch',
                style: `background:${c}`,
                'aria-pressed': String(c === this.color),
                'aria-label': `顏色 ${c}`,
                title: '新的便利貼會是這個顏色',
                onclick: () => { this.color = c; this.markSwatch(); },
            }));
        }

        // 自己挑一個。六個色票是常用的，但「這一疊是同一件事」
        // 有時候就是需要一個不在名單上的顏色。
        const custom = el('input', {
            type: 'color', class: 'color-input swatch-custom',
            value: this.color,
            'aria-label': '自訂便利貼顏色',
            title: '自己挑一個顏色',
            oninput: e => { this.color = e.target.value; this.markSwatch(); },
        });
        box.append(custom);
        this._custom = custom;

        $('#add-sticky').onclick = () => this.add();
    },

    /** 哪一個色票是選中的。自訂色不在名單上時六個都不選。 */
    markSwatch() {
        const now = hexToRgb(this.color);
        $$('#swatches .swatch').forEach(
            b => b.setAttribute('aria-pressed', String(b.style.backgroundColor === now)));
        if (this._custom) this._custom.value = this.color;
    },

    save() { Store.save('便利貼'); },

    topZ() {
        return this.data.notes.reduce((m, n) => Math.max(m, n.z || 0), 0);
    },

    add() {
        const wall = $('#wall-board');
        // 新的貼在可視範圍偏左上，但每張錯開一點，不然會疊在同一個位置
        const n = this.data.notes.length;
        const note = {
            id: uid(),
            text: '',
            x: 30 + (n % 5) * 34,
            y: 26 + (n % 5) * 30,
            color: this.color,
            z: this.topZ() + 1,
            tilt: (Math.random() * 4 - 2),
        };
        this.data.notes.push(note);
        this.save();
        this.render();
        // 貼完直接進打字狀態，不用再點一次
        const node = wall.querySelector(`[data-id="${note.id}"] textarea`);
        node?.focus();
    },

    render() {
        const wall = $('#wall-board');
        clear(wall);

        if (!this.data.notes.length) {
            wall.append(el('div', {
                class: 'empty',
                style: 'position:absolute;inset:0;justify-content:center;--hue:var(--sleep)',
            }, [
                icon('wall', 30), '空的',
                el('div', { class: 'hint', text: '按「貼一張」開始，想到什麼先丟上來，位置之後再調' }),
            ]));
            return;
        }

        for (const note of this.data.notes) wall.append(this.sticky(note));
    },

    /** 便利貼的尺寸，跟 CSS 的 .sticky 對著。夾座標的時候要用。 */
    W: 190,
    H: 130,

    /**
     * 顯示用的座標，夾在現在這面牆裡面。
     *
     * **只夾顯示，不寫回資料。** 牆的寬度跟著螢幕變：在電腦上排好的
     * 位置，換到手機牆只有 360px 寬，右邊那幾張就整個掉到畫面外
     * （看不到、也點不到）。但如果順手把資料改掉，回到電腦就會發現
     * 自己排的版被擠成一團了——那是拿一個問題換另一個問題。
     */
    place(note) {
        const wall = $('#wall-board');
        // 分頁還沒顯示的時候寬度是 0，這時候夾會把每一張都推到左上角
        if (!wall.clientWidth) return { x: note.x, y: note.y };
        return {
            x: Math.max(0, Math.min(note.x, Math.max(0, wall.clientWidth - this.W))),
            y: Math.max(0, Math.min(note.y, Math.max(0, wall.clientHeight - this.H))),
        };
    },

    sticky(note) {
        const area = el('textarea', {
            value: note.text,
            placeholder: '寫點什麼…',
            'aria-label': '便利貼內容',
            oninput: e => {
                note.text = e.target.value;
                this.save();          // Store 會合併成一次寫入，不會每個字都寫檔
            },
        });
        area.value = note.text;

        const at = this.place(note);
        const node = el('div', {
            class: 'sticky',
            'data-id': note.id,
            style: `left:${at.x}px; top:${at.y}px; background:${note.color}; ` +
                   `z-index:${note.z || 1}; --tilt:${(note.tilt ?? 0).toFixed(2)}deg`,
        }, [
            area,
            el('div', { class: 'tools' }, [
                el('button', {
                    type: 'button', title: '換成下一個顏色', text: '◑',
                    onclick: () => {
                        // 自訂色不在名單上，indexOf 會給 -1 → 下一個是第 0 個。
                        // 那是對的：從名單外面按一下就回到名單裡。
                        const i = COLORS.indexOf(note.color);
                        note.color = COLORS[(i + 1) % COLORS.length];
                        node.style.background = note.color;
                        this.save();
                    },
                }),
                el('label', {
                    class: 'pick', title: '自己挑這張的顏色',
                }, [
                    el('input', {
                        type: 'color', value: note.color,
                        'aria-label': '這張便利貼的顏色',
                        oninput: e => {
                            note.color = e.target.value;
                            node.style.background = note.color;
                            this.save();
                        },
                    }),
                ]),
                el('button', {
                    type: 'button', title: '撕掉', text: '✕',
                    onclick: () => {
                        this.data.notes = this.data.notes.filter(n => n.id !== note.id);
                        this.save();
                        this.render();
                    },
                }),
            ]),
        ]);

        this.makeDraggable(node, note);
        return node;
    },

    /** 拖曳。從 textarea 或按鈕上按下去不算拖——那些地方要能選字、能點。 */
    makeDraggable(node, note) {
        let startX, startY, originX, originY, moved;

        node.addEventListener('pointerdown', e => {
            // 工具列上的東西不算拖。**label 和 input 一定要在這裡面**——
            // 少了它們，按下顏色選擇器會被當成開始拖曳、preventDefault
            // 把它吃掉，色盤永遠打不開。
            if (e.target.closest('textarea, button, label, input')) return;
            if (e.button !== 0 && e.pointerType === 'mouse') return;

            startX = e.clientX; startY = e.clientY;
            // 起點用畫面上的位置，不是資料裡的——牆變窄時它們不一樣，
            // 用資料裡的話手指一按便利貼就先跳到別的地方去了
            originX = node.offsetLeft; originY = node.offsetTop;
            moved = false;

            note.z = this.topZ() + 1;
            node.style.zIndex = note.z;
            node.classList.add('dragging');
            node.setPointerCapture(e.pointerId);
            e.preventDefault();
        });

        node.addEventListener('pointermove', e => {
            if (!node.classList.contains('dragging')) return;

            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            if (!moved && Math.hypot(dx, dy) > 3) moved = true;

            const wall = $('#wall-board');
            // 夾在牆內。拖到外面就找不回來了，而且捲軸會被撐出去。
            const maxX = wall.clientWidth - node.offsetWidth;
            const maxY = wall.clientHeight - node.offsetHeight;
            note.x = Math.max(0, Math.min(originX + dx, Math.max(0, maxX)));
            note.y = Math.max(0, Math.min(originY + dy, Math.max(0, maxY)));

            node.style.left = note.x + 'px';
            node.style.top = note.y + 'px';
        });

        const end = e => {
            if (!node.classList.contains('dragging')) return;
            node.classList.remove('dragging');
            node.releasePointerCapture?.(e.pointerId);
            if (moved) this.save();
        };

        node.addEventListener('pointerup', end);
        node.addEventListener('pointercancel', end);
    },
};

/** '#F9D984' → 'rgb(249, 217, 132)'，用來跟 style.backgroundColor 比對 */
function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}
