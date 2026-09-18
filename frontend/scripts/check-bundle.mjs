#!/usr/bin/env node
// Bundle budget. Fails the build when the production output grows past the
// limits below. Sizes are gzip, which is what the network actually carries.
//
//   node scripts/check-bundle.mjs            # check dist/ against the budget
//   node scripts/check-bundle.mjs --report   # print sizes, never fail
//
// Budgets are set ~15 % above the post-migration measurement so a normal
// feature does not trip them, while a stray import of a large library does.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, relative } from 'node:path';

const DIST = new URL('../dist/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const BUDGET = {
  // The JS the login page needs before it can paint (entry + shared vendor).
  initialJsGzipKb: 150,
  // Everything under dist/assets/*.js, gzip.
  totalJsGzipKb: 520,
  // Any single chunk, gzip. Recharts is the largest by design.
  maxChunkGzipKb: 140,
  cssGzipKb: 32,
};

const report = process.argv.includes('--report');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

let files;
try {
  files = walk(join(DIST, 'assets'));
} catch {
  console.error(`check-bundle: ${DIST}assets not found — run \`npm run build\` first`);
  process.exit(2);
}

const gz = (p) => gzipSync(readFileSync(p)).length;
const kb = (n) => (n / 1024).toFixed(1);

const js = files.filter((f) => f.endsWith('.js')).map((f) => ({ file: relative(DIST, f), gzip: gz(f) }));
const css = files.filter((f) => f.endsWith('.css')).map((f) => ({ file: relative(DIST, f), gzip: gz(f) }));

// Initial JS = everything index.html references synchronously (modulepreload + entry).
const html = readFileSync(join(DIST, 'index.html'), 'utf8');
const initial = js.filter(({ file }) => html.includes(file.replace(/\\/g, '/')));

const totalJs = js.reduce((s, x) => s + x.gzip, 0);
const initialJs = initial.reduce((s, x) => s + x.gzip, 0);
const totalCss = css.reduce((s, x) => s + x.gzip, 0);
const largest = js.reduce((a, b) => (b.gzip > a.gzip ? b : a), { file: '-', gzip: 0 });

console.log('Bundle (gzip):');
for (const x of [...js, ...css].sort((a, b) => b.gzip - a.gzip)) {
  console.log(`  ${kb(x.gzip).padStart(7)} kB  ${x.file}${initial.includes(x) ? '  (initial)' : ''}`);
}
console.log(`  initial JS ${kb(initialJs)} kB / ${BUDGET.initialJsGzipKb} kB`);
console.log(`  total JS   ${kb(totalJs)} kB / ${BUDGET.totalJsGzipKb} kB`);
console.log(`  largest    ${kb(largest.gzip)} kB (${largest.file}) / ${BUDGET.maxChunkGzipKb} kB`);
console.log(`  CSS        ${kb(totalCss)} kB / ${BUDGET.cssGzipKb} kB`);

const failures = [];
if (initialJs > BUDGET.initialJsGzipKb * 1024) failures.push('initial JS');
if (totalJs > BUDGET.totalJsGzipKb * 1024) failures.push('total JS');
if (largest.gzip > BUDGET.maxChunkGzipKb * 1024) failures.push(`largest chunk (${largest.file})`);
if (totalCss > BUDGET.cssGzipKb * 1024) failures.push('CSS');

if (failures.length && !report) {
  console.error(`\ncheck-bundle: over budget: ${failures.join(', ')}`);
  process.exit(1);
}
console.log(failures.length ? '\n(report mode — over budget but not failing)' : '\nWithin budget.');
