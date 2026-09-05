/* 自動分類。
 *
 * 她的原話是「分類（不知道怎麼分）輸入進去後可以幫我自動分類是哪個分類、
 * 不一定要更多分類」——**重點在最後那半句**：問題不是分類不夠，
 * 是每記一筆都要停下來想「這算飲食還是日用」。
 *
 * ── 先學她自己的，再用常識 ────────────────────────
 *
 * 這個順序不能反。看她已經記過的：
 *   7-11、全家、萊爾富、健康餐盒 → 飲食
 *   調理水、Mac訂金 → 日用
 *
 * 「調理水」照常識會猜成飲食（那是喝的），但在她這裡是日用。
 * **她自己記過的永遠贏過任何內建的表**——那是她的分法，不是我的。
 *
 * ── 猜錯比猜不到糟嗎 ──────────────────────────────
 *
 * 不會，只要猜完看得見而且改得動。所以猜出來的分類會直接填進下拉、
 * 旁邊寫一句「照『全家』猜的」——她一眼就看得出這是猜的，不是她選的。
 * 完全不猜的話，每一筆都要自己選，那才是真正的成本。
 */

/** 內建關鍵字。只放**幾乎不會錯**的，猜不準的寧可不猜。 */
const CATEGORY_HINTS = [
    ['飲食', ['7-11', '711', '7-ELEVEN', '全家', '萊爾富', 'OK超商', '美廉社',
              '星巴克', '路易莎', '85度C', '清心', '五十嵐', '迷客夏',
              '麥當勞', '肯德基', '摩斯', 'субway', 'subway',
              '便當', '餐盒', '早餐', '午餐', '晚餐', '宵夜', '飲料', '咖啡',
              '滷味', '雞排', '火鍋', '拉麵', '牛排', 'food', '吃']],
    ['交通', ['高鐵', '台鐵', '客運', '公車', '捷運', '悠遊卡', '一卡通',
              'uber', 'UBER', '計程車', '加油', '中油', '台塑', '停車',
              '機車', '油錢', '車票']],
    ['居家', ['房租', '水費', '電費', '瓦斯', '網路費', '管理費', '第四台']],
    ['日用', ['全聯', '家樂福', '大潤發', '寶雅', '屈臣氏', '康是美',
              '藥妝', '衛生紙', '洗髮', '沐浴', '牙膏', '日用品']],
    ['醫療', ['診所', '醫院', '藥局', '掛號', '看醫生', '牙醫', '眼科', '健保']],
    ['服飾', ['uniqlo', 'UNIQLO', 'net', 'GU', '衣服', '褲子', '鞋子', '外套']],
    ['娛樂', ['電影', '威秀', '國賓', 'netflix', 'NETFLIX', 'spotify', 'Spotify',
              'youtube', 'YouTube', 'KTV', '唱歌', '遊戲', 'steam', 'Steam']],
    ['學習', ['書', '文具', '課本', '影印', '列印', '報名費', '學費', '補習']],
    ['人情', ['紅包', '禮物', '請客', '婚禮', '喜酒', '包禮']],
];

const AutoCat = {
    HINTS: CATEGORY_HINTS,

    /** 正規化：大小寫、全半形空白、常見的分隔符都不影響比對 */
    norm(text) {
        return String(text || '')
            .toLowerCase()
            .replace(/[\s　]+/g, '')
            .trim();
    },

    /**
     * 猜這筆該是什麼分類。
     *
     * @param note       備註（店名、買了什麼）
     * @param history    她記過的帳，新的在前面比較好（會取第一個對上的）
     * @param allowed    現有的分類名單，不在名單裡的不猜
     * @returns {{category, reason}|null}  reason 是「照什麼猜的」，要給她看
     */
    guess(note, history = [], allowed = []) {
        const text = this.norm(note);
        if (!text) return null;

        const ok = name => !allowed.length || allowed.includes(name);

        // 1. 她自己記過的。完全一樣的優先，其次是包含。
        //    **這一層永遠贏過內建的表**——那是她的分法。
        let contains = null;
        for (const t of history) {
            const past = this.norm(t.note);
            if (!past || !t.category || !ok(t.category)) continue;
            if (past === text) {
                return { category: t.category, reason: `你上次「${t.note}」記在這裡` };
            }
            if (!contains && (text.includes(past) || past.includes(text))) {
                contains = { category: t.category, reason: `你上次「${t.note}」記在這裡` };
            }
        }
        if (contains) return contains;

        // 2. 內建關鍵字。只放幾乎不會錯的。
        for (const [category, words] of this.HINTS) {
            if (!ok(category)) continue;
            for (const w of words) {
                if (text.includes(this.norm(w))) {
                    return { category, reason: `看到「${w}」` };
                }
            }
        }
        return null;
    },
};
