// Token Radar RADAR-4 — entrypoint. Reads the sealed snapshot, builds the
// 178-row launch-clock board, writes board.json + data.js, copies the
// dashboard and screenshots, and writes dossier.json with buildDossier.
// Deterministic: no Date.now, no randomness; ties break by slug.
// Exits 1 when the board fails its own checks or fewer than 3 screenshots
// are present.
import { cpSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';
import { boardIssue, buildBoard, dataScript, parseSnapshot } from './lib/model.ts';

const root = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const at = args.indexOf('--input');
const given = at >= 0 ? args[at + 1] : '/input';
const input = resolve(given.endsWith('.json') ? given : `${given}/snapshot.json`);
const out = resolve(process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
const snapshot = parseSnapshot(input);
const rows = buildBoard(snapshot);
const issue = boardIssue(rows);
if (issue) { console.error(issue); process.exit(1); }
mkdirSync(out, { recursive: true });
mkdirSync(resolve(out, 'dashboard'), { recursive: true });
mkdirSync(resolve(out, 'screenshots'), { recursive: true });
writeFileSync(resolve(out, 'board.json'), JSON.stringify({ rows }, null, 2) + '\n');
const script = dataScript(snapshot, rows);
writeFileSync(resolve(out, 'data.js'), script);
cpSync(resolve(root, 'dashboard'), resolve(out, 'dashboard'), { recursive: true, force: true });
cpSync(resolve(root, 'screenshots'), resolve(out, 'screenshots'), { recursive: true, force: true });
if (readdirSync(resolve(out, 'screenshots')).filter(n => /\.(?:png|jpe?g)$/i.test(n)).length < 3) { console.error('fewer than 3 screenshots'); process.exit(1); }
const dossier = buildDossier(out, { text_max_bytes: 65536 });
writeFileSync(resolve(out, 'dossier.json'), dossier);
const windows = { soon: 0, mid: 0, late: 0 };
for (const r of rows) windows[r.launchWindow]++;
console.log(JSON.stringify({
  rows: rows.length,
  watchlist: rows.filter(r => r.watchlist).length,
  board_tvl: rows.reduce((n, r) => n + r.tvl_usd, 0),
  windows,
  top_implied3: rows.slice(0, 5).map(r => [r.name, r.implied_value_usd]),
  top_launch: [...rows].sort((a, b) => b.launchScore - a.launchScore || b.implied_value_usd - a.implied_value_usd).slice(0, 5).map(r => [r.name, r.launchScore, r.launchWindow]),
  out,
}));
