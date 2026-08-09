// Asset status pill. The status is DERIVED by the server (FR-2) — this component only picks the
// tone and the translated label for whatever the API returned, and never infers a status from
// other fields.
import { type ItAssetStatus } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { StatusBadge, type Tone } from '../../../shared/ui/Badge';

const TONES: Readonly<Record<ItAssetStatus, Tone>> = {
  inStock: 'success',
  assigned: 'info',
  underMaintenance: 'warning',
  disposed: 'neutral',
};

export const AssetStatusBadge = ({ status }: { status: ItAssetStatus }): JSX.Element => {
  const t = useT();
  return <StatusBadge tone={TONES[status]} label={t(`it.assets.status.${status}`)} />;
};
