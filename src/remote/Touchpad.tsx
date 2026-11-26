import { useEffect, useRef, useState } from 'react';
import type { RemoteMousePayload } from '../remoteApi';

interface TouchpadProps {
  onSendMouse: (payload: RemoteMousePayload) => void;
  onHaptic: () => void;
}

interface Point {
  x: number;
  y: number;
}

const BATCH_INTERVAL_MS = 30;
const LONG_PRESS_MS = 600;
const MOVE_SPEED = 2;
const TAP_SLOP_PX = 8;
const SCROLL_STEP_PX = 14;

export function Touchpad({ onSendMouse, onHaptic }: TouchpadProps) {
  const [pressed, setPressed] = useState(false);

  const pointersRef = useRef<Map<number, Point>>(new Map());
  const startPointRef = useRef<Point | null>(null);
  const movedBeyondSlopRef = useRef(false);
  const wasMultiTouchRef = useRef(false);
  const longPressFiredRef = useRef(false);
  const longPressTimerRef = useRef<number | null>(null);

  const pendingDxRef = useRef(0);
  const pendingDyRef = useRef(0);
  const pendingScrollPxRef = useRef(0);
  const prevTwoFingerYRef = useRef<number | null>(null);
  const batchTimerRef = useRef<number | null>(null);

  const sendMouseRef = useRef(onSendMouse);
  sendMouseRef.current = onSendMouse;
  const hapticRef = useRef(onHaptic);
  hapticRef.current = onHaptic;

  const clearLongPress = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const flushBatch = () => {
    const dx = Math.round(pendingDxRef.current);
    const dy = Math.round(pendingDyRef.current);
    if (dx !== 0 || dy !== 0) {
      pendingDxRef.current = 0;
      pendingDyRef.current = 0;
      sendMouseRef.current({ dx, dy });
    }

    if (Math.abs(pendingScrollPxRef.current) >= SCROLL_STEP_PX) {
      const steps = Math.trunc(pendingScrollPxRef.current / SCROLL_STEP_PX);
      pendingScrollPxRef.current -= steps * SCROLL_STEP_PX;
      if (steps !== 0) {
        sendMouseRef.current({ scroll: steps });
      }
    }
  };

  const ensureBatchTimer = () => {
    if (batchTimerRef.current === null) {
      batchTimerRef.current = window.setInterval(flushBatch, BATCH_INTERVAL_MS);
    }
  };

  const stopBatchTimer = () => {
    flushBatch();
    if (batchTimerRef.current !== null) {
      window.clearInterval(batchTimerRef.current);
      batchTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      clearLongPress();
      if (batchTimerRef.current !== null) {
        window.clearInterval(batchTimerRef.current);
      }
    };
  }, []);

  const getAverageY = (map: Map<number, Point>): number => {
    let sum = 0;
    let count = 0;
    for (const pt of map.values()) {
      sum += pt.y;
      count += 1;
      if (count === 2) break;
    }
    return count > 0 ? sum / count : 0;
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    const pt = { x: event.clientX, y: event.clientY };
    const map = pointersRef.current;
    map.set(event.pointerId, pt);
    setPressed(true);
    ensureBatchTimer();

    if (map.size === 1) {
      startPointRef.current = pt;
      movedBeyondSlopRef.current = false;
      wasMultiTouchRef.current = false;
      longPressFiredRef.current = false;
      prevTwoFingerYRef.current = null;

      clearLongPress();
      longPressTimerRef.current = window.setTimeout(() => {
        longPressTimerRef.current = null;
        if (
          pointersRef.current.size === 1 &&
          !movedBeyondSlopRef.current &&
          !wasMultiTouchRef.current
        ) {
          longPressFiredRef.current = true;
          hapticRef.current();
          sendMouseRef.current({ click: 'right' });
        }
      }, LONG_PRESS_MS);
    } else if (map.size >= 2) {
      wasMultiTouchRef.current = true;
      clearLongPress();
      prevTwoFingerYRef.current = getAverageY(map);
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const map = pointersRef.current;
    const prev = map.get(event.pointerId);
    if (!prev) {
      return;
    }

    event.preventDefault();
    const next = { x: event.clientX, y: event.clientY };
    map.set(event.pointerId, next);

    if (map.size >= 2) {
      wasMultiTouchRef.current = true;
      clearLongPress();
      const avgY = getAverageY(map);
      if (prevTwoFingerYRef.current !== null) {
        // Positive scroll = down
        pendingScrollPxRef.current += avgY - prevTwoFingerYRef.current;
      }
      prevTwoFingerYRef.current = avgY;
      return;
    }

    // Single-finger cursor move (2x speed, batched every 30ms)
    if (!wasMultiTouchRef.current) {
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;

      if (startPointRef.current && !movedBeyondSlopRef.current) {
        const dist = Math.hypot(
          next.x - startPointRef.current.x,
          next.y - startPointRef.current.y
        );
        if (dist > TAP_SLOP_PX) {
          movedBeyondSlopRef.current = true;
          clearLongPress();
        }
      }

      if (movedBeyondSlopRef.current) {
        pendingDxRef.current += dx * MOVE_SPEED;
        pendingDyRef.current += dy * MOVE_SPEED;
      }
    }
  };

  const handlePointerEnd = (
    event: React.PointerEvent<HTMLDivElement>,
    cancelled: boolean
  ) => {
    const map = pointersRef.current;
    if (!map.has(event.pointerId)) {
      return;
    }

    event.preventDefault();
    map.delete(event.pointerId);

    if (map.size < 2) {
      prevTwoFingerYRef.current = null;
    }

    if (map.size === 0) {
      clearLongPress();
      stopBatchTimer();
      setPressed(false);

      if (
        !cancelled &&
        !movedBeyondSlopRef.current &&
        !wasMultiTouchRef.current &&
        !longPressFiredRef.current
      ) {
        hapticRef.current();
        sendMouseRef.current({ click: 'left' });
      }

      startPointRef.current = null;
      movedBeyondSlopRef.current = false;
      wasMultiTouchRef.current = false;
      longPressFiredRef.current = false;
    }
  };

  return (
    <div
      role="application"
      aria-label="Touchpad"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(e) => handlePointerEnd(e, false)}
      onPointerCancel={(e) => handlePointerEnd(e, true)}
      onContextMenu={(e) => e.preventDefault()}
      className={`relative flex h-[268px] w-full touch-none select-none flex-col items-center justify-center rounded-3xl border bg-[#121621] transition-colors duration-150 ${
        pressed ? 'border-[#38BDF8]/65 bg-[#151B29]' : 'border-white/12'
      }`}
    >
      <div className="pointer-events-none flex flex-col items-center text-center px-6">
        <div className="h-12 w-12 rounded-2xl border border-white/10 bg-[#192030]" />
        <p className="mt-4 text-sm font-medium text-[#CBD5E1]">
          Drag to move cursor
        </p>
        <p className="mt-1 text-xs text-[#64748B]">
          Tap to click · Hold for right-click · Two fingers to scroll
        </p>
      </div>
    </div>
  );
}
