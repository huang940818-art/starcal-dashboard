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

    edit(m) {
        const isNew = !m;
        m = m || { id: uid(), text: '', pinned: false, createdAt: Date.now(), updatedAt: Date.now() };

        $('#dlg-memo-title').textContent = isNew ? '新增備忘' : '備忘';
        $('#m-text').value = m.text;
        $('#m-pinned').checked = !!m.pinned;
        $('#m-delete').hidden = isNew;

        const dlg = openDialog('#dlg-memo');

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
