// One session's status, in a word and a colour.
//
// The two terminal states get opposite tones deliberately: a completed session is the good end and
// a cancelled one is not, and a reader scanning a list should not have to read both to tell them
// apart. `scheduled` is neutral because nothing has happened yet, and `running` is the one that
// wants attention — it is the row somebody is standing in a room for.
import { type TrainingSessionStatus } from '@ecms/contracts';
import { StatusBadge, type Tone } from '../../../../shared/ui';
import { useT } from '../../../../platform/localization/useT';

const TONE: Readonly<Record<TrainingSessionStatus, Tone>> = {
  scheduled: 'neutral',
  running: 'info',
  completed: 'success',
  cancelled: 'danger',
};

export const SessionStatusBadge = ({
  status,
}: {
  status: TrainingSessionStatus;
}): JSX.Element => {
  const t = useT();
  return <StatusBadge tone={TONE[status]} label={t(`training.session.status.${status}`)} />;
};
