// Settlements & Review → Preparation → Control & Supplies, the api/ surface (ADR-013, the
// `map-api.ts` shape): one typed function per endpoint of `/atm/settlements`, `/atm/preparation`
// and `/atm/control` (docs/12-planning/atm-settlements-phase1.md §6.3, §9.2). No mock data and no
// client-side rules: whose plans are in reach, which branch a page works in, what a line may still
// do — the server decides; this file only carries it.
//
// Three things are shaped by the spec rather than by REST habit:
//   · `branchId` on a read only NARROWS inside the caller's reach (DS-22, DS-23). The pages send
//     the work branch the context resolved; a body `branchId` must equal it, or 400
//     `BRANCH_MISMATCH`;
//   · a print is a POST that records the print and returns its snapshot (DS-21). The caller opens
//     the print tab BEFORE calling it, inside the click (§8);
//   · the Full list import is multipart and every field is a string (§6.3): `'true'`, the JSON of
//     `previewRevisions`. The work branch is always sent as `branchId`.
import {
  type AddAtmPlanLines,
  type AddAtmSpareLine,
  type AssignAtmRoutes,
  type AtmBankCode,
  type AtmCassetteLayoutDetailDto,
  type AtmCassetteLayoutsDto,
  type AtmControlDayDto,
  type AtmControlPrint,
  type AtmControlRouteDto,
  type AtmHandoverPrintDto,
  type AtmLayoutImportMode,
  type AtmLayoutImportPreviewRevision,
  type AtmLayoutImportResultDto,
  type AtmLayoutImportRunSummaryDto,
  type AtmLineReason,
  type AtmNotePrintDto,
  type AtmPlanAddResultDto,
  type AtmPlanLineDto,
  type AtmPreparationContextDto,
  type AtmPreparationLineDto,
  type AtmReceiptPrintDto,
  type AtmRepTapeExportDto,
  type AtmRoutesFromZones,
  type AtmRoutesFromZonesResultDto,
  type AtmRoutesPrintDto,
  type AtmSettlementContextDto,
  type AtmSettlementPage,
  type AtmSettlementPlanDto,
  type AtmSettlementPrint,
  type AtmSettlementPrintKind,
  type AtmSpareUse,
  type AtmStandardLoadDto,
  type AtmVersion,
  type CreateAtmPlan,
  type CreateAtmRoute,
  type IssueAtmPlan,
  type SaveAtmCassetteLayout,
  type SaveAtmPreparation,
  type SaveAtmStandardLoad,
  type UpdateAtmPlanLine,
  type UpdateAtmRoute,
} from '@ecms/contracts';
import { buildQuery, del, get, patch, post, put, upload } from '../../../shared/lib/api-client';

const SETTLEMENTS = '/atm/settlements';
const PREPARATION = '/atm/preparation';
const CONTROL = '/atm/control';

/** A bank's records in the work branch (S2, S3, S7). */
export interface SettlementBankParams {
  bankCode: AtmBankCode;
  branchId: string | null;
}

/** The plan of one bank and day (S11). */
export interface SettlementPlanParams extends SettlementBankParams {
  /** 'YYYY-MM-DD'. */
  date: string;
}

/** Preparation's and Control's day (P1, C1); without a date the server suggests one (DS-25). */
export interface SettlementDayParams {
  date: string | null;
  branchId?: string | null;
}

const bankQuery = ({ bankCode, branchId }: SettlementBankParams): string =>
  buildQuery({ bankCode, branchId: branchId ?? undefined });

// ── /atm/settlements: context and layouts (S1–S6) ───────────────────────────
/** S1 — the page's work branch, the enabled banks and what the caller may do there. */
export const getSettlementContext = (page: AtmSettlementPage): Promise<AtmSettlementContextDto> =>
  get<AtmSettlementContextDto>(`${SETTLEMENTS}/context${buildQuery({ page })}`);

export const listCassetteLayouts = (params: SettlementBankParams): Promise<AtmCassetteLayoutsDto> =>
  get<AtmCassetteLayoutsDto>(`${SETTLEMENTS}/layouts${bankQuery(params)}`);

/** S3 — the last ten import runs, counts only (the rows exist only in a preview, §5.3). */
export const listLayoutImportRuns = (
  params: SettlementBankParams,
): Promise<AtmLayoutImportRunSummaryDto[]> =>
  get<AtmLayoutImportRunSummaryDto[]>(`${SETTLEMENTS}/layouts/import/runs${bankQuery(params)}`);

export interface LayoutImportOptions {
  bankCode: AtmBankCode;
  /** The work branch, always (§9.2). */
  branchId: string;
  /** Absent: a preview. */
  apply?: {
    mode: AtmLayoutImportMode;
    /** The preview's hash: proves the applied bytes are the previewed bytes. */
    fileSha256: string;
    /** The revisions the preview saw; a row changed since is a conflict and is not written. */
    previewRevisions: readonly AtmLayoutImportPreviewRevision[];
    standardLoads: boolean;
  };
}

/**
 * S4 — upload a bank's master workbook: once to preview, then the SAME `File` again to apply. Every
 * field is a string; the server applies only when `apply` is exactly `'true'` (§6.3).
 */
export const importLayouts = (
  file: File,
  options: LayoutImportOptions,
): Promise<AtmLayoutImportResultDto> => {
  const form = new FormData();
  form.append('file', file);
  form.append('bankCode', options.bankCode);
  form.append('branchId', options.branchId);
  if (options.apply !== undefined) {
    form.append('apply', 'true');
    form.append('mode', options.apply.mode);
    form.append('fileSha256', options.apply.fileSha256);
    form.append('previewRevisions', JSON.stringify(options.apply.previewRevisions));
    if (options.apply.standardLoads) form.append('standardLoads', 'true');
  }
  return upload<AtmLayoutImportResultDto>(`${SETTLEMENTS}/layouts/import`, form);
};

export const getCassetteLayout = (machineId: string): Promise<AtmCassetteLayoutDetailDto> =>
  get<AtmCassetteLayoutDetailDto>(`${SETTLEMENTS}/layouts/${machineId}`);

export const saveCassetteLayout = (
  machineId: string,
  body: SaveAtmCassetteLayout,
): Promise<AtmCassetteLayoutDetailDto> =>
  put<AtmCassetteLayoutDetailDto>(`${SETTLEMENTS}/layouts/${machineId}`, body);

// ── Standard loads (S7–S10) ─────────────────────────────────────────────────
export const listStandardLoads = (params: SettlementBankParams): Promise<AtmStandardLoadDto[]> =>
  get<AtmStandardLoadDto[]>(`${SETTLEMENTS}/standard-loads${bankQuery(params)}`);

export const createStandardLoad = (body: SaveAtmStandardLoad): Promise<AtmStandardLoadDto> =>
  post<AtmStandardLoadDto>(`${SETTLEMENTS}/standard-loads`, body);

export const updateStandardLoad = (
  id: string,
  body: SaveAtmStandardLoad,
): Promise<AtmStandardLoadDto> =>
  put<AtmStandardLoadDto>(`${SETTLEMENTS}/standard-loads/${id}`, body);

export const deleteStandardLoad = (id: string, version: number): Promise<void> =>
  del<void>(`${SETTLEMENTS}/standard-loads/${id}${buildQuery({ version })}`);

// ── Plans (S11–S21) ─────────────────────────────────────────────────────────
export const getPlanByDay = ({
  bankCode,
  date,
  branchId,
}: SettlementPlanParams): Promise<{ plan: AtmSettlementPlanDto | null }> =>
  get<{ plan: AtmSettlementPlanDto | null }>(
    `${SETTLEMENTS}/plans${buildQuery({ bankCode, date, branchId: branchId ?? undefined })}`,
  );

export const createPlan = (body: CreateAtmPlan): Promise<AtmSettlementPlanDto> =>
  post<AtmSettlementPlanDto>(`${SETTLEMENTS}/plans`, body);

export const getPlan = (planId: string): Promise<AtmSettlementPlanDto> =>
  get<AtmSettlementPlanDto>(`${SETTLEMENTS}/plans/${planId}`);

/** S14 — a batch of machine codes; the refused ones come back with their reason, row by row. */
export const addPlanLines = (planId: string, body: AddAtmPlanLines): Promise<AtmPlanAddResultDto> =>
  post<AtmPlanAddResultDto>(`${SETTLEMENTS}/plans/${planId}/lines`, body);

export const addSpareLine = (planId: string, body: AddAtmSpareLine): Promise<AtmPlanLineDto> =>
  post<AtmPlanLineDto>(`${SETTLEMENTS}/plans/${planId}/spare-lines`, body);

const lineBase = (planId: string, lineId: string): string =>
  `${SETTLEMENTS}/plans/${planId}/lines/${lineId}`;

export const updatePlanLine = (
  planId: string,
  lineId: string,
  body: UpdateAtmPlanLine,
): Promise<AtmPlanLineDto> => patch<AtmPlanLineDto>(lineBase(planId, lineId), body);

export const deletePlanLine = (planId: string, lineId: string, version: number): Promise<void> =>
  del<void>(`${lineBase(planId, lineId)}${buildQuery({ version })}`);

/** S18 — the draft lines named, at their versions; a line with errors blocks the whole issue. */
export const issuePlan = (planId: string, body: IssueAtmPlan): Promise<AtmSettlementPlanDto> =>
  post<AtmSettlementPlanDto>(`${SETTLEMENTS}/plans/${planId}/issue`, body);

export const reopenPlanLine = (
  planId: string,
  lineId: string,
  body: AtmLineReason,
): Promise<AtmPlanLineDto> => post<AtmPlanLineDto>(`${lineBase(planId, lineId)}/reopen`, body);

export const cancelPlanLine = (
  planId: string,
  lineId: string,
  body: AtmLineReason,
): Promise<AtmPlanLineDto> => post<AtmPlanLineDto>(`${lineBase(planId, lineId)}/cancel`, body);

/** S21 — the machine a spare set was later loaded into (S-9). */
export const recordSpareUse = (
  planId: string,
  lineId: string,
  body: AtmSpareUse,
): Promise<AtmPlanLineDto> => post<AtmPlanLineDto>(`${lineBase(planId, lineId)}/spare-use`, body);

// ── Prints (S22) ────────────────────────────────────────────────────────────
/** What each S22 kind answers (§6.7). */
export interface AtmSettlementPrintResults {
  notes: AtmNotePrintDto;
  receipt: AtmReceiptPrintDto;
  handover: AtmHandoverPrintDto;
  repTape: AtmRepTapeExportDto;
}

/**
 * S22 — a print is a WRITE of record (it counts the Notes, records what «بيان التغذية» covered,
 * and audits); the tab is opened before this is called, and closed when it fails (§8).
 */
export const printPlan = <K extends AtmSettlementPrintKind>(
  planId: string,
  body: Extract<AtmSettlementPrint, { kind: K }>,
): Promise<AtmSettlementPrintResults[K]> =>
  post<AtmSettlementPrintResults[K]>(`${SETTLEMENTS}/plans/${planId}/prints`, body);

// ── /atm/preparation (P1–P5) ────────────────────────────────────────────────
export const getPreparationContext = ({
  date,
  branchId,
}: SettlementDayParams): Promise<AtmPreparationContextDto> =>
  get<AtmPreparationContextDto>(
    `${PREPARATION}/context${buildQuery({ date: date ?? undefined, branchId: branchId ?? undefined })}`,
  );

export const listPreparationLines = (planId: string): Promise<AtmPreparationLineDto[]> =>
  get<AtmPreparationLineDto[]>(`${PREPARATION}/plans/${planId}/lines`);

/** P3 — the raw scanned values; the server cleans them (§3.5) and answers duplicates as warnings. */
export const savePreparation = (
  lineId: string,
  body: SaveAtmPreparation,
): Promise<{ line: AtmPreparationLineDto }> =>
  put<{ line: AtmPreparationLineDto }>(`${PREPARATION}/lines/${lineId}`, body);

export const markPrepared = (
  lineId: string,
  body: AtmVersion,
): Promise<{ line: AtmPreparationLineDto }> =>
  post<{ line: AtmPreparationLineDto }>(`${PREPARATION}/lines/${lineId}/prepared`, body);

export const reopenPreparation = (
  lineId: string,
  body: AtmVersion,
): Promise<{ line: AtmPreparationLineDto }> =>
  post<{ line: AtmPreparationLineDto }>(`${PREPARATION}/lines/${lineId}/reopen`, body);

// ── /atm/control (C1–C7) ────────────────────────────────────────────────────
export const getControlDay = ({ date, branchId }: SettlementDayParams): Promise<AtmControlDayDto> =>
  get<AtmControlDayDto>(
    `${CONTROL}/day${buildQuery({ date: date ?? undefined, branchId: branchId ?? undefined })}`,
  );

export const createRoute = (body: CreateAtmRoute): Promise<AtmControlRouteDto> =>
  post<AtmControlRouteDto>(`${CONTROL}/routes`, body);

/** C3 — «إنشاء الخطوط من القطاعات»: one route per map zone, needs the map's view key too. */
export const routesFromZones = (body: AtmRoutesFromZones): Promise<AtmRoutesFromZonesResultDto> =>
  post<AtmRoutesFromZonesResultDto>(`${CONTROL}/routes/from-zones`, body);

export const updateRoute = (routeId: string, body: UpdateAtmRoute): Promise<AtmControlRouteDto> =>
  put<AtmControlRouteDto>(`${CONTROL}/routes/${routeId}`, body);

export const deleteRoute = (routeId: string, version: number): Promise<void> =>
  del<void>(`${CONTROL}/routes/${routeId}${buildQuery({ version })}`);

/** C6 — each move carries the route it expects the line to be on (`from`); a stale one is MOVED. */
export const assignRoutes = (body: AssignAtmRoutes): Promise<AtmControlRouteDto[]> =>
  put<AtmControlRouteDto[]>(`${CONTROL}/assignments`, body);

/** What each C7 kind answers (§6.9). */
export interface AtmControlPrintResults {
  handover: AtmHandoverPrintDto;
  routes: AtmRoutesPrintDto;
}

export const printControl = <K extends AtmControlPrint['kind']>(
  body: Extract<AtmControlPrint, { kind: K }>,
): Promise<AtmControlPrintResults[K]> => post<AtmControlPrintResults[K]>(`${CONTROL}/prints`, body);
