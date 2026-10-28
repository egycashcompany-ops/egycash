// /atm/settings api/ surface (ADR-013, the `atm-api.ts` shape): one typed function per endpoint
// of the two things the page administers — the Banque Misr maintenance mailbox (`/atm/mailbox`)
// and the branches that work as one in ATM (`/atm/branch-links`). Both are `atmSettings.manage`
// at ORGANIZATION scope on the server; nothing here decides anything.
//
// The client secret only ever travels TOWARD the server: it is sent on a save and never read back
// (`AtmMailboxConfigDto.hasSecret` says whether one is stored), so no answer here can carry it.
import {
  type AtmBranchLinksDto,
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
