// One applicant picker, and no second one.
//
// There were three. They were byte-identical apart from which search they called and which strings
// they showed, and they drifted anyway: two of them learned to lead their rows with the candidate's
// name while the third kept leading with `APP-2026-…` for a whole release. No test caught it and no
// test could have, because all three worked — the bug was that they disagreed.
//
// This is the same guard the branch filter carries, for the same reason: the realistic failure is
// not a bad edit but a well-meant local copy, and a copy is invisible to typecheck, lint and every
// behavioural test in the suite.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../../../../');
const DEFINITION = join(HERE, 'ApplicantPicker.tsx');

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return entry.name.endsWith('.tsx') && !entry.name.endsWith('.spec.tsx') ? [full] : [];
  });

const files = sources(SRC).map((path) => ({ path, text: readFileSync(path, 'utf8') }));

describe('the applicant picker has a single source', () => {
  it('is defined exactly once in the whole app', () => {
    const definitions = files
      .filter((f) => /export const ApplicantPicker\b/.test(f.text))
      .map((f) => relative(SRC, f.path));
    expect(definitions).toEqual([relative(SRC, DEFINITION)]);
  });

  it('is imported from that definition by every screen that renders it', () => {
    const renderers = files.filter((f) => f.text.includes('<ApplicantPicker') && f.path !== DEFINITION);
    // Screening + interview filters, the schedule and open-evaluation dialogs, evaluation filters,
    // and the create-offer form. If this shrinks, a screen either lost its picker or grew its own.
    expect(renderers.length).toBe(6);

    for (const file of renderers) {
      const importMatch = /import \{ ApplicantPicker \} from '([^']+)'/.exec(file.text);
      expect(importMatch, `${relative(SRC, file.path)} renders the picker without importing it`).not.toBeNull();
      const resolved = `${resolve(dirname(file.path), importMatch?.[1] ?? '')}.tsx`;
      expect(resolved, `${relative(SRC, file.path)} imports a different picker`).toBe(DEFINITION);
    }
  });

  it('keeps the per-stage differences as props, so a new stage never needs a new file', () => {
    const definition = readFileSync(DEFINITION, 'utf8');
    // Which applicants are searchable, what the box says, what "none" says, and how wide it is —
    // the four things that differed across the three copies.
    for (const prop of ['useSearch', 'placeholder', 'emptyLabel', 'className']) {
      expect(definition, `the picker stopped taking \`${prop}\``).toContain(`${prop}`);
    }
  });

  it('leaves each stage its own search, because a query key is cache identity', () => {
    // Three hooks, one per stage, still living beside the queries they belong to. Folding them
    // into the picker would have changed what each screen shares with what.
    const hooks = [
      'screening/api/screening-queries.ts',
      'interviews/api/interview-queries.ts',
      'job-offers/api/job-offer-queries.ts',
    ];
    for (const rel of hooks) {
      const text = readFileSync(join(SRC, 'modules/hr/recruitment', rel), 'utf8');
      expect(text, `${rel} lost its applicant search`).toContain('export const useApplicantSearch');
    }
  });
});
