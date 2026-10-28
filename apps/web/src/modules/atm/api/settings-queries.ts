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
//     so every ATM list already on screen may now be someone else's.
//
// None of these declares `onError`: a refused write reaches the reader through the global
// mutation toast in their own language (`shared/lib/query-client.ts`) — one failure, one message.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type SaveAtmBranchLinks, type SaveAtmMailboxConfigInput } from '@ecms/contracts';
import { featureKey, listKey } from '../../../shared/lib/query-keys';
import * as api from './settings-api';

const MODULE = 'atm';

const settingsKeys = {
  mailbox: featureKey(MODULE, 'mailbox'),
  mailTickets: featureKey(MODULE, 'mailTickets'),
};

/** The card's entries — exported so the page's specs fill exactly what it reads. */
export const atmMailboxKey = (): readonly unknown[] => listKey(MODULE, 'mailbox');
export const atmBranchLinksKey = (): readonly unknown[] => listKey(MODULE, 'branchLinks');

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
      void client.invalidateQueries({ queryKey: [MODULE] });
    },
  });
};
