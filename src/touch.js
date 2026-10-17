// On-screen joystick and buttons for phones and tablets. Shown on the first touch.

const STICK_RADIUS = 50;

// Keeps a held button or stick tracking the finger even if it slides off.
function capture(el, pointerId) {
  try { el.setPointerCapture(pointerId); } catch { /* pointer already gone */ }
}

export class TouchControls {
  constructor(root) {
    this.root = root;
    this.state = { steerX: 0, steerY: 0, swim: 0, roll: 0, pause: false };
    this.stickId = null;
    this.origin = { x: 0, y: 0 };
    this.base = root.querySelector('#stick-base');
    this.knob = root.querySelector('#stick-knob');
    this.enabled = false;

    window.addEventListener('touchstart', () => this.enable(), { once: true, passive: true });

    const zone = root.querySelector('#stick-zone');
    zone.addEventListener('pointerdown', (e) => {
      if (this.stickId !== null) return;
      this.stickId = e.pointerId;
      capture(zone, e.pointerId);
      // The stick appears wherever the thumb lands.
      const rect = zone.getBoundingClientRect();
      this.origin = { x: e.clientX, y: e.clientY };
      this.base.style.left = `${e.clientX - rect.left}px`;
      this.base.style.top = `${e.clientY - rect.top}px`;
      this.base.style.bottom = 'auto';
      this.moveStick(e);
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickId) this.moveStick(e);
    });
    const release = (e) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.state.steerX = this.state.steerY = 0;
      this.knob.style.transform = '';
    };
    zone.addEventListener('pointerup', release);
    zone.addEventListener('pointercancel', release);

    this.hold('#touch-swim', (on) => { this.state.swim = on ? 1 : 0; });
    this.hold('#touch-roll-l', (on) => { this.state.roll = on ? -1 : 0; });
    this.hold('#touch-roll-r', (on) => { this.state.roll = on ? 1 : 0; });
    root.querySelector('#touch-pause').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.state.pause = true;
    });
  }

  enable() {
    this.enabled = true;
    this.onEnable?.();
  }

  setVisible(visible) {
    this.root.hidden = !(visible && this.enabled);
  }

  hold(selector, set) {
    const el = this.root.querySelector(selector);
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      capture(el, e.pointerId);
      el.classList.add('held');
      set(true);
    });
    const up = () => {
      el.classList.remove('held');
      set(false);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  moveStick(e) {
    let dx = e.clientX - this.origin.x;
    let dy = e.clientY - this.origin.y;
    const mag = Math.hypot(dx, dy);
    if (mag > STICK_RADIUS) {
      dx = (dx / mag) * STICK_RADIUS;
      dy = (dy / mag) * STICK_RADIUS;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    this.state.steerX = dx / STICK_RADIUS;
    this.state.steerY = -dy / STICK_RADIUS;
  }

  // Edge-triggered pause, consumed once per frame.
  takePause() {
    const p = this.state.pause;
    this.state.pause = false;
    return p;
  }
}
