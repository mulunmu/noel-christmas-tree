export type PaletteId = 'emerald' | 'aurora' | 'ruby' | 'ice' | 'candy';

export interface Palette {
  id: PaletteId;
  label: string;
  /** 针叶主色：由深到亮 */
  needleDeep: string;
  needleBright: string;
  needleTip: string;
  /** 彩灯色池 */
  lights: string[];
  /** 挂饰光球色池 */
  orbs: string[];
  star: string;
  floor: string;
  snow: string;
  accent: string;
  skyTop: string;
  skyBottom: string;
  /** 环境补光暖色 */
  warm: string;
}

export const PALETTES: Palette[] = [
  {
    id: 'emerald',
    label: 'EMERALD / 祖母绿',
    needleDeep: '#03230f',
    needleBright: '#1fa85a',
    needleTip: '#a8ffd0',
    lights: ['#ff3b30', '#ffd23f', '#3d8bff', '#35ff9a', '#ffffff'],
    orbs: ['#ffd23f', '#ff4d4d', '#fff3d0'],
    star: '#ffdd66',
    floor: '#0b4a2a',
    snow: '#d8f2ff',
    accent: '#ffd23f',
    skyTop: '#02070a',
    skyBottom: '#000402',
    warm: '#ffd8a0',
  },
  {
    id: 'aurora',
    label: 'AURORA / 极光',
    needleDeep: '#061a33',
    needleBright: '#00d8b4',
    needleTip: '#9ff9ff',
    lights: ['#00e5ff', '#7c4dff', '#00ffa3', '#ff5edb', '#e9f7ff'],
    orbs: ['#7c4dff', '#00e5ff', '#b9fff2'],
    star: '#9ff9ff',
    floor: '#0a2b4a',
    snow: '#dff6ff',
    accent: '#7cf3ff',
    skyTop: '#040d1f',
    skyBottom: '#010207',
    warm: '#9fd8ff',
  },
  {
    id: 'ruby',
    label: 'RUBY / 红金',
    needleDeep: '#2a0505',
    needleBright: '#d32f2f',
    needleTip: '#ffb199',
    lights: ['#ffd700', '#ff5252', '#fff1a8', '#ff8a00', '#ffffff'],
    orbs: ['#ffd700', '#ff3d3d', '#ffe9b8'],
    star: '#ffe066',
    floor: '#4a1010',
    snow: '#ffe9e0',
    accent: '#ffd700',
    skyTop: '#0d0405',
    skyBottom: '#020101',
    warm: '#ffb47a',
  },
  {
    id: 'ice',
    label: 'ICE / 冰蓝',
    needleDeep: '#061626',
    needleBright: '#6fd3ff',
    needleTip: '#f2fbff',
    lights: ['#ffffff', '#8fe3ff', '#4aa8ff', '#c8f2ff', '#7c9dff'],
    orbs: ['#ffffff', '#8fe3ff', '#d9f6ff'],
    star: '#eafaff',
    floor: '#0b3350',
    snow: '#f4fdff',
    accent: '#bfefff',
    skyTop: '#050d1a',
    skyBottom: '#010308',
    warm: '#d6ecff',
  },
  {
    id: 'candy',
    label: 'CANDY / 糖果',
    needleDeep: '#2c0820',
    needleBright: '#ff5fa2',
    needleTip: '#ffd6e8',
    lights: ['#ff2d7a', '#ffe066', '#62e0ff', '#ffffff', '#b06bff'],
    orbs: ['#ff2d7a', '#ffe066', '#ffe3ef'],
    star: '#ffe066',
    floor: '#4a0f2c',
    snow: '#ffe9f4',
    accent: '#ff8fc0',
    skyTop: '#0f0410',
    skyBottom: '#020104',
    warm: '#ffc2dd',
  },
];
