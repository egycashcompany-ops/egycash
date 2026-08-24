// ATM api/ surface (ADR-013): one typed function per backend endpoint, matching the ATM module's
// routes exactly — no mock data, no client-side fallbacks, no business rules. The legacy screens
// carried their rules in browser JavaScript and hidden form fields (port doc §1); those rules now
// live in the ATM domain and this file only carries them across the wire.
import {
  type AtmLeaderOptionDto,
  type AtmMachineDto,
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
  type UpdateAtmRefLabel,
} from '@ecms/contracts';
import {
  buildQuery,
  del,
  get,
  getPage,
  patch,
  post,
  type QueryParams,
} from '../../../shared/lib/api-client';

export type AtmListParams = QueryParams;

// ── Machines (legacy `atm` master — /all_atm + /data_edit_atm) ──────────────
export const listMachines = (params: AtmListParams): Promise<Paginated<AtmMachineDto>> =>
  getPage<AtmMachineDto>(`/atm/machines${buildQuery(params)}`);
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
    `/atm/replenishments/facets${banks.length === 0 ? '' : buildQuery({ banks: banks.join(',') })}`,
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
export const closeReplenishments = (ids: string[]): Promise<AtmReplenishmentDto[]> =>
  post<AtmReplenishmentDto[]>('/atm/replenishments/close', { ids });
export const reopenReplenishment = (id: string, version: number): Promise<AtmReplenishmentDto> =>
  post<AtmReplenishmentDto>(`/atm/replenishments/${id}/reopen`, { version });
export const updateReplenishment = (
  id: string,
  body: {
    scheduleTime?: string | null;
    openedAt?: string;
    leaderName?: string | null;
    version: number;
  },
): Promise<AtmReplenishmentDto> => patch<AtmReplenishmentDto>(`/atm/replenishments/${id}`, body);
export const bulkUpdateReplenishments = (
  body: BulkUpdateAtmReplenishments,
): Promise<AtmReplenishmentDto[]> => patch<AtmReplenishmentDto[]>('/atm/replenishments/bulk', body);
export const deleteReplenishments = (ids: string[]): Promise<{ removed: number }> =>
  post<{ removed: number }>('/atm/replenishments/delete', { ids });

// ── Maintenance (legacy /atm_maintenance ± done) ────────────────────────────
export const listOpenMaintenances = (
  params: AtmListParams,
): Promise<Paginated<AtmMaintenanceDto>> =>
  getPage<AtmMaintenanceDto>(`/atm/maintenances${buildQuery(params)}`);
export const maintenanceFacets = (banks: readonly string[]): Promise<AtmOperationFacetsDto> =>
  get<AtmOperationFacetsDto>(
    `/atm/maintenances/facets${banks.length === 0 ? '' : buildQuery({ banks: banks.join(',') })}`,
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
export const closeMaintenances = (
  ids: string[],
  leaderEmployeeId: string,
): Promise<AtmMaintenanceDto[]> =>
  post<AtmMaintenanceDto[]>('/atm/maintenances/close', { ids, leaderEmployeeId });
export const reopenMaintenance = (id: string, version: number): Promise<AtmMaintenanceDto> =>
  post<AtmMaintenanceDto>(`/atm/maintenances/${id}/reopen`, { version });
export const updateMaintenance = (
  id: string,
  body: {
    serviceType?: string | null;
    notes?: string | null;
    openedAt?: string;
    leaderName?: string | null;
    version: number;
  },
): Promise<AtmMaintenanceDto> => patch<AtmMaintenanceDto>(`/atm/maintenances/${id}`, body);
export const bulkUpdateMaintenances = (
  body: BulkUpdateAtmMaintenances,
): Promise<AtmMaintenanceDto[]> => patch<AtmMaintenanceDto[]>('/atm/maintenances/bulk', body);
export const deleteMaintenances = (ids: string[]): Promise<{ removed: number }> =>
  post<{ removed: number }>('/atm/maintenances/delete', { ids });

// ── Mail tickets (legacy /mail_maintenance ± log) ───────────────────────────
export const listPendingMailTickets = (
  params: AtmListParams,
): Promise<Paginated<AtmMailTicketDto>> =>
  getPage<AtmMailTicketDto>(`/atm/mail-tickets${buildQuery(params)}`);
export const listMailLog = (params: AtmListParams): Promise<Paginated<AtmMailTicketDto>> =>
  getPage<AtmMailTicketDto>(`/atm/mail-tickets/log${buildQuery(params)}`);
export const mailUnreadCount = (): Promise<AtmMailUnreadCountDto> =>
  get<AtmMailUnreadCountDto>('/atm/mail-tickets/unread-count');
export const acceptMailTickets = (ids: string[]): Promise<AtmMailTicketDto[]> =>
  post<AtmMailTicketDto[]>('/atm/mail-tickets/accept', { ids });
export const rejectMailTickets = (ids: string[]): Promise<AtmMailTicketDto[]> =>
  post<AtmMailTicketDto[]>('/atm/mail-tickets/reject', { ids });

// ── Daily report (legacy /reports_atm) ──────────────────────────────────────
export const atmDailyReport = (date: string | null): Promise<AtmDailyReportDto> =>
  get<AtmDailyReportDto>(`/atm/reports/daily${date === null ? '' : buildQuery({ date })}`);
