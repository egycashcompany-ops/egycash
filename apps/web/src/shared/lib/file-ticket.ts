// Turning a Files-service id into something an <img> can load.
//
// A stored file is not addressable by URL: `/platform/files/:id/download` needs the session's
// Authorization header, which an <img src> cannot send. The platform's answer is a download
// ticket — a short-lived signed URL that carries its own capability — so anything that displays a
// stored image asks for a ticket first and renders the URL it gets back.
//
// Cached for less than the signed URL's life, so a page open for a while re-tickets rather than
// pointing at a URL that has expired. One query per file id, shared by every component showing it.
import { useQuery } from '@tanstack/react-query';
import { type DownloadTicketDto } from '@ecms/contracts';
import { get } from './api-client';

/** Well under the server's SIGNED_URL_TTL_SECONDS, whatever it is set to. */
const TICKET_STALE_MS = 60_000;

export const fileTicketKey = (fileId: string) => ['platform', 'files', fileId, 'ticket'] as const;

export const useFileTicket = (fileId: string | null) =>
  useQuery({
    queryKey: fileTicketKey(fileId ?? 'none'),
    // `mode=ticket` asks for the URL as JSON; without it the endpoint 302s to the same place,
    // which is right for a browser navigation and useless to a fetch.
    queryFn: () => get<DownloadTicketDto>(`/platform/files/${fileId ?? ''}/download?mode=ticket`),
    enabled: fileId !== null,
    staleTime: TICKET_STALE_MS,
    // A missing or unreadable file is a blank icon, not a screen full of retries.
    retry: false,
  });
