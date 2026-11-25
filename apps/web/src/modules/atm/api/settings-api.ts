// /atm/settings api/ surface (ADR-013, the `atm-api.ts` shape): one typed function per endpoint
// of the things the page administers — the Banque Misr maintenance mailbox (`/atm/mailbox`), the
// branches that work as one in ATM (`/atm/branch-links`) and the departments whose employees the
// leader pickers offer (`/atm/leaders/departments`). All are `atmSettings.manage` at ORGANIZATION
// scope on the server; nothing here decides anything.
//
// The client secret only ever travels TOWARD the server: it is sent on a save and never read back
// (`AtmMailboxConfigDto.hasSecret` says whether one is stored), so no answer here can carry it.
//
// «نقل البيانات» names only the link's SOURCE, in the path: the server takes the target from the
// STORED link (`AtmBranchMoveParamsSchema`), so nothing sent here can point the move anywhere else.
// The body only names the target the reader confirmed, a precondition the server checks against
// that stored link (`AtmBranchMoveBodySchema`).
import {
  type AtmDisplaySetting,
  type AtmBranchLinksDto,
  type AtmLegacyCutoverDto,
  type AtmLegacyImportBody,
  type AtmLegacyImportPreviewDto,
  type AtmLegacyImportRunDto,
  type AtmLegacySource,
  type AtmLegacySourceDto,
  type AtmLegacyUndoResultDto,
  type AtmBranchMovePreviewDto,
  type AtmBranchMoveResultDto,
  type AtmLeaderDepartmentsDto,
  type AtmMailboxConfigDto,
  type AtmMailboxTestResultDto,
  type AtmMailPollRunDto,
  type SaveAtmBranchLinks,
  type SaveAtmLeaderDepartments,
  type SaveAtmMailboxConfigInput,
} from '@ecms/contracts';
import { api, get, post, put } from '../../../shared/lib/api-client';

const MAILBOX = '/atm/mailbox';
const BRANCH_LINKS = '/atm/branch-links';
const LEADER_DEPARTMENTS = '/atm/leaders/departments';
const DISPLAY = '/atm/display';
const LEGACY = '/atm/legacy-import';

// ── The maintenance mailbox ─────────────────────────────────────────────────
/** `null` while no document exists — the reader is still on the deployment's environment. */
export const getMailboxConfig = (): Promise<AtmMailboxConfigDto | null> =>
  get<AtmMailboxConfigDto | null>(MAILBOX);

/** The whole card in one save; `clientSecret` omitted keeps the stored one. */
export const saveMailboxConfig = (body: SaveAtmMailboxConfigInput): Promise<AtmMailboxConfigDto> =>
  put<AtmMailboxConfigDto>(MAILBOX, body);

/** A token and ONE unread message, with the STORED settings — nothing is read or filed. */
export const testMailbox = (): Promise<AtmMailboxTestResultDto> =>
  post<AtmMailboxTestResultDto>(`${MAILBOX}/test`, {});

/** «قراءة الآن» — one run of the reader, answered with its report. */
export const pollMailboxNow = (): Promise<AtmMailPollRunDto> =>
  post<AtmMailPollRunDto>(`${MAILBOX}/poll`, {});

// ── Branches that work as one ───────────────────────────────────────────────
export const getBranchLinks = (): Promise<AtmBranchLinksDto> =>
  get<AtmBranchLinksDto>(BRANCH_LINKS);

/** The whole list, replacing the stored one. */
export const saveBranchLinks = (body: SaveAtmBranchLinks): Promise<AtmBranchLinksDto> =>
  put<AtmBranchLinksDto>(BRANCH_LINKS, body);

// ── «نقل البيانات» — a link's source re-filed under its target ──────────────
/** Read-only: what moving this stored source would do now — 404 for a branch that is no source. */
export const getBranchMovePreview = (sourceBranchId: string): Promise<AtmBranchMovePreviewDto> =>
  get<AtmBranchMovePreviewDto>(`${BRANCH_LINKS}/${sourceBranchId}/move`);

/**
 * The move itself — 409 `ATM_BRANCH_MOVE_BLOCKED` while anything stands in its way,
 * `ATM_BRANCH_MOVE_STOPPED` when something appears part-way through the run, or
 * `ATM_BRANCH_MOVE_TARGET_CHANGED` when the link is no longer the one previewed.
 */
export const moveBranchData = (
  sourceBranchId: string,
  expectedTargetBranchId?: string,
): Promise<AtmBranchMoveResultDto> =>
  post<AtmBranchMoveResultDto>(
    `${BRANCH_LINKS}/${sourceBranchId}/move`,
    expectedTargetBranchId === undefined ? {} : { expectedTargetBranchId },
  );

// ── Whose names the leader pickers offer ────────────────────────────────────
/** Every active department, what is in the list now, and how many people that makes. */
export const getLeaderDepartments = (): Promise<AtmLeaderDepartmentsDto> =>
  get<AtmLeaderDepartmentsDto>(LEADER_DEPARTMENTS);

/** The ticked departments, replacing the stored list; `[]` returns to the ATM department by name. */
export const saveLeaderDepartments = (
  body: SaveAtmLeaderDepartments,
): Promise<AtmLeaderDepartmentsDto> => put<AtmLeaderDepartmentsDto>(LEADER_DEPARTMENTS, body);

// ── How the ATM pages read ──────────────────────────────────────────────────
/** The text size, bold or not, and the tables' lines every ATM page draws with. */
export const getDisplay = (): Promise<AtmDisplaySetting> => get<AtmDisplaySetting>(DISPLAY);

/** The /atm/settings card's save — the whole value, for the whole company. */
export const saveDisplay = (body: AtmDisplaySetting): Promise<AtmDisplaySetting> =>
  put<AtmDisplaySetting>(DISPLAY, body);

// ── The legacy history (design: docs/12-planning/atm-legacy-history-import.md) ─────
// The branch is the source's own on the server — nothing sent here names one.
export const getLegacySources = (): Promise<AtmLegacySourceDto[]> =>
  get<AtmLegacySourceDto[]>(LEGACY);

export const getLegacyCutover = (source: AtmLegacySource): Promise<AtmLegacyCutoverDto> =>
  get<AtmLegacyCutoverDto>(`${LEGACY}/sources/${source}/cutover`);

/**
 * The preview reads a whole legacy source: a superseded one (the cut changed meanwhile) is
 * cancelled on the wire, so its answer is never waited for.
 */
export const previewLegacyImport = (
  body: AtmLegacyImportBody,
  signal?: AbortSignal,
): Promise<AtmLegacyImportPreviewDto> =>
  api<AtmLegacyImportPreviewDto>(`${LEGACY}/preview`, {
    method: 'POST',
    body: JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }),
  });

export const startLegacyImport = (body: AtmLegacyImportBody): Promise<AtmLegacyImportRunDto> =>
  post<AtmLegacyImportRunDto>(`${LEGACY}/runs`, body);

/** One step of a run — the card calls it until the run is no longer `running`. */
export const stepLegacyImport = (runId: string): Promise<AtmLegacyImportRunDto> =>
  post<AtmLegacyImportRunDto>(`${LEGACY}/runs/${runId}/step`, {});

/** One batch of a source's copies removed — the card calls it until `remaining` is 0. */
export const undoLegacySource = (source: AtmLegacySource): Promise<AtmLegacyUndoResultDto> =>
  post<AtmLegacyUndoResultDto>(`${LEGACY}/sources/${source}/undo`, {});
