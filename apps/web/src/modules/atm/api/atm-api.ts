// ATM api/ surface (ADR-013): one typed function per backend endpoint, matching the ATM module's
// routes exactly — no mock data, no client-side fallbacks, no business rules. The legacy screens
// carried their rules in browser JavaScript and hidden form fields (port doc §1); those rules now
// live in the ATM domain and this file only carries them across the wire.
import {
  type AtmBankDto,
  type AtmLeaderOptionDto,
  type AtmMachineCreateResultDto,
  type AtmMachineDto,
  type AtmMachinesSummaryDto,
  type AtmMailAcceptMetaDto,
  type AtmMailAcceptRefusalDto,
  type AtmMailRestoreMetaDto,
  type AtmMailRestoreRefusalDto,
  type AtmMailTicketDto,
  type AtmDailyReportDto,
  type AtmMailUnreadCountDto,
  type AtmMaintenanceDto,
  type AtmOperationFacetsDto,
  type AtmRefLabelDto,
  type AtmRefLabelOptionsDto,
  type AtmReplenishmentDto,
  type BulkCreateAtmMachines,
  type BulkCreateAtmMachinesResultDto,
  type BulkDeleteAtmMachines,
  type BulkDeleteAtmMachinesResultDto,
  type BulkUpdateAtmMaintenances,
  type BulkUpdateAtmReplenishments,
  type CreateAtmBankInput,
  type CreateAtmMachine,
  type CreateAtmRefLabel,
  type OpenAtmMaintenancesResultDto,
  type OpenAtmReplenishmentsResultDto,
  type Paginated,
  type ReassignAtmMachineArea,
  type UpdateAtmBank,
  type UpdateAtmMachine,
  type UpdateAtmMachineArea,
  type UpdateAtmRefLabel,
  ATM_BULK_MAX_IDS,
  ATM_MACHINES_BULK_MAX,
  ATM_OPEN_MAX_ROWS,
  normalizeAtmMachineCode,
  joinAtmNameList,
  type AtmMachineSyncDto,
} from '@ecms/contracts';
import {
  buildQuery,
  del,
  get,
  getPage,
  patch,
  post,
  postWithMeta,
  upload,
  type QueryParams,
} from '../../../shared/lib/api-client';
import {
  BranchChangedError,
  branchPin,
  firstOfEach,
  inPasteBatches,
  refusedBeforeWriting,
  type PasteRun,
} from '../lib/paste-batches';

export { refusedBeforeWriting };

export type AtmListParams = QueryParams;

/**
 * A checked selection, sent in consecutive requests of at most `ATM_BULK_MAX_IDS` ids — the open
 * boards are read whole, so «select all» can check more rows than one bulk request carries. In
 * order, one request at a time; the answers are joined as one. A batch that fails stops the run and
 * fails the action — the batches before it stand, as each request always stood on its own, and
 * their realtime signals refresh the board.
 */
export const inBulkBatches = async <T>(
  ids: readonly string[],
  send: (batch: string[]) => Promise<T>,
): Promise<T[]> => {
  const answers: T[] = [];
  for (let start = 0; start < ids.length; start += ATM_BULK_MAX_IDS) {
    answers.push(await send(ids.slice(start, start + ATM_BULK_MAX_IDS)));
  }
  return answers;
};

/** What an open request answers — the part every batch adds to the joined answer. */
interface OpenAnswer<Opened> {
  opened: Opened[];
  unknownCodes: string[];
  alreadyOpenCodes: string[];
}

/** An open form's lines, sent in batches: the joined answer, and where the run stopped. */
export interface OpenLinesOutcome<Opened, Row> extends OpenAnswer<Opened> {
  /**
   * Lines certainly NOT opened, safe to send again: the lines after the request that failed, and
   * that request's own lines when the API refused it (`refusedBeforeWriting`). Empty when every
   * line went.
   */
  unsent: Row[];
  /**
   * The lines of a request that failed WITHOUT a refusal — a 5xx, a dropped connection, a page that
   * is not the API's. The server may have opened some or all of them (it writes row by row), so
   * they are never handed back to be sent again as if they had not gone.
   */
  uncertain: Row[];
  /** Why the run stopped; `null` when every line went. */
  failure: unknown;
}

/**
 * An open form's lines, sent in consecutive requests of at most `ATM_OPEN_MAX_ROWS` — a paste can
 * hold more lines than one open request carries (the owner, 2026-11-01: 700 replenishments at once
 * were refused whole, 100 or 200 at a time opened). In order, one request at a time; the answers
 * are joined as one, in the lines' order.
 *
 * A request the API REFUSES wrote nothing: if it is the first, the open fails exactly as before
 * (nothing was opened anywhere); if a later one, the run stops and its lines join `unsent` with
 * the rest. A request that fails WITHOUT an answer stops the run too, but its own lines go to
 * `uncertain`: some may have opened, and a replenishment (since OD-1b) or a maintenance (since
 * OD-1c) opens again on every send, so the form must not offer them as unsent. Either way what the
 * earlier requests opened stands. `alreadyOpenCodes` is joined as the answers carry it — always
 * empty since OD-1c.
 */
export const openInBatches = async <Row, Opened>(
  rows: readonly Row[],
  send: (batch: Row[]) => Promise<OpenAnswer<Opened>>,
): Promise<OpenLinesOutcome<Opened, Row>> => {
  const outcome: OpenLinesOutcome<Opened, Row> = {
    opened: [],
    unknownCodes: [],
    alreadyOpenCodes: [],
    unsent: [],
    uncertain: [],
    failure: null,
  };
  // Each request resolves the acting branch from the top bar: a switch between two requests stops
  // the run before the next one, whose lines then come back as unsent (they never went).
  const pin = branchPin();
  for (let start = 0; start < rows.length; start += ATM_OPEN_MAX_ROWS) {
    const end = start + ATM_OPEN_MAX_ROWS;
    if (start > 0 && pin.moved()) {
      return { ...outcome, unsent: rows.slice(start), failure: new BranchChangedError() };
    }
    let answer: OpenAnswer<Opened>;
    try {
      answer = await send(rows.slice(start, end));
    } catch (error) {
      if (refusedBeforeWriting(error)) {
        if (start === 0) throw error;
        return { ...outcome, unsent: rows.slice(start), failure: error };
      }
      return {
        ...outcome,
        uncertain: rows.slice(start, end),
        unsent: rows.slice(end),
        failure: error,
      };
    }
    outcome.opened.push(...answer.opened);
    outcome.unknownCodes.push(...answer.unknownCodes);
    outcome.alreadyOpenCodes.push(...answer.alreadyOpenCodes);
  }
  return outcome;
};

// ── Machines (legacy `atm` master — /all_atm + /data_edit_atm) ──────────────
export const listMachines = (params: AtmListParams): Promise<Paginated<AtmMachineDto>> =>
  getPage<AtmMachineDto>(`/atm/machines${buildQuery(params)}`);
/** The list's whole answer counted, and its dropdowns' sources — the same filters as the list. */
export const machinesSummary = (params: AtmListParams): Promise<AtmMachinesSummaryDto> =>
  get<AtmMachinesSummaryDto>(`/atm/machines/summary${buildQuery(params)}`);
/**
 * A machines file (Bank, ID, ATM Name, Area) compared with the branch the top bar points at — and,
 * with `apply` and the comparison's `fileSha256`, the branch made to match it. The SAME `File` is
 * posted both times; the server refuses (409) bytes that are not the ones compared.
 */
export const syncMachinesFromFile = (
  file: File,
  options: { apply: boolean; fileSha256?: string; planDigest?: string },
): Promise<AtmMachineSyncDto> => {
  const form = new FormData();
  form.append('file', file);
  if (options.apply) form.append('apply', 'true');
  if (options.fileSha256 !== undefined) form.append('fileSha256', options.fileSha256);
  // The comparison the reader approved — the server writes nothing if the branch moved since.
  if (options.planDigest !== undefined) form.append('planDigest', options.planDigest);
  return upload<AtmMachineSyncDto>('/atm/machines/sync', form);
};

export const bulkCreateMachines = (
  body: BulkCreateAtmMachines,
): Promise<BulkCreateAtmMachinesResultDto> =>
  post<BulkCreateAtmMachinesResultDto>('/atm/machines/bulk', body);
export const bulkDeleteMachines = (
  body: BulkDeleteAtmMachines,
): Promise<BulkDeleteAtmMachinesResultDto> =>
  post<BulkDeleteAtmMachinesResultDto>('/atm/machines/bulk-delete', body);

export type BulkMachineRow = BulkCreateAtmMachines['machines'][number];

/**
 * The data-edit bulk add for any number of lines (2026-11-01): the first line of each code (the
 * server keeps the first of a repeated code too — split, a later repeat would read as «مسجلة من
 * قبل»), in requests of `ATM_MACHINES_BULK_MAX`, one bank and area for all, the acting branch
 * pinned (`inPasteBatches`). Safe to send again: a machine added already comes back skipped.
 */
export const bulkCreateMachinesInBatches = (
  body: BulkCreateAtmMachines,
): Promise<PasteRun<BulkMachineRow, BulkCreateAtmMachinesResultDto>> =>
  inPasteBatches(
    firstOfEach(body.machines, (row) => normalizeAtmMachineCode(row.machineCode)).kept,
    ATM_MACHINES_BULK_MAX,
    (machines) => bulkCreateMachines({ bankName: body.bankName, area: body.area, machines }),
    // A 423 (a branch move began), 409 or 404 can come after earlier rows were written.
    { pinBranch: true, refusalWritesNothing: false },
  );

/**
 * The data-edit bulk delete for any number of codes: each code once (normalized, as the server
 * reads it), in requests of `ATM_MACHINES_BULK_MAX`, the acting branch pinned. Safe to send again:
 * a machine deleted already comes back as an unknown code.
 */
export const bulkDeleteMachinesInBatches = (
  machineCodes: readonly string[],
): Promise<PasteRun<string, BulkDeleteAtmMachinesResultDto>> =>
  inPasteBatches(
    firstOfEach(
      machineCodes.map(normalizeAtmMachineCode).filter((code) => code !== ''),
      (code) => code,
    ).kept,
    ATM_MACHINES_BULK_MAX,
    (batch) => bulkDeleteMachines({ machineCodes: batch }),
    { pinBranch: true, refusalWritesNothing: false },
  );
export const reassignMachineArea = (body: ReassignAtmMachineArea): Promise<AtmMachineDto> =>
  post<AtmMachineDto>('/atm/machines/reassign-area', body);
/**
 * A data-edit add (DEC-36): the machine, whether an archived code was brought back, and what the
 * server recorded in the Efficiency register as a side effect — the dialog's toast says which.
 */
export const createMachine = (body: CreateAtmMachine): Promise<AtmMachineCreateResultDto> =>
  post<AtmMachineCreateResultDto>('/atm/machines', body);
export const updateMachine = (id: string, body: UpdateAtmMachine): Promise<AtmMachineDto> =>
  patch<AtmMachineDto>(`/atm/machines/${id}`, body);
/** The Operations area move (`atmMachine.moveArea`): the area only, by id, versioned. */
export const updateMachineArea = (id: string, body: UpdateAtmMachineArea): Promise<AtmMachineDto> =>
  patch<AtmMachineDto>(`/atm/machines/${id}/area`, body);

// ── Reference label lists (legacy `atm_data_lists.bank[]` / `.area[]`) ──────
export const listRefLabels = (
  kind: 'bank' | 'area',
  params: AtmListParams,
): Promise<Paginated<AtmRefLabelDto>> =>
  getPage<AtmRefLabelDto>(`/atm/ref-labels/${kind}${buildQuery(params)}`);
export const createRefLabel = (
  kind: 'bank' | 'area',
  body: CreateAtmRefLabel,
): Promise<AtmRefLabelDto> => post<AtmRefLabelDto>(`/atm/ref-labels/${kind}`, body);
export const updateRefLabel = (
  kind: 'bank' | 'area',
  id: string,
  body: UpdateAtmRefLabel,
): Promise<AtmRefLabelDto> => patch<AtmRefLabelDto>(`/atm/ref-labels/${kind}/${id}`, body);
export const deleteRefLabel = (kind: 'bank' | 'area', id: string): Promise<void> =>
  del<void>(`/atm/ref-labels/${kind}/${id}`);
/**
 * What the data-edit dialogs offer for ONE branch, whole (no page cap): the catalog banks and the
 * branch's spellings, its areas with both names, whether an add there reaches the register, and
 * the bank texts its machines carry that map to no bank. No `branchId` = the acting branch.
 */
export const refLabelOptions = (branchId: string | null): Promise<AtmRefLabelOptionsDto> =>
  get<AtmRefLabelOptionsDto>(
    `/atm/ref-labels/options${branchId === null ? '' : buildQuery({ branchId })}`,
  );

// ── Bank catalog (DEC-35 — the company-wide `atm_banks`; no DELETE, archive instead) ──
export const listBanks = (): Promise<AtmBankDto[]> => get<AtmBankDto[]>('/atm/banks');
export const createBank = (body: CreateAtmBankInput): Promise<AtmBankDto> =>
  post<AtmBankDto>('/atm/banks', body);
export const updateBank = (code: string, body: UpdateAtmBank): Promise<AtmBankDto> =>
  patch<AtmBankDto>(`/atm/banks/${encodeURIComponent(code)}`, body);

// ── Replenishments (legacy /atm_replenishment ± done) ───────────────────────
export const listOpenReplenishments = (
  params: AtmListParams,
): Promise<Paginated<AtmReplenishmentDto>> =>
  getPage<AtmReplenishmentDto>(`/atm/replenishments${buildQuery(params)}`);
export const replenishmentFacets = (banks: readonly string[]): Promise<AtmOperationFacetsDto> =>
  get<AtmOperationFacetsDto>(
    `/atm/replenishments/facets${banks.length === 0 ? '' : buildQuery({ banks: joinAtmNameList(banks) })}`,
  );
export const listDoneReplenishments = (
  params: AtmListParams,
): Promise<Paginated<AtmReplenishmentDto>> =>
  getPage<AtmReplenishmentDto>(`/atm/replenishments/done${buildQuery(params)}`);
export type ReplenishmentOpenRow = { machineCode: string; scheduleTime: string | null };
/** The open form's lines, in batches of `ATM_OPEN_MAX_ROWS` (`openInBatches`), one date for all. */
export const openReplenishments = (body: {
  rows: ReplenishmentOpenRow[];
  forceDate: string | null;
}): Promise<OpenLinesOutcome<AtmReplenishmentDto, ReplenishmentOpenRow>> =>
  openInBatches(body.rows, (rows) =>
    post<OpenAtmReplenishmentsResultDto>('/atm/replenishments/open', {
      rows,
      forceDate: body.forceDate,
    }),
  );
export const closeReplenishments = async (ids: string[]): Promise<AtmReplenishmentDto[]> =>
  (
    await inBulkBatches(ids, (batch) =>
      post<AtmReplenishmentDto[]>('/atm/replenishments/close', { ids: batch }),
    )
  ).flat();
export const reopenReplenishment = (id: string, version: number): Promise<AtmReplenishmentDto> =>
  post<AtmReplenishmentDto>(`/atm/replenishments/${id}/reopen`, { version });
export const updateReplenishment = (
  id: string,
  body: {
    scheduleTime?: string | null;
    openedAt?: string;
    leaderName?: string | null;
    cascadeLeader?: boolean;
    version: number;
  },
): Promise<AtmReplenishmentDto> => patch<AtmReplenishmentDto>(`/atm/replenishments/${id}`, body);
export const bulkUpdateReplenishments = async (
  body: BulkUpdateAtmReplenishments,
): Promise<AtmReplenishmentDto[]> =>
  (
    await inBulkBatches(body.ids, (batch) =>
      patch<AtmReplenishmentDto[]>('/atm/replenishments/bulk', { ...body, ids: batch }),
    )
  ).flat();
export const deleteReplenishments = async (ids: string[]): Promise<{ removed: number }> => ({
  removed: (
    await inBulkBatches(ids, (batch) =>
      post<{ removed: number }>('/atm/replenishments/delete', { ids: batch }),
    )
  ).reduce((sum, answer) => sum + answer.removed, 0),
});

// ── Maintenance (legacy /atm_maintenance ± done) ────────────────────────────
export const listOpenMaintenances = (
  params: AtmListParams,
): Promise<Paginated<AtmMaintenanceDto>> =>
  getPage<AtmMaintenanceDto>(`/atm/maintenances${buildQuery(params)}`);
export const maintenanceFacets = (banks: readonly string[]): Promise<AtmOperationFacetsDto> =>
  get<AtmOperationFacetsDto>(
    `/atm/maintenances/facets${banks.length === 0 ? '' : buildQuery({ banks: joinAtmNameList(banks) })}`,
  );
export const listDoneMaintenances = (
  params: AtmListParams,
): Promise<Paginated<AtmMaintenanceDto>> =>
  getPage<AtmMaintenanceDto>(`/atm/maintenances/done${buildQuery(params)}`);
/**
 * The leader pickers' names — the ATM department's working employees (or the departments ticked on
 * /atm/settings). Read by either board: the maintenance close and both kinds' edit dialogs.
 */
export const leaderOptions = (): Promise<AtmLeaderOptionDto[]> =>
  get<AtmLeaderOptionDto[]>('/atm/leaders/options');
export type MaintenanceOpenRow = {
  machineCode: string;
  serviceType: string | null;
  referenceNumber: string | null;
};
/** The open form's lines, in batches of `ATM_OPEN_MAX_ROWS` (`openInBatches`), one time for all. */
export const openMaintenances = (body: {
  rows: MaintenanceOpenRow[];
  openedAt: string | null;
}): Promise<OpenLinesOutcome<AtmMaintenanceDto, MaintenanceOpenRow>> =>
  openInBatches(body.rows, (rows) =>
    post<OpenAtmMaintenancesResultDto>('/atm/maintenances/open', {
      rows,
      openedAt: body.openedAt,
    }),
  );
export const closeMaintenances = async (
  ids: string[],
  leaderEmployeeId: string,
): Promise<AtmMaintenanceDto[]> =>
  (
    await inBulkBatches(ids, (batch) =>
      post<AtmMaintenanceDto[]>('/atm/maintenances/close', { ids: batch, leaderEmployeeId }),
    )
  ).flat();
export const reopenMaintenance = (id: string, version: number): Promise<AtmMaintenanceDto> =>
  post<AtmMaintenanceDto>(`/atm/maintenances/${id}/reopen`, { version });
export const updateMaintenance = (
  id: string,
  body: {
    serviceType?: string | null;
    notes?: string | null;
    openedAt?: string;
    leaderName?: string | null;
    cascadeLeader?: boolean;
    version: number;
  },
): Promise<AtmMaintenanceDto> => patch<AtmMaintenanceDto>(`/atm/maintenances/${id}`, body);
export const bulkUpdateMaintenances = async (
  body: BulkUpdateAtmMaintenances,
): Promise<AtmMaintenanceDto[]> =>
  (
    await inBulkBatches(body.ids, (batch) =>
      patch<AtmMaintenanceDto[]>('/atm/maintenances/bulk', { ...body, ids: batch }),
    )
  ).flat();
export const deleteMaintenances = async (ids: string[]): Promise<{ removed: number }> => ({
  removed: (
    await inBulkBatches(ids, (batch) =>
      post<{ removed: number }>('/atm/maintenances/delete', { ids: batch }),
    )
  ).reduce((sum, answer) => sum + answer.removed, 0),
});

// ── Mail tickets (legacy /mail_maintenance ± log) ───────────────────────────
export const listPendingMailTickets = (
  params: AtmListParams,
): Promise<Paginated<AtmMailTicketDto>> =>
  getPage<AtmMailTicketDto>(`/atm/mail-tickets${buildQuery(params)}`);
export const listMailLog = (params: AtmListParams): Promise<Paginated<AtmMailTicketDto>> =>
  getPage<AtmMailTicketDto>(`/atm/mail-tickets/log${buildQuery(params)}`);
export const mailUnreadCount = (): Promise<AtmMailUnreadCountDto> =>
  get<AtmMailUnreadCountDto>('/atm/mail-tickets/unread-count');
/**
 * Accept: `data` is the tickets ACCEPTED. `meta.refused` named the tickets the owner's rule left
 * pending (their machine already had an open maintenance — port doc OD-1); since OD-1c
 * (2026-11-02) such a mail is accepted and opens another maintenance, so the server answers it
 * empty. It is still read, so the answer keeps one shape.
 *
 * In batches, as the boards' checked rows are (`inBulkBatches`): the pending list is read whole
 * since 2026-10-28, so the rows checked are no longer bounded by one page of a hundred, while one
 * request still carries at most `ATM_BULK_MAX_IDS`. The batches run in order.
 */
export const acceptMailTickets = async (
  ids: string[],
): Promise<{ accepted: AtmMailTicketDto[]; refused: AtmMailAcceptRefusalDto[] }> => {
  const answers = await inBulkBatches(ids, (batch) =>
    postWithMeta<AtmMailTicketDto[], AtmMailAcceptMetaDto>('/atm/mail-tickets/accept', {
      ids: batch,
    }),
  );
  return {
    accepted: answers.flatMap((answer) => answer.data),
    refused: answers.flatMap((answer) => answer.meta?.refused ?? []),
  };
};
/** Reject, in batches for the same reason as accept. */
export const rejectMailTickets = async (ids: string[]): Promise<AtmMailTicketDto[]> =>
  (
    await inBulkBatches(ids, (batch) =>
      post<AtmMailTicketDto[]>('/atm/mail-tickets/reject', { ids: batch }),
    )
  ).flat();
/**
 * Restore, from the log (2026-10-28): `data` is the tickets put back to PENDING — an accepted one's
 * open maintenance removed with it; a ticket whose maintenance is already closed comes back in
 * `meta.refused` and stays decided.
 */
export const restoreMailTickets = async (
  ids: string[],
): Promise<{ restored: AtmMailTicketDto[]; refused: AtmMailRestoreRefusalDto[] }> => {
  const { data, meta } = await postWithMeta<AtmMailTicketDto[], AtmMailRestoreMetaDto>(
    '/atm/mail-tickets/restore',
    { ids },
  );
  return { restored: data, refused: meta?.refused ?? [] };
};

// ── Daily report (legacy /reports_atm) ──────────────────────────────────────
/** The counts over a period of Cairo days, both included — one day when `from` is `to`. */
export const atmDailyReport = (period: { from: string; to: string }): Promise<AtmDailyReportDto> =>
  get<AtmDailyReportDto>(`/atm/reports/daily${buildQuery(period)}`);
