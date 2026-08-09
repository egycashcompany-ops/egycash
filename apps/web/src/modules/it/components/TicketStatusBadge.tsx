// Ticket status pill. The status is a SERVER fact moved only by a named transition (§4.4) — this
// component picks a tone and a translated label and never infers a status from anything else.
import { type ItTicketStatus } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { StatusBadge, type Tone } from '../../../shared/ui/Badge';

const TONES: Readonly<Record<ItTicketStatus, Tone>> = {
  open: 'info',
  inProgress: 'brand',
  onHold: 'warning',
  resolved: 'success',
  closed: 'neutral',
  cancelled: 'neutral',
};

export const TicketStatusBadge = ({ status }: { status: ItTicketStatus }): JSX.Element => {
  const t = useT();
  return <StatusBadge tone={TONES[status]} label={t(`it.tickets.status.${status}`)} />;
};
