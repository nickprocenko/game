import { describeTricks, countTricks, LANDING } from './scoring.js';
import { SEABED_Y, MAX_SPEED } from './physics.js';
import { realAltitude, scaleAt, formatAltitude } from './altitude.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');

// Depth gauge range: the top 40% shows real altitude on a log scale up to
// geostationary orbit, the rest depth below.
const GAUGE_MAX_LOG = Math.log10(40_000_000);
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
      score: $('score'), combo: $('combo'), altitude: $('altitude'), bestAltitude: $('best-altitude'),
      speed: $('speed'), speedUnit: $('speed-unit'), speedbar: $('speedbar'), marker: $('depth-marker'), depthLabel: $('depth-label'),
      tricks: $('tricks'), entry: $('entry'), popup: $('popup'), device: $('device'), toast: $('toast'),
      fact: $('fact'),
    };
    this.popupTimer = 0;
    this.factTimer = 0;
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

  update({ sim, keeper, best, entryAngle, landingSoon, landingTime }, dt) {
    this.set('score', fmt(keeper.score));
    this.set('combo', keeper.combo > 1 ? `Combo ×${(1 + 0.25 * (keeper.combo - 1)).toFixed(2)}` : '');

    const y = sim.position.y;
    const real = realAltitude(y);
    this.set('altitude', y >= 0 ? formatAltitude(real) : `−${formatAltitude(-y)}`);
    this.set('bestAltitude', best > 0 ? `Best ${formatAltitude(best)}` : '');

    // Pulse-drive readout: speed on the squashed altitude scale.
    const speed = sim.velocity.length();
    const kmh = speed * 3.6 * (sim.airborne ? scaleAt(y) : 1);
    this.set('speed', fmt(kmh < 100_000 ? kmh : kmh / 3600));
    this.set('speedUnit', kmh < 100_000 ? 'km/h' : 'km/s');
    this.el.speedbar.style.width = `${Math.min(100, (speed / MAX_SPEED) * 100)}%`;

    // Depth gauge marker.
    const frac = y >= 0
      ? GAUGE_SURFACE * (1 - Math.min(1, Math.log10(1 + real) / GAUGE_MAX_LOG))
      : GAUGE_SURFACE + (1 - GAUGE_SURFACE) * Math.min(1, y / SEABED_Y);
    this.el.marker.style.top = `${frac * 100}%`;
    this.el.depthLabel.style.top = `${frac * 100}%`;
    this.set('depthLabel', y >= 0 ? `${formatAltitude(real)} ↑` : `${formatAltitude(-y)} ↓`);

    if (sim.airborne) {
      this.set('tricks', describeTricks(countTricks(sim.rotation)));
      const cls = entryClass(entryAngle);
      const word = { good: 'Perfect', ok: 'OK', bad: 'Wipeout!' }[cls];
      // Long falls get a countdown so you know when to stop tricking and line up.
      const eta = landingTime > 2 && sim.velocity.y < 0 ? ` · water in ${Math.ceil(landingTime)} s` : '';
      this.set('entry', `Entry ${Math.round(entryAngle)}° · ${word}${eta}`);
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
    if (this.factTimer > 0) {
      this.factTimer -= dt;
      if (this.factTimer <= 0) this.el.fact.classList.remove('show');
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

  // Altitude trivia banner.
  showFact(marker) {
    const { fact } = this.el;
    const name = document.createElement('strong');
    name.textContent = `${marker.name} · ${formatAltitude(marker.at)}`;
    fact.replaceChildren(name, marker.fact);
    fact.classList.add('show');
    this.factTimer = 4;
  }

  hideFact() {
    this.factTimer = 0;
    this.el.fact.classList.remove('show');
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
