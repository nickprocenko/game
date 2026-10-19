import * as THREE from 'three';
import { Input } from './input.js';
import { TouchControls } from './touch.js';
import { DolphinSim, predictLanding, angleBetweenDeg, SURFACE_Y } from './physics.js';
import { ScoreKeeper } from './scoring.js';
import { World } from './world.js';
import { createDolphin, animateTail } from './dolphin.js';
import { Effects } from './effects.js';
import { CameraRig } from './camera.js';
import { Hud, entryClass } from './hud.js';
import { realAltitude, markersPassed, formatAltitude } from './altitude.js';

const STEP = 1 / 120;
const BEST_KEY = 'dolphin3d.bestAltitude';
const INVERT_KEY = 'dolphin3d.invertY';
const ENTRY_COLORS = { good: 0x5be37d, ok: 0xffd25a, bad: 0xff6b5a };

// Storage can be unavailable (private windows, sandboxed previews).
const store = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* ignore */ }
  },
};

// --- Renderer and scene ---
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 3000);
const world = new World(scene);
const effects = new Effects(scene);
const dolphin = createDolphin();
scene.add(dolphin.root);

// Landing marker on the water while airborne.
const markerGeo = new THREE.RingGeometry(1.2, 1.6, 40);
markerGeo.rotateX(-Math.PI / 2);
const marker = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({
  color: ENTRY_COLORS.good, transparent: true, opacity: 0.85, depthWrite: false, fog: false,
}));
marker.position.y = SURFACE_Y + 0.35;
marker.renderOrder = 4;
marker.visible = false;
scene.add(marker);

// Arrow just below the dolphin on long falls: it points the way the dolphin
// will be travelling when it hits the water, i.e. the way to face.
const arrowGeo = new THREE.ConeGeometry(0.35, 1.1, 12);
arrowGeo.rotateX(-Math.PI / 2); // tip along -Z, the dolphin's forward axis
const arrow = new THREE.Mesh(arrowGeo, new THREE.MeshBasicMaterial({
  color: ENTRY_COLORS.good, transparent: true, opacity: 0.8, depthWrite: false, fog: false,
}));
arrow.renderOrder = 5;
arrow.visible = false;
scene.add(arrow);
const ARROW_FORWARD = new THREE.Vector3(0, 0, -1);

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  effects.setViewportHeight(h * renderer.getPixelRatio());
}
window.addEventListener('resize', resize);
resize();

// --- Game state ---
const input = new Input();
const touch = new TouchControls(document.getElementById('touch'));
input.touch = touch;
const sim = new DolphinSim();
const keeper = new ScoreKeeper();
const rig = new CameraRig(camera);
const hud = new Hud();

const overlays = {
  title: document.getElementById('title'),
  paused: document.getElementById('pause'),
};

let mode = 'title';
let best = Number(store.get(BEST_KEY)) || 0;
let accumulator = 0;
let clock = 0;
let dripTime = 0;
// Altitude trivia already shown this run, and the altitude last frame.
let factsShown = new Set();
let lastAltitude = 0;
input.invertY = store.get(INVERT_KEY) === '1';

const landing = predictLanding(sim.position, sim.velocity);
const nose = new THREE.Vector3();
const entryDir = new THREE.Vector3();
const tailWorld = new THREE.Vector3();

function setMode(next) {
  mode = next;
  for (const [name, el] of Object.entries(overlays)) el.hidden = name !== next;
  hud.setVisible(next === 'playing' || next === 'paused');
  touch.setVisible(next === 'playing');
}

// Runs are open-ended: no timer, no dying. Restart from the pause menu.
function startRound() {
  sim.reset();
  keeper.reset();
  accumulator = 0;
  factsShown = new Set();
  lastAltitude = 0;
  hud.hideFact();
  rig.snap();
  setMode('playing');
}

function checkAltitude() {
  const altitude = realAltitude(sim.position.y);
  for (const m of markersPassed(lastAltitude, altitude)) {
    if (factsShown.has(m)) continue;
    factsShown.add(m);
    hud.showFact(m);
  }
  lastAltitude = altitude;
}

function recordHeight(maxHeight) {
  const altitude = realAltitude(maxHeight);
  if (altitude <= best) return;
  // Don't make a fuss over the first few small hops.
  if (best >= 100) hud.toast(`New record: ${formatAltitude(altitude)}`);
  best = altitude;
  store.set(BEST_KEY, String(Math.round(best)));
}

function toggleInvert() {
  input.invertY = !input.invertY;
  store.set(INVERT_KEY, input.invertY ? '1' : '0');
  document.getElementById('invert-btn').textContent = `Invert Y: ${input.invertY ? 'On' : 'Off'}`;
  hud.toast(`Invert Y ${input.invertY ? 'on' : 'off'}`);
}
document.getElementById('invert-btn').textContent = `Invert Y: ${input.invertY ? 'On' : 'Off'}`;

// Menu buttons for mouse and touch.
document.addEventListener('click', (e) => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'start') startRound();
  if (action === 'resume') setMode('playing');
  if (action === 'restart') startRound();
  if (action === 'invert') toggleInvert();
  // Otherwise Space (swim) would press the focused button again.
  if (action) document.activeElement?.blur();
});

input.onDeviceChange = (device, name) => {
  hud.showDevice(device, name);
  if (device === 'gamepad' && name) hud.toast(`${name} connected`);
  document.getElementById('title-hint').hidden = device === 'touch';
};
touch.onEnable = () => {
  input.setDevice('touch');
  touch.setVisible(mode === 'playing');
};
window.addEventListener('gamepaddisconnected', () => hud.toast('Controller disconnected'));
hud.showDevice('keyboard');

function handleEvents(events) {
  for (const e of events) {
    if (e.type === 'exit') {
      const strength = Math.min(1, e.speed / 45);
      effects.splash(e.position, sim.velocity, strength);
      dripTime = 0.6;
      input.rumble(0.15, 0.35, 90);
    } else if (e.type === 'land') {
      // A perfect entry rips through with little splash; a wipeout belly-flops.
      const base = Math.min(1, e.entrySpeed / 45);
      const strength = { perfect: base * 0.45, clean: base, wipeout: Math.min(1, base * 1.4 + 0.2) }[e.grade];
      effects.splash(e.position, sim.velocity, strength);
      if (mode === 'playing') {
        const result = keeper.land(e);
        hud.showLanding(result);
        recordHeight(e.maxHeight);
      }
      const rumble = { perfect: [0.2, 0.6, 120], clean: [0.45, 0.45, 160], wipeout: [1, 0.7, 380] }[e.grade];
      input.rumble(...rumble);
    }
  }
}

// Cruises in lazy circles behind the title screen.
const demoInput = { steerX: 0.25, steerY: 0, roll: 0, swim: 0 };

function frame(now) {
  const dt = Math.min(0.05, (now - (frame.last ?? now)) / 1000);
  frame.last = now;
  const controls = input.poll();

  if (mode === 'title') {
    if (controls.confirm) startRound();
    if (controls.invert) toggleInvert();
  } else if (mode === 'playing') {
    if (controls.pause) setMode('paused');
    else if (controls.restart) startRound();
  } else if (mode === 'paused') {
    if (controls.pause || controls.confirm) setMode('playing');
    else if (controls.restart) startRound();
    else if (controls.invert) toggleInvert();
  }

  if (mode !== 'paused') {
    clock += dt;
    const simInput = mode === 'playing' ? controls : demoInput;
    accumulator += dt;
    while (accumulator >= STEP) {
      accumulator -= STEP;
      handleEvents(sim.step(simInput, STEP));
    }
    if (mode === 'playing') checkAltitude();
    effects.update(dt, clock);
    if (dripTime > 0 && sim.airborne) {
      dripTime -= dt;
      effects.drip(sim.position, sim.velocity);
    }
  }

  // Dolphin pose.
  dolphin.root.position.copy(sim.position);
  dolphin.root.quaternion.copy(sim.display);
  const effort = mode === 'playing' ? controls.swim : 0;
  animateTail(dolphin.tail, clock, effort, sim.airborne);
  if (!sim.airborne && mode !== 'paused') {
    dolphin.tail.getWorldPosition(tailWorld);
    effects.trail(tailWorld, effort, dt);
  }

  // Landing marker and entry angle.
  let entryAngle = 0;
  let landingSoon = false;
  if (sim.airborne) {
    predictLanding(sim.position, sim.velocity, landing);
    sim.forward(sim.orientation, nose);
    entryAngle = angleBetweenDeg(nose, landing.velocity);
    landingSoon = sim.velocity.y < 0 && landing.time < 1.2;
    marker.position.x = landing.point.x;
    marker.position.z = landing.point.z;
    marker.material.color.setHex(ENTRY_COLORS[entryClass(entryAngle)]);
    marker.scale.setScalar(1 + Math.sin(clock * 8) * 0.08 + Math.min(2, landing.time) * 0.5);
  }
  marker.visible = sim.airborne;

  // The water-and-heading arrow, for falls long enough that the ring is out of sight.
  const showArrow = sim.airborne && sim.velocity.y < 0 && sim.position.y > 30;
  if (showArrow) {
    arrow.material.color.setHex(ENTRY_COLORS[entryClass(entryAngle)]);
    entryDir.copy(landing.velocity).normalize();
    arrow.quaternion.setFromUnitVectors(ARROW_FORWARD, entryDir);
    arrow.position.copy(sim.position).addScaledVector(entryDir, 2.8);
    arrow.position.y -= 0.6;
    arrow.material.opacity = 0.55 + 0.35 * Math.min(1, 4 / Math.max(1, landing.time));
  }
  arrow.visible = showArrow;

  rig.update(sim, sim.airborne ? landing : null, mode === 'playing' ? controls : demoInput, dt);
  world.update(camera, clock);
  if (mode === 'playing' || mode === 'paused') {
    hud.update({ sim, keeper, best, entryAngle, landingSoon, landingTime: landing.time }, dt);
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

setMode('title');
requestAnimationFrame(frame);

// Handy for debugging from the console.
window.__game = { sim, keeper, input, world, camera, startRound, get mode() { return mode; } };
