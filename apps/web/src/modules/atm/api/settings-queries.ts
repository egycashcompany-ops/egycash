// TanStack Query hooks for /atm/settings (ADR-013). Keys follow the platform factory —
// ['atm', feature, kind, params]. Invalidation facts worth stating:
//
//   · a mailbox save re-reads the card — its version, `hasSecret` and the branch names are the
//     server's; the PUT's own answer is put in the cache first, so the card follows at once;
//   · «قراءة الآن» can file tickets, so it stales the mail tickets (the pending list, the unread
//     badge, the log) as well as the card, whose `lastPoll` is now this run;
//   · the connection test stores nothing, so it stales nothing;
//   · a branch-links save stales the WHOLE ATM tree, not only its list: from the next request the
//     server answers a linked branch's people as the target branch — «أكتوبر هيشوف شغل المهندسين» —
//     so every ATM list already on screen may now be someone else's;
//   · «نقل البيانات» stales the whole ATM tree too, and so does a FAILED move: rows re-filed under
//     the target show on every ATM screen (and the source's mailbox row and settings follow), a
//     run cut off part-way has moved what it reached, and a 409 found a blocker the preview did
//     not show yet — either way the dialog's preview and the card's banner read the server again;
//   · a move preview exists only for a STORED source — any other branch is a 404 — so a links save
//     forgets the previews of the sources it removed, and a move refused 404 (another administrator
//     removed the link) forgets its own: a refresh asked while the removed row is still on screen
//     would otherwise toast that 404 for a link the reader has just removed.
//
// None of the others declares `onError`: a refused write reaches the reader through the global
// mutation toast in their own language (`shared/lib/query-client.ts`) — one failure, one message.
// The move does, because its dialog words the 409 itself («ظهر ما يمنعه منذ المعاينة»), where the
// global toast could only repeat the server's English sentence.
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type AtmBranchMovePreviewDto,
  type SaveAtmBranchLinks,
  type SaveAtmMailboxConfigInput,
} from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import { detailKey, featureKey, listKey } from '../../../shared/lib/query-keys';
import * as api from './settings-api';

const MODULE = 'atm';

const settingsKeys = {
  mailbox: featureKey(MODULE, 'mailbox'),
  mailTickets: featureKey(MODULE, 'mailTickets'),
  branchMove: featureKey(MODULE, 'branchMove'),
};

/** The card's entries — exported so the page's specs fill exactly what it reads. */
export const atmMailboxKey = (): readonly unknown[] => listKey(MODULE, 'mailbox');
export const atmBranchLinksKey = (): readonly unknown[] => listKey(MODULE, 'branchLinks');
export const atmBranchMovePreviewKey = (sourceBranchId: string): readonly unknown[] =>
  detailKey(MODULE, 'branchMove', sourceBranchId);

// ── The maintenance mailbox ─────────────────────────────────────────────────
export const useAtmMailboxConfig = () =>
  useQuery({ queryKey: atmMailboxKey(), queryFn: () => api.getMailboxConfig() });

export const useSaveAtmMailboxConfig = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveAtmMailboxConfigInput) => api.saveMailboxConfig(body),
    onSuccess: (saved) => {
      client.setQueryData(atmMailboxKey(), saved);
      void client.invalidateQueries({ queryKey: settingsKeys.mailbox });
    },
  });
};

export const useTestAtmMailbox = () => useMutation({ mutationFn: () => api.testMailbox() });

export const usePollAtmMailboxNow = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.pollMailboxNow(),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: settingsKeys.mailbox });
      void client.invalidateQueries({ queryKey: settingsKeys.mailTickets });
    },
  });
};

// ── Branches that work as one ───────────────────────────────────────────────
export const useAtmBranchLinks = () =>
  useQuery({ queryKey: atmBranchLinksKey(), queryFn: () => api.getBranchLinks() });

export const useSaveAtmBranchLinks = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveAtmBranchLinks) => api.saveBranchLinks(body),
    onSuccess: (saved) => {
      client.setQueryData(atmBranchLinksKey(), saved);
      const sources = new Set(saved.links.map((link) => link.branchId));
      client.removeQueries({
        queryKey: settingsKeys.branchMove,
        predicate: (query) => !sources.has(String(query.queryKey[3])),
      });
      void client.invalidateQueries({ queryKey: [MODULE] });
    },
  });
};

// ── «نقل البيانات» ──────────────────────────────────────────────────────────
const branchMovePreview = (sourceBranchId: string) => ({
  queryKey: atmBranchMovePreviewKey(sourceBranchId),
  queryFn: (): Promise<AtmBranchMovePreviewDto> => api.getBranchMovePreview(sourceBranchId),
});

/** The dialog's preview of one stored source — asked only while the dialog is open. */
export const useAtmBranchMovePreview = (sourceBranchId: string | null, enabled = true) =>
  useQuery({
    ...branchMovePreview(sourceBranchId ?? ''),
    enabled: enabled && sourceBranchId !== null,
  });

/**
 * Every stored source's preview, in the links' order — the card's banner names each source that
 * still holds rows, so an October left un-moved is said on the card rather than found later.
 */
export const useAtmBranchMovePreviews = (sourceBranchIds: readonly string[], enabled = true) =>
  useQueries({
    queries: sourceBranchIds.map((sourceBranchId) => ({
      ...branchMovePreview(sourceBranchId),
      enabled,
    })),
  });

/** One preview asked NOW — the card's question right after a new link is saved. */
export const useAskAtmBranchMovePreview = () => {
  const client = useQueryClient();
  return (sourceBranchId: string): Promise<AtmBranchMovePreviewDto> =>
    client.fetchQuery(branchMovePreview(sourceBranchId));
};

export const useMoveAtmBranchData = () => {
  const client = useQueryClient();
  const restale = (): void => void client.invalidateQueries({ queryKey: [MODULE] });
  return useMutation({
    mutationFn: (input: { sourceBranchId: string; expectedTargetBranchId?: string }) =>
      api.moveBranchData(input.sourceBranchId, input.expectedTargetBranchId),
    onSuccess: restale,
    onError: (error, input) => {
      if (error instanceof ApiError && error.status === 404) {
        client.removeQueries({ queryKey: atmBranchMovePreviewKey(input.sourceBranchId) });
      }
      restale();
    },
  });
};
