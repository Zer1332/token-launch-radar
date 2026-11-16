// Token Launch Radar — entry program (Node 22, standard library only).
//
// Reads the sealed snapshot (/input/snapshot.json, or --input <file|dir>),
// scores every pre-token protocol with the model in lib/model.ts, writes
// the ranked board to /output/board.json and the dashboard's data to
// /output/data.js, copies this repository's dashboard/ and screenshots/
// to /output, and writes /output/dossier.json with the vendored make.fun
// library. The dossier is written last, because the scorer rebuilds it
// from the same /output and compares the bytes.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_MODEL, buildBoard, type Snapshot, type SnapshotProtocol } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (RULES.txt): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

/** Read and minimally validate the sealed snapshot. */
function parseSnapshot(text: string): Snapshot {
  const parsed = JSON.parse(text) as Partial<Snapshot>;
  if (!Array.isArray(parsed.protocols) || !Array.isArray(parsed.watchlist)) {
    throw new Error('token radar: snapshot has no protocols/watchlist arrays');
  }
  if (typeof parsed.as_of !== 'string' || typeof parsed.floor_usd !== 'number') {
    throw new Error('token radar: snapshot has no as_of/floor_usd');
  }
  return parsed as Snapshot;
}

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { rows, live, watchlistCount, earlyCount } = buildBoard(snapshot, DEFAULT_MODEL);

/** Refuse a board the gate would refuse, before writing anything. */
function boardIssue(): string | null {
  if (rows.length < 100) return `only ${rows.length} rows (the gate wants at least 100)`;
  const seen = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.rank !== i + 1) return `row ${row.slug} has rank ${row.rank}, expected ${i + 1}`;
    if (i > 0 && rows[i - 1]!.implied_value_usd < row.implied_value_usd) {
      return `implied value rises at rank ${row.rank}`;
    }
    if (seen.has(row.slug)) return `slug ${row.slug} appears twice`;
    seen.add(row.slug);
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0) {
      return `row ${row.slug} has a bad implied value`;
    }
    if (!Array.isArray(row.farm_steps) || row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `row ${row.slug} has ${row.farm_steps.length} farm steps`;
    }
    for (const step of row.farm_steps) {
      const trimmed = step.trim();
      if (trimmed.length < 20 || trimmed.length > 600) {
        return `row ${row.slug} has a farm step of ${trimmed.length} characters`;
      }
    }
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist slug ${slug} is missing from the board`;
  }
  const values = new Set(rows.map((r) => r.implied_value_usd));
  if (values.size === 1) return 'every row has the same implied value';
  return null;
}

const issue = boardIssue();
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

/** The payload the dashboard renders: the board, the live reference set,
 *  and the model in words, so the page can explain its own numbers. */
function radarData() {
  return {
    meta: {
      as_of: snapshot.as_of,
      source: snapshot.source ?? 'DefiLlama snapshot',
      floor_usd: snapshot.floor_usd,
      model: 'radar-2',
      watchlist_size: watchlistCount,
      board_size: rows.length,
      early_size: earlyCount,
      live_size: live.length,
    },
    model: {
      implied: 'implied value = TVL x peer multiple x growth multiplier x maturity multiplier',
      peer_multiple:
        'median market-cap / TVL of tokened protocols in the same category (at least 3 peers, otherwise the global median), clamped to [0.05, 2.5]',
      growth_multiplier: '1 + clamp(7-day TVL change in %, -60, 120) / 100 x 0.5',
      maturity_multiplier: '0.6 + 0.4 x min(age in days, 1095) / 1095 (unknown age counts as 365 days)',
      eligibility:
        'pre-token only: no wrapped or staked product, no bridge, no liquid staking, no centralised exchange, no versioned re-deployment',
    },
    rows,
    live,
  };
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows })}\n`);
writeFileSync(join(out, 'data.js'), `window.RADAR=${JSON.stringify(radarData())};\n`);

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashboardFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: SCREENSHOT_CAPS,
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  }),
);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${rows.length} rows scored (${earlyCount} early, ${live.length} live set aside)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashboardFiles.length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
