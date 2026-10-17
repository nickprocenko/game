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

const ROUND_SECONDS = 120;
const STEP = 1 / 120;
const BEST_KEY = 'dolphin3d.best';
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
  results: document.getElementById('results'),
};

let mode = 'title';
let timeLeft = ROUND_SECONDS;
let best = Number(store.get(BEST_KEY)) || 0;
let accumulator = 0;
let clock = 0;
let dripTime = 0;
let resultsAt = 0;
input.invertY = store.get(INVERT_KEY) === '1';

const landing = predictLanding(sim.position, sim.velocity);
const nose = new THREE.Vector3();
const tailWorld = new THREE.Vector3();

function setMode(next) {
  mode = next;
  for (const [name, el] of Object.entries(overlays)) el.hidden = name !== next;
  hud.setVisible(next === 'playing' || next === 'paused');
  touch.setVisible(next === 'playing');
}

function startRound() {
  sim.reset();
  keeper.reset();
  timeLeft = ROUND_SECONDS;
  accumulator = 0;
  rig.snap();
  setMode('playing');
}

function endRound() {
  const isBest = keeper.score > best;
  if (isBest) {
    best = keeper.score;
    store.set(BEST_KEY, String(best));
  }
  document.getElementById('final-score').textContent = keeper.score.toLocaleString('en-US');
  document.getElementById('final-detail').textContent = [
    isBest && best > 0 ? 'New personal best!' : `Best ${best.toLocaleString('en-US')}`,
    `Top jump ${keeper.bestJump.toLocaleString('en-US')}`,
    `Highest ${keeper.maxHeight.toFixed(1)} m`,
  ].join(' · ');
  resultsAt = clock;
  setMode('results');
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
      }
      const rumble = { perfect: [0.2, 0.6, 120], clean: [0.45, 0.45, 160], wipeout: [1, 0.7, 380] }[e.grade];
      input.rumble(...rumble);
    }
  }
}

// Cruises in lazy circles behind the title and results screens.
const demoInput = { steerX: 0.25, steerY: 0, roll: 0, swim: 0 };

function frame(now) {
  const dt = Math.min(0.05, (now - (frame.last ?? now)) / 1000);
  frame.last = now;
  const controls = input.poll();

  if (mode === 'title' || mode === 'results') {
    // Short delay so a button mashed during the last jump doesn't skip the results.
    if (controls.confirm && (mode === 'title' || clock - resultsAt > 1)) startRound();
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
    if (mode === 'playing') {
      timeLeft -= dt;
      // The buzzer waits for the last jump to land.
      if (timeLeft <= 0 && !sim.airborne) endRound();
    }
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

  rig.update(sim, sim.airborne ? landing : null, mode === 'playing' ? controls : demoInput, dt);
  world.update(camera, clock);
  if (mode === 'playing' || mode === 'paused') {
    hud.update({ sim, keeper, timeLeft, entryAngle, landingSoon }, dt);
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

setMode('title');
requestAnimationFrame(frame);

// Handy for debugging from the console.
window.__game = { sim, keeper, input, world, camera, startRound, get mode() { return mode; } };
