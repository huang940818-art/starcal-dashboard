/* 畫面檢查：真的開一個瀏覽器，把東西一個一個點過。
 *
 *   node 檢查.mjs
 *
 * 為什麼要這支：`node --test 測試.mjs` 只驗算術，驗不到
 * 「按鈕按不按得動」「對話框關不關得掉」「卡片有沒有對齊」。
 * 那些正是真的會被踩到的東西——取消鍵按不動、預算打開是空的、
 * 頂欄塌掉，三次都是算術測試抓不到、要人去點才會發現的。
 *
 * **跑在一個臨時資料夾上**（STARCAL_DATA_DIR），不碰真的帳目。
 * 每次都從全空開始，所以「新使用者拿到的東西」也一起被驗到了——
 * 分類是空的害預算不能用，就是只在空資料下才會出現的。
 */

import { spawn, execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 8896;
// 用 fileURLToPath 不要用 .pathname——這個專案的路徑有中文，
// .pathname 會給你 percent-encode 過的字串，開檔就找不到。
const HERE = dirname(fileURLToPath(import.meta.url));

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * 開一個**真的是手機寬度**的視窗，回傳頁面的 document.title。
 *
 * 為什麼不能用 `--headless --window-size=390,844 --dump-dom`：
 * headless 的視窗寬度有下限，給 390 也會變成 500（版面拿到 485，
 * 扣掉捲軸）。那比她的手機寬了快一百像素——**課表在 485 排得下、
 * 在 390 排不下**，而檢查會全部通過。這一整輪的意義就是量她真正
 * 看到的那個寬度，所以走 CDP 的裝置模擬。
 */
async function phoneTitle(url, width = 390, height = 844) {
    const port = 9310 + Math.floor(Math.random() * 300);
    const profile = mkdtempSync(join(tmpdir(), 'starcal-phone-'));
    const chrome = spawn(CHROME, [
        '--headless=new', '--disable-gpu', '--no-first-run',
        '--remote-debugging-port=' + port, '--user-data-dir=' + profile,
        'about:blank',
    ], { stdio: 'ignore' });

    try {
        let wsUrl = null;
        for (let i = 0; i < 60 && !wsUrl; i++) {
            try {
                const r = await fetch('http://127.0.0.1:' + port + '/json/version');
                wsUrl = (await r.json()).webSocketDebuggerUrl;
            } catch { await sleep(200); }
        }
        if (!wsUrl) throw new Error('連不上 Chrome 的除錯埠');

        const sock = new WebSocket(wsUrl);
        await new Promise((ok, no) => { sock.onopen = ok; sock.onerror = no; });

        let id = 0;
        const waiting = new Map();
        sock.onmessage = e => {
            const m = JSON.parse(e.data);
            const w = m.id && waiting.get(m.id);
            if (!w) return;
            waiting.delete(m.id);
            m.error ? w.no(new Error(JSON.stringify(m.error))) : w.ok(m.result);
        };
        const send = (method, params = {}, sessionId) => new Promise((ok, no) => {
            const n = ++id;
            waiting.set(n, { ok, no });
            sock.send(JSON.stringify({ id: n, method, params, sessionId }));
        });

        const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
        const { sessionId } = await send('Target.attachToTarget',
                                         { targetId, flatten: true });
        const call = (m, p) => send(m, p, sessionId);

        await call('Page.enable');
        await call('Runtime.enable');
        await call('Emulation.setDeviceMetricsOverride', {
            width, height, deviceScaleFactor: 1, mobile: true,
        });
        await call('Page.navigate', { url });

        // 頁面自己會把結果寫進 title。**等的是最後那個 DONE 印記**，
        // 不是「有沒有 ✓」——探針現在一邊跑一邊寫 title，看到第一條
        // 就回去的話，會拿著一條結果當成整輪都跑完了。
        // 這一輪是**真的在跑**（沒有虛擬時間可以快轉），所以等的秒數
        // 要照真實時間抓。90 次 × 400ms＝36 秒，實測剛好卡在最後一條，
        // 每次都少帶回一條——等得不夠的症狀跟「那條檢查壞了」一模一樣。
        let last = '';
        for (let i = 0; i < 250; i++) {
            await sleep(400);
            const r = await call('Runtime.evaluate', {
                expression: 'document.title', returnByValue: true,
            });
            const t = r.result && r.result.value;
            if (t) last = t;
            if (t && t.startsWith('DONE ||| ')) return t.slice(9);
        }
        // 等不到印記就把半路的帶回去，並且講出來——靜靜地少一輪，
        // 看起來會像那一輪的檢查全部消失了。
        if (last.includes('✓') || last.includes('✗')) {
            console.error('⚠️ 手機那輪沒跑完，只帶回 '
                + last.split(' ||| ').length + ' 條');
            return last;
        }
        return '';
    } finally {
        chrome.kill();
        // Chrome 收工前還在寫東西，馬上刪會 ENOTEMPTY。等它一下，
        // 刪不掉也不要讓整支檢查因為清垃圾而失敗。
        await sleep(400);
        try { rmSync(profile, { recursive: true, force: true, maxRetries: 5 }); } catch {}
    }
}

/** 塞進頁面裡跑的檢查。每一條回一行文字，開頭是 ✓ 或 ✗。
 *
 * ⚠️ **這是一個樣板字串，裡面的反斜線會先被 JS 解析掉一次。**
 * 想在頁面裡寫 `join('\n')` 的話，這裡要打 `join('\\n')`——
 * 只打一個的話，注入進去的會是一個真的換行，字串沒收尾，
 * **整段 script 靜靜地不跑**（症狀跟下面 $$ 那條一模一樣：
 * 通過數突然變成個位數，而 title 停在原本的值）。
 * 2026-09-06 踩過一次，查了很久，因為 node --check 檢查原始碼是會過的。
 */
const PROBE = `
<script>
/* **檢查不上網。**
 *
 * 天氣那塊開機會打兩支 API（時區猜地點的地理編碼、Open-Meteo 的預報）。
 * 在 --virtual-time-budget 底下，還沒回來的網路請求會把虛擬時間停住，
 * 整輪檢查就跟著卡在那裡；而且沒有網路的時候這支也該跑得完。
 * 天氣本來就沒有任何一條檢查，直接把開機那一下停掉。
 *
 * 這一段的位置是關鍵：app.js 的 main() 一開始就 await Store.init()，
 * 讓出去之後解析器才會跑到這裡，所以來得及蓋掉。 */
if (typeof Weather !== 'undefined') Weather.init = async () => {};

const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = [];
// **每push一條就把 title 更新一次。** 結果是靠 title 帶回去的，
// 中途卡住（虛擬時間用完、某個 await 永遠不回來）的話，原本會拿到
// 一個「檢查啟動了但沒跑完」，完全看不出停在哪。邊跑邊寫的話，
// 卡住的時候至少看得到最後跑完的是哪一條。
const ok = (n, c, e = '') => {
  out.push((c ? '✓ ' : '✗ ') + n + (e ? '  (' + e + ')' : ''));
  document.title = out.join(' ||| ');
};
const q = s => document.querySelector(s);
const tab = n => { q('#tabs button[data-panel="' + n + '"]').click(); return sleep(220); };

/* 等不到就丟例外的保險絲。
 *
 * **虛擬時間只保證計時器會被排到。** 讀檔（FileReader／file.text()）
 * 那種不是計時器的工作，在 --virtual-time-budget 底下有時候永遠等不到，
 * 整支檢查就停在那個 await 上——而且是靜靜地停，看起來像
 * 「桌機那輪只跑到一半」。包一層之後至少會留下一條紅的。 */
const guard = (p, what, ms = 5000) => Promise.race([
  p, sleep(ms).then(() => { throw new Error(what + '：等了 ' + ms + 'ms 還沒回來'); }),
]);

// 不要掛 load 事件——headless 的 virtual time 模式下它不一定會觸發，
// 結果就是整段檢查靜靜地沒跑，而 title 停在原本的值。直接自己跑。
(async () => {
  document.title = '檢查啟動了但沒跑完';
  await sleep(1200);

  // ── 手機那一輪 ──────────────────────────────────
  // **窄視窗要單獨跑一次。** 桌機視窗下每一條版面檢查都會是綠的，
  // 卻什麼都沒驗到——手機才是會踩到問題的地方（想法牆卡住那次就是）。
  // headless 的 viewport 不等於 --window-size 給的數字（實測 390 進來是 485），
  // 所以門檻抓寬一點。桌機那輪是 1512，離這個數字很遠，不會誤判。
  if (innerWidth < 700) {
    try {
      const wide = () => document.documentElement.scrollWidth > innerWidth + 1;
      for (const p of ['overview', 'money', 'agenda', 'memo']) {
        await tab(p);
        await sleep(260);
        ok('手機上「' + p + '」不會左右捲', !wide(),
           document.documentElement.scrollWidth + ' > ' + innerWidth);
      }

      // **每一顆按鈕都要在畫面裡。**
      //
      // 她的截圖上「加待辦」只剩半顆——那群按鈕包在一個 span 裡，
      // 外層的 flex-wrap 只會讓標題和整群分兩行，群裡面照樣擠成一條，
      // 超出去的被切在畫面外，整頁還跟著能左右捲。
      for (const p of ['overview', 'money', 'agenda', 'memo']) {
        await tab(p);
        await sleep(280);
        const cut = [...document.querySelectorAll('#panel-' + p + ' .card h2 button')]
            .filter(b => b.getBoundingClientRect().right > innerWidth + 1);
        ok('手機上「' + p + '」的按鈕都在畫面裡', cut.length === 0,
           cut.map(b => b.textContent).join('、'));
      }

      // 手指比游標粗。並排的小按鈕摸不準的話等於沒有。
      await tab('agenda'); await sleep(260);
      {
        // 只看現在顯示的那一頁——隱藏分頁裡的元素量出來是 0，
        // 會變成一整排假的失敗
        // 收起來的按鈕量出來是 0 高，會變成一整排假的失敗
        const small = [...document.querySelectorAll('#panel-agenda .card h2 .btn.small')]
            .filter(b => !b.hidden && b.getBoundingClientRect().height > 0);
        ok('抓得到按鈕來量', small.length > 0, small.length + ' 顆');
        const tooSmall = small.filter(b => b.getBoundingClientRect().height < 30);
        ok('手機上的小按鈕夠大按', tooSmall.length === 0,
           tooSmall.map(b => b.textContent + '=' + Math.round(b.getBoundingClientRect().height))
             .join('、'));
      }

      // 管理分類的每一列要在同一行。
      //
      // 一度被我改壞：為了修表單欄位重疊，加了「對話框裡的 .row 一律直排」，
      // 結果把這裡每一列（名稱＋固定／彈性＋刪）也拆成三行——
      // 一個分類佔三行，十三個分類就是三十九行，完全讀不了。
      await tab('money'); await sleep(260);
      q('#manage-categories').click(); await sleep(300);
      {
        const rows = [...document.querySelectorAll('#category-editor .cat-edit-row')];
        ok('管理分類列得出分類', rows.length > 0, rows.length + ' 列');
        const broken = rows.filter(r => {
          const kids = [...r.children];
          if (kids.length < 2) return false;
          // **比垂直中心，不是 top。** align-items: center 之下，
          // 比較矮的元素 top 本來就不一樣——比 top 會一直誤報。
          const mids = kids.map(k => {
            const b = k.getBoundingClientRect();
            return Math.round(b.top + b.height / 2);
          });
          return Math.max(...mids) - Math.min(...mids) > 4;
        });
        ok('每一列的名稱、固定彈性、刪都在同一行', broken.length === 0,
           broken.length + ' 列被拆開了');
        ok('名稱欄吃得到寬度',
           rows[0].querySelector('input').getBoundingClientRect().width > 100,
           Math.round(rows[0].querySelector('input').getBoundingClientRect().width) + 'px');
      }
      q('#dlg-categories button[value=\"cancel\"]').click(); await sleep(200);

      // 想法牆在窄螢幕上整個收起來。便利貼的價值是空間關係，
      // 一面只有一張半便利貼寬的牆擺不出那個——那不是「做得爛一點」，
      // 是不該出現在這個尺寸上。
      ok('手機上收起想法牆分頁',
         q('#tabs button[data-panel="wall"]').hidden);
      location.hash = '#wall';
      showPanel('wall'); await sleep(280);
      ok('用網址也進不去想法牆', $('#panel-wall').hidden);
      ok('進不去的時候會回總覽', !$('#panel-overview').hidden);
      ok('總覽也不留一格點不進去的想法牆',
         ![...document.querySelectorAll('#hero .stat')]
            .some(x => x.textContent.includes('想法牆')));

      // 課表在手機上要看得到。**節次網格不收**——它只有五欄，
      // 而且那正是課表該有的樣子；只有時間軸那種才收起來換清單。
      await tab('agenda'); await sleep(200);
      // 一定要在節次制那份上測。上一輪留下來的 active 剛好是時間制的話，
      // 底下那幾條會全部被跳過——**跳過的檢查看起來跟通過一模一樣**。
      // 桌機那輪最後跑的是匯入測試，存進檔案的是一份時間制的課表，
      // 所以這裡自己建一份節次制的。只改記憶體，不存檔。
      const ps = Timetable.periods();
      Timetable.data.sets.push({
        id: 'm-test', name: '手機測試用', mode: 'period',
        slots: [
          { id: 'm1', name: '測試課一', day: 1, from: ps[10].id, to: ps[11].id,
            teacher: '某老師', place: '某教室', label: null },
          { id: 'm2', name: '測試課二', day: 5, from: ps[10].id, to: ps[10].id,
            teacher: '', place: '', label: null },
        ],
      });
      Timetable.data.active = 'm-test';
      Agenda.view = 'class'; Agenda.render(); await sleep(320);
      const wrap = q('.tt-wrap');
      const isPeriod = !!q('.tt-p');
      ok('手機那輪測得到節次課表', isPeriod,
         isPeriod ? '' : '畫出來的不是節次網格');
      ok('手機上節次課表的網格留著',
         !isPeriod || getComputedStyle(wrap).display !== 'none',
         isPeriod ? getComputedStyle(wrap).display : '這份是時間制');
      ok('手機上課表格子點得到',
         !isPeriod || document.querySelectorAll('.tt-p-empty, .tt-p-slot').length > 0);
      ok('手機上課表不會把頁面撐寬', !wide(),
         document.documentElement.scrollWidth + ' > ' + innerWidth);
      // 五天要一屏放完。**網格自己橫捲也不行**——她的課有星期五，
      // 被推到看不見的地方等於那天不存在。
      if (isPeriod) {
        const g = q('.tt-p');
        ok('手機上五天一屏放得完，網格不用橫捲',
           g.scrollWidth <= g.clientWidth + 1,
           g.scrollWidth + ' vs ' + g.clientWidth);
        ok('手機上星期表頭用單字',
           getComputedStyle(q('.tt-p-wd .wd-short')).display !== 'none');

        /* 節次制的時候底下那份清單要是收起來的。
         *
         * 攤開的話手機上同一週的課從頭到尾講兩遍——先一張網格，
         * 再往下捲過五個星期的清單。**那不是壞掉，只是很長**，
         * 所以沒有人會回報，只會覺得「課表在手機上很難看」。 */
        const list = q('.tt-list');
        ok('節次制時清單是收起來的', !!list && !list.open);
        ok('收起來的那顆按鈕看得到誰在裡面',
           !!list && list.querySelector('.tt-more').textContent.includes('老師'),
           list ? list.querySelector('.tt-more').textContent : '沒有清單');
        // 收起來不等於拿不到。按一下要打得開。
        if (list) {
          list.querySelector('.tt-more').click(); await sleep(160);
          ok('按了打得開', list.open);
          ok('打開後看得到老師和教室',
             list.textContent.includes('某老師') && list.textContent.includes('某教室'));
          list.querySelector('.tt-more').click(); await sleep(120);
        }

        // 時間制那份反過來：網格在手機上是藏起來的，清單就是唯一的
        // 入口，收起來等於整份課表不見。
        Timetable.data.sets.push({
          id: 'm-time', name: '手機時間制', mode: 'time',
          slots: [{ id: 'mt1', name: '打工', day: 2, start: '18:00', end: '22:00',
                    teacher: '', place: '店裡', label: null }],
        });
        Timetable.data.active = 'm-time';
        Agenda.render(); await sleep(300);
        const tl = q('.tt-list');
        ok('時間制的清單是攤開的', !!tl && tl.open);
        ok('時間制看得到課', !!tl && tl.textContent.includes('打工'));
        Timetable.data.active = 'm-test';
        Agenda.render(); await sleep(260);
      }

      Agenda.view = 'month'; Agenda.render(); await sleep(300);
      ok('手機上月曆格子不會被撐爆', !wide(),
         document.documentElement.scrollWidth + ' > ' + innerWidth);
      ok('手機上月曆用色點代替標題',
         getComputedStyle(q('#calendar .cal-dots')).display === 'flex');
    } catch (e) {
      out.push('✗ 手機那輪爆了: ' + e.message);
    }
    // 手機這一輪自己就結束了，印記要蓋在這裡——蓋在最底下那一份
    // 是給桌機那輪用的，這裡永遠跑不到。
    document.title = 'DONE ||| ' + out.join(' ||| ');
    return;
  }

  try {
    ok('連得到本機資料', Store.mode === 'local', Store.mode);
    ok('沒有出現「資料讀不出來」', !document.querySelector('main').textContent.includes('資料讀不出來'));
    ok('五個分頁都在',
       ['overview','money','agenda','memo','wall'].every(p => q('#panel-' + p)));
    ok('全新資料有預設分類', Money.data.categories.expense.length > 0,
       Money.data.categories.expense.length + ' 類');

    // ── 每個對話框都要開得起來、也關得掉 ──
    await tab('money');
    const dialogs = [
      ['記一筆', '#add-txn', '#dlg-txn'],
      ['加帳戶', '#add-account', '#dlg-account'],
      ['加訂閱', '#add-sub', '#dlg-sub'],
      ['預算設定', '#edit-budgets', '#dlg-budget'],
      ['管理分類', '#manage-categories', '#dlg-categories'],
    ];
    for (const [name, opener, dlg] of dialogs) {
      const d = q(dlg);
      q(opener).click(); await sleep(140);
      const opened = d.open;
      if (opened) { d.querySelector('button[value="cancel"]').click(); await sleep(150); }
      const good = opened && !d.open;
      // 說明只在失敗時給。成功的旁邊掛一句「取消關不掉」會讓人以為有問題。
      ok(name + ' 開得起來也取消得掉', good,
         good ? '' : (!opened ? '開不起來' : '取消關不掉'));
      if (d.open) d.close();
      await sleep(60);
    }

    await tab('agenda');
    for (const [name, opener, dlg] of [['加行程','#add-event','#dlg-event'],
                                       ['加待辦','#add-todo','#dlg-todo']]) {
      const d = q(dlg);
      q(opener).click(); await sleep(140);
      const opened = d.open;
      if (opened) { d.querySelector('button[value="cancel"]').click(); await sleep(150); }
      ok(name + ' 開得起來也取消得掉', opened && !d.open);
      if (d.open) d.close();
      await sleep(60);
    }

    await tab('memo');
    {
      const d = q('#dlg-memo');
      q('#add-memo').click(); await sleep(140);
      const opened = d.open;
      if (opened) { d.querySelector('button[value="cancel"]').click(); await sleep(150); }
      ok('新增備忘 開得起來也取消得掉', opened && !d.open);
      if (d.open) d.close();
    }

    // ── 備忘：點一下是「攤開來看」，不是「進去編輯」 ──
    //
    // 她說「要點開來看很麻煩，版面也不好看」。原本點一下開的是編輯框，
    // 於是只想讀的時候會看到一堆 ** 和 >，而那些備忘有 45–63 行。
    {
      // 這支檢查不准出現字面的反引號（PROBE 是樣板字串），所以行內程式碼
      // 的那兩個字元要用組的。
      const BT = String.fromCharCode(96);
      Memo.data.items.push({
        id: 'md-check', pinned: false,
        createdAt: Date.now(), updatedAt: Date.now(),
        text: [
          '渲染檢查用',
          '',
          '## 小標',
          '這句有 **粗體** 和 ' + BT + '程式碼' + BT + '，還有 [連結](https://example.com)。',
          '',
          '- 第一條',
          '- 第二條',
          '',
          '1. 編號一',
          '',
          '> 引用的一句',
          '',
          '---',
          '裸網址 https://example.com/x',
        ].join('\\n'),
      });
      Memo.render(); await sleep(220);

      const head = [...document.querySelectorAll('.memo-item .memo-row')]
        .find(r => r.textContent.includes('渲染檢查用'));
      ok('備忘列出得來', !!head);
      ok('一開始是收著的', head.getAttribute('aria-expanded') === 'false');
      ok('收著的時候看不到內文', !q('.memo-item.open'));

      // **每次 render() 都會重建整個清單**，所以點完之後手上那個節點
      // 已經不在 DOM 裡了（closest 還查得到舊的父層，但那個父層沒有內文）。
      // 每一步都要重新問一次現在的畫面。
      const findItem = () => [...document.querySelectorAll('.memo-item')]
          .find(x => x.textContent.includes('渲染檢查用'));

      head.click(); await sleep(250);
      const item = findItem();
      const body = item && item.querySelector('.memo-body');
      ok('點一下就攤開', !!body && item.classList.contains('open'));
      ok('攤開的不是編輯框', !q('#dlg-memo').open, '點開不該跳對話框');

      // 真的渲染成標籤，不是把原始碼印出來
      ok('粗體變成 strong', !!body.querySelector('strong'));
      ok('小標變成標題', !!body.querySelector('.md-h'));
      ok('清單變成 li', body.querySelectorAll('.md-list li').length >= 3);
      ok('引用變成 blockquote', !!body.querySelector('.md-quote'));
      ok('分隔線畫出來', !!body.querySelector('.md-hr'));
      ok('行內程式碼有底', !!body.querySelector('code'));
      const links = [...body.querySelectorAll('a')];
      ok('連結點得出去', links.length === 2, links.length + ' 個');
      ok('連結是外開的', links.every(a => a.target === '_blank'
                                       && a.rel.includes('noopener')));
      ok('星號沒有漏在畫面上', !body.textContent.includes('**'));
      ok('井字號沒有漏在畫面上', !body.textContent.includes('## '));
      // 第一行是標題列的內容，攤開時不該再出現一次
      ok('標題沒有重複兩次',
         (body.textContent.match(/渲染檢查用/g) || []).length === 0,
         '內文裡不該再有標題');

      // 第一行寫成「# 標題」時，標題列不該印出井字號
      Memo.data.items.push({
        id: 'md-hash', pinned: false, createdAt: Date.now(), updatedAt: Date.now(),
        text: '# 井字標題\\n內文一行',
      });
      Memo.render(); await sleep(200);
      const hashRow = [...document.querySelectorAll('.memo-item .memo-title')]
        .find(x => x.textContent.includes('井字標題'));
      ok('標題列不印 Markdown 記號',
         !!hashRow && !hashRow.textContent.includes('#'),
         hashRow ? hashRow.textContent : '找不到');
      Memo.data.items = Memo.data.items.filter(x => x.id !== 'md-hash');
      Memo.render(); await sleep(150);

      // 展開之後還是改得到
      findItem().querySelector('.memo-actions .btn').click(); await sleep(220);
      ok('攤開後按編輯還是進得去', q('#dlg-memo').open);
      q('#dlg-memo button[value="cancel"]').click(); await sleep(180);
      if (q('#dlg-memo').open) q('#dlg-memo').close();

      // 收得回去
      findItem().querySelector('.memo-row').click(); await sleep(220);
      ok('再點一下收得回去', !findItem().querySelector('.memo-body'));

      // 收拾乾淨
      Memo.data.items = Memo.data.items.filter(x => x.id !== 'md-check');
      Memo.open.clear();
      Memo.save(); Memo.render(); await sleep(150);
    }

    // ── 預算：對話框要有欄位，而且存得進去 ──
    await tab('money');
    q('#edit-budgets').click(); await sleep(180);
    const fields = document.querySelectorAll('#budget-fields input');
    ok('預算對話框有欄位', fields.length > 0, fields.length + ' 個');
    if (fields.length) {
      fields[0].value = '3000';
      q('#b-save').click(); await sleep(280);
      ok('預算存得進去', Money.data.budgets.length === 1);
      ok('預算卡看得到數字', q('#budgets').textContent.includes('3,000'));

      // 某個月另外設，不能把平常那份洗掉
      q('#edit-budgets').click(); await sleep(180);
      // #budget-scope 現在有兩排切換（每個月／每天，再來才是平常／單月），
      // 所以要挑文字，不能數個數
      const scopeBtns = [...document.querySelectorAll('#budget-scope .view-btn')]
        .filter(b => b.textContent === '平常' || b.textContent.startsWith('只有'));
      ok('預算對話框有平常/單月兩個切換', scopeBtns.length === 2, scopeBtns.length + ' 個');
      if (scopeBtns.length === 2) {
        scopeBtns[1].click(); await sleep(120);
        const only = document.querySelectorAll('#budget-fields input');
        ok('切到單月後平常那份寫在提示裡',
           (only[0].placeholder || '').includes('3,000'), only[0].placeholder);
        only[0].value = '5000';
        q('#b-save').click(); await sleep(280);

        const base = Money.data.budgets.filter(b => !b.month);
        const own = Money.data.budgets.filter(b => b.month);
        ok('平常那份還在', base.length === 1 && base[0].limit === 3000,
           JSON.stringify(base));
        ok('單月那份存下來了', own.length === 1 && own[0].limit === 5000,
           JSON.stringify(own));
        ok('預算卡改用這個月的數字', q('#budgets').textContent.includes('5,000'));
        ok('預算卡有講這個月另外設過',
           q('#budgets').textContent.includes('自己的一套'));
      }
    }

    // ── 總預算、遮金額、今天的收支 ──
    //
    // **這三段會把記帳的資料整個換掉，做完要換回來。**
    // 後面還有一長串檢查接著前面建好的帳戶和帳目跑，
    // 忘了還原的話那些會整批倒掉，而且看起來像是它們自己壞了。
    const keepMoney = JSON.stringify(Money.data);

    // 總預算算錯了不會報錯，只會給一個看起來很合理的數字，
    // 照著花到月底才發現早就爆了。所以除了「有沒有出現」，
    // 底下也真的把數字對過一次。
    {
      // 前面那一段留了一份「只有這個月」的預算，會蓋掉平常那份，
      // 收乾淨再測，不然數字對不回來。
      Money.data.budgets = [];
      Money.data.totalBudgets = [];
      Money.data.transactions = [];
      Money.save(); Money.render(); await sleep(150);

      q('#edit-budgets').click(); await sleep(200);
      const total = q('#b-total');
      ok('預算對話框有「總共可以花」那一格', !!total);
      if (total) {
        // 總預算那格如果落在 #budget-fields 裡，存檔時會被當成一個
        // 名字是 undefined 的分類掃進去
        ok('總預算那格不會被當成分類', !total.dataset.cat && !q('#budget-fields #b-total'));

        total.value = '30000';
        total.dispatchEvent(new Event('input'));
        await sleep(120);
        const days = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
        const perDay = Math.round(30000 / days).toLocaleString('zh-TW');
        // **一邊打就要看得到每天可以用多少。** 存完再跳回去看
        // 等於要她自己心算一次。
        ok('打的時候就算出每天可以用多少',
           q('.pace-hint').textContent.includes(perDay),
           q('.pace-hint').textContent);

        q('#b-save').click(); await sleep(300);
        ok('總預算存得進去', Money.totalBudgetFor(Money.range.start.slice(0, 7)) === 30000,
           JSON.stringify(Money.data.totalBudgets));
        ok('總預算沒有混進分類預算裡',
           Money.data.budgets.every(b => b.category), JSON.stringify(Money.data.budgets));

        const card = q('#budgets').textContent;
        ok('預算卡看得到總預算', card.includes('30,000'));
        ok('預算卡講得出今天可以用多少', card.includes('今天可以用'), card.slice(0, 60));
        // **卡片上那個數字不是 perDay。** 對話框裡寫的是「整個月平分」
        // （設定的時候還不知道會花多少），卡片上寫的是「剩下的錢 ÷
        // 含今天在內的剩餘天數」。兩個混在一起就會給錯的額度。
        const daysLeft = days - new Date().getDate() + 1;
        const perDayLeft = Math.round(30000 / daysLeft).toLocaleString('zh-TW');
        ok('每天可以用的數字算對了', q('.pace-num').textContent === perDayLeft,
           q('.pace-num').textContent + ' 應該是 ' + perDayLeft
           + '（剩 ' + daysLeft + ' 天，不是整個月 ' + days + ' 天）');

        // 今天花掉的要從「今天的額度」裡扣，而且扣出來的數字要寫在畫面上。
        // **額度本身不該跟著掉**——那是今天一開始就定好的，
        // 跟著掉的話今天花的錢會被攤平到剩下的每一天，等於沒有回饋。
        const quota = Number(q('.pace-num').textContent.split(',').join(''));
        Money.data.transactions.push({
          id: 'ck-pace', date: new Date().toISOString().slice(0, 10),
          kind: 'expense', amount: 200, category: Money.data.categories.expense[0].name,
          account: Money.data.accounts[0]?.name || '',
        });
        Money.save(); Money.render(); await sleep(200);
        const quota2 = Number(q('.pace-num').textContent.split(',').join(''));
        ok('今天的額度不會被今天花的錢攤平', quota2 === quota, quota + ' → ' + quota2);
        ok('今天花了多少、還剩多少寫在旁邊',
           q('#budgets').textContent.includes('今天花了 200'),
           q('#budgets').textContent.slice(0, 90));

        /* 分類條**只講這個月**。
         *
         * 這裡本來每一列右邊還接一段「今天可以用 169」。她的原話：
         * 「不能只顯示當月就好了 當日放總覽」——一列同時擺兩種期間的
         * 數字，六列疊起來就是一面數字牆，而且「還有 345」和
         * 「今天超出 134」一綠一紅並排，看起來像自己跟自己打架。
         *
         * 當日的分類額度在總覽那張卡上（底下「今天的額度」那一段有驗）。
         * 這條是**反向**的：確認它沒有偷偷長回來。 */
        const cat = Money.data.categories.expense[0].name;

        Money.data.budgets = [{ category: cat, limit: 30000 }];
        Money.save(); Money.render(); await sleep(220);
        const foot = q('.budget-foot');
        ok('分類條底下只有這個月，沒有當日的數字',
           !!foot && !foot.textContent.includes('今天'),
           foot ? foot.textContent : '沒有那一行');
        ok('分類條底下寫的是 花了 / 上限',
           !!foot && foot.textContent.includes(' / 30,000'),
           foot ? foot.textContent : '');

        // 真的超過月上限（花了 200、上限 100），不是「今天的份超了」
        Money.data.budgets = [{ category: cat, limit: 100 }];
        Money.save(); Money.render(); await sleep(220);
        ok('這一類超出上限的時候，寫的還是這個月的超支不是今天的',
           q('#budgets').textContent.includes('超支')
           && !q('.budget-foot').textContent.includes('今天'),
           q('.budget-foot') ? q('.budget-foot').textContent : '');

        // 超支：不要印一個「每天可以用 0」，那看起來像算壞了
        Money.data.transactions.push({
          id: 'ck-over', date: new Date().toISOString().slice(0, 10),
          kind: 'expense', amount: 30000, category: Money.data.categories.expense[0].name,
          account: Money.data.accounts[0]?.name || '',
        });
        Money.save(); Money.render(); Overview.render(); await sleep(220);
        ok('超支的時候講一句話不是印 0',
           q('#budgets').textContent.includes('額度用完了')
           && !q('.pace-num'), q('#budgets').textContent.slice(0, 60));
        Money.data.budgets = [];
        ok('超支會寫在總覽最上面那句',
           q('#hero').textContent.includes('這個月超出預算'),
           q('#hero').textContent.slice(0, 50));

        Money.data.transactions = [];
        Money.data.totalBudgets = [];
        Money.save(); Money.render(); Overview.render(); await sleep(150);
      }
    }

    // ── 自己定的每日預算 ──
    //
    // 她的原話：「今日預算沒有補上，你給的是這個月的，我希望可以放在
    // 今日收支，比如支出食物 155/300 這種的，還要可以自訂」。
    {
      await tab('money');
      const keep = JSON.stringify(Money.data);
      const keepOff = Prefs.data.overviewOff;
      // 「今天的預算」合併之後不預設出現（每天可以用多少已經用小字
      // 貼在「今天的收支」上了）。這一段要驗的正是那張卡，所以先打開。
      Prefs.data.overviewOff = [];
      const cat = Money.data.categories.expense[0].name;
      const today = new Date().toISOString().slice(0, 10);

      Money.data.accounts = [{ id: 'db1', name: '甲', kind: 'cash', opening: 9999,
                               includeInTotal: true, order: 0 }];
      Money.data.transactions = [
        { id: 'db-t1', date: today, kind: 'expense', amount: 155, category: cat,
          account: '甲', note: '午餐' },
      ];
      Money.data.budgets = [];
      Money.data.totalBudgets = [];
      Money.data.dailyBudgets = [];
      Money.data.dailyTotal = null;
      Money.save(); Money.render(); await sleep(200);

      // 對話框要有「每個月／每天」兩頁
      q('#edit-budgets').click(); await sleep(220);
      const units = [...document.querySelectorAll('#budget-scope .view-btn')];
      const dayBtn = units.find(b => b.textContent === '每天');
      ok('預算設定有「每天」那一頁', !!dayBtn, units.map(b => b.textContent).join('/'));

      if (dayBtn) {
        dayBtn.click(); await sleep(200);
        ok('每天那頁有「一天總共可以花」', !!q('#b-daily-total'));
        const catInputs = document.querySelectorAll('#budget-fields input[data-daily-cat]');
        ok('每天那頁列得出分類', catInputs.length > 0, catInputs.length + ' 個');

        // 切到每天之後，月的那組欄位不該還留著——兩組數字混在一頁，
        // 隔一天就分不出哪個是月哪個是日
        ok('切到每天就看不到月的欄位',
           document.querySelectorAll('#budget-fields input[data-cat]').length === 0);

        q('#b-daily-total').value = '700';
        catInputs[0].value = '300';
        q('#b-save').click(); await sleep(320);

        ok('每天的預算存得進去',
           Money.dailyTotalLimit() === 700 && Money.dailyLimitFor(cat) === 300,
           JSON.stringify([Money.data.dailyTotal, Money.data.dailyBudgets]));

        // **重點：她要的格式是「155 / 300」，而且要在「今天的收支」上**
        await tab('overview'); await sleep(280);
        const todayCard = [...document.querySelectorAll('#overview-grid .card')]
          .find(c => c.textContent.includes('今天的收支'));
        ok('「今天的收支」上看得到 花了/額度', !!todayCard
           && todayCard.textContent.includes('155 / 300'),
           todayCard ? todayCard.textContent.slice(0, 90) : '沒有那張卡');
        ok('今天總共也是同一個格式',
           !!todayCard && todayCard.textContent.includes('155 / 700'),
           todayCard ? todayCard.textContent.slice(0, 90) : '');

        // 沒自己定的分類要標「照月預算」，不能跟她定的長得一樣
        Money.data.budgets = [{ category: Money.data.categories.expense[1].name, limit: 3000 }];
        Money.save(); Overview.render(); await sleep(280);

        // 今天沒花的那幾類不該出現在「今天的收支」上（她的原話：
        // 「今天沒有花的不要放」）——那些行每天都在而且每天都一樣，
        // 真正變動的那一行反而被淹掉。
        const card2 = [...document.querySelectorAll('#overview-grid .card')]
          .find(c => c.textContent.includes('今天的收支'));
        ok('今天沒花的分類不列在「今天的收支」上',
           !!card2 && !card2.textContent.includes('0 / '),
           card2 ? card2.textContent.slice(0, 120) : '');

        // 全部的額度看「今天的預算」那張，那張整張都在講額度
        const budgetCard = [...document.querySelectorAll('#overview-grid .card')]
          .find(c => c.textContent.includes('今天的預算'));
        ok('沒自己定的那幾類標成「照月預算」',
           !!budgetCard && budgetCard.textContent.includes('照月預算'),
           budgetCard ? budgetCard.textContent.slice(0, 110) : '');
        ok('今天還沒花的額度在「今天的預算」上看得到',
           !!budgetCard && budgetCard.textContent.includes('0 / '),
           budgetCard ? budgetCard.textContent.slice(0, 110) : '');

        // 「0 / 0」是壞掉的長相。那發生在這一類這個月已經超支、
        // 今天推算不出額度的時候——那是一句話不是一個分數。
        const other = Money.data.categories.expense[1].name;
        // **那筆要記在今天以前。** 記在今天的話它算「今天花的」，
        // 而今天的額度是拿「今天以前」算的——額度不會歸零，
        // 造不出要驗的情況。第一次寫這條就是這樣自己騙自己的。
        const first = today.slice(0, 8) + '01';
        if (first !== today) {
          Money.data.transactions.push({ id: 'db-over', date: first, kind: 'expense',
            amount: 99999, category: other, account: '甲' });
          Money.save(); Overview.render(); await sleep(280);
          const card2b = [...document.querySelectorAll('#overview-grid .card')]
            .find(c => c.textContent.includes('今天的預算'));
          ok('月預算爆掉的那一類不會印 0 / 0',
             !!card2b && !card2b.textContent.includes('0 / 0')
             && card2b.textContent.includes('額度用完了'),
             card2b ? card2b.textContent.slice(0, 120) : '');
          Money.data.transactions = Money.data.transactions.filter(t => t.id !== 'db-over');
          Money.save(); Overview.render(); await sleep(220);
        } else {
          ok('月預算爆掉那條今天驗不到（今天是 1 號，沒有「今天以前」）', true);
        }

        // 花超過自己定的額度要變紅
        Money.data.transactions.push({ id: 'db-t2', date: today, kind: 'expense',
          amount: 400, category: cat, account: '甲' });
        Money.save(); Overview.render(); await sleep(280);
        const q3 = Money.todayQuota(cat);
        ok('花超過自己定的額度，剩下的是負的', q3.left === 300 - 555, String(q3.left));
        const card3 = [...document.querySelectorAll('#overview-grid .card')]
          .find(c => c.textContent.includes('今天的收支'));
        ok('超出的那一列是紅的',
           !!card3 && !!card3.querySelector('.quota-row .negative'),
           card3 ? card3.textContent.slice(0, 90) : '');
      }

      if (q('#dlg-budget').open) q('#dlg-budget').close();
      Money.data = JSON.parse(keep);
      Prefs.data.overviewOff = keepOff;
      Money.save(); Money.render(); Overview.render(); await sleep(200);
    }

    // ── 總覽上的「今天的預算」──
    //
    // 記帳那頁的預算卡回答「這個月」，站在超商前面要的是「今天還能花多少」。
    {
      await tab('money');
      const keep = JSON.stringify(Money.data);
      const keepOff = Prefs.data.overviewOff;
      Prefs.data.overviewOff = [];      // 同上：這一段驗的是那張卡本身
      const cat = Money.data.categories.expense[0].name;
      const today = new Date().toISOString().slice(0, 10);

      Money.data.accounts = [{ id: 'tb1', name: '甲', kind: 'cash', opening: 9999,
                               includeInTotal: true, order: 0 }];
      Money.data.transactions = [];
      Money.data.totalBudgets = [];
      Money.data.budgets = [];
      Money.save(); Overview.render(); await tab('overview'); await sleep(220);

      const card = () => [...document.querySelectorAll('#overview-grid .card')]
        .find(c => c.textContent.includes('今天的預算'));
      ok('總覽上有「今天的預算」', !!card());
      ok('沒設預算的時候是空狀態，而且給得出入口',
         !!card() && card().textContent.includes('還沒設預算')
         && !!card().querySelector('button'),
         card() ? card().textContent.slice(0, 40) : '');

      // 設一個總預算，今天花掉一點
      Money.data.totalBudgets = [{ limit: 30000 }];
      Money.data.transactions = [
        { id: 'tb-t1', date: today, kind: 'expense', amount: 200, category: cat, account: '甲' },
      ];
      Money.save(); Overview.render(); await sleep(250);

      const p = Money.budgetPace(Money.range.start.slice(0, 7));
      ok('主角是「今天還可以花」那個數字',
         !!card() && card().textContent.includes(Math.round(p.todayLeft).toLocaleString('zh-TW')),
         card() ? card().textContent.slice(0, 60) : '');
      // 格式統一成她要的「花了 / 額度」（原話：支出食物 155/300 這種的）
      ok('額度和今天花掉的寫成 花了/額度',
         !!card() && card().textContent.includes('200 / '),
         card() ? card().textContent.slice(0, 70) : '');

      // 分類的今天額度
      Money.data.budgets = [{ category: cat, limit: 30000 }];
      Money.save(); Overview.render(); await sleep(250);
      ok('分類的今天額度也在總覽上',
         !!card() && card().textContent.includes(cat),
         card() ? card().textContent.slice(0, 90) : '');
      ok('分類有色點，每天位置和顏色都不會跳',
         !!card() && !!card().querySelector('.quota-row .dot'));

      // 分類今天花超過：數字照樣是「花了/額度」，但整列變紅——
      // 她要的是同一個格式，超支不該換一種講法讓人重新讀一次
      Money.data.budgets = [{ category: cat, limit: 300 }];
      Money.save(); Overview.render(); await sleep(250);
      ok('分類今天超出的話那一列是紅的',
         !!card() && !!card().querySelector('.quota-row .negative'),
         card() ? card().textContent.slice(0, 90) : '');

      // 同一個數字不要在同一頁講兩次
      const todayCard = [...document.querySelectorAll('#overview-grid .card')]
        .find(c => c.textContent.includes('今天的收支'));
      ok('「今天的收支」不再重複講額度',
         !!todayCard && !todayCard.textContent.includes('額度'),
         todayCard ? todayCard.textContent.slice(0, 60) : '');

      Money.data = JSON.parse(keep);
      Prefs.data.overviewOff = keepOff;
      Money.save(); Money.render(); Overview.render(); await sleep(200);
    }

    // ── 天氣的地點可以自己改 ──
    //
    // 「用我的位置」在 http 的網址上（手機看本機那份就是）根本不會動，
    // 而本來的錯誤處理什麼都不說——按了沒反應跟沒按到長得一模一樣。
    {
      await tab('overview');
      // 檢查是不上網的（PROBE 開頭把 Weather.init 停掉了），
      // 所以這裡自己塞一份資料進去，讓天氣卡畫得出來。
      Weather.place = { lat: 25.053, lon: 121.526, name: '測試地點' };
      Weather.data = { now: 26, feels: 28, code: 0, high: 30, low: 23, rain: 10 };
      Weather.at = Date.now();
      Overview.render(); await sleep(250);

      const wcard = [...document.querySelectorAll('#overview-grid .card')]
        .find(c => c.textContent.includes('今天的天氣'));
      ok('天氣卡畫得出來', !!wcard, '沒有那張卡');
      ok('地名有寫出來', !!wcard && wcard.textContent.includes('測試地點'),
         '不寫地名的話，看的人會以為那是自己所在地的天氣');

      const btn = wcard && [...wcard.querySelectorAll('button')]
        .find(b => b.textContent.includes('改地點'));
      ok('天氣卡上有「改地點」', !!btn);

      if (btn) {
        btn.click(); await sleep(220);
        ok('挑地點的視窗開得起來', q('#dlg-place').open);
        ok('視窗裡講得出現在看的是哪裡',
           q('#place-body').textContent.includes('測試地點'),
           q('#place-body').textContent.slice(0, 50));
        ok('有一個用打的搜尋框', !!q('#place-q'));

        /* 定位那顆。
         *
         * ⚠️ **這裡驗不到「http 上不能用」那個情況。** 檢查跑在
         * 127.0.0.1 上，而規格把 localhost 也算成安全上下文——
         * 所以這一輪的 isSecureContext 一定是 true。
         * 真正壞掉的是手機打 100.x 那個位址（不是 https 也不是 localhost）。
         * 那個分支由 測試.mjs 的 canLocate() 那條釘住。
         *
         * 這裡能驗的是：按鈕在、狀態跟 canLocate() 對得起來、
         * 而且不管哪一種都有寫一句話說明——本來那顆按了完全沒反應。 */
        const loc = [...document.querySelectorAll('#place-body button')]
          .find(b => b.textContent.includes('位置'));
        ok('有「用我現在的位置」那顆', !!loc);
        ok('那顆的狀態跟 canLocate 對得起來',
           !!loc && loc.disabled === !Weather.canLocate(),
           'canLocate=' + Weather.canLocate() + ' disabled=' + (loc && loc.disabled));
        ok('底下一定有一句話說明現在能不能用',
           q('#place-body').textContent.includes('權限')
           || q('#place-body').textContent.includes('https'),
           q('#place-body').textContent.slice(-60));

        q('#dlg-place button[value="cancel"]').click(); await sleep(180);
        ok('挑地點的視窗關得掉', !q('#dlg-place').open);
      }

      // 收乾淨，後面的檢查不要看到一張假的天氣卡
      Weather.data = null; Weather.place = null;
      Overview.render(); await sleep(180);
    }

    // ── 存錢罐是「從既有的戶頭裡挑」──
    //
    // 本來它是「加帳戶」表單裡的一個勾選框。要改一個已經建好的戶頭，
    // 得先想到去按那一列的「改」——看得到卻不能當場動它。
    {
      await tab('money');
      const keepAcc = JSON.stringify(Money.data.accounts);
      Money.data.accounts = [
        { id: 'sv1', name: '甲行', kind: 'bank', opening: 1000, includeInTotal: true, order: 0 },
        { id: 'sv2', name: '定存', kind: 'invest', opening: 60000, includeInTotal: true, order: 1 },
      ];
      Money.save(); Money.render(); await sleep(200);

      ok('存款總額那張卡有「存錢罐」的入口', !!q('#pick-savings') && !q('#pick-savings').hidden);
      ok('帳戶表單裡那個勾選也還在', !!q('#a-savings'), '兩個入口都要留');

      q('#pick-savings').click(); await sleep(200);
      ok('挑存錢罐的視窗開得起來', q('#dlg-savings').open);
      const rows = document.querySelectorAll('#savings-list .pick-row');
      ok('列得出每一個戶頭', rows.length === 2, rows.length + ' 列');
      ok('看得到每個戶頭有多少錢',
         q('#savings-list').textContent.includes('60,000'),
         q('#savings-list').textContent.slice(0, 40));

      if (rows.length === 2) {
        const box = rows[1].querySelector('input');
        box.checked = true;
        box.dispatchEvent(new Event('change'));
        await sleep(150);
        q('#sv-save').click(); await sleep(280);

        ok('挑好的存進去了',
           Money.data.accounts.find(a => a.id === 'sv2').isSavings === true
           && !Money.data.accounts.find(a => a.id === 'sv1').isSavings,
           JSON.stringify(Money.data.accounts.map(a => [a.name, !!a.isSavings])));
        ok('卡片上拆成「可以花的／存起來的」',
           q('#accounts-total').textContent.includes('可以花的')
           && q('#accounts-total').textContent.includes('存起來的'),
           q('#accounts-total').textContent.slice(0, 50));
        ok('可以花的沒有把存錢罐算進去',
           Money.spendable() === 1000 && Money.saved() === 60000,
           Money.spendable() + ' / ' + Money.saved());
        ok('存錢罐照樣算進存款總額', Money.total() === 61000, String(Money.total()));

        // 進去改個名字不該把她挑好的存錢罐洗掉
        Money.editAccount(Money.data.accounts.find(a => a.id === 'sv2'));
        await sleep(180);
        q('#a-name').value = '定存改名';
        q('#a-save').click(); await sleep(280);
        // 兩個入口寫同一個欄位，所以在清單挑好的，回到帳戶表單要看得到；
        // 而且只是進來改個名字不該把它洗掉。
        ok('改帳戶的名字不會把存錢罐洗掉',
           Money.data.accounts.find(a => a.id === 'sv2').isSavings === true,
           JSON.stringify(Money.data.accounts.map(a => [a.name, !!a.isSavings])));

        Money.editAccount(Money.data.accounts.find(a => a.id === 'sv2'));
        await sleep(180);
        ok('在清單挑好的，帳戶表單裡看得到是打勾的', q('#a-savings').checked === true);
        // 反過來：在表單裡取消，清單那邊也要跟著沒有
        q('#a-savings').checked = false;
        q('#a-save').click(); await sleep(280);
        ok('在表單裡取消，兩邊都跟著沒有',
           !Money.data.accounts.find(a => a.id === 'sv2').isSavings
           && !q('#accounts-total').textContent.includes('存起來的'),
           q('#accounts-total').textContent.slice(0, 40));
      }

      if (q('#dlg-savings').open) q('#dlg-savings').close();
      Money.data.accounts = JSON.parse(keepAcc);
      Money.save(); Money.render(); await sleep(180);
      ok('沒有帳戶的時候「存錢罐」收起來',
         !Money.data.accounts.length ? q('#pick-savings').hidden : true);
    }

    /* ── 「接下來」不列已經過完的事 ────────────────────
     *
     * 她的原話：「為什麼已經過時間的行程還在我的接下來」。晚上七點多
     * 打開，最上面掛著下午 3:30 的羽毛球，把真正接下來的明天早班擠掉。
     *
     * 這條用眼睛看不出來——中午看的時候畫面是對的。
     */
    {
      await tab('overview');
      const keepEvents = Cal.data.events.slice();
      const keepTodos = Todo.data.items.slice();
      const today = new Date().toISOString().slice(0, 10);
      const now = new Date();
      const nowHM = String(now.getHours()).padStart(2, '0') + ':'
                  + String(now.getMinutes()).padStart(2, '0');

      // 23:59 那一分鐘沒有「還沒到的今天」可以拿來測，跳過就好
      if (nowHM !== '23:59') {
        Cal.data.events = [
          { id: 'ck-past', date: today, time: '00:00', title: '過完的球局' },
          { id: 'ck-soon', date: today, time: '23:59', title: '等一下的事' },
          // 填了結束時間的，照結束時間算——這是她自己決定要留多久的方式
          { id: 'ck-long', date: today, time: '00:00', endTime: '23:59',
            title: '還在進行的事' },
        ];
        Todo.data.items = [
          { id: 'ck-due', due: today, done: false, title: '今天到期的待辦' },
        ];
        Cal.save(); Todo.save(); Overview.render(); await sleep(250);

        const card = [...document.querySelectorAll('#overview-grid .card')]
          .find(c => c.textContent.includes('接下來'));
        const txt = card ? card.textContent : '';

        ok('過完的行程不列在「接下來」', !!card && !txt.includes('過完的球局'), txt.slice(0, 90));
        ok('還沒到的照常列', txt.includes('等一下的事'), txt.slice(0, 90));
        ok('填了結束時間就算到結束時間', txt.includes('還在進行的事'), txt.slice(0, 90));
        /* **待辦不看時鐘。** 今天到期的待辦到半夜都還是今天到期的，
         * 它沒做完不會因為過了幾點就不用做。 */
        ok('今天到期的待辦不會被時間濾掉', txt.includes('今天到期的待辦'), txt.slice(0, 90));

        // 今天排過事、只是都過完了：不能寫成「今明兩天沒有排定的事」
        Cal.data.events = [{ id: 'ck-past', date: today, time: '00:00', title: '過完的球局' }];
        Todo.data.items = [];
        Cal.save(); Todo.save(); Overview.render(); await sleep(250);
        const card2 = [...document.querySelectorAll('#overview-grid .card')]
          .find(c => c.textContent.includes('接下來'));
        ok('今天的都過完了要講清楚，不是說沒排事情',
           !!card2 && card2.textContent.includes('今天的都結束了'),
           card2 ? card2.textContent.slice(0, 90) : '');
      }

      Cal.data.events = keepEvents;
      Todo.data.items = keepTodos;
      Cal.save(); Todo.save(); Overview.render(); await sleep(200);
    }

    // ── 總覽的卡片可以自己排順序 ──
    //
    // 排錯了不會報錯，只會讓她排好的順序自己跑掉。
    {
      await tab('overview');
      await sleep(200);
      const ids = () => [...document.querySelectorAll('#overview-grid > *')]
        .map(n => (n.classList.contains('arrange') ? n.querySelector('.arrange-name') : n)
                  ? (n.classList.contains('arrange')
                     ? n.querySelector('.arrange-name').textContent
                     : (n.querySelector('h2 .label') || {}).textContent || '?')
                  : '?');

      const before = ids();
      ok('平常沒有上下箭頭', !q('.arrange-bar'), before.join('｜'));
      /* 她的原話：「排版的按鈕有點醜，有沒有辦法隱藏」。
       * 按鈕還在 DOM 裡（排版模式要用），但整條工具列是收起來的。
       * **要驗 hidden，不能只驗存在**——.click() 對看不見的元素照樣有效，
       * 只查 !!q('#arrange-cards') 的話這條永遠是綠的。 */
      const tools = () => q('#arrange-cards').closest('.overview-tools');
      ok('平常看不到那顆按鈕', tools().hidden === true);

      // 進排版的路是長按卡片，不是按鈕
      const press = (node, type, extra = {}) => node.dispatchEvent(
        new PointerEvent(type, { bubbles: true, button: 0, pointerType: 'touch',
                                 clientX: 100, clientY: 200, ...extra }));
      /* **手指滑動不能算長按。** 手機上捲頁面的時候手指本來就壓在卡片上，
       * 沒有這條的話一捲就跳進排版模式——那會是每天都在踩的雷。 */
      const card0 = q('#overview-grid > .card');
      press(card0, 'pointerdown');
      press(card0, 'pointermove', { clientY: 260 });   // 移了 60px＝在捲動
      await sleep(750);
      ok('滑動不會誤觸長按', !q('.arrange-bar'));

      press(q('#overview-grid > .card'), 'pointerdown');
      await sleep(750);
      ok('長按卡片就進排版', !!q('.arrange-bar'));
      ok('進了排版才看得到按鈕', tools().hidden === false);
      ok('按鈕上寫的是「好了」', q('#arrange-cards').textContent === '好了',
         q('#arrange-cards').textContent);
      /* 長按在手機上原本就是「選字」，所以每次進排版都會先反白一片，
       * iOS 還會彈出「拷貝／查詢」蓋住畫面。她的原話：
       * 「這個卡片可以不要動不動就反白到字嗎」。 */
      {
        const sel = n => getComputedStyle(n).webkitUserSelect
                      || getComputedStyle(n).userSelect;
        ok('總覽的卡片不會被選到字', sel(q('#overview-grid .card')) === 'none',
           sel(q('#overview-grid .card')));
        /* 輸入的地方要留活口——想法牆的便利貼就長在總覽上，
         * 一起鎖掉的話那面牆就打不了字了。
         *
         * **自己插一個 textarea 進去驗，不繞想法牆。** 想法牆不在預設
         * 放上去的那幾張裡，等它出現才驗的話，這條大部分時候會是
         * 「沒找到輸入框」的空綠燈——那比沒有這條更糟。 */
        const probe = document.createElement('textarea');
        q('#overview-grid .card').append(probe);
        ok('總覽上的輸入框還是打得了字', sel(probe) === 'text', sel(probe));
        probe.remove();
      }

      ok('每一張都有拖曳的把手',
         document.querySelectorAll('.arrange-bar .grip').length
         === document.querySelectorAll('.arrange').length);

      ok('每一張都標了名字', document.querySelectorAll('.arrange-name').length === before.length,
         document.querySelectorAll('.arrange-name').length + ' vs ' + before.length);
      ok('第一張的「往前」按不動',
         document.querySelector('.arrange-bar .btn').disabled === true);

      // 把第二張往前搬，前兩張應該對調
      const bars = [...document.querySelectorAll('.arrange')];
      if (bars.length >= 2) {
        const second = bars[1].querySelector('.arrange-name').textContent;
        const first = bars[0].querySelector('.arrange-name').textContent;
        bars[1].querySelectorAll('.arrange-bar .btn')[0].click();
        await sleep(280);
        const now = ids();
        ok('往前搬真的換了位置', now[0] === second && now[1] === first,
           before.join('｜') + ' → ' + now.join('｜'));
        ok('順序存進設定裡了',
           Array.isArray(Prefs.data.overviewOrder) && Prefs.data.overviewOrder.length > 0,
           JSON.stringify(Prefs.data.overviewOrder));

        // 重畫一次不會跳回去
        Overview.render(); await sleep(220);
        ok('重畫之後順序還在', ids()[0] === second, ids().join('｜'));

        // 搬回去
        const back = [...document.querySelectorAll('.arrange')];
        back[1].querySelectorAll('.arrange-bar .btn')[0].click();
        await sleep(280);
      }

      /* ── 開關卡片 ──
       *
       * 她要的是「快速決定哪些卡片要放總覽」。**關掉之後一定要找得回來**
       * ——看不到的東西沒辦法被打開，沒有那一排的話關掉就等於永遠關掉。 */
      {
        const shelf = [...document.querySelectorAll('#overview-grid .card')]
          .find(c => c.textContent.includes('還沒放上去的'));
        ok('排版時最下面有「還沒放上去的」', !!shelf);
        ok('那一排列得出還沒放上去的卡片',
           !!shelf && (!!shelf.querySelector('.chip')
                       || shelf.textContent.includes('全部都放上去了')),
           shelf ? shelf.textContent.slice(0, 60) : '');

        const nameOf = n => n.querySelector('.arrange-name').textContent;
        const cards = [...document.querySelectorAll('.arrange')];
        const victim = cards[cards.length - 1];
        const gone = nameOf(victim);
        const before = cards.length;

        // ✕ 是每張卡工具列的最後一顆
        const xs = victim.querySelectorAll('.arrange-bar .btn');
        xs[xs.length - 1].click(); await sleep(300);

        const now = [...document.querySelectorAll('.arrange')];
        ok('按 ✕ 真的把卡片拿掉了', now.length === before - 1,
           before + ' → ' + now.length);

        /* 她把「接下來」按掉了，然後問「為什麼我的接下來不見了」。
         * 那顆 ✕ 就在拖曳把手的同一條 bar 上，按下去卡片直接消失，
         * 沒有一句話說剛剛發生了什麼——離開排版模式之後更是找不到。 */
        {
          const t = q('#toast');
          ok('拿掉的時候有講一聲',
             t.classList.contains('show') && t.textContent.includes(gone),
             t.textContent);
          const undo = t.querySelector('.toast-btn');
          ok('而且給得回來', !!undo && undo.textContent === '復原',
             undo ? undo.textContent : '沒有復原鍵');
          if (undo) {
            undo.click(); await sleep(300);
            ok('按復原就回來了',
               document.querySelectorAll('.arrange').length === before,
               String(document.querySelectorAll('.arrange').length));
            // 回到「拿掉」的狀態，底下那幾條還要驗「從那一排加回來」
            const xs2 = [...document.querySelectorAll('.arrange')]
              .find(n => n.querySelector('.arrange-name').textContent === gone)
              ?.querySelectorAll('.arrange-bar .btn');
            if (xs2) { xs2[xs2.length - 1].click(); await sleep(300); }
          }
        }
        ok('拿掉的存進設定裡了',
           Array.isArray(Prefs.data.overviewOff) && Prefs.data.overviewOff.length > 0,
           JSON.stringify(Prefs.data.overviewOff));

        const shelf2 = [...document.querySelectorAll('#overview-grid .card')]
          .find(c => c.textContent.includes('還沒放上去的'));
        ok('拿掉的出現在下面那一排，找得回來',
           !!shelf2 && shelf2.textContent.includes(gone),
           shelf2 ? shelf2.textContent.slice(0, 80) : '');

        // 加回來
        const chip = shelf2 && [...shelf2.querySelectorAll('.chip')]
          .find(b => b.textContent.includes(gone));
        ok('那一排的按鈕點得到', !!chip);
        if (chip) {
          chip.click(); await sleep(300);
          ok('加得回來', document.querySelectorAll('.arrange').length === before,
             String(document.querySelectorAll('.arrange').length));
        }
      }

      /* 拖著把手把第一張搬到第二張後面。
       *
       * 這條測的是**存下來了沒**，不只是畫面上動了——DOM 動了但沒寫進
       * Prefs 的話，重新整理就跑回去，而那要下一次開才看得到。 */
      {
        const wraps = [...document.querySelectorAll('#overview-grid .arrange')];
        if (wraps.length >= 2) {
          const firstId = wraps[0].dataset.cardId;
          const bar = wraps[0].querySelector('.arrange-bar');
          const target = wraps[1].getBoundingClientRect();
          press(bar, 'pointerdown', { pointerId: 1 });
          press(bar, 'pointermove', { pointerId: 1,
            clientX: target.left + target.width / 2,
            clientY: target.top + target.height - 4 });   // 下半部＝插到它後面
          press(bar, 'pointerup', { pointerId: 1 });
          await sleep(250);

          const after = [...document.querySelectorAll('#overview-grid .arrange')]
            .map(n => n.dataset.cardId);
          ok('拖了就換位置', after[0] !== firstId && after.includes(firstId),
             after.join('｜'));
          const saved = (Prefs.data.overviewOrder || []).filter(x => Overview.shown.has(x));
          ok('拖完的順序有存起來', saved.join(',') === after.join(','),
             saved.join('｜') + ' vs ' + after.join('｜'));
        }
      }

      q('#arrange-cards').click(); await sleep(250);
      ok('按「好了」箭頭就收起來', !q('.arrange-bar'));
      ok('「還沒放上去的」那排也一起收起來',
         ![...document.querySelectorAll('#overview-grid .card')]
           .some(c => c.textContent.includes('還沒放上去的')));
      ok('收起來之後卡片還是原本那幾張', ids().length === before.length,
         ids().join('｜'));
      // 排順序不該把卡片變成不能點的裝飾品
      ok('排完之後卡片上的按鈕還在',
         !!q('#overview-grid .btn'), '一顆按鈕都沒有');
    }

    // ── 存款可以遮起來 ──
    {
      await tab('money');
      Money.data.accounts = [
        { id: 'ck-h', name: '遮遮看', kind: 'bank', opening: 87654, includeInTotal: true, order: 0 },
      ];
      Money.save(); Money.renderAccounts(); await sleep(150);

      const shown = () => q('#accounts-total').textContent + ' ' + q('#accounts-list').textContent;
      ok('平常看得到金額', shown().includes('87,654'), shown().slice(0, 40));

      q('#toggle-balance').click(); await sleep(180);
      // **總額和每一列都要遮。** 只遮總額的話，底下那一排
      // 一個一個加起來還是同一個數字。
      ok('按了眼睛就看不到金額了', !shown().includes('87,654'), shown().slice(0, 40));
      ok('遮起來是點點，不是空白', shown().includes('•'), shown().slice(0, 40));
      ok('眼睛那顆看得出現在是遮著的',
         q('#toggle-balance').getAttribute('aria-pressed') === 'true');
      ok('遮起來的時候還是有圖示', !!q('#toggle-balance svg'));

      // 記得住：重畫一次不會自己跳回去
      Money.render(); await sleep(150);
      ok('重畫之後還是遮著的', !shown().includes('87,654'));

      q('#toggle-balance').click(); await sleep(180);
      ok('再按一次就看得到了', shown().includes('87,654'), shown().slice(0, 40));
      ok('眼睛那顆也跟著換回來',
         q('#toggle-balance').getAttribute('aria-pressed') === 'false');
    }

    // ── 總覽：今天的收支明細 ──
    {
      const today = new Date().toISOString().slice(0, 10);
      Money.data.accounts = [
        { id: 'ck-t', name: '測試戶', kind: 'cash', opening: 5000, includeInTotal: true, order: 0 },
      ];
      Money.data.transactions = [
        { id: 'ck-today1', date: today, kind: 'expense', amount: 155,
          category: Money.data.categories.expense[0].name, account: '測試戶', note: '加油' },
        { id: 'ck-today2', date: today, kind: 'income', amount: 500,
          category: Money.data.categories.income[0].name, account: '測試戶', note: '打工' },
        { id: 'ck-old', date: '2025-01-10', kind: 'expense', amount: 9999,
          category: Money.data.categories.expense[0].name, account: '測試戶', note: '很久以前' },
      ];
      Money.save(); Overview.render(); await tab('overview'); await sleep(220);

      const cards = [...document.querySelectorAll('#overview-grid .card')];
      const todayCard = cards.find(c => c.textContent.includes('今天的收支'));
      ok('總覽上有「今天的收支」', !!todayCard);
      if (todayCard) {
        const text = todayCard.textContent;
        ok('列得出今天那幾筆', text.includes('加油') && text.includes('打工'), text.slice(0, 60));
        ok('今天的支出合計對', text.includes('155'));
        ok('今天的收入合計對', text.includes('500'));
        // **不能把別天的混進來。** 混進來不會報錯，只會給一個
        // 看起來很合理、但其實是好幾天加總的數字。
        ok('別天的不會混進來', !text.includes('9,999'), text.slice(0, 80));
        ok('明細點得進去改',
           !!todayCard.querySelector('.txn-row'));
      }

      // 空的時候要是空狀態，不是一排 0
      Money.data.transactions = [];
      Money.save(); Overview.render(); await sleep(200);
      const empty = [...document.querySelectorAll('#overview-grid .card')]
        .find(c => c.textContent.includes('今天的收支'));
      ok('今天沒記帳的時候是空狀態',
         !!empty && empty.textContent.includes('今天還沒有記帳'),
         empty ? empty.textContent.slice(0, 50) : '找不到那張卡');

      // ── 電腦上不要留空格 ──
      //
      // 她的原話是「電腦跟平板打開的時候會有地方空空的」。
      // 根因是整排寬的卡片夾在中間，把上一排切斷。這裡量的是
      // **同一排卡片的右邊界有沒有貼齊格線**，不是數卡片張數。
      const grid = q('#overview-grid');
      const gridRight = Math.round(grid.getBoundingClientRect().right);
      const normal = [...grid.children].filter(c => !c.classList.contains('wide'));
      const rows = new Map();
      for (const c of normal) {
        const r = c.getBoundingClientRect();
        const key = Math.round(r.top);
        if (!rows.has(key)) rows.set(key, []);
        rows.get(key).push(Math.round(r.right));
      }
      const keys = [...rows.keys()].sort((a, b) => a - b);
      // 最後一排排不滿是正常的（卡片張數不見得是三的倍數），
      // 中間幾排排不滿才是版面被切斷。
      const holes = keys.slice(0, -1)
        .filter(k => Math.max(...rows.get(k)) < gridRight - 8);
      ok('電腦上中間幾排沒有空格', holes.length === 0,
         holes.length + ' 排沒排滿（共 ' + keys.length + ' 排）');

    }

    // 換回前面那份，後面的檢查才接得下去
    Money.data = JSON.parse(keepMoney);
    Money.save(); Money.render(); Overview.render(); await sleep(200);

    // ── 報表：圓餅、折線、帳戶篩選 ──
    //
    // 圖畫錯了只是「有點怪」，不會有任何錯誤訊息；篩錯帳戶更糟，
    // 會給一個看起來很合理的小數字。
    {
      await tab('money');

      // **這一段會把記帳的資料換掉，做完要換回來。**
      // 後面還有一串檢查是接著前面建好的帳戶和帳目跑的，
      // 忘了還原的話那些會整批倒掉，而且看起來像是它們自己壞了。
      const keep = JSON.stringify(Money.data);

      // 先放幾筆帳，不然報表全是空的什麼都驗不到
      Money.data.accounts = [
        { id: 'ck1', name: '甲行', kind: 'bank', opening: 0, includeInTotal: true },
        { id: 'ck2', name: '乙行', kind: 'bank', opening: 0, includeInTotal: true },
      ];
      const t = todayStr();
      Money.data.transactions = [
        { id: 'x1', date: t, kind: 'expense', amount: 300, category: '餐飲', account: '甲行' },
        { id: 'x2', date: t, kind: 'expense', amount: 200, category: '房租', account: '乙行' },
        { id: 'x3', date: t, kind: 'income', amount: 900, category: '打工', account: '甲行' },
      ];
      Money.reportAccount = '';
      Money.render();
      await sleep(220);

      const donut = q('#by-category .donut');
      ok('圓餅畫得出來', !!donut);
      if (donut) {
        // 一個底環加兩塊
        const arcs = donut.querySelectorAll('circle');
        ok('圓餅的塊數對得上分類數', arcs.length === 3, arcs.length + ' 個圓');
        const legend = document.querySelectorAll('#by-category .pie-key');
        ok('圓餅有圖例', legend.length === 2, legend.length + ' 列');
        // 圖例的顏色要跟下面那條一樣，不然眼睛得重新認一次
        const key = q('#by-category .pie-key i');
        const bar = q('#by-category .cat-bar');
        ok('圖例和長條同色',
           getComputedStyle(key).backgroundColor === getComputedStyle(bar).backgroundColor,
           getComputedStyle(key).backgroundColor + ' vs ' + getComputedStyle(bar).backgroundColor);
      }

      // 折線
      const shapeBtns = document.querySelectorAll('#trend-shape .view-btn');
      ok('有長條／折線可以切', shapeBtns.length === 2);
      if (shapeBtns.length === 2) {
        shapeBtns[1].click(); await sleep(260);
        const line = q('#trend .linechart');
        ok('切得到折線', !!line);
        if (line) {
          ok('折線有兩條（收入、支出）',
             line.querySelectorAll('path[fill="none"]').length === 2);
          const axis = document.querySelectorAll('#trend .chart-axis .chart-label');
          const dots = line.querySelectorAll('circle');
          ok('每個月都有一個點', dots.length === axis.length * 2,
             dots.length + ' 點 / ' + axis.length + ' 個月');
          // 點要在圖裡面，跑到框外就是幾何算錯了
          const box = line.getBoundingClientRect();
          const outside = [...dots].filter(c => {
            const b = c.getBoundingClientRect();
            return b.left < box.left - 6 || b.right > box.right + 6
                || b.top < box.top - 6 || b.bottom > box.bottom + 6;
          });
          ok('點都在圖裡面', outside.length === 0, outside.length + ' 個跑出去');
        }
        shapeBtns[0].click(); await sleep(200);
        ok('切得回長條', !!q('#trend .chart'));
      }

      // 帳戶篩選
      const acct = q('.acct-filter select');
      ok('有「報表只看哪個帳戶」', !!acct);
      if (acct) {
        const all = q('#month-summary').textContent;
        ok('全部帳戶時支出是 500', all.includes('500'), all.replace(/\s+/g, ' '));
        acct.value = '甲行';
        acct.dispatchEvent(new Event('change'));
        await sleep(260);
        const one = q('#month-summary').textContent;
        ok('篩了甲行支出剩 300', one.includes('300') && !one.includes('500'),
           one.replace(/\s+/g, ' '));
        ok('篩了之後圓餅只剩一塊',
           document.querySelectorAll('#by-category .pie-key').length === 1);

        // 預算不吃篩選，這件事一定要寫出來
        Money.data.budgets = [{ category: '餐飲', limit: 1000 }];
        Money.render(); await sleep(220);
        ok('篩帳戶時預算卡有講它不受影響',
           q('#budgets').textContent.includes('不受上面的帳戶篩選'));

        q('.acct-filter .btn').click(); await sleep(220);
        ok('按「看全部」回得去', Money.reportAccount === '');
      }

      Money.data = JSON.parse(keep);
      Money.reportAccount = '';
      Money.render();
      await sleep(200);
    }

    // CSS 有沒有被切壞。
    //
    // 今天真的發生過：拿註解裡也出現的字串當錨點做替換，把註解從中間
    // 切開，結束符號提前出現，後面整段變成垃圾規則，反而把 [hidden]
    // 那條吃掉——**畫面壞了但沒有任何錯誤訊息**。
    {
      const sheet = [...document.styleSheets].find(s => (s.href || '').includes('style.css'));
      let rules = [];
      try { rules = [...sheet.cssRules]; } catch {}
      ok('樣式表載得進來而且規則數合理', rules.length > 200, rules.length + ' 條');
      // 被切壞的話會冒出一條選擇器裡帶著中文或標點的垃圾規則
      // 被切壞的規則會帶中文標點。用 fromCharCode 產生，
      // 不要寫跳脫序列——那會先被外層的樣板字串求值掉。
      const badChars = [0x300c, 0x300d, 0xff0c, 0x3002, 0x2014]
          .map(c => String.fromCharCode(c));
      const junk = rules.filter(r => r.selectorText
          && badChars.some(c => r.selectorText.includes(c)));
      ok('沒有被切壞的垃圾規則', junk.length === 0,
         junk.map(r => r.selectorText).join(' | '));
      ok('隱藏那條規則在',
         rules.some(r => r.selectorText === '[hidden]'));
    }

    // hidden 一定要贏。瀏覽器內建的 [hidden] 權重只有 (0,1,0)，
    // 隨便一條 label.field { display: block } 就蓋得過去——JS 設了
    // .hidden = true 但畫面上那一欄照樣在，而且程式一行都沒錯。
    q('#add-txn').click(); await sleep(200);
    ok('支出的時候不該出現「轉到」',
       getComputedStyle(q('#t-to-field')).display === 'none',
       getComputedStyle(q('#t-to-field')).display);
    ok('「新增帳戶」的區塊預設是收起來的',
       getComputedStyle(q('#t-new-account')).display === 'none',
       getComputedStyle(q('#t-new-account')).display);
    // 金額的上下箭頭沒意義——沒有人記帳是一塊一塊加上去的，
    // 而且那對箭頭很細，手指按下去常常按到隔壁。
    ok('金額沒有上下按鈕',
       getComputedStyle(q('#t-amount')).appearance === 'textfield'
       || getComputedStyle(q('#t-amount'), '::-webkit-inner-spin-button').appearance === 'none',
       getComputedStyle(q('#t-amount')).appearance);
    ok('但還是數字鍵盤', q('#t-amount').type === 'number');

    ok('記一筆一打開就有選好的分類',
       !!q('#t-category').value, JSON.stringify(q('#t-category').value));
    q('#t-kind').value = 'transfer';
    q('#t-kind').dispatchEvent(new Event('change'));
    await sleep(200);
    ok('轉帳的時候「轉到」才出現',
       getComputedStyle(q('#t-to-field')).display !== 'none');
    ok('轉帳的時候不用選分類',
       getComputedStyle(q('#t-category-field')).display === 'none');
    q('#dlg-txn button[value=\"cancel\"]').click(); await sleep(200);

    // 「固定支出不知道怎麼算的」——那個答案要在看得到的地方，
    // 不能藏在別張卡的「管理分類」裡。
    ok('固定 vs 彈性那張卡有「哪些算固定」的入口', !!q('#edit-nature'));
    ok('卡片上寫得出怎麼分的',
       q('#fixed-flexible').textContent.includes('算固定的')
       || q('#fixed-flexible').textContent.includes('每一類都算彈性')
       || q('#fixed-flexible').textContent.includes('沒有支出'),
       q('#fixed-flexible').textContent.slice(0, 50));
    q('#edit-nature').click(); await sleep(220);
    ok('按了會開管理分類', q('#dlg-categories').open);
    q('#dlg-categories button[value=\"cancel\"]').click(); await sleep(180);

    // ── 從別的記帳 App 匯進來 ──
    // 匯錯的資料很糟：兩百筆混進來之後要一筆一筆挑出來刪，比重打還累。
    // 所以一定要有預覽，而且解不開的那幾列要講出來。
    try {
      ok('「所有帳目」那張卡有匯入的入口', !!q('#import-csv'));
      q('#import-csv').click(); await sleep(220);
      ok('匯入視窗開得起來', q('#dlg-csv').open);
      ok('一開始只給選檔案，還不能按匯入', q('#csv-go').hidden);

      /* 直接餵一份 CSV 進去，不經過檔案選擇器。
       *
       * **不能用真的 new File([...])。** handleImportFile 裡是
       * await file.text()，而 Blob 的讀取不是計時器——在
       * --virtual-time-budget 底下三次有一次永遠不會回來，
       * 整個桌機那輪就停在那個 await 上（而且是靜靜地停）。
       * 這裡餵一個只長得像 File 的東西：被驗的是欄位對應、預覽、
       * 去重複這些自己寫的邏輯，瀏覽器怎麼把 Blob 讀成字串不是。
       *
       * ⚠️ PROBE 是樣板字串，這裡面**一個反引號都不能出現**——
       * 一出現就把外層字串收掉了，node --check 會指著一個
       * 看起來完全無關的地方說 SyntaxError。 */
      const fakeFile = text => ({ name: '別的App.csv', type: 'text/csv',
                                  async text() { return text; } });

      // 直接餵一份 CSV 進去，不經過檔案選擇器
      const csv = [
        '日期,類型,金額,分類,備註,帳戶',
        '2026-09-01,支出,120,飲食,全家,現金',
        '2026-09-02,收入,5000,打工,九月薪水,現金',
        '昨天,支出,50,飲食,讀不懂的那列,現金',
      ].join(String.fromCharCode(10));
      await guard(Money.handleImportFile(fakeFile(csv)), '讀 CSV');
      await sleep(300);

      ok('欄位對應猜出來了',
         document.querySelectorAll('#csv-body .csv-map select').length === 8);
      ok('有預覽表格', !!q('#csv-table') || !!q('.csv-table'));
      ok('讀不懂的那列有講出來',
         q('.csv-problems')?.textContent.includes('讀不懂') === true
         || q('.csv-problems')?.textContent.includes('1 列') === true,
         q('.csv-problems')?.textContent.slice(0, 40) || '沒有那一區');
      ok('可以按匯入了', !q('#csv-go').hidden, q('#csv-go').textContent);

      const before = Money.data.transactions.length;
      q('#csv-go').click(); await sleep(350);
      ok('真的匯進來了', Money.data.transactions.length === before + 2,
         String(Money.data.transactions.length - before));
      ok('讀不懂的那列沒有被硬塞進來',
         !Money.data.transactions.some(t => (t.note || '').includes('讀不懂')));
      ok('匯進來的分類有補到分類清單',
         Money.data.categories.income.some(c => c.name === '打工'));

      // 兩百筆匯錯之後要一筆一筆刪，所以一定要能整批收回
      const undo = q('.toast-btn');
      ok('匯完給得起「全部收回」', !!undo, undo ? undo.textContent : '沒有');
      if (undo) {
        undo.click(); await sleep(350);
        ok('收回之後真的清乾淨', Money.data.transactions.length === before);
      }

      // 同一份再匯一次不該重複
      await guard(Money.handleImportFile(fakeFile(csv)), '讀 CSV');
      await sleep(300);
      q('#csv-go').click(); await sleep(350);
      const after = Money.data.transactions.length;
      await guard(Money.handleImportFile(fakeFile(csv)), '讀 CSV');
      await sleep(300);
      ok('已經匯過的會被認出來，不給重複匯',
         q('#csv-go').hidden || q('#csv-body').textContent.includes('已經有了'),
         q('#csv-body').textContent.slice(0, 60));
      q('#dlg-csv button[value=\"cancel\"]').click(); await sleep(200);

      // 清乾淨
      Money.data.transactions = Money.data.transactions.filter(
          t => !['全家', '九月薪水'].includes(t.note));
      Money.save(); Money.render(); await sleep(200);
    } catch (e) {
      // 只有這一段倒下去，後面幾十條照跑
      ok('匯入那一段跑得完', false, e.message);
      if (q('#dlg-csv')?.open) q('#dlg-csv').close();
      Money.data.transactions = Money.data.transactions.filter(
          t => !['全家', '九月薪水'].includes(t.note));
      Money.save(); Money.render(); await sleep(200);
    }

    // ── 對帳 ──
    // 「為什麼會有差價」沒辦法真的知道——漏記的那筆已經不在資料裡了。
    // 能做的是把範圍縮到最小。
    {
      q('#add-account').click(); await sleep(160);
      q('#a-name').value = '郵局';
      q('#a-opening').value = '1000';
      q('#a-save').click(); await sleep(280);

      const acc = Money.data.accounts.find(a => a.name === '郵局');
      ok('帳戶列上有對帳的入口',
         [...document.querySelectorAll('#accounts-list button')]
           .some(b => b.textContent === '對帳'));

      Money.openReconcile(acc); await sleep(220);
      ok('對帳視窗開得起來', q('#dlg-reconcile').open);
      ok('帳上算出來的填好了', q('#rc-computed').value.includes('1,000'),
         q('#rc-computed').value);

      // 對得起來
      q('#rc-actual').value = '1000';
      q('#rc-actual').dispatchEvent(new Event('input'));
      await sleep(200);
      ok('對得起來的時候說對得起來',
         q('#rc-result').textContent.includes('一塊錢都沒差'));

      // 對不起來
      q('#rc-actual').value = '800';
      q('#rc-actual').dispatchEvent(new Event('input'));
      await sleep(200);
      ok('對不起來的時候講出差多少',
         q('#rc-result').textContent.includes('200'), q('#rc-result').textContent.slice(0, 60));
      ok('第一次對帳不會假裝知道是什麼時候漏的',
         q('#rc-result').textContent.includes('第一次對帳'));

      const before = Money.data.transactions.length;
      q('#rc-adjust').click(); await sleep(320);
      ok('補一筆之後帳就平了', Money.balance('郵局') === 800, String(Money.balance('郵局')));
      ok('真的多了一筆', Money.data.transactions.length === before + 1);
      ok('補的那筆看得出是對帳補的',
         Money.data.transactions.some(t => (t.note || '').includes('對帳')));
      ok('記下了對帳的日期', !!Money.data.accounts.find(a => a.name === '郵局').checkedAt);

      // 第二次對帳：範圍縮到上次之後
      Money.openReconcile(Money.data.accounts.find(a => a.name === '郵局'));
      await sleep(220);
      q('#rc-actual').value = '700';
      q('#rc-actual').dispatchEvent(new Event('input'));
      await sleep(200);
      ok('對過一次之後就講得出範圍',
         q('#rc-result').textContent.includes('對過一次'),
         q('#rc-result').textContent.slice(0, 80));
      q('#dlg-reconcile button[value=\"cancel\"]').click(); await sleep(200);

      // 清乾淨，不要影響後面的檢查
      Money.data.transactions = Money.data.transactions
          .filter(t => !(t.note || '').includes('對帳'));
      Money.data.accounts = Money.data.accounts.filter(a => a.name !== '郵局');
      Money.save(); Money.render(); await sleep(200);
    }

    // ── 記一筆整條路 ──
    q('#add-account').click(); await sleep(160);
    q('#a-name').value = '現金';
    q('#a-save').click(); await sleep(240);
    ok('帳戶加得起來', Money.data.accounts.length === 1);

    q('#add-txn').click(); await sleep(160);
    ok('記一筆有分類可選', document.querySelectorAll('#t-category option').length > 0);
    q('#t-amount').value = '120';
    q('#t-save').click(); await sleep(280);
    ok('記一筆記得進去', Money.data.transactions.length === 1);
    ok('金額對', (Money.data.transactions[0] || {}).amount === 120);

    // 圖表的月份標籤不准斷行——「10月」拆成兩行的話那一欄會比別欄高，
    // 整排標籤參差不齊。她的原話是「兩位數的都跑掉」。
    {
      const labels = [...document.querySelectorAll('.chart-label')];
      ok('趨勢圖有月份標籤', labels.length > 0, labels.length + ' 個');
      const heights = labels.map(l => Math.round(l.getBoundingClientRect().height));
      ok('每個月份標籤都一樣高（沒有被拆成兩行）',
         new Set(heights).size <= 1, heights.join(','));
      ok('十二個月的時候只寫數字，不寫「月」',
         labels.length < 9 || !labels[0].textContent.includes('月'),
         labels.map(l => l.textContent).join(','));
    }

    // ── 記到一半才發現沒有那個帳戶 ──
    //
    // 她說「紀錄支出的時候沒辦法選擇帳戶」。下拉本身是好的，
    // 問題是裡面只有一個選項，而且**當下沒有辦法加**——
    // 要加得先取消這一筆、跑去別的卡片建完、再回來重打。
    q('#add-txn').click(); await sleep(200);
    {
      const sel = q('#t-account'), box = q('#t-new-account');
      const last = sel.options[sel.options.length - 1];
      ok('帳戶下拉最後一項是新增', last.textContent.includes('新增帳戶'), last.textContent);
      ok('新增區一開始收著', box.hidden);
      ok('預設選的是現有帳戶', sel.value === '現金', sel.value);

      sel.value = last.value;
      sel.dispatchEvent(new Event('change'));
      await sleep(200);
      ok('選了新增就展開', !box.hidden);

      // 空名字不給建
      q('#t-new-account-name').value = '   ';
      q('#t-new-account-add').click(); await sleep(200);
      ok('沒填名字不給建', Money.data.accounts.length === 1);

      // 同名不給建
      q('#t-new-account-name').value = '現金';
      q('#t-new-account-add').click(); await sleep(200);
      ok('同名不給建', Money.data.accounts.length === 1);

      q('#t-new-account-name').value = '郵局';
      q('#t-new-account-add').click(); await sleep(300);
      ok('建得起來', Money.data.accounts.length === 2);
      ok('建完收起來', box.hidden);
      ok('建完自動選中新的', sel.value === '郵局', sel.value);
      ok('新帳戶起始餘額是 0',
         (Money.data.accounts.find(a => a.name === '郵局') || {}).opening === 0);

      // 取消那條路：退回原本的帳戶，不要留在「＋ 新增帳戶…」
      sel.value = sel.options[sel.options.length - 1].value;
      sel.dispatchEvent(new Event('change'));
      await sleep(180);
      q('#t-new-account-cancel').click(); await sleep(200);
      ok('取消會收起來', box.hidden);
      ok('取消後不會停在新增那一項',
         sel.value !== sel.options[sel.options.length - 1].value, sel.value);

      // 用新帳戶記一筆，走完整條路
      q('#t-account').value = '郵局';
      q('#t-amount').value = '55';
      q('#t-save').click(); await sleep(300);
      ok('用剛建的帳戶記得成', Money.data.transactions.length === 2);
      ok('那筆掛在新帳戶下',
         (Money.data.transactions.find(t => t.amount === 55) || {}).account === '郵局');
    }

    // ── 行程：存進去要看得到 ──
    await tab('agenda');
    q('#add-event').click(); await sleep(160);
    q('#e-title').value = '檢查用行程';
    q('#e-save').click(); await sleep(260);
    ok('行程存得進去', Cal.data.events.length === 1);
    ok('行程出現在時間線上', q('#agenda-list').textContent.includes('檢查用行程'));

    // ── 待辦：勾了要變完成 ──
    q('#add-todo').click(); await sleep(160);
    q('#d-title').value = '檢查用待辦';
    q('#d-save').click(); await sleep(260);
    ok('待辦存得進去', Todo.data.items.length === 1);
    const check = q('#agenda-list .todo-row .check');
    if (check) {
      check.click(); await sleep(220);
      ok('勾得起來', Todo.data.items[0].done === true);
    } else ok('勾得起來', false, '找不到勾選框');

    // ── 遠一點的待辦不能消失（14 天視野外）──
    // 這條是踩過才加的：排到 25 天後的待辦整批看不見，
    // 東西還在但畫面上沒有 → 使用者以為存檔失敗，也刪不掉（點不到）。
    await tab('agenda');
    const far = new Date(Date.now() + 25 * 86400000);
    const farYmd = far.getFullYear() + '-' +
        String(far.getMonth()+1).padStart(2,'0') + '-' + String(far.getDate()).padStart(2,'0');
    q('#add-todo').click(); await sleep(160);
    q('#d-title').value = '25天後的待辦';
    q('#d-due').value = farYmd;
    q('#d-save').click(); await sleep(300);
    ok('遠一點的待辦看得到', q('#agenda-list').textContent.includes('25天後的待辦'));
    ok('有「更遠」那一區', q('#agenda-list').textContent.includes('更遠'));

    // 過期的行程要能一件一件收掉。她的原話是「過期的我不能按已完成」——
    // 行程沒有完成狀態，但她要的是同一件事：這件處理完了，讓它消失。
    {
      const past = new Date(Date.now() - 3 * 86400000);
      const pastYmd = past.getFullYear() + '-'
          + String(past.getMonth()+1).padStart(2,'0') + '-'
          + String(past.getDate()).padStart(2,'0');
      q('#add-event').click(); await sleep(160);
      q('#e-title').value = '過期的行程';
      q('#e-date').value = pastYmd;
      q('#e-save').click(); await sleep(300);

      const row = [...document.querySelectorAll('#agenda-list .overdue-group .event-row')]
          .find(r => r.textContent.includes('過期的行程'));
      ok('過期的行程出現在過期那一區', !!row);
      const done = row?.querySelector('.event-done');
      ok('過期的行程每一列都有收掉的鍵', !!done);
      if (done) {
        const before = Cal.data.events.length;
        done.click(); await sleep(320);
        // **收起來，不是刪掉。** 會讓東西永遠消失的按鈕太兇了。
        ok('收掉不會把資料刪掉', Cal.data.events.length === before);
        ok('收掉的那件標成收起來了',
           Cal.data.events.find(e => e.title === '過期的行程')?.done === true);
        ok('收掉之後不在「過期了」那一區',
           !q('#agenda-list .overdue-group')
           || !q('#agenda-list .overdue-group').textContent.includes('過期的行程'));
        // **做完的不留在時間線上。** 她的話：「做完的東西不要留在版面，
        // 可以把做完的集合起來放在某一個地方」——那個地方是「做完的」檢視。
        ok('收掉之後不留在時間線上',
           !q('#agenda-list').textContent.includes('過期的行程'),
           q('#agenda-list').textContent.slice(0, 60));

        // 但一定找得到。收掉就等於不見的按鈕太兇了。
        const doneBtn = [...document.querySelectorAll('#agenda-tools .view-btn')]
            .find(b => b.textContent.includes('做完的'));
        ok('有「做完的」這個檢視', !!doneBtn);
        if (doneBtn) {
          doneBtn.click(); await sleep(300);
          ok('做完的那一頁看得到剛收掉的',
             q('#agenda-list').textContent.includes('過期的行程'),
             q('#agenda-list').textContent.slice(0, 60));
          // 按什麼時候做完的分組。一年份排成一長串跟沒有一樣
          const heads = [...document.querySelectorAll('#agenda-list .day-name')]
              .map(n => n.textContent);
          ok('做完的有按時間分組',
             heads.some(h => ['今天', '這七天', '更早', '不知道什麼時候'].includes(h)),
             heads.join('、'));
          ok('做完的那一列有「放回去」',
             [...document.querySelectorAll('#agenda-list button')]
               .some(b => b.textContent === '放回去'));
          // 「清掉完成的」只在這一頁出現——做完的已經不在時間線上了，
          // 把刪除鍵留在那裡等於一顆看不到目標的按鈕
          ok('「清掉完成的」在做完的那一頁', !q('#clear-done').hidden);

          const back = [...document.querySelectorAll('#agenda-tools .view-btn')]
              .find(b => b.textContent.includes('時間線'));
          back.click(); await sleep(300);
          ok('回到時間線時「清掉完成的」收起來', q('#clear-done').hidden);
        }

        const undo = q('#toast button');
        ok('剛收掉的時候也給得回來', !!undo);
        if (undo) {
          undo.click(); await sleep(320);
          ok('放回去之後回到過期那一區',
             q('#agenda-list .overdue-group').textContent.includes('過期的行程'));
        }
      }
      // 清乾淨，不要影響後面的檢查
      Cal.data.events = Cal.data.events.filter(e => e.title !== '過期的行程');
      Cal.save(); Agenda.render(); await sleep(150);
    }

    // 還沒到的行程不該有那顆勾——多一顆勾只會讓人以為那是「完成」
    ok('沒過期的行程不給收掉的鍵',
       !q('#agenda-list .day-group:not(.overdue-group) .event-done'));

    // 看得到就要點得到、刪得掉
    const farRow = [...document.querySelectorAll('#agenda-list .todo-row')]
        .find(r => r.textContent.includes('25天後的待辦'));
    ok('遠一點的待辦點得到', !!farRow);
    if (farRow) {
        farRow.querySelector('.grow').click(); await sleep(250);
        ok('點了會開編輯', q('#dlg-todo').open);
        const before = Todo.data.items.length;
        q('#d-delete').click(); await sleep(300);
        ok('遠一點的待辦刪得掉', Todo.data.items.length === before - 1);
    }

    // 遠一點的行程也一樣
    q('#add-event').click(); await sleep(160);
    q('#e-title').value = '25天後的行程';
    q('#e-date').value = farYmd;
    q('#e-save').click(); await sleep(300);
    ok('遠一點的行程看得到', q('#agenda-list').textContent.includes('25天後的行程'));

    // ── 過期的行程要清得掉 ──
    //
    // 她說「網頁版那邊過期的事情還沒辦法刪掉，會一直留在版面上」。
    // 單筆點進去本來就刪得掉，缺的是「一次清掉」。
    {
        const past = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
        q('#add-event').click(); await sleep(160);
        q('#e-title').value = '過期用行程';
        q('#e-date').value = past;
        q('#e-save').click(); await sleep(300);
        ok('過期的行程會排到「過期了」那一區',
           q('.overdue-group')?.textContent.includes('過期用行程') === true);

        const before = Cal.data.events.length;
        const openTodos = Todo.open().filter(t => t.due && t.due < todayStr()).length;
        const clear = q('.day-clear');
        ok('過期那一區有清掉鈕', !!clear, clear ? clear.textContent : '沒有');
        clear.click(); await sleep(350);
        // 「清掉」也是收起來，不是刪掉——「清掉」這兩個字聽起來像永久
        // 消失，但它們會待在「收起來的」那一區，隨時放得回去。
        ok('清掉不會把資料刪掉', Cal.data.events.length === before);
        ok('清掉的那件標成收起來了',
           Cal.data.events.find(e => e.title === '過期用行程')?.done === true);
        ok('不在「過期了」那一區了',
           !q('.overdue-group')
           || !q('.overdue-group').textContent.includes('過期用行程'));
        ok('待辦沒有被順手清掉',
           Todo.open().filter(t => t.due && t.due < todayStr()).length === openTodos);

        const undo = q('.toast-btn');
        ok('清完給得起復原', !!undo, undo ? undo.textContent : '沒有');
        undo.click(); await sleep(350);
        ok('放回去之後回到過期那一區',
           q('.overdue-group')?.textContent.includes('過期用行程') === true);
        ok('畫面上也回來了', q('#agenda-list').textContent.includes('過期用行程'));

        // 收拾乾淨，後面的檢查不要被這一筆影響
        Cal.data.events = Cal.data.events.filter(e => e.title !== '過期用行程');
        Cal.save(); Agenda.render(); await sleep(200);
    }

    /* ── 倒數：加得進去、數得對、上得了總覽 ──────────────
     *
     * 她的原話：「我要增加　離寒假　暑假　國定假日或是期中期末考還有幾天
     * 這樣的東西　可以自訂」。
     */
    {
      await tab('agenda');
      await sleep(200);
      ok('「接下來」那頁有倒數這一區', !!q('#countdown-list'));

      const keep = Countdown.data.items.slice();
      Countdown.data.items = [];
      Countdown.render(); await sleep(150);
      ok('沒東西的時候講得出要做什麼',
         q('#countdown-list').textContent.includes('填一個日期'),
         q('#countdown-list').textContent.slice(0, 60));

      // 從對話框加一筆，走她真的會走的那條路
      q('#add-countdown').click(); await sleep(200);
      const future = new Date(); future.setDate(future.getDate() + 30);
      const fstr = future.toISOString().slice(0, 10);
      q('#cd-title').value = '期中考';
      q('#cd-date').value = fstr;
      q('#cd-save').click(); await sleep(300);

      ok('加得進去', Countdown.data.items.length === 1,
         JSON.stringify(Countdown.data.items));
      ok('清單上數得出還有幾天',
         q('#countdown-list').textContent.includes('還有 30 天'),
         q('#countdown-list').textContent.slice(0, 80));

      // 總覽也要看得到
      await tab('overview'); await sleep(250);
      const card = [...document.querySelectorAll('#overview-grid .card')]
        .find(c => c.textContent.includes('倒數'));
      ok('總覽上有倒數這張卡', !!card, '沒找到');
      ok('卡片上寫得出還有幾天',
         !!card && card.textContent.includes('還有 30 天'),
         card ? card.textContent.slice(0, 80) : '');

      /* **過完的不上總覽。** 那一頁只回答「現在需要我注意什麼」，
       * 去年的期中考不在那個問題裡面——但它要留在「接下來」那邊的清單上，
       * 讓她自己決定刪掉還是改日期。 */
      Countdown.data.items = [
        { id: 'ck-past', title: '去年的期末考', date: '2020-06-01' },
      ];
      Countdown.save(); Overview.render(); await sleep(250);
      const card2 = [...document.querySelectorAll('#overview-grid .card')]
        .find(c => c.textContent.includes('倒數'));
      ok('過完的不上總覽（整張卡就不畫）', !card2, card2 ? card2.textContent.slice(0, 60) : '');

      await tab('agenda'); await sleep(250);
      ok('但過完的還留在清單上',
         q('#countdown-list').textContent.includes('去年的期末考'),
         q('#countdown-list').textContent.slice(0, 80));

      // 刪掉要給得回來——跟總覽的 ✕ 同一個道理
      q('#countdown-list .countdown-row').click(); await sleep(220);
      q('#cd-delete').click(); await sleep(300);
      ok('刪得掉', Countdown.data.items.length === 0);
      const undo = q('#toast .toast-btn');
      ok('刪掉有得復原', !!undo && undo.textContent === '復原',
         undo ? undo.textContent : '沒有復原鍵');
      if (undo) {
        undo.click(); await sleep(300);
        ok('按復原就回來了', Countdown.data.items.length === 1,
           JSON.stringify(Countdown.data.items));
      }

      Countdown.data.items = keep;
      Countdown.save(); Countdown.render(); Overview.render(); await sleep(200);
    }

    // ── 便利貼：貼得上去 ──
    await tab('wall');
    q('#add-sticky').click(); await sleep(260);
    ok('便利貼貼得上去', Wall.data.notes.length === 1);
    ok('便利貼畫得出來', !!document.querySelector('.wall .sticky'));

    // ── 排版：同一排的卡片要等高 ──
    await tab('money');
    await sleep(200);
    const rows = {};
    for (const c of document.querySelectorAll('#panel-money .card')) {
      const r = c.getBoundingClientRect();
      (rows[Math.round(r.y)] ??= []).push(Math.round(r.height));
    }
    const bad = Object.entries(rows).filter(([, hs]) => new Set(hs).size > 1);
    ok('同一排的卡片等高', bad.length === 0,
       bad.map(([y, hs]) => y + 'px:' + hs.join('/')).join(' '));

    // ── 頂欄不能塌（.bar 撞名那次就是這樣壞的）──
    const bar = document.querySelector('.topbar').getBoundingClientRect();
    ok('頂欄寬度正常', bar.width > 600, Math.round(bar.width) + 'px');
    const brand = document.querySelector('.brand').getBoundingClientRect();
    ok('品牌沒有被擠成直排', brand.height < 40, Math.round(brand.height) + 'px 高');

    // ── 安全區（瀏海）──
    // env() 在桌機上解析成 0px，所以這裡驗不到瀏海本身，
    // 驗的是**它沒有把桌機的留白弄不見**：少寫 fallback 的話
    // 整條 calc() 會失效，padding 直接歸零，手機修好、電腦壞掉。
    const mainPad = getComputedStyle(document.querySelector('main'));
    ok('main 左右留白沒被 env() 吃掉',
       parseFloat(mainPad.paddingLeft) >= 14, mainPad.paddingLeft);
    ok('main 下方留白沒被 env() 吃掉',
       parseFloat(mainPad.paddingBottom) >= 60, mainPad.paddingBottom);
    const footPad = getComputedStyle(document.querySelector('.foot'));
    ok('頁尾留白沒被 env() 吃掉',
       parseFloat(footPad.paddingLeft) >= 14 && parseFloat(footPad.paddingBottom) >= 22,
       footPad.paddingLeft + ' / ' + footPad.paddingBottom);
    // 不要在這支注入腳本裡寫 '\\n' 這種跳脫——PROBE 是樣板字串，
    // 跳脫會先被求值成真的換行，注進去就是「引號裡有換行」的語法錯誤，
    // 而且整段檢查會靜靜不跑，只留下 1/1 過。（剛剛就踩了一次。）
    // ── 小克的區塊 ──
    const keCard = [...document.querySelectorAll('#overview-grid .card')]
        .find(c => c.querySelector('h2 .label')?.textContent === '小克');
    ok('本機模式看得到小克那塊', !!keCard);
    if (keCard) {
        const pcts = [...keCard.querySelectorAll('.ke-pct')].map(e => e.textContent);
        ok('兩個額度都畫出來了', pcts.join(',') === '42%,91%', pcts.join(',') || '沒有');
        ok('91% 會轉成紅色的警示',
           keCard.querySelector('.ke-pct.alert')?.textContent === '91%');
        ok('42% 不會被誤標成警示',
           !keCard.querySelector('.ke-row .ke-pct.alert + *') &&
           [...keCard.querySelectorAll('.ke-pct')][0].className.trim() === 'ke-pct');
        ok('有寫重置時間', !!keCard.querySelector('.ke-reset'));
        ok('有帶到板子那句話',
           keCard.querySelector('.ke-line')?.textContent === '測試用的一句話。');
        const fill = keCard.querySelector('.ke-fill');
        ok('進度條寬度跟著百分比', fill && fill.style.width === '42%', fill?.style.width);
    }

    // **這條最重要**：展示模式（GitHub Pages）不可以出現小克那塊。
    // 別人打開作品集不該看到她的私人東西，也不該看到一塊看不懂的卡片。
    const realMode = Store.mode;
    const sandbox = document.createElement('div');
    Store.mode = 'demo';
    Ke.render(sandbox);
    ok('展示模式完全不畫小克那塊', sandbox.childElementCount === 0,
       sandbox.childElementCount + ' 個元素');
    Store.mode = realMode;

    const headerRule = [...document.styleSheets]
        .flatMap(sh => { try { return [...sh.cssRules] } catch { return [] } })
        .find(r => r.selectorText === 'header'
                && r.style.getPropertyValue('padding-top').includes('safe-area-inset-top'));
    ok('頂欄有讓開瀏海的規則', !!headerRule,
       headerRule ? headerRule.style.getPropertyValue('padding-top') : '沒有');

    // ── 期間 ──
    // 她要「可以看月或週或是年，可以自訂」。
    ok('現在這一段時「下一段」是停用的——未來還沒發生',
       q('#month-nav button[aria-label=\"下一段\"]').disabled);
    ok('五種粒度都在（日週月年自訂）',
       document.querySelectorAll('#month-nav .range-kinds .view-btn').length === 5,
       [...document.querySelectorAll('#month-nav .range-kinds .view-btn')]
           .map(b => b.textContent).join(''));

    {
      const kinds = [...document.querySelectorAll('#month-nav .range-kinds .view-btn')];
      const byName = n => kinds.find(b => b.textContent === n);

      /* 「日」。她的原話：「自訂時間下去看可以增加一天嗎，
         想要一天的總花費可以飆出來」。 */
      byName('日').click(); await sleep(250);
      ok('切到日', Money.range.kind === 'day');
      ok('一天的開始和結束是同一天',
         Money.range.start === Money.range.end, Money.range.start);
      ok('一天的標題寫得出星期幾',
         /（[日一二三四五六]）/.test(q('#month-nav .month-label').textContent),
         q('#month-nav .month-label').textContent);
      ok('翻上一天真的只退一天', (() => {
        const before = Money.range.start;
        Money.shiftRange(-1);
        const diff = (parseYmd(before) - parseYmd(Money.range.start)) / 86400000;
        Money.shiftRange(1);
        return diff === 1;
      })());
      // **一天的主角是支出。** 一天幾乎不會有收入，淨額只是支出換一個
      // 比較難讀的寫法——她要的是「這一天總共花多少」自己站出來。
      ok('看一天的時候大字寫的是花掉的，不是收支相抵',
         q('#month-summary .sub').textContent.includes('花掉的'),
         q('#month-summary').textContent.slice(0, 50));
      ok('看一天的時候卡片標題跟著變',
         q('#month-card-title').textContent === '今天',
         q('#month-card-title').textContent);

      byName('週').click(); await sleep(250);
      ok('切到週', Money.range.kind === 'week');
      ok('週的標題不是「這個月」',
         !q('#month-nav .month-label').textContent.includes('月份'),
         q('#month-nav .month-label').textContent);
      ok('週的第一天是星期日',
         parseYmd(Money.range.start).getDay() === 0, Money.range.start);

      byName('年').click(); await sleep(250);
      ok('切到年', Money.range.kind === 'year');
      ok('年是從一月一號開始', Money.range.start.endsWith('-01-01'), Money.range.start);

      // 預算是按月的，看年的時候要講清楚看的是哪個月，不能拿一年的花費比月預算
      ok('非月粒度時預算有講清楚是哪個月',
         q('#budgets').textContent.includes('預算是按月算的')
         || q('#budgets').textContent.includes('還沒設預算'),
         q('#budgets').textContent.slice(0, 40));

      byName('自訂').click(); await sleep(250);
      ok('切到自訂', Money.range.kind === 'custom');
      ok('自訂有兩個日期欄',
         document.querySelectorAll('#month-nav .custom-range input').length === 2);
      ok('自訂的時候不給翻頁——翻到哪都不會是她要的',
         !q('#month-nav button[aria-label=\"下一段\"]'));

      // 開始比結束晚要自己調回來，不要留一段不存在的期間
      const inputs = [...document.querySelectorAll('#month-nav .custom-range input')];
      inputs[0].value = '2027-01-01';
      inputs[0].dispatchEvent(new Event('change'));
      await sleep(250);
      ok('開始比結束晚會自己調回來', Money.range.end >= Money.range.start,
         Money.range.start + ' → ' + Money.range.end);

      byName('月').click(); await sleep(250);
      Money.setRange('month', todayStr()); await sleep(200);
      ok('回得到這個月', Money.range.kind === 'month' && Range.hasToday(Money.range));
    }

    /* ── 圓餅底下的分類點得進去 ──
     *
     * 她的原話：「圓餅圖下面的分類可以直接點進去看」。
     * 「餐飲 3,240」自己回答不了「那到底是哪幾餐」。
     */
    {
      await tab('money');
      const keep = JSON.stringify(Money.data);
      const today = new Date().toISOString().slice(0, 10);
      const cat = Money.data.categories.expense[0].name;
      const other = Money.data.categories.expense[1].name;

      Money.data.accounts = [{ id: 'cc1', name: '甲', kind: 'cash', opening: 9999,
                               includeInTotal: true, order: 0 }];
      Money.data.transactions = [
        { id: 'cc-t1', date: today, kind: 'expense', amount: 155, category: cat,
          account: '甲', note: '滷肉飯' },
        { id: 'cc-t2', date: today, kind: 'expense', amount: 60, category: cat,
          account: '甲', note: '紅茶' },
        { id: 'cc-t3', date: today, kind: 'expense', amount: 30, category: other,
          account: '甲', note: '公車' },
      ];
      Money.save(); Money.setRange('month', today); await sleep(260);

      const rows = () => [...document.querySelectorAll('#by-category .cat-row')];
      ok('分類那幾列看得出可以點',
         rows().length > 0 && rows().every(r => r.classList.contains('tappable')),
         rows().length + ' 列');

      const first = rows().find(r => r.textContent.includes(cat));
      ok('點得到第一類', !!first);
      first.click(); await sleep(240);

      const detail = q('#by-category .cat-detail');
      ok('點下去攤得開', !!detail);
      ok('攤開的是這一類的每一筆',
         !!detail && detail.textContent.includes('滷肉飯')
         && detail.textContent.includes('紅茶'),
         detail ? detail.textContent.slice(0, 60) : '');
      // 攤開的只能是這一類。混進別類的話「點進去看」就沒有意義了
      ok('別類的不會混進來',
         !!detail && !detail.textContent.includes('公車'),
         detail ? detail.textContent.slice(0, 60) : '');

      ok('攤開的那一筆點得進去改', (() => {
        const row = detail && detail.querySelector('.txn-row');
        if (!row) return false;
        row.click();
        const open = q('#dlg-txn').open;
        if (open) q('#dlg-txn').close();
        return open;
      })());

      await sleep(200);
      const again = [...document.querySelectorAll('#by-category .cat-row')]
        .find(r => r.textContent.includes(cat));
      again.click(); await sleep(240);
      ok('再點一次收回去', !q('#by-category .cat-detail'));

      // 換到看一天的時候，那一類在這一段沒花過就不該留著一塊空白
      const rowCat = [...document.querySelectorAll('#by-category .cat-row')]
        .find(r => r.textContent.includes(cat));
      rowCat.click(); await sleep(200);
      Money.setRange('day', '2019-01-01'); await sleep(260);
      ok('換到沒有帳的期間，攤開的那一類自己收起來',
         Money.openCategory === null, String(Money.openCategory));

      Money.setRange('month', today); await sleep(200);
      Money.data = JSON.parse(keep);
      Money.save(); Money.render(); Overview.render(); await sleep(200);
    }

    /* ── 總覽：今天的收支和這個月合併成一張 ──
     *
     * 她的原話：「今天的收支跟這個月的卡片合併，還有平均每天可用
     * 那邊可以直接放在今天收支旁邊用小字標出來就好」。
     */
    {
      await tab('money');
      const keep = JSON.stringify(Money.data);
      const keepOff = Prefs.data.overviewOff;
      Prefs.data.overviewOff = null;      // 回到預設那一組
      const today = new Date().toISOString().slice(0, 10);
      const cat = Money.data.categories.expense[0].name;

      Money.data.accounts = [{ id: 'mg1', name: '甲', kind: 'cash', opening: 9999,
                               includeInTotal: true, order: 0 }];
      Money.data.transactions = [
        { id: 'mg-t1', date: today, kind: 'expense', amount: 155, category: cat,
          account: '甲', note: '午餐' },
      ];
      Money.data.totalBudgets = [{ limit: 30000 }];
      Money.data.budgets = [];
      Money.data.dailyBudgets = [];
      Money.data.dailyTotal = null;
      Money.save(); Overview.render(); await tab('overview'); await sleep(300);

      const cards = () => [...document.querySelectorAll('#overview-grid .card')];
      const todayCard = cards().find(c => c.textContent.includes('今天的收支'));
      ok('總覽上還有「今天的收支」', !!todayCard);
      ok('「這個月」不再是自己一張卡',
         !cards().some(c => c.querySelector('h2 .label')
                            && c.querySelector('h2 .label').textContent.trim() === '這個月'),
         cards().map(c => c.querySelector('h2 .label')
                          ? c.querySelector('h2 .label').textContent.trim() : '?').join('／'));
      ok('月結併進今天那張卡的底下',
         !!todayCard && !!todayCard.querySelector('.month-foot')
         && todayCard.querySelector('.month-foot').textContent.includes('這個月'),
         todayCard ? todayCard.textContent.slice(-60) : '');
      ok('併進去之後還進得去報表',
         !!todayCard && [...todayCard.querySelectorAll('button')]
             .some(b => b.textContent === '看報表'));

      // 「今天可以用」貼在支出旁邊，小字，而且在同一排
      const note = todayCard && todayCard.querySelector('.quota-note');
      ok('今天可以用多少貼在支出旁邊', !!note,
         todayCard ? todayCard.textContent.slice(0, 70) : '');
      ok('它跟支出在同一排，不是另起一行',
         !!note && note.closest('.today-flow') !== null);
      ok('它比支出的數字小一號', (() => {
        if (!note) return false;
        const big = todayCard.querySelector('.today-num');
        return parseFloat(getComputedStyle(note).fontSize)
             < parseFloat(getComputedStyle(big).fontSize);
      })());

      // 合併之後「今天的預算」那張不再預設出現，不然同一個數字講兩次
      ok('「今天的預算」不再預設出現',
         !cards().some(c => c.textContent.includes('今天的預算')),
         cards().length + ' 張');
      ok('但排版裡還找得回來',
         Overview.CARDS.some(c => c.id === 'todaybudget'));

      // 一筆都沒記的時候額度還是要看得到——那正是還沒花之前最想知道的
      Money.data.transactions = [];
      Money.save(); Overview.render(); await sleep(280);
      const empty = cards().find(c => c.textContent.includes('今天的收支'));
      ok('還沒記帳的時候也看得到今天可以用多少',
         !!empty && !!empty.querySelector('.quota-note'),
         empty ? empty.textContent.slice(0, 70) : '');

      // 沒設預算就不要印一個永遠是破折號的欄位
      Money.data.totalBudgets = [];
      Money.save(); Overview.render(); await sleep(280);
      const noBudget = cards().find(c => c.textContent.includes('今天的收支'));
      ok('沒設預算的時候不印空額度',
         !!noBudget && !noBudget.querySelector('.quota-note'),
         noBudget ? noBudget.textContent.slice(0, 70) : '');

      Money.data = JSON.parse(keep);
      Prefs.data.overviewOff = keepOff;
      Money.save(); Money.render(); Overview.render(); await sleep(200);
      await tab('money');
    }

    // ── 主題色 ──
    const root = document.documentElement;
    Prefs.setAccent('#7FB4E8');
    await sleep(120);
    ok('主題色換得掉',
       getComputedStyle(root).getPropertyValue('--accent').trim().toLowerCase() === '#7fb4e8',
       getComputedStyle(root).getPropertyValue('--accent').trim());
    // #7FB4E8 配深字的對比度是 6.3，配淺字只有 1.9——所以答案是深字。
    // （用「亮度 > 0.45」那種門檻的話這裡會挑錯，因為它的亮度只有 0.43。）
    ok('中間調的主題色會挑對比度高的那個字色',
       getComputedStyle(root).getPropertyValue('--on-accent').trim() === '#21331F',
       getComputedStyle(root).getPropertyValue('--on-accent').trim());
    // 這條是重點：主色按鈕的文字色寫死深字的話，深色主題色會整顆糊掉
    Prefs.setAccent('#3A2E5F');
    await sleep(100);
    ok('暗色主題色會自動改成淺字',
       getComputedStyle(root).getPropertyValue('--on-accent').trim() === '#F2EFE4',
       getComputedStyle(root).getPropertyValue('--on-accent').trim());
    // ── 主題 ──
    // 第一版只換 --accent 一個變數，換完幾乎看不出差別（她的原話：
    // 「有跟沒有一樣」）。所以這裡驗的是**整組配色真的都換掉了**。
    ok('主題不只一個', THEMES.length >= 6, THEMES.length + ' 個');
    {
      const read = () => ['--bg', '--card', '--raised', '--separator',
                          '--text', '--text-2', '--text-3', '--accent',
                          '--water', '--heart', '--lime']
          .map(k => getComputedStyle(root).getPropertyValue(k).trim());
      Prefs.setTheme('starcal'); await sleep(160);
      const a = read();
      Prefs.setTheme('midnight'); await sleep(200);
      const b = read();
      const changed = a.filter((v, i) => v !== b[i]).length;
      ok('換主題會換掉整組配色，不是只換主色', changed >= 10,
         changed + '/' + a.length + ' 個變數變了');
      ok('背景真的變了', a[0] !== b[0], a[0] + ' → ' + b[0]);
    }

    // 亮色主題要標得出來，不然陰影、backdrop 那些沒辦法跟著變淡
    Prefs.setTheme('paper'); await sleep(200);
    ok('亮色主題會標上 data-theme=light', root.dataset.theme === 'light',
       root.dataset.theme);
    ok('亮色主題的陰影有跟著變淡',
       getComputedStyle(root).getPropertyValue('--shadow-1').includes('60, 55, 40'),
       getComputedStyle(root).getPropertyValue('--shadow-1').trim());

    // **每一個主題的每一組配色都要驗。** 挑一個看起來對就放行的話，
    // 亮色主題上那些為深底調的粉彩會淡到看不見——「換個主題就有一半
    // 的東西不見了」比不給換更糟。
    {
      const bad = [];
      for (const t of THEMES) {
        const v = t.vars;
        const check = (name, fg, bg, min) => {
          const r = contrast(fg, bg);
          // 不要在這支注入腳本裡用反引號和樣板字串——PROBE 是外面那層的
          // 樣板字串，會先被求值掉。用加號串接。
          if (r < min) bad.push(t.name + '/' + name + ' ' + r.toFixed(1) + '<' + min);
        };
        check('內文', v['--text'], v['--bg'], 7);
        check('次要字', v['--text-2'], v['--card'], 3.5);
        check('提示字', v['--text-3'], v['--card'], 2.6);
        check('主色', v['--accent'], v['--bg'], 3);
        for (const k of ['--money', '--memo', '--water', '--sleep',
                         '--heart', '--lime', '--calendar',
                         '--good', '--warn', '--alert']) {
          check(k.slice(2), v[k], v['--card'], 2.8);
        }
      }
      ok('每個主題的每一種顏色都讀得到', bad.length === 0, bad.join('、'));
    }

    // 磨砂玻璃
    Prefs.setGlass(true); await sleep(200);
    ok('開了磨砂玻璃會標在根元素上', root.dataset.glass === 'on');
    {
      const card = q('#overview-grid .card') || q('.card');
      const bf = getComputedStyle(card).backdropFilter
              || getComputedStyle(card).webkitBackdropFilter;
      ok('玻璃真的套到卡片上', /blur/.test(bf || ''), bf || '(沒有)');
      // computed 值可能是 rgba(...) 也可能是 color(srgb ... / a)，
      // 比字串前綴會漏。直接把 alpha 撈出來看。
      const bgc = getComputedStyle(card).backgroundColor;
      // **正則裡不要出現斜線。** PROBE 是外面那層的樣板字串，
      // 反斜線會先被吃掉一層，未跳脫的 / 會把正則字面量提前結束
      // → SyntaxError → 整段檢查一行都不跑，而且靜靜地不跑。
      const nums = bgc.match(/[0-9.]+/g) || [];
      const alpha = nums.length >= 4 ? Number(nums[nums.length - 1]) : 1;
      ok('玻璃模式下卡片是半透明的', alpha > 0 && alpha < 1, bgc);
      // 背後要有東西可以透，不然模糊等於沒做。
      // **不能靠 computed opacity 判斷**——那個有 .3s 的淡入，而
      // headless 的 virtual-time 模式下 transition 不一定會推進，
      // 讀到的永遠是起點 0。改成驗「光暈畫了什麼」加「規則在不在」。
      const glow = getComputedStyle(document.body, '::before').backgroundImage;
      ok('背後畫了幾團色光', /gradient/.test(glow), glow.slice(0, 46));
      const allRules = [...document.styleSheets]
          .flatMap(sh => { try { return [...sh.cssRules] } catch { return [] } });
      ok('開玻璃的時候那幾團光會亮起來',
         allRules.some(r => r.selectorText
            && r.selectorText.includes('data-glass="on"')
            && r.selectorText.includes('body::before')));
    }
    Prefs.setGlass(false); await sleep(180);
    ok('關得掉', root.dataset.glass === 'off');
    Prefs.setTheme('starcal'); await sleep(180);

    // 八個預設色**每一個都要驗**，不是抽一個看起來對就算。
    // 4.5 是 WCAG AA 給一般文字的門檻。
    const badAccent = [];
    for (const a of ACCENTS) {
      Prefs.setAccent(a.c);
      const on = getComputedStyle(root).getPropertyValue('--on-accent').trim();
      const r = contrast(a.c, on);
      if (r < 4.5) badAccent.push(a.name + ' ' + r.toFixed(1));
    }
    ok('八個預設主題色的按鈕文字都讀得到', badAccent.length === 0,
       badAccent.join('、'));

    Prefs.setAccent('#F9D984');
    await sleep(100);
    ok('主題色存進資料裡', Prefs.data.accent === '#F9D984');

    q('#appearance').click(); await sleep(180);
    ok('外觀視窗開得起來', q('#dlg-appearance').open);
    ok('外觀視窗有一排色票',
       document.querySelectorAll('#appearance-body .accent').length >= 6,
       document.querySelectorAll('#appearance-body .accent').length + ' 個');
    ok('外觀視窗有自訂顏色',
       !!q('#appearance-body input[type=color]'));
    q('#dlg-appearance button[value=\"close\"]').click(); await sleep(150);
    ok('外觀視窗關得掉', !q('#dlg-appearance').open);

    // ── 分類 ──
    await tab('agenda');
    ok('全新資料有預設分類', Prefs.labels().length > 0, Prefs.labels().length + ' 類');
    // 「從來沒有過」和「自己刪光了」是兩件事。本來在用的人資料裡沒有
    // labels，補；她自己刪光之後就不要再長回來。
    ok('補過預設分類會留下記號', Prefs.data.labelsSeeded === true);
    {
      const keep = Prefs.data.labels;
      Prefs.data.labels = [];
      await Prefs.init();
      ok('刪光之後不會自己長回來', Prefs.labels().length === 0,
         Prefs.labels().length + ' 類');
      Prefs.data.labels = keep;
      Prefs.save();
    }
    ok('分類篩選列畫得出來',
       document.querySelectorAll('#agenda-tools .chip').length >= Prefs.labels().length + 1);
    ok('四個檢視的切換鈕都在（時間線／月曆／課表／做完的）',
       document.querySelectorAll('#agenda-tools .view-btn').length === 4,
       [...document.querySelectorAll('#agenda-tools .view-btn')]
         .map(b => b.textContent).join('、'));

    const lid = Prefs.labels()[0].id;
    const lid2 = Prefs.labels()[1].id;
    q('#add-event').click(); await sleep(160);
    ok('加行程有分類可選',
       document.querySelectorAll('#e-label option').length === Prefs.labels().length + 1);
    q('#e-title').value = '分類測試行程';
    q('#e-label').value = lid;
    q('#e-save').click(); await sleep(300);
    const tagged = Cal.data.events.find(e => e.title === '分類測試行程');
    ok('行程的分類存得起來', tagged && tagged.label === lid);
    ok('時間線上看得到分類色點', !!q('#agenda-list .event-row .label-dot'));

    Agenda.filter = lid2; Agenda.render(); await sleep(220);
    ok('篩到別的分類就看不到它', !q('#agenda-list').textContent.includes('分類測試行程'));
    Agenda.filter = lid; Agenda.render(); await sleep(220);
    ok('篩回自己的分類就看得到', q('#agenda-list').textContent.includes('分類測試行程'));

    // **總覽是全貌，不該被別的分頁上的篩選改掉。**
    Overview.render(); await sleep(150);
    const heroAll = Agenda.overdue(true).todos.length + Agenda.overdue(true).events.length;
    const heroFiltered = Agenda.overdue().todos.length + Agenda.overdue().events.length;
    ok('總覽算過期時不吃分類篩選', heroAll >= heroFiltered, heroAll + ' vs ' + heroFiltered);
    Agenda.filter = null; Agenda.render(); await sleep(150);

    // 分類刪掉之後，指到它的行程要放掉那個 id——留著的話那件事
    // 會永遠指向一個不存在的分類，篩選查不到，看起來像資料不見了
    q('#manage-labels').click(); await sleep(220);
    ok('分類視窗開得起來', q('#dlg-labels').open);
    const lrows = document.querySelectorAll('#label-editor .label-edit-row');
    ok('分類視窗列得出每一個分類', lrows.length === Prefs.labels().length,
       lrows.length + ' 列');
    const nameInput = lrows[0].querySelector('input:not([type=color])');
    nameInput.value = '';
    nameInput.dispatchEvent(new Event('input'));
    q('#l-save').click(); await sleep(340);
    ok('名字留白的分類存檔時會被丟掉', !Prefs.labels().some(l => l.id === lid));
    ok('指到被刪分類的行程會放掉那個 id',
       Cal.data.events.find(e => e.title === '分類測試行程').label === null);

    // ── 月曆 ──
    Agenda.view = 'month'; Agenda.render(); await sleep(280);
    ok('月曆切得過去', !q('#calendar').hidden && q('#agenda-list').hidden);
    const cells = document.querySelectorAll('#calendar .cal-cell');
    ok('月曆格子補滿整週', cells.length > 0 && cells.length % 7 === 0, cells.length + ' 格');
    ok('月曆標得出今天', !!q('#calendar .cal-cell.today'));
    ok('月曆底下有選中那天的內容', !!q('#calendar .cal-day'));
    ok('今天那格列得出剛剛那個行程',
       q('#calendar .cal-day').textContent.includes('分類測試行程'));
    // 格子裡的事要能直接點開來改。原本要先點格子選日期、再到底下的清單裡
    // 找同一件事點第二次——眼睛已經看到它了，卻不能直接動它。
    {
      const item = q('#calendar .cal-cell.today .cal-item');
      ok('格子裡的事是可以點的', !!item && item.tagName === 'BUTTON',
         item ? item.tagName : '找不到');
      if (item) {
        item.click(); await sleep(280);
        ok('點格子裡的事直接開編輯', q('#dlg-event').open || q('#dlg-todo').open);
        (q('#dlg-event').open ? q('#dlg-event') : q('#dlg-todo'))
          .querySelector('button[value=\"cancel\"]').click();
        await sleep(200);
      }
      // 「更明顯」＝ 分類顏色要是一條看得到的線，不是 8px 的小圓點
      ok('格子裡的事有分類顏色的線',
         !!item && parseFloat(getComputedStyle(item).borderLeftWidth) >= 3,
         item ? getComputedStyle(item).borderLeftWidth : '');
      ok('格子右上角有「在這天加」', !!q('#calendar .cal-cell .cal-add'));
    }

    const other = [...cells].find(c => !c.classList.contains('picked')
                                    && !c.classList.contains('outside')
                                    && !c.classList.contains('today'));
    if (other) {
      other.click(); await sleep(280);
      ok('點別天會換掉底下的內容',
         !q('#calendar .cal-day').textContent.includes('分類測試行程'));
    } else ok('點別天會換掉底下的內容', false, '找不到別的格子');
    MonthView.shift(1); await sleep(260);
    // 篩了某一個分類，月曆格子要把那一類的課整堂寫出來。
    // 她的原話是「比如我按學校 就可以完全顯示課表」——篩選之後
    // 格子裡只剩那一類，量少了就有空間。
    {
      const before = document.querySelectorAll('#calendar .cal-item.cls').length;
      ok('沒篩選的時候課只寫「N 堂課」', before === 0,
         before + ' 個');
      const label = Prefs.labels()[0];
      if (label) {
        Agenda.filter = label.id;
        Agenda.render(); await sleep(280);
        ok('篩了分類之後月曆上寫得出課名',
           document.querySelectorAll('#calendar .cal-item.cls').length > 0
           || !Timetable.slots().some(k => k.label === label.id),
           document.querySelectorAll('#calendar .cal-item.cls').length + ' 堂');
        Agenda.filter = null;
        Agenda.render(); await sleep(220);
      }
    }

    ok('翻得到下個月', MonthView.ym !== thisMonth());
    MonthView.today(); await sleep(220);
    ok('回得到這個月', MonthView.ym === thisMonth());

    // ── 快速排班 ──
    //
    // 打工的班每週都不一樣，塞不進課表；一天一天加行程又要開七次對話框。
    // 這裡驗的是「選一個班別，點日期就排上去」。
    {
        const shiftBtn = () => [...document.querySelectorAll('#calendar .month-nav button')]
            .find(b => b.textContent === '排班' || b.textContent === '排完了');

        ok('月曆上有排班鈕', !!shiftBtn());
        shiftBtn().click(); await sleep(240);
        ok('進得了排班模式', MonthView.shiftMode && !!q('.shift-bar'));
        ok('還沒有班別時會說先開一個',
           q('.shift-hint').textContent.includes('先開一個'), q('.shift-hint').textContent);

        // 沒有班別就點日期 → 直接開建立視窗，不是靜靜地沒反應
        q('#calendar .cal-cell').click(); await sleep(240);
        ok('沒有班別時點日期會開建立視窗', q('#dlg-shift').open);

        q('#sf-name').value = '打工晚班';
        q('#sf-time').value = '18:00';
        q('#sf-end').value = '22:00';
        q('#sf-save').click(); await sleep(300);
        ok('班別建得起來', Cal.shifts().length === 1, JSON.stringify(Cal.shifts()[0] || {}));
        ok('建完自動選中它', MonthView.pickedShift === Cal.shifts()[0].id);
        ok('班別膠囊上寫得出時間',
           q('.shift-chip.on').textContent.includes('18:00'), q('.shift-chip.on').textContent);

        // 排三天
        const cells = [...document.querySelectorAll('#calendar .cal-cell:not(.outside)')];
        const before = Cal.data.events.length;
        cells[10].click(); await sleep(200);
        cells[11].click(); await sleep(200);
        cells[12].click(); await sleep(200);
        ok('點三天就排了三天', Cal.data.events.length === before + 3,
           String(Cal.data.events.length - before));

        const made = Cal.data.events.filter(e => e.shift);
        ok('排出來的就是行程', made.length === 3);
        ok('時間跟著班別走',
           made.every(e => e.time === '18:00' && e.endTime === '22:00'));
        ok('標題就是班別名字', made.every(e => e.title === '打工晚班'));

        // 排了班的日子要看得出來，不然整個月的格子長得一樣
        await sleep(150);
        ok('排到的日子在月曆上標起來',
           document.querySelectorAll('#calendar .cal-cell.shift-on').length === 3,
           String(document.querySelectorAll('#calendar .cal-cell.shift-on').length));

        // 同一天再點一次是取消，不是排兩次
        const day = made[0].date;
        const cellAgain = [...document.querySelectorAll('#calendar .cal-cell:not(.outside)')][10];
        cellAgain.click(); await sleep(240);
        ok('再點一次是取消', !Cal.hasShift(day, MonthView.pickedShift));
        ok('取消之後剩兩天', Cal.data.events.filter(e => e.shift).length === 2);

        // 排出去的班要出現在時間線上
        MonthView.shiftMode = false;
        Agenda.view = 'timeline'; Agenda.render(); await sleep(260);
        ok('排出去的班出現在時間線上',
           q('#agenda-list').textContent.includes('打工晚班'));

        // 刪掉班別，已經排出去的班要留著——刪班別是「以後不用這個樣板」，
        // 不是「我上個月沒去上班」
        const shiftId = Cal.shifts()[0].id;
        Cal.removeShift(shiftId);
        ok('班別拿得掉', Cal.shifts().length === 0);
        ok('已經排出去的班留著', Cal.data.events.filter(e => e.shift === shiftId).length === 2);

        /* ── 收起來的班，月曆上的點點要留著 ──
         *
         * 她的原話：「我希望工作的部分過了之後點點不要消失」。
         *
         * 收起來回答的是「這件事不用再理了」，不是「這件事沒發生過」。
         * 月曆問的是後者——她月底翻月曆是要看「這個月上了哪幾天班」，
         * 拿掉的話那幾天會變成空的，看起來像自己沒排到班。
         */
        {
            Agenda.view = 'month'; Agenda.render(); await sleep(240);
            const shifts = Cal.data.events.filter(e => e.shift);
            const day = shifts[0].date;

            const cellOf = d => [...document.querySelectorAll('#calendar .cal-cell')]
                .find(c => c.getAttribute('aria-label')
                        && c.querySelector('.cal-n')
                        && c.querySelector('.cal-n').textContent
                           === String(Number(d.slice(8))));

            const dotsBefore = cellOf(day).querySelectorAll('.cal-dots .label-dot').length;
            ok('排了班的那天有點點', dotsBefore > 0, String(dotsBefore));

            // 收起來（過期那區按✓、或「清掉過去的行程」走的都是這一支）
            Agenda.doneWithEvent(shifts[0]);
            await sleep(300);
            Agenda.view = 'month'; Agenda.render(); await sleep(260);

            const cell = cellOf(day);
            const dots = cell.querySelectorAll('.cal-dots .label-dot');
            ok('收起來之後點點還在', dots.length === dotsBefore,
               dots.length + ' vs ' + dotsBefore);
            ok('收起來的點畫成空心，看得出跟還沒處理的不一樣',
               cell.querySelectorAll('.cal-dots .label-dot.gone').length === 1,
               cell.querySelector('.cal-dots').className);

            // 桌機格子裡那一列也要留著，而且劃掉
            ok('桌機格子裡那一列也留著',
               [...cell.querySelectorAll('.cal-item')]
                   .some(x => x.textContent.includes('打工晚班')),
               cell.textContent.slice(0, 40));
            ok('留著的那一列看得出是收起來的',
               !!cell.querySelector('.cal-item.done'));

            // 點進那天要看得到它，而且放得回去——格子裡有點、
            // 點進去卻寫「這天沒有排事」的話，那個點會變成一個查不出來的疑問
            cell.click(); await sleep(260);
            const panel = q('#calendar .cal-day');
            ok('點進那天看得到收起來的那件',
               panel.textContent.includes('打工晚班'), panel.textContent.slice(0, 60));
            const back = [...panel.querySelectorAll('button')]
                .find(b => b.textContent === '放回去');
            ok('收起來的那件放得回去', !!back);

            back.click(); await sleep(300);
            ok('放回去之後真的回來了',
               !Cal.data.events.find(e => e.id === shifts[0].id).done);

            // **時間線不該跟著改。** 「接下來」不列已經過完的事是刻意的
            // （她的原話：「為什麼已經過時間的行程還在我的接下來」）。
            Agenda.doneWithEvent(shifts[0]);
            await sleep(200);
            // 比的是那一天，不是標題——同一個班別排了好幾天，
            // 用標題找會被別天的那筆騙過去（第一次寫就是這樣自己騙自己的）
            ok('時間線拿到的那一份不含收起來的',
               Agenda.eventsOn(day).every(e => e.id !== shifts[0].id),
               Agenda.eventsOn(day).length + ' 件');
            ok('月曆拿到的那一份含收起來的',
               Agenda.eventsOnWithDone(day).some(e => e.id === shifts[0].id));
            ok('收起來的排在最後，不會把還要做的擠掉',
               Agenda.eventsOnWithDone(day).findIndex(e => e.done)
               === Agenda.eventsOnWithDone(day).filter(e => !e.done).length);
        }

        // 收拾
        Cal.data.events = Cal.data.events.filter(e => !e.shift);
        Cal.save();
        MonthView.pickedShift = null;
        Agenda.view = 'month'; Agenda.render(); await sleep(220);
    }

    // ── 課表 ──
    Agenda.view = 'class'; Agenda.render(); await sleep(240);
    ok('課表切得過去', !q('#timetable').hidden);
    ok('還沒有課表時給的是空狀態不是空白',
       q('#timetable').textContent.includes('還沒有課表'));

    const pick = t => [...document.querySelectorAll('#timetable button')]
        .find(b => b.textContent === t);
    pick('新的課表').click(); await sleep(200);
    ok('新課表視窗開得起來', q('#dlg-set').open);
    q('#p-name').value = '115 上';
    q('#p-save').click(); await sleep(340);
    ok('課表建得起來', Timetable.data.sets.length === 1);
    ok('新建的課表自動變成使用中', Timetable.active().name === '115 上');

    ok('新課表預設是節次制', Timetable.mode() === 'period');
    ok('節次表有 0-4、中午、5-12 共 14 節',
       Timetable.periods().length === 14
       && Timetable.periods()[5].name === '中午',
       Timetable.periods().map(p => p.name).join(','));

    // 節次網格：空格要能點，而且點下去星期和節次已經填好——
    // **這是這一版的重點**。要人先按「加一堂」再從頭選一次，
    // 等於把眼睛已經看到的資訊再用手輸入一次。
    const cells0 = document.querySelectorAll('#timetable .tt-p-empty');
    ok('空的課表整面都是可以點的格子', cells0.length === 14 * 5,
       cells0.length + ' 格');
    const todayCol = Timetable.days().indexOf(new Date().getDay());
    ok('網格有五個星期欄',
       document.querySelectorAll('#timetable .tt-p-wd').length === 5);

    // 點週一第 9 節那格（節次 index 10）
    const wantDay = Timetable.days()[0];
    const target = [...cells0].find(c =>
        c.getAttribute('aria-label') === '星期' + '日一二三四五六'[wantDay] + ' 第 9 節・加一堂');
    ok('格子上寫得出是哪一天哪一節', !!target,
       target ? target.getAttribute('aria-label') : cells0[0].getAttribute('aria-label'));
    target.click(); await sleep(240);
    ok('點格子直接開加一堂', q('#dlg-slot').open);
    ok('點進來的星期已經填好', Number(q('#k-day').value) === wantDay,
       q('#k-day').value + ' vs ' + wantDay);
    ok('點進來的節次已經填好',
       Timetable.period(q('#k-from').value)?.name === '9',
       Timetable.period(q('#k-from').value)?.name);
    ok('節次制不給填時間欄', q('#k-time-fields').hidden && !q('#k-period-fields').hidden);

    q('#k-name').value = '實務專題';
    q('#k-to').value = Timetable.periods().find(p => p.name === '10').id;
    q('#k-place').value = '體教三';
    q('#k-teacher').value = '陳老師';
    q('#k-save').click(); await sleep(380);
    ok('一堂課存得進去', Timetable.slots().length === 1);
    ok('課表網格畫得出那一堂', !!q('#timetable .tt-p-slot'));
    {
      // 折疊會動到列號，所以不能比字串，要看它實際跨了幾列
      const gr = q('#timetable .tt-p-slot').style.gridRow.split('/').map(x => Number(x.trim()));
      ok('跨兩節的課在格子上真的佔兩格', gr[1] - gr[0] === 2,
         q('#timetable .tt-p-slot').style.gridRow);
    }
    ok('格子上有老師和教室',
       q('#timetable .tt-p-slot').textContent.includes('陳老師')
       && q('#timetable .tt-p-slot').textContent.includes('體教三'));
    {
      // 空格數會跟著折疊變，所以不比數量，比**有沒有疊在一起**——
      // 空格畫在課上面的話，點下去會變成新增而不是編輯
      const at = n => { const r = n.getBoundingClientRect();
                        return Math.round(r.left) + ',' + Math.round(r.top); };
      const slotAt = new Set([...document.querySelectorAll('#timetable .tt-p-slot')].map(at));
      const clash = [...document.querySelectorAll('#timetable .tt-p-empty')]
          .filter(c => slotAt.has(at(c)));
      ok('被課佔走的格子不會再畫一個空格', clash.length === 0, clash.length + ' 格重疊');
    }

    // 完全沒課的連續節次要收起來。她的課全在 9-12 節，前面九列整片空白，
    // 全部畫出來就得捲過一大片什麼都沒有的格子才看得到重點。
    ok('沒課的連續節次收成一條', !!q('#timetable .tt-p-fold'),
       document.querySelectorAll('#timetable .tt-p-fold').length + ' 條');
    {
      const before = document.querySelectorAll('#timetable .tt-p-n').length;
      q('#timetable .tt-p-fold').click(); await sleep(280);
      ok('點一下展開得回來',
         document.querySelectorAll('#timetable .tt-p-n').length > before,
         before + ' → ' + document.querySelectorAll('#timetable .tt-p-n').length);
      // 展開之後每一格還是要對齊——折疊會動到列號，最容易在這裡錯位
      const heads2 = [...document.querySelectorAll('#timetable .tt-p-wd')]
          .map(h => Math.round(h.getBoundingClientRect().left));
      const bad2 = [...document.querySelectorAll('#timetable .tt-p-slot, #timetable .tt-p-empty')]
          .filter(c => !heads2.some(x => Math.abs(x - Math.round(c.getBoundingClientRect().left)) <= 2));
      ok('展開之後每一格還是對齊的', bad2.length === 0, bad2.length + ' 格沒對齊');
      Timetable.opened.clear(); Timetable.render(); await sleep(260);
    }

    // **每一格都要真的落在它該在的星期欄。**
    // 跨節的課會讓下面幾列少一格，靠 auto-placement 的話後面的會往前補——
    // 整列往左位移一格，星期四的課看起來排在星期三。畫面依然是一張整齊的表，
    // 只是內容錯的。用實際座標對，不是看 style 字串。
    {
      const heads = [...document.querySelectorAll('#timetable .tt-p-wd')]
          .map(h => Math.round(h.getBoundingClientRect().left));
      const misplaced = [...document.querySelectorAll('#timetable .tt-p-slot, #timetable .tt-p-empty')]
          .filter(c => !heads.some(x => Math.abs(x - Math.round(c.getBoundingClientRect().left)) <= 2));
      ok('每一格都對齊它的星期欄', misplaced.length === 0,
         misplaced.length + ' 格沒對齊');
    }

    // 同步要靠 updatedAt 比新舊。**沒有時間戳的話合併會靜靜地出錯**：
    // 在網頁上改的課一律輸給手機那份，改了等於沒改。
    ok('存課的時候有寫時間戳', !!Timetable.slots()[0].updatedAt,
       Timetable.slots()[0].updatedAt || '沒有');
    // **不要用正則。** PROBE 是外面那層的樣板字串，反斜線會先被吃掉一層，
    // 今天已經因為這件事讓整段檢查靜靜不跑過一次了。
    {
      const ts = Timetable.slots()[0].updatedAt || '';
      ok('時間戳帶毫秒（跟手機那邊同一種格式）',
         ts.length === 24 && ts.endsWith('Z') && ts[ts.length - 5] === '.', ts);
    }
    ok('課表本身也有時間戳', !!Timetable.active().updatedAt);
    ok('分類有時間戳', Prefs.labels().every(l => l.updatedAt),
       Prefs.labels().map(l => l.updatedAt || '(沒有)').join(' '));

    // 節次沒設時間的時候，時間線要寫節次，不能生一個「–」出來假裝有時間
    ok('沒設節次時間就寫節次', Timetable.whenText(Timetable.slots()[0]) === '9–10 節',
       Timetable.whenText(Timetable.slots()[0]));

    // 反過來選（第 10 節到第 9 節）要自己調回來，不是丟錯誤給她
    q('#timetable .tt-p-slot').click(); await sleep(220);
    q('#k-from').value = Timetable.periods().find(p => p.name === '10').id;
    q('#k-to').value = Timetable.periods().find(p => p.name === '9').id;
    q('#k-save').click(); await sleep(320);
    ok('節次選反了會自己調回來，不是報錯',
       !q('#dlg-slot').open && Timetable.slots()[0].from === Timetable.slots()[0].to,
       Timetable.whenText(Timetable.slots()[0]));
    // 改回原來的範圍
    q('#timetable .tt-p-slot').click(); await sleep(220);
    q('#k-from').value = Timetable.periods().find(p => p.name === '9').id;
    q('#k-to').value = Timetable.periods().find(p => p.name === '10').id;
    q('#k-day').value = String(new Date().getDay());
    q('#k-save').click(); await sleep(320);

    // 設了節次時間之後，時間線就改寫時間
    Timetable.data.periods.find(p => p.name === '9').start = '16:10';
    Timetable.data.periods.find(p => p.name === '10').end = '18:00';
    Timetable.save();
    ok('設了節次時間就改寫時間',
       Timetable.whenText(Timetable.slots()[0]) === '16:10–18:00',
       Timetable.whenText(Timetable.slots()[0]));

    // 換整份課表：複製一份出來，兩份不能共用同一堂課的 id
    pick('新的課表').click(); await sleep(200);
    q('#p-name').value = '115 下';
    q('#p-copy').value = Timetable.data.sets[0].id;
    q('#p-save').click(); await sleep(360);
    ok('課表複製得出來', Timetable.data.sets.length === 2);
    ok('複製後換成新的那份', Timetable.active().name === '115 下');
    ok('複製過去的課有自己的 id，不會改一份動到兩份',
       Timetable.data.sets[0].slots[0].id !== Timetable.data.sets[1].slots[0].id);
    ok('複製過去的內容一樣',
       Timetable.data.sets[1].slots[0].name === '實務專題',
       Timetable.data.sets[1].slots[0].name);

    // 課要出現在時間線上，但比行程輕
    Agenda.view = 'timeline'; Agenda.render(); await sleep(260);
    ok('今天的課出現在時間線上', q('#agenda-list').textContent.includes('實務專題'),
       q('#agenda-list').textContent.slice(0, 60));
    ok('課那一列的樣式跟行程不一樣', !!q('#agenda-list .class-row'));

    // 課和行程要照時間混排。分批接起來的話，9:30 的考試會排在
    // 13:20 的課後面——照時間讀是這條線唯一的用途。
    const todayGroup = [...document.querySelectorAll('#agenda-list .day-group')]
        .find(g => g.querySelector('.day-name')?.textContent === '今天');
    const times = todayGroup
        ? [...todayGroup.querySelectorAll('.event-time')]
            .map(e => e.textContent.split('–')[0])
            .filter(t => /^\d/.test(t))
        : [];
    const sorted = [...times].sort();
    ok('課和行程照時間混排', times.join(',') === sorted.join(','), times.join(' → '));

    await tab('overview'); await sleep(220);
    const stats = [...document.querySelectorAll('#hero .stat')].map(x => x.textContent);
    ok('總覽有「今天的課」那格',
       stats.some(t => t.includes('今天的課')), stats.join(' | '));
    ok('總覽那句話有提到今天幾堂課',
       q('#hero').textContent.includes('1 堂課'), q('#hero').textContent.slice(0, 90));

    // ── 某一堂課在某一天的標記：這次不用上、要交什麼 ──
    //
    // 課表是每週固定的，會變的都是單次的事。寫進 slot 的話，
    // 「這週要交報告」每個禮拜都會冒出來一次。
    await tab('agenda');
    Agenda.view = 'timeline'; Agenda.render(); await sleep(260);
    {
        const today = todayStr();
        const slot = Timetable.on(today)[0];
        ok('今天有課可以標記', !!slot);

        const classRow = () => [...document.querySelectorAll('#agenda-list .class-row')]
            .find(r => r.textContent.includes(slot.name));

        classRow().click(); await sleep(250);
        ok('點課開的是標記，不是課表編輯',
           q('#dlg-class-mark').open && !q('#dlg-slot')?.open);
        ok('標記視窗寫得出是哪一天',
           /\\d+\\/\\d+/.test(q('#cm-when').textContent), q('#cm-when').textContent);
        ok('沒標記過就沒有清掉鈕', q('#cm-clear').hidden);

        // 這次不用上 ＋ 要交的東西
        q('#cm-off').checked = true;
        q('#cm-text').value = '改成線上非同步，作業下週交';
        q('#cm-save').click(); await sleep(320);

        ok('標記存進課表那份資料', Timetable.marks().length === 1);
        ok('標記綁在這一天', Timetable.markFor(slot.id, today)?.off === true);
        ok('課列標成「這次不用上」', !!classRow()?.querySelector('.class-off-tag'));
        ok('備註直接寫在課列上，不用點開',
           classRow().textContent.includes('作業下週交'));

        // 停掉的課不算進「今天幾堂」——說有 1 堂但停了，那個數字在騙人
        ok('停掉的不算今天要上的課', Timetable.activeOn(today).length === 0,
           String(Timetable.activeOn(today).length));
        ok('但那堂課還在畫面上（不是消失）', !!classRow(),
           '停課要看得到「本來有課」');
        await tab('overview'); await sleep(240);
        ok('總覽的今天課數跟著減',
           [...document.querySelectorAll('#hero .stat')]
             .some(t => t.textContent.includes('今天的課') && t.textContent.includes('0')));

        // 只影響那一天：下週同一堂不該被標到
        const next = ymd(new Date(parseYmd(today).getTime() + 7 * 86400000));
        ok('下週同一堂不受影響', !Timetable.isOff(slot.id, next));

        // 清掉
        await tab('agenda'); Agenda.render(); await sleep(250);
        classRow().click(); await sleep(250);
        ok('標記過就有清掉鈕', !q('#cm-clear').hidden);
        q('#cm-clear').click(); await sleep(320);
        ok('清掉之後標記就沒了', Timetable.marks().length === 0);
        ok('課列也恢復正常', !classRow()?.querySelector('.class-off-tag'));

        // 空白的標記不要留空殼
        Timetable.setMark(slot.id, today, { off: false, text: '   ' });
        ok('沒有內容就不留一筆空的', Timetable.marks().length === 0);
    }
    await tab('overview'); await sleep(200);

    // 想法牆需要空間才有意義，寬螢幕上它必須在
    ok('寬螢幕看得到想法牆分頁',
       !q('#tabs button[data-panel="wall"]').hidden);

    // ── 想法牆在手機上不能卡住 ──
    // **這條是回歸測試。** 牆上寫 touch-action: none 的話，手指放在
    // 這面 560px 高的牆上，瀏覽器就不產生捲動手勢——手機上整頁滑不動。
    await tab('wall'); await sleep(220);
    const wallTA = getComputedStyle(q('#wall-board')).touchAction;
    ok('牆不會吃掉整頁的觸控捲動', wallTA !== 'none', wallTA);
    const st = q('.wall .sticky');
    ok('要鎖手勢的是便利貼本身',
       st && getComputedStyle(st).touchAction === 'none',
       st ? getComputedStyle(st).touchAction : '沒有便利貼');
    ok('便利貼上可以自己挑顏色', !!q('.wall .sticky .pick input[type=color]'));

    // 深色便利貼上，字和按鈕都要看得見。寫死深色字的話挑一張深色的
    // 就整張消失——字看不見，右下角那兩顆按鈕也一起不見。
    {
      const note = Wall.data.notes[0];
      const bad = [];
      for (const c of ['#F9D984', '#2B2438', '#123', '#FFFFFF', '#000000', '#5FC9C0']) {
        note.color = c;
        Wall.render(); await sleep(120);
        const n = q('.wall .sticky');
        const ink = n.style.getPropertyValue('--ink').trim();
        const r = contrast(c.length === 4
            ? '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3] : c, ink);
        if (r < 4.5) bad.push(c + '→' + ink + ' ' + r.toFixed(1));
      }
      ok('每一種便利貼顏色上的字都讀得到', bad.length === 0, bad.join('、'));
      note.color = '#F9D984';
      Wall.render(); await sleep(120);
      const tools = q('.wall .sticky .tools button');
      ok('按鈕的顏色跟著便利貼走，不是寫死的',
         getComputedStyle(tools).color === getComputedStyle(q('.wall .sticky')).color,
         getComputedStyle(tools).color);
    }

    // 分頁名稱跟元素 id 撞名（#wall / #agenda），瀏覽器會照 hash 自己捲過去
    // 把上面的工具列捲出畫面——手機上就變成「貼一張」那顆按鈕不見了
    ok('切到想法牆不會把上面的工具列捲掉', scrollY < 10, 'scrollY=' + Math.round(scrollY));
    ok('「貼一張」在畫面裡', q('#add-sticky').getBoundingClientRect().top > 0,
       Math.round(q('#add-sticky').getBoundingClientRect().top) + 'px');

    // 便利貼不能掉到牆外面——看不到就等於點不到、刪不掉。
    // **要把牆縮成手機寬度才驗得到**：在 1512px 的視窗上，
    // 每一張本來就都在裡面，這條會一直是綠的卻什麼都沒驗到。
    for (let i = 0; i < 4; i++) {
      Wall.data.notes.push({ id: 'w' + i, text: '第 ' + i + ' 張',
        x: 40 + i * 260, y: 30 + i * 40, color: '#F9D984', z: i + 1, tilt: 0 });
    }
    q('#wall-board').style.width = '360px';
    Wall.render(); await sleep(200);
    const wallBox = q('#wall-board').getBoundingClientRect();
    const outside = [...document.querySelectorAll('.wall .sticky')]
        .filter(n => n.getBoundingClientRect().right > wallBox.right + 1);
    ok('窄螢幕上沒有便利貼掉到牆外面', outside.length === 0,
       outside.length + ' 張掉出去（牆寬 ' + Math.round(wallBox.width) + 'px）');
    // 夾的是畫面位置，不是資料——不然回到電腦會發現自己排的版被擠成一團
    ok('夾住的是畫面位置，資料沒有被改掉',
       Wall.data.notes.some(n => n.x > 360),
       Wall.data.notes.map(n => n.x).join(','));
    q('#wall-board').style.width = '';
    Wall.render(); await sleep(150);
    ok('色票旁邊有自訂顏色', !!q('#swatches input[type=color]'));

    const rules = [...document.styleSheets]
        .flatMap(sh => { try { return [...sh.cssRules] } catch { return [] } });
    // 手機沒有 hover，少了這條的話換色和撕掉兩顆鍵永遠是透明的，
    // 等於便利貼貼上去就刪不掉
    ok('沒有 hover 的裝置也看得到便利貼的工具鍵',
       rules.some(r => r.media && r.conditionText.includes('hover: none')));

    // ── 匯出／匯入 ──
    // 匯出要帶到新的兩份，不然換一台電腦課表和主題色就沒了
    ok('匯出會帶到課表和設定',
       NAMES.includes('課表') && NAMES.includes('設定'), NAMES.join('、'));

    // 真的走一次匯入。**只驗清單有列到是不夠的**——
    // 名字在清單裡但實際上沒被寫進去，畫面看起來一樣正常。
    const before = JSON.stringify(Timetable.data);
    const got = DataBox.apply({
      app: '星歷儀表板', version: 1, data: {
        課表: { active: 'imported', sets: [{ id: 'imported', name: '匯入的課表',
                 slots: [{ id: 'i1', name: '匯入的課', day: 2,
                           start: '08:00', end: '09:00', label: null }] }] },
        設定: { accent: '#5FC9C0', labels: [{ id: 'i-l', name: '匯入的分類', color: '#5FC9C0' }] },
      },
    });
    await sleep(320);
    ok('匯入真的收得到課表和設定', got === 2, '收了 ' + got + ' 份');
    ok('匯入的課表寫進資料層了',
       Store.cache['課表'].sets[0].name === '匯入的課表');
    ok('匯入的主題色寫進資料層了', Store.cache['設定'].accent === '#5FC9C0');

    // 舊的匯出檔沒有這兩份，不能因為少一個鍵就把現有的清成空的
    const n2 = DataBox.apply({ app: '星歷儀表板', data: { 備忘: { items: [] } } });
    await sleep(200);
    ok('舊的匯出檔不會把課表清掉',
       Store.cache['課表'].sets.length === 1 && n2 === 1, '收了 ' + n2 + ' 份');
    // 匯入換掉的是 Store.cache 裡的物件，各模組手上抓的還是舊的那一份——
    // **所以 import 最後那個 reload 是必要的，不是偷懶。**
    // 哪天有人把它拿掉，這條會先叫。
    ok('匯入後模組手上還是舊物件（所以一定要 reload）',
       JSON.stringify(Timetable.data) === before
       && Store.cache['課表'] !== Timetable.data);

    // ── 自己更新 ──
    // 加到主畫面之後沒有網址列也沒有重整鍵，所以頁面要自己問「程式換了沒」
    ok('拿得到程式版本', !!Update.version, Update.version || '沒有');
    ok('同一份程式不會被當成有新版',
       (await Update.fetch()) === Update.version);

    // 版本沒變就什麼都不該做
    Update.check(); await sleep(300);
    ok('沒換版的時候不會跳提示', !q('#update-bar'));

    // **正在打字的時候不可以硬重載**，會把她手上那件事弄掉
    q('#add-todo').click(); await sleep(200);
    ok('對話框開著時算「正在忙」', Update.busy());
    q('#dlg-todo button[value=\"cancel\"]').click(); await sleep(180);
    // 關掉的對話框裡面留下的焦點不算忙——不排掉的話 busy() 從此永遠是 true，
    // 自動更新再也不會發生，而且完全沒有徵兆
    ok('對話框關掉就不算忙', !Update.busy(),
       document.activeElement.tagName + ' in '
       + (document.activeElement.closest('dialog')?.id || '(不在對話框裡)'));

    // 忙的時候要給可以點的提示，不是自己重載
    const realApply = Update.apply;
    let applied = 0;
    Update.apply = () => { applied++; };
    Update.version = 'x-舊版';         // 假裝拿到的是不一樣的版本
    q('#add-todo').click(); await sleep(200);
    await Update.check(); await sleep(300);
    ok('忙的時候不會自己重載', applied === 0);
    ok('忙的時候給一條可以點的提示', !!q('#update-bar'));
    ok('提示上有「重新載入」可以按',
       [...document.querySelectorAll('#update-bar button')]
         .some(b => b.textContent === '重新載入'));
    // 同一版按掉之後不要再跳
    q('#update-bar button[aria-label=\"關掉這個提示\"]').click(); await sleep(150);
    await Update.check(); await sleep(300);
    ok('同一版按掉之後不會再吵', !q('#update-bar'));
    q('#dlg-todo button[value=\"cancel\"]').click(); await sleep(200);

    // 不忙的時候才自己重載
    await Update.check(); await sleep(300);
    ok('不忙的時候就自己更新', applied === 1, '呼叫了 ' + applied + ' 次');
    Update.apply = realApply;
    Update.version = await Update.fetch();
    q('#update-bar')?.remove();

    // ── 資料匯出／匯入的入口 ──
    q('#mode').click(); await sleep(200);
    ok('點徽章開得出資料視窗', q('#dlg-data').open);
    ok('資料視窗裡有匯出和匯入',
       q('#data-body').textContent.includes('匯出')
       && q('#data-body').textContent.includes('匯入'));
    // 本機模式不該給「清空」那顆——真資料按下去太危險
    ok('本機模式沒有清空鈕', !q('#data-body').textContent.includes('清空'));
    q('#dlg-data button[value="close"]').click(); await sleep(150);
    ok('資料視窗關得掉', !q('#dlg-data').open);
  } catch (e) {
    out.push('✗ 中途爆了: ' + e.message);
  }
  // **跑完了要蓋印記。** ok() 一邊跑一邊更新 title，所以「title 裡有 ✓」
  // 不再代表跑完——沒有這個印記的話，讀的那一端會拿到半路的結果
  // 卻以為是全部。
  document.title = 'DONE ||| ' + out.join(' ||| ');
})();
</script>
`;

// ── 跑起來 ──────────────────────────────────────────────

// ── 先檢查這支檢查本身 ────────────────────────────────
//
// PROBE 是上面那個樣板字串的內容，所以它**不能有反引號，也不能有
// 樣板插值**：反引號會提前結束字串，跳脫序列會先被外層求值掉。
// 正則裡的反斜線同理——`\.` 會變成 `.`，未跳脫的斜線把正則提前結束。
//
// 這件事今天踩了四次，每次的症狀都一樣：SyntaxError，
// **整段檢查一行都不跑，而且靜靜地不跑**，只留下「2/2 過」看起來很正常。
// 所以不要再靠記性，跑之前直接擋。
{
    // **要掃原始碼，不是求值後的 PROBE。** 樣板字串會把跳脫序列
    // 求值掉——寫 \u0060 描述反引號的地方，求值後就真的變成反引號了，
    // 拿求值後的字串去找會一直誤報。
    const self = readFileSync(new URL(import.meta.url), 'utf-8');
    const open = self.indexOf('const PROBE = ');
    const body = self.slice(self.indexOf('\n', open) + 1);
    const stop = body.indexOf('\n`;');
    const raw = stop < 0 ? '' : body.slice(0, stop);

    const problems = [];
    if (raw.includes(String.fromCharCode(96))) problems.push('PROBE 裡有反引號');
    if (raw.includes('$' + '{')) problems.push('PROBE 裡有樣板插值');
    if (problems.length) {
        console.error('這支檢查自己有問題：' + problems.join('、'));
        console.error('（症狀會是整段檢查靜靜地不跑，只留下很少的通過數）');
        process.exit(1);
    }
}

const dataDir = mkdtempSync(join(tmpdir(), 'starcal-check-'));

// 小克那塊的固定樣本。**故意放一個 91%**，才驗得到「快滿了要變紅」那條——
// 拿真實額度來測的話，數字每天不一樣，測試就會時好時壞。
writeFileSync(join(dataDir, '小克.json'), JSON.stringify({
    line: '測試用的一句話。',
    limits: [
        { kind: 'session',    group: 'session', percent: 42, resetsAt: new Date(Date.now() + 3600e3).toISOString() },
        { kind: 'weekly_all', group: 'weekly',  percent: 91, resetsAt: new Date(Date.now() + 86400e3).toISOString() },
    ],
    fetchedAt: Date.now(),
    problem: null,
}));
// 檔名刻意用 ASCII。這個專案在中文路徑上已經踩過一次
// （server 沒 unquote，/api/記帳 一律 404），而這支是驗證工具——
// 工具自己出問題的時候，症狀會偽裝成「你剛改的東西壞了」，最難查。
const probePath = join(HERE, '_check.html');

const html = readFileSync(join(HERE, 'index.html'), 'utf-8');
// **用函式形式的 replace。** 直接給字串的話，裡面的 `$$` 會被當成跳脫序列
// （$$ → 一個字面的 $），probe 裡的 `$$$` 就變成 `$$`，跟 util.js 已經宣告的
// $$ 撞名，整段 script 因為 SyntaxError 一行都不會跑——而且靜靜地不跑。
// **先確認 PROBE 自己是合法的 JS。**
//
// 這個常數是樣板字串，裡面的反斜線會被 JS 先解析掉一次：
// 想在頁面裡寫 \n 或正則的 \d，這裡就得打兩個反斜線。
// 少打的話注入進去的是一個真的換行（或一個光禿禿的 d），
// **整段 script 靜靜地不跑**——通過數會突然剩個位數，而且沒有任何錯誤訊息。
// 2026-09-06 一個上午踩了兩次，所以在這裡擋掉，一秒就知道。
try {
    new Function(PROBE.replace(/<\/?script>/g, ''));
} catch (e) {
    console.error('這支檢查自己有問題：PROBE 解析之後不是合法的 JS');
    console.error('  ' + e.message);
    console.error('多半是反斜線少打一個（\\n、\\d 在這個樣板字串裡要寫兩個）。');
    process.exit(1);
}

writeFileSync(probePath, html.replace('</body>', () => PROBE + '</body>'));

const server = spawn('python3', [join(HERE, 'server.py'), '--port', String(PORT)], {
    env: { ...process.env, STARCAL_DATA_DIR: dataDir },
    stdio: 'ignore',
});

let code = 0;
try {
    await sleep(1400);

    const dom = execSync(
        // 預算要留餘裕：檢查條目每加一批，這裡就多跑幾秒。
        // 2026-09-07 加了記帳那批（總預算、遮金額、今天的收支）之後，
        // 180000 變成時好時壞——同一份程式跑三次，有一次桌機那輪
        // 只印到一半。**時好時壞就是已經在邊緣了**，不要調到剛好夠。
        // **不夠的時候不會報錯**，chrome 會在時間到的那一刻直接 dump，
        // title 停在半路——看起來像「測試突然少了一大半」。
        // 2026-09-06 就這樣被騙過一次（291 條全過，卻只印出手機那輪的 32 條）。
        `"${CHROME}" --headless --disable-gpu --virtual-time-budget=300000 ` +
        `--window-size=1512,1400 --dump-dom "http://127.0.0.1:${PORT}/_check.html" 2>/dev/null`,
        { maxBuffer: 32 * 1024 * 1024 }).toString();

    // 手機那一輪。同一份 probe，靠視窗寬度自己分岔——
    // 走 CDP 的裝置模擬，才拿得到真正的 390。
    const phone = await phoneTitle(`http://127.0.0.1:${PORT}/_check.html`);

    // 兩輪的結果都是塞在 document.title 裡帶回來的。
    // **抓不到就要講出來**——靜靜地少一輪，看起來就像那一輪的測試全部消失了。
    let deskRaw = (dom.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1] || '';
    if (deskRaw.startsWith('DONE ||| ')) {
        deskRaw = deskRaw.slice(9);
    } else if (deskRaw.includes('✓') || deskRaw.includes('✗')) {
        // 半路停住。**這件事一定要講出來**：少掉的那幾條看起來
        // 就像從來不存在，而不像「沒跑到」。
        const done = deskRaw.split(' ||| ');
        console.error('⚠️ 桌機那輪沒跑完，只跑到第 ' + done.length + ' 條就停了');
        console.error('   最後跑完的是：' + done[done.length - 1]);
        console.error('   多半是虛擬時間預算不夠，或下一條卡在一個不會回來的 await。');
        code = 1;
    } else {
        console.error('⚠️ 桌機那輪沒有帶回結果（title = ' + JSON.stringify(deskRaw.slice(0, 60)) + '）');
        console.error('   dom 長度 ' + dom.length + '，多半是 PROBE 一開始就爆了。');
        console.error('   查法：KEEP_PROBE=1 跑一次，在 _check.html 裡插 window.onerror。');
        code = 1;
    }

    const title = deskRaw + ' ||| ' + phone;
    const lines = title.split(' ||| ').filter(Boolean);

    if (!lines.length) {
        console.error('沒有拿到任何結果——頁面可能在載入時就爆了。');
        console.error('通過數突然變成個位數也是同一件事。最常見的原因是 PROBE 這個');
        console.error('樣板字串裡的跳脫被吃掉了（\\n 要打兩個反斜線、$$ 要用函式形式 replace）。');
        console.error('查法：KEEP_PROBE=1 跑一次，在 _check.html 裡插一段 window.onerror');
        console.error('把錯誤寫進 document.title，就會直接指出行號。');
        code = 1;
    } else {
        for (const line of lines) console.log(line);
        const failed = lines.filter(l => l.startsWith('✗'));
        console.log('');
        console.log(`${lines.length - failed.length}/${lines.length} 過`);
        if (failed.length) code = 1;
    }
} finally {
    server.kill();
    if (!process.env.KEEP_PROBE) rmSync(probePath, { force: true });
    rmSync(dataDir, { recursive: true, force: true });
}

process.exit(code);
