// Every repository declares its scope, with its reason (design §7.1; the payroll
// `department-scope-guards.spec.ts` shape).
//
// The defect this guards is invisible: `BaseRepository.scopeFilter` answers a scope whose field is
// undeclared with an EMPTY filter, so a branch record whose repository forgets `branchField` does
// not fail — it serves the whole organization to a branch-scoped reader. Nothing in the type system
// catches it, because the options are optional by design. So each repository of this module is
// listed here with the options §7.1 gives its collection, and must declare exactly those, on the
// `super(...)` line, followed by a comment that says why. A repository added without a line here
// fails the first test.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));

/** §7.1, one row per repository as each slice ships it. `{}`: master data, read whole. */
const REPOSITORIES = [
  {
    file: 'catalog/catalog-items/catalog-item.repository.ts',
    collection: 'administration_catalog_items',
    model: 'AdministrationCatalogItemModel',
    options: '{}',
  },
  {
    file: 'catalog/item-categories/item-category.repository.ts',
    collection: 'administration_item_categories',
    model: 'AdministrationItemCategoryModel',
    options: '{}',
  },
] as const;

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.repository.ts')) out.push(relative(HERE, full));
  }
  return out;
};

const read = (file: string): string => readFileSync(join(HERE, file), 'utf8');

/** The `super(Model, options); // reason` line of a repository, its parts named. */
const superCall = (source: string) => {
  const match = /super\((\w+),\s*(\{[^}]*\})\);[ \t]*\/\/[ \t]*(\S[^\n]*)/.exec(source);
  return match === null
    ? null
    : {
        model: match[1] ?? '',
        options: (match[2] ?? '').replace(/\s+/g, ' '),
        reason: match[3] ?? '',
      };
};

describe('every repository of the module is listed here, with its scope', () => {
  it('finds the repositories at all — a scan that matched nothing would pass', () => {
    expect(walk(HERE).length).toBeGreaterThan(0);
  });

  it('lists exactly the repositories the module has', () => {
    expect(walk(HERE).sort()).toEqual(REPOSITORIES.map((row) => row.file).sort());
  });

  it.each(REPOSITORIES)('$file declares §7.1’s options, with a reason', (row) => {
    const declared = superCall(read(row.file));
    expect(declared, 'super(Model, options); // reason — all on one line').not.toBeNull();
    expect(declared?.model).toBe(row.model);
    expect(declared?.options).toBe(row.options);
    expect(declared?.reason.length ?? 0, 'the comment says why').toBeGreaterThan(10);
  });

  it.each(REPOSITORIES)('$file wraps the model that writes $collection', (row) => {
    const modelFile = row.file.replace('.repository.ts', '.model.ts');
    expect(read(modelFile)).toMatch(new RegExp(`'${row.collection}',?\\s*\\)`));
  });
});

describe('master data is read whole (§7.1)', () => {
  const master = REPOSITORIES.filter((row) => row.options === '{}');

  it.each(master)('$file narrows by no scope field', (row) => {
    const source = read(row.file);
    for (const option of [
      'branchField',
      'departmentField',
      'sectionField',
      'ownerUserField',
      'hasAssignees',
    ]) {
      expect(source, option).not.toContain(option);
    }
  });

  it.each(master)('$file is never read under a caller’s scope selector', (row) => {
    // A selector on an unscoped repository narrows nothing for branch scope, and for `own` it
    // would read only the rows the caller created — not "the register".
    const service = read(row.file.replace('.repository.ts', '.service.ts'));
    expect(service).not.toContain('scopeSelector(');
  });
});
