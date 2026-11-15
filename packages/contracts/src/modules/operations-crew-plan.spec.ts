// Round 20 — «لوحة التشغيلة» as the owner approved it: the contract's own rules, pinned without a
// server. The shift-type catalog («انا عاوز النوع يكون بيضاف من البيانات المرجعيه»), the row's type
// and colour, rows WITHOUT A VAN («وعاوز اقدر اضيف صف ميكونش ليه عربيه»), and the direction picked
// from the areas («لازم اختار من الاتجاهات اللى موجوده بتاعت البنوك»).
import { describe, expect, it } from 'vitest';
import {
  CREW_SLOT_CAPACITY,
  CreateOperationsShiftTypeSchema,
  OPERATIONS_CREW_ROW_COLOURS,
  OPERATIONS_SHIFT_TYPE_COLOURS,
  OperationsCrewAssignmentChangedPayloadV1,
  OrderOperationsShiftTypesSchema,
  PlanOperationsCrewSchema,
  UpdateOperationsShiftTypeSchema,
  canonicalOperationsDirection,
} from './operations.js';
import { ErrorCodes } from '../errors/index.js';

const oid = (n: number): string => n.toString(16).padStart(24, '0');
const plan = (body: Record<string, unknown>) =>
  PlanOperationsCrewSchema.safeParse({ date: '2026-08-18', ...body });

describe('the shift-type catalog («أنواع التشغيل»)', () => {
  it('takes a name, an optional English name and a colour of the palette', () => {
    const parsed = CreateOperationsShiftTypeSchema.parse({ name: ' يومي ', colour: 'rose' });
    expect(parsed).toEqual({ name: 'يومي', nameEn: null, colour: 'rose' });
    expect(
      CreateOperationsShiftTypeSchema.safeParse({ name: 'يومي', colour: '#ff0000' }).success,
    ).toBe(false);
    expect(CreateOperationsShiftTypeSchema.safeParse({ name: '', colour: 'rose' }).success).toBe(
      false,
    );
    // The palette is names the screen maps to its tags, never CSS.
    expect(OPERATIONS_SHIFT_TYPE_COLOURS).toContain('slate');
    expect(OPERATIONS_SHIFT_TYPE_COLOURS.every((c) => /^[a-z]+$/.test(c))).toBe(true);
  });

  it('edits by version, archives with isActive, and has no delete', () => {
    expect(UpdateOperationsShiftTypeSchema.safeParse({ isActive: false }).success).toBe(false);
    expect(UpdateOperationsShiftTypeSchema.safeParse({ isActive: false, version: 0 }).success).toBe(
      true,
    );
    expect(UpdateOperationsShiftTypeSchema.safeParse({ seedKey: 'x', version: 0 }).success).toBe(
      false,
    );
  });

  it('orders by a list of distinct ids, the currencies’ drag exactly', () => {
    expect(OrderOperationsShiftTypesSchema.safeParse({ ids: [oid(1), oid(2)] }).success).toBe(true);
    expect(OrderOperationsShiftTypesSchema.safeParse({ ids: [oid(1), oid(1)] }).success).toBe(
      false,
    );
    expect(OrderOperationsShiftTypesSchema.safeParse({ ids: [] }).success).toBe(false);
  });
});

describe('the crew-board save — type, colour, and rows without a van', () => {
  it('carries a type and one of the six colours on a row', () => {
    expect(
      plan({ rows: [{ vehicleId: oid(1), shiftTypeId: oid(50), rowColour: 'yellow' }] }).success,
    ).toBe(true);
    expect(OPERATIONS_CREW_ROW_COLOURS).toEqual([
      'yellow',
      'green',
      'blue',
      'red',
      'purple',
      'orange',
    ]);
    expect(plan({ rows: [{ vehicleId: oid(1), rowColour: 'pink' }] }).success).toBe(false);
    expect(plan({ rows: [{ vehicleId: oid(1), shiftTypeId: 'daily' }] }).success).toBe(false);
  });

  it('accepts a NEW row without a van, and a saved one by its id', () => {
    expect(plan({ rows: [{ vehicleId: null, captainEmployeeIds: [oid(10)] }] }).success).toBe(true);
    expect(
      plan({ rows: [{ vehicleId: null, crewAssignmentId: oid(70), notes: 'سفر' }] }).success,
    ).toBe(true);
  });

  it('refuses a crew-row id on a VAN row — a van’s row is addressed by its van', () => {
    expect(plan({ rows: [{ vehicleId: oid(1), crewAssignmentId: oid(70) }] }).success).toBe(false);
  });

  it('takes removals alone, and refuses a save with nothing in it', () => {
    expect(plan({ rows: [], removeCrewAssignmentIds: [oid(70)] }).success).toBe(true);
    expect(plan({ rows: [] }).success).toBe(false);
    expect(plan({ rows: [], removeCrewAssignmentIds: [] }).success).toBe(false);
  });

  it('refuses a row twice, a removal twice, and a row both edited and removed', () => {
    expect(
      plan({
        rows: [
          { vehicleId: null, crewAssignmentId: oid(70) },
          { vehicleId: null, crewAssignmentId: oid(70) },
        ],
      }).success,
    ).toBe(false);
    expect(plan({ rows: [], removeCrewAssignmentIds: [oid(70), oid(70)] }).success).toBe(false);
    expect(
      plan({
        rows: [{ vehicleId: null, crewAssignmentId: oid(70) }],
        removeCrewAssignmentIds: [oid(70)],
      }).success,
    ).toBe(false);
  });

  it('lets several NEW rows without a van stand side by side — none of them is a van twice', () => {
    expect(
      plan({
        rows: [
          { vehicleId: null, captainEmployeeIds: [oid(10)] },
          { vehicleId: null, captainEmployeeIds: [oid(11)] },
        ],
      }).success,
    ).toBe(true);
  });

  it('Q11 counts a row without a van: one person, one row per day', () => {
    expect(
      plan({
        rows: [
          { vehicleId: oid(1), captainEmployeeIds: [oid(10)] },
          { vehicleId: null, specialist1EmployeeIds: [oid(10)] },
        ],
      }).success,
    ).toBe(false);
  });

  it('caps every slot at two — «من 1 ل 2 قادة» — and asks no minimum', () => {
    expect(CREW_SLOT_CAPACITY).toBe(2);
    expect(
      plan({ rows: [{ vehicleId: null, specialist2EmployeeIds: [oid(1), oid(2), oid(3)] }] })
        .success,
    ).toBe(false);
    // One captain and no specialist is a row in progress, not a refusal (the board warns ⚠).
    expect(plan({ rows: [{ vehicleId: oid(1), captainEmployeeIds: [oid(10)] }] }).success).toBe(
      true,
    );
  });

  it('gives a vehicle-less row a van the way the board does: the van’s row plus the old row’s removal', () => {
    // The board's `attachVan`: the crew moves onto the van, the row without a van goes — and the
    // same person on both is NOT a Q11 clash, because the removed row holds nobody any more.
    expect(
      plan({
        rows: [{ vehicleId: oid(1), captainEmployeeIds: [oid(10)] }],
        removeCrewAssignmentIds: [oid(70)],
      }).success,
    ).toBe(true);
  });
});

describe('the direction is picked from the areas (canonicalOperationsDirection)', () => {
  const AREAS = ['المعادي', 'حلوان', 'مدينة نصر', 'شبرا/الخيمة'];

  it('stores the area’s own spelling of a folded match', () => {
    expect(canonicalOperationsDirection('المعادى', AREAS)).toEqual({ direction: 'المعادي' });
    expect(canonicalOperationsDirection('  مدينه نصر ', AREAS)).toEqual({ direction: 'مدينة نصر' });
  });

  it('keeps several areas, each once, joined by « - » — the distribution still reads them', () => {
    expect(canonicalOperationsDirection('المعادى و حلوان', AREAS)).toEqual({
      direction: 'المعادي - حلوان',
    });
    expect(canonicalOperationsDirection('حلوان، حلوان', AREAS)).toEqual({ direction: 'حلوان' });
  });

  it('never splits an area whose own name holds a separator', () => {
    expect(canonicalOperationsDirection('شبرا/الخيمه', AREAS)).toEqual({
      direction: 'شبرا/الخيمة',
    });
  });

  it('names every part no area answers — equality, never "contains"', () => {
    expect(canonicalOperationsDirection('طريق السويس', AREAS)).toEqual({
      unknown: ['طريق السويس'],
    });
    expect(canonicalOperationsDirection('المعادي - الهرم', AREAS)).toEqual({ unknown: ['الهرم'] });
    expect(canonicalOperationsDirection('مدينة', AREAS)).toEqual({ unknown: ['مدينة'] });
    expect(canonicalOperationsDirection(' - ', AREAS)).toEqual({ unknown: [' - '] });
    expect(canonicalOperationsDirection('المعادي', [])).toEqual({ unknown: ['المعادي'] });
  });
});

describe('the event and the refusals', () => {
  it('reports the crew row, and a null van for a row without one', () => {
    const base = {
      dayId: oid(1),
      crewAssignmentId: oid(2),
      date: new Date(),
      captainEmployeeIds: [],
      specialist1EmployeeIds: [],
      specialist2EmployeeIds: [],
    };
    expect(
      OperationsCrewAssignmentChangedPayloadV1.safeParse({ ...base, vehicleId: null }).success,
    ).toBe(true);
    expect(
      OperationsCrewAssignmentChangedPayloadV1.safeParse({ ...base, vehicleId: oid(3) }).success,
    ).toBe(true);
  });

  it('names the two new refusals', () => {
    expect(ErrorCodes.OPERATIONS_UNKNOWN_SHIFT_TYPE).toBe('OPERATIONS_UNKNOWN_SHIFT_TYPE');
    expect(ErrorCodes.OPERATIONS_DIRECTION_NOT_AN_AREA).toBe('OPERATIONS_DIRECTION_NOT_AN_AREA');
  });
});
