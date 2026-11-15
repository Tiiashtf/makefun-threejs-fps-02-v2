// The charge: carried by the Vanguard, planted at a site, defused by the
// Wardens, or dropped where its carrier dies. Pure state, no rendering:
// main.js owns the mesh and the sound; this module owns the rules.
// Modes: 'carried' | 'dropped' | 'planting' | 'planted' | 'defusing' |
// 'gone'. Plant takes 3 s inside a site, defuse 5 s at a planted charge,
// the fuse runs 35 s after the plant.
import * as THREE from 'three';

export const PLANT_SECONDS = 3;
export const DEFUSE_SECONDS = 5;
export const FUSE_SECONDS = 35;

export function createBomb(hooks) {
  const state = {
    mode: 'carried', // carried | dropped | planting | planted | defusing | gone
    carrier: null, // the character carrying it
    site: null, // 'A' | 'B' once planted
    plantSite: null,
    progress: 0, // plant/defuse progress 0..1
    fuseLeft: FUSE_SECONDS,
    position: new THREE.Vector3(),
    planter: null,
    defuser: null,
  };

  function setCarrier(character) {
    state.carrier = character;
    state.mode = 'carried';
    state.planter = null;
    state.defuser = null;
    state.progress = 0;
  }

  function drop() {
    if (state.mode === 'planted' || state.mode === 'gone') return;
    if (state.carrier) state.position.copy(state.carrier.position);
    state.carrier = null;
    state.mode = 'dropped';
    state.progress = 0;
    if (hooks.onDrop) hooks.onDrop(state.position);
  }

  function pickUp(character) {
    if (state.mode !== 'dropped') return false;
    setCarrier(character);
    if (hooks.onPickup) hooks.onPickup(character);
    return true;
  }

  // The carrier holds E inside a site: plantProgress runs; release cancels.
  // Returns true while planting.
  function plantStep(dt, planter, siteKey) {
    if (state.mode !== 'carried' && state.mode !== 'planting') return false;
    if (state.carrier !== planter) return false;
    if (state.mode === 'carried') {
      state.mode = 'planting';
      state.planter = planter;
      state.plantSite = siteKey;
      state.progress = 0;
    }
    state.progress += dt / PLANT_SECONDS;
    if (state.progress >= 1) {
      state.mode = 'planted';
      state.site = state.plantSite;
      state.fuseLeft = FUSE_SECONDS;
      state.progress = 0;
      state.carrier = null;
      state.planter = null;
      if (hooks.onPlanted) hooks.onPlanted(state.site);
    }
    return true;
  }

  function cancelPlant() {
    if (state.mode === 'planting') {
      state.mode = 'carried';
      state.progress = 0;
      state.planter = null;
    }
  }

  // A defender holds E at a planted charge: defuseProgress runs; release cancels.
  function defuseStep(dt, defuser) {
    if (state.mode !== 'planted' && state.mode !== 'defusing') return false;
    if (state.mode === 'planted') {
      state.mode = 'defusing';
      state.defuser = defuser;
      state.progress = 0;
    }
    state.progress += dt / DEFUSE_SECONDS;
    if (state.progress >= 1) {
      state.mode = 'gone';
      state.progress = 0;
      state.defuser = null;
      if (hooks.onDefused) hooks.onDefused();
    }
    return true;
  }

  function cancelDefuse() {
    if (state.mode === 'defusing') {
      state.mode = 'planted';
      state.progress = 0;
      state.defuser = null;
    }
  }

  function tick(dt) {
    if (state.mode === 'planted' || state.mode === 'defusing') {
      state.fuseLeft -= dt;
      if (state.fuseLeft <= 0) {
        state.fuseLeft = 0;
        state.mode = 'gone';
        if (hooks.onDetonated) hooks.onDetonated(state.site);
      }
    }
    // Keep the dropped charge where it fell; the carrier carries it otherwise.
    if (state.mode === 'carried' && state.carrier) state.position.copy(state.carrier.position);
  }

  function isPlanted() {
    return state.mode === 'planted' || state.mode === 'defusing';
  }

  return {
    state, setCarrier, drop, pickUp, plantStep, cancelPlant,
    defuseStep, cancelDefuse, tick, isPlanted,
    // The world position of the charge (carrier's position while carried,
    // the drop point while dropped, the site while planted). Callers read
    // this for the minimap marker and the pickup radius — it must exist.
    get position() { return state.position; },
  };
}
