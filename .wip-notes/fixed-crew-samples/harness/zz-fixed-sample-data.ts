// ── OWNER SAMPLE DATA — NEVER COMMIT (apps/web/src/zz-* is in .git/info/exclude) ────────────────
// «الطقم الثابت» in the design of «تعيين السيارات» — the design sample's ONE figure set
// (fixed-crew/gap-map.md §9): three branches, 20 active cars + car 199 out of service, the real
// twelve mission types, 39 people (one switched-off profile). Every shape is the REAL contract type.
//
// The same ids, names, makes and mission catalog as the «now» harness (zz-fixed-data.ts, imported
// below), cut down to three branches; the people of the dropped branches are re-homed (their branch
// shows only in the driver card on hover). Car 150 = «مرسيدس اسيليو 915» in «المهندسين» (DECISIONS
// §11 B1).
//
// The API is answered in the page (`answerSampleApi`), with the top bar's branch read off the
// request's `X-Active-Branch` header, exactly as the server narrows: the cars follow the branch, the
// pool stays company-wide. A «حفظ» (POST /fleet/fixed-roster) is applied to the crews held here and
// answered with the refreshed board, as the service answers it.
//
// Q1 — the owner's answer (ب), 2026-11-17: this screen shows NO flag for a standing member who can no
// longer drive. Those facts belong to the daily «تعيين السيارات» only, so the one zz-only fact left
// here (`DAILY_LICENCE_EXPIRED`) feeds the DAILY board's answer (`rosterToday`: the hover cards and
// the reference shots) and nothing the standing screen draws.
import {
  compareFleetVehicleCodes,
  type FleetFixedCrewRowDto,
  type FleetFixedRosterDto,
  type FleetPersonDto,
  type FleetRosterDayDto,
  type FleetVehicleDto,
  type OrgUnitOptionDto,
} from '@ecms/contracts';
import {
  APPLICATIONS,
  MISSION,
  MISSION_TYPES,
  OPERATIONS,
  P,
  PEOPLE as NOW_PEOPLE,
  VEHICLE_TYPES,
} from './zz-fixed-data';

export { MISSION, MISSION_TYPES, P };

export const SAMPLE_CLOCK = '2026-11-17T08:00:00Z';
export const SAMPLE_TODAY = '2026-11-17';
const STAMP = '2025-11-27T10:00:00.000Z';
const L = (ar: string, en: string): { ar: string; en: string } => ({ ar, en });

// ── branches (three) ─────────────────────────────────────────────────────────────────────────────
const br = (n: number): string => `6b01${String(n).padStart(20, '0')}`;
export const BRANCH = { mohandessin: br(1), nasrCity: br(2), alex: br(3) } as const;
type Branch = keyof typeof BRANCH;
export const BRANCHES: OrgUnitOptionDto[] = [
  {
    id: BRANCH.mohandessin,
    code: 'MOH',
    name: L('المهندسين', 'Mohandessin'),
    parentId: null,
    catalogId: null,
  },
  {
    id: BRANCH.nasrCity,
    code: 'NSR',
    name: L('مدينة نصر', 'Nasr City'),
    parentId: null,
    catalogId: null,
  },
  {
    id: BRANCH.alex,
    code: 'ALX',
    name: L('الإسكندرية', 'Alexandria'),
    parentId: null,
    catalogId: null,
  },
];

// ── people: the «now» set, the three dropped branches re-homed ───────────────────────────────────
const REHOME: Readonly<Record<string, string>> = {
  [br(4)]: BRANCH.mohandessin, // طنطا
  [br(5)]: BRANCH.nasrCity, // أكتوبر
  [br(6)]: BRANCH.alex, // أسيوط
};
const GOVERNORATE: Readonly<Record<string, string>> = {
  [BRANCH.mohandessin]: 'الجيزة',
  [BRANCH.nasrCity]: 'القاهرة',
  [BRANCH.alex]: 'الإسكندرية',
};
export const PEOPLE: FleetPersonDto[] = NOW_PEOPLE.map((person) => {
  const branchId = REHOME[person.branchId ?? ''] ?? person.branchId;
  return { ...person, branchId, governorate: GOVERNORATE[branchId ?? ''] ?? person.governorate };
});

/** Switched-off fleet profiles — never in the server's pool (`switchedOffProfiles`). */
export const SWITCHED_OFF: readonly string[] = [P.sabry];

// ── the cars ─────────────────────────────────────────────────────────────────────────────────────
const typeId = (index: number): string => VEHICLE_TYPES[index]?.id ?? '';
const MAKE = {
  m515: typeId(0),
  m915: typeId(1),
  m516: typeId(2),
  land: typeId(3),
  suzuki: typeId(4),
  hiace: typeId(5),
  peugeot: typeId(6),
} as const;
type Make = keyof typeof MAKE;

export const vehicleIdOf = (code: string): string => `c2f0${code.padStart(20, '0')}`;
interface CarSpec {
  code: string;
  plate: string;
  make: Make;
  branch: Branch;
  licence: string;
  status?: FleetVehicleDto['status'];
}
const CAR_SPECS: readonly CarSpec[] = [
  { code: '150', plate: 'ط ع م 5174', make: 'm915', branch: 'mohandessin', licence: '2027-07-21' },
  { code: '152', plate: 'س ج م 3906', make: 'm515', branch: 'mohandessin', licence: '2027-02-14' },
  { code: '158', plate: 'و ق ل 2290', make: 'm515', branch: 'mohandessin', licence: '2027-08-11' },
  { code: '163', plate: 'ط ل ع 2731', make: 'm515', branch: 'mohandessin', licence: '2027-05-02' },
  { code: '171', plate: 'ن ق ص 4821', make: 'm516', branch: 'mohandessin', licence: '2027-03-15' },
  { code: '176', plate: 'ع ن د 7148', make: 'hiace', branch: 'mohandessin', licence: '2026-12-03' },
  { code: '205', plate: 'ل م و 3187', make: 'm515', branch: 'nasrCity', licence: '2027-06-30' },
  { code: '214', plate: 'ي ه ف 5827', make: 'm515', branch: 'mohandessin', licence: '2027-09-09' },
  { code: '231', plate: 'م ص ر 8352', make: 'm915', branch: 'nasrCity', licence: '2027-10-04' },
  { code: '247', plate: 'ج د ن 2470', make: 'm515', branch: 'nasrCity', licence: '2027-04-02' },
  { code: '262', plate: 'ف ك ب 6618', make: 'hiace', branch: 'nasrCity', licence: '2027-01-28' },
  { code: '305', plate: 'ق ر س 7742', make: 'm915', branch: 'nasrCity', licence: '2027-03-03' },
  { code: '318', plate: 'ا ب ج 1185', make: 'm516', branch: 'alex', licence: '2027-05-19' },
  { code: '340', plate: 'ح د ر 9024', make: 'land', branch: 'alex', licence: '2027-02-07' },
  { code: '376', plate: 'ص ط ن 4473', make: 'suzuki', branch: 'alex', licence: '2027-07-12' },
  { code: '410', plate: 'ر ع ف 5531', make: 'm515', branch: 'alex', licence: '2027-06-01' },
  { code: '433', plate: 'ك م ل 2867', make: 'hiace', branch: 'alex', licence: '2027-08-26' },
  // «الملاكى» — the private cars keep the old low numbers and are listed last.
  { code: '118', plate: 'س و ج 1938', make: 'land', branch: 'mohandessin', licence: '2027-02-20' },
  { code: '120', plate: 'ر ك ي 3349', make: 'peugeot', branch: 'nasrCity', licence: '2026-12-25' },
  {
    code: '133',
    plate: 'د ه ن 5208',
    make: 'suzuki',
    branch: 'mohandessin',
    licence: '2027-04-09',
  },
  // Out of service: not on the board, but its standing crew still holds «إيهاب سمير الحسيني».
  {
    code: '199',
    plate: 'ط ر ق 6402',
    make: 'm515',
    branch: 'mohandessin',
    licence: '2026-09-30',
    status: 'outOfService',
  },
];

/** Codes an open workshop visit covers today — «صيانة» / «في الورشة». */
export const WORKSHOP_CODES: readonly string[] = ['163', '176', '340'];

const OPERATION_CASH_ID = OPERATIONS[0]?.id ?? '';
const OPERATION_ADMIN_ID = OPERATIONS[1]?.id ?? '';
const vehicle = (spec: CarSpec): FleetVehicleDto => ({
  id: vehicleIdOf(spec.code),
  code: spec.code,
  typeId: MAKE[spec.make],
  plateNumber: spec.plate,
  chassisNumber: `WDB${spec.code.padStart(4, '0')}K8L0${spec.code}`,
  motorNumber: `OM-${spec.code}771`,
  joinedAt: '2023-01-15T00:00:00.000Z',
  licenseExpiresAt: `${spec.licence}T00:00:00.000Z`,
  licenseClassId: null,
  operationId:
    spec.make === 'land' || spec.make === 'peugeot' ? OPERATION_ADMIN_ID : OPERATION_CASH_ID,
  insuranceCompanyId: null,
  branchId: BRANCH[spec.branch],
  departmentId: null,
  radio: { issi: null, motorolaSn: null },
  status: spec.status ?? 'active',
  statusReason: null,
  licenseImage: null,
  inWorkshop: WORKSHOP_CODES.includes(spec.code),
  version: 1,
  createdAt: STAMP,
  updatedAt: STAMP,
});
export const VEHICLES: FleetVehicleDto[] = CAR_SPECS.map(vehicle).sort((a, b) =>
  compareFleetVehicleCodes(a.code, b.code),
);

// ── the standing crews (gap map §9) ──────────────────────────────────────────────────────────────
interface Crew {
  mission: string | null;
  d1: string | null;
  d2: string | null;
  notes: string | null;
}
const crew = (
  mission: string | null,
  d1: string | null,
  d2: string | null = null,
  notes: string | null = null,
): Crew => ({ mission, d1, d2, notes });
/** By car CODE. A car missing here has no crew row at all (158). */
const INITIAL_CREWS: Readonly<Record<string, Crew>> = {
  '150': crew(
    MISSION.daily,
    P.samer,
    P.mahmoud,
    'خط بنوك الدقي والمهندسين — التحرك الساعة 7:30 صباحًا',
  ),
  '152': crew(MISSION.daily, P.mohamed, P.karimNabil),
  '163': crew(MISSION.daily, P.khaled, P.rami, 'تعود إلى خط الدقي بعد خروجها من الورشة'),
  '171': crew(MISSION.evening, P.ahmed),
  '176': crew(null, null),
  '214': crew(
    MISSION.daily,
    P.hesham,
    P.tarek,
    'السائق الثاني بديل في أيام الجمعة، ويُراجع الطقم مع مشرف الفرع أول كل شهر',
  ),
  '205': crew(MISSION.armoured, P.saeed, P.ayman),
  '231': crew(MISSION.ebag, P.waleed, P.hany),
  '247': crew(MISSION.daily, P.magdy, P.sabry),
  '262': crew(MISSION.travel, P.sherif, P.sayed),
  '305': crew(MISSION.atm, P.mostafa, P.nasser, 'تغذية ماكينات الصراف الآلي بمدينة نصر'),
  '318': crew(MISSION.daily, P.islam, P.amr),
  '340': crew(MISSION.travel, P.yasser),
  '376': crew(MISSION.travelStandby, null),
  '410': crew(MISSION.daily, P.emad, P.wael),
  '433': crew(null, P.zakaria, P.medhat),
  '118': crew(MISSION.errand, P.abdallah, null, 'سيارة مأموريات الإدارة الإقليمية'),
  '120': crew(null, P.adel),
  '133': crew(MISSION.standby, null),
  '199': crew(MISSION.daily, P.ehab),
};

/** The crews as the server holds them now — a «حفظ» writes here. */
const crews = new Map<string, Crew>(Object.entries(INITIAL_CREWS));

/**
 * The DAILY board's licence fact (not the standing screen's — owner Q1 ب): 410's «وائل رشاد عبد
 * الغني» and the free «حمدي عبد الستار رزق» hold expired licences, so today's «تعيين السيارات»
 * (`rosterToday`) flags them. 247's «صبري أنور الفقي» is the switched-off profile (`SWITCHED_OFF`):
 * the server keeps him out of the pool and refuses a save that touches 247 — the standing screen
 * says nothing more about either, as today.
 */
const DAILY_LICENCE_EXPIRED: ReadonlySet<string> = new Set([P.wael, P.hamdy]);

const branchOfCar = new Map(VEHICLES.map((car) => [car.id, car.branchId]));
const activeCars = VEHICLES.filter((car) => car.status === 'active');

const crewRow = (car: FleetVehicleDto): FleetFixedCrewRowDto => {
  const held = crews.get(car.code);
  return {
    vehicleId: car.id,
    code: car.code,
    plateNumber: car.plateNumber,
    typeId: car.typeId,
    inMaintenance: WORKSHOP_CODES.includes(car.code),
    missionTypeId: held?.mission ?? null,
    driver1EmployeeId: held?.d1 ?? null,
    driver2EmployeeId: held?.d2 ?? null,
    notes: held?.notes ?? null,
  };
};

/**
 * `GET /fleet/fixed-roster` as `FleetFixedRosterService.board` answers it: the ACTIVE cars the
 * reader's scope reaches, narrowed by the top bar's branch; the pool = every driving seat minus the
 * switched-off profiles, company-wide, each with the car its standing crew holds them on — across
 * EVERY crew, not only the board's.
 */
export const fixedBoard = (branchId: string | null): FleetFixedRosterDto => {
  const taken = new Map<string, string>();
  for (const [code, held] of crews) {
    for (const id of [held.d1, held.d2]) if (id !== null) taken.set(id, vehicleIdOf(code));
  }
  return {
    rows: activeCars.filter((car) => branchId === null || car.branchId === branchId).map(crewRow),
    drivers: PEOPLE.filter((person) => !SWITCHED_OFF.includes(person.employeeId)).map((person) => ({
      employeeId: person.employeeId,
      assignedVehicleId: taken.get(person.employeeId) ?? null,
    })),
  };
};

/** A «حفظ»: the changed rows, written over the crews (the service's upsert per car). */
const saveCrews = (
  rows: readonly {
    vehicleId: string;
    missionTypeId?: string | null;
    driver1EmployeeId?: string | null;
    driver2EmployeeId?: string | null;
    notes?: string | null;
  }[],
): number => {
  for (const row of rows) {
    const car = VEHICLES.find((candidate) => candidate.id === row.vehicleId);
    if (car === undefined) continue;
    crews.set(
      car.code,
      crew(
        row.missionTypeId ?? null,
        row.driver1EmployeeId ?? null,
        row.driver2EmployeeId ?? null,
        row.notes ?? null,
      ),
    );
  }
  return rows.length;
};

/**
 * `GET /fleet/roster?date=2026-11-17` — TODAY's DAILY board. Read by the hover cards («السائقون
 * اليوم», «السيارة المعيّنة اليوم») and drawn by the real «تعيين السيارات» for the side-by-side
 * reference shots. Stored (`planned`) rows: the standing crews, the workshop cars without drivers,
 * 247 without «صبري» (a switched-off profile is unavailable on the day — «الطاقم الثابت غير متاح»),
 * 410 keeping «وائل» (the licence rule only flags).
 */
export const rosterToday = (branchId: string | null): FleetRosterDayDto => {
  const board = fixedBoard(branchId);
  return {
    date: `${SAMPLE_TODAY}T00:00:00.000Z`,
    rows: board.rows.map((row) => {
      const free = !row.inMaintenance;
      const out = (id: string | null): string | null =>
        id !== null && SWITCHED_OFF.includes(id) ? null : id;
      const d1 = free ? out(row.driver1EmployeeId) : null;
      const d2 = free ? out(row.driver2EmployeeId) : null;
      const gap =
        free && row.driver2EmployeeId !== null && SWITCHED_OFF.includes(row.driver2EmployeeId)
          ? [
              {
                seat: 2 as const,
                employeeId: row.driver2EmployeeId,
                reason: 'profileInactive' as const,
              },
            ]
          : [];
      return {
        vehicleId: row.vehicleId,
        code: row.code,
        plateNumber: row.plateNumber,
        typeId: row.typeId,
        inMaintenance: row.inMaintenance,
        planned: true,
        missionTypeId: row.missionTypeId,
        driver1EmployeeId: d1,
        driver2EmployeeId: d2,
        notes: null,
        assignable: free,
        licenceExpired: false,
        manned: [d1, d2].some((id) => id !== null && !DAILY_LICENCE_EXPIRED.has(id)),
        crewGaps: gap,
        crewCovered: 0,
        stalePlan: false,
      };
    }),
    availableDrivers: board.drivers.map((driver) => ({
      employeeId: driver.employeeId,
      assignedVehicleId: driver.assignedVehicleId,
      licence: DAILY_LICENCE_EXPIRED.has(driver.employeeId) ? 'expired' : 'valid',
    })),
    unavailableDrivers: SWITCHED_OFF.map((employeeId) => ({
      employeeId,
      reason: 'profileInactive',
    })),
    licenceRule: 'flag',
  };
};

// ── the API, answered ────────────────────────────────────────────────────────────────────────────
type Meta = { page: number; pageSize: number; totalItems: number; totalPages: number };
type Envelope = { success: true; data: unknown; meta?: Meta };
const ok = (data: unknown, meta?: Meta): Envelope => ({
  success: true,
  data,
  ...(meta === undefined ? {} : { meta }),
});
const page = (items: readonly unknown[]): Envelope =>
  ok(items, {
    page: 1,
    pageSize: Math.max(100, items.length),
    totalItems: items.length,
    totalPages: 1,
  });

/**
 * One request → its answer, or `null` for a path this data set does not know (the caller logs it
 * and answers an empty list). `branchId` is the request's `X-Active-Branch`.
 */
export const answerSampleApi = (
  method: string,
  path: string,
  query: URLSearchParams,
  branchId: string | null,
  body: unknown,
): Envelope | null => {
  if (method === 'GET') {
    if (path === '/fleet/fixed-roster') return ok(fixedBoard(branchId));
    if (path === '/fleet/roster') return ok(rosterToday(branchId));
    if (path === '/fleet/catalog-items') {
      const kind = query.get('kind');
      if (kind === 'missionType') return page(MISSION_TYPES);
      if (kind === 'operation') return page(OPERATIONS);
      return page([]);
    }
    if (path === '/fleet/people') return ok(PEOPLE);
    if (path === '/fleet/vehicles') return page(VEHICLES);
    if (path === '/fleet/vehicle-types') return page(VEHICLE_TYPES);
    if (path === '/fleet/odometer/latest-readings') return ok([]);
    if (path === '/platform/branches/options') return ok(BRANCHES);
    if (path === '/platform/me/applications') return ok(APPLICATIONS);
    if (path === '/platform/settings/me' || path === '/platform/settings/definitions')
      return ok([]);
    if (path === '/platform/departments/options' || path === '/platform/sections/options')
      return ok([]);
    if (path === '/platform/notifications/unread-count') return ok({ count: 0 });
    if (path === '/platform/notifications') return page([]);
  }
  if (method === 'POST' && path === '/fleet/fixed-roster') {
    const rows = (body as { rows?: Parameters<typeof saveCrews>[0] } | null)?.rows ?? [];
    const changedCount = saveCrews(rows);
    return ok({ ...fixedBoard(branchId), changedCount });
  }
  return null;
};

/**
 * The service's two refusals a «حفظ» can meet on these figures (fixed-roster.service.ts save), as
 * the server words AND codes them (shared/errors: `ValidationError` → VALIDATION_FAILED, a
 * `ConflictError` with no code → DUPLICATE): a row seating a switched-off profile (400 — any save
 * that touches 247 while «صبري» sits on it; the screen flags nobody beforehand, owner Q1 ب, and the
 * draft is kept with today's refusal toast: T-16), and a row seating a driver another crew still holds on a car the payload does not
 * release (409 — the web has no friendly line for DUPLICATE, so the server's English sentence, with
 * the driver's internal number, is what the toast shows today: T-16). `null` when the save goes
 * through.
 */
export const refusalOf = (body: unknown): { status: number; body: unknown } | null => {
  const rows =
    (
      body as {
        rows?: {
          vehicleId: string;
          driver1EmployeeId?: string | null;
          driver2EmployeeId?: string | null;
        }[];
      } | null
    )?.rows ?? [];
  const wanted = rows.flatMap((row) =>
    [row.driver1EmployeeId ?? null, row.driver2EmployeeId ?? null].filter(
      (id): id is string => id !== null,
    ),
  );
  if (wanted.some((id) => SWITCHED_OFF.includes(id))) {
    return {
      status: 400,
      body: {
        success: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Validation failed',
          details: [
            {
              field: 'body.rows.driverEmployeeId',
              code: 'UNKNOWN',
              message: 'this driver’s fleet profile is inactive',
            },
          ],
        },
      },
    };
  }
  const sent = new Set(rows.map((row) => row.vehicleId));
  for (const [code, held] of crews) {
    if (sent.has(vehicleIdOf(code))) continue;
    const holder = [held.d1, held.d2].find((id) => id !== null && wanted.includes(id));
    if (holder !== undefined && holder !== null) {
      return {
        status: 409,
        body: {
          success: false,
          error: {
            code: 'DUPLICATE',
            message: `driver ${holder} already belongs to the fixed crew of vehicle ${code}; include that vehicle's row to release them`,
          },
        },
      };
    }
  }
  return null;
};

/** The branch a car belongs to (the shooter's arithmetic). */
export const branchOf = (vehicleId: string): string | null => branchOfCar.get(vehicleId) ?? null;

/** The permissions the page reads: a fleet dispatcher who plans (and a reader who only views). */
export const PLANNER_PERMISSIONS = [
  'fleetRoster.view',
  'fleetRoster.plan',
  'fleetDriver.view',
  'fleetVehicle.view',
  'branch.view',
] as const;
export const VIEWER_PERMISSIONS = PLANNER_PERMISSIONS.filter((key) => key !== 'fleetRoster.plan');
