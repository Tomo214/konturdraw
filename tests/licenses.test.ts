import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

// Gleiche Erlaubt-Liste wie deny.toml (architecture.md §4), npm-Schreibweisen ergänzt.
const ALLOWED = new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'Zlib', 'MPL-2.0', '0BSD']);

function isAllowed(expr: string | undefined): boolean {
  if (!expr) return false;
  const clean = expr.replace(/[()]/g, '').trim();
  if (clean.includes(' OR ')) return clean.split(' OR ').some((p) => isAllowed(p));
  if (clean.includes(' AND ')) return clean.split(' AND ').every((p) => isAllowed(p));
  return ALLOWED.has(clean);
}

test('Lizenzprüfung lehnt GPL ab, auch in Ausdrücken', () => {
  expect(isAllowed('GPL-3.0-only')).toBe(false);
  expect(isAllowed('MIT AND GPL-2.0')).toBe(false);
  expect(isAllowed('(MIT OR GPL-3.0)')).toBe(true);
  expect(isAllowed(undefined)).toBe(false);
});

// npm ls braucht im vollen Testlauf (viele Worker) länger als die üblichen 5 s.
test('ausgelieferte npm-Pakete haben nur erlaubte Lizenzen', { timeout: 30_000 }, () => {
  const dirs = execSync('npm ls --omit=dev --all --parseable', { encoding: 'utf8' }).trim().split('\n').slice(1);
  const bad = dirs
    .map((dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name: string; license?: string })
    .filter((pkg) => !isAllowed(pkg.license))
    .map((pkg) => `${pkg.name}: ${pkg.license ?? 'keine Angabe'}`);
  expect(bad).toEqual([]);
});
