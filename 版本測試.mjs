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
