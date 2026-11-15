// Visual effects: tracers, muzzle flashes, impact sparks, smoke clouds and
// the bomb explosion. Everything is pooled — a fixed set of meshes is
// reused, so effects never allocate in the frame loop. Smoke clouds are
// real spheres in the world: combat asks smokeBlocks() whether a shot's
// segment crosses one, so smoke genuinely blocks sight and fire.
import * as THREE from 'three';

const TRACER_MAX = 24;
const SPARK_MAX = 40;
const SMOKE_MAX = 6;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3(); // closest point on the segment, reused — no allocation per smoke test

export function createEffects(scene) {
  // Tracers: thin cylinders stretched between two points, faded fast.
  const tracers = [];
  const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9 });
  for (let i = 0; i < TRACER_MAX; i += 1) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1, 5), tracerMat.clone());
    mesh.visible = false;
    scene.add(mesh);
    tracers.push({ mesh, life: 0 });
  }
  let tracerNext = 0;

  // Impact sparks: small points that fly out and fade.
  const sparks = [];
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARK_MAX * 3), 3));
  const sparkMat = new THREE.PointsMaterial({ color: 0xffc46b, size: 0.14, transparent: true, opacity: 1 });
  const sparkPoints = new THREE.Points(sparkGeo, sparkMat);
  sparkPoints.frustumCulled = false;
  scene.add(sparkPoints);
  for (let i = 0; i < SPARK_MAX; i += 1) {
    sparks.push({ x: 0, y: -99, z: 0, vx: 0, vy: 0, vz: 0, life: 0 });
  }

  // Muzzle flash: one sprite, repositioned per shot, gone in 60 ms.
  const flashMat = new THREE.SpriteMaterial({ color: 0xffc46b, transparent: true, opacity: 0 });
  const flash = new THREE.Sprite(flashMat);
  flash.scale.set(0.9, 0.9, 1);
  scene.add(flash);
  let flashLife = 0;

  // Smoke clouds: translucent spheres that grow and fade over their life.
  const smokes = [];
  for (let i = 0; i < SMOKE_MAX; i += 1) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 14, 10),
      new THREE.MeshStandardMaterial({ color: 0x9aa7b1, transparent: true, opacity: 0, roughness: 1 }),
    );
    mesh.visible = false;
    scene.add(mesh);
    smokes.push({ mesh, life: 0, maxLife: 8, radius: 5, active: false });
  }

  // Explosion flash: one big sphere, gone in a blink.
  const blast = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0 }),
  );
  blast.visible = false;
  scene.add(blast);
  let blastLife = 0;

  function tracer(from, to) {
    const t = tracers[tracerNext];
    tracerNext = (tracerNext + 1) % TRACER_MAX;
    _a.copy(from);
    _b.copy(to);
    const len = _a.distanceTo(_b);
    t.mesh.position.copy(_a).add(_b).multiplyScalar(0.5);
    t.mesh.scale.set(1, len, 1);
    t.mesh.lookAt(_b);
    t.mesh.rotateX(Math.PI / 2);
    t.mesh.visible = true;
    t.mesh.material.opacity = 0.9;
    t.life = 0.09;
  }

  function sparkBurst(point, count) {
    let made = 0;
    for (const s of sparks) {
      if (s.life > 0) continue;
      s.x = point.x; s.y = point.y; s.z = point.z;
      s.vx = (Math.random() - 0.5) * 6;
      s.vy = Math.random() * 4;
      s.vz = (Math.random() - 0.5) * 6;
      s.life = 0.35 + Math.random() * 0.2;
      made += 1;
      if (made >= count) break;
    }
  }

  function muzzleFlash(position, direction) {
    flash.position.copy(position).addScaledVector(direction, 0.7);
    flash.material.opacity = 0.95;
    flashLife = 0.06;
  }

  function smokeCloud(position, radius, durationSeconds) {
    const free = smokes.find((s) => !s.active) || smokes[0];
    free.active = true;
    free.life = durationSeconds;
    free.maxLife = durationSeconds;
    free.radius = radius;
    free.mesh.position.copy(position);
    free.mesh.visible = true;
    free.mesh.scale.setScalar(0.3);
    free.mesh.material.opacity = 0.85;
  }

  function explosion(position) {
    blast.position.copy(position);
    blast.visible = true;
    blast.scale.setScalar(0.5);
    blast.material.opacity = 0.95;
    blastLife = 0.5;
    sparkBurst(position, 24);
  }

  // Segment-sphere test: does the segment origin→point cross a live cloud?
  function smokeBlocks(origin, point) {
    _a.copy(point).sub(origin);
    const segLen = _a.length();
    if (segLen < 0.001) return false;
    _a.divideScalar(segLen);
    for (const s of smokes) {
      if (!s.active) continue;
      _b.copy(s.mesh.position).sub(origin);
      const along = _b.dot(_a);
      if (along < 0 || along > segLen) continue;
      _c.copy(_a).multiplyScalar(along);
      if (_b.sub(_c).length() < s.radius * s.mesh.scale.x) return true;
    }
    return false;
  }

  function update(dt) {
    for (const t of tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      t.mesh.material.opacity = Math.max(0, t.life / 0.09) * 0.9;
      if (t.life <= 0) t.mesh.visible = false;
    }
    const pos = sparkGeo.attributes.position.array;
    for (let i = 0; i < SPARK_MAX; i += 1) {
      const s = sparks[i];
      if (s.life > 0) {
        s.life -= dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.z += s.vz * dt;
        s.vy -= 9 * dt;
      }
      pos[i * 3] = s.x;
      pos[i * 3 + 1] = s.y;
      pos[i * 3 + 2] = s.z;
    }
    sparkGeo.attributes.position.needsUpdate = true;
    sparkMat.opacity = 1;
    if (flashLife > 0) {
      flashLife -= dt;
      flash.material.opacity = Math.max(0, flashLife / 0.06) * 0.95;
      if (flashLife <= 0) flash.material.opacity = 0;
    }
    for (const s of smokes) {
      if (!s.active) continue;
      s.life -= dt;
      const age = s.maxLife - s.life;
      const grow = Math.min(1, age / 1.2);
      s.mesh.scale.setScalar(0.3 + grow * s.radius);
      s.mesh.material.opacity = Math.max(0, Math.min(0.85, s.life / 2)) * 0.85;
      if (s.life <= 0) {
        s.active = false;
        s.mesh.visible = false;
      }
    }
    if (blastLife > 0) {
      blastLife -= dt;
      blast.scale.setScalar(0.5 + (0.5 - blastLife) * 14);
      blast.material.opacity = Math.max(0, blastLife / 0.5) * 0.95;
      if (blastLife <= 0) blast.visible = false;
    }
  }

  return { tracer, sparkBurst, muzzleFlash, smokeCloud, explosion, smokeBlocks, update };
}
