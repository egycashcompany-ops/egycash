// SLA presentation (design §4.5).
//
// Three states, and the distinction between them is the whole point:
//
//   * **breached** — a STAMP the sweep wrote. Read, never recomputed: a late resolution does not
//     un-breach a ticket (FR-6), so this must not be derived from "is now past due".
//   * **at risk**  — a live comparison against the at-risk threshold. Genuinely derived, and
//     deliberately not stored: it changes every minute and nothing should persist that.
//   * **on track** — everything else.
//
// A clock that has stopped (first response given, ticket resolved) shows neither risk nor breach
// for that phase, because the promise it measured is already kept or already broken.
import { type ItTicketDto, type ItTicketSlaDto, type Locale } from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { useT } from '../../../platform/localization/useT';
import { Badge } from '../../../shared/ui/Badge';
import { formatDateTime } from '../../../shared/lib/format';

/** Default matches the platform setting's default; the dashboard reads the real one in IT-6. */
const AT_RISK_PERCENT = 80;

type Phase = 'response' | 'resolution';

const phaseState = (
  sla: ItTicketSlaDto,
  phase: Phase,
  stopped: boolean,
  now: number,
): 'breached' | 'atRisk' | 'onTrack' | 'done' => {
  const breachedAt = phase === 'response' ? sla.responseBreachedAt : sla.resolutionBreachedAt;
  if (breachedAt !== null) return 'breached';
  if (stopped) return 'done';
  const dueAt = new Date(phase === 'response' ? sla.responseDueAt : sla.resolutionDueAt).getTime();
  const minutes = phase === 'response' ? sla.policy.responseMinutes : sla.policy.resolutionMinutes;
  const startedAt = dueAt - minutes * 60_000;
  const elapsed = ((now - startedAt) / (dueAt - startedAt)) * 100;
  return elapsed >= AT_RISK_PERCENT ? 'atRisk' : 'onTrack';
};

export const SlaIndicator = ({
  ticket,
  phase,
}: {
  ticket: ItTicketDto;
  phase: Phase;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const stopped =
    phase === 'response'
      ? ticket.sla.firstResponseAt !== null
      : ticket.resolution !== null || ticket.status === 'closed' || ticket.status === 'cancelled';
  const state = phaseState(ticket.sla, phase, stopped, Date.now());
  const dueAt = phase === 'response' ? ticket.sla.responseDueAt : ticket.sla.resolutionDueAt;

  const tone = state === 'breached' ? 'danger' : state === 'atRisk' ? 'warning' : state === 'done' ? 'success' : 'neutral';
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Badge tone={tone}>{t(`it.tickets.sla.${state}`)}</Badge>
      <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
        {formatDateTime(dueAt, locale)}
      </span>
    </span>
  );
};
