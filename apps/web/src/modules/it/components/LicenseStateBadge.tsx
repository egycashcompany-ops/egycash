// Licence state pill. The state is DERIVED server-side from `expiresAt` and the warn window (§6:
// "no stored state") — this component picks a tone and a translated label and computes nothing.
// A client that derived its own would disagree with the sweep the day the warn window changed.
import { type ItLicenseState } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { StatusBadge, type Tone } from '../../../shared/ui/Badge';

const TONES: Readonly<Record<ItLicenseState, Tone>> = {
  perpetual: 'brand',
  active: 'success',
  expiringSoon: 'warning',
  expired: 'danger',
};

export const LicenseStateBadge = ({ state }: { state: ItLicenseState }): JSX.Element => {
  const t = useT();
  return <StatusBadge tone={TONES[state]} label={t(`it.licenses.state.${state}`)} />;
};
