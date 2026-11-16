import { useEffect, useRef, useState } from 'react';
import { FilesetResolver, GestureRecognizer } from '@mediapipe/tasks-vision';
import type { GestureRecognizerResult, NormalizedLandmark } from '@mediapipe/tasks-vision';

// ---------------------------------------------------------------------------
// Public contract (App.tsx is integrated against this; do not change).
// ---------------------------------------------------------------------------

export type GestureName =
  | 'Open_Palm'
  | 'Closed_Fist'
  | 'Victory'
  | 'Thumb_Up'
  | 'Pointing_Up'
  | 'ILoveYou'
  | 'Thumb_Down';

export type AiStatus =
  | 'BOOTING'
  | 'LOADING_MODEL'
  | 'ASKING_CAMERA'
  | 'READY'
  | 'NO_HAND'
  | 'ERROR';

export interface GestureCandidate {
  /** Raw MediaPipe category name (includes "None"). */
  name: string;
  score: number;
}

export interface GestureState {
  status: AiStatus;
  message: string;
  error: string | null;
  gesture: GestureName | null;
  gestureSeq: number;
  handX: number;
  handY: number;
  confidence: number;
  detectFps: number;
  latencyMs: number;
  debugStream: MediaStream | null;
  /** Top raw categories from the classifier, for on-screen diagnostics. */
  candidates: GestureCandidate[];
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** All resources are served from public/, never from a remote CDN. */
const WASM_PATH = `${import.meta.env.BASE_URL}mediapipe/wasm`;
const MODEL_PATH = `${import.meta.env.BASE_URL}mediapipe/gesture_recognizer.task`;

const GESTURE_NAMES: readonly GestureName[] = [
  'Open_Palm',
  'Closed_Fist',
  'Victory',
  'Thumb_Up',
  'Pointing_Up',
  'ILoveYou',
  'Thumb_Down',
];

/** Palm landmarks (wrist + the four finger base knuckles). */
const PALM_LANDMARK_INDICES: readonly number[] = [0, 5, 9, 13, 17];

const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    width: { ideal: 640 },
    height: { ideal: 480 },
    frameRate: { ideal: 30 },
  },
  audio: false,
};

const SCORE_CONFIRM = 0.8; // single frame confirmation
const SCORE_CANDIDATE = 0.5; // needs CANDIDATE_FRAMES consecutive frames
const CANDIDATE_FRAMES = 2;
const RELEASE_MS = 200; // release gesture after it has been gone for this long
const SMOOTHING = 0.35; // exponential smoothing factor for hand position
const DEAD_ZONE = 0.03; // ignore tiny hand jitter around the center
const PUBLISH_INTERVAL_MS = 50; // React re-render budget for continuous values
/**
 * Hard cap on recognitions per second (~30fps, the camera frame rate).
 * The capture <video> reports currentTime updates at the display refresh rate
 * (144Hz here), so without this cap the loop ran 100+ inferences per second,
 * saturated the main thread and collapsed to ~2fps.
 */
const MIN_RECOGNIZE_INTERVAL_MS = 28;

const INITIAL_STATE: GestureState = {
  status: 'BOOTING',
  message: '正在加载 AI…',
  error: null,
  gesture: null,
  gestureSeq: 0,
  handX: 0,
  handY: 0,
  confidence: 0,
  detectFps: 0,
  latencyMs: 0,
  debugStream: null,
  candidates: [],
};

const STATE_KEYS: readonly (keyof GestureState)[] = [
  'status',
  'message',
  'error',
  'gesture',
  'gestureSeq',
  'handX',
  'handY',
  'confidence',
  'detectFps',
  'latencyMs',
  'debugStream',
];

type WasmFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;
type Delegate = 'GPU' | 'CPU';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function isGestureName(value: string): value is GestureName {
  return (GESTURE_NAMES as readonly string[]).includes(value);
}

function clampUnit(value: number): number {
  if (value < -1) return -1;
  if (value > 1) return 1;
  return value;
}

/** Expand the [-1, 1] range after carving out a small dead zone around 0. */
function applyDeadZone(value: number): number {
  const magnitude = Math.abs(value);
  if (magnitude <= DEAD_ZONE) return 0;
  const scaled = (magnitude - DEAD_ZONE) / (1 - DEAD_ZONE);
  return value < 0 ? -scaled : scaled;
}

function smooth(previous: number, target: number, alpha: number): number {
  const next = previous + (target - previous) * alpha;
  // Snap to exact zero once the residual is imperceptible, so "no hand" is 0.
  return Math.abs(next) < 0.002 ? 0 : next;
}

function candidatesEqual(a: GestureCandidate[], b: GestureCandidate[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].name !== b[i].name || a[i].score !== b[i].score) return false;
  }
  return true;
}

function statesEqual(a: GestureState, b: GestureState): boolean {
  for (const key of STATE_KEYS) {
    if (a[key] !== b[key]) return false;
  }
  return candidatesEqual(a.candidates, b.candidates);
}

/** Average the palm landmarks and normalize to screen space, y up. */
function readPalmPosition(landmarks: NormalizedLandmark[]): { x: number; y: number } {
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const index of PALM_LANDMARK_INDICES) {
    const landmark = landmarks[index];
    if (landmark) {
      sumX += landmark.x;
      sumY += landmark.y;
      count += 1;
    }
  }
  if (count === 0) return { x: 0, y: 0 };
  const normalizedX = sumX / count;
  const normalizedY = sumY / count;
  return {
    x: applyDeadZone(clampUnit((normalizedX - 0.5) * 2)),
    y: applyDeadZone(clampUnit((0.5 - normalizedY) * 2)),
  };
}

/** Short, user-facing reason for a camera failure (never throws). */
function describeCameraError(error: unknown): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return '摄像头权限被拒绝';
      case 'NotFoundError':
      case 'OverconstrainedError':
        return '没有找到摄像头';
      case 'NotReadableError':
        return '摄像头被其他程序占用';
      default:
        return '摄像头不可用';
    }
  }
  if (error instanceof Error && error.message) {
    return error.message.toUpperCase().slice(0, 80);
  }
  return '摄像头不可用';
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useGestureControl(): GestureState {
  const [state, setState] = useState<GestureState>(() => ({ ...INITIAL_STATE }));
  const stateRef = useRef<GestureState>({ ...INITIAL_STATE });

  useEffect(() => {
    // `cancelled` makes StrictMode's double mount (and any late async resolve)
    // safe: a stale setup never publishes state, never leaks a stream, and
    // always closes a recognizer it managed to create.
    let cancelled = false;

    let recognizer: GestureRecognizer | null = null;
    let fileset: WasmFileset | null = null;
    let mediaStream: MediaStream | null = null;
    let delegate: Delegate = 'GPU';
    let recovering = false;

    // Frame scheduling handles.
    let usingRvfc = false;
    let rvfcHandle: number | null = null;
    let rafHandle: number | null = null;
    let lastVideoTime = -1;
    let lastTimestamp = 0;
    let lastRecognizeAt = 0;

    // Gesture debouncing state.
    let currentGesture: GestureName | null = null;
    let currentConfidence = 0;
    let gestureSeq = 0;
    let lastGestureSeenAt = 0;
    let pendingGesture: GestureName | null = null;
    let pendingFrames = 0;

    // Smoothed hand position.
    let smoothedX = 0;
    let smoothedY = 0;
    let lastHandSeenAt = 0;

    // Diagnostics (1s rolling window for FPS).
    let detectFps = 0;
    let windowStart = 0;
    let windowFrames = 0;
    let lastPublishAt = 0;

    // Internal hidden capture element: App only ever sees `debugStream`.
    const video = document.createElement('video');
    video.playsInline = true;
    video.muted = true;
    video.autoplay = true;
    video.setAttribute('aria-hidden', 'true');
    video.style.position = 'fixed';
    video.style.left = '-9999px';
    video.style.top = '0';
    video.style.width = '1px';
    video.style.height = '1px';
    video.style.opacity = '0';
    video.style.pointerEvents = 'none';
    document.body.appendChild(video);

    // -- state publishing ---------------------------------------------------

    const publish = (force: boolean): void => {
      if (cancelled) return;
      const now = performance.now();
      if (!force && now - lastPublishAt < PUBLISH_INTERVAL_MS) return;
      lastPublishAt = now;
      const snapshot: GestureState = { ...stateRef.current };
      setState((previous) => (statesEqual(previous, snapshot) ? previous : snapshot));
    };

    const setStatus = (status: AiStatus, message: string, error: string | null = null): void => {
      const ref = stateRef.current;
      ref.status = status;
      ref.message = message;
      ref.error = error;
      publish(true);
    };

    const fail = (reason: string): void => {
      setStatus('ERROR', `错误：${reason}`, reason);
    };

    // -- recognizer lifecycle ----------------------------------------------

    const createRecognizer = (wasm: WasmFileset, nextDelegate: Delegate): Promise<GestureRecognizer> =>
      GestureRecognizer.createFromOptions(wasm, {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate: nextDelegate },
        runningMode: 'VIDEO',
        numHands: 1,
      });

    /** GPU first, CPU automatically when the GPU delegate is unusable. */
    const createRecognizerWithFallback = async (wasm: WasmFileset): Promise<GestureRecognizer> => {
      try {
        const gpu = await createRecognizer(wasm, 'GPU');
        return gpu;
      } catch {
        const cpu = await createRecognizer(wasm, 'CPU');
        delegate = 'CPU';
        return cpu;
      }
    };

    // -- frame loop ---------------------------------------------------------

    const scheduleNextFrame = (): void => {
      if (cancelled || !recognizer) return;
      if (usingRvfc) {
        rvfcHandle = video.requestVideoFrameCallback(() => {
          onFrame();
        });
      } else {
        rafHandle = window.requestAnimationFrame(() => {
          rafHandle = null;
          onFrame();
        });
      }
    };

    const handleResults = (results: GestureRecognizerResult, latencyMs: number, frameNow: number): void => {
      const landmarks = results.landmarks.length > 0 ? results.landmarks[0] : null;
      const handPresent = landmarks !== null && landmarks.length > 0;

      const topGesture = results.gestures.length > 0 ? results.gestures[0]?.[0] : undefined;
      const gestureName =
        topGesture && isGestureName(topGesture.categoryName) ? topGesture.categoryName : null;
      const score = gestureName && topGesture ? topGesture.score : 0;

      let gestureChanged = false;

      if (gestureName !== null && score >= SCORE_CANDIDATE) {
        lastGestureSeenAt = frameNow;
        if (gestureName === currentGesture) {
          // Still holding the same gesture: refresh confidence, do not re-fire.
          currentConfidence = score;
          pendingGesture = null;
          pendingFrames = 0;
        } else if (score >= SCORE_CONFIRM) {
          // Very confident: confirm immediately for low latency.
          currentGesture = gestureName;
          currentConfidence = score;
          gestureSeq += 1;
          pendingGesture = null;
          pendingFrames = 0;
          gestureChanged = true;
        } else {
          // Moderately confident: require a couple of consecutive frames.
          if (pendingGesture === gestureName) {
            pendingFrames += 1;
          } else {
            pendingGesture = gestureName;
            pendingFrames = 1;
          }
          if (pendingFrames >= CANDIDATE_FRAMES) {
            currentGesture = gestureName;
            currentConfidence = score;
            gestureSeq += 1;
            pendingGesture = null;
            pendingFrames = 0;
            gestureChanged = true;
          }
        }
      }

      if (currentGesture !== null && frameNow - lastGestureSeenAt > RELEASE_MS) {
        currentGesture = null;
        currentConfidence = 0;
        pendingGesture = null;
        pendingFrames = 0;
        gestureChanged = true;
      }

      if (handPresent && landmarks) {
        lastHandSeenAt = frameNow;
        const palm = readPalmPosition(landmarks);
        smoothedX = smooth(smoothedX, palm.x, SMOOTHING);
        smoothedY = smooth(smoothedY, palm.y, SMOOTHING);
      } else if (frameNow - lastHandSeenAt > RELEASE_MS) {
        // Hand has been gone long enough: report exact zeros.
        smoothedX = 0;
        smoothedY = 0;
      } else {
        smoothedX = smooth(smoothedX, 0, SMOOTHING);
        smoothedY = smooth(smoothedY, 0, SMOOTHING);
      }

      const ref = stateRef.current;
      const categories = results.gestures.length > 0 ? results.gestures[0] ?? [] : [];
      ref.candidates = categories
        .filter((category) => category.score > 0.03)
        .slice(0, 4)
        .map((category) => ({ name: category.categoryName, score: Math.round(category.score * 1000) / 1000 }));
      ref.gesture = currentGesture;
      ref.gestureSeq = gestureSeq;
      ref.confidence = currentGesture !== null ? currentConfidence : 0;
      ref.handX = smoothedX;
      ref.handY = smoothedY;
      ref.latencyMs = Math.round(latencyMs * 10) / 10;
      ref.detectFps = detectFps;
      ref.status = handPresent ? 'READY' : 'NO_HAND';
      ref.message = handPresent ? 'AI 就绪 · 请举手' : 'AI 就绪 · 未检测到手';
      ref.error = null;
      publish(gestureChanged);
    };

    /** Recreate the recognizer on the CPU if the GPU task dies at runtime. */
    const recoverOnCpu = (): boolean => {
      if (cancelled || recognizer === null || delegate !== 'GPU' || recovering || fileset === null) {
        return false;
      }
      recovering = true;
      const broken = recognizer;
      recognizer = null;
      try {
        broken.close();
      } catch {
        // Ignore: the task is already broken.
      }
      setStatus('LOADING_MODEL', '正在重启 AI…');
      void (async () => {
        try {
          const cpu = await createRecognizer(fileset as WasmFileset, 'CPU');
          if (cancelled) {
            cpu.close();
            return;
          }
          recognizer = cpu;
          delegate = 'CPU';
          lastVideoTime = -1;
          setStatus('READY', 'AI 就绪 · 请举手');
          scheduleNextFrame();
        } catch {
          if (!cancelled) fail('AI 运行失败');
        } finally {
          recovering = false;
        }
      })();
      return true;
    };

    const onFrame = (): void => {
      if (cancelled) return;
      const frameNow = performance.now();
      const current = recognizer;
      if (current === null) return;

      if (
        video.readyState >= 2 &&
        video.videoWidth > 0 &&
        video.currentTime !== lastVideoTime &&
        frameNow - lastRecognizeAt >= MIN_RECOGNIZE_INTERVAL_MS
      ) {
        lastVideoTime = video.currentTime;
        lastRecognizeAt = frameNow;
        // recognizeForVideo requires strictly increasing timestamps.
        const timestamp = Math.max(frameNow, lastTimestamp + 1);
        lastTimestamp = timestamp;
        const startedAt = performance.now();
        try {
          const results = current.recognizeForVideo(video, timestamp);
          const latencyMs = performance.now() - startedAt;

          windowFrames += 1;
          const elapsed = frameNow - windowStart;
          if (elapsed >= 1000) {
            detectFps = Math.round((windowFrames * 1000) / elapsed);
            windowFrames = 0;
            windowStart = frameNow;
          }

          handleResults(results, latencyMs, frameNow);
        } catch {
          // Stop this loop; CPU recovery schedules its own frames.
          recoverOnCpu();
          return;
        }
      }

      scheduleNextFrame();
    };

    // -- initialization -----------------------------------------------------

    const start = async (): Promise<void> => {
      // Phase 1: WASM + model (local assets, GPU first with CPU fallback).
      try {
        setStatus('BOOTING', '正在加载 AI…');
        const wasm = await FilesetResolver.forVisionTasks(WASM_PATH);
        if (cancelled) return;
        fileset = wasm;

        setStatus('LOADING_MODEL', '正在加载 AI…');
        const created = await createRecognizerWithFallback(wasm);
        if (cancelled) {
          created.close();
          return;
        }
        recognizer = created;
      } catch {
        if (!cancelled) fail('AI 模型加载失败');
        return;
      }

      // Phase 2: camera. Failures are surfaced, never thrown at the page.
      try {
        setStatus('ASKING_CAMERA', '正在请求摄像头…');
        const mediaDevices = navigator.mediaDevices;
        if (!mediaDevices || typeof mediaDevices.getUserMedia !== 'function') {
          fail('摄像头不可用');
          return;
        }
        const stream = await mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
        if (cancelled) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        mediaStream = stream;
        stateRef.current.debugStream = stream;

        video.srcObject = stream;
        try {
          await video.play();
        } catch {
          // Autoplay can be rejected; readyState gating handles it either way.
        }
        if (cancelled) return;

        // The capture <video> is intentionally off-screen and transparent, so
        // Chrome may stop presenting frames to the compositor and
        // requestVideoFrameCallback would then stall (measured: 20fps -> 1fps).
        // rAF always ticks, and the `video.currentTime !== lastVideoTime` gate
        // keeps recognitions at the camera frame rate without duplicate work.
        usingRvfc = false;
        windowStart = performance.now();
        windowFrames = 0;

        setStatus('READY', 'AI 就绪 · 请举手');
        scheduleNextFrame();
      } catch (error) {
        if (cancelled) return;
        fail(describeCameraError(error));
      }
    };

    void start();

    // -- cleanup ------------------------------------------------------------

    return () => {
      cancelled = true;

      if (rvfcHandle !== null && typeof video.cancelVideoFrameCallback === 'function') {
        video.cancelVideoFrameCallback(rvfcHandle);
      }
      rvfcHandle = null;

      if (rafHandle !== null) {
        window.cancelAnimationFrame(rafHandle);
      }
      rafHandle = null;

      if (mediaStream !== null) {
        for (const track of mediaStream.getTracks()) track.stop();
        mediaStream = null;
      }

      video.pause();
      video.srcObject = null;
      video.remove();

      if (recognizer !== null) {
        try {
          recognizer.close();
        } catch {
          // Ignore double-close / already-disposed tasks.
        }
        recognizer = null;
      }
      fileset = null;
    };
  }, []);

  return state;
}

