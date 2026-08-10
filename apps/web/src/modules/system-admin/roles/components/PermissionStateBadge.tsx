// Whether a grant applies right now — and if not, which kind of "not".
//
// `pending` and `expired` are deliberately different chips rather than one "inactive". They are
// different facts and lead to different actions: a window that has not opened yet needs waiting or
// moving, one that has closed needs a new grant. Collapsing them would throw away the half of the
// answer the administrator came for.
//
// Never colour alone: each chip carries its own words, so the distinction survives a monochrome
// screen and a reader who cannot separate amber from slate.
import { type PermissionState } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Badge, type Tone } from '../../../../shared/ui';

const TONE: Record<PermissionState, Tone> = {
  active: 'success',
  pending: 'info',
  expired: 'neutral',
};

export const PermissionStateBadge = ({
  state,
  size = 'sm',
}: {
  state: PermissionState;
  size?: 'sm' | 'md';
}): JSX.Element => {
  const t = useT();
  return (
    <Badge size={size} tone={TONE[state]}>
      {t(`systemAdmin.effective.state.${state}`)}
    </Badge>
  );
};
