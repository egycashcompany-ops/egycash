// The owner's second workshop export, compared with the first and decided field by field — on
// rows, with no database: what the new export adds and changes, which rule each change meets on
// ECMS, and exactly what it adds and changes on the real book.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { parseVisits, planMaintenanceImport, type ParsedVisit } from './maintenance-import';
import {
  bookKeysOf,
  catalogWord,
  changedFields,
  decideSyncChange,
  decideVisitChange,
  ecmsKeyOf,
  partsKey,
  planMaintenanceSync,
  plannedDeleted,
  SYNC_FIELDS,
  updateFor,
  type EcmsVisit,
  type ResolvedNext,
  type SyncNames,
  type VisitChange,
} from './maintenance-sync-import';
import {
  MAINTENANCE_SYNC_GO_LIVE_MARK,
  MAINTENANCE_SYNC_NEW_FILE,
  MAINTENANCE_SYNC_OLD_FILE,
} from './maintenance-sync';
import { resolveGoLiveDataDir } from './vehicles';
import { parseCars } from './vehicles-import';

/** One legacy row in the export's own shape. */
const legacy = (over: Record<string, unknown>) => ({
  _id: { $oid: String(over['_id'] ?? '6aa65d669b4450de756c8705') },
  in_date: '2026-09-13',
  out_date: null,
  car_code: '507',
  driver: 'محمد عبد الله محمد عبد المحسن',
  driver2: '',
  destination: 'مصنع قادر',
  works: 'إصلاح',
  spare_parts: [],
  notes: '',
  counter: '',
  added_by: 'naser',
  out_by: null,
  deleted: 0,
  deleted_by: null,
  deleted_date: null,
  __v: 0,
  ...over,
});

describe('the three-way rule', () => {
  it('applies the new value where ECMS still holds what the import wrote from the old export', () => {
    expect(decideSyncChange('2025-12-21', ['2025-12-21'], ['2026-09-20'])).toBe('apply');
    // An open visit the import left open is closed by the book that closed it.
    expect(decideSyncChange(null, [null], ['2026-09-22'])).toBe('apply');
  });

  it('counts a field ECMS already carries the new value of — a person made it, or an earlier attempt did', () => {
    expect(decideSyncChange('2026-09-22', [null], ['2026-09-22'])).toBe('alreadyThere');
    expect(decideSyncChange(null, ['live'], [null])).toBe('alreadyThere');
  });

  it('KEEPS a value somebody typed on ECMS since the import — never overwritten', () => {
    // Somebody checked the car out on the new screen, a day earlier than the old system says.
    expect(decideSyncChange('2026-09-21', [null], ['2026-09-22'])).toBe('keptEcmsEdit');
    expect(decideSyncChange('ضبط', ['محرك'], ['محرك - متابعة السمكرة'])).toBe('keptEcmsEdit');
  });

  it('a driver is the employee HR knows by the spelling OR the spelling kept as text — either proves it', () => {
    const next = ['employee:e1', 'name:اسلام اشرف'];
    expect(decideSyncChange('employee:e1', [null], next)).toBe('alreadyThere');
    expect(decideSyncChange('name:اسلام اشرف', [null], next)).toBe('alreadyThere');
    // Another employee checked it out on ECMS: theirs.
    expect(decideSyncChange('employee:e2', [null], next)).toBe('keptEcmsEdit');
    // HR has learned the old spelling since the import kept it as text: still untouched.
    expect(decideSyncChange('name:احمد', ['employee:e3', 'name:احمد'], next)).toBe('apply');
  });

  it('two spellings of one employee are no change at all — nothing is counted, nothing written', () => {
    expect(
      decideSyncChange(
        'anything',
        ['employee:e1', 'name:اشرف نصحى'],
        ['employee:e1', 'name:أشرف نصحي'],
      ),
    ).toBe('unchanged');
  });

  it('the counter the book left blank is untouched while ECMS holds either stand-in the import could have written', () => {
    expect(decideSyncChange('99000', ['99000', '99500'], ['99860'])).toBe('apply');
    expect(decideSyncChange('99500', ['99000', '99500'], ['99860'])).toBe('apply');
    expect(decideSyncChange('0', ['0'], ['99860'])).toBe('apply');
    expect(decideSyncChange('99700', ['99000', '99500'], ['99860'])).toBe('keptEcmsEdit');
    // With no stand-in to compare with, nothing proves the field untouched.
    expect(decideSyncChange('99000', [], ['99860'])).toBe('keptEcmsEdit');
  });

  it('a word ECMS has no row for proves nothing — and a new word not created yet is still applied', () => {
    expect(decideSyncChange('id-renamed', [undefined], ['id-new'])).toBe('keptEcmsEdit');
    expect(decideSyncChange(undefined, [undefined], ['x'])).toBe('keptEcmsEdit');
    expect(decideSyncChange('id-old', ['id-old'], [undefined])).toBe('apply');
  });

  it('a stand-in the import MIGHT have written that equals the new counter proves nothing — ECMS is still read', () => {
    // The chain now has a reading equal to the book's new counter, but the import wrote 99000.
    const standIns = ['99000', '99860'];
    expect(decideSyncChange('99000', standIns, ['99860'], false)).toBe('apply');
    expect(decideSyncChange('99860', standIns, ['99860'], false)).toBe('alreadyThere');
    expect(decideSyncChange('99700', standIns, ['99860'], false)).toBe('keptEcmsEdit');
    // …where for one value in several forms, a shared form IS no change.
    expect(decideSyncChange('99000', standIns, ['99860'])).toBe('unchanged');
  });

  it('asks «already there» before «apply» — a field equal to both sides is counted, never written', () => {
    expect(decideSyncChange('x', ['x'], ['x'])).toBe('unchanged');
    expect(decideSyncChange('x', ['x', 'y'], ['x'])).toBe('unchanged');
  });
});

describe('comparing the two exports', () => {
  it('a row only the new export has is ADDED; a row both have and the new one changes is a change', () => {
    const plan = planMaintenanceSync(
      [legacy({})],
      [
        legacy({
          out_date: '2026-09-22',
          driver2: 'مروان احمد خيرى ابو سريع ',
          out_by: 'mohamed hussein',
        }),
        legacy({ _id: '6aab7fb79b4450de756cb2bd', car_code: '296', in_date: '2026-09-16' }),
      ],
    );
    expect(plan.rows).toBe(2);
    expect(plan.added.map((visit) => [visit.id, visit.code])).toEqual([
      ['6aab7fb79b4450de756cb2bd', '296'],
    ]);
    expect(
      plan.changes.map((change) => [
        change.id,
        change.code,
        change.date,
        change.fields,
        change.slot,
      ]),
    ).toEqual([['6aa65d669b4450de756c8705', '507', '2026-09-13', ['outDate', 'driverOut'], 0]]);
    expect(plan.changes[0]?.columns.sort()).toEqual(['driver2', 'out_by', 'out_date']);
    expect(plan.columnsChanged).toEqual({ out_date: 1, driver2: 1, out_by: 1 });
    expect(plan.inExport).toEqual({ outDate: 1, driverOut: 1 });
    expect(plan.goneFromExport).toEqual([]);
    expect(plan.rejected).toEqual([]);
  });

  it('what the old system tidied is not a change: a spelling folded alike, the parts reordered, «-» for nobody', () => {
    const plan = planMaintenanceSync(
      [legacy({ works: 'صيانه', spare_parts: ['زيت', 'فلتر زيت'], driver2: '-' })],
      [legacy({ works: 'صيانة', spare_parts: ['فلتر زيت', 'زيت', 'زيت'], driver2: '' })],
    );
    expect(plan.changes).toEqual([]);
    expect(plan.columnsChanged, 'the export still says what moved').toEqual({
      works: 1,
      spare_parts: 1,
      driver2: 1,
    });
    expect(plan.inExport).toEqual({});
  });

  it('a column that does not travel — `out_by` — is counted and changes nothing', () => {
    const plan = planMaintenanceSync([legacy({})], [legacy({ out_by: 'mohamed hussein' })]);
    expect(plan.changes).toEqual([]);
    expect(plan.columnsChanged).toEqual({ out_by: 1 });
  });

  it('a row the old book has now deleted is a change to `deleted`; one it has restored is too', () => {
    const plan = planMaintenanceSync(
      [
        legacy({}),
        legacy({ _id: 'b', deleted: 1, deleted_date: { $date: '2026-09-14T05:55:08.981Z' } }),
      ],
      [
        legacy({ deleted: 1, deleted_date: { $date: '2026-09-20T08:00:00.000Z' } }),
        legacy({ _id: 'b' }),
      ],
    );
    expect(plan.changes.map((change) => [change.id, change.fields])).toEqual([
      ['6aa65d669b4450de756c8705', ['deleted']],
      ['b', ['deleted']],
    ]);
  });

  it('several old rows under one car, day, workshop and work are told apart by their place in the planner’s order', () => {
    // Car 507 on 13 September, twice — the live visit and the one the old system deleted a day
    // later. The import wrote them in id order, so the first is the first visit under that key.
    const twin = legacy({ _id: '6aa786249b4450de756c8b22', deleted: 1, notes: 'ضبط أبواب' });
    const plan = planMaintenanceSync(
      [twin, legacy({})],
      [legacy({ notes: 'x' }), { ...twin, notes: 'ضبط أبواب وزجاج' }],
    );
    expect(plan.changes.map((change) => [change.id, change.slot])).toEqual([
      ['6aa65d669b4450de756c8705', 0],
      ['6aa786249b4450de756c8b22', 1],
    ]);
  });

  it('every shared row CLAIMS its visit — as the new export has it, under the car the import filed it by', () => {
    const plan = planMaintenanceSync(
      [legacy({}), legacy({ _id: 'moved', car_code: '161' })],
      [
        legacy({ out_date: '2026-09-22' }),
        legacy({ _id: 'moved', car_code: '162' }),
        legacy({ _id: 'new', car_code: '161' }),
      ],
    );
    expect([...plan.claimed].map(([code, visits]) => [code, visits.map((v) => v.id)])).toEqual([
      ['507', ['6aa65d669b4450de756c8705']],
      ['161', ['moved']],
    ]);
    expect(plan.claimed.get('507')?.[0]?.outDate, 'the new version').toEqual(
      new Date('2026-09-22T00:00:00.000Z'),
    );
    expect(plan.changes.find((change) => change.id === 'moved')?.fields).toEqual(['car']);
  });

  it('REPORTS a row only the old export had — nothing is deleted because an export left it out', () => {
    const plan = planMaintenanceSync(
      [legacy({}), legacy({ _id: 'gone', car_code: '161' })],
      [legacy({})],
    );
    expect(plan.goneFromExport).toEqual(['161 2026-09-13']);
    expect(plan.changes).toEqual([]);
  });

  it('a new row the old system had deleted arrives deleted, and one it cannot read is named', () => {
    const plan = planMaintenanceSync(
      [legacy({})],
      [
        legacy({}),
        legacy({ _id: 'd', deleted: 1, deleted_date: { $date: '2026-09-17T08:00:00.000Z' } }),
        legacy({ _id: 'u', out_date: '6/4/20205' }),
      ],
    );
    expect(plan.keptDeleted).toBe(1);
    expect(plan.unreadable).toEqual([
      { id: 'u', reason: '507 2026-09-13: the out-date cannot be read' },
    ]);
  });

  it('refuses to compare a file that is not a list, or one that names a row twice', () => {
    expect(planMaintenanceSync({}, [legacy({})]).rejected).toEqual([
      { file: 'old', id: 'file', reason: 'the export is not a JSON array' },
    ]);
    expect(planMaintenanceSync([legacy({})], [legacy({}), legacy({})]).rejected).toEqual([
      {
        file: 'new',
        id: '6aa65d669b4450de756c8705',
        reason: 'the same row id twice — the two exports are compared by it',
      },
    ]);
  });

  it('refuses a row with no id of its own — its place in one file is another row in the other', () => {
    const nameless: Record<string, unknown> = legacy({});
    delete nameless['_id'];
    expect(planMaintenanceSync([legacy({}), nameless], [legacy({})]).rejected).toEqual([
      { file: 'old', id: 'row 1', reason: 'no row id — the two exports are compared by it' },
    ]);
  });

  it('names every changed field in the visit form’s order', () => {
    const [old, next] = [
      parseVisits([legacy({})]).visits[0] as ParsedVisit,
      parseVisits([
        legacy({
          car_code: '508',
          in_date: '2026-09-14',
          out_date: '2026-09-22',
          destination: 'mcv',
          works: 'صيانة',
          spare_parts: ['زيت'],
          counter: '99860',
          driver: 'احمد',
          driver2: 'مروان',
          notes: 'x',
          deleted: 1,
        }),
      ]).visits[0] as ParsedVisit,
    ];
    expect(changedFields(old, next)).toEqual([...SYNC_FIELDS]);
  });
});

// A catalog and a registry with stable ids, so a visit can be «written» the way the import writes it.
const ids = new Map<string, string>();
const idOf = (key: string): string => {
  if (!ids.has(key)) ids.set(key, new Types.ObjectId().toHexString());
  return ids.get(key) as string;
};
const DRIVERS = new Map(
  [['اسلام اشرف', 'e1']].map(([name, id]) => [name as string, idOf(id as string)]),
);
const names: SyncNames = {
  catalogId: (kind, name) => idOf(`${kind}:${catalogWord(name)}`),
  driverIds: DRIVERS,
};
const AT = new Date('2026-09-29T10:00:00.000Z');
const resolvedFor = (visit: ParsedVisit, standIn: number): ResolvedNext => ({
  workshopId: names.catalogId('workshop', visit.workshop) as string,
  workTypeId: names.catalogId('workType', visit.workType) as string,
  sparePartIds: visit.parts.map((part) => names.catalogId('sparePart', part) as string),
  counter: standIn,
});
/** The visit exactly as the import writes it from a row — every field through `updateFor`. */
const written = (visit: ParsedVisit, standIn: number): EcmsVisit =>
  ({
    vehicleId: new Types.ObjectId(),
    vehicleCode: null,
    ...updateFor(SYNC_FIELDS, visit, resolvedFor(visit, standIn), DRIVERS, AT),
  }) as EcmsVisit;
/** The same visit with a change applied on top — what this step writes. */
const applied = (visit: EcmsVisit, change: VisitChange, standIn: number): EcmsVisit =>
  ({
    ...visit,
    ...updateFor(change.fields, change.next, resolvedFor(change.next, standIn), DRIVERS, AT),
  }) as EcmsVisit;

describe('ECMS’s side, and what is written', () => {
  const [visit] = parseVisits([
    legacy({
      out_date: '2026-09-22',
      spare_parts: ['فلتر جاز', 'زيت'],
      counter: '99860',
      driver2: 'اسلام اشرف',
      notes: ' محرك ',
    }),
  ]).visits as [ParsedVisit];

  it('reads every field the way the rule compares it — days, catalog ids, a set of parts, drivers, text', () => {
    const doc = written(visit, 0);
    expect(
      Object.fromEntries(SYNC_FIELDS.filter((f) => f !== 'car').map((f) => [f, ecmsKeyOf(doc, f)])),
    ).toEqual({
      inDate: '2026-09-13',
      outDate: '2026-09-22',
      workshop: idOf(`workshop:${catalogWord('مصنع قادر')}`),
      workType: idOf(`workType:${catalogWord('إصلاح')}`),
      spareParts: partsKey([
        idOf(`sparePart:${catalogWord('زيت')}`),
        idOf(`sparePart:${catalogWord('فلتر جاز')}`),
      ]),
      counter: '99860',
      driverIn: 'name:محمد عبد الله محمد عبد المحسن',
      driverOut: `employee:${idOf('e1')}`,
      notes: 'محرك',
      deleted: 'live',
    });
  });

  it('the book’s side names the same things the same way — so a visit the import wrote reads as the row it came from', () => {
    const doc = written(visit, 0);
    for (const field of SYNC_FIELDS.filter((f) => f !== 'car')) {
      expect(bookKeysOf(visit, field, names, []), field).toContain(ecmsKeyOf(doc, field));
    }
  });

  it('a visit written before the parts existed reads as none, not as a crash', () => {
    const doc = { ...written(visit, 0), sparePartIds: undefined } as unknown as EcmsVisit;
    expect(ecmsKeyOf(doc, 'spareParts')).toBe('');
  });

  it('writes the applied fields ONLY, each exactly as the import writes it', () => {
    const [before] = parseVisits([legacy({})]).visits as [ParsedVisit];
    const [after] = parseVisits([
      legacy({
        out_date: '2026-09-20',
        driver2: 'مروان',
        spare_parts: ['زيت'],
        counter: '',
        deleted: 1,
        deleted_date: { $date: '2026-09-25T08:00:00.000Z' },
      }),
    ]).visits as [ParsedVisit];
    expect(
      updateFor(changedFields(before, after), after, resolvedFor(after, 12345), DRIVERS, AT),
    ).toEqual({
      outDate: new Date('2026-09-20T00:00:00.000Z'),
      sparePartIds: [new Types.ObjectId(idOf(`sparePart:${catalogWord('زيت')}`))],
      driverOutEmployeeId: null,
      driverOutName: 'مروان',
      isDeleted: true,
      deletedAt: new Date('2026-09-25T08:00:00.000Z'),
      deletedBy: null,
    });
    // A counter the new export leaves blank takes the stand-in, as the import's would.
    expect(updateFor(['counter'], after, { counter: 12345 }, DRIVERS, AT)).toEqual({
      odometerAtService: 12345,
    });
    // A deletion the book did not date is stamped with «now».
    const [undated] = parseVisits([legacy({ deleted: 1 })]).visits as [ParsedVisit];
    expect(updateFor(['deleted'], undated, {}, DRIVERS, AT)).toMatchObject({
      isDeleted: true,
      deletedAt: AT,
    });
    // A restore brings the base fields back to a live row's.
    expect(updateFor(['deleted'], before, {}, DRIVERS, AT)).toEqual({
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
    });
    expect(updateFor(['car'], after, {}, DRIVERS, AT), 'a car is never moved').toEqual({});
  });
});

describe('the two real exports', () => {
  const dir = resolveGoLiveDataDir() as string;
  const oldRaw: unknown = JSON.parse(readFileSync(join(dir, MAINTENANCE_SYNC_OLD_FILE), 'utf8'));
  const newRaw: unknown = JSON.parse(readFileSync(join(dir, MAINTENANCE_SYNC_NEW_FILE), 'utf8'));
  const plan = planMaintenanceSync(oldRaw, newRaw);
  const byId = new Map(plan.changes.map((change) => [change.id, change]));

  it('both read cleanly — 1,938 rows then, 1,981 now, and not one of the old ones missing', () => {
    expect(parseVisits(oldRaw).visits).toHaveLength(1938);
    expect(plan.rows).toBe(1981);
    expect(plan.rejected).toEqual([]);
    expect(plan.goneFromExport).toEqual([]);
    expect(
      [...plan.claimed.values()].reduce((sum, visits) => sum + visits.length, 0),
      'every old row claims its visit',
    ).toBe(1938);
  });

  it('adds 43 visits, 16 to 29 September — one of them already deleted in the old system, none unreadable', () => {
    expect(plan.added).toHaveLength(43);
    const days = plan.added.map((visit) => visit.inDate.toISOString().slice(0, 10)).sort();
    expect([days[0], days[days.length - 1]]).toEqual(['2026-09-16', '2026-09-29']);
    expect(plan.keptDeleted).toBe(1);
    expect(plan.added.filter(plannedDeleted).map((v) => [v.id, v.code])).toEqual([
      ['6aab9dd19b4450de756cba93', '300'],
    ]);
    expect(plan.unreadable).toEqual([]);
  });

  it('changes ten rows — in the export’s own columns: 9 out-dates, 7 out_by, 7 driver2, 3 spare_parts, 1 counter, 1 notes', () => {
    expect(plan.changes).toHaveLength(10);
    expect(plan.columnsChanged).toEqual({
      out_date: 9,
      out_by: 7,
      driver2: 7,
      spare_parts: 3,
      counter: 1,
      notes: 1,
    });
  });

  it('…which is, on the visits: 9 days out, 7 drivers out, 3 parts lists, 1 counter, 1 note — `out_by` does not travel', () => {
    expect(plan.inExport).toEqual({
      outDate: 9,
      driverOut: 7,
      spareParts: 3,
      counter: 1,
      notes: 1,
    });
    expect(plan.changes.map((change) => [change.code, change.date, change.fields])).toEqual([
      ['269', '2025-11-17', ['outDate']],
      ['151', '2026-08-04', ['outDate', 'driverOut']],
      ['188', '2026-07-14', ['outDate', 'driverOut']],
      ['161', '2026-08-18', ['notes']],
      ['295', '2026-09-09', ['outDate', 'spareParts']],
      ['166', '2026-09-10', ['outDate', 'driverOut']],
      ['507', '2026-09-13', ['outDate', 'driverOut']],
      ['501', '2026-09-15', ['outDate', 'counter', 'driverOut']],
      ['527', '2026-09-16', ['outDate', 'spareParts', 'driverOut']],
      ['247', '2026-09-16', ['outDate', 'spareParts', 'driverOut']],
    ]);
  });

  it('seven of the nine close a visit the old book had open; two move a day out it had already written', () => {
    const outDates = plan.changes
      .filter((change) => change.fields.includes('outDate'))
      .map((change) => [
        change.code,
        change.old.outDate?.toISOString().slice(0, 10) ?? null,
        change.next.outDate?.toISOString().slice(0, 10),
      ]);
    expect(outDates).toEqual([
      ['269', '2025-12-21', '2026-09-20'],
      ['151', null, '2026-09-22'],
      ['188', null, '2026-09-21'],
      ['295', '2026-09-10', '2026-09-20'],
      ['166', null, '2026-09-14'],
      ['507', null, '2026-09-22'],
      ['501', null, '2026-09-20'],
      ['527', null, '2026-09-16'],
      ['247', null, '2026-09-21'],
    ]);
    // None of them leaves before it went in, and none reopens a visit.
    expect(
      plan.changes.every(
        (change) => change.next.outDate === null || change.next.outDate >= change.next.inDate,
      ),
    ).toBe(true);
    expect(
      plan.changes.every((change) => change.old.outDate === null || change.next.outDate !== null),
    ).toBe(true);
    // The 161 visit is still open, with the note extended.
    expect(byId.get('6a84636c97ddad125adb59bb')?.next.notes).toBe('محرك - متابعة السمكرة');
  });

  it('507 on 13 September is the FIRST of its two rows under one key — the other is the one the old system deleted', () => {
    expect(byId.get('6aa65d669b4450de756c8705')?.slot).toBe(0);
    const every = plan.changes.filter((change) => change.id !== '6aa65d669b4450de756c8705');
    expect(
      every.every((change) => change.slot === 0),
      'every other change is alone under its key',
    ).toBe(true);
  });

  it('the one counter is car 501’s, written in where the old book had none', () => {
    const change = byId.get('6aa916499b4450de756c96c3');
    expect([change?.old.counter, change?.next.counter]).toEqual([null, 99860]);
  });

  it('the new rows plan cleanly with the import’s own planner — every car known, none in two workshops', () => {
    const cars = parseCars(JSON.parse(readFileSync(join(dir, 'cars.json'), 'utf8')));
    const registry = new Map(
      cars.cars.map((car, index) => [car.code, index.toString(16).padStart(24, '0')]),
    );
    const added = planMaintenanceImport(plan.added, registry, new Map());
    expect(added.unknownCars).toEqual([]);
    expect(added.outBeforeIn).toEqual([]);
    expect(added.deleted).toBe(1);
    expect(added.vehicles).toHaveLength(36);
    expect(added.blanks).toEqual({ workshop: 0, workType: 0 });
    for (const vehicle of added.vehicles) {
      const open = vehicle.visits.filter((visit) => !visit.deleted && visit.outDate === null);
      expect(
        open.length,
        `${vehicle.code}: at most one open visit — ux_open_visit`,
      ).toBeLessThanOrEqual(1);
    }
    expect(
      added.vehicles
        .flatMap((v) =>
          v.visits.filter((visit) => !visit.deleted && visit.outDate === null).map(() => v.code),
        )
        .sort(),
    ).toEqual(['271', '273', '280', '297', '502', '504', '506']);
  });

  it('no new row shares a car, day, workshop and work with an old one — nothing is claimed away from it', () => {
    const keyOf = (visit: ParsedVisit): string =>
      [
        visit.code,
        visit.inDate.toISOString(),
        catalogWord(visit.workshop),
        catalogWord(visit.workType),
      ].join('|');
    const old = new Set([...plan.claimed.values()].flat().map(keyOf));
    expect(plan.added.filter((visit) => old.has(keyOf(visit)))).toEqual([]);
  });

  describe('each real change, against ECMS', () => {
    const STAND_IN = 99000;
    const decide = (change: VisitChange, visit: EcmsVisit) =>
      decideVisitChange(change, visit, names, { old: [STAND_IN], next: [] }).map((d) => [
        d.field,
        d.decision,
      ]);

    it('where ECMS still holds what the import wrote, every field is APPLIED', () => {
      for (const change of plan.changes) {
        expect(decide(change, written(change.old, STAND_IN)), change.id).toEqual(
          change.fields.map((f) => [f, 'apply']),
        );
      }
    });

    it('once applied, every field reads as ALREADY THERE — a take-over writes nothing twice', () => {
      for (const change of plan.changes) {
        const once = applied(written(change.old, STAND_IN), change, STAND_IN);
        expect(decide(change, once), change.id).toEqual(
          change.fields.map((f) => [f, 'alreadyThere']),
        );
      }
    });

    it('a visit somebody checked out on ECMS keeps THEIR day and THEIR driver — listed, never overwritten', () => {
      const change = byId.get('6a771c24220af001debe4148') as VisitChange; // 151, out 2026-09-22
      const typed = {
        ...written(change.old, STAND_IN),
        outDate: new Date('2026-09-21T00:00:00.000Z'),
        driverOutEmployeeId: new Types.ObjectId(idOf('someone-else')),
      } as EcmsVisit;
      expect(decide(change, typed)).toEqual([
        ['outDate', 'keptEcmsEdit'],
        ['driverOut', 'keptEcmsEdit'],
      ]);
    });

    it('…and one checked out on the same day by the same employee is already there', () => {
      const change = byId.get('6aa2acdde1445148b81e89b7') as VisitChange; // 166, out 2026-09-14, «اسلام اشرف»
      const typed = {
        ...written(change.old, STAND_IN),
        outDate: new Date('2026-09-14T00:00:00.000Z'),
        driverOutEmployeeId: new Types.ObjectId(idOf('e1')),
      } as EcmsVisit;
      expect(decide(change, typed)).toEqual([
        ['outDate', 'alreadyThere'],
        ['driverOut', 'alreadyThere'],
      ]);
    });

    it('501’s counter is applied over the import’s stand-in — and kept where a person typed their own', () => {
      const change = byId.get('6aa916499b4450de756c96c3') as VisitChange;
      const untouched = written(change.old, STAND_IN);
      expect(decide(change, untouched).find(([f]) => f === 'counter')).toEqual([
        'counter',
        'apply',
      ]);
      // A chain that has since grown a reading equal to the book's new counter does not make the
      // change «no change»: ECMS still holds the import's stand-in, and the book's value is written.
      expect(
        decideVisitChange(change, untouched, names, { old: [STAND_IN, 99860], next: [] }).find(
          (d) => d.field === 'counter',
        )?.decision,
      ).toBe('apply');
      const typed = { ...untouched, odometerAtService: 99850 } as EcmsVisit;
      expect(decide(change, typed).find(([f]) => f === 'counter')).toEqual([
        'counter',
        'keptEcmsEdit',
      ]);
    });

    it('a parts list somebody edited on ECMS is kept; the same parts in another order are already there', () => {
      const change = byId.get('6aa0fdc897ddad125adc10f6') as VisitChange; // 295: فلتر جاز added
      const untouched = written(change.old, STAND_IN);
      const reordered = {
        ...untouched,
        sparePartIds: [...change.next.parts]
          .reverse()
          .map((part) => new Types.ObjectId(names.catalogId('sparePart', part))),
      } as EcmsVisit;
      expect(decide(change, reordered).find(([f]) => f === 'spareParts')).toEqual([
        'spareParts',
        'alreadyThere',
      ]);
      const edited = {
        ...untouched,
        sparePartIds: [new Types.ObjectId(idOf('sparePart:other'))],
      } as EcmsVisit;
      expect(decide(change, edited).find(([f]) => f === 'spareParts')).toEqual([
        'spareParts',
        'keptEcmsEdit',
      ]);
    });
  });
});

describe('the step itself — its payload and its order', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  /** The source with its comments removed — naming a call to describe it must not keep this green. */
  const source = readFileSync(join(HERE, 'maintenance-sync.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const dir = resolveGoLiveDataDir() as string;
  const sha256 = (file: string): string =>
    createHash('sha256')
      .update(readFileSync(join(dir, file)))
      .digest('hex');

  it('carries BOTH exports byte for byte — the old one is the rule’s old side and never edited', () => {
    // `car-maintenance.json` is what `go-live:maintenance:v3` imported. Edit it and every
    // «ECMS = OLD» stops meaning «nobody touched this since the import» — so it is pinned.
    expect(MAINTENANCE_SYNC_OLD_FILE).toBe('car-maintenance.json');
    expect(sha256(MAINTENANCE_SYNC_OLD_FILE)).toBe(
      '93caa5c0df77f0e2ccf726aea0155511cdab076c69b1bef0a08fc63d3d0da7aa',
    );
    // The owner's file as sent on 2026-09-29, unedited.
    expect(MAINTENANCE_SYNC_NEW_FILE).toBe('car-maintenance-2026-09-29.json');
    expect(sha256(MAINTENANCE_SYNC_NEW_FILE)).toBe(
      '6ca259ba09469ceac08ec10cfc505cff35a558fe0418a36fcf98cd59c17b0453',
    );
  });

  it('is its own run, versioned, and waits for the workshop book, both steps it stands on, and the new odometer export', () => {
    expect(MAINTENANCE_SYNC_GO_LIVE_MARK).toBe('go-live:maintenance-sync:v1');
    // The odometer sync adds the readings of 16 to 29 September that 18 of the new visits take
    // their counter from — so it must be DONE first. It waits for nothing of the workshop's.
    expect(source).toMatch(
      /waitForGoLiveRuns\(\[\s*VEHICLE_GO_LIVE_MARK,\s*ODOMETER_GO_LIVE_MARK,\s*MAINTENANCE_GO_LIVE_MARK,\s*ODOMETER_SYNC_GO_LIVE_MARK,?\s*\]\)/,
    );
    const odometerSync = readFileSync(join(HERE, 'odometer-sync.ts'), 'utf8');
    expect(odometerSync, 'no wait the other way round').not.toMatch(/MAINTENANCE_\w*GO_LIVE_MARK/);
  });

  it('refuses before its claim — every condition an operator fixes and redeploys', () => {
    const claim = source.indexOf('claimGoLiveRun(MAINTENANCE_SYNC_GO_LIVE_MARK');
    expect(claim).toBeGreaterThan(-1);
    for (const refusal of [
      'dir === null',
      '!existsSync(oldFile) || !existsSync(newFile)',
      'waitForGoLiveRuns(',
      'plan.rejected.length > 0',
      'admin === null',
    ]) {
      expect(source.indexOf(refusal), `${refusal} is checked`).toBeGreaterThan(-1);
      expect(source.indexOf(refusal), `${refusal} is checked before the claim`).toBeLessThan(claim);
    }
  });

  it('a run with failures is left unfinished — recorded, never marked done', () => {
    const failed = source.indexOf('if (outcome.failures.length > 0)');
    const recorded = source.indexOf('recordGoLiveFailure(MAINTENANCE_SYNC_GO_LIVE_MARK', failed);
    const finished = source.indexOf('finishGoLiveRun(MAINTENANCE_SYNC_GO_LIVE_MARK');
    expect(failed).toBeGreaterThan(-1);
    expect(recorded).toBeGreaterThan(failed);
    expect(source.slice(recorded, finished)).toContain('return;');
    expect(finished).toBeGreaterThan(recorded);
  });

  it('the boot starts it without waiting, and never under test', () => {
    expect(source).toMatch(
      /startMaintenanceSyncGoLive\s*=\s*\(\):\s*void\s*=>\s*\{\s*\n\s*if \(isTest\) return;/,
    );
    expect(source).toContain('void runMaintenanceSyncGoLive().catch(');
  });
});
