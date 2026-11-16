export type ShapeId = 'fir' | 'cone' | 'spiral' | 'star';

export interface ShapeInfo {
  id: ShapeId;
  zh: string;
  en: string;
}

export const SHAPES: ShapeInfo[] = [
  { id: 'fir', zh: '冷杉', en: 'FIR' },
  { id: 'cone', zh: '尖塔', en: 'SPIRE' },
  { id: 'spiral', zh: '螺旋', en: 'HELIX' },
  { id: 'star', zh: '星芒', en: 'STAR' },
];
