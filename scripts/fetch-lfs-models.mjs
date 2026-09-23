#!/usr/bin/env node
/**
 * Resolves Git LFS pointer files in asset/ before Vite build / dev.
 * Vercel clones often leave LFS pointers; this fetches real assets from GitHub media.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
// Solo gli asset dell'interfaccia (es. logowsk.png) sono ancora in LFS: il sito usa i modelli
// ottimizzati in public/models/opt (fuori da LFS), gli originali FBX/PNG non servono più alla build.
const SCAN_DIRS = [
  join(ROOT, 'asset'),
];
const REPO = 'francescogalli-design/Skycrab-3DViewer';
const REF = process.env.VERCEL_GIT_COMMIT_REF || process.env.GITHUB_REF_NAME || 'main';
const MEDIA = `https://media.githubusercontent.com/media/${REPO}/${REF}`;

function isLfsPointer(filePath) {
  try {
    const st = statSync(filePath);
    if (st.size > 1024) return false;
    const head = readFileSync(filePath, 'utf8').slice(0, 80);
    return head.includes('git-lfs.github.com');
  } catch {
    return false;
  }
}

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    if (name === '.DS_Store') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

async function fetchFile(absPath) {
  const rel = relative(ROOT, absPath).split('\\').join('/');
  const url = `${MEDIA}/${rel}`;
  console.log(`[lfs] fetching ${rel} …`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed ${url}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(absPath, buf);
  console.log(`[lfs] wrote ${rel} (${(buf.length / 1e6).toFixed(1)} MB)`);
}

const targets = SCAN_DIRS.flatMap((dir) => walk(dir)).filter(isLfsPointer);
if (targets.length === 0) {
  console.log('[lfs] no pointer files — models ready');
  process.exit(0);
}

try {
  for (const file of targets) await fetchFile(file);
  console.log(`[lfs] resolved ${targets.length} asset(s)`);
} catch (err) {
  console.error('[lfs] fetch failed:', err.message);
  process.exit(1);
}
