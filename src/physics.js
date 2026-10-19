import { Euler, Quaternion, Vector3 } from 'three';
import { gradeLanding, LANDING } from './scoring.js';

// World units are roughly metres. The water surface is the plane y = 0.
export const SURFACE_Y = 0;
export const SEABED_Y = -55;
export const GRAVITY = 24;
// Gravity fades with height as if the ocean sat on a small planet of this
// radius, so the biggest jumps hang a little longer at the top. Escape speed,
// sqrt(2 * GRAVITY * PLANET_RADIUS) ≈ 219 m/s, is far above MAX_SPEED, so you
// always come back down: leaving the planet is faked with the altitude scale.
export const PLANET_RADIUS = 1000;

const CRUISE_SPEED = 7;
const SWIM_ACCEL = 16;
const MAX_SWIM_SPEED = 30; // top speed from swimming alone
export const MAX_SPEED = 130; // hard cap, reachable only by chaining clean landings
const MOMENTUM_BLEED = 0.35; // how fast speed above MAX_SWIM_SPEED decays underwater
const TURN_RATE = 1.9;
const PITCH_RATE = 1.7;
const MAX_PITCH = (80 * Math.PI) / 180;
const EXIT_MIN_VY = 4; // slower than this and you skim along the surface instead
const SKIM_DEPTH = -0.4;
// After a clean landing the dolphin curls back up toward the surface on its own.
const REDIRECT_MIN_RATE = 2.5; // rad/s
const REDIRECT_RADIUS = 22; // turning radius at speed, in metres
// Just before entry, with the stick released, the nose eases toward the
// direction of travel so tiny errors at huge speed don't wipe you out.
const ASSIST_WINDOW = 0.45; // seconds before impact
const ASSIST_RATE = 2.2; // rad/s, too slow to rescue a badly wrong pose

const FLIP_RATE = 6.5;
const SPIN_RATE = 5.5;
const ROLL_RATE = 7.5;
const SPIN_RESPONSE = 10;

const FORWARD = new Vector3(0, 0, -1);
const _v = new Vector3();
const _t = new Vector3();
const _axis = new Vector3();
const _q = new Quaternion();
const _e = new Euler(0, 0, 0, 'YXZ');

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const approach = (cur, target, rate, dt) => cur + (target - cur) * Math.min(1, rate * dt);

export function gravityAt(y) {
  const r = 1 + Math.max(0, y - SURFACE_Y) / PLANET_RADIUS;
  return GRAVITY / (r * r);
}

// Where a ballistic body will hit the water, and with what velocity.
// Gravity varies with height, so this integrates the arc the same way the sim does.
export function predictLanding(pos, vel, out = { point: new Vector3(), velocity: new Vector3(), time: 0 }) {
  let { x, y, z } = pos;
  let vy = vel.y;
  let t = 0;
  for (let i = 0; i < 100000 && y >= SURFACE_Y; i++) {
    // Big steps high up where gravity is weak, fine steps near the water.
    const dt = y - SURFACE_Y > 150 ? 1 / 30 : 1 / 120;
    vy -= gravityAt(y) * dt;
    y += vy * dt;
    x += vel.x * dt;
    z += vel.z * dt;
    t += dt;
  }
  out.time = t;
  out.point.set(x, SURFACE_Y, z);
  out.velocity.set(vel.x, vy, vel.z);
  return out;
}

export function angleBetweenDeg(a, b) {
  const d = a.dot(b) / (a.length() * b.length() || 1);
  return (Math.acos(clamp(d, -1, 1)) * 180) / Math.PI;
}

export class DolphinSim {
  constructor() {
    this.position = new Vector3();
    this.velocity = new Vector3();
    this.orientation = new Quaternion(); // true orientation in the air
    this.display = new Quaternion(); // smoothed orientation for rendering
    this.angularVelocity = new Vector3(); // local frame, air only
    this.rotation = new Vector3(); // accumulated local rotation this jump
    this.reset();
  }

  reset() {
    this.position.set(0, -12, 0);
    this.yaw = 0;
    this.pitch = 0;
    this.bank = 0;
    this.speed = CRUISE_SPEED;
    this.airborne = false;
    this.airTime = 0;
    this.jumpHeight = 0;
    this.stun = 0;
    this.redirecting = false;
    this.angularVelocity.set(0, 0, 0);
    this.rotation.set(0, 0, 0);
    this.updateUnderwaterOrientation();
    this.display.copy(this.orientation);
    this.velocity.copy(this.forward()).multiplyScalar(this.speed);
  }

  forward(q = this.orientation, out = new Vector3()) {
    return out.copy(FORWARD).applyQuaternion(q);
  }

  get depth() {
    return SURFACE_Y - this.position.y;
  }

  updateUnderwaterOrientation() {
    _e.set(this.pitch, this.yaw, this.bank, 'YXZ');
    this.orientation.setFromEuler(_e);
  }

  // Advances the simulation. Returns events ('exit', 'land') for effects and scoring.
  step(input, dt) {
    const events = [];
    if (this.airborne) this.stepAir(input, dt, events);
    else this.stepWater(input, dt, events);

    // Rendering follows the true orientation in the air, and eases into the
    // swim pose after a landing instead of snapping.
    if (this.airborne) this.display.copy(this.orientation);
    else this.display.slerp(this.orientation, 1 - Math.exp(-10 * dt));
    return events;
  }

  stepWater(input, dt, events) {
    const control = this.stun > 0 ? 0.25 : 1;
    this.stun = Math.max(0, this.stun - dt);

    const yawRate = -input.steerX * TURN_RATE * control;
    this.yaw += yawRate * dt;
    // Pushing the stick down cancels the redirect and lets you dive.
    if (this.redirecting && input.steerY < -0.5) this.redirecting = false;
    if (this.redirecting) {
      const rate = Math.max(REDIRECT_MIN_RATE, this.speed / REDIRECT_RADIUS);
      this.pitch = Math.min(MAX_PITCH, this.pitch + rate * dt);
      if (this.pitch >= MAX_PITCH) this.redirecting = false;
    } else {
      this.pitch = clamp(this.pitch + input.steerY * PITCH_RATE * control * dt, -MAX_PITCH, MAX_PITCH);
    }
    this.bank = approach(this.bank, yawRate * 0.4, 5, dt);

    // Swimming only accelerates you up to MAX_SWIM_SPEED; anything above that
    // was carried in from a landing and slowly bleeds away.
    const swim = input.swim * control;
    if (swim > 0 && this.speed < MAX_SWIM_SPEED) {
      this.speed = Math.min(MAX_SWIM_SPEED, this.speed + SWIM_ACCEL * swim * dt);
    }
    if (this.speed > MAX_SWIM_SPEED && !this.redirecting) {
      this.speed -= (this.speed - MAX_SWIM_SPEED) * MOMENTUM_BLEED * dt;
    } else if (swim === 0) {
      this.speed = approach(this.speed, CRUISE_SPEED, 0.8, dt);
    }

    // Don't plough into the seabed: level out.
    if (this.position.y < SEABED_Y + 3 && this.pitch < 0 && !this.redirecting) {
      this.pitch = approach(this.pitch, 0, 6, dt);
    }

    this.updateUnderwaterOrientation();
    this.velocity.copy(this.forward()).multiplyScalar(this.speed);
    this.position.addScaledVector(this.velocity, dt);
    this.position.y = Math.max(this.position.y, SEABED_Y + 1.5);

    if (this.position.y >= SURFACE_Y) {
      if (this.velocity.y > EXIT_MIN_VY) {
        this.launch(events);
      } else {
        this.position.y = SKIM_DEPTH;
      }
    }
  }

  launch(events) {
    this.airborne = true;
    this.redirecting = false;
    this.airTime = 0;
    this.jumpHeight = 0;
    this.angularVelocity.set(0, 0, 0);
    this.rotation.set(0, 0, 0);
    events.push({ type: 'exit', speed: this.speed, position: this.position.clone() });
  }

  stepAir(input, dt, events) {
    this.airTime += dt;
    this.velocity.y -= gravityAt(this.position.y) * dt;
    this.position.addScaledVector(this.velocity, dt);
    this.jumpHeight = Math.max(this.jumpHeight, this.position.y);

    // Stick up = nose up (backflip), right = spin right, bumpers = barrel roll.
    const w = this.angularVelocity;
    w.x = approach(w.x, input.steerY * FLIP_RATE, SPIN_RESPONSE, dt);
    w.y = approach(w.y, -input.steerX * SPIN_RATE, SPIN_RESPONSE, dt);
    w.z = approach(w.z, -input.roll * ROLL_RATE, SPIN_RESPONSE, dt);

    const angle = w.length() * dt;
    if (angle > 0) {
      _v.copy(w).normalize();
      _q.setFromAxisAngle(_v, angle);
      this.orientation.multiply(_q).normalize(); // post-multiply = local axes
    }
    this.rotation.addScaledVector(w, dt);

    // The assist turns the nose without counting toward tricks, and only
    // kicks in once you stop rotating.
    const idle = Math.abs(input.steerX) < 0.2 && Math.abs(input.steerY) < 0.2 && !input.roll;
    const height = this.position.y - SURFACE_Y;
    if (idle && this.velocity.y < 0 && height < -this.velocity.y * ASSIST_WINDOW) {
      const nose = this.forward(this.orientation, _v);
      const target = _t.copy(this.velocity).normalize();
      const angle = Math.acos(clamp(nose.dot(target), -1, 1));
      if (angle > 1e-4) {
        _axis.crossVectors(nose, target).normalize();
        if (_axis.lengthSq() > 0) {
          _q.setFromAxisAngle(_axis, Math.min(angle, ASSIST_RATE * dt));
          this.orientation.premultiply(_q).normalize(); // pre-multiply = world axes
        }
      }
    }

    if (this.position.y < SURFACE_Y) this.land(events);
  }

  land(events) {
    const nose = this.forward();
    const entrySpeed = this.velocity.length();
    const angle = angleBetweenDeg(nose, this.velocity);
    const grade = gradeLanding(angle);

    // Underwater the dolphin always swims where it points, so take the new
    // heading from the direction of travel.
    _v.copy(this.velocity).normalize();
    this.yaw = Math.atan2(-_v.x, -_v.z);
    this.pitch = clamp(Math.asin(clamp(_v.y, -1, 1)), -MAX_PITCH, MAX_PITCH);
    this.bank = 0;
    this.speed = Math.min(MAX_SPEED, entrySpeed * LANDING[grade].speedKeep);
    this.stun = grade === 'wipeout' ? 0.9 : 0;
    this.redirecting = grade !== 'wipeout' && this.pitch < 0;
    this.airborne = false;
    this.position.y = Math.min(this.position.y, -0.5);
    this.updateUnderwaterOrientation();

    events.push({
      type: 'land',
      grade,
      angle,
      entrySpeed,
      maxHeight: this.jumpHeight,
      airTime: this.airTime,
      rotation: this.rotation.clone(),
      position: this.position.clone(),
    });
  }
}
