// ATM api/ surface (ADR-013): one typed function per backend endpoint, matching the ATM module's
// routes exactly — no mock data, no client-side fallbacks, no business rules. The legacy screens
// carried their rules in browser JavaScript and hidden form fields (port doc §1); those rules now
// live in the ATM domain and this file only carries them across the wire.
import {
  type AtmLeaderOptionDto,
  type AtmMachineDto,
  type AtmMachinesSummaryDto,
  type AtmMailAcceptMetaDto,
  type AtmMailAcceptRefusalDto,
  type AtmMailTicketDto,
  type AtmDailyReportDto,
  type AtmMailUnreadCountDto,
  type AtmMaintenanceDto,
  type AtmOperationFacetsDto,
  type AtmRefLabelDto,
  type AtmReplenishmentDto,
  type BulkCreateAtmMachines,
  type BulkCreateAtmMachinesResultDto,
  type BulkDeleteAtmMachines,
  type BulkDeleteAtmMachinesResultDto,
  type BulkUpdateAtmMaintenances,
  type BulkUpdateAtmReplenishments,
  type CreateAtmMachine,
  type CreateAtmRefLabel,
  type OpenAtmMaintenancesResultDto,
  type OpenAtmReplenishmentsResultDto,
  type Paginated,
  type ReassignAtmMachineArea,
  type UpdateAtmMachine,
  type UpdateAtmMachineArea,
  type UpdateAtmRefLabel,
  ATM_BULK_MAX_IDS,
  joinAtmNameList,
} from '@ecms/contracts';
import {
  buildQuery,
  del,
  get,
  getPage,
  patch,
  post,
  postWithMeta,
  type QueryParams,
} from '../../../shared/lib/api-client';

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

// ── Machines (legacy `atm` master — /all_atm + /data_edit_atm) ──────────────
export const listMachines = (params: AtmListParams): Promise<Paginated<AtmMachineDto>> =>
  getPage<AtmMachineDto>(`/atm/machines${buildQuery(params)}`);
/** The list's whole answer counted, and its dropdowns' sources — the same filters as the list. */
export const machinesSummary = (params: AtmListParams): Promise<AtmMachinesSummaryDto> =>
  get<AtmMachinesSummaryDto>(`/atm/machines/summary${buildQuery(params)}`);
export const bulkCreateMachines = (
  body: BulkCreateAtmMachines,
): Promise<BulkCreateAtmMachinesResultDto> =>
  post<BulkCreateAtmMachinesResultDto>('/atm/machines/bulk', body);
export const bulkDeleteMachines = (
  body: BulkDeleteAtmMachines,
): Promise<BulkDeleteAtmMachinesResultDto> =>
  post<BulkDeleteAtmMachinesResultDto>('/atm/machines/bulk-delete', body);
export const reassignMachineArea = (body: ReassignAtmMachineArea): Promise<AtmMachineDto> =>
  post<AtmMachineDto>('/atm/machines/reassign-area', body);
export const createMachine = (body: CreateAtmMachine): Promise<AtmMachineDto> =>
  post<AtmMachineDto>('/atm/machines', body);
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
export const openReplenishments = (body: {
  rows: { machineCode: string; scheduleTime: string | null }[];
  forceDate: string | null;
}): Promise<OpenAtmReplenishmentsResultDto> =>
  post<OpenAtmReplenishmentsResultDto>('/atm/replenishments/open', body);
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
export const maintenanceLeaderOptions = (): Promise<AtmLeaderOptionDto[]> =>
  get<AtmLeaderOptionDto[]>('/atm/maintenances/leader-options');
export const openMaintenances = (body: {
  rows: { machineCode: string; serviceType: string | null; referenceNumber: string | null }[];
  openedAt: string | null;
}): Promise<OpenAtmMaintenancesResultDto> =>
  post<OpenAtmMaintenancesResultDto>('/atm/maintenances/open', body);
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
 * Accept: `data` is the tickets ACCEPTED; the tickets the owner's rule refused — their machine
 * already has an open maintenance — come back in `meta.refused` and stay pending (port doc OD-1).
 */
export const acceptMailTickets = async (
  ids: string[],
): Promise<{ accepted: AtmMailTicketDto[]; refused: AtmMailAcceptRefusalDto[] }> => {
  const { data, meta } = await postWithMeta<AtmMailTicketDto[], AtmMailAcceptMetaDto>(
    '/atm/mail-tickets/accept',
    { ids },
  );
  return { accepted: data, refused: meta?.refused ?? [] };
};
export const rejectMailTickets = (ids: string[]): Promise<AtmMailTicketDto[]> =>
  post<AtmMailTicketDto[]>('/atm/mail-tickets/reject', { ids });

// ── Daily report (legacy /reports_atm) ──────────────────────────────────────
export const atmDailyReport = (date: string | null): Promise<AtmDailyReportDto> =>
  get<AtmDailyReportDto>(`/atm/reports/daily${date === null ? '' : buildQuery({ date })}`);
