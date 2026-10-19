import * as THREE from 'three';
import { SEABED_Y, SURFACE_Y } from './physics.js';
import { realAltitude, EARTH_RADIUS } from './altitude.js';

const SUN_DIR = new THREE.Vector3(0.45, 0.75, -0.35).normalize();
const MOON_DIR = new THREE.Vector3(-0.3, 0.8, -0.52).normalize();
const SPACE = new THREE.Color(0x01030a);
const SKY_RADIUS = 1500;
// Distance from the camera to the nearest point of the Earth sphere. The
// sphere is drawn scaled down toward the camera so it fits inside the sky
// dome while keeping its true angular size.
const EARTH_NEAR = 5;

const ABOVE = { fog: new THREE.Color(0xb9dcf0), density: 0.0011 };
const SHALLOW = new THREE.Color(0x1f8fb3);
const DEEP = new THREE.Color(0x03182c);

// Decorations repeat on this tile size around the camera so the ocean never ends.
const TILE = 320;

const WATER_VERT = /* glsl */ `
  uniform float uTime;
  varying vec3 vWorld;
  varying vec3 vNormal;

  // Sum of directional sine waves: returns height, writes the slope.
  float waves(vec2 p, out vec2 slope) {
    const int N = 4;
    vec2 dirs[N] = vec2[N](vec2(1.0, 0.2), vec2(-0.4, 1.0), vec2(0.7, -0.7), vec2(-0.9, -0.3));
    float freqs[N] = float[N](0.16, 0.23, 0.41, 0.67);
    float amps[N] = float[N](0.22, 0.14, 0.07, 0.04);
    float speeds[N] = float[N](1.1, 1.4, 2.0, 2.7);
    float h = 0.0;
    slope = vec2(0.0);
    for (int i = 0; i < N; i++) {
      vec2 d = normalize(dirs[i]);
      float phase = dot(d, p) * freqs[i] + uTime * speeds[i];
      h += amps[i] * sin(phase);
      slope += amps[i] * freqs[i] * d * cos(phase);
    }
    return h;
  }

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec2 slope;
    world.y += waves(world.xz, slope);
    vWorld = world.xyz;
    vNormal = normalize(vec3(-slope.x, 1.0, -slope.y));
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const WATER_FRAG = /* glsl */ `
  uniform vec3 uDeep;
  uniform vec3 uSky;
  uniform vec3 uUnder;
  uniform vec3 uSunDir;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uOpacity;
  varying vec3 vWorld;
  varying vec3 vNormal;

  void main() {
    vec3 n = normalize(vNormal);
    vec3 toEye = normalize(cameraPosition - vWorld);
    vec3 col;
    float alpha;
    if (gl_FrontFacing) {
      float fresnel = pow(1.0 - max(dot(n, toEye), 0.0), 4.0);
      col = mix(uDeep, uSky, 0.05 + fresnel * 0.6);
      vec3 h = normalize(toEye + uSunDir);
      col += vec3(1.0, 0.97, 0.9) * pow(max(dot(n, h), 0.0), 180.0) * 1.4;
      alpha = 0.9 + fresnel * 0.1;
    } else {
      // From below: a bright window straight up, silvery reflection at grazing angles.
      float up = max(dot(-n, toEye), 0.0);
      col = mix(uUnder * 1.6, vec3(0.75, 0.92, 1.0), smoothstep(0.55, 0.95, up));
      alpha = 0.92;
    }
    float d = length(cameraPosition - vWorld);
    float fog = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
    gl_FragColor = vec4(mix(col, uFogColor, fog), alpha * uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uHorizon;
  uniform vec3 uZenith;
  uniform vec3 uSpace;
  uniform float uSpaceMix;
  varying vec3 vDir;
  void main() {
    float h = clamp(vDir.y, 0.0, 1.0);
    vec3 col = mix(uHorizon, uZenith, pow(h, 0.5));
    // Climbing out of the atmosphere, the sky darkens from the top down.
    col = mix(col, uSpace, clamp(uSpaceMix * (1.0 + h * 1.5), 0.0, 1.0));
    float sun = max(dot(normalize(vDir), uSunDir), 0.0);
    col += vec3(1.0, 0.85, 0.6) * (pow(sun, 600.0) * 3.0 + pow(sun, 12.0) * 0.2);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const EARTH_VERT = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vObj;
  varying vec3 vWorld;
  void main() {
    vObj = position;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

// Ocean planet seen from above: value-noise clouds and a few islands, lit by
// the sun, with a blue atmosphere glow at the limb.
const EARTH_FRAG = /* glsl */ `
  uniform vec3 uSunDir;
  uniform float uTime;
  uniform float uClouds;
  varying vec3 vNormal;
  varying vec3 vObj;
  varying vec3 vWorld;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x),
                   mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
                   mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  // Many octaves, so the clouds still have structure when only a few degrees
  // of the planet fill the view at low altitude.
  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 9; i++) {
      v += a * noise(p);
      p *= 2.03;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 n = normalize(vNormal);
    vec3 p = normalize(vObj);
    float land = smoothstep(0.62, 0.66, fbm(p * 3.0 + 7.0));
    vec3 col = mix(vec3(0.02, 0.17, 0.32), vec3(0.32, 0.45, 0.24), land);
    // The point straight below you is always the sphere's pole, so this offset
    // picks a noise region with scattered clouds there rather than a flat haze.
    float cloud = smoothstep(0.5, 0.75, fbm(p * 5.0 + vec3(2.2 + uTime * 0.002, 22.6, 2.5)));
    col = mix(col, vec3(0.95), cloud * 0.85 * uClouds);
    float light = max(dot(n, uSunDir), 0.0);
    col *= 0.04 + 0.96 * light;
    vec3 toEye = normalize(cameraPosition - vWorld);
    float rim = pow(1.0 - max(dot(n, toEye), 0.0), 3.0);
    col += vec3(0.35, 0.6, 1.0) * rim * (0.15 + light);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function moonTexture() {
  const w = 256;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#b9b6ae';
  ctx.fillRect(0, 0, w, h);
  const rand = mulberry32(11);
  // Dark maria, then craters.
  for (let i = 0; i < 9; i++) {
    ctx.fillStyle = `rgba(80, 80, 82, ${0.25 + rand() * 0.25})`;
    ctx.beginPath();
    ctx.ellipse(rand() * w, 20 + rand() * (h - 40), 12 + rand() * 30, 8 + rand() * 18, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 90; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = 1 + rand() ** 3 * 9;
    ctx.fillStyle = 'rgba(60, 60, 60, 0.35)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(235, 235, 230, 0.4)';
    ctx.beginPath();
    ctx.arc(x - r * 0.15, y - r * 0.15, r, Math.PI * 0.9, Math.PI * 1.7);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function starField(count, radius) {
  const rand = mulberry32(5);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    // Uniform on the sphere.
    const z = rand() * 2 - 1;
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    v.set(r * Math.cos(a), z, r * Math.sin(a)).multiplyScalar(radius);
    pos.set([v.x, v.y, v.z], i * 3);
    const b = 0.35 + rand() ** 4 * 0.65;
    const warm = rand();
    col.set([b * (0.85 + warm * 0.15), b * 0.9, b * (1 - warm * 0.15)], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function sandTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Ripples plus grain; periodic in x and y so the texture tiles.
      const ripple = Math.sin((x / size) * Math.PI * 12 + Math.sin((y / size) * Math.PI * 4) * 1.5);
      const v = 0.78 + ripple * 0.07 + (Math.random() - 0.5) * 0.12;
      const i = (y * size + x) * 4;
      img.data[i] = 214 * v;
      img.data[i + 1] = 196 * v;
      img.data[i + 2] = 150 * v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Instanced props scattered over one tile and repeated around the camera.
class TiledProps {
  constructor(mesh, items) {
    this.mesh = mesh;
    this.items = items; // { x, z, y, rot, scale, sway? }
    this.surface = false; // floats on the surface, so stays visible from above
    this.matrix = new THREE.Matrix4();
    this.quat = new THREE.Quaternion();
    this.euler = new THREE.Euler();
    this.pos = new THREE.Vector3();
    this.scale = new THREE.Vector3();
    mesh.frustumCulled = false;
  }

  update(center, time) {
    this.items.forEach((it, i) => {
      const x = it.x + TILE * Math.round((center.x - it.x) / TILE);
      const z = it.z + TILE * Math.round((center.z - it.z) / TILE);
      const sway = it.sway ? Math.sin(time * 1.3 + it.x * 0.1) * it.sway : 0;
      const bob = it.bob ? Math.sin(time * 1.6 + it.z) * it.bob : 0;
      this.pos.set(x, it.y + bob, z);
      this.euler.set(sway, it.rot, sway * 0.6);
      this.quat.setFromEuler(this.euler);
      this.scale.setScalar(it.scale);
      if (it.stretch) this.scale.y *= it.stretch;
      this.matrix.compose(this.pos, this.quat, this.scale);
      this.mesh.setMatrixAt(i, this.matrix);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

function scatter(count, rand, make) {
  return Array.from({ length: count }, () => make(rand() * TILE, rand() * TILE));
}

// Small deterministic RNG so the ocean looks the same every run.
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.fogColor = new THREE.Color();
    this.space = 0;
    this.earthShown = false;
    scene.fog = new THREE.FogExp2(ABOVE.fog.getHex(), ABOVE.density);
    scene.background = ABOVE.fog.clone();

    // Lights
    scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x2a4a5a, 1.1));
    const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
    sun.position.copy(SUN_DIR).multiplyScalar(100);
    scene.add(sun);

    // Sky dome, follows the camera.
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(SKY_RADIUS, 32, 16),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        uniforms: {
          uSunDir: { value: SUN_DIR },
          uHorizon: { value: ABOVE.fog.clone() },
          uZenith: { value: new THREE.Color(0x2f74c4) },
          uSpace: { value: SPACE },
          uSpaceMix: { value: 0 },
        },
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    );
    this.sky.renderOrder = -1;
    scene.add(this.sky);

    // Water surface, follows the camera; waves are computed in world space.
    this.waterUniforms = {
      uTime: { value: 0 },
      uDeep: { value: new THREE.Color(0x0a4a6e) },
      uSky: { value: new THREE.Color(0x9cc9e4) },
      uUnder: { value: SHALLOW.clone() },
      uSunDir: { value: SUN_DIR },
      uFogColor: { value: new THREE.Color() },
      uFogDensity: { value: ABOVE.density },
      uOpacity: { value: 1 },
    };
    const waterGeo = new THREE.PlaneGeometry(1400, 1400, 220, 220);
    waterGeo.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(
      waterGeo,
      new THREE.ShaderMaterial({
        vertexShader: WATER_VERT,
        fragmentShader: WATER_FRAG,
        uniforms: this.waterUniforms,
        transparent: true,
        side: THREE.DoubleSide,
      }),
    );
    this.water.position.y = SURFACE_Y;
    this.water.renderOrder = 2;
    scene.add(this.water);

    // Seabed: a plane that follows the camera with its texture pinned to the world.
    this.sand = sandTexture();
    const bedSize = 900;
    this.bedRepeat = bedSize / 24;
    this.sand.repeat.set(this.bedRepeat, this.bedRepeat);
    const bedGeo = new THREE.PlaneGeometry(bedSize, bedSize);
    bedGeo.rotateX(-Math.PI / 2);
    this.bedSize = bedSize;
    this.seabed = new THREE.Mesh(bedGeo, new THREE.MeshLambertMaterial({ map: this.sand }));
    this.seabed.position.y = SEABED_Y;
    scene.add(this.seabed);

    this.buildProps();
    this.buildHorizon();
    this.buildSpace();
  }

  buildSpace() {
    // Opaque-pass additive points, so they draw after the sky and before the
    // Earth, which then covers the stars behind it.
    this.stars = new THREE.Points(
      starField(2500, SKY_RADIUS * 0.9),
      new THREE.PointsMaterial({
        size: 2, sizeAttenuation: false, vertexColors: true, blending: THREE.AdditiveBlending,
        depthWrite: false, depthTest: false, fog: false,
      }),
    );
    this.stars.renderOrder = -0.9;
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);

    this.earthUniforms = { uSunDir: { value: SUN_DIR }, uTime: { value: 0 }, uClouds: { value: 0 } };
    this.earth = new THREE.Mesh(
      new THREE.SphereGeometry(1, 96, 192),
      new THREE.ShaderMaterial({
        vertexShader: EARTH_VERT,
        fragmentShader: EARTH_FRAG,
        uniforms: this.earthUniforms,
        depthWrite: false,
        depthTest: false,
        fog: false,
      }),
    );
    this.earth.renderOrder = -0.5;
    this.earth.frustumCulled = false;
    this.scene.add(this.earth);

    // Mostly a crescent from the ocean, so earthshine keeps the dark side readable.
    const moonMap = moonTexture();
    this.moon = new THREE.Mesh(
      new THREE.SphereGeometry(1, 48, 24),
      new THREE.MeshLambertMaterial({ map: moonMap, emissive: 0x6a6c74, emissiveMap: moonMap, fog: false }),
    );
    this.moon.rotation.y = 2.2;
    this.scene.add(this.moon);
  }

  buildProps() {
    const rand = mulberry32(7);
    this.props = [];

    const rocks = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(1, 0),
      new THREE.MeshLambertMaterial({ color: 0x6b6f66, flatShading: true }),
      70,
    );
    this.props.push(new TiledProps(rocks, scatter(70, rand, (x, z) => ({
      x, z, y: SEABED_Y + 0.5, rot: rand() * 6, scale: 1.5 + rand() * 5, stretch: 0.5 + rand() * 0.4,
    }))));

    const kelpGeo = new THREE.ConeGeometry(0.5, 1, 5, 1);
    kelpGeo.translate(0, 0.5, 0);
    const kelp = new THREE.InstancedMesh(
      kelpGeo,
      new THREE.MeshLambertMaterial({ color: 0x3f7f3a, flatShading: true }),
      160,
    );
    this.props.push(new TiledProps(kelp, scatter(160, rand, (x, z) => ({
      x, z, y: SEABED_Y, rot: rand() * 6, scale: 1, stretch: 8 + rand() * 22, sway: 0.08,
    }))));

    const coral = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshLambertMaterial({ flatShading: true }),
      60,
    );
    const coralColors = [0xe0675a, 0xf2a65a, 0xb46ad6, 0xf2d15a];
    const coralItems = scatter(60, rand, (x, z) => ({
      x, z, y: SEABED_Y + 0.6, rot: rand() * 6, scale: 0.8 + rand() * 1.6,
    }));
    coralItems.forEach((_, i) => coral.setColorAt(i, new THREE.Color(coralColors[i % coralColors.length])));
    this.props.push(new TiledProps(coral, coralItems));

    // Buoys give the surface a sense of speed and scale from above.
    const buoyGeo = new THREE.CylinderGeometry(0.5, 0.7, 1.6, 10);
    buoyGeo.translate(0, 0.4, 0);
    const buoys = new THREE.InstancedMesh(
      buoyGeo,
      new THREE.MeshLambertMaterial({ color: 0xe8513d }),
      14,
    );
    const buoyProps = new TiledProps(buoys, scatter(14, rand, (x, z) => ({
      x, z, y: SURFACE_Y - 0.2, rot: 0, scale: 1, bob: 0.25,
    })));
    buoyProps.surface = true;
    this.props.push(buoyProps);

    for (const p of this.props) this.scene.add(p.mesh);
  }

  buildHorizon() {
    // Distant islands that move with the camera, so they act as a compass.
    this.horizon = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: 0x5f8f6a, flatShading: true });
    const rand = mulberry32(3);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + rand() * 0.5;
      const island = new THREE.Mesh(new THREE.ConeGeometry(60 + rand() * 80, 30 + rand() * 60, 7), mat);
      island.position.set(Math.cos(a) * 1050, 5, Math.sin(a) * 1050);
      island.scale.z = 0.6 + rand() * 0.8;
      this.horizon.add(island);
    }
    this.scene.add(this.horizon);
  }

  update(camera, time) {
    const c = camera.position;
    this.waterUniforms.uTime.value = time;

    this.sky.position.copy(c);
    this.horizon.position.set(c.x, 0, c.z);
    this.updateSpace(c, time);

    const snap = 10;
    this.water.position.x = Math.round(c.x / snap) * snap;
    this.water.position.z = Math.round(c.z / snap) * snap;

    this.seabed.position.x = c.x;
    this.seabed.position.z = c.z;
    const tileWorld = this.bedSize / this.bedRepeat;
    this.sand.offset.set(c.x / tileWorld, -c.z / tileWorld);

    for (const p of this.props) p.update(c, time);

    // Underwater the fog thickens and darkens with depth.
    const under = c.y < SURFACE_Y;
    const fog = this.scene.fog;
    if (under) {
      const t = Math.min(1, (SURFACE_Y - c.y) / (SURFACE_Y - SEABED_Y));
      this.fogColor.copy(SHALLOW).lerp(DEEP, t * 0.8);
      fog.density = 0.02 + t * 0.008;
    } else {
      // The haze thins out as you climb, so the ocean stays visible below.
      this.fogColor.copy(ABOVE.fog).lerp(SPACE, this.space);
      fog.density = ABOVE.density * (1 - THREE.MathUtils.smoothstep(c.y, 20, 160));
    }
    fog.color.copy(this.fogColor);
    this.scene.background.copy(this.fogColor);
    this.sky.visible = !under;
    this.stars.visible = !under && this.space > 0.01;
    this.moon.visible = !under;
    this.earth.visible = !under && this.earthShown;
    this.horizon.visible = !under && c.y < 150;
    // The seabed is far too deep to see from above the surface.
    this.seabed.visible = under;
    for (const p of this.props) p.mesh.visible = under || (p.surface && c.y < 150);
    // High up, the flat sea hands over to the curved Earth below.
    const waterFade = 1 - THREE.MathUtils.smoothstep(c.y, 90, 220);
    this.water.visible = waterFade > 0;
    this.waterUniforms.uOpacity.value = under ? 1 : waterFade;
    this.waterUniforms.uFogColor.value.copy(this.fogColor);
    this.waterUniforms.uFogDensity.value = fog.density;
    return under;
  }

  // Altitude-driven sky: space colour, stars, Moon and the Earth below.
  updateSpace(c, time) {
    const real = realAltitude(Math.max(0, c.y - SURFACE_Y));
    // 0 at 3 km, 1 at the Kármán line (100 km), on a log scale.
    const log = Math.log10(Math.max(1, real));
    this.space = THREE.MathUtils.smoothstep(log, 3.5, 5);
    this.sky.material.uniforms.uSpaceMix.value = this.space;
    this.stars.position.copy(c);
    this.stars.material.color.setScalar(this.space);

    // The Moon sits at a fixed direction, as if infinitely far, and looms a
    // little larger as you climb toward it.
    const loom = 1 + THREE.MathUtils.smoothstep(log, 5, 7.6) * 1.2;
    this.moon.position.copy(c).addScaledVector(MOON_DIR, SKY_RADIUS * 0.8);
    this.moon.scale.setScalar(38 * loom);

    // The Earth: a sphere whose radius makes the horizon curve as it would at
    // the real altitude, scaled toward the camera so it fits in view.
    const h = c.y - SURFACE_Y;
    // It takes over from the flat sea as that fades out.
    this.earthShown = h > 90;
    if (this.earthShown) {
      const radius = (h * EARTH_RADIUS) / real;
      const k = EARTH_NEAR / h;
      this.earth.position.set(c.x, c.y - (radius + h) * k, c.z);
      this.earth.scale.setScalar(radius * k);
      this.earthUniforms.uTime.value = time;
      // Clouds fade in from 20 km. Lower down the patch of planet in view is
      // too small for the noise to resolve, so it would read as flat haze.
      this.earthUniforms.uClouds.value = THREE.MathUtils.smoothstep(log, 4.3, 5);
    }
  }
}
