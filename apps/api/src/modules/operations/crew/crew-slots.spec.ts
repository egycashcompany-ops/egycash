// Reading a crew slot, and the rename that made the widening safe.
//
// THE TRAP THIS FILE GUARDS. The three crew slots used to be scalar ObjectIds. Widening them in
// place would have left every stored query working by accident — Mongo matches
// `{ captainEmployeeId: x }` against an ARRAY containing `x` exactly as it matches the scalar — so
// `findForCaptainDay`, the captaincy anchor of the whole mobile identity chain, would have gone on
// returning the right rows while every `String(row.captainEmployeeId) === employeeId` in
// TypeScript quietly returned false for a two-captain crew. Tests would have stayed green.
//
// The defence is that the fields were RENAMED and the retired ones un-mapped from the document, so
// reading them stops compiling. The last guard in this file is what keeps that true: prose about
// the old names is fine, code touching them is not.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { CREW_SLOT_CAPACITY } from '@ecms/contracts';
import { crewMembers, isCaptainOf, slotIds } from './crew-slots';

const HERE = dirname(fileURLToPath(import.meta.url));
const OPERATIONS = resolve(HERE, '..');

/** Code only — prose in these files must never satisfy an assertion. */
const code = (file: string): string =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '');

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return entry.name.endsWith('.ts') && !entry.name.includes('.spec.') ? [full] : [];
  });

const oid = (n: number): Types.ObjectId =>
  new Types.ObjectId(String(n).padStart(24, '0'));

const crew = (
  captains: number[] = [],
  s1: number[] = [],
  s2: number[] = [],
): {
  captainEmployeeIds: Types.ObjectId[];
  specialist1EmployeeIds: Types.ObjectId[];
  specialist2EmployeeIds: Types.ObjectId[];
} => ({
  captainEmployeeIds: captains.map(oid),
  specialist1EmployeeIds: s1.map(oid),
  specialist2EmployeeIds: s2.map(oid),
});

describe('slotIds', () => {
  it('reads a slot as ids in the order they were entered', () => {
    expect(slotIds([oid(1), oid(2)])).toEqual([String(oid(1)), String(oid(2))]);
  });

  it('answers [] for a slot the migration has not reached yet', () => {
    // `lean()` hands back raw BSON, so a row written before the slots became lists has no field at
    // all — whatever the document type promises. Boot order makes that window small, not empty.
    expect(slotIds(undefined)).toEqual([]);
  });

  it('answers [] for an empty slot — there is no null slot', () => {
    expect(slotIds([])).toEqual([]);
  });
});

describe('isCaptainOf — both captains are captains', () => {
  it('recognises the first captain', () => {
    expect(isCaptainOf(crew([1, 2]), String(oid(1)))).toBe(true);
  });

  it('recognises the SECOND captain identically — there is no deputy', () => {
    expect(isCaptainOf(crew([1, 2]), String(oid(2)))).toBe(true);
  });

  it('refuses someone who is on the row as a specialist', () => {
    expect(isCaptainOf({ captainEmployeeIds: [oid(1)] }, String(oid(9)))).toBe(false);
  });

  it('refuses everyone on a captainless row', () => {
    expect(isCaptainOf({ captainEmployeeIds: [] }, String(oid(1)))).toBe(false);
  });
});

describe('crewMembers — the Q11 traversal', () => {
  it('flattens all three slots, reaching the second occupant of each', () => {
    expect(crewMembers(crew([1, 2], [3, 4], [5, 6]))).toEqual(
      [1, 2, 3, 4, 5, 6].map((n) => String(oid(n))),
    );
  });

  it('a full crew is CREW_SLOT_CAPACITY per slot — six people on one vehicle', () => {
    expect(crewMembers(crew([1, 2], [3, 4], [5, 6]))).toHaveLength(3 * CREW_SLOT_CAPACITY);
  });

  it('skips empty slots rather than yielding a placeholder', () => {
    expect(crewMembers(crew([1], [], [6]))).toEqual([String(oid(1)), String(oid(6))]);
  });
});

describe('the retired scalar columns are unreachable from code', () => {
  const RETIRED = ['captainEmployeeId', 'specialist1EmployeeId', 'specialist2EmployeeId'];

  /**
   * `captainEmployeeId` is still a LIVE field on `operations_shipment_assignments` — a crew has two
   * captains, a leg has one — so the name alone is not the offence. What is forbidden is reading it
   * off a CREW row, and the crew module is where that would happen.
   */
  const CREW_OWNED = [
    resolve(OPERATIONS, 'crew/crew.service.ts'),
    resolve(OPERATIONS, 'crew/crew-assignment.repository.ts'),
    resolve(OPERATIONS, 'crew/crew-assignment.model.ts'),
    resolve(OPERATIONS, 'crew/crew-slots.ts'),
    resolve(OPERATIONS, 'crew/crew-requirements.service.ts'),
  ];

  /** A property READ of a retired column — `crew.captainEmployeeId`, not a parameter of that name. */
  const reads = (source: string): string[] =>
    RETIRED.filter((name) => new RegExp(`\\.${name}(?!s)`).test(source));

  it('no crew-owned source reads a retired column off a document', () => {
    for (const file of CREW_OWNED) {
      expect(reads(code(file)), file.slice(OPERATIONS.length + 1)).toEqual([]);
    }
  });

  it('the migration names all three, because converting them is its whole job', () => {
    const migration = code(resolve(OPERATIONS, 'operations.migration.ts'));
    for (const name of RETIRED) expect(migration, name).toContain(name);
  });

  it('no OTHER crew-facing source is left naming them at all', () => {
    // Outside the crew module `captainEmployeeId` is a LIVE field on a shipment assignment — a
    // crew has two captains, a leg has one — so this asks only about the crew module, where the
    // name can now mean nothing but the retired column.
    const named = sources(join(OPERATIONS, 'crew'))
      .filter((file) => RETIRED.some((name) => new RegExp(`${name}(?!s)`).test(code(file))))
      .map((file) => file.slice(OPERATIONS.length + 1));
    // `crew-assignment.repository.ts` names a PARAMETER `captainEmployeeId` — an employee id, not
    // the column — which is why the property-read guard above is the one that has teeth.
    expect(named).toEqual(['crew/crew-assignment.repository.ts']);
  });

  it('the model no longer maps them, so the compiler stops anyone reading them back', () => {
    const model = code(resolve(OPERATIONS, 'crew/crew-assignment.model.ts'));
    expect(model).toContain('captainEmployeeIds');
    // …and the multikey index moved with the field, under a NEW name: an index keeps its key spec
    // for its lifetime, so re-declaring `ix_day_captain` over a different field is a conflict.
    expect(model).toContain('ix_day_captains');
    expect(model).not.toContain("'ix_day_captain'");
  });

  it('the captaincy anchor queries the LIST, not the retired scalar', () => {
    const repository = code(resolve(OPERATIONS, 'crew/crew-assignment.repository.ts'));
    expect(repository).toContain('captainEmployeeIds: captainEmployeeId');
  });
});
