# Cinder Quay — Ember Yard II

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/Tiiashtf/makefun-threejs-fps-02-v2/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/Tiiashtf/makefun-threejs-fps-02-v2/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

An original round-based tactical FPS in three.js 0.187.0, built for the
make.fun "best three.js tactical FPS" bounty (threejs-fps-02). Counter-Strike
-STYLE, never a copy: its own map, art, sounds and names.

**The game.** A night dockyard. Vanguard (attackers: you + 2 bot squadmates)
against Wardens (defenders: 4 bots). First to 4 rounds (max 7), 100-second
rounds, 5-second buy phase. Plant the charge at Crane (A) or Warehouse (B)
— hold E for 3 seconds — or eliminate the other team. A planted charge
detonates after 35 seconds unless defused (5-second channel). Economy:
start $800, kill +$300, plant +$300, round win +$325, loss +$1400.

**Arsenal.** Four weapons — P9 sidearm, VK-7 rifle, Raptor SMG, and the
Boomstick shotgun — plus two grenades: the Spark frag and the Haze smoke
(which blocks line of sight). Buy with B during the freeze phase.

**The map.** Three lanes across a harbor quay: the open north pier along the
water, container rows in the middle, a tight south alley. Verticality:
climbable container stacks, a crane gantry walkway, and a warehouse
mezzanine. Bots follow waypoint routes, hold angles, flank, retreat when
hurt, and react to what they see and hear.

**Tech.** Static files under `game/`, ES modules, no build step, no network
requests. Fixed 60 Hz simulation separate from rendering. Procedural WebAudio
sounds (gunfire, footsteps, bomb beeps) — no audio assets. Real headless
-Chromium renders in `screenshots/` (cover: `play.png`).

## Play

```sh
node serve.ts        # serves game/ at http://localhost:8080
```

WASD move, mouse look (click to lock), Shift sprint, C or Ctrl crouch,
Space jump, R reload, 1–4 weapons, Q grenade cycle, G throw grenade,
E plant/defuse, B buy menu, P pause. `?shot=start|play|buy|bomb|smoke&seed=N`
stages a deterministic scene for screenshots.
