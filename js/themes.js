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
        id: 'midnight', name: '夜藍', note: '深藍紫・Tokyo Night', scheme: 'dark',
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
        id: 'mocha', name: '薰衣草', note: '柔紫・Catppuccin', scheme: 'dark',
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
        id: 'rose', name: '暮玫瑰', note: '灰粉・Rosé Pine', scheme: 'dark',
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
        id: 'gruvbox', name: '土黃', note: '暖棕・Gruvbox', scheme: 'dark',
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
        id: 'sky', name: '天藍', note: '冷藍白・亮色', scheme: 'light',
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
    {
        id: 'nord', name: '深海', note: '冷灰藍・Nord', scheme: 'dark',
        vars: {
            '--bg': '#242933', '--card': '#2E3440', '--raised': '#3B4252',
            '--separator': '#4C566A',
            '--text': '#ECEFF4', '--text-2': '#AEB8C6', '--text-3': '#8996A6',
            '--accent': '#88C0D0',
            '--money': '#EBCB8B', '--memo': '#D8A48F', '--water': '#8FBCBB',
            '--sleep': '#B48EAD', '--heart': '#BF616A', '--lime': '#A3BE8C',
            '--calendar': '#D08770',
            '--good': '#A3BE8C', '--warn': '#EBCB8B', '--alert': '#BF616A',
        },
    },
    {
        id: 'grape', name: '葡萄', note: '深紫・霓虹', scheme: 'dark',
        vars: {
            '--bg': '#1A1426', '--card': '#241C33', '--raised': '#332847',
            '--separator': '#463861',
            '--text': '#E9E1F7', '--text-2': '#AEA1C9', '--text-3': '#847799',
            '--accent': '#C792EA',
            '--money': '#F5C97B', '--memo': '#E0A9C0', '--water': '#7FD4D0',
            '--sleep': '#B49BF0', '--heart': '#F07EA0', '--lime': '#B5DB77',
            '--calendar': '#F0A275',
            '--good': '#8FE0AF', '--warn': '#F0B45F', '--alert': '#F0786A',
        },
    },
    {
        id: 'cream', name: '奶油', note: '暖米黃・亮色', scheme: 'light',
        vars: {
            '--bg': '#FBF6EC', '--card': '#FFFFFF', '--raised': '#F2EADA',
            '--separator': '#E0D5BF',
            '--text': '#332F27', '--text-2': '#635C4E', '--text-3': '#8E8677',
            '--accent': '#A0701A',
            '--money': '#9C6A15', '--memo': '#8E6240', '--water': '#0D8078',
            '--sleep': '#6350BC', '--heart': '#B84459', '--lime': '#57801B',
            '--calendar': '#B25F26',
            '--good': '#2A7F52', '--warn': '#A96D18', '--alert': '#B83E2A',
        },
    },
    {
        id: 'mint', name: '薄荷', note: '淺綠・亮色', scheme: 'light',
        vars: {
            '--bg': '#EDF5F0', '--card': '#FFFFFF', '--raised': '#DDEDE4',
            '--separator': '#C3DACE',
            '--text': '#1D2A24', '--text-2': '#4B5D54', '--text-3': '#77887E',
            '--accent': '#0E7A66',
            '--money': '#9A6A16', '--memo': '#8A6045', '--water': '#0C7B84',
            '--sleep': '#5C4CB8', '--heart': '#B44059', '--lime': '#4E7A16',
            '--calendar': '#B05C26',
            '--good': '#237A4E', '--warn': '#A66A16', '--alert': '#B43A28',
        },
    },
    {
        id: 'fog', name: '霧', note: '中性灰・亮色', scheme: 'light',
        vars: {
            '--bg': '#F1F2F5', '--card': '#FFFFFF', '--raised': '#E5E7EC',
            '--separator': '#D0D4DC',
            '--text': '#21242A', '--text-2': '#4F545E', '--text-3': '#7B818C',
            '--accent': '#4C5F8A',
            '--money': '#96690F', '--memo': '#84604A', '--water': '#0B7880',
            '--sleep': '#5A4EB0', '--heart': '#B03E58', '--lime': '#4C7714',
            '--calendar': '#AC5A25',
            '--good': '#217449', '--warn': '#A06714', '--alert': '#B03726',
        },
    },
];

const DEFAULT_THEME = 'starcal';

const theme = id => THEMES.find(t => t.id === id) || THEMES[0];
