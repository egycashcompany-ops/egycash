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
  type CancelVaultReceipt,
  type CompleteOperationsShipment,
  type ConfirmSecuredPickup,
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
  type OperationsDeletedShipmentsDto,
  type OperationsExecutionResultDto,
  type OperationsMobileDayDto,
  type OperationsShipmentDto,
  type OperationsShipmentHistoryDto,
  type OperationsShipmentType,
  type OperationsSecuredBoardDto,
  type OperationsSecuredDispatchBoardDto,
  type OperationsSecuredDistributionDto,
  type OperationsSecuredDistributionSaveDto,
  type OperationsShipmentLogDto,
  type OperationsStandingCrewBoardDto,
  type OperationsVaultInventoryRowDto,
  type OperationsVaultHeldReportDto,
  type OperationsVaultQueueDto,
  type OperationsVaultReportDto,
  type OrderOperationsCurrencies,
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
  fetchBlob,
  get,
  getPage,
  patch,
  post,
  upload,
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
/**
 * «اعملى فى شاشة البيانات المرجعية ان اقدر اعدل زى شاشة الحركة بالظبط» — the currencies' dragged
 * order, saved as Fleet's catalogs save theirs (`orderCatalog`): the ids in their new order; 204.
 */
export const orderCurrencies = (body: OrderOperationsCurrencies): Promise<void> =>
  put<void>('/operations/currencies/order', body);

/** One branch by id — how a shipment's edit form names the branch it holds, and that branch's bank. */
export const getBankBranch = (id: string): Promise<OperationsBankBranchDto> =>
  get<OperationsBankBranchDto>(`/operations/bank-branches/${id}`);

/**
 * One bank's ACTIVE branches matching what was typed — the shipment form's branch picker.
 *
 * Searched on the server, never filtered from a fetched page: a large bank has hundreds of
 * branches, a page holds a hundred, and filtering "the first hundred" would hide the rest — the
 * operator would then add a branch that already exists. Inactive branches are left out because the
 * server refuses to book a shipment on one.
 */
export const searchBranchesOfBank = (
  bankId: string,
  search: string,
): Promise<Paginated<OperationsBankBranchDto>> =>
  getPage<OperationsBankBranchDto>(
    `/operations/bank-branches${buildQuery({
      bankId,
      search: search.trim() === '' ? undefined : search.trim(),
      isActive: true,
      pageSize: MAX_PAGE_SIZE,
      sortBy: 'name',
      sortDir: 'asc',
    })}`,
  );

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

/**
 * The shipments history — the day board's rows over a range of days, both bounds inclusive. The
 * same server-side union and enrichment as `getDayBoard`; a range holding too many shipments is
 * refused (`OPERATIONS_SHIPMENT_HISTORY_TOO_LARGE`), never cut short.
 *
 * Round 12 — `type` keeps one shipment type: «سجل الخزينة» asks `secured` (the secured half of the
 * union, collected OR delivered in the range, any stage; the cap counted after the filter). Left
 * out, both — «سجل الشحنات», unchanged.
 */
export const getShipmentHistory = (
  range: { from: string; to: string },
  type?: OperationsShipmentType,
): Promise<OperationsShipmentHistoryDto> =>
  get<OperationsShipmentHistoryDto>(
    `/operations/shipments/history${buildQuery(type === undefined ? range : { ...range, type })}`,
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

/**
 * «هيكون فى سجل بالاكشنز اللى حصلت على الشحنة» — one shipment's story, oldest first: every
 * recorded act on it and on its legs and vault custody, with every value already in words. It
 * answers for a deleted shipment too.
 */
export const getShipmentLog = (id: string): Promise<OperationsShipmentLogDto> =>
  get<OperationsShipmentLogDto>(`/operations/shipments/${id}/log`);

/**
 * «اعملى ايقون اقدر اجيب منه اللى اتمسح» — the shipments deleted from the board days of a range
 * (the history's own range and rules), newest deleted first — one shipment type with `type`, as
 * the history (Round 12: «سجل الخزينة»'s deleted محصنات).
 */
export const getDeletedShipments = (
  range: { from: string; to: string },
  type?: OperationsShipmentType,
): Promise<OperationsDeletedShipmentsDto> =>
  get<OperationsDeletedShipmentsDto>(
    `/operations/shipments/deleted${buildQuery(type === undefined ? range : { ...range, type })}`,
  );

/** Bring a deleted shipment back onto its day — the undo of `deleteShipment`, on the same grant. */
export const restoreShipment = (id: string): Promise<OperationsShipmentDto> =>
  post<OperationsShipmentDto>(`/operations/shipments/${id}/restore`, {});

// «صورة الإيصال» — the photo of a shipment's paper receipt, one per shipment (the Fleet receipts'
// image endpoints, on the shipment). Upload answers the shipment with its new `receiptImage`; a
// second upload REPLACES the photo (a new version of the same file, so the old one stays in the
// file's history). The bytes are guarded (ADR-023), so they are fetched with the session and never
// put in an `<img src>` as a URL.
export const uploadShipmentReceiptImage = (
  id: string,
  file: File,
): Promise<OperationsShipmentDto> => {
  const form = new FormData();
  form.append('file', file);
  return upload<OperationsShipmentDto>(`/operations/shipments/${id}/receipt-image`, form);
};

export const fetchShipmentReceiptImage = (id: string): Promise<Blob> =>
  fetchBlob(`/operations/shipments/${id}/receipt-image`);

export const deleteShipmentReceiptImage = (id: string): Promise<OperationsShipmentDto> =>
  del<OperationsShipmentDto>(`/operations/shipments/${id}/receipt-image`);

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

/**
 * «شاشة الشحنات المحصنة» — the same open backlog as BOARD ROWS (branches with their banks, the crew
 * of the leg the row is on, each row's `securedStage`), so the screen draws them on the day board's
 * own table. No parameters: every open محصنة, whatever its dates.
 */
export const getSecuredBoard = (): Promise<OperationsSecuredBoardDto> =>
  get<OperationsSecuredBoardDto>('/operations/secured/board');

/** `/tash4ela_mohasana` + `/deliver_mohsana` — held shipments due for delivery on a date. */
export const listSecuredDue = (date: string): Promise<OperationsShipmentDto[]> =>
  get<OperationsShipmentDto[]>(`/operations/secured/due${buildQuery({ date })}`);

/** `/vault1` — everything currently held. No date filter, deliberately (Q32 PRESERVE). */
export const listVaultInventory = (
  params: OperationsListParams,
): Promise<Paginated<OperationsVaultInventoryRowDto>> =>
  getPage<OperationsVaultInventoryRowDto>(`/operations/secured/vault${buildQuery(params)}`);

/**
 * «شاشة استلام الخزينه» — the vault's receive queue, as board rows. By default (Round 13) what the
 * vault can receive now — every secured draft collected today or earlier, white or yellow, every
 * yellow one — and those received into the vault today (green); `all` adds the white ones booked
 * for a later collection day. `all=false` is the default, so it is not sent.
 */
export const getVaultQueue = (all: boolean): Promise<OperationsVaultQueueDto> =>
  get<OperationsVaultQueueDto>(`/operations/secured/vault-queue${buildQuery(all ? { all } : {})}`);

/**
 * `/receive_mohsana` — into the vault, under the two-man rule (Q2 NORMALIZE). Answers the SHIPMENT
 * (now `inVault`, its new version) — not its custody, which this file had typed it as before Round
 * 10 although the route never sent one. Since Round 13 from ANY draft, white or yellow
 * (`OPERATIONS_SECURED_RECEIVABLE_STAGES` — «والخزنه تستلم عادي»); the receipt records no pickup,
 * so one nobody handed over keeps «لم يتم الاستلام» in the vault screen's pickup column.
 */
export const receiveIntoVault = (
  id: string,
  body: ReceiveIntoVault,
): Promise<OperationsShipmentDto> =>
  post<OperationsShipmentDto>(`/operations/secured/${id}/receive`, body);

/**
 * Round 10 — the desk's pickup ✓ on the secured screen («تم الاستلام من العمليات») and its undo,
 * which takes back whoever's ✓ it was, the captain's included, until the vault receives. Each
 * answers the shipment with its new version. The undo is a DELETE that carries a body: the version
 * it was read at, as every write here does.
 */
export const confirmSecuredPickup = (
  id: string,
  body: ConfirmSecuredPickup,
): Promise<OperationsShipmentDto> =>
  post<OperationsShipmentDto>(`/operations/secured/${id}/pickup`, body);

export const undoSecuredPickup = (
  id: string,
  body: ConfirmSecuredPickup,
): Promise<OperationsShipmentDto> =>
  del<OperationsShipmentDto>(`/operations/secured/${id}/pickup`, body);

/**
 * Round 10 — «بس صلاحية خاصة تقدر تلغى استلام الخزينة»: the vault's receipt cancelled, with the
 * reason, while the shipment is still in the vault (`operationsVault.cancelReceipt`). It goes back to
 * draft — yellow, editable and receivable again — and the custody is voided, kept as history.
 */
export const cancelVaultReceipt = (
  id: string,
  body: CancelVaultReceipt,
): Promise<OperationsShipmentDto> =>
  post<OperationsShipmentDto>(`/operations/secured/${id}/cancel-receipt`, body);

/**
 * Round 10 — «صرف الخزينة»: EVERY secured shipment in the vault, whatever its delivery day («كله يبقى
 * موجود فى تاريخ يتفلتر»), as board rows; `date` narrows it to one delivery day. Without a day the
 * key is left out — the server refuses an empty `date=`.
 */
export const getSecuredDispatchBoard = (
  date: string | null,
): Promise<OperationsSecuredDispatchBoardDto> =>
  get<OperationsSecuredDispatchBoardDto>(
    `/operations/secured/dispatch-board${buildQuery(date === null || date === '' ? {} : { date })}`,
  );

/** `/tash4ela_mohasana` — the legacy leader2 + car_num2 pair, as the delivery leg. */
export const assignSecuredDelivery = (
  id: string,
  body: AssignSecuredDeliveryLeg,
): Promise<unknown> => post(`/operations/secured/${id}/assign-delivery`, body);

/** `/deliver_mohsana/data` — release and dispatch a vehicle's load, in ONE transaction. */
export const dispatchSecured = (body: DispatchSecuredShipments): Promise<unknown> =>
  post('/operations/secured/dispatch', body);

// ── Round 12 (web B): «توزيع المحصنات» and «تسليم المحصنات» ─────────────────────────────────────────

/**
 * One read for both screens — the day's vans and its محصنات, each with its delivery leg as it stands
 * and the vans its area points at. `date` null → the server's today (Cairo); never an empty `date=`
 * (a 400).
 */
export const getSecuredDistribution = (
  date: string | null,
): Promise<OperationsSecuredDistributionDto> =>
  get<OperationsSecuredDistributionDto>(
    `/operations/secured/distribution${buildQuery(date === null || date === '' ? {} : { date })}`,
  );

/** «حفظ» — every change of the screen in ONE request, all or nothing (`distributionSaveBody`). */
export const saveSecuredDistribution = (body: {
  date: string;
  changes: { shipmentId: string; crewAssignmentId: string | null; captainEmployeeId: string | null; version: number | null }[];
}): Promise<OperationsSecuredDistributionSaveDto> =>
  post<OperationsSecuredDistributionSaveDto>('/operations/secured/distribution', body);

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

/**
 * `/vault1_reports` — the vault roll-up over a period, both days inclusive, as the captain and bank
 * reports take theirs. Legacy's two dates filtered nothing (Q32); the owner gave them a meaning —
 * «يجيب اللى اتسلم واللى متسلمش ويجيب البداية كل اول شهر»: every محصنة RECEIVED into the vault in
 * the period, whether it has gone out since or not, judged on the receipt's Cairo day.
 */
export const getVaultReport = (
  params: { from: string; to: string },
): Promise<OperationsVaultReportDto> =>
  get<OperationsVaultReportDto>(`/operations/reports/vault${buildQuery(params)}`);

/**
 * Round 12 — «تقرير الخزينة»: what the vault holds NOW, per main bank, through the same roll-up as
 * the period's (`getVaultReport`). Live, so it takes no parameter at all (the server refuses one).
 */
export const getVaultHeldReport = (): Promise<OperationsVaultHeldReportDto> =>
  get<OperationsVaultHeldReportDto>('/operations/reports/vault/held');

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
