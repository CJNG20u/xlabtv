import { useEffect, useRef } from 'react';

export type SpatialAction =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'activate'
  | 'back'
  | 'settings';

type DirectionAction = 'up' | 'down' | 'left' | 'right';

const STICK_DEADZONE = 0.45;
const REPEAT_INITIAL_DELAY_MS = 350;
const REPEAT_INTERVAL_MS = 130;

// W3C Standard Gamepad button indices
const BTN_A = 0;
const BTN_B = 1;
const BTN_START = 9;
const BTN_DPAD_UP = 12;
const BTN_DPAD_DOWN = 13;
const BTN_DPAD_LEFT = 14;
const BTN_DPAD_RIGHT = 15;

interface GamepadInputOptions {
  onAction: (action: SpatialAction) => void;
  onActivity?: () => void;
  isScreensaverActive?: boolean;
  onWakeScreensaver?: () => void;
}

function isPressed(button?: GamepadButton): boolean {
  return Boolean(button && (button.pressed || button.value > 0.5));
}

function readDirection(pad: Gamepad): DirectionAction | null {
  if (isPressed(pad.buttons[BTN_DPAD_UP])) return 'up';
  if (isPressed(pad.buttons[BTN_DPAD_DOWN])) return 'down';
  if (isPressed(pad.buttons[BTN_DPAD_LEFT])) return 'left';
  if (isPressed(pad.buttons[BTN_DPAD_RIGHT])) return 'right';

  const axisX = pad.axes[0] ?? 0;
  const axisY = pad.axes[1] ?? 0;
  const absX = Math.abs(axisX);
  const absY = Math.abs(axisY);

  if (absX < STICK_DEADZONE && absY < STICK_DEADZONE) {
    return null;
  }

  if (absX >= absY) {
    return axisX < 0 ? 'left' : 'right';
  }
  return axisY < 0 ? 'up' : 'down';
}

function hasAnyButtonPressed(pad: Gamepad): boolean {
  for (let i = 0; i < pad.buttons.length; i++) {
    if (isPressed(pad.buttons[i])) {
      return true;
    }
  }
  return false;
}

function hasAnyStickMoved(pad: Gamepad): boolean {
  for (let i = 0; i < Math.min(pad.axes.length, 4); i++) {
    if (Math.abs(pad.axes[i] ?? 0) >= STICK_DEADZONE) {
      return true;
    }
  }
  return false;
}

function hasAnyConnectedGamepad(): boolean {
  if (
    typeof navigator === 'undefined' ||
    typeof navigator.getGamepads !== 'function'
  ) {
    return false;
  }
  const pads = navigator.getGamepads();
  for (let i = 0; i < pads.length; i++) {
    if (pads[i]?.connected) {
      return true;
    }
  }
  return false;
}

/**
 * Polls connected gamepads via the browser Gamepad API.
 * Starts the rAF loop only while a gamepad is connected to keep idle GPU/CPU cost at zero.
 * When the ambient screensaver is active, any button or stick movement wakes it without triggering an action.
 */
export function useGamepadInput(options: GamepadInputOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (
      typeof navigator === 'undefined' ||
      typeof navigator.getGamepads !== 'function'
    ) {
      return;
    }

    let rafId: number | null = null;
    let heldDirection: DirectionAction | null = null;
    let nextRepeatAt = 0;

    let prevA = false;
    let prevB = false;
    let prevStart = false;
    let prevAnyInput = false;
    let suppressUntilNeutral = false;

    const tick = (now: number) => {
      const pads = navigator.getGamepads();
      let anyConnected = false;

      let activeDirection: DirectionAction | null = null;
      let aDown = false;
      let bDown = false;
      let startDown = false;
      let anyInputDown = false;

      for (let i = 0; i < pads.length; i++) {
        const pad = pads[i];
        if (!pad || !pad.connected) {
          continue;
        }
        anyConnected = true;

        if (!activeDirection) {
          activeDirection = readDirection(pad);
        }
        if (isPressed(pad.buttons[BTN_A])) aDown = true;
        if (isPressed(pad.buttons[BTN_B])) bDown = true;
        if (isPressed(pad.buttons[BTN_START])) startDown = true;
        if (hasAnyButtonPressed(pad) || hasAnyStickMoved(pad)) {
          anyInputDown = true;
        }
      }

      if (!anyConnected) {
        heldDirection = null;
        prevA = false;
        prevB = false;
        prevStart = false;
        prevAnyInput = false;
        suppressUntilNeutral = false;
        rafId = null;
        return;
      }

      const { onAction, onActivity, isScreensaverActive, onWakeScreensaver } =
        optionsRef.current;

      // Wake ambient screensaver on any new gamepad button/stick input without firing an action
      if (isScreensaverActive) {
        if (anyInputDown && !prevAnyInput) {
          suppressUntilNeutral = true;
          heldDirection = activeDirection;
          prevA = aDown;
          prevB = bDown;
          prevStart = startDown;
          prevAnyInput = true;
          onWakeScreensaver?.();
          onActivity?.();
          rafId = window.requestAnimationFrame(tick);
          return;
        }
        prevAnyInput = anyInputDown;
        prevA = aDown;
        prevB = bDown;
        prevStart = startDown;
        heldDirection = activeDirection;
        rafId = window.requestAnimationFrame(tick);
        return;
      }

      // Wait until the wake button/stick is released before accepting navigation/action
      if (suppressUntilNeutral) {
        if (!anyInputDown) {
          suppressUntilNeutral = false;
          heldDirection = null;
        }
        prevAnyInput = anyInputDown;
        prevA = aDown;
        prevB = bDown;
        prevStart = startDown;
        rafId = window.requestAnimationFrame(tick);
        return;
      }

      if (anyInputDown && !prevAnyInput) {
        onActivity?.();
      }
      prevAnyInput = anyInputDown;

      // Edge-triggered action buttons
      if (aDown && !prevA) {
        onActivity?.();
        onAction('activate');
      }
      if (bDown && !prevB) {
        onActivity?.();
        onAction('back');
      }
      if (startDown && !prevStart) {
        onActivity?.();
        onAction('settings');
      }

      prevA = aDown;
      prevB = bDown;
      prevStart = startDown;

      // Directional navigation with hold-to-repeat
      if (activeDirection !== heldDirection) {
        heldDirection = activeDirection;
        if (activeDirection) {
          onActivity?.();
          onAction(activeDirection);
          nextRepeatAt = now + REPEAT_INITIAL_DELAY_MS;
        }
      } else if (heldDirection && now >= nextRepeatAt) {
        onActivity?.();
        onAction(heldDirection);
        nextRepeatAt = now + REPEAT_INTERVAL_MS;
      }

      rafId = window.requestAnimationFrame(tick);
    };

    const ensureRunning = () => {
      if (rafId === null && hasAnyConnectedGamepad()) {
        rafId = window.requestAnimationFrame(tick);
      }
    };

    const handleConnected = () => ensureRunning();
    const handleDisconnected = () => {
      if (!hasAnyConnectedGamepad() && rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
        heldDirection = null;
        prevA = false;
        prevB = false;
        prevStart = false;
        prevAnyInput = false;
        suppressUntilNeutral = false;
      }
    };

    window.addEventListener('gamepadconnected', handleConnected);
    window.addEventListener('gamepaddisconnected', handleDisconnected);
    ensureRunning();

    return () => {
      window.removeEventListener('gamepadconnected', handleConnected);
      window.removeEventListener('gamepaddisconnected', handleDisconnected);
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, []);
}
