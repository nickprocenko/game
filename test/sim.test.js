import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { Quaternion } from 'three';
import { DolphinSim, predictLanding, gravityAt, GRAVITY } from '../src/physics.js';
import { countTricks, fullTurns, gradeLanding, ScoreKeeper } from '../src/scoring.js';
import { realAltitude, markersPassed } from '../src/altitude.js';

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
  const sim = new DolphinSim();
  sim.airborne = true;
  sim.position.set(0, 0, 0);
  sim.velocity.set(3, 60, -5);
  const p = predictLanding(sim.position, sim.velocity);
  let landing;
  run(sim, idle, 20, (e) => {
    if (e.type === 'land') landing ??= e;
  });
  assert.ok(landing, 'expected a landing');
  assert.ok(Math.abs(p.time - landing.airTime) < 0.05, `predicted ${p.time}, took ${landing.airTime}`);
  assert.ok(Math.abs(p.point.x - landing.position.x) < 0.5);
  assert.ok(Math.abs(p.velocity.y + 60) < 1);
});

test('gravity weakens with height', () => {
  assert.equal(gravityAt(0), GRAVITY);
  assert.equal(gravityAt(-10), GRAVITY);
  assert.ok(gravityAt(500) < GRAVITY * 0.5);
});

test('real altitude climbs steeply and passes markers once', () => {
  assert.ok(Math.abs(realAltitude(10) - 10) < 3, 'a metre is about a metre near the water');
  assert.ok(realAltitude(300) > 100_000, 'a few hundred game metres is space');
  assert.ok(realAltitude(301) > realAltitude(300));
  assert.deepEqual(markersPassed(90_000, 410_000).map((m) => m.name), ['Kármán line', 'Space Station']);
  assert.equal(markersPassed(410_000, 90_000).length, 0, 'falling back past a marker shows nothing');
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

// Holds the nose along the direction of travel the whole jump.
function perfectPose(sim) {
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), sim.velocity.clone().normalize());
  sim.orientation.copy(q);
}

test('a clean landing curls back up and launches again, faster', () => {
  const sim = new DolphinSim();
  sim.position.set(0, -40, 0);
  sim.pitch = (80 * Math.PI) / 180;
  const exits = [];
  for (let t = 0; t < 40 && exits.length < 3; t += DT) {
    if (sim.airborne) perfectPose(sim);
    for (const e of sim.step({ ...idle, swim: sim.airborne ? 0 : 1 }, DT)) {
      if (e.type === 'exit') exits.push(e.speed);
    }
  }
  assert.equal(exits.length, 3, 'expected three launches in a row');
  assert.ok(exits[1] > exits[0] * 1.1 && exits[2] > exits[1] * 1.1, `exit speeds ${exits}`);
});

test('the entry assist fixes a small misalignment', () => {
  const sim = new DolphinSim();
  sim.airborne = true;
  sim.position.set(0, 12, 0);
  sim.velocity.set(0, -30, -10);
  perfectPose(sim);
  // Tilt the nose 30° off: a plain "clean" without help.
  sim.orientation.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), (30 * Math.PI) / 180));
  let landing;
  run(sim, idle, 5, (e) => {
    if (e.type === 'land') landing ??= e;
  });
  assert.ok(landing, 'expected a landing');
  assert.equal(landing.grade, 'perfect', `entry angle ${landing.angle}`);
});
