#!/usr/bin/env node
// Is every catalogued event something the system can actually emit? (P-SYS-1 F1)
//
// THE CATALOGUE IS A PRODUCT SURFACE, TWICE OVER. `GET /automation/events` serves it as the list a
// workflow trigger is chosen from, and HR notification rules validate against the same document on
// purpose — «a rule and a workflow trigger ask the same question of the same catalogue; two
// implementations of that question is how the two answers start to differ.»
//
// So an event that is catalogued and never emitted is not an unused constant. It is a trigger a
// person can pick and a rule they can save, which validates, saves, sits enabled and green, and
// never fires. `rule-validation.ts` names that exact failure as the thing it exists to prevent —
// and cannot catch this one, because the catalogue is its source of truth and the catalogue is
// what is wrong.
//
// WHY IT LIVES HERE AND NOT IN A SPEC. `catalog.spec.ts` already checks coverage both ways, but
// both are contracts↔contracts: it cannot see `apps/api`, so it cannot know what is emitted. This
// is the only place both halves are visible — the same reason `check-page-registry.mjs` reads
// module manifests from `scripts/`.
//
// TWO WAYS TO MATCH, AND BOTH ARE NEEDED. Symbols alone miss three real emitters: the recruitment
// engine emits `event.name` dynamically from a parallel map, training publishes through a
// `publish(name, doc)` helper, and payroll takes the event as a parameter. Strings alone are far
// worse — the API refers to events by symbol, so a string search reports most of the catalogue as
// dead. An event counts as reachable if EITHER its symbol or its string appears in API source.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== 'node_modules' && entry !== 'dist') walk(full, out);
    } else if (entry.endsWith('.ts') && !entry.includes('.spec.')) {
      out.push(full);
    }
  }
  return out;
};

// Every `X: 'a.b.c'` inside an exported `*Events` constant, mapped string → symbol.
const declared = new Map();
for (const file of walk(join(root, 'packages/contracts/src'))) {
  const text = readFileSync(file, 'utf8');
  const groups = text.matchAll(/export const ([A-Za-z]+Events)\s*=\s*\{([\s\S]*?)\}\s*as const/g);
  for (const group of groups) {
    for (const [, key, value] of group[2].matchAll(/(\w+)\s*:\s*'([a-zA-Z][\w.]*)'/g)) {
      declared.set(value, `${group[1]}.${key}`);
    }
  }
}

// Only what the catalogue promises — a constant nobody catalogued is nobody's trigger.
const catalog = readFileSync(join(root, 'packages/contracts/src/events/catalog.ts'), 'utf8');
const catalogued = new Set(
  [...catalog.matchAll(/\[\s*([A-Za-z]+Events\.[A-Za-z0-9_]+)\s*\]\s*:/g)].map((m) => m[1]),
);

const api = walk(join(root, 'apps/api/src'))
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');

const unreachable = [];
for (const [name, symbol] of declared) {
  if (!catalogued.has(symbol)) continue;
  if (api.includes(`'${name}'`) || api.includes(symbol)) continue;
  unreachable.push({ name, symbol });
}

const total = [...declared.values()].filter((s) => catalogued.has(s)).length;
const reachable = total - unreachable.length;

if (unreachable.length === 0) {
  console.log(`event reachability OK — ${total} catalogued events, all reachable from api code`);
  process.exit(0);
}

console.log(
  `event reachability — ${String(reachable)}/${String(total)} catalogued events reachable, ` +
    `${String(unreachable.length)} NOT emitted by any code path:`,
);
for (const { name, symbol } of unreachable.sort((a, b) => a.name.localeCompare(b.name))) {
  console.log(`  ${name}  (${symbol})`);
}
console.log(
  '\nEach of these can be chosen as an automation trigger and saved as a notification rule.\n' +
    'It will validate, save, sit enabled — and never fire. See P-SYS-1 §2 (F1).\n' +
    'REPORT ONLY for now: it becomes a gate in the change that resolves them (P-SYS-1 D1).',
);
process.exit(0);
