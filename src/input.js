// Merges keyboard and gamepad into one action state, polled once per frame.
//
// Actions (all analog values are -1..1 unless noted):
//   steerX / steerY   left stick / arrows / WASD. Underwater: turn + pitch.
//                     Airborne: spin + flip.
//   roll              bumpers / Q,E. Barrel roll in the air.
//   swim              0..1, RT (analog) / A / Space.
//   lookX / lookY     right stick, orbits the camera.
//   pause, restart, invert, confirm   edge-triggered (true for one frame).

const DEADZONE = 0.18;

// Standard Gamepad mapping indices.
const BTN = {
  A: 0, B: 1, X: 2, Y: 3,
  LB: 4, RB: 5, LT: 6, RT: 7,
  BACK: 8, START: 9, LS: 10, RS: 11,
  UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
};

function radialDeadzone(x, y) {
  const mag = Math.hypot(x, y);
  if (mag < DEADZONE) return [0, 0];
  const scaled = Math.min(1, (mag - DEADZONE) / (1 - DEADZONE));
  return [(x / mag) * scaled, (y / mag) * scaled];
}

function pickStronger(a, b) {
  return Math.abs(a) >= Math.abs(b) ? a : b;
}

export class Input {
  constructor(target = window) {
    this.keys = new Set();
    this.pressedKeys = new Set();
    this.prevButtons = [];
    this.gamepadIndex = null;
    this.gamepadName = null;
    this.lastDevice = 'keyboard';
    this.invertY = false;
    this.onDeviceChange = null;
    this.touch = null; // optional TouchControls

    this.state = {
      steerX: 0, steerY: 0, roll: 0, swim: 0, lookX: 0, lookY: 0,
      pause: false, restart: false, invert: false, confirm: false,
    };

    target.addEventListener('keydown', (e) => {
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressedKeys.add(e.code);
      this.keys.add(e.code);
      this.setDevice('keyboard');
    });
    target.addEventListener('keyup', (e) => this.keys.delete(e.code));
    target.addEventListener('blur', () => this.keys.clear());

    window.addEventListener('gamepadconnected', (e) => {
      if (this.gamepadIndex === null) this.attach(e.gamepad);
    });
    window.addEventListener('gamepaddisconnected', (e) => {
      if (e.gamepad.index === this.gamepadIndex) {
        this.gamepadIndex = null;
        this.gamepadName = null;
        this.prevButtons = [];
        // Fall back to any other pad still plugged in.
        const other = this.pads().find(Boolean);
        if (other) this.attach(other);
        else this.setDevice('keyboard', true);
      }
    });
  }

  pads() {
    return navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
  }

  attach(gp) {
    this.gamepadIndex = gp.index;
    this.gamepadName = gp.id.replace(/\s*\(.*?\)\s*/g, ' ').trim() || 'Controller';
    this.prevButtons = gp.buttons.map((b) => b.pressed);
    this.setDevice('gamepad', true);
  }

  setDevice(device, force = false) {
    if (device === this.lastDevice && !force) return;
    this.lastDevice = device;
    this.onDeviceChange?.(device, this.gamepadName);
  }

  get gamepad() {
    if (this.gamepadIndex === null) return null;
    return this.pads()[this.gamepadIndex] ?? null;
  }

  // Short rumble; silently does nothing where unsupported.
  rumble(strong, weak, duration) {
    const gp = this.gamepad;
    try {
      gp?.vibrationActuator?.playEffect?.('dual-rumble', {
        startDelay: 0, duration, strongMagnitude: strong, weakMagnitude: weak,
      });
    } catch { /* not supported */ }
  }

  poll() {
    const k = this.keys;
    const kx = (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0) - (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0);
    const ky = (k.has('ArrowUp') || k.has('KeyW') ? 1 : 0) - (k.has('ArrowDown') || k.has('KeyS') ? 1 : 0);
    const kroll = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
    const kswim = k.has('Space') || k.has('ShiftLeft') ? 1 : 0;
    const klookX = (k.has('KeyL') ? 1 : 0) - (k.has('KeyJ') ? 1 : 0);
    const klookY = (k.has('KeyI') ? 1 : 0) - (k.has('KeyK') ? 1 : 0);
    const kp = this.pressedKeys;

    let gx = 0, gy = 0, groll = 0, gswim = 0, glx = 0, gly = 0;
    let gpause = false, grestart = false, ginvert = false, gconfirm = false;

    // Adopt a pad that was connected before the page loaded (Chrome only
    // reports it after the first button press).
    if (this.gamepadIndex === null) {
      const found = this.pads().find(Boolean);
      if (found) this.attach(found);
    }

    const gp = this.gamepad;
    if (gp) {
      const btn = (i) => gp.buttons[i]?.pressed ?? false;
      const val = (i) => gp.buttons[i]?.value ?? 0;
      const edge = (i) => btn(i) && !this.prevButtons[i];

      [gx, gy] = radialDeadzone(gp.axes[0] ?? 0, gp.axes[1] ?? 0);
      gy = -gy; // stick up is negative on the axis
      // D-pad as a digital fallback.
      if (btn(BTN.LEFT)) gx = -1;
      if (btn(BTN.RIGHT)) gx = 1;
      if (btn(BTN.UP)) gy = 1;
      if (btn(BTN.DOWN)) gy = -1;

      [glx, gly] = radialDeadzone(gp.axes[2] ?? 0, gp.axes[3] ?? 0);
      gly = -gly;

      groll = (btn(BTN.RB) ? 1 : 0) - (btn(BTN.LB) ? 1 : 0);
      gswim = Math.max(val(BTN.RT), btn(BTN.A) ? 1 : 0);

      gpause = edge(BTN.START);
      grestart = edge(BTN.BACK);
      ginvert = edge(BTN.Y);
      gconfirm = edge(BTN.A) || edge(BTN.START);

      const active = Math.abs(gx) + Math.abs(gy) + Math.abs(glx) + Math.abs(gly) > 0
        || gp.buttons.some((b) => b.pressed);
      if (active) this.setDevice('gamepad');

      this.prevButtons = gp.buttons.map((b) => b.pressed);
    }

    const t = this.touch?.state ?? { steerX: 0, steerY: 0, roll: 0, swim: 0 };
    const tpause = this.touch?.takePause() ?? false;

    const s = this.state;
    s.steerX = pickStronger(pickStronger(kx, gx), t.steerX);
    s.steerY = pickStronger(pickStronger(ky, gy), t.steerY) * (this.invertY ? -1 : 1);
    s.roll = pickStronger(pickStronger(kroll, groll), t.roll);
    s.swim = Math.max(kswim, gswim, t.swim);
    s.lookX = pickStronger(klookX, glx);
    s.lookY = pickStronger(klookY, gly);
    s.pause = gpause || tpause || kp.has('Escape') || kp.has('KeyP');
    s.restart = grestart || kp.has('KeyR');
    s.invert = ginvert || kp.has('KeyY');
    s.confirm = gconfirm || kp.has('Enter') || kp.has('Space');

    this.pressedKeys.clear();
    return s;
  }
}

const GAME_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space',
]);
