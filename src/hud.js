import { describeTricks, countTricks, LANDING } from './scoring.js';
import { SEABED_Y } from './physics.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');

// Depth gauge range: the top 40% shows height above water, the rest depth below.
const GAUGE_MAX_HEIGHT = 40;
const GAUGE_SURFACE = 0.4;

export function entryClass(angle) {
  if (angle <= LANDING.perfect.maxAngle) return 'good';
  if (angle <= LANDING.clean.maxAngle) return 'ok';
  return 'bad';
}

export class Hud {
  constructor() {
    this.root = $('hud');
    this.el = {
      score: $('score'), combo: $('combo'), timer: $('timer'), timerPanel: document.querySelector('.timer-panel'),
      speed: $('speed'), speedbar: $('speedbar'), marker: $('depth-marker'), depthLabel: $('depth-label'),
      tricks: $('tricks'), entry: $('entry'), popup: $('popup'), device: $('device'), toast: $('toast'),
    };
    this.popupTimer = 0;
    this.toastTimer = 0;
    this.lastText = {};

    // Fill every controls slot from the one template.
    const tpl = $('controls-template');
    document.querySelectorAll('.controls-slot').forEach((slot) => slot.append(tpl.content.cloneNode(true)));
  }

  // Only touch the DOM when text actually changes.
  set(key, text) {
    if (this.lastText[key] === text) return;
    this.lastText[key] = text;
    this.el[key].textContent = text;
  }

  setVisible(v) {
    this.root.hidden = !v;
  }

  update({ sim, keeper, timeLeft, entryAngle, landingSoon }, dt) {
    this.set('score', fmt(keeper.score));
    this.set('combo', keeper.combo > 1 ? `Combo ×${(1 + 0.25 * (keeper.combo - 1)).toFixed(2)}` : '');

    const t = Math.max(0, Math.ceil(timeLeft));
    this.set('timer', `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`);
    this.el.timerPanel.classList.toggle('low', timeLeft < 10);

    const speed = sim.velocity.length();
    this.set('speed', fmt(speed * 3.6));
    this.el.speedbar.style.width = `${Math.min(100, (speed / 60) * 100)}%`;

    // Depth gauge marker.
    const y = sim.position.y;
    const frac = y >= 0
      ? GAUGE_SURFACE * (1 - Math.min(1, y / GAUGE_MAX_HEIGHT))
      : GAUGE_SURFACE + (1 - GAUGE_SURFACE) * Math.min(1, y / SEABED_Y);
    this.el.marker.style.top = `${frac * 100}%`;
    this.el.depthLabel.style.top = `${frac * 100}%`;
    this.set('depthLabel', y >= 0 ? `${y.toFixed(1)} m ↑` : `${(-y).toFixed(1)} m ↓`);

    if (sim.airborne) {
      this.set('tricks', describeTricks(countTricks(sim.rotation)));
      const cls = entryClass(entryAngle);
      const word = { good: 'Perfect', ok: 'OK', bad: 'Wipeout!' }[cls];
      this.set('entry', `Entry ${Math.round(entryAngle)}° · ${word}`);
      this.el.entry.className = landingSoon ? cls : '';
      this.el.entry.style.opacity = landingSoon ? '1' : '0.55';
    } else {
      this.set('tricks', '');
      this.set('entry', '');
    }

    if (this.popupTimer > 0) {
      this.popupTimer -= dt;
      if (this.popupTimer <= 0) this.el.popup.classList.remove('show');
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.el.toast.classList.remove('show');
    }
  }

  showLanding(result) {
    const { popup } = this.el;
    const label = LANDING[result.grade].label;
    const trickText = describeTricks(result.tricks);
    popup.className = `show ${result.grade}`;
    popup.replaceChildren(label);
    if (result.points) {
      const pts = document.createElement('span');
      pts.className = 'points';
      pts.textContent = `${trickText ? `${trickText} · ` : ''}+${fmt(result.points)}`;
      popup.append(pts);
    }
    this.popupTimer = 1.6;
  }

  showDevice(device, name) {
    const text = {
      keyboard: '⌨ Keyboard',
      gamepad: `🎮 ${name ?? 'Controller'}`,
      touch: '👆 Touch',
    }[device];
    this.el.device.textContent = text;
  }

  toast(text) {
    this.el.toast.textContent = text;
    this.el.toast.classList.add('show');
    this.toastTimer = 2.5;
  }
}
