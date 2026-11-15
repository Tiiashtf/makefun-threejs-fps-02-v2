// Arsenal: four weapons and two grenades. Every weapon is one flat record;
// combat.js reads damage/head multiplier/rate/spread from it, nothing else
// in the game hard-codes a weapon's numbers.
export const WEAPON_DEFS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', price: 0,
    damage: 26, headMult: 2.2, pellets: 1,
    rpm: 320, mag: 12, reserve: 36, reloadSeconds: 1.1,
    spread: 0.006, moveSpread: 0.02, auto: false, range: 60, kick: 0.35,
    tracer: 0xffd27a, loud: 0.5,
  },
  rifle: {
    id: 'rifle', name: 'VK-7 Rifle', price: 2700,
    damage: 34, headMult: 2.5, pellets: 1,
    rpm: 540, mag: 30, reserve: 90, reloadSeconds: 2.2,
    spread: 0.008, moveSpread: 0.028, auto: true, range: 90, kick: 0.8,
    tracer: 0xffd27a, loud: 1.0,
  },
  smg: {
    id: 'smg', name: 'Raptor SMG', price: 1500,
    damage: 21, headMult: 2.2, pellets: 1,
    rpm: 780, mag: 28, reserve: 84, reloadSeconds: 1.8,
    spread: 0.012, moveSpread: 0.03, auto: true, range: 55, kick: 0.5,
    tracer: 0xffd27a, loud: 0.8,
  },
  shotgun: {
    id: 'shotgun', name: 'Boomstick', price: 1200,
    damage: 12, headMult: 1.8, pellets: 8,
    rpm: 70, mag: 6, reserve: 18, reloadSeconds: 2.6,
    spread: 0.05, moveSpread: 0.05, auto: false, range: 30, kick: 2.2,
    tracer: 0xffc46b, loud: 1.2,
  },
};

export const GRENADE_DEFS = {
  spark: {
    id: 'spark', name: 'Spark frag', price: 300,
    radius: 7, maxDamage: 110, fuseSeconds: 1.6, color: 0xffc46b,
  },
  smoke: {
    id: 'smoke', name: 'Haze smoke', price: 250,
    radius: 5, durationSeconds: 8, fuseSeconds: 1.4, color: 0x9aa7b1,
  },
};

// The buy menu reads this, in the order the player buys (index 1..6).
export const BUY_LIST = [
  { key: '1', kind: 'weapon', id: 'rifle' },
  { key: '2', kind: 'weapon', id: 'smg' },
  { key: '3', kind: 'weapon', id: 'shotgun' },
  { key: '4', kind: 'grenade', id: 'spark' },
  { key: '5', kind: 'grenade', id: 'smoke' },
  { key: '6', kind: 'ammo', id: 'ammo' },
];

export const AMMO_PRICE = 400;

export function weaponState(id) {
  const def = WEAPON_DEFS[id];
  return { id, mag: def.mag, reserve: def.reserve, reloading: 0 };
}
