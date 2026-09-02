/* 啟動與分頁。 */

const PANELS = ['overview', 'money', 'agenda', 'memo', 'wall'];

function showPanel(name) {
    for (const p of PANELS) {
        $(`#panel-${p}`).hidden = p !== name;
    }
    for (const b of $$('#tabs button')) {
        b.setAttribute('aria-selected', String(b.dataset.panel === name));
    }
    // 網址記住現在在哪一頁，重整不會跳回總覽
    history.replaceState(null, '', `#${name}`);

    // 想法牆要等版面確定才畫得對——牆的寬度是拖曳範圍的上限，
    // 在 hidden 的時候 clientWidth 是 0。
    if (name === 'wall') Wall.render();
}

function renderAll() {
    Overview.render();
    Money.render();
    Agenda.render();
    Memo.render();
    if (!$('#panel-wall').hidden) Wall.render();
}

async function main() {
    const now = new Date();
    $('#today').textContent =
        `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日　` +
        '日一二三四五六'[now.getDay()].replace(/^/, '週');

    const mode = await Store.init();
    const badge = $('#mode');
    badge.classList.add(mode);
    if (mode === 'local') {
        badge.textContent = '本機資料';
        badge.title = `存在 ${Store.dir}`;
    } else {
        // **這個一定要講清楚。** 沒講的話，在作品集上看到的人
        // 會以為自己在看別人的私人帳目。
        badge.textContent = '展示模式・示範資料';
        badge.title = '這是一份編出來的示範資料，存在你自己的瀏覽器裡。'
                    + '怎麼改都不會影響任何人，也碰不到任何私人資料。';
    }

    try {
        await Promise.all([Money.init(), Todo.init(), Cal.init(), Memo.init(), Wall.init()]);
        await Agenda.init();
    } catch (e) {
        // 讀不出來就整頁停住，**不要顯示一個空的儀表板**——
        // 那看起來跟「你什麼都沒有」一模一樣，接著一存檔就把壞檔覆蓋掉了。
        document.querySelector('main').replaceChildren(
            el('div', { class: 'card' }, [
                el('h2', { text: '資料讀不出來' }),
                el('p', { text: e.message }),
                el('p', { class: 'sub', text: '沒有動任何檔案。修好之後重整就好。'
                                            + '備份在 ~/星歷資料/備份/。' }),
            ]));
        return;
    }

    // 靜態卡片的標題圖示。寫在 HTML 裡的是 data-icon，
    // 實際的 SVG 在這裡補上——那樣 HTML 不會被一堆 path 淹掉。
    for (const h of $$('h2[data-icon]')) {
        h.querySelector('.label')?.prepend(icon(h.dataset.icon));
    }

    $('#mode').onclick = () => DataBox.open();
    $('#import-file').onchange = e => {
        const file = e.target.files?.[0];
        e.target.value = '';          // 同一個檔連選兩次也要觸發
        if (file) DataBox.import(file);
    };

    for (const b of $$('#tabs button')) {
        b.onclick = () => showPanel(b.dataset.panel);
    }

    const start = location.hash.slice(1);
    showPanel(PANELS.includes(start) ? start : 'overview');

    renderAll();

    // 沒寫完的資料在關頁面前送出去
    addEventListener('pagehide', () => Store.flushAll());
    addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') Store.flushAll();
    });

    // Esc 在注音輸入法下比 Ctrl 好按，而且 dialog 本來就吃 Esc。
    // 這裡只多做一件事：在牆上按 Esc 取消 focus，免得繼續打字。
    addEventListener('keydown', e => {
        if (e.key === 'Escape' && document.activeElement?.tagName === 'TEXTAREA') {
            document.activeElement.blur();
        }
    });
}

main();
