import * as THREE from 'three';
import { SEABED_Y, SURFACE_Y } from './physics.js';

const ORBIT_RATE = 2.5;
const ORBIT_RETURN = 2; // how fast the orbit springs back when the stick is released
const SURFACE_BAND = 0.8; // keep the lens out of the waves

const _dir = new THREE.Vector3();
const _chase = new THREE.Vector3();
const _ahead = new THREE.Vector3();

const lerpRate = (rate, dt) => 1 - Math.exp(-rate * dt);

function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.heading = 0;
    this.orbitYaw = 0;
    this.orbitPitch = 0;
    this.lookAt = new THREE.Vector3();
    this.offset = new THREE.Vector3();
    this.lookOffset = new THREE.Vector3();
    this.desired = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.first = true;
  }

  snap() {
    this.first = true;
  }

  update(sim, landing, input, dt) {
    const p = sim.position;
    const v = sim.velocity;

    // Follow the direction of travel, not the nose, so flips don't whip the camera around.
    const horiz = Math.hypot(v.x, v.z);
    const travelHeading = sim.airborne && horiz > 1 ? Math.atan2(-v.x, -v.z) : sim.yaw;
    this.heading = this.first ? travelHeading : lerpAngle(this.heading, travelHeading, lerpRate(sim.airborne ? 1.5 : 3, dt));

    // Right stick orbits; let go and it eases back behind the dolphin.
    if (input.lookX || input.lookY) {
      this.orbitYaw += -input.lookX * ORBIT_RATE * dt;
      this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch + input.lookY * ORBIT_RATE * dt, -0.6, 1.1);
    } else {
      this.orbitYaw *= 1 - lerpRate(ORBIT_RETURN, dt);
      this.orbitPitch *= 1 - lerpRate(ORBIT_RETURN, dt);
    }

    // Near the water: pull back and up as the dolphin climbs, so the water
    // stays in view.
    const altitude = Math.max(0, p.y - SURFACE_Y);
    const low = Math.min(altitude, 60);
    const dist = 9 + sim.speed * 0.1 + low * 0.35;
    const height = 2.2 + low * 0.2;
    const yaw = this.heading + this.orbitYaw;
    const back = Math.cos(this.orbitPitch) * dist;
    this.desired.set(
      p.x + Math.sin(yaw) * back,
      p.y + height + Math.sin(this.orbitPitch) * dist,
      p.z + Math.cos(yaw) * back,
    );

    // In the air, look partway toward where the dolphin will come down.
    this.target.copy(p);
    if (sim.airborne && landing) this.target.lerp(landing.point, 0.35);

    // High up: a chase camera right behind the direction of travel, so you
    // look up at the stars on the way up and down at the Earth on the way back.
    const high = sim.airborne ? THREE.MathUtils.smoothstep(altitude, 25, 80) : 0;
    if (high > 0) {
      _dir.copy(v).normalize();
      const chase = 13 + Math.min(60, sim.speed) * 0.08;
      _chase.copy(p).addScaledVector(_dir, -chase);
      _chase.y += 3;
      this.desired.lerp(_chase, high);
      _ahead.copy(p).addScaledVector(_dir, 12);
      this.target.lerp(_ahead, high);
    }

    const cam = this.camera;
    // Smooth the offset from the dolphin rather than the world position, so the
    // camera doesn't fall behind at a hundred metres a second.
    this.desired.sub(p);
    this.target.sub(p);
    if (this.first) {
      this.offset.copy(this.desired);
      this.lookOffset.copy(this.target);
      this.first = false;
    } else {
      this.offset.lerp(this.desired, lerpRate(6, dt));
      this.lookOffset.lerp(this.target, lerpRate(10, dt));
    }
    cam.position.copy(p).add(this.offset);
    cam.position.y = Math.max(cam.position.y, SEABED_Y + 2);
    if (Math.abs(cam.position.y - SURFACE_Y) < SURFACE_BAND) {
      cam.position.y = SURFACE_Y + (p.y >= SURFACE_Y ? SURFACE_BAND : -SURFACE_BAND);
    }
    this.lookAt.copy(p).add(this.lookOffset);
    cam.lookAt(this.lookAt);

    // A little extra field of view at speed.
    const fov = 62 + Math.min(18, sim.speed * 0.3);
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov += (fov - cam.fov) * lerpRate(3, dt);
      cam.updateProjectionMatrix();
    }
  }
}
