import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Environment, OrbitControls, PerspectiveCamera, Sparkles, Stars } from '@react-three/drei';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { MathUtils } from 'three';
import type { Palette } from './palettes';
import type { ShapeId } from './shapes';

export type TreeMode = 'ASSEMBLED' | 'DISPERSE';

const TREE_HEIGHT = 22;
const TREE_RADIUS = 10.4;
const GROUND_Y = -TREE_HEIGHT / 2;

/* ------------------------------------------------------------------ */
/* Shared uniforms                                                    */
/* ------------------------------------------------------------------ */

interface SharedUniforms {
  uTime: { value: number };
  uProgress: { value: number };
  uBurst: { value: number };
  uVortex: { value: number };
  uPixelRatio: { value: number };
}

/* ------------------------------------------------------------------ */
/* Shaders                                                            */
/* ------------------------------------------------------------------ */

const POINT_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSoft;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;
    float core = smoothstep(0.5, 0.04, d);
    float glow = pow(core, mix(2.1, 1.0, vSoft));
    gl_FragColor = vec4(vColor, glow * vAlpha);
  }
`;

const TREE_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uProgress;
  uniform float uBurst;
  uniform float uVortex;
  uniform float uPixelRatio;
  uniform float uAlpha;

  attribute vec3 aScatter;
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aSeed;
  attribute float aPhase;
  attribute float aKind;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vSoft;

  mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

  void main() {
    vec3 formed = position;
    vec3 scattered = aScatter;

    // 散开态：缓慢自转 + 上下漂浮
    scattered.xz = rot2(uTime * (0.10 + aSeed * 0.26)) * scattered.xz;
    scattered.y += sin(uTime * 0.55 + aPhase) * 1.6;

    float p = smoothstep(0.0, 1.0, uProgress);
    vec3 pos = mix(scattered, formed, p);

    // 涡旋
    float vortex = uVortex * (0.35 + 0.65 * (1.0 - p));
    float twist = vortex * (1.7 + pos.y * 0.25);
    pos.xz = rot2(uTime * (2.2 + aSeed * 1.2) * vortex + twist) * pos.xz;
    pos.xz *= 1.0 - 0.30 * vortex;
    pos.y += sin(uTime * 1.1 + aPhase + pos.y * 0.3) * 1.6 * vortex;

    // 聚合态：风雪中的轻微摇曳
    float sway = sin(uTime * 0.8 + aPhase * 3.0 + pos.y * 0.2);
    pos.x += sway * 0.12 * p;
    pos.z += cos(uTime * 0.65 + aPhase * 2.1) * 0.12 * p;
    pos.y += sin(uTime * 1.5 + aPhase * 4.0) * 0.05 * p;

    // 爆裂
    vec3 dir = normalize(pos + vec3(0.0001, 0.0001, 0.0001));
    pos += dir * uBurst * (4.0 + aSeed * 16.0);

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;

    float twinkle = 0.6 + 0.4 * sin(uTime * (1.4 + aSeed * 3.4) + aPhase * 6.2831);
    float lightMask = 0.0;
    if (aKind > 0.5 && aKind < 1.5) lightMask = 1.0;
    if (aKind > 4.5 && aKind < 5.5) lightMask = 1.0;
    float blink = mix(1.0, 0.25 + 0.75 * twinkle, lightMask);

    gl_PointSize = aSize * uPixelRatio * (300.0 / max(1.0, -mv.z)) * (0.82 + 0.30 * twinkle);

    vColor = aColor * (0.70 + 0.55 * twinkle) * blink;
    float fade = 1.0 - smoothstep(95.0, 155.0, -mv.z);
    vAlpha = (aKind > 1.5 ? 0.95 : 0.80) * blink * (0.55 + 0.45 * twinkle) * fade * uAlpha;
    vSoft = aKind > 1.5 ? 0.55 : 0.0;
  }
`;

const SNOW_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uBurst;
  uniform float uIntensity;
  uniform vec3 uColor;

  attribute float aSize;
  attribute float aSeed;
  attribute float aPhase;
  attribute float aLayer;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vSoft;

  void main() {
    vec3 pos = position;
    float speed = (0.9 + aSeed * 2.6) * (0.75 + 0.3 * uIntensity) * (0.6 + 0.6 * aLayer);
    pos.y = mod(pos.y - uTime * speed + 24.0, 48.0) - 24.0;

    float gust = sin(uTime * 0.31) * 1.8 + sin(uTime * 0.83 + 1.7) * 0.9;
    float wind = (uIntensity - 1.0) * 1.6;
    pos.x += sin(uTime * 0.55 + aPhase) * 1.4 + gust + wind * sin(uTime * 1.3 + aPhase);
    pos.z += cos(uTime * 0.44 + aPhase * 1.7) * 1.4 + gust * 0.5 + wind * cos(uTime * 1.1 + aPhase);
    pos.xz += vec2(pos.x, pos.z) * uBurst * 0.3;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;

    float near = smoothstep(14.0, 7.0, -mv.z);
    float sizeBase = aSize * (1.0 + near * 1.6) * uIntensity * uPixelRatio * (300.0 / max(1.0, -mv.z));
    gl_PointSize = min(sizeBase, 64.0);

    float shimmer = 0.5 + 0.5 * sin(uTime * (1.1 + aSeed * 2.2) + aPhase);
    vColor = uColor * (0.85 + 0.4 * shimmer);
    float nearFade = smoothstep(3.0, 7.0, -mv.z);
    vAlpha = (0.20 + 0.30 * shimmer) * mix(0.7, 1.0, aLayer) * nearFade * min(1.25, 0.6 + 0.5 * uIntensity);
    vSoft = 0.35 + 0.6 * aLayer + near * 0.4;
  }
`;

const TERRAIN_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  uniform vec3 uColorLow;
  uniform vec3 uColorHigh;

  attribute float aSize;
  attribute float aSeed;
  attribute float aPhase;
  attribute float aCrest;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vSoft;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;

    float twinkle = 0.6 + 0.4 * sin(uTime * (0.7 + aSeed * 2.2) + aPhase);
    float sizeBase = aSize * uPixelRatio * (320.0 / max(1.0, -mv.z)) * (0.75 + 0.35 * twinkle);
    gl_PointSize = min(sizeBase, 22.0);

    vColor = mix(uColorLow, uColorHigh, aCrest) * (0.62 + 0.55 * twinkle);
    float fade = 1.0 - smoothstep(60.0, 130.0, -mv.z);
    vAlpha = (0.26 + 0.26 * twinkle) * fade;
    vSoft = 0.18;
  }
`;

const MOON_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  uniform vec3 uColor;
  attribute float aSize;
  attribute float aSeed;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSoft;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float shimmer = 0.8 + 0.2 * sin(uTime * 0.8 + aSeed * 6.0);
    gl_PointSize = aSize * uPixelRatio * (380.0 / max(1.0, -mv.z)) * shimmer;
    vColor = uColor * shimmer;
    vAlpha = 0.55;
    vSoft = 0.35;
  }
`;

const SHOCK_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uShock;
  uniform float uPixelRatio;

  attribute vec3 aDir;
  attribute float aSize;
  attribute float aSeed;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vSoft;

  void main() {
    float radius = 1.0 + uShock * 42.0;
    vec3 pos = aDir * radius;
    pos.y += sin(uTime * 2.0 + aSeed * 6.28) * 0.4;
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;

    gl_PointSize = aSize * uPixelRatio * (320.0 / max(1.0, -mv.z));

    vColor = vec3(1.0, 0.85, 0.5);
    vAlpha = (1.0 - uShock) * 0.7;
    vSoft = 0.2;
  }
`;

const SKY_VERT = /* glsl */ `
  varying vec3 vPos;
  void main() {
    vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uMoonDir;
  uniform vec3 uMoonColor;
  varying vec3 vPos;
  void main() {
    vec3 n = normalize(vPos);
    float h = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 col = mix(uHorizon, uTop, pow(h, 1.25));
    float moonGlow = pow(max(dot(n, normalize(uMoonDir)), 0.0), 12.0);
    col += uMoonColor * moonGlow * 0.35;
    gl_FragColor = vec4(col, 1.0);
  }
`;

/* ------------------------------------------------------------------ */
/* Shape helpers & geometry builders                                  */
/* ------------------------------------------------------------------ */

const NEEDLES = 26000;
const SNOW_CAPS = 2200;
const TRUNK = 700;
const LIGHT_STRANDS = 7;
const LIGHTS_PER_STRAND = 72;
const LIGHT_COUNT = LIGHT_STRANDS * LIGHTS_PER_STRAND;
const ORB_COUNT = 190;
const GARLAND_STRANDS = 3;
const GARLAND_PER_STRAND = 120;
const GARLAND_COUNT = GARLAND_STRANDS * GARLAND_PER_STRAND;
const DUST_COUNT = 1600;
const TREE_PARTICLES = NEEDLES + SNOW_CAPS + TRUNK + LIGHT_COUNT + ORB_COUNT + GARLAND_COUNT + DUST_COUNT;
const SNOW_COUNT = 5600;
const TERRAIN_COUNT = 46000;
const MOON_COUNT = 320;

/** 场景可见粒子总数（供 UI 展示） */
export const PARTICLE_TOTAL = TREE_PARTICLES * 2 + SNOW_COUNT + TERRAIN_COUNT + MOON_COUNT;

/** 树的四种轮廓：冷杉分层 / 尖塔 / 螺旋 / 星芒 */
function shapeRadius(shape: ShapeId, t: number, theta: number): number {
  const base = TREE_RADIUS * Math.pow(1 - t, shape === 'star' ? 0.72 : 0.9) + 0.22;
  if (shape === 'fir') {
    const phase = t * 7;
    const frac = phase - Math.floor(phase);
    const scallop = 0.84 + 0.16 * Math.pow(Math.sin(Math.PI * frac), 0.65);
    return base * scallop;
  }
  if (shape === 'star') {
    const lobes = 0.26 + 0.74 * Math.pow(Math.abs(Math.cos(3 * theta)), 0.55);
    return base * lobes + 0.1;
  }
  return base;
}

function scatterPoint(target: Float32Array, i: number) {
  const radius = 24 + Math.random() * 28;
  const u = Math.random() * 2 - 1;
  const phi = Math.random() * Math.PI * 2;
  const s = Math.sqrt(Math.max(0, 1 - u * u));
  target[i * 3] = radius * s * Math.cos(phi);
  target[i * 3 + 1] = u * radius * 0.8;
  target[i * 3 + 2] = radius * s * Math.sin(phi);
}

function buildTreeField(palette: Palette, shape: ShapeId): THREE.BufferGeometry {
  const position = new Float32Array(TREE_PARTICLES * 3);
  const scatter = new Float32Array(TREE_PARTICLES * 3);
  const color = new Float32Array(TREE_PARTICLES * 3);
  const size = new Float32Array(TREE_PARTICLES);
  const seed = new Float32Array(TREE_PARTICLES);
  const phase = new Float32Array(TREE_PARTICLES);
  const kind = new Float32Array(TREE_PARTICLES);

  const deep = new THREE.Color(palette.needleDeep);
  const bright = new THREE.Color(palette.needleBright);
  const tip = new THREE.Color(palette.needleTip);
  const snowColor = new THREE.Color(palette.snow);
  const trunkColor = new THREE.Color('#2b1d14');
  const c = new THREE.Color();

  let i = 0;

  // --- 针叶（形状可变：冷杉 / 尖塔 / 螺旋 / 星芒）---
  for (let n = 0; n < NEEDLES; n++, i++) {
    const t = Math.pow(Math.random(), 0.66);
    let theta = Math.random() * Math.PI * 2;
    let rMax = shapeRadius(shape, t, theta);
    let r: number;
    let droop = 0;

    if (shape === 'spiral') {
      const strand = Math.floor(Math.random() * 2);
      theta = t * Math.PI * 2 * 8.5 + (strand * Math.PI * 2) / 2 + (Math.random() - 0.5) * 0.1;
      rMax = shapeRadius(shape, t, theta);
      r = rMax * (0.97 + Math.random() * 0.03);
      droop = 0.15;
    } else if (shape === 'star') {
      r = rMax * (0.68 + 0.32 * Math.pow(Math.random(), 0.5));
      droop = 0.16;
    } else {
      const radial = Math.pow(Math.random(), shape === 'cone' ? 0.35 : 0.5);
      r = rMax * (shape === 'cone' ? 0.55 + 0.45 * radial : 0.30 + 0.70 * radial);
      droop = radial * (shape === 'cone' ? 0.18 : 0.45);
    }

    position[i * 3] = Math.cos(theta) * r;
    position[i * 3 + 1] = GROUND_Y + TREE_HEIGHT * t - droop + (Math.random() - 0.5) * 0.18;
    position[i * 3 + 2] = Math.sin(theta) * r;

    // 颜色随高度变化：底部深绿、顶部亮绿，穿插少量金色亮片
    c.copy(deep).lerp(bright, Math.min(1, 0.18 + t * 0.55 + Math.random() * 0.25));
    if (Math.random() < 0.03) c.lerp(tip, 0.5);
    if (Math.random() < 0.012) c.lerp(new THREE.Color('#ffe6a0'), 0.7);
    // 树尖压光：避免顶部过曝成一团白光
    const dimTop = 1 - 0.5 * MathUtils.smoothstep(t, 0.78, 1.0);
    color[i * 3] = c.r * dimTop;
    color[i * 3 + 1] = c.g * dimTop;
    color[i * 3 + 2] = c.b * dimTop;

    size[i] = (0.26 + Math.random() * 0.44 + (r / Math.max(rMax, 0.001) > 0.92 ? 0.16 : 0)) * (1 - 0.3 * MathUtils.smoothstep(t, 0.85, 1.0));
    seed[i] = Math.random();
    phase[i] = Math.random() * Math.PI * 2;
    kind[i] = 0;
    scatterPoint(scatter, i);
  }

  // --- 枝头积雪 ---
  for (let n = 0; n < SNOW_CAPS; n++, i++) {
    // 树尖不铺雪，避免顶部过亮
    const t = Math.pow(Math.random(), 0.72) * 0.92;
    let theta = Math.random() * Math.PI * 2;
    if (shape === 'spiral') {
      const strand = Math.floor(Math.random() * 2);
      theta = t * Math.PI * 2 * 8.5 + (strand * Math.PI * 2) / 2;
    }
    const rMax = shapeRadius(shape, t, theta);
    const r = rMax * (0.6 + Math.random() * 0.4);

    position[i * 3] = Math.cos(theta) * r;
    position[i * 3 + 1] = GROUND_Y + TREE_HEIGHT * t + 0.18 + Math.random() * 0.22;
    position[i * 3 + 2] = Math.sin(theta) * r;

    c.copy(snowColor).lerp(new THREE.Color('#ffffff'), Math.random() * 0.32);
    const dimCap = 1 - 0.35 * MathUtils.smoothstep(t, 0.72, 0.94);
    color[i * 3] = c.r * dimCap;
    color[i * 3 + 1] = c.g * dimCap;
    color[i * 3 + 2] = c.b * dimCap;

    size[i] = 0.34 + Math.random() * 0.4;
    seed[i] = Math.random();
    phase[i] = Math.random() * Math.PI * 2;
    kind[i] = 3;
    scatterPoint(scatter, i);
  }

  // --- 树干 ---
  for (let n = 0; n < TRUNK; n++, i++) {
    const theta = Math.random() * Math.PI * 2;
    const r = Math.pow(Math.random(), 2) * 0.9;
    position[i * 3] = Math.cos(theta) * r;
    position[i * 3 + 1] = GROUND_Y + Math.pow(Math.random(), 1.6) * 5.5;
    position[i * 3 + 2] = Math.sin(theta) * r;

    c.copy(trunkColor).lerp(new THREE.Color('#5a3a24'), Math.random() * 0.6);
    color[i * 3] = c.r;
    color[i * 3 + 1] = c.g;
    color[i * 3 + 2] = c.b;

    size[i] = 0.5 + Math.random() * 0.5;
    seed[i] = Math.random();
    phase[i] = Math.random() * Math.PI * 2;
    kind[i] = 4;
    scatterPoint(scatter, i);
  }

  // --- 螺旋彩灯 ---
  const lightColors = palette.lights.map((hex) => new THREE.Color(hex));
  for (let s = 0; s < LIGHT_STRANDS; s++) {
    for (let k = 0; k < LIGHTS_PER_STRAND; k++, i++) {
      const t = (k + 0.5) / LIGHTS_PER_STRAND;
      const theta = t * Math.PI * 2 * 6.2 + (s * Math.PI * 2) / LIGHT_STRANDS;
      const rMax = shapeRadius(shape, t, theta);
      const y = GROUND_Y + TREE_HEIGHT * (0.03 + t * 0.88);

      position[i * 3] = Math.cos(theta) * rMax * 1.06 + (Math.random() - 0.5) * 0.14;
      position[i * 3 + 1] = y + (Math.random() - 0.5) * 0.12;
      position[i * 3 + 2] = Math.sin(theta) * rMax * 1.06 + (Math.random() - 0.5) * 0.14;

      c.copy(lightColors[(s * LIGHTS_PER_STRAND + k) % lightColors.length]);
      const dimLight = 1 - 0.4 * MathUtils.smoothstep(t, 0.8, 1.0);
      color[i * 3] = c.r * dimLight;
      color[i * 3 + 1] = c.g * dimLight;
      color[i * 3 + 2] = c.b * dimLight;

      size[i] = 1.0 + Math.random() * 0.85;
      seed[i] = Math.random();
      phase[i] = Math.random() * Math.PI * 2;
      kind[i] = 1;
      scatterPoint(scatter, i);
    }
  }

  // --- 挂饰光球（纯粒子，替代金属球）---
  const orbColors = palette.orbs.map((hex) => new THREE.Color(hex));
  for (let o = 0; o < ORB_COUNT; o++, i++) {
    const t = Math.pow(Math.random(), 0.7);
    const theta = Math.random() * Math.PI * 2;
    const rMax = shapeRadius(shape, t, theta);
    const r = rMax * (0.98 + Math.random() * 0.08);

    position[i * 3] = Math.cos(theta) * r;
    position[i * 3 + 1] = GROUND_Y + TREE_HEIGHT * t + 0.1;
    position[i * 3 + 2] = Math.sin(theta) * r;

    c.copy(orbColors[o % orbColors.length]);
    const dimOrb = 1 - 0.35 * MathUtils.smoothstep(t, 0.82, 1.0);
    color[i * 3] = c.r * dimOrb;
    color[i * 3 + 1] = c.g * dimOrb;
    color[i * 3 + 2] = c.b * dimOrb;

    size[i] = 1.6 + Math.random() * 1.1;
    seed[i] = Math.random();
    phase[i] = Math.random() * Math.PI * 2;
    kind[i] = 2;
    scatterPoint(scatter, i);
  }

  // --- 暖金珠链：细灯串螺旋缠绕，增加层次 ---
  const garlandColors = [new THREE.Color('#ffe9b0'), new THREE.Color('#fff6dd'), new THREE.Color('#ffd76a')];
  for (let s = 0; s < GARLAND_STRANDS; s++) {
    for (let k = 0; k < GARLAND_PER_STRAND; k++, i++) {
      const t = (k + 0.5) / GARLAND_PER_STRAND;
      const theta = t * Math.PI * 2 * 9 + (s * Math.PI * 2) / GARLAND_STRANDS + 0.6;
      const rMax = shapeRadius(shape, t, theta);
      const r = rMax * 1.08;

      position[i * 3] = Math.cos(theta) * r;
      position[i * 3 + 1] = GROUND_Y + TREE_HEIGHT * (0.02 + t * 0.95);
      position[i * 3 + 2] = Math.sin(theta) * r;

      c.copy(garlandColors[(s + k) % garlandColors.length]);
      const dimGarland = 1 - 0.35 * MathUtils.smoothstep(t, 0.82, 1.0);
      color[i * 3] = c.r * dimGarland;
      color[i * 3 + 1] = c.g * dimGarland;
      color[i * 3 + 2] = c.b * dimGarland;

      size[i] = 0.68 + Math.random() * 0.5;
      seed[i] = Math.random();
      phase[i] = Math.random() * Math.PI * 2;
      kind[i] = 5;
      scatterPoint(scatter, i);
    }
  }

  // --- 金色浮尘：树体内漂浮的细碎光点 ---
  const dustColors = [new THREE.Color('#ffd76a'), new THREE.Color('#fff2c8'), new THREE.Color('#c8f0dd')];
  for (let d = 0; d < DUST_COUNT; d++, i++) {
    const t = Math.pow(Math.random(), 0.75);
    const theta = Math.random() * Math.PI * 2;
    const rMax = shapeRadius(shape, t, theta);
    const r = rMax * Math.pow(Math.random(), 0.75) * 0.95;

    position[i * 3] = Math.cos(theta) * r;
    position[i * 3 + 1] = GROUND_Y + TREE_HEIGHT * t + (Math.random() - 0.5) * 0.9;
    position[i * 3 + 2] = Math.sin(theta) * r;

    c.copy(dustColors[d % dustColors.length]);
    color[i * 3] = c.r;
    color[i * 3 + 1] = c.g;
    color[i * 3 + 2] = c.b;

    size[i] = 0.16 + Math.random() * 0.3;
    seed[i] = Math.random();
    phase[i] = Math.random() * Math.PI * 2;
    kind[i] = 6;
    scatterPoint(scatter, i);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('aScatter', new THREE.BufferAttribute(scatter, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  geometry.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
  return geometry;
}

function buildSnowfall(): THREE.BufferGeometry {
  const position = new Float32Array(SNOW_COUNT * 3);
  const size = new Float32Array(SNOW_COUNT);
  const seed = new Float32Array(SNOW_COUNT);
  const phase = new Float32Array(SNOW_COUNT);
  const layer = new Float32Array(SNOW_COUNT);
  for (let i = 0; i < SNOW_COUNT; i++) {
    const r = Math.sqrt(Math.random()) * 38;
    const theta = Math.random() * Math.PI * 2;
    const d = Math.random();
    const l = d < 0.55 ? 0 : d < 0.87 ? 1 : 2;
    position[i * 3] = Math.cos(theta) * r;
    position[i * 3 + 1] = (Math.random() - 0.5) * 48;
    position[i * 3 + 2] = Math.sin(theta) * r;
    size[i] = l === 0 ? 0.16 + Math.random() * 0.24 : l === 1 ? 0.3 + Math.random() * 0.35 : 0.45 + Math.random() * 0.5;
    seed[i] = Math.random();
    phase[i] = Math.random() * Math.PI * 2;
    layer[i] = l;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  geometry.setAttribute('aLayer', new THREE.BufferAttribute(layer, 1));
  return geometry;
}

/** 起伏波状的雪地：树附近平坦，向远处逐渐隆起成雪丘 */
function duneHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const amp = 0.18 + MathUtils.smoothstep(r, 10, 70) * 1.7;
  const h =
    Math.sin(x * 0.16) * Math.cos(z * 0.13) * 0.9 +
    Math.sin(x * 0.07 + z * 0.09) * 0.6 +
    Math.cos(x * 0.31 + z * 0.27) * 0.18;
  return h * amp;
}

function buildTerrain(): THREE.BufferGeometry {
  const position = new Float32Array(TERRAIN_COUNT * 3);
  const size = new Float32Array(TERRAIN_COUNT);
  const seed = new Float32Array(TERRAIN_COUNT);
  const phase = new Float32Array(TERRAIN_COUNT);
  const crest = new Float32Array(TERRAIN_COUNT);

  let minH = Infinity;
  let maxH = -Infinity;
  const heights = new Float32Array(TERRAIN_COUNT);

  for (let i = 0; i < TERRAIN_COUNT; i++) {
    const radius = 135 * Math.pow(Math.random(), 0.7);
    const theta = Math.random() * Math.PI * 2;
    const x = Math.cos(theta) * radius;
    const z = Math.sin(theta) * radius;
    const h = duneHeight(x, z);
    heights[i] = h;
    if (h < minH) minH = h;
    if (h > maxH) maxH = h;

    position[i * 3] = x;
    position[i * 3 + 1] = GROUND_Y + h + (Math.random() - 0.5) * 0.16;
    position[i * 3 + 2] = z;

    size[i] = 0.5 + Math.random() * 0.55;
    seed[i] = Math.random();
    phase[i] = Math.random() * Math.PI * 2;
  }

  const span = Math.max(0.001, maxH - minH);
  for (let i = 0; i < TERRAIN_COUNT; i++) {
    crest[i] = Math.pow((heights[i] - minH) / span, 0.7);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  geometry.setAttribute('aCrest', new THREE.BufferAttribute(crest, 1));
  return geometry;
}

/** 五角星粒子群（纯粒子，替代网格星星） */
/** 月亮：粒子盘 */
function buildMoonField(): THREE.BufferGeometry {
  const position = new Float32Array(MOON_COUNT * 3);
  const size = new Float32Array(MOON_COUNT);
  const seed = new Float32Array(MOON_COUNT);
  for (let i = 0; i < MOON_COUNT; i += 1) {
    const r = Math.sqrt(Math.random()) * 3.4;
    const theta = Math.random() * Math.PI * 2;
    position[i * 3] = Math.cos(theta) * r;
    position[i * 3 + 1] = Math.sin(theta) * r * 0.96;
    position[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
    size[i] = 0.6 + Math.random() * 0.8;
    seed[i] = Math.random();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  return geometry;
}

/** 爆裂冲击波：粒子环 */
function buildShockField(): THREE.BufferGeometry {
  const count = 720;
  const position = new Float32Array(count * 3);
  const dir = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const theta = Math.random() * Math.PI * 2;
    dir[i * 3] = Math.cos(theta);
    dir[i * 3 + 1] = (Math.random() - 0.5) * 0.06;
    dir[i * 3 + 2] = Math.sin(theta);
    size[i] = 0.8 + Math.random() * 1.2;
    seed[i] = Math.random();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('aDir', new THREE.BufferAttribute(dir, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  return geometry;
}

/* ------------------------------------------------------------------ */
/* Components                                                         */
/* ------------------------------------------------------------------ */

const TreeParticles = ({
  geometry,
  shared,
  alpha = 1,
}: {
  geometry: THREE.BufferGeometry;
  shared: SharedUniforms;
  alpha?: number;
}) => {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: TREE_VERT,
        fragmentShader: POINT_FRAG,
        uniforms: {
          uTime: shared.uTime,
          uProgress: shared.uProgress,
          uBurst: shared.uBurst,
          uVortex: shared.uVortex,
          uPixelRatio: shared.uPixelRatio,
          uAlpha: { value: alpha },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [shared, alpha],
  );

  useEffect(
    () => () => {
      material.dispose();
    },
    [material],
  );

  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={2} />;
};

const Snowfall = ({ palette, shared, intensity }: { palette: Palette; shared: SharedUniforms; intensity: number }) => {
  const geometry = useMemo(() => buildSnowfall(), []);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SNOW_VERT,
        fragmentShader: POINT_FRAG,
        uniforms: {
          uTime: shared.uTime,
          uBurst: shared.uBurst,
          uPixelRatio: shared.uPixelRatio,
          uIntensity: { value: intensity },
          uColor: { value: new THREE.Color(palette.snow) },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [shared, palette.snow, intensity],
  );

  useEffect(() => {
    const uniform = material.uniforms.uIntensity;
    if (uniform) uniform.value = intensity;
  }, [material, intensity]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={4} />;
};

const Terrain = ({ palette, shared }: { palette: Palette; shared: SharedUniforms }) => {
  const geometry = useMemo(() => buildTerrain(), []);
  const material = useMemo(() => {
    const low = new THREE.Color('#101c2c').lerp(new THREE.Color(palette.snow), 0.18);
    const high = new THREE.Color(palette.snow).lerp(new THREE.Color('#ffffff'), 0.45);
    return new THREE.ShaderMaterial({
      vertexShader: TERRAIN_VERT,
      fragmentShader: POINT_FRAG,
      uniforms: {
        uTime: shared.uTime,
        uPixelRatio: shared.uPixelRatio,
        uColorLow: { value: low },
        uColorHigh: { value: high },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }, [shared, palette.snow]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={0} />;
};

function makeGlowTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.18, 'rgba(255,255,255,0.65)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.16)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/** 树顶金星：沿用原来的立体五角星 + 光晕 + 十字星芒 */
const TopStar = ({ palette, shared }: { palette: Palette; shared: SharedUniforms }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);
  const glowMatRef = useRef<THREE.SpriteMaterial>(null);
  const flareMatRef = useRef<THREE.SpriteMaterial>(null);
  const glowTexture = useMemo(() => makeGlowTexture(), []);

  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    const outer = 1.65;
    const inner = 0.74;
    for (let i = 0; i < 10; i += 1) {
      const radius = i % 2 === 0 ? outer : inner;
      const angle = (i / 10) * Math.PI * 2 - Math.PI / 2;
      if (i === 0) shape.moveTo(radius * Math.cos(angle), radius * Math.sin(angle));
      else shape.lineTo(radius * Math.cos(angle), radius * Math.sin(angle));
    }
    shape.closePath();
    return new THREE.ExtrudeGeometry(shape, {
      depth: 0.5,
      bevelEnabled: true,
      bevelThickness: 0.14,
      bevelSize: 0.14,
      bevelSegments: 4,
    });
  }, []);

  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: palette.star,
        emissive: palette.star,
        emissiveIntensity: 0.75,
        roughness: 0.28,
        metalness: 0.9,
      }),
    [palette.star],
  );

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
      glowTexture.dispose();
    },
    [geometry, material, glowTexture],
  );

  useFrame((state, delta) => {
    if (meshRef.current) meshRef.current.rotation.y += delta * 0.35;
    const p = MathUtils.smoothstep(shared.uProgress.value, 0.15, 0.85);
    if (groupRef.current) groupRef.current.scale.setScalar(Math.max(0.0001, p));
    const time = state.clock.elapsedTime;
    if (glowMatRef.current) glowMatRef.current.opacity = (0.18 + 0.04 * Math.sin(time * 1.9)) * p;
    if (flareMatRef.current) flareMatRef.current.opacity = (0.07 + 0.02 * Math.sin(time * 1.3 + 1)) * p;
  });

  return (
    <group ref={groupRef} position={[0, TREE_HEIGHT / 2 + 2.1, 0]}>
      <mesh ref={meshRef} geometry={geometry} material={material} />
      <sprite scale={[9, 9, 1]}>
        <spriteMaterial
          ref={glowMatRef}
          map={glowTexture}
          color={palette.star}
          transparent
          opacity={0.2}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </sprite>
      <sprite scale={[28, 2.2, 1]}>
        <spriteMaterial
          ref={flareMatRef}
          map={glowTexture}
          color={palette.star}
          transparent
          opacity={0.08}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </sprite>
      <sprite scale={[2.2, 28, 1]}>
        <spriteMaterial
          map={glowTexture}
          color={palette.star}
          transparent
          opacity={0.04}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </sprite>
      <pointLight intensity={22} distance={38} decay={2} color={palette.star} />
    </group>
  );
};

const MoonCluster = () => {
  const geometry = useMemo(() => buildMoonField(), []);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: MOON_VERT,
        fragmentShader: POINT_FRAG,
        uniforms: {
          uTime: { value: 0 },
          uPixelRatio: { value: 1 },
          uColor: { value: new THREE.Color('#eef5ff') },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );

  useFrame((state) => {
    const time = state.clock.elapsedTime;
    material.uniforms.uTime.value = time;
    material.uniforms.uPixelRatio.value = state.viewport.dpr;
  });

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  return (
    <group position={[-62, 46, -120]}>
      <points geometry={geometry} material={material} frustumCulled={false} />
    </group>
  );
};

const ShockwaveParticles = ({ burstNonce }: { burstNonce: number }) => {
  const geometry = useMemo(() => buildShockField(), []);
  const pointsRef = useRef<THREE.Points>(null);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SHOCK_VERT,
        fragmentShader: POINT_FRAG,
        uniforms: {
          uTime: { value: 0 },
          uShock: { value: 0 },
          uPixelRatio: { value: 1 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  const state = useRef({ active: false, t: 0 });

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useEffect(() => {
    if (burstNonce > 0) {
      state.current.active = true;
      state.current.t = 0;
    }
  }, [burstNonce]);

  useFrame((frameState, delta) => {
    const s = state.current;
    const time = frameState.clock.elapsedTime;
    material.uniforms.uTime.value = time;
    material.uniforms.uPixelRatio.value = frameState.viewport.dpr;
    const shock = material.uniforms.uShock;
    if (!shock) return;
    if (s.active) {
      s.t += delta;
      const p = Math.min(1, s.t / 1.1);
      shock.value = p;
      if (p >= 1) s.active = false;
    } else if (shock.value !== 0) {
      shock.value = Math.max(0, shock.value - delta * 2.0);
    }
    if (pointsRef.current) pointsRef.current.visible = shock.value > 0.02;
  });

  return (
    <group position={[0, GROUND_Y + 0.2, 0]}>
      <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} renderOrder={5} visible={false} />
    </group>
  );
};

const SkyDome = ({ palette }: { palette: Palette }) => {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        uniforms: {
          uTop: { value: new THREE.Color(palette.skyTop) },
          uHorizon: { value: new THREE.Color('#0b1524').lerp(new THREE.Color(palette.floor), 0.22) },
          uMoonDir: { value: new THREE.Vector3(-0.45, 0.62, -0.65) },
          uMoonColor: { value: new THREE.Color('#cfe0ff') },
        },
        side: THREE.BackSide,
        depthWrite: false,
      }),
    [palette.skyTop, palette.floor],
  );

  useEffect(() => () => material.dispose(), [material]);

  return (
    <mesh material={material} renderOrder={-10}>
      <sphereGeometry args={[260, 32, 24]} />
    </mesh>
  );
};

/* ------------------------------------------------------------------ */
/* Scene                                                              */
/* ------------------------------------------------------------------ */

export interface TreeSceneProps {
  mode: TreeMode;
  palette: Palette;
  shape: ShapeId;
  vortex: boolean;
  burstNonce: number;
  blizzard: boolean;
}

export const TreeScene = ({ mode, palette, shape, vortex, burstNonce, blizzard }: TreeSceneProps) => {
  const groupRef = useRef<THREE.Group>(null);
  const burstPending = useRef(false);

  const shared = useMemo<SharedUniforms>(
    () => ({
      uTime: { value: 0 },
      uProgress: { value: 1 },
      uBurst: { value: 0 },
      uVortex: { value: 0 },
      uPixelRatio: { value: 1 },
    }),
    [],
  );

  const treeGeometry = useMemo(() => buildTreeField(palette, shape), [palette, shape]);

  // 换配色 / 换树形会重建几何体，旧 GPU 缓冲必须及时释放，避免显存累积导致上下文丢失
  useEffect(
    () => () => {
      treeGeometry.dispose();
    },
    [treeGeometry],
  );

  useEffect(() => {
    if (burstNonce > 0) burstPending.current = true;
  }, [burstNonce]);

  useFrame((state, delta) => {
    const time = state.clock.elapsedTime;
    shared.uTime.value = time;
    shared.uPixelRatio.value = state.viewport.dpr;

    shared.uProgress.value = MathUtils.damp(shared.uProgress.value, mode === 'ASSEMBLED' ? 1 : 0, 1.7, delta);
    shared.uVortex.value = MathUtils.damp(shared.uVortex.value, vortex ? 1 : 0, 2.2, delta);

    if (burstPending.current) {
      burstPending.current = false;
      shared.uBurst.value = 1;
    }
    shared.uBurst.value = MathUtils.damp(shared.uBurst.value, 0, 1.7, delta);

    const group = groupRef.current;
    if (group) {
      // 主体始终保持直立：只保留极轻微的自然摆动与呼吸
      group.rotation.x = MathUtils.damp(group.rotation.x, 0, 6, delta);
      group.rotation.z = Math.sin(time * 0.2) * 0.012;

      // 主体呼吸感：极轻微的整体缩放起伏
      const breath = 1 + Math.sin(time * 0.85) * 0.008;
      group.scale.setScalar(breath);
    }
  });

  const autoRotate = mode === 'ASSEMBLED' && !vortex;

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 3.2, 50]} fov={46} />
      <OrbitControls
        enablePan={false}
        enableDamping
        dampingFactor={0.07}
        minDistance={24}
        maxDistance={130}
        maxPolarAngle={Math.PI / 1.9}
        autoRotate={autoRotate}
        autoRotateSpeed={0.45}
      />

      <SkyDome palette={palette} />
      <Stars radius={150} depth={70} count={6500} factor={4} saturation={0} fade speed={0.7} />

      <hemisphereLight args={['#2b4066', '#0a0f16', 0.5]} />
      <directionalLight position={[-58, 44, -90]} intensity={0.55} color="#a9c4ff" />
      <ambientLight intensity={0.22} color={palette.warm} />
      <pointLight position={[26, 26, 22]} intensity={90} color={palette.warm} />
      <pointLight position={[-24, 10, -20]} intensity={45} color={palette.accent} />
      <Suspense fallback={null}>
        <Environment files={`${import.meta.env.BASE_URL}hdri/night.hdr`} background={false} />
      </Suspense>

      <Terrain palette={palette} shared={shared} />
      <MoonCluster />

      <group ref={groupRef}>
        <TreeParticles geometry={treeGeometry} shared={shared} />
        <TopStar palette={palette} shared={shared} />
      </group>

      {/* 雪与星尘属于环境，不随主体旋转 */}
      <Snowfall palette={palette} shared={shared} intensity={blizzard ? 2.2 : 1} />
      <Sparkles
        count={900}
        scale={[48, 36, 48]}
        size={6}
        speed={0.25}
        opacity={0.5}
        color={palette.accent}
        noise={1}
      />

      {/* 雪地里的树影倒影（纯粒子） */}
      <group scale={[1, -1, 1]} position={[0, GROUND_Y * 2, 0]} renderOrder={1}>
        <TreeParticles geometry={treeGeometry} shared={shared} alpha={0.18} />
      </group>

      <ShockwaveParticles burstNonce={burstNonce} />

      <EffectComposer>
        <Bloom luminanceThreshold={0.82} luminanceSmoothing={0.2} intensity={0.85} radius={0.5} mipmapBlur />
        <Vignette eskil={false} offset={0.2} darkness={1.05} />
      </EffectComposer>
    </>
  );
};
