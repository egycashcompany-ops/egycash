// D-B1-5, corrected — the concurrency guard, asserted where it is actually enforced.
//
// The guard is not a check this service performs; it is the shape of the write. `updateById` puts
// `__v: meta.version` inside the filter of one `findOneAndUpdate`, so a stale edit matches nothing
// and writes nothing — there is no window between a read and a write for a second editor to slip
// through, and no partial state a failed check could leave behind.
//
// These tests read the code rather than a database, and that is the honest level for the claim:
// what must be true is that this service HANDS the version to the base repository instead of
// checking it itself, comparing it beforehand, or writing around it. Whether MongoDB then honours
// an atomic filter is not this codebase's assertion to make.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { StaleDocumentError } from '../../../../shared/errors';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(resolve(HERE, rel), 'utf8');
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');

const SERVICE = stripComments(read('./report-definition.service.ts'));
const ROUTES = read('./report-definition.routes.ts');
const BASE = stripComments(read('../../../../shared/base/base.repository.ts'));

describe('the update goes through the base repository, carrying the caller’s version', () => {
  it('passes the version rather than checking it here', () => {
    expect(SERVICE).toContain('{ by, version: input.version }');
    // Not compared in the service: a comparison before the write is exactly the race the atomic
    // filter exists to remove.
    expect(SERVICE).not.toMatch(/version\s*!==/);
    expect(SERVICE).not.toMatch(/version\s*===/);
  });

  it('and never writes around it', () => {
    for (const bypass of [
      'ReportDefinitionModel',
      'findOneAndUpdate',
      'updateOne',
      'bulkWrite',
      'collection',
    ]) {
      expect(SERVICE, bypass).not.toContain(bypass);
    }
  });

  it('and there is no delete-and-recreate standing in for an edit', () => {
    const update = SERVICE.slice(SERVICE.indexOf('async update'), SERVICE.indexOf('async softDelete'));
    expect(update).not.toHaveLength(0);
    expect(update).not.toContain('softDelete');
    expect(update).not.toContain('create(');
  });
});

describe('the guard the base repository actually applies', () => {
  it('matches `__v` inside the update, so a stale write matches nothing', () => {
    const method = BASE.slice(BASE.indexOf('async updateById'), BASE.indexOf('async softDeleteById'));
    expect(method).toContain('__v: meta.version');
    expect(method).toContain('findOneAndUpdate');
    // One atomic write: no read-then-write, so no partial update is reachable on a failed match.
    expect((method.match(/findOneAndUpdate/g) ?? []).length).toBe(1);
  });

  it('raises the platform’s stale-document error, which is a 409', () => {
    const method = BASE.slice(BASE.indexOf('async updateById'), BASE.indexOf('async softDeleteById'));
    expect(method).toContain('throw new StaleDocumentError()');
    expect(new StaleDocumentError().httpStatus).toBe(409);
    expect(new StaleDocumentError().code).toBe('STALE_DOCUMENT');
  });

  it('and increments the version, so the next edit must state the new one', () => {
    const method = BASE.slice(BASE.indexOf('async updateById'), BASE.indexOf('async softDeleteById'));
    expect(method).toContain('$inc: { __v: 1 }');
  });
});

describe('what each route demands', () => {
  it('PATCH validates the update schema, which requires a version', () => {
    expect(ROUTES).toContain('UpdatePayrollReportDefinitionSchema');
    expect(ROUTES).toContain("router.patch(");
  });

  it('POST create and POST preview do not — neither replaces a stored row', () => {
    const create = ROUTES.slice(ROUTES.indexOf("router.post(\n    '/',"), ROUTES.indexOf("router.post(\n    '/preview'"));
    expect(create).not.toHaveLength(0);
    expect(create).not.toContain('UpdatePayrollReportDefinitionSchema');
  });

  it('and delete goes through the base repository too, with the platform’s own delete shape', () => {
    expect(SERVICE).toContain('softDeleteById(id, { by })');
    // `softDeleteById` takes no version anywhere in this system — stated, not hidden.
    const method = BASE.slice(BASE.indexOf('async softDeleteById'));
    expect(method.slice(0, method.indexOf('}'))).not.toContain('version');
  });
});
