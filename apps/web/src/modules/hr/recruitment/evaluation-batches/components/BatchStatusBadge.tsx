// Batch + item + package status pills. The domain status → tone mapping lives at the call site,
// as everywhere else in the app.
import { type BatchItemResult, type BatchPackageStatus, type EvaluationBatchStatus } from '@ecms/contracts';
import { StatusBadge } from '../../../../../shared/ui/Badge';
import { type Tone } from '../../../../../shared/ui/Badge';
import { useT } from '../../../../../platform/localization/useT';

const BATCH_TONE: Record<EvaluationBatchStatus, Tone> = {
  draft: 'neutral',
  issued: 'info',
  closed: 'success',
  cancelled: 'danger',
};

const ITEM_TONE: Record<BatchItemResult, Tone> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  voided: 'neutral',
};

const PACKAGE_TONE: Record<BatchPackageStatus, Tone> = {
  none: 'neutral',
  queued: 'info',
  building: 'info',
  ready: 'success',
  failed: 'danger',
};

export const BatchStatusBadge = ({ status }: { status: EvaluationBatchStatus }): JSX.Element => {
  const t = useT();
  return <StatusBadge tone={BATCH_TONE[status]} label={t(`batches.status.${status}`)} />;
};

export const BatchItemBadge = ({ result }: { result: BatchItemResult }): JSX.Element => {
  const t = useT();
  return <StatusBadge tone={ITEM_TONE[result]} label={t(`batches.itemResult.${result}`)} />;
};

export const BatchPackageBadge = ({ status }: { status: BatchPackageStatus }): JSX.Element => {
  const t = useT();
  return <StatusBadge tone={PACKAGE_TONE[status]} label={t(`batches.package.${status}`)} />;
};
