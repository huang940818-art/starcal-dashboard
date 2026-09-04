/* 主題。
 *
 * **第一版的「主題色」只換了 --accent 一個變數**，背景、卡片、文字全沒動——
 * 換完幾乎看不出差別，等於沒有這個功能。她的原話是「有跟沒有一樣」，
 * 而且她是對的。
 *
 * 所以主題現在是**一整組配色**：背景、卡片、分隔線、三層文字、主色，
 * 加上七個分類色。淺色主題不換分類色的話，那些為深底調的粉彩在白紙上
 * 會淡到看不見——「換一個主題就有一半的東西不見了」比不給換更糟。
 *
 * 幾個配色有來歷（Tokyo Night、Catppuccin、Rosé Pine、Gruvbox），
 * 不是自己調的——那些是很多人盯過很久的配色，對比和層次都站得住。
 * 預設那組「星歷」是從 iOS 星歷的 App icon 長出來的，維持原樣。
 */

const THEMES = [
    {
        id: 'starcal', name: '星歷', note: '墨綠 × 星星黃', scheme: 'dark',
        vars: {
            '--bg': '#132019', '--card': '#1D3125', '--raised': '#2A4937',
            '--separator': '#31543E',
            '--text': '#F2EFE4', '--text-2': '#9FB3A6', '--text-3': '#6B8375',
            '--accent': '#F9D984',
            '--money': '#E8C46A', '--memo': '#D9B48F', '--water': '#5FC9C0',
            '--sleep': '#A99BE8', '--heart': '#EE8FA3', '--lime': '#B8D96F',
            '--calendar': '#E8A87C',
            '--good': '#7FD9A8', '--warn': '#F0B45F', '--alert': '#E8836F',
        },
    },
    {
        id: 'midnight', name: '午夜', note: '深藍紫・Tokyo Night', scheme: 'dark',
        vars: {
            '--bg': '#1A1B26', '--card': '#1F2335', '--raised': '#292E42',
            '--separator': '#3B4261',
            '--text': '#C0CAF5', '--text-2': '#8B93B8', '--text-3': '#5E6687',
            '--accent': '#7AA2F7',
            '--money': '#E0AF68', '--memo': '#C3A6FF', '--water': '#7DCFFF',
            '--sleep': '#BB9AF7', '--heart': '#F7768E', '--lime': '#9ECE6A',
            '--calendar': '#FF9E64',
            '--good': '#9ECE6A', '--warn': '#E0AF68', '--alert': '#F7768E',
        },
    },
    {
        id: 'mocha', name: '摩卡', note: '奶油紫・Catppuccin', scheme: 'dark',
        vars: {
            '--bg': '#181825', '--card': '#1E1E2E', '--raised': '#313244',
            '--separator': '#45475A',
            '--text': '#CDD6F4', '--text-2': '#A6ADC8', '--text-3': '#7F849C',
            '--accent': '#CBA6F7',
            '--money': '#F9E2AF', '--memo': '#F2CDCD', '--water': '#94E2D5',
            '--sleep': '#B4BEFE', '--heart': '#F5C2E7', '--lime': '#A6E3A1',
            '--calendar': '#FAB387',
            '--good': '#A6E3A1', '--warn': '#F9E2AF', '--alert': '#F38BA8',
        },
    },
    {
        id: 'rose', name: '玫瑰松', note: '暗紫粉・Rosé Pine', scheme: 'dark',
        vars: {
            '--bg': '#191724', '--card': '#1F1D2E', '--raised': '#26233A',
            '--separator': '#403D52',
            '--text': '#E0DEF4', '--text-2': '#908CAA', '--text-3': '#6E6A86',
            '--accent': '#EBBCBA',
            '--money': '#F6C177', '--memo': '#EBBCBA', '--water': '#9CCFD8',
            '--sleep': '#C4A7E7', '--heart': '#EB6F92', '--lime': '#A3BE8C',
            '--calendar': '#F6C177',
            '--good': '#9CCFD8', '--warn': '#F6C177', '--alert': '#EB6F92',
        },
    },
    {
        id: 'gruvbox', name: '暖褐', note: '土黃棕・Gruvbox', scheme: 'dark',
        vars: {
            '--bg': '#1D2021', '--card': '#282828', '--raised': '#3C3836',
            '--separator': '#504945',
            '--text': '#EBDBB2', '--text-2': '#BDAE93', '--text-3': '#928374',
            '--accent': '#FABD2F',
            '--money': '#FABD2F', '--memo': '#D3869B', '--water': '#8EC07C',
            '--sleep': '#D3869B', '--heart': '#FB4934', '--lime': '#B8BB26',
            '--calendar': '#FE8019',
            '--good': '#B8BB26', '--warn': '#FABD2F', '--alert': '#FB4934',
        },
    },
    {
        id: 'ink', name: '極夜', note: '近黑・高對比', scheme: 'dark',
        vars: {
            '--bg': '#0A0A0C', '--card': '#141417', '--raised': '#1F1F24',
            '--separator': '#2E2E36',
            '--text': '#F2F2F5', '--text-2': '#A8A8B3', '--text-3': '#74747F',
            '--accent': '#8AB4F8',
            '--money': '#F4C77B', '--memo': '#D8B4A0', '--water': '#6BD8CF',
            '--sleep': '#B0A2F0', '--heart': '#F290A8', '--lime': '#BEE076',
            '--calendar': '#F0A87E',
            '--good': '#7FD9A8', '--warn': '#F0B45F', '--alert': '#F0786A',
        },
    },
    {
        id: 'paper', name: '紙', note: '米白・亮色', scheme: 'light',
        vars: {
            '--bg': '#F4F1E8', '--card': '#FFFDF8', '--raised': '#EAE5D8',
            '--separator': '#D6D0BE',
            '--text': '#2B2A25', '--text-2': '#5F5C51', '--text-3': '#8C887C',
            '--accent': '#A87215',
            // 亮底上的分類色全部要調暗調濃。照搬深色那組的話，
            // 那些粉彩在白紙上淡到看不見。
            '--money': '#A9761A', '--memo': '#9A6A44', '--water': '#0F8C84',
            '--sleep': '#6B5AC4', '--heart': '#C24A66', '--lime': '#5E8A1E',
            '--calendar': '#C06A2E',
            '--good': '#2E8B5A', '--warn': '#B87A1E', '--alert': '#C2452F',
        },
    },
    {
        id: 'sky', name: '晴空', note: '灰藍・亮色', scheme: 'light',
        vars: {
            '--bg': '#EEF2F7', '--card': '#FFFFFF', '--raised': '#E1E8F0',
            '--separator': '#C9D3DF',
            '--text': '#1F2933', '--text-2': '#52606D', '--text-3': '#7B8794',
            '--accent': '#2563C7',
            '--money': '#A9761A', '--memo': '#8A6248', '--water': '#0E7C86',
            '--sleep': '#6247C4', '--heart': '#BE3D63', '--lime': '#4F7A16',
            '--calendar': '#C0622A',
            '--good': '#25794F', '--warn': '#B0741C', '--alert': '#C03A28',
        },
    },
];

const DEFAULT_THEME = 'starcal';

const theme = id => THEMES.find(t => t.id === id) || THEMES[0];
