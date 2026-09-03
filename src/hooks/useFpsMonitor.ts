import { useEffect, useRef, useState } from 'react';

type FpsMonitorOptions = {
  lowFpsThreshold?: number;
  recoverFpsThreshold?: number;
  sampleWindowMs?: number;
  enabled?: boolean;
};

export const useFpsMonitor = (options: FpsMonitorOptions = {}) => {
  const {
    lowFpsThreshold = 28,
    recoverFpsThreshold = 35,
    sampleWindowMs = 1000,
    enabled = true,
  } = options;
  const [lowPerf, setLowPerf] = useState(false);
  const fpsRef = useRef(60);
  const lowPerfRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      lowPerfRef.current = false;
      setLowPerf(false);
      fpsRef.current = 60;
      return;
    }

    let rafId = 0;
    let last = performance.now();
    let frameCount = 0;
    let acc = 0;

    const tick = (now: number) => {
      const delta = now - last;
      last = now;
      acc += delta;
      frameCount += 1;

      if (acc >= sampleWindowMs) {
        const nextFps = Math.max(1, Math.round((frameCount * 1000) / acc));
        fpsRef.current = nextFps;

        const currentlyLow = lowPerfRef.current;
        if (!currentlyLow && nextFps < lowFpsThreshold) {
          lowPerfRef.current = true;
          setLowPerf(true);
        } else if (currentlyLow && nextFps >= recoverFpsThreshold) {
          lowPerfRef.current = false;
          setLowPerf(false);
        }

        acc = 0;
        frameCount = 0;
      }

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [enabled, lowFpsThreshold, recoverFpsThreshold, sampleWindowMs]);

  return { fps: fpsRef.current, lowPerf };
};
