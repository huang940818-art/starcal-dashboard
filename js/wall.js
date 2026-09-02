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
                onclick: () => {
                    this.color = c;
                    $$('#swatches .swatch').forEach(
                        b => b.setAttribute('aria-pressed', String(b.style.backgroundColor === hexToRgb(c))));
                },
            }));
        }

        $('#add-sticky').onclick = () => this.add();
    },

    save() { Store.save('便利貼'); },

    topZ() {
        return this.data.notes.reduce((m, n) => Math.max(m, n.z || 0), 0);
    },

    add() {
        const wall = $('#wall');
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
        const wall = $('#wall');
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

        const node = el('div', {
            class: 'sticky',
            'data-id': note.id,
            style: `left:${note.x}px; top:${note.y}px; background:${note.color}; ` +
                   `z-index:${note.z || 1}; --tilt:${(note.tilt ?? 0).toFixed(2)}deg`,
        }, [
            area,
            el('div', { class: 'tools' }, [
                el('button', {
                    type: 'button', title: '換顏色', text: '◑',
                    onclick: () => {
                        const i = COLORS.indexOf(note.color);
                        note.color = COLORS[(i + 1) % COLORS.length];
                        node.style.background = note.color;
                        this.save();
                    },
                }),
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
            if (e.target.closest('textarea, button')) return;
            if (e.button !== 0 && e.pointerType === 'mouse') return;

            startX = e.clientX; startY = e.clientY;
            originX = note.x; originY = note.y;
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

            const wall = $('#wall');
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
