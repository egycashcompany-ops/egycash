// Round 12 (web B) — what «توزيع المحصنات» and «تسليم المحصنات» put on the wire, checked against the
// REAL schemas that receive them (a body the schema refuses is a 400 in the browser):
//
//   · the read: `GET /operations/secured/distribution`, no `date` key for today (the server refuses
//     an empty one), or one day;
//   · «حفظ»: ONE `POST /operations/secured/distribution` — the day and every change, each with its
//     van and captain (or both null) and the leg version the person moved it at;
//   · «تسليم»: the existing `POST /operations/secured/dispatch` with the van's crew row and ONLY its
//     shipments the vault holds.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DispatchSecuredShipmentsSchema,
  OperationsSecuredDistributionQuerySchema,
  SaveSecuredDistributionSchema,
} from '@ecms/contracts';
import { get, post } from '../../../shared/lib/api-client';
import {
  EMPTY_DRAFT,
  UNPLACED,
  distributionSaveBody,
  handoverRequest,
  moveToVan,
  placeShipment,
  proposeByDirection,
  type DistributionRowFacts,
} from '../lib/secured-distribution';
import { dispatchSecured, getSecuredDistribution, saveSecuredDistribution } from './operations-api';

// Only the transport is stubbed; the paths and bodies are the real module's.
vi.mock('../../../shared/lib/api-client', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../../shared/lib/api-client');
  return { ...actual, get: vi.fn(async () => ({})), post: vi.fn(async () => ({})) };
});

beforeEach(() => {
  vi.mocked(get).mockClear();
  vi.mocked(post).mockClear();
});

const ID = (n: number): string => `65a0000000000000000000${String(n).padStart(2, '0')}`;
const VAN_A = {
  crewAssignmentId: ID(1),
  captains: [{ employeeId: ID(11), code: null, fullNameAr: 'أ' }],
};
const VAN_B = {
  crewAssignmentId: ID(2),
  captains: [
    { employeeId: ID(12), code: null, fullNameAr: 'ب' },
    { employeeId: ID(13), code: null, fullNameAr: 'ج' },
  ],
};

const row = (n: number, over: Partial<DistributionRowFacts> = {}): DistributionRowFacts => ({
  id: ID(20 + n),
  status: 'inVault',
  overdue: false,
  delivery: null,
  deliveryLegVersion: null,
  placedCrewAssignmentId: null,
  directionCrewAssignmentIds: [],
  ...over,
});

describe('the read', () => {
  it('asks for today with NO `date` key, and for a day by its date', async () => {
    await getSecuredDistribution(null);
    await getSecuredDistribution('');
    await getSecuredDistribution('2026-11-14');
    expect(vi.mocked(get).mock.calls.map(([path]) => path)).toEqual([
      '/operations/secured/distribution',
      '/operations/secured/distribution',
      '/operations/secured/distribution?date=2026-11-14',
    ]);
    expect(OperationsSecuredDistributionQuerySchema.safeParse({ date: '2026-11-14' }).success).toBe(
      true,
    );
    expect(OperationsSecuredDistributionQuerySchema.safeParse({}).success).toBe(true);
  });
});

describe('«حفظ» — one request, every change', () => {
  const proposed = row(1, { directionCrewAssignmentIds: [ID(1)] });
  const onB = row(2, {
    placedCrewAssignmentId: ID(2),
    delivery: {
      crewAssignmentId: ID(2),
      captainEmployeeId: ID(12),
      vehicleId: ID(30),
      executionStatus: 'pending',
    },
    deliveryLegVersion: 4,
  });
  const takenOff = row(3, {
    placedCrewAssignmentId: ID(1),
    delivery: {
      crewAssignmentId: ID(1),
      captainEmployeeId: ID(11),
      vehicleId: ID(31),
      executionStatus: 'pending',
    },
    deliveryLegVersion: 0,
  });
  const rows = [proposed, onB, takenOff];
  let draft = proposeByDirection(rows, [VAN_A, VAN_B], EMPTY_DRAFT);
  draft = placeShipment(draft, onB, { crewAssignmentId: ID(2), captainEmployeeId: ID(13) });
  draft = placeShipment(draft, takenOff, UNPLACED);
  const body = distributionSaveBody('2026-11-12', rows, draft)!;

  it('is accepted by the schema the API mounts', () => {
    const parsed = SaveSecuredDistributionSchema.safeParse(body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('POSTs the day and the changes — a van with its captain, or both null; the version as read', async () => {
    await saveSecuredDistribution(body);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/operations/secured/distribution', {
      date: '2026-11-12',
      changes: [
        { shipmentId: ID(21), crewAssignmentId: ID(1), captainEmployeeId: ID(11), version: null },
        { shipmentId: ID(22), crewAssignmentId: ID(2), captainEmployeeId: ID(13), version: 4 },
        { shipmentId: ID(23), crewAssignmentId: null, captainEmployeeId: null, version: 0 },
      ],
    });
  });

  it('a moved-and-back shipment is not in it; nothing moved is no request at all', () => {
    const back = moveToVan(moveToVan(EMPTY_DRAFT, onB, VAN_A), onB, VAN_B);
    expect(distributionSaveBody('2026-11-12', rows, back)).toBeNull();
  });
});

describe('«تسليم» — the van’s in-vault shipments only', () => {
  const rows = [
    row(1, { placedCrewAssignmentId: ID(1) }),
    row(2, { placedCrewAssignmentId: ID(1), status: 'draft' }),
    row(3, { placedCrewAssignmentId: ID(2) }),
    row(4, { placedCrewAssignmentId: ID(1) }),
  ];

  it('dispatches the crew row with its in-vault shipments — never the draft on it, never another van’s', async () => {
    const body = handoverRequest(rows, ID(1))!;
    expect(DispatchSecuredShipmentsSchema.safeParse(body).success).toBe(true);
    await dispatchSecured(body);
    expect(post).toHaveBeenCalledWith('/operations/secured/dispatch', {
      crewAssignmentId: ID(1),
      shipmentIds: [ID(21), ID(24)],
    });
  });
});
