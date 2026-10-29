// /atm/settings api/ surface (ADR-013, the `atm-api.ts` shape): one typed function per endpoint
// of the two things the page administers — the Banque Misr maintenance mailbox (`/atm/mailbox`)
// and the branches that work as one in ATM (`/atm/branch-links`). Both are `atmSettings.manage`
// at ORGANIZATION scope on the server; nothing here decides anything.
//
// The client secret only ever travels TOWARD the server: it is sent on a save and never read back
// (`AtmMailboxConfigDto.hasSecret` says whether one is stored), so no answer here can carry it.
//
// «نقل البيانات» names only the link's SOURCE, in the path: the server takes the target from the
// STORED link (`AtmBranchMoveParamsSchema`), so nothing sent here can point the move anywhere else.
// The body only names the target the reader confirmed, a precondition the server checks against
// that stored link (`AtmBranchMoveBodySchema`).
import {
  type AtmBranchLinksDto,
  type AtmBranchMovePreviewDto,
  type AtmBranchMoveResultDto,
  type AtmMailboxConfigDto,
  type AtmMailboxTestResultDto,
  type AtmMailPollRunDto,
  type SaveAtmBranchLinks,
  type SaveAtmMailboxConfigInput,
} from '@ecms/contracts';
import { get, post, put } from '../../../shared/lib/api-client';

const MAILBOX = '/atm/mailbox';
const BRANCH_LINKS = '/atm/branch-links';

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
