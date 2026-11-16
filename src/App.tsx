import { Component, useCallback, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { Canvas, type RootState } from '@react-three/fiber';
import * as THREE from 'three';
import { PARTICLE_TOTAL, TreeScene, type TreeMode } from './scene/TreeScene';
import { PALETTES } from './scene/palettes';
import { SHAPES } from './scene/shapes';
import { useGestureControl } from './gesture/useGestureControl';

/**
 * WebGL 上下文丢失（显卡驱动重置 / 浏览器回收 GPU 资源）时，
 * 后处理组件会在渲染中抛错，直接把整个 Canvas 打成黑屏。
 * 这里兜住异常并通知 App 重建 Canvas，避免"黑屏"卡死。
 */
class SceneErrorBoundary extends Component<{ children: ReactNode; onFailure: () => void }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn('[scene] 3D 渲染异常，正在自动恢复：', error.message, info.componentStack ?? '');
    this.props.onFailure();
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="gl-fallback">
          <p>3D 场景正在自动恢复…</p>
          <span>若 3 秒后仍是黑屏，点下面按钮刷新</span>
          <button type="button" onClick={() => window.location.reload()}>
            立即刷新
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

type LegendKey = 'Closed_Fist' | 'Open_Palm' | 'Victory' | 'Thumb_Up';

const LEGEND: Array<{ key: LegendKey; icon: string; zh: string; en: string }> = [
  { key: 'Closed_Fist', icon: '✊', zh: '聚合', en: 'ASSEMBLE' },
  { key: 'Open_Palm', icon: '🖐', zh: '散开', en: 'DISPERSE' },
  { key: 'Victory', icon: '✌️', zh: '换配色', en: 'PALETTE' },
  { key: 'Thumb_Up', icon: '👍', zh: '换形状', en: 'SHAPE' },
];

export default function App() {
  const [mode, setMode] = useState<TreeMode>('ASSEMBLED');
  const [themeIndex, setThemeIndex] = useState(0);
  const [shapeIndex, setShapeIndex] = useState(0);
  const [vortex, setVortex] = useState(false);
  const [blizzard, setBlizzard] = useState(false);
  const [burstNonce, setBurstNonce] = useState(0);
  const [debug, setDebug] = useState(false);
  const [showUi, setShowUi] = useState(true);

  // 3D 场景自愈：WebGL 上下文丢失 / 渲染异常时重建 Canvas
  const [sceneKey, setSceneKey] = useState(0);
  const glRef = useRef<THREE.WebGLRenderer | null>(null);
  const recoveringRef = useRef(false);

  const recoverScene = useCallback(() => {
    if (recoveringRef.current) return;
    recoveringRef.current = true;
    window.setTimeout(() => {
      setSceneKey((key) => key + 1);
      recoveringRef.current = false;
    }, 900);
  }, []);

  const handleSceneCreated = useCallback(
    (state: RootState) => {
      glRef.current = state.gl;
      const canvas = state.gl.domElement;
      canvas.addEventListener('webglcontextlost', (event) => {
        event.preventDefault();
        // 先停掉渲染循环，避免后处理组件在空上下文上渲染抛错
        state.setFrameloop('never');
        recoverScene();
      });
      canvas.addEventListener('webglcontextrestored', () => recoverScene(), { once: true });
    },
    [recoverScene],
  );

  // 标签页从后台回来时，如果上下文已丢失，主动重建
  useEffect(() => {
    const onVisibilityChange = () => {
      const context = glRef.current?.getContext();
      if (document.visibilityState === 'visible' && context && context.isContextLost()) recoverScene();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [recoverScene]);

  // 看门狗：上下文丢失或渲染循环卡死（画面冻结成黑屏）时自动重建场景
  useEffect(() => {
    let lastFrame = -1;
    let lastAdvanceAt = Date.now();
    const timer = window.setInterval(() => {
      const gl = glRef.current;
      const context = gl?.getContext();
      if (!gl || !context) return;
      if (context.isContextLost()) {
        recoverScene();
        return;
      }
      if (document.visibilityState !== 'visible') {
        lastAdvanceAt = Date.now();
        return;
      }
      const frame = gl.info.render.frame;
      if (frame !== lastFrame) {
        lastFrame = frame;
        lastAdvanceAt = Date.now();
        return;
      }
      if (Date.now() - lastAdvanceAt > 4500) recoverScene();
    }, 1500);
    return () => window.clearInterval(timer);
  }, [recoverScene, sceneKey]);

  const gesture = useGestureControl();
  const palette = PALETTES[themeIndex];
  const shape = SHAPES[shapeIndex];

  const burst = useCallback(() => setBurstNonce((n) => n + 1), []);
  const cycleTheme = useCallback(() => setThemeIndex((i) => (i + 1) % PALETTES.length), []);
  const cycleShape = useCallback(() => {
    setShapeIndex((i) => (i + 1) % SHAPES.length);
    setBurstNonce((n) => n + 1);
  }, []);
  const reset = useCallback(() => {
    setMode('ASSEMBLED');
    setThemeIndex(0);
    setShapeIndex(0);
    setVortex(false);
    setBlizzard(false);
  }, []);

  // 手势 → 动作（gestureSeq 变化才触发一次，长按不连发）
  const handledSeq = useRef(0);
  useEffect(() => {
    if (gesture.gestureSeq === handledSeq.current) return;
    handledSeq.current = gesture.gestureSeq;
    switch (gesture.gesture) {
      case 'Closed_Fist':
        setMode('ASSEMBLED');
        break;
      case 'Open_Palm':
        setMode('DISPERSE');
        break;
      case 'Victory':
        cycleTheme();
        break;
      case 'Thumb_Up':
        cycleShape();
        break;
      default:
        break;
    }
  }, [gesture.gestureSeq, gesture.gesture, cycleTheme, cycleShape]);

  // 键盘快捷键
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const key = event.key.toLowerCase();
      if (key === ' ') {
        event.preventDefault();
        setMode((m) => (m === 'ASSEMBLED' ? 'DISPERSE' : 'ASSEMBLED'));
      } else if (key >= '1' && key <= '5') {
        setThemeIndex(Number(key) - 1);
      } else if (key === 'f') {
        cycleShape();
      } else if (key === 'b') {
        burst();
      } else if (key === 'v') {
        setVortex((x) => !x);
      } else if (key === 's') {
        setBlizzard((x) => !x);
      } else if (key === 'r') {
        reset();
      } else if (key === 'd') {
        setDebug((x) => !x);
      } else if (key === 'h') {
        setShowUi((x) => !x);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [burst, reset, cycleShape]);

  // 调试预览
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.srcObject !== gesture.debugStream) video.srcObject = gesture.debugStream;
    if (gesture.debugStream) void video.play().catch(() => undefined);
  }, [gesture.debugStream, debug]);

  // 单击（非拖拽）也可以爆裂
  const pointerStart = useRef<{ x: number; y: number; t: number } | null>(null);
  const onPointerDown = (event: React.PointerEvent) => {
    pointerStart.current = { x: event.clientX, y: event.clientY, t: performance.now() };
  };
  const onPointerUp = (event: React.PointerEvent) => {
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start) return;
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (moved < 6 && performance.now() - start.t < 320) burst();
  };

  const aiReady = gesture.status === 'READY';
  const aiError = gesture.status === 'ERROR';
  const dotClass = aiError ? 'dot err' : aiReady ? 'dot on' : 'dot wait';
  const latencyText = gesture.latencyMs > 0 ? `${gesture.latencyMs.toFixed(0)}ms` : '--';
  const fpsText = gesture.detectFps > 0 ? `${gesture.detectFps.toFixed(0)}fps` : '--';
  const particlesLabel = `${(PARTICLE_TOTAL / 1000).toFixed(1)}K`;

  const detected = gesture.gesture;
  const activeLegend: LegendKey | null =
    detected === 'Closed_Fist' || detected === 'Open_Palm' || detected === 'Victory' || detected === 'Thumb_Up'
      ? detected
      : null;

  return (
    <div className="app">
      <div className="canvas-wrap" onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
        <SceneErrorBoundary key={sceneKey} onFailure={recoverScene}>
          <Canvas
            dpr={[1, 2]}
            gl={{
              antialias: true,
              powerPreference: 'high-performance',
              toneMapping: THREE.ACESFilmicToneMapping,
              toneMappingExposure: 0.92,
              preserveDrawingBuffer: false,
            }}
            camera={{ position: [0, 4.2, 50], fov: 46, near: 0.1, far: 700 }}
            onCreated={handleSceneCreated}
          >
            <TreeScene
              mode={mode}
              palette={palette}
              shape={shape.id}
              vortex={vortex}
              burstNonce={burstNonce}
              blizzard={blizzard}
            />
          </Canvas>
        </SceneErrorBoundary>
      </div>

      {showUi && (
        <>
          <header className="brand">
            <h1 className="brand-title">Noël</h1>
            <p>
              {palette.label.split(' / ')[0]} · {shape.en} · SNOW NIGHT
            </p>
          </header>

          <div className={`status ${aiError ? 'status-error' : ''}`}>
            <span className={dotClass} />
            <span className="status-text">{gesture.message}</span>
            <span className="metric">
              {latencyText} · {fpsText}
            </span>
          </div>

          {aiError && (
            <div className="error-banner">
              <strong>摄像头 / AI 不可用：</strong> {gesture.error ?? '未知错误'}
              <span>（仍可用鼠标、键盘和按钮操作，点 🛠 DEBUG 查看详情）</span>
            </div>
          )}

          <aside className="legend">
            <p className="legend-title">手势 · 交互</p>
            {LEGEND.map((item) => {
              const active = activeLegend === item.key;
              return (
                <div key={item.key} className={`legend-item ${active ? 'active' : ''}`}>
                  <span className="legend-icon">{item.icon}</span>
                  <span className="legend-zh">{item.zh}</span>
                  <span className="legend-en">{item.en}</span>
                </div>
              );
            })}
          </aside>

          <div className="stats">
            <div className="stat-row">
              <span className="stat-label">PARTICLES</span>
              <span className="stat-value">{particlesLabel}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">MODE</span>
              <span className="stat-value">{mode === 'ASSEMBLED' ? '聚合' : '散开'}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">SHAPE</span>
              <span className="stat-value">{shape.zh}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">EXTRA</span>
              <span className="stat-value">{vortex ? '涡旋' : blizzard ? '暴雪' : '—'}</span>
            </div>
          </div>

          <div className="controls">
            <button
              type="button"
              className="btn primary"
              onClick={() => setMode((m) => (m === 'ASSEMBLED' ? 'DISPERSE' : 'ASSEMBLED'))}
            >
              {mode === 'ASSEMBLED' ? 'Disperse 散开' : 'Assemble 聚合'}
            </button>
            <button type="button" className="btn" onClick={cycleTheme}>
              配色 · {palette.label.split(' / ')[1]}
            </button>
            <button type="button" className="btn" onClick={cycleShape}>
              形状 · {shape.zh}
            </button>
            <button type="button" className={`btn ${vortex ? 'active' : ''}`} onClick={() => setVortex((v) => !v)}>
              涡旋
            </button>
            <button type="button" className={`btn ${blizzard ? 'active' : ''}`} onClick={() => setBlizzard((b) => !b)}>
              暴雪
            </button>
            <button type="button" className="btn" onClick={burst}>
              爆裂
            </button>
            <button type="button" className="btn ghost" onClick={() => setDebug((d) => !d)}>
              🛠 DEBUG
            </button>
          </div>

          <p className="hint">空格 聚合/散开 · 1–5 配色 · F 换形状 · B 爆裂 · V 涡旋 · S 暴雪 · R 重置 · 单击画面爆裂 · 拖拽/滚轮环视</p>

          {debug && (
            <div className="debug-panel">
              <div className="debug-video">
                <video ref={videoRef} autoPlay muted playsInline />
                <div className="debug-tag">
                  {gesture.gesture ?? 'NO GESTURE'}
                  {gesture.confidence > 0 ? ` ${(gesture.confidence * 100).toFixed(0)}%` : ''}
                </div>
              </div>
              <div className="debug-candidates">
                <p className="debug-candidates-title">模型实时输出 · 手势分数</p>
                {gesture.candidates.length === 0 && <p className="debug-candidate-empty">没有手 / 没有手势</p>}
                {gesture.candidates.map((candidate) => (
                  <div key={candidate.name} className="debug-candidate">
                    <span className="debug-candidate-name">{candidate.name}</span>
                    <span className="debug-candidate-bar">
                      <span style={{ width: `${Math.round(candidate.score * 100)}%` }} />
                    </span>
                    <span className="debug-candidate-score">{(candidate.score * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button type="button" className="hide-ui" title="隐藏界面 (H)" onClick={() => setShowUi(false)}>
            ×
          </button>
        </>
      )}

      {!showUi && (
        <button type="button" className="show-ui" onClick={() => setShowUi(true)}>
          显示界面
        </button>
      )}
    </div>
  );
}
