/* 把 Markdown 畫出來。
 *
 * 為什麼要自己寫一支：備忘裡放的是整理好的長文（碩士班簡章那幾則是
 * 45–63 行），而原本「點開來看」開的是編輯框——**她只是想讀，
 * 卻被丟進一個裝滿 ** 和 > 的純文字方框裡。**
 * 難看和麻煩其實是同一個原因。
 *
 * 只做她的內容真的用到的那幾種：標題、清單、編號、引用、粗體、
 * 行內程式碼、連結、裸網址、分隔線、表格。
 * 用不到的語法只會變成沒被測過的程式碼，所以每加一種都要真的有人在用——
 * 表格是 2026-09-23 補的：有一則筆記整理了好幾張對照表（修正前後的數字、
 * 同一段文字的三個版本），在手機上被攤成一行一行的 | 根本讀不了。
 *
 * **全部用 DOM API 建，不碰 innerHTML。** 備忘的內容是她自己打的沒錯，
 * 但裡面只要出現一個 < 就會把版面吃掉；而且這份程式碼會上 GitHub，
 * 別人拿去放什麼內容我管不到。
 */

/** 行內：`code`、**粗體**、[字](網址)、裸網址 */
function mdInline(text, into) {
    const re = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<]+)/g;
    let last = 0, m;
    const link = (label, href) => el('a', {
        href, target: '_blank', rel: 'noopener noreferrer', text: label,
    });

    while ((m = re.exec(text))) {
        if (m.index > last) into.append(document.createTextNode(text.slice(last, m.index)));
        if (m[1] !== undefined) into.append(el('code', { text: m[1] }));
        else if (m[2] !== undefined) into.append(el('strong', { text: m[2] }));
        else if (m[3] !== undefined) into.append(link(m[3], m[4]));
        else into.append(link(m[5], m[5]));
        last = m.index + m[0].length;
    }
    if (last < text.length) into.append(document.createTextNode(text.slice(last)));
    return into;
}

/** 這一行是不是表格的分隔列：|---|:--:|--:| */
function isTableDivider(line) {
    if (typeof line !== 'string') return false;
    const t = line.trim();
    return t.startsWith('|') && /^\|(?:\s*:?-+:?\s*\|)+$/.test(t);
}

/** |a|b|c| → ['a','b','c']（頭尾的 | 可有可無） */
function tableCells(line) {
    let t = line.trim();
    if (t.startsWith('|')) t = t.slice(1);
    if (t.endsWith('|')) t = t.slice(0, -1);
    return t.split('|').map((s) => s.trim());
}

/** 表格：第一列表頭、第二列決定對齊、其後是內容。
 *  欄數對不齊時以表頭為準——少的補空白，多的丟掉，不要讓版面歪掉。 */
function buildTable(rows) {
    const align = tableCells(rows[1]).map((spec) => {
        const l = spec.startsWith(':'), r = spec.endsWith(':');
        return l && r ? 'center' : r ? 'right' : l ? 'left' : '';
    });
    const heads = tableCells(rows[0]);
    const cols = heads.length;
    const cellStyle = (i) => (align[i] ? `text-align:${align[i]}` : null);

    const tr = el('tr');
    heads.forEach((cell, i) => tr.append(mdInline(cell, el('th', { style: cellStyle(i) }))));

    const body = el('tbody');
    for (const raw of rows.slice(2)) {
        const cells = tableCells(raw);
        const row = el('tr');
        for (let i = 0; i < cols; i++) {
            row.append(mdInline(cells[i] ?? '', el('td', { style: cellStyle(i) })));
        }
        body.append(row);
    }

    // 窄螢幕一定會爆版，包一層讓表格自己橫向捲，而不是把整頁撐寬。
    return el('div', { class: 'md-table-wrap' }, el('table', { class: 'md-table' }, [
        el('thead', {}, tr), body,
    ]));
}

/** 一段 Markdown → 一個可以直接 append 的片段 */
function renderMarkdown(source) {
    const frag = document.createDocumentFragment();
    const lines = String(source ?? '').split('\n');

    // 現在正在收集的清單（ul/ol）或引用。換一種東西就收掉。
    let list = null, listKind = '', quote = null, para = null;

    const closeAll = () => {
        if (list) { frag.append(list); list = null; listKind = ''; }
        if (quote) { frag.append(quote); quote = null; }
        if (para) { frag.append(para); para = null; }
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].replace(/\s+$/, '');

        if (!line.trim()) { closeAll(); continue; }

        // 分隔線
        if (/^-{3,}$|^\*{3,}$/.test(line.trim())) {
            closeAll();
            frag.append(el('hr', { class: 'md-hr' }));
            continue;
        }

        // 表格。要往前看一行：只有「這行以 | 開頭，而且下一行是分隔列」才算，
        // 否則一句話裡出現的 | 會被誤判成表格。
        if (line.trim().startsWith('|') && isTableDivider(lines[i + 1])) {
            closeAll();
            const rows = [];
            while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(lines[i++]);
            i--;  // for 迴圈還會 ++，退回最後一列
            frag.append(buildTable(rows));
            continue;
        }

        // 標題。頁面上已經有 h3 當卡片標題，所以備忘內文從 h4 開始往下排——
        // 用 h1 會比它所在的那張卡還大，看起來像跑版。
        const head = line.match(/^(#{1,6})\s+(.*)$/);
        if (head) {
            closeAll();
            const level = Math.min(6, head[1].length + 3);
            frag.append(mdInline(head[2], el(`h${level}`, { class: 'md-h' })));
            continue;
        }

        // 引用
        const quoted = line.match(/^>\s?(.*)$/);
        if (quoted) {
            if (list) { frag.append(list); list = null; listKind = ''; }
            if (para) { frag.append(para); para = null; }
            quote = quote || el('blockquote', { class: 'md-quote' });
            quote.append(mdInline(quoted[1], el('p')));
            continue;
        }

        // 清單／編號
        const bullet = line.match(/^\s*[-*]\s+(.*)$/);
        const number = line.match(/^\s*\d+\.\s+(.*)$/);
        if (bullet || number) {
            const kind = bullet ? 'ul' : 'ol';
            if (quote) { frag.append(quote); quote = null; }
            if (para) { frag.append(para); para = null; }
            if (list && listKind !== kind) { frag.append(list); list = null; }
            if (!list) { list = el(kind, { class: 'md-list' }); listKind = kind; }
            list.append(mdInline((bullet || number)[1], el('li')));
            continue;
        }

        // 一般段落。連續的行併成同一段，中間用換行接起來——
        // 每一行各自一段的話，行距會鬆到看起來像清單。
        closeAllExceptPara();
        if (!para) para = el('p', { class: 'md-p' });
        else para.append(el('br'));
        mdInline(line, para);

        function closeAllExceptPara() {
            if (list) { frag.append(list); list = null; listKind = ''; }
            if (quote) { frag.append(quote); quote = null; }
        }
    }

    closeAll();
    return frag;
}
