// «is this phase drivers-only» is asked in one place, and this is what keeps it that way.
//
// The expression is three tokens long and reads as obviously correct wherever it appears, which is
// exactly why it appeared four times and why two of the copies had drifted apart. Nothing in the
// type system objects to a fourth: `applicability` and `driversOnly` are both real fields on the
// document, and reading either compiles.
//
// So the copies are forbidden by source. A reader that wants the answer imports it.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const RECRUITMENT = resolve(HERE, '..');
/** The resolver itself, and the specs that are ABOUT the disagreement, may write it out. */
const ALLOWED = ['phase-applicability.ts', 'applicability-single-source.spec.ts', 'phase-applicability.spec.ts'];

const sources = (): { name: string; text: string }[] => {
  const out: { name: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.ts') && !ALLOWED.includes(entry)) {
        out.push({ name: full.slice(RECRUITMENT.length + 1), text: readFileSync(full, 'utf8') });
      }
    }
  };
  walk(RECRUITMENT);
  return out;
};

/** CODE ONLY — the prose in `phase-applicability.ts`’s callers quotes the expression to explain it. */
const code = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');

describe('nobody in recruitment carries their own copy of the rule', () => {
  const FILES = sources();

  it('reads the feature at all', () => {
    expect(FILES.length).toBeGreaterThan(30);
  });

  /**
   * `applicability === 'driversOnly'` — the materializer's old expression, and the mapper's first
   * half. Written anywhere but the resolver, it is a second opinion about one fact.
   */
  it.each(FILES)('$name does not compare `applicability` itself', ({ text }) => {
    expect(code(text)).not.toMatch(/applicability\s*===\s*'driversOnly'/);
  });

  /**
   * `phase.driversOnly` as a CONDITION — the gate's old expression. Reading the field to WRITE it
   * (the catalogue keeps the alias in step) or to snapshot it for the audit log is not this.
   */
  it.each(FILES)('$name does not branch on the legacy flag', ({ text }) => {
    expect(code(text)).not.toMatch(/if\s*\(\s*[\w.]*\bdriversOnly\b/);
    expect(code(text)).not.toMatch(/\bdriversOnly\s*\?\s*'driversOnly'/);
  });
});
