// Bot AI: Vanguard squadmates and Warden defenders. Each bot is a state
// machine fed by waypoint routes (BFS over the map graph), vision (line of
// sight + field of view + range), and hearing (gunshots in the noise list).
// States: route | hold | engage | flank | retreat | plant | defuse |
// pickup. Bots strafe and fire in bursts, flank through side lanes, fall
// back when hurt, and play their bomb roles: the carrier plants, the
// nearest attacker picks the charge up, defenders converge to defuse.
import * as THREE from 'three';
import { createBody } from './mover.js';
import { WAYPOINTS, EDGES } from './map.js';
import { WEAPON_DEFS } from './weapons.js';

// Adjacency list for the waypoint graph, built once.
const ADJ = WAYPOINTS.map(() => []);
for (const [a, b] of EDGES) {
  ADJ[a].push(b);
  ADJ[b].push(a);
}

function nearestNode(x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < WAYPOINTS.length; i += 1) {
    const dx = WAYPOINTS[i].x - x;
    const dz = WAYPOINTS[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// Breadth-first route between waypoint nodes (returns node indices).
function findRoute(from, to) {
  if (from === to) return [to];
  const prev = new Array(WAYPOINTS.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  while (queue.length > 0) {
    const at = queue.shift();
    for (const next of ADJ[at]) {
      if (prev[next] !== -1) continue;
      prev[next] = at;
      if (next === to) {
        const path = [to];
        let at2 = to;
        while (at2 !== from) {
          at2 = prev[at2];
          path.unshift(at2);
        }
        return path;
      }
      queue.push(next);
    }
  }
  return [to];
}

const ALLY_NAMES = ['Ash', 'Rook'];
const FOE_NAMES = ['Slate', 'Frost', 'Gale', 'Onyx'];

export function createBots(world) {
  const { map, combat, random } = world;
  const bots = [];
  const scratch = new THREE.Vector3();
  const scratch2 = new THREE.Vector3();

  function makeCharacter(bot) {
    const group = new THREE.Group();
    const teamColor = bot.team === 'attack' ? 0xff8c1a : 0x58a6ff;
    const torso = new THREE.Mesh(
      new THREE.BoxGeometry(0.62, 0.85, 0.36),
      new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.85 }),
    );
    torso.position.y = 1.08;
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.34, 0.34),
      new THREE.MeshStandardMaterial({ color: 0xd8c9a8, roughness: 0.9 }),
    );
    head.position.y = 1.66;
    const legs = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.66, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x232a31, roughness: 0.95 }),
    );
    legs.position.y = 0.33;
    const gun = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 0.12, 0.85),
      new THREE.MeshStandardMaterial({ color: 0x14181c, roughness: 0.6, metalness: 0.4 }),
    );
    gun.position.set(0.26, 1.25, 0.4);
    group.add(torso, head, legs, gun);
    group.visible = true;
    torso.userData = { character: null, part: 'torso' };
    head.userData = { character: null, part: 'head' };
    return { group, torso, head, gun };
  }

  function spawnBot(name, team, spawn, weaponId, isCarrier) {
    const mover = createBody(map, { x: spawn.x, z: spawn.z, yaw: spawn.yaw });
    const bot = {
      id: `bot-${name}`,
      name,
      team,
      weaponId,
      weapon: WEAPON_DEFS[weaponId],
      spawn: { x: spawn.x, z: spawn.z, yaw: spawn.yaw },
      state: 'route',
      route: [],
      routeIndex: 0,
      holdUntil: 0,
      holdNode: -1,
      lastSeen: null, // { x, z, y, at } — last seen enemy position
      lastSeenAt: -99,
      target: null,
      burstLeft: 0,
      burstAt: 0,
      reactAt: 0,
      flankUntil: 0,
      isCarrier: !!isCarrier,
      dead: false,
      shotCooldown: 0,
      moveTarget: null,
      wanderSeed: random(),
    };
    const visuals = makeCharacter(bot);
    bot.group = visuals.group;
    bot.gunMesh = visuals.gun;
    const character = {
      id: bot.id,
      name,
      team,
      alive: true,
      health: 100,
      maxHealth: 100,
      position: mover.body.position,
      hitMeshes: [visuals.torso, visuals.head],
      onDamage: () => {},
      onDeath: (killer) => {
        bot.dead = true;
        bot.group.visible = false;
        bot.state = 'dead';
        if (world.onBotDeath) world.onBotDeath(bot, killer);
      },
    };
    visuals.torso.userData.character = character;
    visuals.head.userData.character = character;
    bot.character = character;
    bot.mover = mover;
    combat.register(character);
    world.scene.add(bot.group);
    bots.push(bot);
    return bot;
  }

  function spawnAll() {
    const defSpawns = world.spawns.defend;
    const attSpawns = world.spawns.attack;
    // Attackers: the player spawns at attSpawns[0] and carries the charge;
    // squadmates take the other two spawns and escort. No bot starts as the
    // carrier — a bot only becomes one by picking the charge up.
    spawnBot(ALLY_NAMES[0], 'attack', attSpawns[1], 'rifle', false);
    spawnBot(ALLY_NAMES[1], 'attack', attSpawns[2], 'smg', false);
    for (let i = 0; i < 4; i += 1) {
      spawnBot(FOE_NAMES[i], 'defend', defSpawns[i], i % 2 === 0 ? 'rifle' : 'smg', false);
    }
  }

  function setRoute(bot, goalNode) {
    const from = nearestNode(bot.mover.body.position.x, bot.mover.body.position.z);
    bot.route = findRoute(from, goalNode);
    bot.routeIndex = 0;
    bot.state = 'route';
  }

  function nearestAllyTo(point) {
    let best = null;
    let bestD = Infinity;
    for (const b of bots) {
      if (b.team !== 'attack' || b.dead) continue;
      const d = b.mover.body.position.distanceToSquared(point);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  function visibleEnemy(bot, others) {
    const eye = scratch.copy(bot.mover.body.position);
    eye.y += 1.55;
    let best = null;
    let bestD = Infinity;
    for (const other of others) {
      if (!other.alive || other.team === bot.team) continue;
      const op = other.position;
      const dx = op.x - eye.x;
      const dy = (op.y + 1.3) - eye.y;
      const dz = op.z - eye.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const range = other.crouched ? 34 : 55;
      if (dist > range) continue;
      // Field of view: facing dot direction.
      const fx = -Math.sin(bot.mover.body.yaw);
      const fz = -Math.cos(bot.mover.body.yaw);
      if ((dx * fx + dz * fz) / dist < 0.1) continue;
      scratch2.set(op.x, op.y + 1.3, op.z);
      if (!combat.canSee(eye, scratch2)) continue;
      if (dist < bestD) {
        bestD = dist;
        best = other;
      }
    }
    return best ? { enemy: best, dist: bestD } : null;
  }

  function hearNoise(bot, now) {
    // A gunshot inside 28 m draws the bot toward the noise.
    for (const noise of world.noises) {
      if (now - noise.at > 2) continue;
      const d = bot.mover.body.position.distanceToSquared(noise.position);
      if (d < 28 * 28) return noise.position;
    }
    return null;
  }

  function tick(dt, now, others) {
    for (const bot of bots) {
      if (bot.dead) continue;
      const body = bot.mover.body;
      const phase = world.phase();
      const live = phase === 'live';

      // --- Perceive: only once the round is live. During freeze (and
      // roundEnd) bots walk to their positions and scan, but nobody shoots
      // before the horn — a fight during freeze would end the round before
      // it starts, and would pay kill money for a round that never began.
      const seen = live ? visibleEnemy(bot, others) : null;
      if (seen) {
        bot.target = seen.enemy;
        bot.lastSeen = { x: seen.enemy.position.x, y: seen.enemy.position.y, z: seen.enemy.position.z, at: now };
        bot.lastSeenAt = now;
        if (bot.state !== 'engage' && bot.state !== 'retreat') {
          if (bot.reactAt === 0) bot.reactAt = now + 0.4 + random() * 0.45;
          if (now >= bot.reactAt && (bot.state === 'route' || bot.state === 'hold' || bot.state === 'flank')) {
            bot.state = 'engage';
            bot.burstLeft = 3 + Math.floor(random() * 3);
            bot.burstAt = now;
          }
        } else if (bot.state === 'engage') {
          bot.lastSeenAt = now;
        }
      } else if (bot.target && now - bot.lastSeenAt > 2.5) {
        bot.target = null;
        bot.reactAt = 0;
        if (bot.state === 'engage') bot.state = 'route';
      }
      if (!live && (bot.state === 'engage' || bot.state === 'flank')) {
        // A round that is not live cannot be fought in.
        bot.state = 'route';
        bot.target = null;
      }

      // --- Hurt? Fall back. ---
      if (bot.character.health < 30 && bot.state !== 'retreat' && bot.state !== 'engage') {
        bot.state = 'retreat';
        bot.holdUntil = now + 4 + random() * 2;
        setRoute(bot, nearestNode(body.position.x + (random() - 0.5) * 10, body.position.z + (random() - 0.5) * 10));
      }
      if (bot.state === 'retreat' && now > bot.holdUntil) bot.state = 'route';

      // --- Bomb roles override movement goals ---
      const bomb = world.bombState();
      if (phase === 'live') {
        if (bot.team === 'attack' && bomb.mode === 'dropped' && bot.state !== 'engage') {
          const nearest = nearestAllyTo(bomb.position);
          if (nearest === bot) {
            bot.state = 'pickup';
            setRoute(bot, nearestNode(bomb.position.x, bomb.position.z));
          }
        }
        if (bot.team === 'defend' && bomb.mode === 'planted' && bot.state !== 'engage') {
          const site = world.sites[bomb.site];
          setRoute(bot, nearestNode(site.x, site.z));
          bot.state = 'route';
        }
        if (bot.team === 'attack' && bot.isCarrier && bomb.mode === 'carried' && bot.state !== 'engage' && bot.state !== 'plant') {
          const site = world.sites[world.attackSite()];
          if (Math.hypot(site.x - body.position.x, site.z - body.position.z) < 2.2) {
            bot.state = 'plant';
          } else if (bot.state === 'route' && (bot.route.length === 0 || bot.routeIndex >= bot.route.length)) {
            setRoute(bot, nearestNode(site.x, site.z));
          }
        }
      }

      // --- Plant / defuse channels ---
      if (bot.state === 'plant') {
        const site = world.sites[world.attackSite()];
        const near = Math.hypot(site.x - body.position.x, site.z - body.position.z) < 2.2;
        // plantStep flips the mode to 'planting' on its first call; the
        // channel must keep running in that mode, not only in 'carried'.
        if (near && (bomb.mode === 'carried' || bomb.mode === 'planting')) {
          world.bombPlantStep(dt, bot, world.attackSite());
        } else {
          bot.state = 'route';
        }
      }
      if (bot.state === 'defuse') {
        if (bomb.mode === 'planted' || bomb.mode === 'defusing') {
          world.bombDefuseStep(dt, bot);
        } else {
          bot.state = 'route';
        }
      }
      if (bot.team === 'defend' && (bomb.mode === 'planted' || bomb.mode === 'defusing') && bot.state === 'route') {
        const site = world.sites[bomb.site];
        if (Math.hypot(site.x - body.position.x, site.z - body.position.z) < 1.8) bot.state = 'defuse';
      }
      if (bot.state === 'pickup' && bomb.mode === 'dropped') {
        if (bot.mover.body.position.distanceTo(bomb.position) < 1.4) {
          world.bombPickUp(bot);
          bot.state = 'route';
        }
      }

      // --- Flank: while engaging, a bot sometimes circles through a side lane ---
      if (bot.state === 'engage' && bot.target && now > bot.flankUntil && random() < dt * 0.25) {
        bot.flankUntil = now + 6 + random() * 4;
        const side = bot.lastSeen ? nearestNode(bot.lastSeen.x + (random() < 0.5 ? -8 : 8), bot.lastSeen.z) : -1;
        if (side >= 0) {
          setRoute(bot, side);
          bot.state = 'flank';
        }
      }
      if (bot.state === 'flank') {
        if (!bot.target || now - bot.lastSeenAt > 3) bot.state = 'route';
      }

      // --- Movement ---
      let forward = 0;
      let strafe = 0;
      let moving = false;
      if (bot.state === 'engage' && bot.target) {
        // Face the enemy, strafe, fire in bursts.
        const t = bot.target.position;
        const dx = t.x - body.position.x;
        const dz = t.z - body.position.z;
        body.yaw = Math.atan2(-dx, -dz);
        strafe = Math.sin(now * 1.4 + bot.wanderSeed * 9) > 0 ? 0.7 : -0.7;
        moving = true;
        if (now >= bot.burstAt && bot.burstLeft > 0) {
          bot.shotCooldown -= dt;
          if (bot.shotCooldown <= 0) {
            bot.shotCooldown = 60 / bot.weapon.rpm;
            bot.burstLeft -= 1;
            if (bot.burstLeft <= 0) {
              bot.burstAt = now + 0.7 + random() * 0.6;
              bot.burstLeft = 3 + Math.floor(random() * 3);
            }
            world.botShoot(bot);
          }
        }
      } else if (bot.state === 'route' || bot.state === 'flank' || bot.state === 'pickup' || bot.state === 'retreat') {
        if (bot.routeIndex < bot.route.length) {
          const node = WAYPOINTS[bot.route[bot.routeIndex]];
          const dx = node.x - body.position.x;
          const dz = node.z - body.position.z;
          const dist = Math.hypot(dx, dz);
          if (dist < 0.7) {
            bot.routeIndex += 1;
          } else {
            body.yaw = Math.atan2(-dx, -dz);
            forward = 1;
            moving = true;
          }
        } else if (bot.state === 'route') {
          // Reached the end: hold and scan.
          bot.state = 'hold';
          bot.holdUntil = now + 2 + random() * 3;
        }
      } else if (bot.state === 'hold') {
        // Scan: slow yaw sweep while holding.
        body.yaw += Math.sin(now * 0.5 + bot.wanderSeed * 6) * dt * 0.8;
        if (now > bot.holdUntil) {
          // Roam to a fresh hold: defenders patrol near their site, attackers push.
          const goal = bot.team === 'defend'
            ? nearestNode(body.position.x + (random() - 0.5) * 18, body.position.z + (random() - 0.5) * 18)
            : nearestNode(body.position.x + (random() - 0.5) * 14, body.position.z - 6 - random() * 6);
          setRoute(bot, goal);
        }
      }

      // Hearing: a nearby shot pulls a routing/holding bot to investigate.
      if ((bot.state === 'route' || bot.state === 'hold') && !bot.target) {
        const noisePos = hearNoise(bot, now);
        if (noisePos) setRoute(bot, nearestNode(noisePos.x, noisePos.z));
      }

      bot.mover.step(dt, { forward, strafe, jump: false, sprint: false, crouch: false });

      // Keep the mesh on the body, facing the yaw.
      bot.group.position.copy(body.position);
      bot.group.rotation.y = body.yaw;
      // Walk bob for a living look.
      bot.group.position.y = body.position.y + (moving ? Math.abs(Math.sin(now * 9 + bot.wanderSeed * 8)) * 0.04 : 0);
    }
  }

  function resetForRound(attackSite) {
    for (const bot of bots) {
      bot.dead = false;
      bot.character.alive = true;
      bot.character.health = 100;
      bot.group.visible = true;
      bot.state = 'route';
      bot.route = [];
      bot.routeIndex = 0;
      bot.target = null;
      bot.lastSeen = null;
      bot.lastSeenAt = -99;
      bot.reactAt = 0;
      bot.burstLeft = 0;
      bot.isCarrier = false;
      // Back to the spawn point: a bot that died mid-yard does not start the
      // next round where it fell.
      bot.mover.body.position.set(bot.spawn.x, map.groundAt(bot.spawn.x, bot.spawn.z), bot.spawn.z);
      bot.mover.body.velocity.set(0, 0, 0);
      bot.mover.body.yaw = bot.spawn.yaw;
      // Defenders hold near their site; attackers push toward the site.
      const site = world.sites[attackSite];
      const goal = bot.team === 'defend'
        ? nearestNode(bot.spawn.x + (random() - 0.5) * 8, bot.spawn.z + (random() - 0.5) * 8)
        : nearestNode(site.x, site.z);
      setRoute(bot, goal);
    }
  }

  return { bots, spawnAll, tick, resetForRound, nearestNode, setRoute };
}
