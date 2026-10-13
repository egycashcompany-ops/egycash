// Efficiency register api/ surface (ADR-013, the `atm-api.ts` shape): one typed function per
// endpoint of `/atm/register` (spec §5.7, §8.2) — no mock data, no client-side rules. Everything the
// register decides (status, coupling to the Operations list, who may see a key code) is decided by
// the server; this file only carries it across the wire.
//
// Two calls are shaped by the secrets rule (D3) rather than by REST habit:
//   · the reveal is a POST — it has a side effect (an audit row) and must never be prefetched;
//   · the export is a server-streamed CSV, because only the server can leave the K/S columns out
//     for everybody and audit the download.
import {
  type AtmRegisterBranchOptionsDto,
  type AtmRegisterEntryDto,
  type AtmRegisterImportCategory,
  type AtmRegisterImportResultDto,
  type AtmRegisterImportRunDto,
  type AtmRegisterMetaDto,
  type AtmRegisterReportDto,
  type AtmRegisterRevealDto,
  type AtmRegisterWriteResultDto,
  type HandoverAtmRegisterEntry,
  type Paginated,
  type ReceiveAtmRegisterEntry,
  type ReceivePendingAtmRegisterEntry,
  type UpdateAtmRegisterEntry,
} from '@ecms/contracts';
import {
  buildQuery,
  del,
  downloadBlob,
  get,
  getPage,
  patch,
  post,
  upload,
  type QueryParams,
} from '../../../shared/lib/api-client';

/** Query params of the list and the export — `ListAtmRegisterEntriesQuerySchema` on the wire. */
export type RegisterListParams = QueryParams;

const ENTRIES = '/atm/register/entries';

// ── Entries ─────────────────────────────────────────────────────────────────
export const listRegisterEntries = (
  params: RegisterListParams,
): Promise<Paginated<AtmRegisterEntryDto>> =>
  getPage<AtmRegisterEntryDto>(`${ENTRIES}${buildQuery(params)}`);

export const getRegisterEntry = (id: string): Promise<AtmRegisterEntryDto> =>
  get<AtmRegisterEntryDto>(`${ENTRIES}/${id}`);

/** Receive (a start date is set) or record a pending entry (no start date). */
export const receiveRegisterEntry = (
  body: ReceiveAtmRegisterEntry,
): Promise<AtmRegisterWriteResultDto> => post<AtmRegisterWriteResultDto>(ENTRIES, body);

export const updateRegisterEntry = (
  id: string,
  body: UpdateAtmRegisterEntry,
): Promise<AtmRegisterWriteResultDto> => patch<AtmRegisterWriteResultDto>(`${ENTRIES}/${id}`, body);

/** Pending → open. */
export const receivePendingRegisterEntry = (
  id: string,
  body: ReceivePendingAtmRegisterEntry,
): Promise<AtmRegisterWriteResultDto> =>
  post<AtmRegisterWriteResultDto>(`${ENTRIES}/${id}/receive`, body);

/** Open → ended. A field left out of `body` keeps its stored value. */
export const handoverRegisterEntry = (
  id: string,
  body: HandoverAtmRegisterEntry,
): Promise<AtmRegisterWriteResultDto> =>
  post<AtmRegisterWriteResultDto>(`${ENTRIES}/${id}/handover`, body);

export const deleteRegisterEntry = (id: string, version: number): Promise<void> =>
  del<void>(`${ENTRIES}/${id}`, { version });

/** The audited read of the safe-door combination (DEC-18). Never cached by the caller. */
export const revealRegisterCombination = (id: string): Promise<AtmRegisterRevealDto> =>
  post<AtmRegisterRevealDto>(`${ENTRIES}/${id}/reveal`, {});

/** Couple an open, unlinked entry to the Operations list (DEC-30). */
export const linkRegisterEntry = (
  id: string,
  version: number,
): Promise<AtmRegisterWriteResultDto> =>
  post<AtmRegisterWriteResultDto>(`${ENTRIES}/${id}/link`, { version });

/** The CSV of every row the filters match — P-class columns only, audited server-side. */
export const exportRegisterEntries = (params: RegisterListParams): Promise<void> =>
  downloadBlob(`${ENTRIES}/export${buildQuery(params)}`, 'atm-register.csv');

// ── Meta, branch options, report ────────────────────────────────────────────
export const getRegisterMeta = (): Promise<AtmRegisterMetaDto> =>
  get<AtmRegisterMetaDto>('/atm/register/meta');

export const getRegisterBranchOptions = (branchId: string): Promise<AtmRegisterBranchOptionsDto> =>
  get<AtmRegisterBranchOptionsDto>(`/atm/register/branch-options${buildQuery({ branchId })}`);

export const getRegisterReport = (): Promise<AtmRegisterReportDto> =>
  get<AtmRegisterReportDto>('/atm/register/report');

// ── Import ──────────────────────────────────────────────────────────────────

/**
 * Upload the register workbook — once to preview (`apply` empty), once to apply the approved
 * categories. The SAME `File` is posted both times and nothing is held on the server in between;
 * `fileSha256` from the preview is what proves the applied bytes are the previewed bytes.
 */
export const importRegisterWorkbook = (
  file: File,
  options: {
    apply: readonly AtmRegisterImportCategory[];
    fileSha256?: string;
    reportOverride?: boolean;
  },
): Promise<AtmRegisterImportResultDto> => {
  const form = new FormData();
  form.append('file', file);
  // Named one by one; an empty list is the preview. The server drops a name it does not know
  // rather than reading it as "all".
  form.append('apply', options.apply.join(','));
  if (options.fileSha256 !== undefined) form.append('fileSha256', options.fileSha256);
  if (options.reportOverride === true) form.append('reportOverride', 'true');
  return upload<AtmRegisterImportResultDto>('/atm/register/import', form);
};

export const listRegisterImportRuns = (): Promise<AtmRegisterImportRunDto[]> =>
  get<AtmRegisterImportRunDto[]>('/atm/register/import/runs');
