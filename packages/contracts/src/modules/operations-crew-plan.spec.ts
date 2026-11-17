// Round 20 — «لوحة التشغيلة» as the owner approved it: the contract's own rules, pinned without a
// server. The shift-type catalog («انا عاوز النوع يكون بيضاف من البيانات المرجعيه»), the row's type
// and colour, rows WITHOUT A VAN («وعاوز اقدر اضيف صف ميكونش ليه عربيه»), and the direction picked
// from the areas («لازم اختار من الاتجاهات اللى موجوده بتاعت البنوك»).
import { describe, expect, it } from 'vitest';
import {
  CREW_SLOT_CAPACITY,
  CreateOperationsShiftTypeSchema,
  OPERATIONS_CREW_AVAILABILITIES,
  OPERATIONS_CREW_FREE_VEHICLE_GROUPS,
  OPERATIONS_CREW_ROW_COLOURS,
  OPERATIONS_CREW_SLOTS,
  OPERATIONS_LEGACY_CREW_ROW_COLOURS,
  OPERATIONS_SHIFT_TYPE_COLOURS,
  OperationsCrewAssignmentChangedPayloadV1,
  OrderOperationsShiftTypesSchema,
  PlanOperationsCrewSchema,
  UpdateOperationsShiftTypeSchema,
  canonicalCrewRowColour,
  canonicalOperationsDirection,
  crewRoleOf,
  fitsCrewSlot,
  type OperationsCrewMemberDto,
  type OperationsCrewRole,
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
  it('Round 24b — carries a type and a colour OF THE TYPES’ PALETTE on a row', () => {
    const parsed = plan({
      rows: [{ vehicleId: oid(1), shiftTypeId: oid(50), rowColour: 'crimson' }],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.rows[0]?.rowColour).toBe('crimson');
    // One palette: the row's colours ARE the types' colours.
    expect(OPERATIONS_CREW_ROW_COLOURS).toBe(OPERATIONS_SHIFT_TYPE_COLOURS);
    expect(plan({ rows: [{ vehicleId: oid(1), rowColour: 'magenta' }] }).success).toBe(false);
    expect(plan({ rows: [{ vehicleId: oid(1), rowColour: '#ff0000' }] }).success).toBe(false);
    expect(plan({ rows: [{ vehicleId: oid(1), shiftTypeId: 'daily' }] }).success).toBe(false);
    // null is «لون النوع» — the override taken off.
    expect(plan({ rows: [{ vehicleId: oid(1), rowColour: null }] }).success).toBe(true);
  });

  it('Round 24b — still TAKES Round 20’s six names, mapped onto the palette (never a 400)', () => {
    for (const [legacy, palette] of Object.entries(OPERATIONS_LEGACY_CREW_ROW_COLOURS)) {
      const parsed = plan({ rows: [{ vehicleId: oid(1), rowColour: legacy }] });
      expect(parsed.success, legacy).toBe(true);
      expect(parsed.data?.rows[0]?.rowColour, legacy).toBe(palette);
    }
    // Each the palette's colour Round 20 DREW it in — yellow was bg-yellow-400, the palette's gold
    // (amber is amber-600, an orange-brown beside orange).
    expect(OPERATIONS_LEGACY_CREW_ROW_COLOURS).toEqual({
      yellow: 'gold',
      green: 'emerald',
      blue: 'sky',
      red: 'rose',
      purple: 'violet',
      orange: 'orange',
    });
  });

  it('accepts a NEW row without a van, and a saved one by its id', () => {
    expect(plan({ rows: [{ vehicleId: null, captainEmployeeIds: [oid(10)] }] }).success).toBe(true);
    expect(
      plan({ rows: [{ vehicleId: null, crewAssignmentId: oid(70), notes: 'سفر' }] }).success,
    ).toBe(true);
  });

  it('Round 24 — takes a crew-row id WITH a van: the saved row X takes van V and keeps its id', () => {
    expect(plan({ rows: [{ vehicleId: oid(1), crewAssignmentId: oid(70) }] }).success).toBe(true);
    // Still one van per save, and one row per save.
    expect(
      plan({
        rows: [
          { vehicleId: oid(1), crewAssignmentId: oid(70) },
          { vehicleId: oid(1), captainEmployeeIds: [oid(10)] },
        ],
      }).success,
    ).toBe(false);
    expect(
      plan({
        rows: [
          { vehicleId: oid(1), crewAssignmentId: oid(70) },
          { vehicleId: null, crewAssignmentId: oid(70) },
        ],
      }).success,
    ).toBe(false);
    // Given a van while the row holding it is removed — one end state, judged by the server.
    expect(
      plan({
        rows: [{ vehicleId: oid(1), crewAssignmentId: oid(70) }],
        removeCrewAssignmentIds: [oid(71)],
      }).success,
    ).toBe(true);
  });

  it('Round 24 — names the four refusals of a van given to a row, and of a row that holds محصنات', () => {
    expect(ErrorCodes.OPERATIONS_CREW_VEHICLE_NOT_ACTIVE).toBe(
      'OPERATIONS_CREW_VEHICLE_NOT_ACTIVE',
    );
    expect(ErrorCodes.OPERATIONS_CREW_VEHICLE_IN_WORKSHOP).toBe(
      'OPERATIONS_CREW_VEHICLE_IN_WORKSHOP',
    );
    expect(ErrorCodes.OPERATIONS_CREW_VEHICLE_TAKEN).toBe('OPERATIONS_CREW_VEHICLE_TAKEN');
    expect(ErrorCodes.OPERATIONS_CREW_ROW_HAS_SHIPMENTS).toBe('OPERATIONS_CREW_ROW_HAS_SHIPMENTS');
    expect(OPERATIONS_CREW_FREE_VEHICLE_GROUPS).toEqual([
      'roster',
      'cashTransfer',
      'standing',
      'other',
    ]);
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

describe('Round 22 — who is away on the board’s day («لو القائد غايب ... مقدرش احطه على العربيه»)', () => {
  it('names two answers only — HR’s absent and on-leave buckets; anything else is not «away»', () => {
    expect([...OPERATIONS_CREW_AVAILABILITIES]).toEqual(['absent', 'onLeave']);
    // A pool member says one of them, or null — and a server that predates the field says nothing,
    // which reads the same as null.
    const away: OperationsCrewMemberDto['availability'][] = ['absent', 'onLeave', null, undefined];
    expect(away).toHaveLength(4);
    // At work is not an answer this field gives: it says who is away, never who is fine.
    // @ts-expect-error — 'present' is HR's bucket, not an availability
    const atWork: OperationsCrewMemberDto['availability'] = 'present';
    expect(OPERATIONS_CREW_AVAILABILITIES).not.toContain(atWork);
  });

  it('names the refusal of a newly placed member who is away', () => {
    expect(ErrorCodes.OPERATIONS_CREW_MEMBER_ABSENT).toBe('OPERATIONS_CREW_MEMBER_ABSENT');
  });
});

describe('Round 23 — who may take which slot («ممنوع ان اعين قائد مكان اخصائى والعكس الا فى حالة انه قائد اخصائى»)', () => {
  const flags = (isCaptain: boolean, isSpecialist: boolean) => ({ isCaptain, isSpecialist });

  it('reads the role off the two flags — and nobody ticked, or no row at all, is a specialist', () => {
    expect(crewRoleOf(flags(true, false))).toBe('captain');
    expect(crewRoleOf(flags(true, true))).toBe('dual');
    expect(crewRoleOf(flags(false, true))).toBe('specialist');
    expect(crewRoleOf(flags(false, false))).toBe('specialist');
    expect(crewRoleOf(null)).toBe('specialist');
    expect(crewRoleOf(undefined)).toBe('specialist');
  });

  it('names the three slots in the board’s order', () => {
    expect([...OPERATIONS_CREW_SLOTS]).toEqual(['captain', 'specialist1', 'specialist2']);
  });

  it('seats a captain only as captain, a specialist only as specialist, and a captain-specialist anywhere', () => {
    const fits = (role: OperationsCrewRole): string =>
      OPERATIONS_CREW_SLOTS.filter((slot) => fitsCrewSlot(role, slot)).join(' ');
    expect(fits('captain')).toBe('captain');
    expect(fits('specialist')).toBe('specialist1 specialist2');
    expect(fits('dual')).toBe('captain specialist1 specialist2');
  });

  it('names the refusal of somebody newly put in a slot his role does not fit', () => {
    expect(ErrorCodes.OPERATIONS_CREW_MEMBER_WRONG_SLOT).toBe('OPERATIONS_CREW_MEMBER_WRONG_SLOT');
  });
});

describe('Round 24b — the one palette and the legacy row colours', () => {
  it('is twenty well-separated names, Round 20’s eleven first, the seeded nine before them all', () => {
    expect(OPERATIONS_SHIFT_TYPE_COLOURS).toHaveLength(20);
    expect(new Set(OPERATIONS_SHIFT_TYPE_COLOURS).size).toBe(20);
    const round20 = [
      'rose',
      'orange',
      'amber',
      'lime',
      'emerald',
      'teal',
      'sky',
      'indigo',
      'violet',
      'fuchsia',
      'slate',
    ];
    expect([...OPERATIONS_SHIFT_TYPE_COLOURS.slice(0, 11)].sort()).toEqual([...round20].sort());
    // The nine the boot seeds the legacy types with (shift-type.service.ts) are the first nine, so
    // a fresh catalog of nine types has every type's colour among the nine swatches shown.
    const seeded = ['rose', 'teal', 'fuchsia', 'indigo', 'emerald', 'orange', 'amber', 'slate'];
    expect([...OPERATIONS_SHIFT_TYPE_COLOURS.slice(0, 9)]).toEqual(
      expect.arrayContaining([...seeded, 'violet']),
    );
  });

  it('shares no name with a legacy row colour but orange — the mapping is never ambiguous', () => {
    const palette = new Set<string>(OPERATIONS_SHIFT_TYPE_COLOURS);
    for (const [legacy, target] of Object.entries(OPERATIONS_LEGACY_CREW_ROW_COLOURS)) {
      expect(palette.has(target), target).toBe(true);
      expect(palette.has(legacy), legacy).toBe(legacy === target);
    }
  });

  it('reads a stored colour as the palette’s name: as it is, mapped, or none', () => {
    expect(canonicalCrewRowColour('navy')).toBe('navy');
    expect(canonicalCrewRowColour('yellow')).toBe('gold');
    expect(canonicalCrewRowColour('purple')).toBe('violet');
    expect(canonicalCrewRowColour('orange')).toBe('orange');
    expect(canonicalCrewRowColour('magenta')).toBeNull();
    expect(canonicalCrewRowColour('toString')).toBeNull();
    expect(canonicalCrewRowColour(null)).toBeNull();
    expect(canonicalCrewRowColour(undefined)).toBeNull();
    expect(canonicalCrewRowColour(3)).toBeNull();
  });

  it('a type takes a new palette name, and never a legacy row name', () => {
    expect(
      CreateOperationsShiftTypeSchema.safeParse({ name: 'ليلي', colour: 'navy' }).success,
    ).toBe(true);
    expect(UpdateOperationsShiftTypeSchema.safeParse({ colour: 'olive', version: 3 }).success).toBe(
      true,
    );
    expect(
      UpdateOperationsShiftTypeSchema.safeParse({ colour: 'yellow', version: 3 }).success,
    ).toBe(false);
  });
});
