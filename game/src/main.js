// Cinder Quay — game bootstrap and glue. Owns the renderer, the player,
// the arsenal, flying grenades, round orchestration, and the deterministic
// shot staging. The simulation runs on a fixed 60 Hz step, apart from
// rendering. One place holds the mutable match state: this file's `game`
// object — nothing else keeps a copy of it.
import * as THREE from 'three';
import { buildMap, SITES, SPAWNS } from './map.js';
import { makeRng } from './rng.js';
import { WEAPON_DEFS, GRENADE_DEFS, BUY_LIST, AMMO_PRICE, weaponState } from './weapons.js';
import { createCombat } from './combat.js';
import { createBody } from './mover.js';
import { createBomb, PLANT_SECONDS, DEFUSE_SECONDS, FUSE_SECONDS } from './bomb.js';
import { createRounds, FREEZE_SECONDS, ROUND_SECONDS } from './rounds.js';
import { createBots } from './bots.js';
import { createEffects } from './effects.js';
import { initAudio, sfx } from './audio.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';

const params = new URLSearchParams(window.location.search);
const seed = Number(params.get('seed')) || ((Date.now() % 100000) | 0);
const shotMode = params.get('shot') || null;
const random = makeRng(seed);

const container = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a1420);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 260);
camera.rotation.order = 'YXZ';

const mapApi = buildMap(scene, random);
const effects = createEffects(scene);
const combat = createCombat(scene, [], (a, b) => effects.smokeBlocks(a, b));
const hud = createHud();
const input = createInput(renderer.domElement);

// --- The one place match state lives ---
const game = {
  now: 0,
  started: false,
  paused: false,
  buyOpen: false,
  noises: [],
  grenades: [],
  lastSeenEnemies: [],
  recoil: 0,
  bloom: 0,
  fireTimer: 0,
  prevFiring: false,
  shotReady: false,
  shotTimer: 0,
  lobbyAngle: 0,
};

// --- Player ---
const playerBody = createBody(mapApi, { x: SPAWNS.attack[0].x, z: SPAWNS.attack[0].z, yaw: SPAWNS.attack[0].yaw });
const player = {
  id: 'player',
  name: 'You',
  team: 'attack',
  alive: true,
  health: 100,
  maxHealth: 100,
  crouched: false,
  position: playerBody.body.position,
  hitMeshes: [],
  onDamage: (amount) => {
    hud.damageFlash();
    sfx.hurt();
  },
  onDeath: (killer) => {
    player.alive = false;
    bomb.drop();
    hud.feed(`<b>${killer?.name ?? 'A Warden'}</b> ▸ <b>You</b>`, 'foe');
    hud.banner('YOU ARE DOWN', 'Your squad fights on — next round you return.');
    checkElimination();
  },
};
// Invisible-but-raycastable hit boxes for the player (opacity 0, colorWrite off).
const hitGroup = new THREE.Group();
const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
const torsoMesh = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.85, 0.36), hitMat);
torsoMesh.position.y = 1.08;
const headMesh = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), hitMat);
headMesh.position.y = 1.66;
hitGroup.add(torsoMesh, headMesh);
scene.add(hitGroup);
torsoMesh.userData = { character: player, part: 'torso' };
headMesh.userData = { character: player, part: 'head' };
player.hitMeshes = [torsoMesh, headMesh];
combat.register(player);

// Viewmodel: a simple gun carried in front of the camera.
const viewGun = new THREE.Group();
const gunBody = new THREE.Mesh(
  new THREE.BoxGeometry(0.11, 0.13, 0.55),
  new THREE.MeshStandardMaterial({ color: 0x1c2126, roughness: 0.5, metalness: 0.5 }),
);
const gunBarrel = new THREE.Mesh(
  new THREE.CylinderGeometry(0.03, 0.03, 0.3, 8),
  new THREE.MeshStandardMaterial({ color: 0x0e1113, roughness: 0.4, metalness: 0.6 }),
);
gunBarrel.rotation.x = Math.PI / 2;
gunBarrel.position.set(0, 0.03, -0.36);
viewGun.add(gunBody, gunBarrel);
viewGun.position.set(0.26, -0.22, -0.5);
camera.add(viewGun);
scene.add(camera);

// --- Arsenal ---
const arsenal = {
  owned: { pistol: weaponState('pistol') },
  current: 'pistol',
  grenades: { spark: 1, smoke: 0 },
  grenadeSel: 'spark',
  reloading: 0,
};
function currentWeapon() { return arsenal.owned[arsenal.current]; }
function currentDef() { return WEAPON_DEFS[arsenal.current]; }

// --- Bomb ---
const bomb = createBomb({
  onPlanted(site) {
    hud.feed(`<b>You</b> planted the charge at <b>${SITES[site].name}</b>`, 'info');
    rounds.onPlant();
    sfx.plantBeep();
  },
  onDetonated(site) {
    const s = SITES[site];
    effects.explosion(new THREE.Vector3(s.x, s.y + 1, s.z));
    sfx.detonate();
    hud.feed('The charge detonated.', 'info');
    rounds.endRound('attack', 'Charge detonated');
  },
  onDefused() {
    hud.feed('The charge was defused.', 'foe');
    rounds.endRound('defend', 'Charge defused');
  },
  onDrop() {
    hud.feed('The charge was dropped.', 'info');
  },
  onPickup(character) {
    hud.feed(`<b>${character.name}</b> picked up the charge.`, 'info');
  },
});

// --- Rounds ---
const rounds = createRounds({
  random,
  bombPlanted: () => bomb.isPlanted(),
  onRoundStart(round, site) {
    resetForRound(site);
    hud.banner(`ROUND ${round} — PLANT AT ${SITES[site].name.toUpperCase()}`, 'Buy with B · Freeze phase');
    hud.showBuy(false);
    game.buyOpen = false;
  },
  onLive() {
    hud.banner('GO — PLANT THE CHARGE', '');
    setTimeout(() => { if (rounds.state.phase === 'live') hud.clearBanner(); }, 1800);
    hud.showBuy(false);
    game.buyOpen = false;
  },
  onRoundEnd(winner, reason, score) {
    const won = winner === 'attack';
    hud.banner(won ? 'ROUND WON' : 'ROUND LOST', `${reason} · Vanguard ${score.attack} — ${score.defend} Wardens`);
    if (won) sfx.roundWin(); else sfx.roundLose();
  },
  onMatchEnd(score) {
    const won = score.attack > score.defend;
    document.getElementById('endtitle').textContent = won ? 'VANGUARD WINS' : 'WARDENS WIN';
    document.getElementById('endtext').textContent = `Final: Vanguard ${score.attack} — ${score.defend} Wardens. First to 4 takes the match.`;
    document.getElementById('overlay-end').style.display = 'flex';
    input.exitLock();
    if (won) sfx.roundWin(); else sfx.roundLose();
  },
});

// --- Bots ---
const botsApi = createBots({
  map: mapApi,
  combat,
  random,
  scene,
  spawns: SPAWNS,
  sites: SITES,
  phase: () => rounds.state.phase,
  bombState: () => bomb.state,
  attackSite: () => rounds.state.attackSite,
  noises: game.noises,
  botShoot(bot) {
    botShot(bot);
  },
  bombPlantStep(dt, bot, site) {
    bomb.plantStep(dt, bot, site);
  },
  bombDefuseStep(dt, bot) {
    bomb.defuseStep(dt, bot);
  },
  bombPickUp(bot) {
    if (bomb.pickUp(bot.character)) {
      bot.isCarrier = true;
      hud.feed(`<b>${bot.name}</b> picked up the charge.`, 'info');
    }
  },
  onBotDeath(bot, killer) {
    if (killer) {
      hud.feed(`<b>${killer.name}</b> ▸ <b>${bot.name}</b>`, bot.team === 'attack' ? '' : 'foe');
      if (killer.team === 'attack') rounds.onKill();
      if (bot.isCarrier) bomb.drop();
    }
    game.lastSeenEnemies = game.lastSeenEnemies.filter((e) => e.id !== bot.id);
    checkElimination();
  },
});
botsApi.spawnAll();

function checkElimination() {
  if (rounds.state.phase !== 'live') return;
  const attackersAlive = (player.alive ? 1 : 0) + botsApi.bots.filter((b) => b.team === 'attack' && !b.dead).length;
  const defendersAlive = botsApi.bots.filter((b) => b.team === 'defend' && !b.dead).length;
  if (defendersAlive === 0) {
    rounds.endRound('attack', 'Wardens eliminated');
  } else if (attackersAlive === 0 && !bomb.isPlanted()) {
    rounds.endRound('defend', 'Vanguard eliminated');
  }
}

function resetForRound(site) {
  // Player
  const spawn = SPAWNS.attack[0];
  playerBody.body.position.set(spawn.x, mapApi.groundAt(spawn.x, spawn.z), spawn.z);
  playerBody.body.velocity.set(0, 0, 0);
  playerBody.body.yaw = spawn.yaw;
  player.alive = true;
  player.health = 100;
  game.recoil = 0;
  game.bloom = 0;
  // Refill owned magazines each round.
  for (const id of Object.keys(arsenal.owned)) {
    arsenal.owned[id].mag = WEAPON_DEFS[id].mag;
    arsenal.owned[id].reserve = WEAPON_DEFS[id].reserve;
    arsenal.owned[id].reloading = 0;
  }
  arsenal.reloading = 0;
  // Bomb goes to the player: the objective is in the player's hands.
  bomb.setCarrier(player);
  // Bots
  botsApi.resetForRound(site);
  game.grenades = [];
  game.noises = [];
  game.lastSeenEnemies = [];
  document.getElementById('overlay-end').style.display = 'none';
  document.getElementById('overlay-pause').style.display = 'none';
}

// --- Shooting (player) ---
const _muzzle = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _eye = new THREE.Vector3();

function playerEye() {
  _eye.copy(playerBody.body.position);
  _eye.y += playerBody.body.crouched ? 1.05 : 1.6;
  return _eye;
}

function shootPlayer() {
  const state = currentWeapon();
  const def = currentDef();
  if (state.reloading > 0 || state.mag <= 0) {
    if (state.mag <= 0) sfx.dryFire();
    return;
  }
  state.mag -= 1;
  game.fireTimer = 60 / def.rpm;
  // Recoil: pitch kick + bloom, recovered over time.
  game.recoil = Math.min(0.09, game.recoil + def.kick * 0.004);
  game.bloom = Math.min(0.02, game.bloom + def.kick * 0.002);
  camera.getWorldDirection(_dir);
  const eye = playerEye();
  _muzzle.copy(eye).addScaledVector(_dir, 0.6);
  _muzzle.y -= 0.12;
  effects.muzzleFlash(_muzzle, _dir);
  const moving = Math.hypot(playerBody.body.velocity.x, playerBody.body.velocity.z);
  const spread = def.spread + def.moveSpread * Math.min(1, moving / 5) + game.bloom;
  let hitAny = false;
  for (let p = 0; p < def.pellets; p += 1) {
    const result = combat.shoot(player, eye, _dir, spread, def, random);
    effects.tracer(_muzzle, result.point);
    if (result.hit) {
      hitAny = true;
      effects.sparkBurst(result.point, result.killed ? 10 : 5);
      hud.hitmarker();
      sfx.hit();
      if (result.killed && result.victim) {
        sfx.kill();
        // The kill feed and money are handled by the victim's onDeath
        // handler — never duplicate them here.
        const victim = result.victim;
        if (victim.id?.startsWith('bot-')) {
          game.lastSeenEnemies = game.lastSeenEnemies.filter((e) => e.id !== victim.id);
        }
      } else if (result.victim) {
        // Remember where we saw this enemy for the minimap.
        const v = result.victim;
        const found = game.lastSeenEnemies.find((e) => e.id === v.id);
        if (found) {
          found.x = v.position.x; found.z = v.position.z; found.at = game.now;
        } else {
          game.lastSeenEnemies.push({ id: v.id, x: v.position.x, z: v.position.z, at: game.now });
        }
      }
    } else if (result.blocked || result.smoked) {
      effects.sparkBurst(result.point, 3);
    }
  }
  if (def.id === 'shotgun') sfx.shotgun(); else sfx.shot(def);
  game.noises.push({ position: eye.clone(), at: game.now, loud: def.loud });
}

// --- Bot shooting ---
function botShot(bot) {
  const def = bot.weapon;
  const origin = new THREE.Vector3(bot.mover.body.position.x, bot.mover.body.position.y + 1.45, bot.mover.body.position.z);
  const target = bot.target;
  if (!target) return;
  _dir.set(target.position.x - origin.x, (target.position.y + 1.25) - origin.y, target.position.z - origin.z).normalize();
  const dist = origin.distanceTo(target.position);
  const spread = def.spread + 0.008 + dist * 0.0004;
  const result = combat.shoot(bot.character, origin, _dir, spread, def, random);
  effects.tracer(origin, result.point);
  // Kills are reported by the victim's onDeath handler (feed, money,
  // elimination check) — combat already calls it, so nothing else to do.
  if (result.hit) {
    if (result.victim === player) {
      hud.damageFlash();
      sfx.hurt();
    }
  } else if (result.blocked || result.smoked) {
    effects.sparkBurst(result.point, 2);
  }
  sfx.distantShot();
  game.noises.push({ position: origin.clone(), at: game.now, loud: def.loud });
}

// --- Grenades ---
const grenadeGeo = new THREE.SphereGeometry(0.11, 10, 8);
const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x2a2f33, roughness: 0.5, metalness: 0.5 });

function throwGrenade() {
  const id = arsenal.grenadeSel;
  if ((arsenal.grenades[id] ?? 0) <= 0) return;
  arsenal.grenades[id] -= 1;
  const def = GRENADE_DEFS[id];
  camera.getWorldDirection(_dir);
  const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
  const start = playerEye().addScaledVector(_dir, 0.5);
  mesh.position.copy(start);
  scene.add(mesh);
  game.grenades.push({
    mesh, kind: id, def,
    velocity: _dir.clone().multiplyScalar(14).add(new THREE.Vector3(0, 3.5, 0)),
    fuse: def.fuseSeconds,
  });
  sfx.throwPop();
}

function updateGrenades(dt) {
  for (let i = game.grenades.length - 1; i >= 0; i -= 1) {
    const g = game.grenades[i];
    g.fuse -= dt;
    g.velocity.y -= 18 * dt;
    const p = g.mesh.position;
    p.addScaledVector(g.velocity, dt);
    const ground = mapApi.groundAt(p.x, p.z);
    if (p.y < ground + 0.11) {
      p.y = ground + 0.11;
      g.velocity.y = Math.abs(g.velocity.y) > 1 ? -g.velocity.y * 0.35 : 0;
      g.velocity.x *= 0.6;
      g.velocity.z *= 0.6;
    }
    if (p.x < -31.5 || p.x > 31.5) { p.x = Math.max(-31.5, Math.min(31.5, p.x)); g.velocity.x *= -0.4; }
    if (p.z < -23.5 || p.z > 23.5) { p.z = Math.max(-23.5, Math.min(23.5, p.z)); g.velocity.z *= -0.4; }
    if (g.fuse <= 0) {
      if (g.kind === 'spark') {
        effects.explosion(p.clone());
        sfx.detonate();
        combat.damageRadius(p, g.def.radius, g.def.maxDamage, player);
        game.noises.push({ position: p.clone(), at: game.now, loud: 1.5 });
        checkElimination();
      } else {
        effects.smokeCloud(p.clone(), g.def.radius, g.def.durationSeconds);
        sfx.smokeHiss();
      }
      scene.remove(g.mesh);
      game.grenades.splice(i, 1);
    }
  }
}

// --- Buy menu ---
function buy(item) {
  if (!rounds.canBuy()) return;
  if (item.kind === 'weapon') {
    const def = WEAPON_DEFS[item.id];
    if (arsenal.owned[item.id]) return;
    if (!rounds.spend(def.price)) return;
    arsenal.owned[item.id] = weaponState(item.id);
    arsenal.current = item.id;
    sfx.buyClick();
    hud.feed(`Bought the ${def.name}.`, 'info');
  } else if (item.kind === 'grenade') {
    const def = GRENADE_DEFS[item.id];
    if (!rounds.spend(def.price)) return;
    arsenal.grenades[item.id] = (arsenal.grenades[item.id] ?? 0) + 1;
    arsenal.grenadeSel = item.id;
    sfx.buyClick();
    hud.feed(`Bought a ${def.name} grenade.`, 'info');
  } else if (item.kind === 'ammo') {
    if (!rounds.spend(AMMO_PRICE)) return;
    const state = currentWeapon();
    const def = currentDef();
    state.reserve = def.reserve;
    sfx.buyClick();
    hud.feed('Ammo refilled.', 'info');
  }
  hud.updateBuy(arsenal.owned, rounds.state.money);
}

// --- Fixed-step simulation ---
let pitch = 0;
let yaw = SPAWNS.attack[0].yaw;

function stepSim(dt) {
  game.now += dt;
  // Prune old noise.
  while (game.noises.length > 0 && game.now - game.noises[0].at > 2) game.noises.shift();
  const phase = rounds.state.phase;
  if (phase === 'freeze' || phase === 'live' || phase === 'roundEnd') {
    rounds.tick(dt);
    bomb.tick(dt);
    // Bomb beeps while the fuse runs.
    if (bomb.state.mode === 'planted' || bomb.state.mode === 'defusing') {
      if (Math.floor(game.now * 2) !== Math.floor((game.now - dt) * 2)) sfx.bombTick();
    }
  }
  if (!game.started || game.paused) return;
  if (phase !== 'freeze' && phase !== 'live') return;

  // Look + movement (player only while alive).
  const look = input.consumeLook();
  if (input.locked) {
    yaw -= look.x * 0.0022;
    pitch -= look.y * 0.0022;
    pitch = Math.max(-1.5, Math.min(1.5, pitch));
  }
  if (player.alive) {
    const sprinting = input.keys.has('ShiftLeft') || input.keys.has('ShiftRight');
    const crouching = input.keys.has('KeyC') || input.keys.has('ControlLeft');
    player.crouched = crouching;
    playerBody.body.yaw = yaw;
    playerBody.step(dt, {
      forward: (input.keys.has('KeyW') ? 1 : 0) - (input.keys.has('KeyS') ? 1 : 0),
      strafe: (input.keys.has('KeyD') ? 1 : 0) - (input.keys.has('KeyA') ? 1 : 0),
      jump: input.keys.has('Space'),
      sprint: sprinting && !crouching,
      crouch: crouching,
    });
    // Footsteps.
    const speed = Math.hypot(playerBody.body.velocity.x, playerBody.body.velocity.z);
    if (speed > 1 && playerBody.body.onGround) {
      game._stepAcc = (game._stepAcc ?? 0) + speed * dt;
      if (game._stepAcc > 3.2) {
        game._stepAcc = 0;
        sfx.step(sprinting);
      }
    }
    // Recoil + bloom recovery.
    game.recoil *= Math.max(0, 1 - 7 * dt);
    game.bloom *= Math.max(0, 1 - 2.5 * dt);

    // Firing.
    game.fireTimer -= dt;
    const def = currentDef();
    const state = currentWeapon();
    if (state.reloading > 0) {
      state.reloading -= dt;
      if (state.reloading <= 0) {
        const need = def.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
        state.reloading = 0;
      }
    }
    // The lock is enforced inside the input module: mousedown only sets
    // firing while locked, and losing the lock clears it. Checking it again
    // here would make the game untestable in headless Chrome (which never
    // grants pointer lock) without adding any real protection.
    const wantFire = input.firing;
    const edge = wantFire && !game.prevFiring;
    game.prevFiring = wantFire;
    if (wantFire && game.fireTimer <= 0 && state.reloading <= 0) {
      if (def.auto || edge) shootPlayer();
    }
    if (input.wasPressed('KeyR')) {
      if (state.mag < def.mag && state.reserve > 0 && state.reloading <= 0) {
        state.reloading = def.reloadSeconds;
        sfx.reload();
      }
    }
    // Weapon switch.
    const switchKeys = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];
    const switchIds = ['pistol', 'rifle', 'smg', 'shotgun'];
    for (let i = 0; i < 4; i += 1) {
      if (input.wasPressed(switchKeys[i]) && arsenal.owned[switchIds[i]]) {
        arsenal.current = switchIds[i];
        arsenal.reloading = 0;
      }
    }
    if (input.wasPressed('KeyQ')) {
      arsenal.grenadeSel = arsenal.grenadeSel === 'spark' ? 'smoke' : 'spark';
    }
    if (input.wasPressed('KeyG')) throwGrenade();

    // Plant / defuse (hold E).
    const eHeld = input.keys.has('KeyE');
    if (phase === 'live') {
      if (bomb.state.carrier === player && (bomb.state.mode === 'carried' || bomb.state.mode === 'planting')) {
        const site = SITES[rounds.state.attackSite];
        const near = Math.hypot(site.x - playerBody.body.position.x, site.z - playerBody.body.position.z) < 2.2;
        if (near) {
          hud.prompt('Hold <b>E</b> to plant the charge');
          if (eHeld && bomb.plantStep(dt, player, rounds.state.attackSite)) {
            hud.plantProgress(bomb.state.progress);
          } else {
            bomb.cancelPlant();
            hud.plantProgress(null);
          }
        } else {
          bomb.cancelPlant();
          hud.plantProgress(null);
          hud.prompt(null);
        }
      } else if (bomb.state.mode === 'planted' || bomb.state.mode === 'defusing') {
        const near = Math.hypot(bomb.position.x - playerBody.body.position.x, bomb.position.z - playerBody.body.position.z) < 1.8;
        if (near) {
          hud.prompt('Hold <b>E</b> to defuse the charge');
          if (eHeld && bomb.defuseStep(dt, player)) {
            hud.plantProgress(bomb.state.progress);
          } else {
            bomb.cancelDefuse();
            hud.plantProgress(null);
          }
        } else {
          bomb.cancelDefuse();
          hud.plantProgress(null);
          hud.prompt(null);
        }
      } else {
        hud.prompt(null);
        hud.plantProgress(null);
      }
      // Pick up a dropped charge by walking over it.
      if (bomb.state.mode === 'dropped' && playerBody.body.position.distanceTo(bomb.position) < 1.4) {
        bomb.pickUp(player);
      }
    }

    // Buy menu (freeze phase only).
    if (input.wasPressed('KeyB') && rounds.canBuy()) {
      game.buyOpen = !game.buyOpen;
      hud.showBuy(game.buyOpen);
      if (game.buyOpen) hud.updateBuy(arsenal.owned, rounds.state.money);
    }
    if (game.buyOpen && rounds.canBuy()) {
      for (const item of BUY_LIST) {
        if (input.wasPressed(`Digit${item.key}`)) buy(item);
      }
    }
    if (input.wasPressed('Escape') && game.buyOpen) {
      game.buyOpen = false;
      hud.showBuy(false);
    }
  }
  if (input.wasPressed('KeyP')) {
    game.paused = !game.paused;
    document.getElementById('overlay-pause').style.display = game.paused ? 'flex' : 'none';
    if (game.paused) input.exitLock();
  }

  // Bots run their AI every step.
  const others = [player, ...botsApi.bots.map((b) => b.character)];
  botsApi.tick(dt, game.now, others);
  updateGrenades(dt);

  // Keep hit boxes on the player.
  hitGroup.position.copy(playerBody.body.position);
  hitGroup.rotation.y = yaw;
}

// --- Render ---
function render(dt) {
  mapApi.update(dt);
  effects.update(dt);
  if (!game.started) {
    // Idle orbit behind the start overlay.
    game.lobbyAngle += dt * 0.05;
    camera.position.set(Math.sin(game.lobbyAngle) * 26, 9, Math.cos(game.lobbyAngle) * 20);
    camera.lookAt(-4, 1, -6);
  } else {
    const eye = playerEye();
    camera.position.copy(eye);
    camera.rotation.set(pitch + game.recoil, yaw, 0);
    viewGun.position.z = -0.5 + game.recoil * 0.9;
    viewGun.rotation.x = game.bloom * 2;
  }
  renderer.render(scene, camera);
  updateHud();
}

function updateHud() {
  const phase = rounds.state.phase;
  const state = currentWeapon();
  const def = currentDef();
  const timeLeft = phase === 'freeze' ? rounds.state.phaseLeft : rounds.state.timer;
  const mm = Math.floor(Math.max(0, timeLeft) / 60);
  const ss = String(Math.floor(Math.max(0, timeLeft) % 60)).padStart(2, '0');
  let timerText = `ROUND ${rounds.state.round} · ${mm}:${ss}`;
  if (phase === 'freeze') timerText = `FREEZE · 0:0${Math.ceil(Math.max(0, rounds.state.phaseLeft))}`;
  if (phase === 'lobby') timerText = 'LOBBY';
  if (phase === 'roundEnd') timerText = 'ROUND OVER';
  if (phase === 'matchEnd') timerText = 'MATCH OVER';
  let bombText = 'CHARGE WITH YOU';
  let bombPlanted = false;
  if (bomb.state.mode === 'dropped') bombText = 'CHARGE DROPPED';
  else if (bomb.state.mode === 'planted' || bomb.state.mode === 'defusing') {
    bombText = `CHARGE PLANTED · 0:${String(Math.ceil(bomb.state.fuseLeft)).padStart(2, '0')}`;
    bombPlanted = true;
  } else if (bomb.state.mode === 'gone') bombText = 'CHARGE GONE';
  else if (bomb.state.carrier && bomb.state.carrier !== player) bombText = `CHARGE WITH ${bomb.state.carrier.name.toUpperCase()}`;
  const pips = [
    ...[player, ...botsApi.bots.filter((b) => b.team === 'attack')].map((c) => `<i class="${c.alive ? 'att' : 'dead'}"></i>`),
    ...botsApi.bots.filter((b) => b.team === 'defend').map((b) => `<i class="${b.dead ? 'dead' : 'def'}"></i>`),
  ].join('');
  const moving = Math.hypot(playerBody.body.velocity.x, playerBody.body.velocity.z);
  const gap = 5 + (def.spread + def.moveSpread * Math.min(1, moving / 5) + game.bloom) * 600;
  const allies = [
    { x: playerBody.body.position.x, z: playerBody.body.position.z, you: true },
    ...botsApi.bots.filter((b) => b.team === 'attack' && !b.dead).map((b) => ({ x: b.mover.body.position.x, z: b.mover.body.position.z })),
  ];
  const enemies = game.lastSeenEnemies.filter((e) => game.now - e.at < 3).map((e) => ({ x: e.x, z: e.z, at: e.at }));
  hud.update({
    health: player.health,
    money: rounds.state.money,
    weaponName: def.name,
    mag: state.mag,
    reserve: state.reserve,
    grenades: `Spark ×${arsenal.grenades.spark} · Haze ×${arsenal.grenades.smoke} (${arsenal.grenadeSel === 'spark' ? 'Spark' : 'Haze'} ready)`,
    score: rounds.state.score,
    timerText,
    urgent: timeLeft < 10 || (bombPlanted && bomb.state.fuseLeft < 10),
    pips,
    bombText,
    bombPlanted,
    crosshairGap: Math.round(gap),
    minimap: {
      solids: mapApi.solids,
      sites: SITES,
      allies,
      bomb: bomb.state.mode === 'planted' || bomb.state.mode === 'defusing'
        ? { visible: true, x: bomb.position.x, z: bomb.position.z }
        : bomb.state.mode === 'dropped'
          ? { visible: true, x: bomb.position.x, z: bomb.position.z }
          : { visible: false, x: 0, z: 0 },
      enemies,
      now: game.now,
      you: { x: playerBody.body.position.x, z: playerBody.body.position.z, dirX: -Math.sin(yaw), dirZ: -Math.cos(yaw) },
    },
  });
}

// --- UI wiring ---
document.getElementById('play').addEventListener('click', () => {
  initAudio();
  document.getElementById('overlay-start').style.display = 'none';
  input.requestLock();
  game.started = true;
  rounds.startMatch();
});
document.getElementById('resume').addEventListener('click', () => {
  game.paused = false;
  document.getElementById('overlay-pause').style.display = 'none';
  input.requestLock();
});
document.getElementById('again').addEventListener('click', () => {
  document.getElementById('overlay-end').style.display = 'none';
  game.started = true;
  rounds.startMatch();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Shot staging (deterministic scenes for screenshots) ---
function stageShot() {
  if (!shotMode) return;
  document.getElementById('overlay-start').style.display = 'none';
  if (shotMode === 'start') {
    // Keep the orbit camera behind the (hidden) start screen.
    game.lobbyAngle = 0.7;
    return;
  }
  game.started = true;
  rounds.startMatch();
  if (shotMode === 'play') {
    rounds.state.phase = 'live';
    rounds.state.timer = 95;
    playerBody.body.position.set(-2, mapApi.groundAt(-2, 6), 6);
    yaw = 0.15;
    pitch = -0.02;
    const b0 = botsApi.bots[2];
    const b1 = botsApi.bots[4];
    b0.mover.body.position.set(-6, 0, -2);
    b1.mover.body.position.set(4, 0, -4);
    b0.mover.body.yaw = Math.PI;
    b1.mover.body.yaw = Math.PI;
    // Settle the sim for a moment so the scene reads as mid-play.
    for (let i = 0; i < 60; i += 1) stepSim(1 / 60);
  } else if (shotMode === 'buy') {
    rounds.state.phase = 'freeze';
    rounds.state.phaseLeft = 4.5;
    hud.showBuy(true);
    hud.updateBuy(arsenal.owned, rounds.state.money);
  } else if (shotMode === 'bomb') {
    rounds.state.phase = 'live';
    rounds.state.timer = 60;
    bomb.state.mode = 'planted';
    bomb.state.site = 'A';
    bomb.state.fuseLeft = 28;
    bomb.position.set(SITES.A.x, SITES.A.y, SITES.A.z);
    playerBody.body.position.set(-17, mapApi.groundAt(-17, -8), -8);
    yaw = -0.6;
    for (let i = 0; i < 60; i += 1) stepSim(1 / 60);
  } else if (shotMode === 'smoke') {
    rounds.state.phase = 'live';
    rounds.state.timer = 80;
    effects.smokeCloud(new THREE.Vector3(0, 1.2, -2), 5, 8);
    playerBody.body.position.set(0, mapApi.groundAt(0, 8), 8);
    yaw = 0;
    pitch = 0;
    const b0 = botsApi.bots[3];
    b0.mover.body.position.set(-3, 0, -6);
    b0.mover.body.yaw = Math.PI;
    for (let i = 0; i < 60; i += 1) stepSim(1 / 60);
  }
}

// --- Main loop ---
let last = performance.now();
let acc = 0;
const STEP = 1 / 60;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += dt;
  let steps = 0;
  while (acc >= STEP && steps < 5) {
    stepSim(STEP);
    acc -= STEP;
    steps += 1;
  }
  render(dt);
  input.endFrame();
  if (shotMode && !game.shotReady) {
    game.shotTimer += dt;
    if (game.shotTimer > 1.6) {
      game.shotReady = true;
      window.__shotReady = true;
    }
  }
}

stageShot();
requestAnimationFrame(frame);

// Probe handle for tests (live play, plant, timer expiry).
window.__quay = {
  rounds, bomb, player, bots: botsApi.bots, map: mapApi, game,
  get phase() { return rounds.state.phase; },
  arsenal,
  sites: SITES,
  // Point the player's view at a world point (used by probes to aim).
  aimAt(x, z) {
    const dx = x - playerBody.body.position.x;
    const dz = z - playerBody.body.position.z;
    yaw = Math.atan2(-dx, -dz);
    pitch = 0;
  },
  // Drive the trigger directly (used by probes: pointer lock does not
  // engage in headless Chrome, so a real mouse press never reaches the
  // game there; in a desktop browser the pointer-locked click is the path).
  setFiring(v) { input.firing = v; },
  isLocked() { return input.locked; },
  // Raycast diagnostics (used by probes): where the camera looks, and
  // what one real hitscan round from that look actually hits.
  probeAim() {
    camera.getWorldDirection(_dir);
    return { eye: playerEye().toArray().map((v) => +v.toFixed(2)), dir: _dir.toArray().map((v) => +v.toFixed(3)), yaw: +yaw.toFixed(3), pitch: +pitch.toFixed(3) };
  },
  probeShoot() {
    camera.getWorldDirection(_dir);
    const result = combat.shoot(player, playerEye().clone(), _dir.clone(), 0, currentDef(), random);
    return {
      hit: result.hit, victim: result.victim?.name ?? null, part: result.part ?? null,
      point: result.point ? result.point.toArray().map((v) => +v.toFixed(2)) : null,
      blocked: !!result.blocked, smoked: !!result.smoked,
    };
  },
};
