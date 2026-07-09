// Generates docs/06-security/permission-matrix.generated.md from the code catalog
// (Review R18). CI fails when the committed file is stale (--check).
// The hand-written permission-matrix.md remains the narrative; this file is the
// machine-derived inventory that cannot drift from packages/contracts.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { platformPermissions } = await import(
  new URL('../packages/contracts/dist/index.js', import.meta.url).href
);

const byResource = new Map();
for (const permission of platformPermissions) {
  const list = byResource.get(permission.resource) ?? [];
  list.push(permission);
  byResource.set(permission.resource, list);
}

const STANDARD_ACTIONS = [
  'view',
  'create',
  'edit',
  'delete',
  'export',
  'print',
  'approve',
  'reject',
];

let out = `<!-- GENERATED FILE — do not edit by hand.
     Source: packages/contracts/src/permissions/ (single source of truth, ADR-004).
     Regenerate: npm run gen:permission-matrix -->

# Permission Matrix — generated catalog

Machine-derived from \`packages/contracts\`. The narrative matrix lives in
[permission-matrix.md](permission-matrix.md); this file is the code-accurate inventory
synced to the DB registry at boot (Review R18).

| Resource | Module | ${STANDARD_ACTIONS.join(' | ')} | Special actions |
|---|---|${STANDARD_ACTIONS.map(() => ':-:').join('|')}|---|
`;

for (const [resource, permissions] of [...byResource.entries()].sort((a, b) =>
  a[0].localeCompare(b[0]),
)) {
  const moduleId = permissions[0].moduleId;
  const cells = STANDARD_ACTIONS.map((action) =>
    permissions.some((p) => p.action === action) ? '●' : '',
  );
  const specials = permissions
    .filter((p) => !STANDARD_ACTIONS.includes(p.action))
    .map((p) => `\`${p.key}\`${p.breakGlass ? ' ⚠️ break-glass' : ''}`)
    .join(', ');
  out += `| \`${resource}\` | ${moduleId} | ${cells.join(' | ')} | ${specials} |\n`;
}

out += `\nTotal permissions: **${platformPermissions.length}**\n`;

const target = join(root, 'docs/06-security/permission-matrix.generated.md');

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(target, 'utf8');
  } catch {
    // missing file = stale
  }
  if (current !== out) {
    process.stderr.write(
      'permission-matrix.generated.md is stale — run `npm run gen:permission-matrix` and commit.\n',
    );
    process.exit(1);
  }
  process.stdout.write('permission matrix is up to date\n');
} else {
  writeFileSync(target, out);
  process.stdout.write(`wrote ${target}\n`);
}
