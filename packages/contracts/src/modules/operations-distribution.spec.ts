// Round 12 — «توزيع المحصنات», «تسليم المحصنات», «سجل الخزينة» and «تقرير الخزينة»: the contract's
// own rules, pinned without a server.
//
// The direction match is the one rule here a person will judge by eye — «المحصنة اللى نفس الاتجاه
// بتاع العربيه تتحط تلقائى» — so it is pinned case by case: what splits a direction, what folds, and
// that a match is EQUALITY of an area, never "contains". The server computes it for every row and
// the screen proposes from it, so a drift here would put shipments on the wrong vans.
import { describe, expect, it } from 'vitest';
import {
  OPERATIONS_DISTRIBUTION_MAX_CHANGES,
  OPERATIONS_SHIPMENT_LOG_KINDS,
  OperationsDeletedShipmentsQuerySchema,
  OperationsEvents,
  OperationsSecuredDistributionQuerySchema,
  OperationsShipmentAssignmentPayloadV1,
  OperationsShipmentHistoryQuerySchema,
  OperationsVaultHeldReportQuerySchema,
  SaveSecuredDistributionSchema,
  SecuredDistributionChangeSchema,
  foldOperationsAreaName,
  operationsDirectionAreas,
  operationsDirectionMatchesArea,
  operationsDirectionVanIds,
} from './operations.js';
import { ErrorCodes } from '../errors/index.js';

const oid = (n: number): string => n.toString(16).padStart(24, '0');

describe('folding an area name — the Arabic a typist actually types', () => {
  it('folds hamza forms, alef maqsura, taa marbuta, tashkeel and tatweel', () => {
    expect(foldOperationsAreaName('الإسماعيلية')).toBe(foldOperationsAreaName('الاسماعيليه'));
    expect(foldOperationsAreaName('المعادى')).toBe(foldOperationsAreaName('المعادي'));
    expect(foldOperationsAreaName('مدينة نصر')).toBe(foldOperationsAreaName('مدينه نصر'));
    expect(foldOperationsAreaName('المَعَادِي')).toBe(foldOperationsAreaName('المعادي'));
    expect(foldOperationsAreaName('المعـــادي')).toBe(foldOperationsAreaName('المعادي'));
    expect(foldOperationsAreaName('آل')).toBe('ال');
  });

  it('reads Arabic-Indic digits as Latin ones, and Latin letters in one case', () => {
    expect(foldOperationsAreaName('٦ أكتوبر')).toBe(foldOperationsAreaName('6 اكتوبر'));
    expect(foldOperationsAreaName('Maadi')).toBe('maadi');
  });

  it('takes the article off each word longer than three letters — and only there', () => {
    expect(foldOperationsAreaName('المعادي')).toBe('معادي');
    expect(foldOperationsAreaName('الشيخ زايد')).toBe(foldOperationsAreaName('شيخ زايد'));
    expect(foldOperationsAreaName('العاشر من رمضان')).toBe('عاشر من رمضان');
    // «ال» alone, and a three-letter word that merely starts with it, stay whole.
    expect(foldOperationsAreaName('ال')).toBe('ال');
    expect(foldOperationsAreaName('الف')).toBe('الف');
  });

  it('drops punctuation and invisible marks, and makes the spaces one', () => {
    expect(foldOperationsAreaName('  مدينة   نصر.  ')).toBe('مدينه نصر');
    expect(foldOperationsAreaName('‏المعادي‏')).toBe('معادي');
    expect(foldOperationsAreaName('...')).toBe('');
  });
});

describe('the areas a direction names', () => {
  it('splits at the separators a desk writes between areas', () => {
    const expected = ['معادي', 'حلوان'];
    for (const direction of [
      'المعادي - حلوان',
      'المعادي-حلوان',
      'المعادي – حلوان',
      'المعادي — حلوان',
      'المعادي / حلوان',
      'المعادي\\حلوان',
      'المعادي | حلوان',
      'المعادي، حلوان',
      'المعادي, حلوان',
      'المعادي؛ حلوان',
      'المعادي; حلوان',
      'المعادي + حلوان',
      'المعادي & حلوان',
      'المعادي و حلوان',
    ]) {
      expect(operationsDirectionAreas(direction), direction).toEqual(expected);
    }
  });

  it('keeps a «و» that belongs to a word, and a multi-word area whole', () => {
    expect(operationsDirectionAreas('وسط البلد')).toEqual(['وسط بلد']);
    expect(operationsDirectionAreas('مدينة نصر - مصر الجديدة')).toEqual(['مدينه نصر', 'مصر جديده']);
  });

  it('names each area once, and nothing for an empty direction', () => {
    expect(operationsDirectionAreas('المعادي - المعادى - حلوان')).toEqual(['معادي', 'حلوان']);
    expect(operationsDirectionAreas(null)).toEqual([]);
    expect(operationsDirectionAreas(undefined)).toEqual([]);
    expect(operationsDirectionAreas('')).toEqual([]);
    expect(operationsDirectionAreas(' - / ، ')).toEqual([]);
  });
});

describe('a shipment matches a van when its area IS one of the van’s areas', () => {
  it('matches one area of a direction that names several', () => {
    expect(operationsDirectionMatchesArea('المعادي - حلوان', 'حلوان')).toBe(true);
    expect(operationsDirectionMatchesArea('المعادي - حلوان', 'المعادى')).toBe(true);
    expect(operationsDirectionMatchesArea('الهرم', 'هرم')).toBe(true);
  });

  it('is equality, never "contains" — a longer or a shorter name is another area', () => {
    expect(operationsDirectionMatchesArea('مصر الجديدة', 'مصر')).toBe(false);
    expect(operationsDirectionMatchesArea('مصر', 'مصر الجديدة')).toBe(false);
    expect(operationsDirectionMatchesArea('المعادي الجديدة', 'المعادي')).toBe(false);
  });

  it('matches nothing without an area or a direction', () => {
    expect(operationsDirectionMatchesArea(null, 'المعادي')).toBe(false);
    expect(operationsDirectionMatchesArea('المعادي', null)).toBe(false);
    expect(operationsDirectionMatchesArea('المعادي', '')).toBe(false);
    expect(operationsDirectionMatchesArea('', '')).toBe(false);
    expect(operationsDirectionMatchesArea('...', '...')).toBe(false);
  });
});

describe('the vans a shipment’s area points at', () => {
  const van = (id: string, direction: string | null, captains = 1) => ({
    crewAssignmentId: id,
    direction,
    captains: Array.from({ length: captains }, (_, i) => ({ employeeId: `c${String(i)}` })),
  });

  it('lists the matching vans in the order given — one is a proposal, two are a choice', () => {
    const vans = [van('a', 'حلوان'), van('b', 'المعادي - حلوان'), van('c', 'الهرم')];
    expect(operationsDirectionVanIds('المعادي', vans)).toEqual(['b']);
    expect(operationsDirectionVanIds('حلوان', vans)).toEqual(['a', 'b']);
    expect(operationsDirectionVanIds('الدقي', vans)).toEqual([]);
    expect(operationsDirectionVanIds(null, vans)).toEqual([]);
  });

  it('skips a van with no captain — it cannot carry anything', () => {
    expect(
      operationsDirectionVanIds('حلوان', [van('a', 'حلوان', 0), van('b', 'حلوان', 2)]),
    ).toEqual(['b']);
  });
});

describe('the distribution read and save', () => {
  it('reads one optional day — and nothing else', () => {
    expect(OperationsSecuredDistributionQuerySchema.safeParse({}).success).toBe(true);
    expect(
      OperationsSecuredDistributionQuerySchema.parse({ date: '2026-11-20' }).date?.toISOString(),
    ).toBe('2026-11-20T00:00:00.000Z');
    expect(OperationsSecuredDistributionQuerySchema.safeParse({ date: '' }).success).toBe(false);
    expect(OperationsSecuredDistributionQuerySchema.safeParse({ from: '2026-11-20' }).success).toBe(
      false,
    );
  });

  const change = (over: Record<string, unknown> = {}) => ({
    shipmentId: oid(1),
    crewAssignmentId: oid(2),
    captainEmployeeId: oid(3),
    version: null,
    ...over,
  });

  it('a change names a van AND its captain, or neither to take the shipment off', () => {
    expect(SecuredDistributionChangeSchema.safeParse(change()).success).toBe(true);
    expect(
      SecuredDistributionChangeSchema.safeParse(
        change({ crewAssignmentId: null, captainEmployeeId: null, version: 4 }),
      ).success,
    ).toBe(true);
    expect(
      SecuredDistributionChangeSchema.safeParse(change({ captainEmployeeId: null })).success,
    ).toBe(false);
    expect(
      SecuredDistributionChangeSchema.safeParse(change({ crewAssignmentId: null })).success,
    ).toBe(false);
  });

  it('carries the delivery leg’s version — null for "no leg yet", never left out', () => {
    expect(SecuredDistributionChangeSchema.safeParse(change({ version: 0 })).success).toBe(true);
    expect(SecuredDistributionChangeSchema.safeParse(change({ version: -1 })).success).toBe(false);
    const withoutVersion: Record<string, unknown> = change();
    delete withoutVersion.version;
    expect(SecuredDistributionChangeSchema.safeParse(withoutVersion).success).toBe(false);
    expect(SecuredDistributionChangeSchema.safeParse(change({ status: 'x' })).success).toBe(false);
  });

  it('saves a day with at least one change, each shipment once, within the bound', () => {
    const save = (changes: unknown[]) =>
      SaveSecuredDistributionSchema.safeParse({ date: '2026-11-20', changes });
    expect(save([change()]).success).toBe(true);
    expect(save([]).success).toBe(false);
    expect(save([change(), change({ crewAssignmentId: oid(9) })]).success).toBe(false);
    const many = Array.from({ length: OPERATIONS_DISTRIBUTION_MAX_CHANGES + 1 }, (_, i) =>
      change({ shipmentId: oid(100 + i) }),
    );
    expect(save(many).success).toBe(false);
    expect(save(many.slice(0, OPERATIONS_DISTRIBUTION_MAX_CHANGES)).success).toBe(true);
    expect(SaveSecuredDistributionSchema.safeParse({ changes: [change()] }).success).toBe(false);
  });

  it('names its refusals with codes of their own', () => {
    expect(ErrorCodes.OPERATIONS_DISTRIBUTION_DAY_IN_PAST).toBe(
      'OPERATIONS_DISTRIBUTION_DAY_IN_PAST',
    );
    expect(ErrorCodes.OPERATIONS_DISTRIBUTION_ALREADY_DISPATCHED).toBe(
      'OPERATIONS_DISTRIBUTION_ALREADY_DISPATCHED',
    );
    expect(ErrorCodes.OPERATIONS_DISTRIBUTION_NOT_ON_DAY).toBe(
      'OPERATIONS_DISTRIBUTION_NOT_ON_DAY',
    );
    expect(ErrorCodes.OPERATIONS_DISTRIBUTION_LEG_STARTED).toBe(
      'OPERATIONS_DISTRIBUTION_LEG_STARTED',
    );
  });

  it('logs a van taken off and an overdue day moved, and announces the removal', () => {
    expect(OPERATIONS_SHIPMENT_LOG_KINDS).toContain('crewRemoved');
    expect(OPERATIONS_SHIPMENT_LOG_KINDS).toContain('deliveryRescheduled');
    expect(OPERATIONS_SHIPMENT_LOG_KINDS[OPERATIONS_SHIPMENT_LOG_KINDS.length - 1]).toBe('other');
    expect(OperationsEvents.SecuredLegRemoved).toBe('operations.shipmentAssignment.removed');
    expect(
      OperationsShipmentAssignmentPayloadV1.safeParse({
        assignmentId: oid(1),
        shipmentId: oid(2),
        leg: 'delivery',
        captainEmployeeId: oid(3),
        vehicleId: oid(4),
      }).success,
    ).toBe(true);
  });
});

describe('«سجل الخزينة» — the history and the deleted list for one type', () => {
  it('takes an optional shipment type, both lists alike', () => {
    for (const schema of [
      OperationsShipmentHistoryQuerySchema,
      OperationsDeletedShipmentsQuerySchema,
    ]) {
      const range = { from: '2026-11-01', to: '2026-11-30' };
      expect(schema.safeParse(range).success).toBe(true);
      expect(schema.parse({ ...range, type: 'secured' }).type).toBe('secured');
      expect(schema.parse({ ...range, type: 'daily' }).type).toBe('daily');
      expect(schema.safeParse({ ...range, type: 'vault' }).success).toBe(false);
      expect(schema.safeParse({ ...range, type: '' }).success).toBe(false);
    }
  });

  it('still refuses a backwards range with a type', () => {
    expect(
      OperationsShipmentHistoryQuerySchema.safeParse({
        from: '2026-11-30',
        to: '2026-11-01',
        type: 'secured',
      }).success,
    ).toBe(false);
  });
});

describe('«تقرير الخزينة» — live, so it takes no period', () => {
  it('refuses every parameter', () => {
    expect(OperationsVaultHeldReportQuerySchema.safeParse({}).success).toBe(true);
    expect(OperationsVaultHeldReportQuerySchema.safeParse({ from: '2026-11-01' }).success).toBe(
      false,
    );
  });
});
