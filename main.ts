// Cinder Quay — the threejs-fps-02-v2 entry (Node 22, standard library only).
// The game is this directory's game/ folder: plain static files the browser
// loads as ES modules, three.js 0.187.0 vendored under game/vendor/three/, no
// build step, no network request. The program hands it in: it copies game/
// and screenshots/ from beside this file to /output and writes
// /output/dossier.json, the summary the judge reads, with the vendored
// make.fun library.
//
// Serve it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const shotDir = join(here, 'screenshots');
const gameDir = join(here, 'game');

// A hand-in with no screenshots is a hand-in the judge cannot see: refuse
// to build one rather than submit a blind entry.
const shots = existsSync(shotDir)
  ? readdirSync(shotDir).filter((name) => /\.(png|jpe?g)$/i.test(name))
  : [];
if (shots.length === 0) {
  throw new Error('screenshots/ holds no PNG or JPEG — capture real renders of the game first');
}
if (shots.length > 4) {
  throw new Error(`screenshots/ holds ${shots.length} images — the gate allows at most 4`);
}

// The game must have an entry page, and it must not be empty.
const index = join(gameDir, 'index.html');
if (!existsSync(index) || statSync(index).size === 0) {
  throw new Error('game/index.html is missing or empty — the game has no entry page');
}

mkdirSync(out, { recursive: true });
cpSync(gameDir, join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
cpSync(shotDir, join(out, 'screenshots'), { recursive: true });

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the
// bytes; the others refuse an entry the scorer would refuse (more than 4
// screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of
// game files, in all: game/ counts beside /output's own 1000-entry cap, its
// screenshots/ and dossier.json).
const dossier = buildDossier(out, { text_max_bytes: 163840, screenshots: { max: 4, max_bytes: 262144 }, game_max_files: 993, game_max_bytes: 50331648 });
writeFileSync(join(out, 'dossier.json'), dossier);

// Read the dossier back and check it parses: a hand-in with a malformed
// dossier is worse than no hand-in, because the judge reads it and finds
// nothing. buildDossier returns bytes, so decode them before parsing.
const parsed = JSON.parse(new TextDecoder().decode(dossier));
if (!parsed || typeof parsed !== 'object') throw new Error('dossier.json did not parse as an object');
console.log(`Cinder Quay: ${shots.length} screenshot(s), dossier ${dossier.length} bytes, written to ${out}`);
