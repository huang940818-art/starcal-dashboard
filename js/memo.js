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
        return (text.split('\n')[0] || '').trim() || '（空白）';
    },

    previewOf(text) {
        // 預覽是一行純文字，**要把 markdown 的記號擦掉**——
        // 清單上出現 `> **決定…` 這種東西，看起來像壞掉而不像有排版。
        const rest = text.split('\n').slice(1)
            .map(l => l.trim()
                .replace(/^#{1,4}\s+/, '')      // 標題
                .replace(/^>\s+/, '')           // 引言
                .replace(/^[-*•]\s+/, '')       // 清單
                .replace(/^\d+\.\s+/, '')       // 編號
                .replace(/\*\*/g, '')           // 粗體
                .replace(/`/g, ''))             // 行內程式碼
            .filter(l => l && l !== '---' && l !== '***')
            .join(' ')
            .trim();
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
            box.append(el('div', { class: 'memo-row', onclick: () => this.read(m) }, [
                el('div', { class: 'grow' }, [
                    el('div', { class: 'memo-title ellipsis' },
                        [m.pinned ? '📌 ' : '', this.titleOf(m.text)].join('')),
                    this.previewOf(m.text)
                        ? el('div', { class: 'memo-preview ellipsis', text: this.previewOf(m.text) })
                        : null,
                ]),
                el('div', { class: 'memo-date', text: relativeDay(ymd(new Date(m.updatedAt || Date.now()))) }),
            ]));
        }
    },

    /* 讀，不是改。
     *
     * 點一則備忘本來直接開編輯對話框——那是為「改一行字」設計的，
     * 不是為「讀一份東西」設計的：內容擠在 190px 的 textarea 裡，
     * 一次看到四分之一，而且人是站在刪除鍵旁邊讀的。
     *
     * 所以先進閱讀畫面，要改再按「編輯」。**多一步，但那一步是往安全的方向。**
     */
    read(m) {
        $('#dlg-memo-read-title').textContent = this.titleOf(m.text);

        const body = $('#mr-body');
        clear(body);
        // 第一行已經是對話框的標題了，內文再印一次等於同一句話看兩遍
        body.append(MD.render(m.text.split('\n').slice(1).join('\n')));
        body.scrollTop = 0;

        const dlg = openDialog('#dlg-memo-read');
        body.focus();

        $('#mr-close').onclick = () => dlg.close();
        $('#mr-edit').onclick = () => { dlg.close(); this.edit(m); };
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
        // 第一行是標題。閱讀畫面把它畫在對話框的標題列上，這裡沒有那一列，
        // **所以要自己補一行**——不補的話預覽會少掉第一行，看起來像吃字。
        const lines = text.split('\n');
        box.append(el('div', { class: 'preview-title', text: this.titleOf(text) }));
        box.append(MD.render(lines.slice(1).join('\n')));
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
