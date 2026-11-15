// Shared shooting: one raycaster, one registry of characters, one damage
// rule. A shot is a ray from a muzzle against the world and every
// character's hit meshes; the first hit decides. Head shots multiply the
// weapon's damage. Smoke clouds block sight and shots alike: a ray that
// crosses a live smoke sphere stops there. Grenades ask damageRadius
// instead. The module never touches the HUD or the round state; it reports
// what happened and main.js reacts.
import * as THREE from 'three';

// Scratch objects: the hot loops reuse these, so shooting never allocates.
const _dir = new THREE.Vector3();
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();

export function createCombat(scene, worldShootables, smokeBlocks) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 120;
  const characters = [];

  function register(character) {
    // character: { id, team, alive, health, maxHealth, hitMeshes, onDamage, onDeath }
    // Each hit mesh carries userData { character, part } ('head' | 'torso').
    characters.push(character);
    return character;
  }

  function shootables() {
    const list = worldShootables.slice();
    for (const character of characters) {
      if (character.alive) list.push(...character.hitMeshes);
    }
    return list;
  }

  function blockedBySmoke(origin, point) {
    if (!smokeBlocks) return false;
    return smokeBlocks(origin, point);
  }

  // Fires one hitscan round. Returns { hit, killed, victim, part, point, damage }.
  function shoot(shooter, origin, direction, spread, def, random) {
    _dir.copy(direction);
    _dir.x += (random() * 2 - 1) * spread;
    _dir.y += (random() * 2 - 1) * spread;
    _dir.z += (random() * 2 - 1) * spread;
    _dir.normalize();
    scene.updateMatrixWorld(true);
    raycaster.set(origin, _dir);
    raycaster.far = def.range;
    const hit = raycaster.intersectObjects(shootables(), false)[0];
    raycaster.far = 120;
    if (!hit) return { hit: false, point: origin.clone().addScaledVector(_dir, 60) };
    if (blockedBySmoke(origin, hit.point)) {
      return { hit: false, point: hit.point.clone(), smoked: true };
    }
    const character = hit.object.userData.character;
    if (!character || !character.alive || character === shooter) {
      return { hit: false, point: hit.point.clone(), blocked: true };
    }
    const part = hit.object.userData.part || 'torso';
    const damage = def.damage * (part === 'head' ? def.headMult : 1);
    character.health -= damage;
    if (character.onDamage) character.onDamage(damage, shooter);
    let killed = false;
    if (character.health <= 0) {
      character.health = 0;
      character.alive = false;
      killed = true;
      if (character.onDeath) character.onDeath(shooter);
    }
    return { hit: true, killed, victim: character, part, point: hit.point.clone(), damage };
  }

  // Line of sight between two points, ignoring characters: true when no
  // world surface and no smoke stands between them.
  function canSee(from, to) {
    _from.copy(from);
    _to.copy(to);
    const direction = _to.sub(_from);
    const distance = direction.length();
    if (distance < 0.01) return true;
    direction.normalize();
    scene.updateMatrixWorld(true);
    raycaster.set(_from, direction);
    raycaster.far = distance;
    const hit = raycaster.intersectObjects(worldShootables, false)[0];
    raycaster.far = 120;
    if (hit) return false;
    return !blockedBySmoke(from, to);
  }

  // Blast damage: everyone within the radius takes falloff damage, except
  // the thrower's own team takes half (a careless throw still stings).
  function damageRadius(center, radius, maxDamage, thrower) {
    const results = [];
    for (const character of characters) {
      if (!character.alive) continue;
      const distance = character.position.distanceTo(center);
      if (distance > radius) continue;
      const falloff = 1 - (distance / radius) * 0.7;
      let damage = maxDamage * falloff;
      if (thrower && character.team === thrower.team) damage *= 0.5;
      character.health -= damage;
      if (character.onDamage) character.onDamage(damage, thrower);
      let killed = false;
      if (character.health <= 0) {
        character.health = 0;
        character.alive = false;
        killed = true;
        if (character.onDeath) character.onDeath(thrower);
      }
      results.push({ victim: character, damage, killed });
    }
    return results;
  }

  return { register, shoot, canSee, damageRadius, characters };
}
