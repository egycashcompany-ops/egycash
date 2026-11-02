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
import {
  ItSettingKeys,
  type ItTicketDto,
  type ItTicketSlaDto,
  type Locale,
} from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { useT } from '../../../platform/localization/useT';
import { useMySettings } from '../../../platform/settings/settings-api';
import { Badge } from '../../../shared/ui/Badge';
import { formatDateTime } from '../../../shared/lib/format';

/**
 * The at-risk threshold is the `it.sla.atRiskPercent` setting («إعدادات النظام» → تقنية المعلومات).
 * It was a constant here, so changing the setting changed nothing. This is the setting's own
 * default, used only until the caller's settings have loaded or if the value is missing.
 */
export const DEFAULT_AT_RISK_PERCENT = 80;

export const useAtRiskPercent = (): number => {
  const settings = useMySettings();
  const value = settings.data?.find((entry) => entry.key === ItSettingKeys.SlaAtRiskPercent)?.value;
  return typeof value === 'number' ? value : DEFAULT_AT_RISK_PERCENT;
};

type Phase = 'response' | 'resolution';

const phaseState = (
  sla: ItTicketSlaDto,
  phase: Phase,
  stopped: boolean,
  now: number,
  atRiskPercent: number,
): 'breached' | 'atRisk' | 'onTrack' | 'done' => {
  const breachedAt = phase === 'response' ? sla.responseBreachedAt : sla.resolutionBreachedAt;
  if (breachedAt !== null) return 'breached';
  if (stopped) return 'done';
  const dueAt = new Date(phase === 'response' ? sla.responseDueAt : sla.resolutionDueAt).getTime();
  const minutes = phase === 'response' ? sla.policy.responseMinutes : sla.policy.resolutionMinutes;
  const startedAt = dueAt - minutes * 60_000;
  const elapsed = ((now - startedAt) / (dueAt - startedAt)) * 100;
  return elapsed >= atRiskPercent ? 'atRisk' : 'onTrack';
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
  const atRiskPercent = useAtRiskPercent();
  const stopped =
    phase === 'response'
      ? ticket.sla.firstResponseAt !== null
      : ticket.resolution !== null || ticket.status === 'closed' || ticket.status === 'cancelled';
  const state = phaseState(ticket.sla, phase, stopped, Date.now(), atRiskPercent);
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
