/* 備忘錄。
 *
 * 跟待辦刻意分開。待辦是「要做的事」，有完成與否、有期限；
 * 備忘是「先記下來免得忘記」——車位號碼、店員說的話、突然想到的點子。
 * 這種東西沒有「完成」的概念，硬塞進待辦清單只會讓待辦看起來永遠做不完。
 *
 * 第一行當標題。不另外開一個標題欄位，是因為記東西的時候
 * 沒有人想先想一個標題再開始打字。
 */

const Memo = {
    data: null,
    /** 目前展開的那幾則。
     *
     * 可以同時展開多則，不做成「開一則就關掉別的」——她放的是四間學校的
     * 簡章整理，**要對照著看**。強制只能開一則等於強迫她記在腦子裡。
     */
    open: new Set(),

    async init() {
        this.data = await Store.load('備忘');
        this.data.items ??= [];
        $('#add-memo').onclick = () => this.edit(null);
    },

    save() { Store.save('備忘'); },

    sorted() {
        return [...this.data.items].sort((a, b) => {
            if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
            return (b.updatedAt || 0) - (a.updatedAt || 0);
        });
    },

    titleOf(text) {
        // 第一行當標題，但要去掉 Markdown 的記號——第一行常常寫成
        // 「# 碩士班四校總覽」，標題列上直接印出井字號很醜。
        const first = (text.split('\n')[0] || '').trim();
        const clean = first
            .replace(/^#{1,6}\s*/, '')
            .replace(/\*\*(.+?)\*\*/g, '$1')
            .trim();
        return clean || '（空白）';
    },

    /** 攤開來要顯示的內文：把當標題的那一行拿掉，不然標題會出現兩次。 */
    bodyOf(text) {
        return text.split('\n').slice(1).join('\n').replace(/^\s+/, '');
    },

    previewOf(text) {
        const rest = text.split('\n').slice(1).join(' ').trim();
        return rest.length > 90 ? rest.slice(0, 90) + '…' : rest;
    },

    render() {
        const box = $('#memo-list');
        clear(box);

        const items = this.sorted();
        if (!items.length) {
            box.append(el('div', { class: 'empty' }, [
                icon('memo', 26), '還沒有備忘',
                el('div', { class: 'hint', text: '車位號碼、店員說的話、突然想到的點子' }),
            ]));
            return;
        }

        for (const m of items) {
            const open = this.open.has(m.id);
            box.append(el('div', { class: 'memo-item' + (open ? ' open' : '') }, [
                // 點標題是「展開來看」，不是「進去編輯」。
                //
                // 原本點一下開的是編輯對話框——她只是想讀，卻被丟進一個
                // 裝滿 ** 和 > 的純文字方框，而且那些備忘有 45–63 行。
                // 她說「要點開來看很麻煩，版面也不好看」，兩件事是同一個原因。
                el('div', {
                    class: 'memo-row',
                    role: 'button',
                    tabindex: '0',
                    'aria-expanded': String(open),
                    onclick: () => this.toggle(m.id),
                    onkeydown: e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            this.toggle(m.id);
                        }
                    },
                }, [
                    el('div', { class: 'memo-caret', text: open ? '▾' : '▸' }),
                    el('div', { class: 'grow' }, [
                        el('div', { class: 'memo-title' + (open ? '' : ' ellipsis') },
                            [m.pinned ? '📌 ' : '', this.titleOf(m.text)].join('')),
                        // 展開的時候不重複顯示預覽——下面就是全文了
                        !open && this.previewOf(m.text)
                            ? el('div', { class: 'memo-preview ellipsis', text: this.previewOf(m.text) })
                            : null,
                    ]),
                    el('div', { class: 'memo-date', text: relativeDay(ymd(new Date(m.updatedAt || Date.now()))) }),
                ]),
                open
                    ? el('div', { class: 'memo-body' }, [
                        renderMarkdown(this.bodyOf(m.text)),
                        el('div', { class: 'memo-actions' }, [
                            el('button', {
                                type: 'button', class: 'btn small', text: '編輯',
                                onclick: e => { e.stopPropagation(); this.edit(m); },
                            }),
                            el('button', {
                                type: 'button', class: 'btn small ghost',
                                text: m.pinned ? '取消釘選' : '釘選',
                                onclick: e => {
                                    e.stopPropagation();
                                    m.pinned = !m.pinned;
                                    // 釘選不是「改內容」，不該把它推到最上面——
                                    // updatedAt 留著（跟 edit() 同一個道理）
                                    this.save();
                                    this.render();
                                },
                            }),
                            el('button', {
                                type: 'button', class: 'btn small ghost', text: '收起來',
                                onclick: e => { e.stopPropagation(); this.toggle(m.id); },
                            }),
                        ]),
                      ])
                    : null,
            ]));
        }
    },

    toggle(id) {
        if (this.open.has(id)) this.open.delete(id);
        else this.open.add(id);
        this.render();
    },

    /* 編輯框和預覽二選一。
     *
     * **不做左右並排的即時預覽。** 這張對話框在手機上只有一欄寬，
     * 拆成兩半等於兩邊都不能用；而且備忘多半是「打完就存」，
     * 不是需要邊寫邊校版的東西。要看的時候按一下就好。
     */
    showPreview(on) {
        const box = $('#m-preview');
        $('#m-edit-wrap').hidden = on;
        box.hidden = !on;
        $('#m-preview-btn').textContent = on ? '回到編輯' : '預覽';

        if (!on) return;
        clear(box);
        const text = $('#m-text').value.trim();
        if (!text) {
            box.append(el('div', { class: 'empty-preview', text: '還沒有內容' }));
            return;
        }
        // 第一行是標題。清單那邊把它畫在標題列上，這裡沒有那一列，
        // **所以要自己補一行**——不補的話預覽會少掉第一行，看起來像吃字。
        box.append(el('div', { class: 'preview-title', text: this.titleOf(text) }));
        box.append(renderMarkdown(this.bodyOf(text)));
    },

    edit(m) {
        const isNew = !m;
        m = m || { id: uid(), text: '', pinned: false, createdAt: Date.now(), updatedAt: Date.now() };

        $('#dlg-memo-title').textContent = isNew ? '新增備忘' : '備忘';
        $('#m-text').value = m.text;
        $('#m-pinned').checked = !!m.pinned;
        $('#m-delete').hidden = isNew;

        // **每次打開都回到編輯狀態。** 上次關掉的時候停在預覽，
        // 下次點「編輯」卻看到一個不能打字的畫面，會以為壞掉了。
        this.showPreview(false);

        const dlg = openDialog('#dlg-memo');

        // **游標放開頭，畫面捲到最上面。** openDialog 會 focus 這個 textarea，
        // 而瀏覽器把游標擺在結尾——打開一則長備忘，第一眼看到的是最後一行。
        // 那不是「開始編輯」該有的位置。
        setTimeout(() => {
            const ta = $('#m-text');
            try { ta.setSelectionRange(0, 0); } catch (e) { /* 舊瀏覽器 */ }
            ta.scrollTop = 0;
        }, 50);

        $('#m-preview-btn').onclick = () => this.showPreview($('#m-preview').hidden);

        $('#m-save').onclick = () => {
            const text = $('#m-text').value.trim();
            if (!text) return toast('空的備忘留著沒有用', true);

            const changed = text !== m.text;
            m.text = text;
            m.pinned = $('#m-pinned').checked;
            // **只有內容變了才動 updatedAt。** 只是點開來看一眼就把它推到最上面，
            // 排序就失去意義了。
            if (changed || isNew) m.updatedAt = Date.now();

            if (isNew) this.data.items.push(m);
            this.save();
            dlg.close();
            this.render();
            Overview.render();
        };

        $('#m-delete').onclick = () => {
            this.data.items = this.data.items.filter(x => x.id !== m.id);
            this.save();
            dlg.close();
            this.render();
            Overview.render();
        };
    },
};
