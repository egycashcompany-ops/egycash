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
//
// Branch records (warehouses, P1a.3) go further: declaring `branchField` is not enough, because the
// base repository then WIDENS a department- or section-scoped grant to the whole company and reads
// `own` as its holder's rows. Their repositories answer every scoped read with the shared
// fail-closed rule instead (PC-12), which has no precedent inside a repository — so it is pinned
// here, with the service that must read through it and the department the row names but never
// narrows by (§7.7).
//
// Documents filed on a department copy (the purchase request, P2.2) are read by the base
// repository over three fields — the branch, the department copy and the requester (§7.1) — with
// one override: a `section` grant reads as `own`, since a request carries no section and the base
// would answer that grant with the whole organization (§7.3, RK-15).
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * §7.1, one row per repository as each slice ships it. `master`, options `{}`: read whole;
 * `branch`, options `{ branchField: 'branchId' }`: a branch record, read fail-closed (§7.2);
 * `document`: a document of a department copy, read over its branch, its copy and its requester.
 */
const REPOSITORIES = [
  {
    file: 'catalog/catalog-items/catalog-item.repository.ts',
    collection: 'administration_catalog_items',
    model: 'AdministrationCatalogItemModel',
    kind: 'master',
    options: '{}',
  },
  {
    file: 'catalog/item-categories/item-category.repository.ts',
    collection: 'administration_item_categories',
    model: 'AdministrationItemCategoryModel',
    kind: 'master',
    options: '{}',
  },
  {
    file: 'catalog/items/item.repository.ts',
    collection: 'administration_items',
    model: 'AdministrationItemModel',
    kind: 'master',
    options: '{}',
  },
  {
    file: 'procurement/suppliers/supplier.repository.ts',
    collection: 'administration_suppliers',
    model: 'AdministrationSupplierModel',
    kind: 'master',
    options: '{}',
  },
  {
    file: 'procurement/purchase-requests/purchase-request.repository.ts',
    collection: 'administration_purchase_requests',
    model: 'AdministrationPurchaseRequestModel',
    kind: 'document',
    options:
      "{ branchField: 'branchId', departmentField: 'departmentId', ownerUserField: 'requesterUserId', }",
  },
  {
    file: 'warehouses/warehouses/warehouse.repository.ts',
    collection: 'administration_warehouses',
    model: 'AdministrationWarehouseModel',
    kind: 'branch',
    options: "{ branchField: 'branchId' }",
  },
] as const;

/**
 * §7.7: every model that stamps `departmentId` either declares it as a scope axis or is listed
 * here as reference-only, with its reason. None declared it in Phase 1; the purchase request does
 * (P2.2), and its requester's snapshot carries one more, reference-only.
 */
const REFERENCE_ONLY_DEPARTMENTS = [
  {
    model: 'warehouses/warehouses/warehouse.model.ts',
    why: 'the owning department of a store grants nothing while OD-10 keeps it reference-only (i)',
  },
] as const;

/** §7.1: the models whose `departmentId` is a scope axis, with its reason. */
const DEPARTMENT_AXES = [
  {
    model: 'procurement/purchase-requests/purchase-request.model.ts',
    why: 'a request is filed on its requester’s department copy, and a department reader reads that copy',
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
  const master = REPOSITORIES.filter((row) => row.kind === 'master');

  it('declares no scope at all', () => {
    for (const row of master) expect(row.options, row.file).toBe('{}');
  });

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

describe('branch records are read fail-closed (§7.2)', () => {
  const branch = REPOSITORIES.filter((row) => row.kind === 'branch');

  it('there is one in Phase 1 — the warehouses', () => {
    expect(branch.map((row) => row.collection)).toEqual(['administration_warehouses']);
  });

  it.each(branch)('$file answers every scoped read with the shared rule', (row) => {
    const source = read(row.file);
    expect(source).toContain('protected override scopeFilter(');
    expect(source).toContain('return branchScopeMatch(selector)');
    // The rule is the shared one (PC-12), never ATM's copy or one of the module's own.
    expect(source).toContain(
      "import { branchScopeMatch } from '../../../../shared/base/branch-scope';",
    );
    expect(source).not.toMatch(/modules\/atm|orgScopeMatch\(/);
  });

  it.each(branch)('$file narrows by nothing but the branch', (row) => {
    const source = read(row.file);
    for (const option of ['departmentField', 'sectionField', 'ownerUserField', 'hasAssignees']) {
      expect(source, option).not.toContain(option);
    }
  });

  it.each(branch)('$file is read only under a selector for the key the act needs', (row) => {
    const service = read(row.file.replace('.repository.ts', '.service.ts'));
    // Every scoped read and the edit's write name the key's own selector, never a widest one.
    expect(service).not.toContain('widestScopeSelector');
    expect(service).toMatch(/repository\.findById\(id, scopeSelector\(ctx, VIEW\)\)/);
    expect(service).toMatch(
      /const scope = scopeSelector\(ctx, EDIT\);\s*const before = await repository\.findById\(id, scope\);/,
    );
    expect(service).toMatch(/version: input\.version,\s*scope,/);
    // The list's browser branch only narrows, inside that reach.
    expect(service).toContain('narrowToBranch(scope, branchId)');
    // Writes ask the key's reach over the branch: the body's on a create, the row's on an edit.
    expect(service).toContain('keyReachesBranch(ctx, CREATE, branchId)');
    expect(service).toContain('keyReachesBranch(ctx, EDIT, branchId)');
  });

  it.each(branch)('$file writes its branch once, at the create, and never on an edit', (row) => {
    const service = read(row.file.replace('.repository.ts', '.service.ts'));
    const update = service.slice(service.indexOf('  async update('));
    expect(update.length, 'the scan found the edit').toBeGreaterThan(100);
    expect(update.slice(0, update.indexOf('\n  }\n'))).not.toMatch(/set\.branchId|branchId: new/);
    expect(service.match(/branchId: new Types\.ObjectId\(branchId\)/g)).toHaveLength(1);
  });
});

describe('documents of a department copy (§7.1, §7.3; P2.2)', () => {
  const documents = REPOSITORIES.filter((row) => row.kind === 'document');

  it('there is one so far — the purchase request', () => {
    expect(documents.map((row) => row.collection)).toEqual(['administration_purchase_requests']);
  });

  it.each(documents)(
    '$file reads a section grant as own, and every other scope as the base does',
    (row) => {
      const source = read(row.file);
      expect(source).toContain('protected override scopeFilter(');
      expect(source).toMatch(
        /if \(selector\?\.scope === 'section'\) return super\.scopeFilter\(\{ \.\.\.selector, scope: 'own' \}\);\s*return super\.scopeFilter\(selector\);/,
      );
      // Not the branch rule: a department copy reads its copy, not its whole branch, and `own` reads
      // the caller's own requests (§7.3).
      expect(source).not.toContain('branchScopeMatch');
    },
  );

  it.each(documents)('$file is read only under a selector for the key the act needs', (row) => {
    const service = read(row.file.replace('.repository.ts', '.service.ts'));
    expect(service).not.toContain('widestScopeSelector');
    // The register under `.view`; the record under each held key in turn; the edit under `.edit`.
    expect(service).toMatch(/const scope = scopeSelector\(ctx, VIEW\);/);
    expect(service).toMatch(
      /for \(const key of \[VIEW, APPROVE\]\) \{\s*if \(!hasPermission\(ctx, key\)\) continue;\s*const doc = await repository\.findById\(id, scopeSelector\(ctx, key\)\);/,
    );
    expect(service).toMatch(
      /const scope = scopeSelector\(ctx, EDIT\);\s*const before = await repository\.findById\(id, scope\);/,
    );
    expect(service).toMatch(/version: input\.version,\s*scope,/);
    // Writes ask the key's coverage of the request's Unit — its branch AND its department copy.
    expect(service).toContain('keyCoversUnit(ctx, CREATE, branchId, copyId)');
    expect(service).toContain(
      'keyCoversUnit(ctx, EDIT, String(before.branchId), String(before.departmentId))',
    );
  });

  it.each(documents)('$file writes its branch and department once, at the create', (row) => {
    const service = read(row.file.replace('.repository.ts', '.service.ts'));
    const update = service.slice(service.indexOf('  async update('));
    const body = update.slice(0, update.indexOf('\n  }\n'));
    expect(body.length, 'the scan found the edit').toBeGreaterThan(100);
    expect(body).not.toMatch(
      /set\.(branchId|departmentId|requesterUserId)|branchId: new|departmentId: new Types/,
    );
  });
});

describe('a department a row names is reference-only unless it is a scope axis (§7.7; OD-10 department (i))', () => {
  it('lists every model of the module that stamps `departmentId`', () => {
    const models = REPOSITORIES.map((row) => row.file.replace('.repository.ts', '.model.ts'));
    const stamping = models.filter((model) => read(model).includes('departmentId:'));
    expect(stamping.sort()).toEqual(
      [...REFERENCE_ONLY_DEPARTMENTS, ...DEPARTMENT_AXES].map((row) => row.model).sort(),
    );
  });

  it.each(DEPARTMENT_AXES)('$model is a declared scope axis, with its reason', (row) => {
    expect(read(row.model.replace('.model.ts', '.repository.ts'))).toContain(
      "departmentField: 'departmentId'",
    );
    expect(row.why.length).toBeGreaterThan(20);
    // A scalar the org merge sweeps by name (§7.7), and the snapshot's copy is reference-only.
    expect(read(row.model)).toContain(
      'departmentId: { type: Schema.Types.ObjectId, required: true }',
    );
    expect(read(row.model)).toContain(
      'departmentId: { type: Schema.Types.ObjectId, default: null }',
    );
  });

  it.each(REFERENCE_ONLY_DEPARTMENTS)('$model is no scope axis, with its reason', (row) => {
    expect(read(row.model.replace('.model.ts', '.repository.ts'))).not.toContain('departmentField');
    expect(row.why.length).toBeGreaterThan(20);
  });

  it.each(REFERENCE_ONLY_DEPARTMENTS)('$model holds it as a scalar the org merge sweeps', (row) => {
    // Named exactly `departmentId`, an ObjectId outside any array or `Mixed` (§15.3.4).
    expect(read(row.model)).toContain(
      'departmentId: { type: Schema.Types.ObjectId, default: null }',
    );
  });
});
