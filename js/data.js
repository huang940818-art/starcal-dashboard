/* 資料的匯出、匯入、清空。
 *
 * 這一支是「要能給別人用」才需要的：
 *
 * 1. **展示模式一打開就有示範資料。** 那對「看作品集」是對的，
 *    對「我想拿來記自己的帳」是擋路——總不能叫人一筆一筆刪掉兩百多筆。
 * 2. **展示模式的資料存在 localStorage。** 清一次瀏覽器就沒了，
 *    換一台電腦也看不到。所以一定要能倒出來、倒回去。
 *
 * 入口是頂欄那個模式徽章。它本來就在說「你的資料在哪」，
 * 資料的事放在同一個地方最好找。
 */

const NAMES = ['記帳', '待辦', '行事曆', '備忘', '便利貼', '課表', '設定'];

const DataBox = {
    open() {
        const box = $('#data-body');
        clear(box);

        const local = Store.mode === 'local';

        box.append(el('p', { class: 'sub', style: 'margin:0 0 16px;line-height:1.75' },
            local
                ? `你的資料存在這台電腦的 ${Store.dir || '~/星歷資料'}，每次存檔前會自動留一份備份。`
                : '你現在看到的是一份編出來的示範資料，存在這個瀏覽器裡。'
                  + '怎麼改都不會影響別人，但**清掉瀏覽器資料就會不見**，'
                  + '要留著的話請定期匯出。'));

        box.append(el('div', { class: 'data-actions' }, [
            el('button', {
                type: 'button', class: 'btn', text: '匯出成一個檔案',
                onclick: () => this.export(),
            }),
            el('button', {
                type: 'button', class: 'btn', text: '從檔案匯入',
                onclick: () => $('#import-file').click(),
            }),
        ]));

        // 清空只在展示模式給。本機模式有真實資料，那個按鈕太危險了，
        // 而且真要清的話直接刪 ~/星歷資料/ 的檔案更清楚。
        if (!local) {
            const wrap = el('div', { style: 'margin-top:22px;padding-top:18px;'
                + 'border-top:1px solid var(--separator)' });
            const btn = el('button', {
                type: 'button', class: 'btn danger', text: '清空，我要自己用',
            });
            let armed = false;
            btn.onclick = () => {
                // 二次確認做成同一顆按鈕。跳一個 confirm 視窗很容易被順手按掉。
                if (!armed) {
                    armed = true;
                    btn.textContent = '再按一次就真的清空了';
                    setTimeout(() => {
                        if (!armed) return;
                        armed = false;
                        btn.textContent = '清空，我要自己用';
                    }, 4000);
                    return;
                }
                this.clearAll();
            };
            wrap.append(
                el('p', { class: 'sub', style: 'margin:0 0 12px',
                    text: '把示範資料清掉，從全空開始記自己的。這個沒有還原。' }),
                btn);
            box.append(wrap);
        }

        openDialog('#dlg-data');
    },

    /** 所有資料打包成一個檔。帶版本和時間，之後要轉格式才有依據。 */
    async export() {
        const payload = { app: '星歷儀表板', version: 1, at: new Date().toISOString(), data: {} };
        for (const name of NAMES) {
            payload.data[name] = await Store.load(name);
        }

        const blob = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = el('a', { href: url, download: `星歷-${ymd()}.json` });
        document.body.append(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        toast('匯出了');
    },

    async import(file) {
        let payload;
        try {
            payload = JSON.parse(await file.text());
        } catch (e) {
            return toast('這不是合法的 JSON', true);
        }
        if (!payload || payload.app !== '星歷儀表板' || !payload.data) {
            return toast('這不是星歷匯出的檔案', true);
        }

        const n = this.apply(payload);
        if (!n) return toast('檔案裡沒有可以匯入的資料', true);

        // 匯進來的東西要讓每個模組重新認一次，直接重整最乾淨
        toast(`匯入了 ${n} 份，重新載入…`);
        setTimeout(() => location.reload(), 700);
    },

    /**
     * 把 payload 寫進資料層，回傳收了幾份。
     *
     * **跟 import 拆開是為了測得到。** import 最後會 reload，
     * 一個會把整個頁面重載的函式沒辦法在同一個頁面裡驗證它做了什麼——
     * 跟底下 clearAll / wipe 拆開是同一個理由。
     */
    apply(payload) {
        // 只認識的那幾份會被蓋掉，多的忽略——不要因為檔案裡多一個鍵就整份不收。
        // 反過來，舊的匯出檔沒有「課表」和「設定」，那兩份就保持原樣，
        // 不要因為檔案裡少一個鍵就把現有的清成空的。
        let n = 0;
        for (const name of NAMES) {
            const incoming = payload.data[name];
            if (!incoming || typeof incoming !== 'object') continue;
            Store.cache[name] = incoming;
            Store.save(name, { immediate: true });
            n++;
        }
        return n;
    },

    clearAll() {
        this.wipe();
        toast('清空了，重新載入…');
        setTimeout(() => location.reload(), 600);
    },

    /** 只清資料，不重整。跟 clearAll 拆開是為了測得到——
     *  一個會 reload 的函式沒辦法在同一個頁面裡驗證它做了什麼。 */
    wipe() {
        for (const name of NAMES) {
            try { localStorage.removeItem(`星歷:${name}`); } catch {}
            delete Store.cache[name];
        }
        // 記住「這個瀏覽器已經清過了」，不然重整一次示範資料就整份長回來
        try { localStorage.setItem('星歷:自己用', '1'); } catch {}
    },
};
