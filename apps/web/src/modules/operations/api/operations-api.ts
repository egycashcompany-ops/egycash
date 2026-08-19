// Operations api/ surface (ADR-013): one typed function per backend endpoint, matching the
// Operations module's routes exactly — no mock data, no client-side fallbacks, and above all no
// business rules. Every page reads and writes through here.
//
// THE CLIENT IS NOT AUTHORITATIVE. The legacy screens carried their rules in browser JavaScript
// (crew double-booking, role detection, requirement filters — discovery §8.3, §8.2, §9). Those
// rules now live in the Operations domain, and this file only carries them across the wire. If a
// screen appears to need a rule the API does not expose, the rule belongs in the API.
//
// OP-B1 lands the reference-data surface (the legacy `/data_edit` screen — banks, branches,
// currencies). Later B slices add their endpoints beside these, never a second client.
import {
  MAX_PAGE_SIZE,
  type AssignSecuredDeliveryLeg,
  type CompleteOperationsShipment,
  type CreateOperationsArea,
  type CreateOperationsBank,
  type CreateOperationsBankBranch,
  type CreateOperationsCurrency,
  type CreateOperationsShipment,
  type DispatchSecuredShipments,
  type ListOperationsCrewRequirementsQuery,
  type ListSecuredBacklogQuery,
  type OperationsAreaDto,
  type OperationsBankBranchDto,
  type OperationsBankDto,
  type OperationsBankReportDto,
  type OperationsCaptainReportDto,
  type OperationsCrewAttendanceDayDto,
  type OperationsCrewBoardDto,
  type OperationsCrewDirectoryDto,
  type OperationsCrewRequirementsDto,
  type OperationsCurrencyDto,
  type OperationsDayBoardDto,
  type OperationsExecutionResultDto,
  type OperationsMobileDayDto,
  type OperationsShipmentDto,
  type OperationsStandingCrewBoardDto,
  type OperationsVaultCustodyDto,
  type OperationsVaultInventoryRowDto,
  type OperationsVaultReportDto,
  type Paginated,
  type PlanOperationsCrew,
  type ReceiveIntoVault,
  type SetOperationsCrewRequirements,
  type SetOperationsStandingCrew,
  type UpdateOperationsArea,
  type UpdateOperationsBank,
  type UpdateOperationsBankBranch,
  type UpdateOperationsCurrency,
  type UpdateOperationsShipment,
} from '@ecms/contracts';
import {
  api,
  buildQuery,
  del,
  get,
  getPage,
  patch,
  post,
  type QueryParams,
} from '../../../shared/lib/api-client';

export type OperationsListParams = QueryParams;

// ── Banks (legacy `banks`, the operational name only — discovery §11.3) ─────
export const listBanks = (params: OperationsListParams): Promise<Paginated<OperationsBankDto>> =>
  getPage<OperationsBankDto>(`/operations/banks${buildQuery(params)}`);
export const createBank = (body: CreateOperationsBank): Promise<OperationsBankDto> =>
  post<OperationsBankDto>('/operations/banks', body);
export const updateBank = (
  id: string,
  body: UpdateOperationsBank,
): Promise<OperationsBankDto> => patch<OperationsBankDto>(`/operations/banks/${id}`, body);

// ── Bank branches (the legacy "location" model — discovery §11.1) ───────────
export const listBankBranches = (
  params: OperationsListParams,
): Promise<Paginated<OperationsBankBranchDto>> =>
  getPage<OperationsBankBranchDto>(`/operations/bank-branches${buildQuery(params)}`);
export const createBankBranch = (
  body: CreateOperationsBankBranch,
): Promise<OperationsBankBranchDto> =>
  post<OperationsBankBranchDto>('/operations/bank-branches', body);
export const updateBankBranch = (
  id: string,
  body: UpdateOperationsBankBranch,
): Promise<OperationsBankBranchDto> =>
  patch<OperationsBankBranchDto>(`/operations/bank-branches/${id}`, body);

// ── Currencies (legacy: a string array on a singleton doc — quirk Q33) ──────
export const listCurrencies = (
  params: OperationsListParams,
): Promise<Paginated<OperationsCurrencyDto>> =>
  getPage<OperationsCurrencyDto>(`/operations/currencies${buildQuery(params)}`);
export const createCurrency = (body: CreateOperationsCurrency): Promise<OperationsCurrencyDto> =>
  post<OperationsCurrencyDto>('/operations/currencies', body);
export const updateCurrency = (
  id: string,
  body: UpdateOperationsCurrency,
): Promise<OperationsCurrencyDto> =>
  patch<OperationsCurrencyDto>(`/operations/currencies/${id}`, body);

/** Every branch of one bank, for the cascading pickers the shipment screens use. */
export const branchesOfBank = (bankId: string): Promise<Paginated<OperationsBankBranchDto>> =>
  getPage<OperationsBankBranchDto>(
    `/operations/bank-branches${buildQuery({ bankId, pageSize: MAX_PAGE_SIZE, sortBy: 'name', sortDir: 'asc' })}`,
  );

// ── Cash shipments + the daily board (B2 — legacy /main_ops) ────────────────

/**
 * The desk's working set for one day. The UNION of daily-collected and secured-delivered
 * shipments is decided by the SERVER (see the endpoint's own comment) — the client asks for a day
 * and renders what comes back. It never assembles the board from two list calls.
 */
export const getDayBoard = (date: string | null): Promise<OperationsDayBoardDto> =>
  get<OperationsDayBoardDto>(
    `/operations/shipments/day-board${date === null ? '' : buildQuery({ date })}`,
  );

export const listShipments = (
  params: OperationsListParams,
): Promise<Paginated<OperationsShipmentDto>> =>
  getPage<OperationsShipmentDto>(`/operations/shipments${buildQuery(params)}`);

export const getShipment = (id: string): Promise<OperationsShipmentDto> =>
  get<OperationsShipmentDto>(`/operations/shipments/${id}`);

export const createShipment = (body: CreateOperationsShipment): Promise<OperationsShipmentDto> =>
  post<OperationsShipmentDto>('/operations/shipments', body);

export const updateShipment = (
  id: string,
  body: UpdateOperationsShipment,
): Promise<OperationsShipmentDto> =>
  patch<OperationsShipmentDto>(`/operations/shipments/${id}`, body);

/**
 * The legacy receive toggle's two directions (contad_app.js:553-566), as two explicit endpoints.
 * Legacy flipped both from one cell and inferred the direction from the current value; the domain
 * makes each an act of its own, and one permission (`operationsShipment.complete`) covers both —
 * confirming and un-confirming delivery are the same decision.
 */
export const completeShipment = (
  id: string,
  body: CompleteOperationsShipment,
): Promise<OperationsShipmentDto> =>
  post<OperationsShipmentDto>(`/operations/shipments/${id}/complete`, body);

export const reopenShipment = (
  id: string,
  body: CompleteOperationsShipment,
): Promise<OperationsShipmentDto> =>
  post<OperationsShipmentDto>(`/operations/shipments/${id}/reopen`, body);

export const deleteShipment = (id: string): Promise<void> =>
  del<void>(`/operations/shipments/${id}`);

// ── Crew board, roster and requirements (B3 — legacy /tashghela + /requirement) ─────────────

/** The board for a day. No date → TOMORROW, resolved server-side (legacy :2239-2247). */
export const getCrewBoard = (date: string | null): Promise<OperationsCrewBoardDto> =>
  get<OperationsCrewBoardDto>(
    `/operations/crew-board${date === null ? '' : buildQuery({ date })}`,
  );

/**
 * Saving the board answers with the refreshed board in the same round trip, so the screen never
 * has to guess what the server made of the plan.
 */
export const planCrew = (
  body: PlanOperationsCrew,
): Promise<OperationsCrewBoardDto & { changedCount: number }> =>
  post<OperationsCrewBoardDto & { changedCount: number }>('/operations/crew-board', body);

/** The pool: the roster, with flags, and who is already taken on the requested day. */
export const getCrewDirectory = (date: string | null): Promise<OperationsCrewDirectoryDto> =>
  get<OperationsCrewDirectoryDto>(
    `/operations/crew-board/directory${date === null ? '' : buildQuery({ date })}`,
  );

export const listCrewRequirements = (
  params: ListOperationsCrewRequirementsQuery,
): Promise<Paginated<OperationsCrewRequirementsDto>> =>
  getPage<OperationsCrewRequirementsDto>(
    `/operations/crew-board/requirements${buildQuery(params as QueryParams)}`,
  );

const put = <T>(path: string, body: unknown): Promise<T> =>
  api<T>(path, { method: 'PUT', body: JSON.stringify(body) });

/** Upsert by employee — the legacy screen had no create/edit split, only a saved checkbox line. */
export const setCrewRequirements = (
  employeeId: string,
  body: SetOperationsCrewRequirements,
): Promise<OperationsCrewRequirementsDto> =>
  put<OperationsCrewRequirementsDto>(
    `/operations/crew-board/requirements/${employeeId}`,
    body,
  );

// ── The standing crew (الطاقم الثابت) ───────────────────────────────────────────────────────────
// No date on any of the three: that absence IS the entity. Both writes answer with the refreshed
// board, so the screen never has to guess what the server made of the change.

export const getStandingCrew = (): Promise<OperationsStandingCrewBoardDto> =>
  get<OperationsStandingCrewBoardDto>('/operations/standing-crew');

export const setStandingCrew = (
  body: SetOperationsStandingCrew,
): Promise<OperationsStandingCrewBoardDto & { changedCount: number }> =>
  put<OperationsStandingCrewBoardDto & { changedCount: number }>('/operations/standing-crew', body);

/** Take a vehicle out of the cash-transfer fleet. Touches no day that has already been planned. */
export const removeStandingCrew = (
  vehicleId: string,
): Promise<OperationsStandingCrewBoardDto> =>
  del<OperationsStandingCrewBoardDto>(`/operations/standing-crew/${vehicleId}`);

export const removeCrewRequirements = (employeeId: string): Promise<void> =>
  del<void>(`/operations/crew-board/requirements/${employeeId}`);

// ── Secured shipments and the vault (B4) ────────────────────────────────────
//
// Four legacy screens, one backend surface, split by OWNER: Operations plans and assigns
// (`operationsShipment.*`), the treasury receives and releases (`operationsVault.*`). That split
// is the whole point of the Treasury boundary and is why these are separate calls, not one.

/** `/mohsana` — the open backlog: every secured shipment not yet completed, NO date filter. */
export const listSecuredBacklog = (
  params: ListSecuredBacklogQuery,
): Promise<Paginated<OperationsShipmentDto>> =>
  getPage<OperationsShipmentDto>(
    `/operations/secured/backlog${buildQuery(params as QueryParams)}`,
  );

/** `/tash4ela_mohasana` + `/deliver_mohsana` — held shipments due for delivery on a date. */
export const listSecuredDue = (date: string): Promise<OperationsShipmentDto[]> =>
  get<OperationsShipmentDto[]>(`/operations/secured/due${buildQuery({ date })}`);

/** `/vault1` — everything currently held. No date filter, deliberately (Q32 PRESERVE). */
export const listVaultInventory = (
  params: OperationsListParams,
): Promise<Paginated<OperationsVaultInventoryRowDto>> =>
  getPage<OperationsVaultInventoryRowDto>(`/operations/secured/vault${buildQuery(params)}`);

/** `/receive_mohsana` — into the vault, under the two-man rule (Q2 NORMALIZE). */
export const receiveIntoVault = (
  id: string,
  body: ReceiveIntoVault,
): Promise<OperationsVaultCustodyDto> =>
  post<OperationsVaultCustodyDto>(`/operations/secured/${id}/receive`, body);

/** `/tash4ela_mohasana` — the legacy leader2 + car_num2 pair, as the delivery leg. */
export const assignSecuredDelivery = (
  id: string,
  body: AssignSecuredDeliveryLeg,
): Promise<unknown> => post(`/operations/secured/${id}/assign-delivery`, body);

/** `/deliver_mohsana/data` — release and dispatch a vehicle's load, in ONE transaction. */
export const dispatchSecured = (body: DispatchSecuredShipments): Promise<unknown> =>
  post('/operations/secured/dispatch', body);

// ── Reports + attendance (B5) ───────────────────────────────────────────────────────────────────

/** `/ops_report` — one row per captain over a date range. */
export const getCaptainReport = (
  params: { from: string; to: string },
): Promise<OperationsCaptainReportDto> =>
  get<OperationsCaptainReportDto>(`/operations/reports/captains${buildQuery(params)}`);

/** `/ops_bank_report` — the same figures keyed on the bank. */
export const getBankReport = (
  params: { from: string; to: string },
): Promise<OperationsBankReportDto> =>
  get<OperationsBankReportDto>(`/operations/reports/banks${buildQuery(params)}`);

/**
 * The crew's attendance for a day. No legacy equivalent for cash-transfer crew — the legacy
 * `/fleet_attendance` screen is Fleet's and covers drivers only (discovery §2.2/§10.2).
 */
export const getCrewAttendance = (date: string): Promise<OperationsCrewAttendanceDayDto> =>
  get<OperationsCrewAttendanceDayDto>(`/operations/crew-board/attendance${buildQuery({ date })}`);

/**
 * `/data_edit` city list — the suggestion source behind a branch's operational area (B6).
 * Legacy stored the STRING the user picked, so this list feeds a datalist, not a foreign key.
 */
export const listOperationsAreas = (
  params: OperationsListParams,
): Promise<Paginated<OperationsAreaDto>> =>
  getPage<OperationsAreaDto>(`/operations/areas${buildQuery(params)}`);

export const createOperationsArea = (body: CreateOperationsArea): Promise<OperationsAreaDto> =>
  post<OperationsAreaDto>('/operations/areas', body);

export const updateOperationsArea = (
  id: string,
  body: UpdateOperationsArea,
): Promise<OperationsAreaDto> => patch<OperationsAreaDto>(`/operations/areas/${id}`, body);

/** `/vault1_reports` — the vault roll-up. NO date range, deliberately (Q32 PRESERVE). */
export const getVaultReport = (): Promise<OperationsVaultReportDto> =>
  get<OperationsVaultReportDto>('/operations/reports/vault');

// ── Captain mobile (Phase C) ────────────────────────────────────────────────
//
// THE CAPTAIN IS NEVER NAMED BY THE CLIENT. There is no captain parameter on any call below, and
// there is none on the server either: `my-day` and every execution act resolve the employee from
// the token (`resolveSelfEmployee`, mobile.service.ts). That is why cross-captain isolation is a
// property of the API's SHAPE rather than a filter somebody has to remember — and it is why this
// file has no `captainId` to pass even if a screen wanted to.

/** The captain's own ordered day. No date → today, resolved server-side. */
export const getMyDay = (date: string | null): Promise<OperationsMobileDayDto> =>
  get<OperationsMobileDayDto>(
    `/operations/mobile/my-day${date === null ? '' : buildQuery({ date })}`,
  );

/**
 * The four execution acts (OP-7). The stop is addressed by its ASSIGNMENT id; the body is empty
 * because the ACT is the whole message — no coordinates, no free text, no captain.
 *
 * `version` is deliberately not sent. The authoritative guard is the server's compare-and-swap on
 * the execution state — a transition is legal from exactly one state, so a racing caller's
 * precondition is already gone — and a phone should not have to track document versions to make a
 * legal move (see `OperationsExecutionBodySchema`).
 */
const executionAct =
  (act: 'start' | 'pickup' | 'deliver' | 'complete') =>
  (assignmentId: string): Promise<OperationsExecutionResultDto> =>
    post<OperationsExecutionResultDto>(`/operations/mobile/stops/${assignmentId}/${act}`, {});

export const startStop = executionAct('start');
export const confirmStopPickup = executionAct('pickup');
export const confirmStopDelivery = executionAct('deliver');
export const completeStop = executionAct('complete');
