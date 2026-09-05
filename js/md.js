/* 很小的 Markdown 排版。
 *
 * 為什麼需要它：備忘本來只能在「編輯對話框」裡看——一個
 * `min-height:190px` 的 textarea。短的備忘（車位號碼、店員說的話）
 * 那樣剛好，但長一點的東西塞進去就變成一次只看得到四分之一，
 * 而且人是站在刪除鍵旁邊讀的。
 *
 * **這支只做「讀」，不做「寫」。** 存進檔案的永遠是原始文字，
 * 排版只發生在畫出來的那一刻。所以：
 *   - 沒寫 Markdown 的舊備忘不會壞，它就是一段段的文字
 *   - 她在對話框裡改的還是她打的那些字，不會被格式化過的版本蓋掉
 *
 * **規格刻意跟 iOS 星歷的 MarkdownText.swift 對齊**（標題、清單、
 * 編號、引言、程式碼、分隔線、行內粗斜體），沒有表格也沒有巢狀清單。
 * 同一段字在手機和電腦上要長一樣，不然「同一份東西」這件事就假了。
 *
 * 安全性：全部走 `el()` 和 textContent，沒有任何一處 innerHTML。
 * 備忘是她自己打的字，但同樣的排版也用在小克的板子上，那份是
 * 從 Mac 讀進來的——不該因為「來源可信」就開一個注入的洞。
 */

const MD = {
    /** 把整段文字拆成區塊。**抽成純函式才測得到**——邊界都在這裡。 */
    parse(raw) {
        const out = [];
        let para = [];
        let code = [];
        let inCode = false;

        const flush = () => {
            const joined = para.join('\n').trim();
            if (joined) out.push({ t: 'para', text: joined });
            para = [];
        };

        for (const line of String(raw ?? '').split(/\r?\n/)) {
            const s = line.trim();

            // 程式碼區塊優先——裡面的 # 和 - 是內容不是語法
            if (s.startsWith('```')) {
                if (inCode) { out.push({ t: 'code', text: code.join('\n') }); code = []; inCode = false; }
                else { flush(); inCode = true; }
                continue;
            }
            if (inCode) { code.push(line); continue; }

            if (!s) { flush(); continue; }

            if (s === '---' || s === '***') { flush(); out.push({ t: 'divider' }); continue; }

            const level = this.headingLevel(s);
            if (level) {
                flush();
                out.push({ t: 'heading', level, text: s.slice(level + 1).trim() });
                continue;
            }

            if (s.startsWith('- ') || s.startsWith('* ') || s.startsWith('• ')) {
                flush();
                out.push({ t: 'bullet', text: s.slice(2) });
                continue;
            }

            const num = this.numbered(s);
            if (num) { flush(); out.push({ t: 'numbered', number: num[0], text: num[1] }); continue; }

            if (s.startsWith('> ')) { flush(); out.push({ t: 'quote', text: s.slice(2) }); continue; }

            para.push(s);
        }

        flush();
        // 沒有收尾的 ``` 也要把內容吐出來，不然整段會靜靜消失
        if (inCode && code.length) out.push({ t: 'code', text: code.join('\n') });
        return out;
    },

    /** `#` 後面一定要有空白才算標題，不然 `#1` 這種也會被當成標題。 */
    headingLevel(line) {
        let n = 0;
        for (const c of line) { if (c === '#') n++; else break; }
        if (n < 1 || n > 4) return 0;
        return line[n] === ' ' ? n : 0;
    },

    /** `1. 內容` → ['1.', '內容']。點號前面必須是數字。 */
    numbered(line) {
        const i = line.indexOf(' ');
        if (i < 2) return null;
        const head = line.slice(0, i);
        if (!head.endsWith('.')) return null;
        const digits = head.slice(0, -1);
        if (!/^\d+$/.test(digits)) return null;
        return [head, line.slice(i + 1)];
    },

    /* ── 行內 ────────────────────────────────────────── */

    // 順序有意義：`程式碼` 先切走（裡面的星號是內容），
    // 再來是 **粗體**，最後才 *斜體*——反過來的話 ** 會被當成兩個空的斜體。
    INLINE: /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/,

    /** 一行文字 → 一串節點（字串或 <strong>/<em>/<code>）。 */
    inline(text) {
        const parts = String(text ?? '').split(this.INLINE).filter(s => s !== '');
        return parts.map(p => {
            if (p.length > 2 && p.startsWith('`') && p.endsWith('`')) {
                return el('code', { text: p.slice(1, -1) });
            }
            if (p.length > 4 && p.startsWith('**') && p.endsWith('**')) {
                return el('strong', { text: p.slice(2, -2) });
            }
            if (p.length > 2 && p.startsWith('*') && p.endsWith('*')) {
                return el('em', { text: p.slice(1, -1) });
            }
            return p;
        });
    },

    /* ── 畫出來 ──────────────────────────────────────── */

    /** 回傳一個 `.md` 容器。呼叫端自己決定要塞到哪裡。 */
    render(raw) {
        const box = el('div', { class: 'md' });
        for (const b of this.parse(raw)) box.append(this.block(b));
        return box;
    },

    block(b) {
        switch (b.t) {
            case 'heading':
                // h3 起跳——這些東西住在對話框和卡片裡，不是頁面的主標題
                return el('h' + Math.min(b.level + 2, 6), { class: 'md-h' }, this.inline(b.text));
            case 'bullet':
                return el('div', { class: 'md-li' },
                    [el('span', { class: 'md-dot', text: '・' }), el('span', {}, this.inline(b.text))]);
            case 'numbered':
                return el('div', { class: 'md-li' },
                    [el('span', { class: 'md-num', text: b.number }), el('span', {}, this.inline(b.text))]);
            case 'quote':
                return el('blockquote', { class: 'md-quote' }, this.inline(b.text));
            case 'code':
                return el('pre', { class: 'md-code' }, [el('code', { text: b.text })]);
            case 'divider':
                return el('hr', { class: 'md-hr' });
            default:
                return el('p', { class: 'md-p' }, this.inline(b.text));
        }
    },
};
