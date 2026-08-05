// One branch filter, and no second one.
//
// The branch filter is rendered by four recruitment screens and by Fleet's vehicle registry. The
// failure mode is not that someone edits it badly — it is that someone reaching across a module
// boundary decides a local copy is tidier, and the two drift: one takes several branches, the other
// takes one; one hides itself without `branch.view`, the other shows an empty dropdown that
// silently filters nothing. That divergence is invisible to typecheck, lint and every runtime test,
// because both copies work.
//
// So the invariant is structural: exactly one definition, and every call site imports THAT one.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../../../../');
const DEFINITION = join(HERE, 'BranchFilterSelect.tsx');

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return entry.name.endsWith('.tsx') && !entry.name.endsWith('.spec.tsx') ? [full] : [];
  });

const files = sources(SRC).map((path) => ({ path, text: readFileSync(path, 'utf8') }));

describe('the branch filter has a single source', () => {
  it('is defined exactly once in the whole app', () => {
    const definitions = files
      .filter((f) => /export const BranchFilterSelect\b/.test(f.text))
      .map((f) => relative(SRC, f.path));
    expect(definitions).toEqual([relative(SRC, DEFINITION)]);
  });

  it('is imported from that definition by every screen that renders it', () => {
    const renderers = files.filter((f) => f.text.includes('<BranchFilterSelect') && f.path !== DEFINITION);
    // If the control ever stops being shared, this list is the first thing to shrink.
    expect(renderers.length).toBeGreaterThanOrEqual(4);

    for (const file of renderers) {
      const importMatch = /import \{ BranchFilterSelect \} from '([^']+)'/.exec(file.text);
      expect(importMatch, `${relative(SRC, file.path)} renders the filter without importing it`).not.toBeNull();
      const resolved = `${resolve(dirname(file.path), importMatch?.[1] ?? '')}.tsx`;
      expect(resolved, `${relative(SRC, file.path)} imports a different branch filter`).toBe(DEFINITION);
    }
  });

  it('takes a list of branches, so no call site can be stuck on a single value', () => {
    const definition = readFileSync(DEFINITION, 'utf8');
    expect(definition).toContain('value: readonly string[]');
    expect(definition).toContain('onChange: (branchIds: string[]) => void');
  });
});
