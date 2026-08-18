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
  type CompleteOperationsShipment,
  type CreateOperationsBank,
  type CreateOperationsBankBranch,
  type CreateOperationsCurrency,
  type OperationsBankBranchDto,
  type OperationsBankDto,
  type CreateOperationsShipment,
  type ListOperationsCrewRequirementsQuery,
  type OperationsCrewBoardDto,
  type OperationsCrewDirectoryDto,
  type OperationsCrewRequirementsDto,
  type OperationsCurrencyDto,
  type OperationsDayBoardDto,
  type OperationsShipmentDto,
  type Paginated,
  type UpdateOperationsBank,
  type UpdateOperationsBankBranch,
  type UpdateOperationsCurrency,
  type AssignSecuredDeliveryLeg,
  type DispatchSecuredShipments,
  type ListSecuredBacklogQuery,
  type OperationsVaultCustodyDto,
  type PlanOperationsCrew,
  type ReceiveIntoVault,
  type SetOperationsCrewRequirements,
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
    `/operations/bank-branches${buildQuery({ bankId, pageSize: 200, sortBy: 'name', sortDir: 'asc' })}`,
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
): Promise<Paginated<OperationsVaultCustodyDto>> =>
  get<Paginated<OperationsVaultCustodyDto>>(`/operations/secured/vault${buildQuery(params)}`);

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
