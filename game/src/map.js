// Cinder Quay — the map. A 64 x 48 m night dockyard, north pier on the
// water, container rows in the middle, a south alley. Two bomb sites:
// A "Crane" on a raised platform west, B "Warehouse" inside a walled
// building east with a mezzanine. Verticality: climbable container stacks,
// a crane platform with ramp steps, warehouse stairs.
//
// Collision is a flat list of AABBs; the mover steps up anything 0.45 m or
// lower, so stairs and ramps are just thin stacked boxes. Waypoints + edges
// form the bot route graph (BFS in bots.js).
import * as THREE from 'three';
import { PALETTE as P } from './palette.js';

export const MAP = { x0: -32, x1: 32, z0: -24, z1: 24 };

export const SITES = {
  A: { name: 'Crane', x: -22, z: -13, y: 1.2 },
  B: { name: 'Warehouse', x: 22, z: -9, y: 0 },
};

export const SPAWNS = {
  attack: [
    { x: -6, z: 20, yaw: Math.PI },
    { x: 0, z: 21, yaw: Math.PI },
    { x: 6, z: 20, yaw: Math.PI },
  ],
  defend: [
    { x: -22, z: -18, yaw: 0 },
    { x: -12, z: -18, yaw: 0 },
    { x: 18, z: -14, yaw: 0 },
    { x: 25, z: -12, yaw: 0 },
  ],
};

// Waypoint nodes: {x, z, y} where y is the ground level at that point.
export const WAYPOINTS = [
  { x: -6, z: 20, y: 0 }, { x: 0, z: 21, y: 0 }, { x: 6, z: 20, y: 0 }, // 0-2 attack spawn
  { x: -22, z: -18, y: 0 }, { x: -12, z: -18, y: 0 }, { x: 18, z: -14, y: 0 }, { x: 25, z: -12, y: 0 }, // 3-6 defend spawn
  { x: -28, z: -20, y: 0 }, { x: -14, z: -20, y: 0 }, { x: 0, z: -20, y: 0 }, { x: 14, z: -20, y: 0 }, { x: 26, z: -20, y: 0 }, // 7-11 north pier
  { x: -24, z: -6, y: 0 }, { x: -12, z: -6, y: 0 }, { x: 0, z: -6, y: 0 }, { x: 12, z: -6, y: 0 }, { x: 24, z: -6, y: 0 }, // 12-16 mid north
  { x: -20, z: 4, y: 0 }, { x: -8, z: 4, y: 0 }, { x: 4, z: 4, y: 0 }, { x: 16, z: 4, y: 0 }, // 17-20 mid south
  { x: -24, z: 14, y: 0 }, { x: -12, z: 14, y: 0 }, { x: 0, z: 14, y: 0 }, { x: 12, z: 14, y: 0 }, { x: 24, z: 14, y: 0 }, // 21-25 south alley
  { x: -22, z: -13, y: 1.2 }, { x: -22, z: -8, y: 0 }, // 26 site A, 27 A approach
  { x: 22, z: -9, y: 0 }, { x: 22, z: -4, y: 0 }, // 28 site B, 29 B approach (south door)
  { x: 25, z: -8, y: 2.7 }, { x: 28, z: -2.2, y: 2.4 }, // 30 mezzanine, 31 stair top
  { x: -11, z: -0.5, y: 2.6 }, // 32 on top of a container (mid cover)
  { x: 28, z: 1.8, y: 0 }, // 33 stair base (south yard)
  { x: -17.8, z: 0.2, y: 0 }, // 34 container ramp base
];

export const EDGES = [
  [0, 21], [1, 23], [2, 25], [21, 22], [22, 23], [23, 24], [24, 25],
  [3, 7], [4, 8], [5, 10], [6, 10],
  [7, 8], [8, 9], [9, 10], [10, 11],
  [12, 13], [13, 14], [14, 15], [15, 16],
  [17, 18], [18, 19], [19, 20],
  [12, 17], [13, 18], [14, 19], [15, 20],
  [17, 21], [18, 22], [19, 24], [20, 25],
  [7, 12], [8, 13], [9, 14], [10, 15], [11, 16],
  [12, 27], [27, 26], [13, 27],
  [16, 29], [29, 28], [15, 29],
  [28, 29], [29, 33], [33, 31], [31, 30],
  [14, 34], [34, 32], [32, 13],
  [26, 3], [28, 6], [28, 5],
  [11, 6], [11, 16], [7, 3],
];

const _mats = {};
function mat(color) {
  if (!_mats[color]) _mats[color] = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.08 });
  return _mats[color];
}

export function buildMap(scene, random) {
  const solids = [];
  const group = new THREE.Group();
  scene.add(group);
  const addBox = (x0, x1, z0, z1, y0, y1, color, opts = {}) => {
    const w = x1 - x0, h = y1 - y0, d = z1 - z0;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), opts.material || mat(color));
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    mesh.receiveShadow = false;
    group.add(mesh);
    if (!opts.noSolid) solids.push({ x0, x1, z0, z1, y0, y1 });
    return mesh;
  };

  // Ground slab + edge walls.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(64, 48), new THREE.MeshStandardMaterial({ color: P.ground, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, 0);
  ground.receiveShadow = false;
  group.add(ground);
  // Painted ground lines: pier edge and lane stripes.
  const lineMat = new THREE.MeshBasicMaterial({ color: P.groundLine });
  for (const z of [-21, -6, 4, 14]) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(62, 0.25), lineMat);
    line.rotation.x = -Math.PI / 2;
    line.position.set(0, 0.02, z);
    group.add(line);
  }
  addBox(-32, 32, -24.6, -24, 0, 4, P.steelDark); // north wall (water side)
  addBox(-32, 32, 24, 24.6, 0, 4, P.steelDark);
  addBox(-32.6, -32, -24, 24, 0, 4, P.steelDark);
  addBox(32, 32.6, -24, 24, 0, 4, P.steelDark);

  // Water beyond the north wall + moon + stars.
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 26),
    new THREE.MeshStandardMaterial({ color: P.water, roughness: 0.25, metalness: 0.6 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -0.35, -37);
  group.add(water);
  const moon = new THREE.Mesh(new THREE.CircleGeometry(2.2, 24), new THREE.MeshBasicMaterial({ color: P.moon, fog: false }));
  moon.position.set(18, 26, -44);
  moon.lookAt(0, 0, 0);
  group.add(moon);
  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(240 * 3);
  for (let i = 0; i < 240; i += 1) {
    starPos[i * 3] = (random() - 0.5) * 120;
    starPos[i * 3 + 1] = 14 + random() * 34;
    starPos[i * 3 + 2] = -30 - random() * 30;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  group.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xbfd4e6, size: 0.35, fog: false })));

  // --- Site A: crane platform (west) ---
  addBox(-27, -17, -17, -9, 0, 1.2, P.concrete); // raised platform
  for (let i = 0; i < 3; i += 1) { // ramp steps up the south face
    addBox(-24, -20, -9 + i * 1.1, -7.9 + i * 1.1, 0, 0.4 * (i + 1), P.steel);
  }
  // Gantry crane: two legs + top beam + hanging hook block.
  addBox(-26.6, -25.8, -17.4, -16.6, 0, 9, P.crane);
  addBox(-17.4, -16.6, -17.4, -16.6, 0, 9, P.crane);
  addBox(-27, -16, -17.6, -16.4, 8, 9.2, P.crane);
  addBox(-23.4, -22.6, -15.4, -14.6, 5.4, 6.2, P.steelDark); // hook block
  // Container stack flanking the platform.
  addBox(-29, -23, -6, -3.6, 0, 2.6, P.containerA);
  addBox(-29, -23, -6, -3.6, 2.6, 5.2, P.containerB);

  // --- Site B: warehouse (east), walled, roofed, mezzanine inside ---
  // North wall, east wall, south wall with a ground door gap x 20..23 and a
  // mezzanine door (y 2.4..4.4) at x 26..30, west wall with door gap z -10..-7.
  addBox(14, 30, -16.6, -16, 0, 5, P.warehouseWall);
  addBox(30, 30.6, -16, -2, 0, 5, P.warehouseWall);
  addBox(14, 20, -2.6, -2, 0, 5, P.warehouseWall);
  addBox(23, 26, -2.6, -2, 0, 5, P.warehouseWall);
  addBox(26, 30, -2.6, -2, 0, 2.4, P.warehouseWall);
  addBox(26, 30, -2.6, -2, 4.4, 5, P.warehouseWall);
  addBox(13.4, 14, -16, -10, 0, 5, P.warehouseWall);
  addBox(13.4, 14, -7, -2, 0, 5, P.warehouseWall);
  addBox(14, 30, -16, -2, 5, 5.5, P.warehouseRoof); // roof slab
  // Mezzanine slab (top 2.7) reaching the south wall, so the outside stairs
  // land on it through the mezzanine door.
  addBox(20, 30, -12, -2.4, 2.4, 2.7, P.steel);
  // Outside stairs up the south face (6 steps, 0.4 m each, 0.675 m deep),
  // top step flush with the wall so the climb lands in the mezzanine door.
  for (let i = 0; i < 6; i += 1) {
    addBox(26.5, 29.5, 1.45 - (i + 1) * 0.675, 1.45 - i * 0.675, 0, 0.4 * (i + 1), P.steelDark);
  }
  // Warehouse interior crates.
  addBox(15.5, 17.5, -14.5, -12.5, 0, 1.2, P.wood);
  addBox(27, 29, -14.5, -12.5, 0, 1.2, P.containerC);

  // --- Mid container rows ---
  const cont = (x0, z0, color, stacked) => {
    addBox(x0, x0 + 6, z0, z0 + 2.4, 0, 2.6, color);
    if (stacked) addBox(x0, x0 + 6, z0, z0 + 2.4, 2.6, 5.2, color === P.containerA ? P.containerB : P.containerA);
  };
  cont(-14, -1, P.containerA, true);
  cont(-6, -1, P.containerB, false);
  cont(2, -1, P.containerC, true);
  cont(-10, 6, P.containerD, false);
  cont(4, 6, P.containerA, false);
  // Ramp onto the -14 container (west face), 6 steps of ~0.43 m.
  for (let i = 0; i < 6; i += 1) {
    addBox(-17 + i * 0.5, -16.5 + i * 0.5, -1, 1.4, 0, 0.43 * (i + 1), P.steelDark);
  }

  // --- South alley cover: container wall with two gaps ---
  addBox(-28, -18, 14, 16.4, 0, 2.6, P.containerB);
  addBox(-16, -10, 14, 16.4, 0, 2.6, P.containerD);
  addBox(-8, -2, 14, 16.4, 0, 2.6, P.containerA);
  // Low wall along the south edge.
  addBox(-28, 28, 22, 22.6, 0, 1.1, P.concrete);

  // --- Scattered crates ---
  const crate = (x, z, s, h, color) => addBox(x, x + s, z, z + s, 0, h, color);
  crate(-26, 4, 1.2, 1.2, P.wood);
  crate(-24, 7, 1.0, 1.0, P.wood);
  crate(18, 10, 1.2, 1.2, P.containerC);
  crate(24, 14, 1.0, 1.0, P.wood);
  crate(-8, -14, 1.2, 1.2, P.containerB);
  crate(6, -12, 1.0, 1.0, P.containerD);
  crate(10, 16, 1.2, 1.2, P.wood);
  crate(-16, 14, 1.0, 1.0, P.containerA);

  // --- Lamps: sodium posts with a few real point lights ---
  const lampPositions = [[-20, -6], [0, -6], [20, -6], [-12, 10], [8, 12]];
  const lampMeshes = [];
  for (const [lx, lz] of lampPositions) {
    addBox(lx - 0.15, lx + 0.15, lz - 0.15, lz + 0.15, 0, 4.2, P.steelDark);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 10, 8),
      new THREE.MeshBasicMaterial({ color: P.lampGlow }),
    );
    head.position.set(lx, 4.35, lz);
    group.add(head);
    lampMeshes.push(head);
  }
  const lamp = new THREE.PointLight(P.lampWarm, 900, 34, 1.6);
  lamp.position.set(-20, 4.2, -6);
  group.add(lamp);
  const lamp2 = new THREE.PointLight(P.lampWarm, 900, 34, 1.6);
  lamp2.position.set(0, 4.2, -6);
  group.add(lamp2);
  const lamp3 = new THREE.PointLight(P.lampWarm, 900, 34, 1.6);
  lamp3.position.set(20, 4.2, -6);
  group.add(lamp3);
  const lamp4 = new THREE.PointLight(P.lampWarm, 500, 26, 1.6);
  lamp4.position.set(-12, 4.2, 10);
  group.add(lamp4);

  // Site markers: glowing ring + letter post at each site.
  const markers = {};
  for (const key of ['A', 'B']) {
    const site = SITES[key];
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.6, 2.1, 32),
      new THREE.MeshBasicMaterial({ color: P.siteMark, transparent: true, opacity: 0.75, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.x, site.y + 0.05, site.z);
    group.add(ring);
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 2.2, 0.3),
      new THREE.MeshStandardMaterial({ color: P.siteMark, emissive: P.siteMark, emissiveIntensity: 0.7 }),
    );
    post.position.set(site.x + 2.4, site.y + 1.1, site.z);
    group.add(post);
    markers[key] = ring;
  }

  scene.add(new THREE.HemisphereLight(0x8fa8c0, 0x1a2027, 0.85));
  const moonLight = new THREE.DirectionalLight(0xbfd4e6, 1.1);
  moonLight.position.set(18, 26, -20);
  scene.add(moonLight);
  scene.fog = new THREE.FogExp2(P.fog, 0.011);

  function groundAt(x, z) {
    let top = 0;
    for (const s of solids) {
      if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1 && s.y1 > top && s.y1 <= 3.0) top = s.y1;
    }
    return top;
  }

  let t = 0;
  return {
    solids,
    groundAt,
    group,
    update(dt) {
      t += dt;
      // Site rings breathe; the water streaks drift.
      const pulse = 0.55 + 0.25 * Math.sin(t * 2.2);
      markers.A.material.opacity = pulse;
      markers.B.material.opacity = pulse;
      water.position.x = Math.sin(t * 0.05) * 2;
    },
  };
}
