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

    // ── 行程：存進去要看得到 ──
    await tab('agenda');
    q('#add-event').click(); await sleep(160);
    q('#e-title').value = '檢查用行程';
    q('#e-save').click(); await sleep(260);
    ok('行程存得進去', Cal.data.events.length === 1);
    ok('行程出現在時間線上', q('#agenda').textContent.includes('檢查用行程'));

    // ── 待辦：勾了要變完成 ──
    q('#add-todo').click(); await sleep(160);
    q('#d-title').value = '檢查用待辦';
    q('#d-save').click(); await sleep(260);
    ok('待辦存得進去', Todo.data.items.length === 1);
    const check = q('#agenda .todo-row .check');
    if (check) {
      check.click(); await sleep(220);
      ok('勾得起來', Todo.data.items[0].done === true);
    } else ok('勾得起來', false, '找不到勾選框');

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

    // ── 月份切換 ──
    ok('這個月時「下個月」是停用的',
       q('#month-nav button[aria-label="下個月"]').disabled);

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

const dataDir = mkdtempSync(join(tmpdir(), 'starcal-check-'));
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

    const title = (dom.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
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
