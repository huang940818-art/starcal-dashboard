/* 自動更新的地基：server 算出來的版本指紋。
 *
 *   node 版本測試.mjs
 *
 * 前端那半在 檢查.mjs 裡（忙的時候給提示、不忙就自己重載）。
 * 這支驗的是它依賴的前提：**改了程式指紋要變，存了資料指紋不能變。**
 * 後者錯的話，記一筆帳就會被叫去重新載入。
 *
 * 動的是 js/ 底下一個臨時檔，不碰真的原始碼——測試不該有機會
 * 把專案改壞，即使只是理論上的。
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// 中文路徑用 fileURLToPath，不能用 .pathname（那個是 percent-encoded 的）
const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 8897;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const dataDir = mkdtempSync(join(tmpdir(), 'starcal-ver-'));
const probe = join(HERE, 'js', '_版本測試用.js');

const server = spawn('python3', [join(HERE, 'server.py'), '--port', String(PORT)],
    { env: { ...process.env, STARCAL_DATA_DIR: dataDir }, stdio: 'ignore' });

const ver = async () =>
    (await (await fetch(`http://127.0.0.1:${PORT}/api/版本`)).json()).version;

const out = [];
const ok = (n, c, e = '') => out.push((c ? '✓ ' : '✗ ') + n + (e ? '  (' + e + ')' : ''));

try {
    await sleep(1400);

    const v1 = await ver();
    ok('拿得到版本指紋', /^[0-9a-f]{12}$/.test(v1), v1);
    ok('沒動檔案，指紋不變', (await ver()) === v1);

    writeFileSync(probe, '// 版本測試用的臨時檔\n');
    await sleep(120);
    const v2 = await ver();
    ok('多一支 JS，指紋跟著變', v2 !== v1, v1 + ' → ' + v2);

    appendFileSync(probe, '// 再加一行\n');
    await sleep(120);
    const v3 = await ver();
    ok('改了內容，指紋又變一次', v3 !== v2, v2 + ' → ' + v3);

    rmSync(probe);
    await sleep(120);
    const v4 = await ver();
    ok('刪掉之後回到原來的指紋', v4 === v1, v3 + ' → ' + v4);

    // **這條最重要。** 資料一直在變，跟著它一起變的話，
    // 記一筆帳就會跳出「星歷更新了」。
    writeFileSync(join(dataDir, '備忘.json'), JSON.stringify({ items: [{ id: 'x' }] }));
    await sleep(120);
    ok('存資料不會被當成程式換版', (await ver()) === v4);

    // ── 資料的版本戳：擋掉「舊分頁蓋掉新資料」 ──────────────
    //
    // 頁面開著的時候，Mac 上那份可能被手機同步過來的資料改掉。
    // 前端手上是舊的，一存就靜靜蓋掉。這幾條守的就是那件事。

    const api = n => `http://127.0.0.1:${PORT}/api/${encodeURIComponent(n)}`;
    const getMoney = () => fetch(api('記帳'), { cache: 'no-store' });

    let res = await getMoney();
    const s1 = res.headers.get('X-Star-Version');
    ok('讀資料時拿得到版本戳', /^[0-9a-f]+-[0-9a-f]+$/.test(s1 || ''), s1);
    ok('沒動檔案，資料版本戳不變',
        (await getMoney()).headers.get('X-Star-Version') === s1);

    const put = (n, body, base) =>
        fetch(api(n) + (base === undefined ? '' : `?base=${encodeURIComponent(base)}`),
              { method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body) });

    const one = { accounts: [{ name: '總資產' }], transactions: [{ id: 'A', amount: 1 }],
                  subscriptions: [], budgets: [], categories: { expense: [], income: [] } };
    res = await put('記帳', one, s1);
    const body1 = await res.json();
    ok('帶著對的版本戳存得進去', res.status === 200 && body1.ok === true, String(res.status));
    ok('存完回新的版本戳', !!body1.version && body1.version !== s1, body1.version);

    // 這一條是重點：拿剛剛那個**已經過期**的戳再存一次
    const two = { ...one, transactions: [] };
    res = await put('記帳', two, s1);
    const body2 = await res.json();
    ok('拿過期的版本戳存 → 409 擋下來', res.status === 409, String(res.status));
    ok('而且說得出是衝突', body2.conflict === true);
    const after = await (await getMoney()).json();
    ok('被擋下來的那次沒有動到檔案', after.transactions.length === 1,
        `剩 ${after.transactions.length} 筆`);

    // 不帶 base 的照舊放行——關分頁時的 sendBeacon 有可能沒帶
    res = await put('記帳', two, undefined);
    ok('沒帶版本戳照舊存得進去', res.status === 200, String(res.status));

    // ── /api/資料版本 ──────────────────────────────────
    const all = await (await fetch(`http://127.0.0.1:${PORT}/api/資料版本`)).json();
    ok('資料版本列出每一份', Object.keys(all).length >= 8, Object.keys(all).length + ' 份');
    ok('跟讀取時給的那個戳一致',
        all['記帳'] === (await getMoney()).headers.get('X-Star-Version'));

    // 外部（手機同步、或直接改檔案）動了資料 → 戳要跟著變，前端才知道自己舊了
    const before = all['備忘'];
    writeFileSync(join(dataDir, '備忘.json'),
                  JSON.stringify({ items: [{ id: 'y' }, { id: 'z' }] }));
    await sleep(120);
    const all2 = await (await fetch(`http://127.0.0.1:${PORT}/api/資料版本`)).json();
    ok('外面改了檔案，戳跟著變', all2['備忘'] !== before, `${before} → ${all2['備忘']}`);
    ok('沒被動到的那幾份戳不變', all2['記帳'] === all['記帳']);
} catch (e) {
    ok('中途爆了: ' + e.message, false);
} finally {
    rmSync(probe, { force: true });
    server.kill();
    rmSync(dataDir, { recursive: true, force: true });
}

for (const l of out) console.log(l);
const bad = out.filter(l => l.startsWith('✗')).length;
console.log(`\n${out.length - bad}/${out.length} 過`);
process.exit(bad ? 1 : 0);
