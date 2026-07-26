import { type ContractStatus, type ContractTemplateStatus } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Badge, type Tone } from '../../../../shared/ui';

const TONE: Record<ContractStatus, Tone> = {
  draft: 'neutral',
  pendingApproval: 'warning',
  approved: 'info',
  active: 'success',
  signed: 'success',
  amended: 'neutral',
  renewed: 'neutral',
  terminated: 'danger',
  expired: 'danger',
  archived: 'neutral',
};

export const ContractStatusBadge = ({ status }: { status: ContractStatus }): JSX.Element => {
  const t = useT();
  return <Badge tone={TONE[status]}>{t(`contracts.status.${status}`)}</Badge>;
};

const TEMPLATE_TONE: Record<ContractTemplateStatus, Tone> = {
  draft: 'warning',
  published: 'success',
  archived: 'neutral',
};

export const TemplateStatusBadge = ({ status }: { status: ContractTemplateStatus }): JSX.Element => {
  const t = useT();
  return <Badge tone={TEMPLATE_TONE[status]}>{t(`contracts.templates.status.${status}`)}</Badge>;
};
