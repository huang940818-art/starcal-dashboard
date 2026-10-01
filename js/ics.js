/* 匯入別的日曆（Google 日曆匯出的 .ics／.zip）。
 *
 * 她朋友想在星歷看到自己 Google 日曆上的行程。連 Google 帳號那條路
 * （js/gcal.js）要申請、要驗證、登入時還有警告，她選了這條：匯出檔案丟進來。
 *
 * - Google 日曆 → 設定 → 匯入和匯出 → 匯出，會拿到一個 .zip（每個日曆一個 .ics）。
 *   zip 直接丟進來就好，不用自己解壓縮。
 * - **再匯一次就整份換掉**，不是疊加——不然 Google 那邊刪掉的永遠刪不掉。
 * - 跟國定假日一樣**不寫進星歷的資料**（見 js/holidays.js），只放在這台瀏覽器。
 *   點匯入的行程不會打開編輯框：在這裡改了也改不回 Google，不如不能改。
 * - 重複的行程（每週一次那種）在這裡展開成一筆一筆，只展開前後一段時間。
 */

const Ics = {
    KEY: 'ics:events',
    PAST_DAYS: 60,
    FUTURE_DAYS: 400,

    events: [],
    byDate: new Map(),
    importedAt: null,
    files: [],

    init() {
        try {
            const d = JSON.parse(localStorage.getItem(this.KEY) || 'null');
            if (d?.events) {
                this.importedAt = d.importedAt;
                this.files = d.files || [];
                this.setEvents(d.events);
                this.redraw();
            }
        } catch { /* 壞掉就當沒匯過 */ }
    },

    eventsOn(day) { return this.byDate.get(day) || []; },
    after(day) { return this.events.filter(e => e.date > day); },

    setEvents(events) {
        this.events = events;
        this.byDate = new Map();
        for (const e of events) {
            if (!this.byDate.has(e.date)) this.byDate.set(e.date, []);
            this.byDate.get(e.date).push(e);
        }
    },

    redraw() {
        if (typeof Agenda !== 'undefined') Agenda.render();
        if (typeof Overview !== 'undefined') Overview.render();
    },

    clearAll() {
        localStorage.removeItem(this.KEY);
        this.setEvents([]);
        this.importedAt = null;
        this.files = [];
        this.redraw();
    },

    /* ── 匯入 ───────────────────────────── */

    async importFiles(fileList) {
        const texts = [];   // [{ name, text }]
        for (const f of fileList) {
            const buf = new Uint8Array(await f.arrayBuffer());
            if (buf[0] === 0x50 && buf[1] === 0x4b) {
                for (const z of await this.unzip(buf)) {
                    if (/\.ics$/i.test(z.name)) texts.push({ name: z.name, text: new TextDecoder().decode(z.data) });
                }
            } else {
                texts.push({ name: f.name, text: new TextDecoder().decode(buf) });
            }
        }
        if (!texts.length) throw new Error('裡面沒有 .ics 檔');

        const events = [];
        for (const t of texts) {
            const cal = this.calName(t.text) || t.name.replace(/\.ics$/i, '').replace(/_.*$/, '');
            events.push(...this.parse(t.text, cal));
        }
        events.sort((a, b) => (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99')));

        this.importedAt = new Date().toISOString();
        this.files = texts.map(t => t.name);
        this.setEvents(events);
        try {
            localStorage.setItem(this.KEY, JSON.stringify({ importedAt: this.importedAt, files: this.files, events }));
        } catch {
            throw new Error('行程太多，這台瀏覽器存不下');
        }
        this.redraw();
        return events.length;
    },

    /** 最小的 zip 讀取：照中央目錄一個一個解（deflate 用瀏覽器內建的 DecompressionStream）。 */
    async unzip(buf) {
        const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        let eocd = -1;
        for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
            if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
        }
        if (eocd < 0) throw new Error('這個 zip 打不開');
        const count = dv.getUint16(eocd + 10, true);
        let p = dv.getUint32(eocd + 16, true);
        const out = [];
        for (let n = 0; n < count; n++) {
            if (dv.getUint32(p, true) !== 0x02014b50) break;
            const method = dv.getUint16(p + 10, true);
            const csize = dv.getUint32(p + 20, true);
            const nameLen = dv.getUint16(p + 28, true);
            const extraLen = dv.getUint16(p + 30, true);
            const commentLen = dv.getUint16(p + 32, true);
            const local = dv.getUint32(p + 42, true);
            const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
            p += 46 + nameLen + extraLen + commentLen;

            const lNameLen = dv.getUint16(local + 26, true);
            const lExtraLen = dv.getUint16(local + 28, true);
            const start = local + 30 + lNameLen + lExtraLen;
            const raw = buf.subarray(start, start + csize);
            let data;
            if (method === 0) data = raw;
            else if (method === 8) {
                const s = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
                data = new Uint8Array(await new Response(s).arrayBuffer());
            } else continue;
            out.push({ name, data });
        }
        return out;
    },

    /* ── 解析 .ics ──────────────────────── */

    calName(text) {
        const m = text.match(/^X-WR-CALNAME:(.*)$/m);
        return m ? this.unescape(m[1].trim()) : '';
    },

    unescape(s) {
        return s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1');
    },

    /** 一個日曆檔 → 星歷行程的樣子（已經展開重複、攤開跨天）。 */
    parse(text, calName) {
        const lines = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
        const vevents = [];
        let cur = null;
        for (const line of lines) {
            if (line === 'BEGIN:VEVENT') { cur = { props: [] }; continue; }
            if (line === 'END:VEVENT') { if (cur) vevents.push(cur); cur = null; continue; }
            if (!cur) continue;
            const i = line.indexOf(':');
            if (i < 0) continue;
            const left = line.slice(0, i), value = line.slice(i + 1);
            const [name, ...paramParts] = left.split(';');
            const params = Object.fromEntries(paramParts.map(p => p.split('=')));
            cur.props.push({ name: name.toUpperCase(), params, value });
        }

        const now = new Date();
        const winStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - this.PAST_DAYS);
        const winEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + this.FUTURE_DAYS);

        // 改過的單次（有 RECURRENCE-ID）要從原本那串重複裡拿掉，不然會出現兩次
        const overridden = new Map();   // uid → Set(date)
        for (const v of vevents) {
            const rid = v.props.find(p => p.name === 'RECURRENCE-ID');
            const uid = v.props.find(p => p.name === 'UID')?.value || '';
            if (rid) {
                const d = this.toDate(rid.value, rid.params);
                if (d) {
                    if (!overridden.has(uid)) overridden.set(uid, new Set());
                    overridden.get(uid).add(ymd(d.date));
                }
            }
        }

        const out = [];
        for (const v of vevents) {
            const get = n => v.props.find(p => p.name === n);
            if (get('STATUS')?.value === 'CANCELLED') continue;
            const ds = get('DTSTART');
            if (!ds) continue;
            const start = this.toDate(ds.value, ds.params);
            if (!start) continue;
            const de = get('DTEND');
            const end = de ? this.toDate(de.value, de.params) : null;
            const uid = get('UID')?.value || String(out.length);
            const title = this.unescape(get('SUMMARY')?.value || '（沒有標題）');

            const ex = new Set(overridden.get(uid) || []);
            if (get('RECURRENCE-ID')) ex.clear();      // 自己就是那個改過的單次
            for (const p of v.props.filter(p => p.name === 'EXDATE')) {
                for (const one of p.value.split(',')) {
                    const d = this.toDate(one, p.params);
                    if (d) ex.add(ymd(d.date));
                }
            }

            const rrule = get('RRULE') && !get('RECURRENCE-ID') ? this.rule(get('RRULE').value) : null;
            const starts = rrule ? this.expand(start.date, rrule, winEnd) : [start.date];
            const lengthMs = end ? end.date - start.date : 0;

            for (const s of starts) {
                if (s > winEnd) continue;
                const e = new Date(s.getTime() + lengthMs);
                if (e < winStart && s < winStart) continue;
                if (ex.has(ymd(s))) continue;
                out.push(...this.rows({ uid, title, calName, allDay: start.allDay, s, e }));
            }
        }
        return out;
    },

    rows({ uid, title, calName, allDay, s, e }) {
        const base = { ext: 'ics', title, note: calName, label: null, done: false, link: '' };
        if (allDay) {
            const rows = [];
            const d = new Date(s);
            do {
                rows.push({ ...base, id: `ics:${uid}:${ymd(d)}`, date: ymd(d), time: '', endTime: '' });
                d.setDate(d.getDate() + 1);
            } while (d < e && rows.length < 60);
            return rows;
        }
        const hm = x => `${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
        return [{ ...base, id: `ics:${uid}:${ymd(s)}`, date: ymd(s), time: hm(s),
                  endTime: ymd(e) === ymd(s) ? hm(e) : '' }];
    },

    /** "20261001" / "20261001T090000" / "…Z"（加上 TZID）→ 這台電腦的 Date */
    toDate(value, params = {}) {
        const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
        if (!m) return null;
        const [, y, mo, d, h, mi, se, z] = m;
        if (!h) return { date: new Date(+y, mo - 1, +d), allDay: true };
        if (z) return { date: new Date(Date.UTC(+y, mo - 1, +d, +h, +mi, +se)), allDay: false };
        const tz = params.TZID;
        const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (!tz || tz === local) return { date: new Date(+y, mo - 1, +d, +h, +mi, +se), allDay: false };
        // 別的時區的牆上時間：先當成 UTC，再扣掉那個時區當下的偏移
        const guess = Date.UTC(+y, mo - 1, +d, +h, +mi, +se);
        let off = 0;
        try {
            const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
                timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit',
            }).formatToParts(new Date(guess)).map(p => [p.type, p.value]));
            off = Date.UTC(+parts.year, parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - guess;
        } catch { /* 不認得的時區就當本地 */ }
        return { date: new Date(guess - off), allDay: false };
    },

    rule(text) {
        const r = Object.fromEntries(text.split(';').map(kv => kv.split('=')));
        return {
            freq: r.FREQ, interval: +(r.INTERVAL || 1), count: r.COUNT ? +r.COUNT : null,
            until: r.UNTIL ? this.toDate(r.UNTIL)?.date : null,
            byday: r.BYDAY ? r.BYDAY.split(',') : null,
            bymonthday: r.BYMONTHDAY ? r.BYMONTHDAY.split(',').map(Number) : null,
        };
    },

    /** 一天一天往後看，符合規則的就是一次。最多看 20 年、展開 1000 次。 */
    expand(start, r, winEnd) {
        const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
        const out = [];
        const day0 = new Date(start.getFullYear(), start.getMonth(), start.getDate());
        const monday0 = new Date(day0); monday0.setDate(day0.getDate() - ((day0.getDay() + 6) % 7));
        let n = 0;
        for (let i = 0; i < 7400 && out.length < 1000; i++) {
            const d = new Date(day0); d.setDate(day0.getDate() + i);
            if (d > winEnd) break;
            if (r.until && d > r.until) break;

            let hit = false;
            const wd = DAYS[d.getDay()];
            if (r.freq === 'DAILY') {
                hit = i % r.interval === 0;
            } else if (r.freq === 'WEEKLY') {
                const weeks = Math.floor((d - monday0) / (7 * 864e5) + 1e-9);
                const days = r.byday ? r.byday.map(x => x.slice(-2)) : [DAYS[day0.getDay()]];
                hit = weeks % r.interval === 0 && days.includes(wd);
            } else if (r.freq === 'MONTHLY') {
                const months = (d.getFullYear() - day0.getFullYear()) * 12 + d.getMonth() - day0.getMonth();
                if (months % r.interval === 0) {
                    if (r.bymonthday) hit = r.bymonthday.includes(d.getDate());
                    else if (r.byday) {
                        hit = r.byday.some(x => {
                            const m = x.match(/^(-?\d)?([A-Z]{2})$/);
                            if (!m || m[2] !== wd) return false;
                            if (!m[1]) return true;
                            const k = +m[1];
                            if (k > 0) return Math.ceil(d.getDate() / 7) === k;
                            const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
                            return Math.ceil((last - d.getDate() + 1) / 7) === -k;
                        });
                    } else hit = d.getDate() === day0.getDate();
                }
            } else if (r.freq === 'YEARLY') {
                hit = (d.getFullYear() - day0.getFullYear()) % r.interval === 0
                    && d.getMonth() === day0.getMonth() && d.getDate() === day0.getDate();
            }
            if (!hit) continue;
            n++;
            if (r.count && n > r.count) break;
            out.push(new Date(d.getFullYear(), d.getMonth(), d.getDate(),
                              start.getHours(), start.getMinutes(), start.getSeconds()));
        }
        return out;
    },

    /* ── 設定面板那一段 ─────────────────── */

    section() {
        const box = el('div', {});
        const input = el('input', {
            type: 'file', accept: '.ics,.zip,text/calendar,application/zip', multiple: true, hidden: true,
            onchange: async e => {
                const files = [...e.target.files];
                e.target.value = '';
                if (!files.length) return;
                try {
                    const n = await this.importFiles(files);
                    toast(`匯入了 ${n} 筆`);
                } catch (err) {
                    toast(err.message, true);
                }
                draw();
            },
        });
        const draw = () => {
            clear(box);
            const when = this.importedAt
                ? new Date(this.importedAt).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                : null;
            // 原生的 append 會把 null 寫成「null」兩個字，先濾掉
            box.append(...[
                when ? el('p', { class: 'sub', style: 'margin:0 0 10px',
                                 text: `${this.events.length} 筆・${when} 匯入` }) : null,
                el('div', { class: 'row', style: 'gap:8px' }, [
                    el('button', { type: 'button', class: 'btn small',
                                   text: when ? '重新匯入' : '匯入 Google 日曆',
                                   onclick: () => input.click() }),
                    when ? el('button', { type: 'button', class: 'btn small ghost', text: '清掉',
                                          onclick: () => { this.clearAll(); draw(); } }) : null,
                ]),
                input,
            ].filter(Boolean));
        };
        draw();
        return [el('h4', { class: 'sec', text: '其他日曆' }), box];
    },
};
