import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { DolphinSim, predictLanding, GRAVITY } from '../src/physics.js';
import { countTricks, fullTurns, gradeLanding, ScoreKeeper } from '../src/scoring.js';

const idle = { steerX: 0, steerY: 0, roll: 0, swim: 0 };
const DT = 1 / 120;

function run(sim, input, seconds, onEvent = () => {}) {
  for (let t = 0; t < seconds; t += DT) sim.step(input, DT).forEach(onEvent);
}

test('a partial rotation still counts once it passes 330°', () => {
  assert.equal(fullTurns((300 * Math.PI) / 180), 0);
  assert.equal(fullTurns((335 * Math.PI) / 180), 1);
  assert.equal(fullTurns((-700 * Math.PI) / 180), 2);
});

test('flip direction follows the sign of pitch rotation', () => {
  const TAU = Math.PI * 2;
  assert.deepEqual(countTricks({ x: TAU, y: 0, z: 0 }), [{ type: 'backflip', count: 1 }]);
  assert.deepEqual(countTricks({ x: -2 * TAU, y: 0, z: TAU }), [
    { type: 'frontflip', count: 2 },
    { type: 'roll', count: 1 },
  ]);
});

test('landing grades by nose-to-velocity angle', () => {
  assert.equal(gradeLanding(10), 'perfect');
  assert.equal(gradeLanding(30), 'clean');
  assert.equal(gradeLanding(90), 'wipeout');
});

test('wipeout resets the combo and scores nothing', () => {
  const keeper = new ScoreKeeper();
  const flip = { x: Math.PI * 2, y: 0, z: 0 };
  keeper.land({ rotation: flip, maxHeight: 10, grade: 'clean' });
  keeper.land({ rotation: flip, maxHeight: 10, grade: 'perfect' });
  assert.equal(keeper.combo, 2);
  const result = keeper.land({ rotation: flip, maxHeight: 10, grade: 'wipeout' });
  assert.equal(result.points, 0);
  assert.equal(keeper.combo, 0);
});

test('landing prediction matches the simulated arc', () => {
  const pos = new Vector3(0, 0, 0);
  const vel = new Vector3(3, 20, -5);
  const p = predictLanding(pos, vel);
  assert.ok(Math.abs(p.time - (2 * 20) / GRAVITY) < 1e-9);
  assert.ok(Math.abs(p.point.x - 3 * p.time) < 1e-9);
  assert.ok(Math.abs(p.velocity.y + 20) < 1e-9);
});

test('swimming straight up from depth launches out of the water', () => {
  const sim = new DolphinSim();
  sim.position.set(0, -40, 0);
  sim.pitch = (80 * Math.PI) / 180;
  const events = [];
  run(sim, { ...idle, swim: 1 }, 4, (e) => events.push(e));
  const exit = events.find((e) => e.type === 'exit');
  assert.ok(exit, 'expected the dolphin to leave the water');
  assert.ok(exit.speed > 20, `exit speed ${exit.speed}`);
});

test('a shallow climb skims the surface instead of jumping', () => {
  const sim = new DolphinSim();
  sim.position.set(0, -2, 0);
  sim.pitch = (5 * Math.PI) / 180;
  const events = [];
  run(sim, idle, 3, (e) => events.push(e));
  assert.equal(events.length, 0);
  assert.ok(sim.position.y < 0);
});

test('keeping the launch pose all the way down wipes out', () => {
  // With no input the nose keeps pointing up the way it left the water,
  // so a near-vertical jump comes down tail first.
  const sim = new DolphinSim();
  sim.position.set(0, -40, 0);
  sim.pitch = (80 * Math.PI) / 180;
  let landing;
  run(sim, { ...idle, swim: 1 }, 10, (e) => {
    if (e.type === 'land') landing ??= e;
  });
  assert.ok(landing, 'expected a landing');
  assert.equal(landing.grade, 'wipeout', 'nose-up entry should wipe out');
});

test('a full backflip in the air scores and lands clean', () => {
  const sim = new DolphinSim();
  sim.position.set(0, -40, 0);
  sim.pitch = (80 * Math.PI) / 180;
  const keeper = new ScoreKeeper();
  let result;
  let airStart = null;
  for (let t = 0; t < 12 && !result; t += DT) {
    let input = { ...idle, swim: 1 };
    if (sim.airborne) {
      airStart ??= t;
      // Flip once and a half: the launch pose points up, the landing must point down.
      input = { ...idle, steerY: sim.rotation.x < Math.PI * 3 - 0.15 ? 1 : 0 };
    }
    for (const e of sim.step(input, DT)) {
      if (e.type === 'land') result = keeper.land(e);
    }
  }
  assert.ok(result, 'expected a landing');
  assert.notEqual(result.grade, 'wipeout');
  assert.deepEqual(result.tricks, [{ type: 'backflip', count: 1 }]);
  assert.ok(result.points > 0);
});
