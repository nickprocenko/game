import * as THREE from 'three';

// Builds a low-poly dolphin facing -Z with +Y up, about 3 units long.
// Returns the root group plus the tail pivot for the swim animation.

const BACK = new THREE.Color(0x4f6f86);
const BELLY = new THREE.Color(0xe4eef2);
const LENGTH = 3;

// Body radius along its length, u = 0 at the tail, 1 at the beak tip.
function bodyRadius(u) {
  if (u < 0.6) return 0.07 + 0.35 * Math.sin((u / 0.6) * Math.PI * 0.5) ** 1.4;
  if (u < 0.86) return 0.42 - ((u - 0.6) / 0.26) * 0.17; // head
  if (u < 0.9) return 0.25 - ((u - 0.86) / 0.04) * 0.15; // forehead into beak
  return Math.max(0, 0.1 * (1 - (u - 0.9) / 0.1) ** 0.6); // beak
}

function finGeometry(points, thickness) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (const [x, y] of points.slice(1)) shape.lineTo(x, y);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geo.translate(0, 0, -thickness / 2);
  return geo;
}

export function createDolphin() {
  const root = new THREE.Group();

  // Body: a lathe around the long axis, then turned so the beak points -Z.
  const profile = [];
  const segments = 28;
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    profile.push(new THREE.Vector2(bodyRadius(u), u * LENGTH - LENGTH / 2));
  }
  const bodyGeo = new THREE.LatheGeometry(profile, 18);
  bodyGeo.rotateX(-Math.PI / 2);
  bodyGeo.scale(0.85, 1, 1); // slightly taller than wide

  // Countershading: dark back, pale belly.
  const pos = bodyGeo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getY(i)) || 1;
    const t = THREE.MathUtils.smoothstep(pos.getY(i) / r, -0.45, 0.15);
    c.copy(BELLY).lerp(BACK, t);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  bodyGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  bodyGeo.computeVertexNormals();

  const skin = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.05 });
  const finMat = new THREE.MeshStandardMaterial({ color: BACK, roughness: 0.4 });
  root.add(new THREE.Mesh(bodyGeo, skin));

  // Dorsal fin, swept back.
  const dorsal = new THREE.Mesh(
    finGeometry([[-0.35, 0], [0.35, 0], [0.55, 0.55], [0.15, 0.2]], 0.06),
    finMat,
  );
  dorsal.rotation.y = -Math.PI / 2; // shape +x becomes +z, so the tip sweeps toward the tail
  dorsal.position.set(0, 0.3, 0.05);
  root.add(dorsal);

  // Pectoral fins.
  const pecGeo = finGeometry([[0, -0.15], [0, 0.15], [0.6, -0.15], [0.55, -0.25]], 0.04);
  for (const side of [-1, 1]) {
    const pec = new THREE.Mesh(pecGeo, finMat);
    // Lay flat with the tip swept back, then angle it out and down.
    pec.rotation.set(-Math.PI / 2, 0, side > 0 ? -0.5 : Math.PI + 0.5, 'ZXY');
    pec.position.set(side * 0.28, -0.2, -0.45);
    root.add(pec);
  }

  // Tail flukes on a pivot that beats up and down.
  const tail = new THREE.Group();
  tail.position.set(0, 0, LENGTH / 2 - 0.05);
  const flukeGeo = finGeometry(
    [[0, -0.05], [0.55, 0.35], [0.7, 0.3], [0.25, -0.1], [0, -0.15], [-0.25, -0.1], [-0.7, 0.3], [-0.55, 0.35]],
    0.05,
  );
  const flukes = new THREE.Mesh(flukeGeo, finMat);
  flukes.rotation.x = Math.PI / 2; // lie flat
  flukes.position.z = 0.1;
  tail.add(flukes);
  root.add(tail);

  // Eyes.
  const eyeGeo = new THREE.SphereGeometry(0.035, 8, 6);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(side * 0.22, 0.04, -0.98);
    root.add(eye);
  }

  return { root, tail };
}

// Beat the tail faster when swimming hard; hold it still in the air.
export function animateTail(tail, time, effort, airborne) {
  const amp = airborne ? 0.05 : 0.25 + effort * 0.25;
  const freq = airborne ? 2 : 4 + effort * 6;
  tail.rotation.x = Math.sin(time * freq) * amp;
}
