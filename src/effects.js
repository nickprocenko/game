import * as THREE from 'three';
import { GRAVITY, SURFACE_Y } from './physics.js';

const PARTICLE_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  uniform float uScale;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vAlpha = aAlpha;
    gl_PointSize = aSize * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const PARTICLE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform bool uRing;
  varying float vAlpha;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r = dot(p, p);
    if (r > 1.0) discard;
    // Bubbles get a bright rim; spray is a soft dot.
    float a = uRing ? smoothstep(0.35, 0.9, r) * 0.9 + 0.1 : 1.0 - r;
    gl_FragColor = vec4(uColor, a * vAlpha);
    #include <colorspace_fragment>
  }
`;

// Fixed-size pool of point particles with simple per-kind motion.
class ParticlePool {
  constructor(scene, count, { color, ring = false, gravity = 0, buoyancy = 0, killAtSurface = false }) {
    this.count = count;
    this.gravity = gravity;
    this.buoyancy = buoyancy;
    this.killAtSurface = killAtSurface;
    this.next = 0;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count).fill(1);
    this.size = new Float32Array(count);
    this.alpha = new Float32Array(count);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    this.geo = geo;
    this.material = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uRing: { value: ring },
        uScale: { value: 400 },
      },
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, life, size) {
    const i = this.next;
    this.next = (this.next + 1) % this.count;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
  }

  update(dt, time) {
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const j = i * 3;
      this.vel[j + 1] += (this.buoyancy - this.gravity) * dt;
      if (this.buoyancy) {
        // Bubbles wobble and slow down as they rise.
        this.vel[j] = this.vel[j] * (1 - dt) + Math.sin(time * 6 + i) * 0.6 * dt;
        this.vel[j + 2] = this.vel[j + 2] * (1 - dt) + Math.cos(time * 5 + i) * 0.6 * dt;
        this.vel[j + 1] = Math.min(this.vel[j + 1], 3);
      }
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      if (this.killAtSurface ? this.pos[j + 1] > SURFACE_Y - 0.1 : this.pos[j + 1] < SURFACE_Y - 0.5) {
        this.life[i] = 0;
      }
      this.alpha[i] = Math.max(0, Math.min(1, this.life[i] / this.maxLife[i]) * 1.5);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
  }
}

// Expanding foam rings where the dolphin breaks the surface.
class FoamRings {
  constructor(scene, count) {
    const geo = new THREE.RingGeometry(0.75, 1, 40);
    geo.rotateX(-Math.PI / 2);
    this.rings = Array.from({ length: count }, () => {
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      }));
      mesh.visible = false;
      mesh.renderOrder = 3;
      scene.add(mesh);
      return { mesh, age: 0, life: 0, growth: 0 };
    });
    this.next = 0;
  }

  emit(x, z, strength) {
    const r = this.rings[this.next];
    this.next = (this.next + 1) % this.rings.length;
    r.mesh.position.set(x, SURFACE_Y + 0.3, z);
    r.age = 0;
    r.life = 1.4 + strength * 0.8;
    r.growth = 4 + strength * 8;
    r.mesh.visible = true;
  }

  update(dt) {
    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.age += dt;
      const t = r.age / r.life;
      if (t >= 1) {
        r.mesh.visible = false;
        continue;
      }
      r.mesh.scale.setScalar(1 + r.growth * Math.sqrt(t));
      r.mesh.material.opacity = 0.5 * (1 - t);
    }
  }
}

export class Effects {
  constructor(scene) {
    this.spray = new ParticlePool(scene, 900, { color: 0xffffff, gravity: GRAVITY });
    this.bubbles = new ParticlePool(scene, 500, { color: 0xd8f4ff, ring: true, buoyancy: 6, killAtSurface: true });
    this.rings = new FoamRings(scene, 6);
    this.bubbleTimer = 0;
  }

  setViewportHeight(px) {
    // Keep particle sizes consistent across screen sizes.
    this.spray.material.uniforms.uScale.value = px * 0.6;
    this.bubbles.material.uniforms.uScale.value = px * 0.6;
  }

  // strength 0..1 scales the amount and height of the spray.
  splash(position, velocity, strength) {
    const n = Math.round(40 + strength * 220);
    const up = 3 + strength * 14;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const spread = Math.random() * (2 + strength * 6);
      this.spray.emit(
        position.x + Math.cos(a) * 0.6, SURFACE_Y + 0.1, position.z + Math.sin(a) * 0.6,
        Math.cos(a) * spread + velocity.x * 0.15,
        up * (0.4 + Math.random() * 0.8),
        Math.sin(a) * spread + velocity.z * 0.15,
        0.8 + Math.random() * 0.8,
        0.25 + Math.random() * 0.35,
      );
    }
    this.rings.emit(position.x, position.z, strength);
    // A burst of bubbles below the entry point.
    for (let i = 0; i < 20 + strength * 60; i++) {
      this.bubbles.emit(
        position.x + (Math.random() - 0.5) * 2, SURFACE_Y - 0.5 - Math.random() * 3, position.z + (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 3, Math.random(), (Math.random() - 0.5) * 3,
        1 + Math.random(), 0.15 + Math.random() * 0.25,
      );
    }
  }

  // Bubble trail from the tail while swimming.
  trail(tailPos, effort, dt) {
    this.bubbleTimer += dt * (4 + effort * 40);
    while (this.bubbleTimer > 1) {
      this.bubbleTimer -= 1;
      this.bubbles.emit(
        tailPos.x + (Math.random() - 0.5) * 0.4, tailPos.y + (Math.random() - 0.5) * 0.4, tailPos.z + (Math.random() - 0.5) * 0.4,
        (Math.random() - 0.5), 0.5, (Math.random() - 0.5),
        1.5 + Math.random() * 1.5, 0.1 + Math.random() * 0.15,
      );
    }
  }

  // Water dripping off the dolphin just after it leaves the surface.
  drip(position, velocity) {
    this.spray.emit(
      position.x + (Math.random() - 0.5) * 0.6, position.y, position.z + (Math.random() - 0.5) * 0.6,
      velocity.x * 0.6, velocity.y * 0.6, velocity.z * 0.6,
      0.6 + Math.random() * 0.4, 0.12 + Math.random() * 0.12,
    );
  }

  update(dt, time) {
    this.spray.update(dt, time);
    this.bubbles.update(dt, time);
    this.rings.update(dt);
  }
}
