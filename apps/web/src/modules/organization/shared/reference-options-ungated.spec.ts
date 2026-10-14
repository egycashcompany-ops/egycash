// Naming an org unit is not browsing the directory.
//
// Every screen in ECMS shows ids that belong to Branches, Departments, Sections and Job Titles, and
// every one of them has to turn an id into a name. There are two endpoints that can answer:
//
//   /platform/<unit>            the ADMINISTRATION list — `authorize('<unit>.view')`, scoped, paged
//   /platform/<unit>/options    {id, code, name, parentId} for active units — `authenticate` only
//
// Reading a NAME from the first one is the bug this file exists to prevent, and it shipped: Fleet's
// vehicle registry resolved «الفرع» through the gated list, so a user whose forty fleet grants
// reached the whole company read every branch's vehicles with a dash in the branch column, no
// branch filter to narrow them by, and a required branch picker on the add-vehicle form that
// offered nothing at all. Three screens over, the same mistake made the job-title picker on «تسجيل
// موظف مباشر» unsatisfiable, so the form could not be submitted by anyone lacking `jobTitle.view`.
//
// The failure is invisible to typecheck, to lint and to every render test that seeds its own cache
// — a disabled query still reads whatever is already cached, so a seeded spec renders the name the
// real screen cannot. It is only visible in the SHAPE of the call, which is what is asserted here.
//
// The rule: a `<unit>.view` grant may gate the screens that ADMINISTER org units. It may never gate
// reading a unit's name, filling a picker with units, or drawing a filter over them.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../../../');

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    if (!/\.tsx?$/.test(entry.name) || /\.spec\.tsx?$/.test(entry.name)) return [];
    return [full];
  });

const files = sources(SRC).map((path) => ({ name: relative(SRC, path), text: readFileSync(path, 'utf8') }));

/** The reference-options hooks — `/platform/<unit>/options`, which needs no permission at all. */
const OPTION_HOOKS = [
  'useBranchOptions',
  'useDepartmentOptions',
  'useDepartmentReferenceOptions',
  'useSectionOptions',
  'useSectionReferenceOptions',
  'useJobTitleReferenceOptions',
] as const;

describe('org-unit names and pickers never sit behind a <unit>.view grant', () => {
  it('never passes a permission check as the `enabled` flag of a reference-options hook', () => {
    // `useBranchOptions(can('branch.view'))` type-checks, lints clean and renders — and leaves the
    // filter drawn but empty, which reads as a broken control rather than a forbidden one.
    const gated = files.flatMap((file) =>
      OPTION_HOOKS.flatMap((hook) =>
        new RegExp(`${hook}\\([^)]*can\\(`).test(file.text) ? [`${file.name} → ${hook}`] : [],
      ),
    );
    expect(gated).toEqual([]);
  });

  it('reads org-unit names from the options endpoints, not the administration lists', () => {
    // The gated readers these replaced. They are gone; this keeps them gone, because the import
    // is the only trace a reviewer can see — the symptom is a dash in somebody else's screenshot.
    const gatedReaders = files.filter((file) =>
      /import \{[^}]*\buse(Branches|Departments)\b[^}]*\} from '[^']*job-offer-queries'/.test(file.text),
    );
    expect(gatedReaders.map((f) => f.name)).toEqual([]);
  });

  it('keeps the one reader that genuinely needs the gated list, and says why', () => {
    // `requiresDrivingTest` is not on an option — the drivers registry's membership IS that flag,
    // so this one question cannot be answered by `/options` and stays on the job-title list.
    const queries = files.find((f) => f.name.endsWith('job-offer-queries.ts'));
    expect(queries?.text).toContain('useDrivingJobTitles');
    expect(queries?.text).toContain('requiresDrivingTest');
  });

  it('draws the branch filter for every reader of the queue it sits on', () => {
    const filter = files.find((f) => f.name.endsWith('shared/BranchFilterSelect.tsx'));
    expect(filter, 'the shared branch filter moved').toBeDefined();
    // No permission check of any kind, and no `null` arm to hide it behind one.
    expect(filter?.text).not.toContain('can(');
    expect(filter?.text).toContain('}): JSX.Element => {');
    expect(filter?.text).toContain('useBranchOptions');
  });

  it('never wraps a branch filter in a `branch.view` check at its call site', () => {
    // Hiding the control is the other half of the same bug: the reader who most needs to narrow a
    // company-wide list is exactly the one who holds no organization grant.
    const wrapped = files.filter((file) => /\{can\('branch\.view'\) && \(/.test(file.text));
    expect(wrapped.map((f) => f.name)).toEqual([]);
  });
});
