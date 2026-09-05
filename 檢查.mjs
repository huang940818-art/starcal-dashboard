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

/** 塞進頁面裡跑的檢查。每一條回一行文字，開頭是 ✓ 或 ✗。 */
const PROBE = `
<script>
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = [];
const ok = (n, c, e = '') => out.push((c ? '✓ ' : '✗ ') + n + (e ? '  (' + e + ')' : ''));
const q = s => document.querySelector(s);
const tab = n => { q('#tabs button[data-panel="' + n + '"]').click(); return sleep(220); };

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
      }

      Agenda.view = 'month'; Agenda.render(); await sleep(300);
      ok('手機上月曆格子不會被撐爆', !wide(),
         document.documentElement.scrollWidth + ' > ' + innerWidth);
      ok('手機上月曆用色點代替標題',
         getComputedStyle(q('#calendar .cal-dots')).display === 'flex');
    } catch (e) {
      out.push('✗ 手機那輪爆了: ' + e.message);
    }
    document.title = out.join(' ||| ');
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
        // 她問「那些被收掉的待辦事項去哪裡可以看」——這裡就是答案
        const archived = [...document.querySelectorAll('#agenda-list .day-group')]
            .find(g => g.querySelector('.day-name')?.textContent === '收起來的');
        ok('收起來的東西有地方可以看', !!archived
           && archived.textContent.includes('過期的行程'),
           archived ? archived.textContent.slice(0, 40) : '找不到那一區');
        ok('收起來的那一列有「放回去」',
           !!archived && [...archived.querySelectorAll('button')]
             .some(b => b.textContent === '放回去'));

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
    ok('四種粒度都在',
       document.querySelectorAll('#month-nav .range-kinds .view-btn').length === 4);

    {
      const kinds = [...document.querySelectorAll('#month-nav .range-kinds .view-btn')];
      const byName = n => kinds.find(b => b.textContent === n);

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
    ok('三個檢視的切換鈕都在',
       document.querySelectorAll('#agenda-tools .view-btn').length === 3);

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
    ok('翻得到下個月', MonthView.ym !== thisMonth());
    MonthView.today(); await sleep(220);
    ok('回得到這個月', MonthView.ym === thisMonth());

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
  document.title = out.join(' ||| ');
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
const probePath = join(HERE, '_檢查.html');

const html = readFileSync(join(HERE, 'index.html'), 'utf-8');
// **用函式形式的 replace。** 直接給字串的話，裡面的 `$$` 會被當成跳脫序列
// （$$ → 一個字面的 $），probe 裡的 `$$$` 就變成 `$$`，跟 util.js 已經宣告的
// $$ 撞名，整段 script 因為 SyntaxError 一行都不會跑——而且靜靜地不跑。
writeFileSync(probePath, html.replace('</body>', () => PROBE + '</body>'));

const server = spawn('python3', [join(HERE, 'server.py'), '--port', String(PORT)], {
    env: { ...process.env, STARCAL_DATA_DIR: dataDir },
    stdio: 'ignore',
});

let code = 0;
try {
    await sleep(1400);

    const dom = execSync(
        `"${CHROME}" --headless --disable-gpu --virtual-time-budget=90000 ` +
        `--window-size=1512,1400 --dump-dom "http://127.0.0.1:${PORT}/_檢查.html" 2>/dev/null`,
        { maxBuffer: 32 * 1024 * 1024 }).toString();

    // 手機那一輪。同一份 probe，靠視窗寬度自己分岔。
    const domM = execSync(
        `"${CHROME}" --headless --disable-gpu --virtual-time-budget=60000 ` +
        `--window-size=390,844 --dump-dom "http://127.0.0.1:${PORT}/_檢查.html" 2>/dev/null`,
        { maxBuffer: 32 * 1024 * 1024 }).toString();

    const title = ((dom.match(/<title>([^<]*)<\/title>/) || [])[1] || '')
        + ' ||| ' + ((domM.match(/<title>([^<]*)<\/title>/) || [])[1] || '');
    const lines = title.split(' ||| ').filter(Boolean);

    if (!lines.length) {
        console.error('沒有拿到任何結果——頁面可能在載入時就爆了。');
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
    rmSync(probePath, { force: true });
    rmSync(dataDir, { recursive: true, force: true });
}

process.exit(code);
