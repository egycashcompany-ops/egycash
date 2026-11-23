// How a role is looked after, in one chip — and therefore whether editing it is even meaningful.
//
// `system` and `derived` are both read-only, for different reasons the tone deliberately does not
// blur: a system role is protected because the platform depends on it, while a derived one is
// simply not an administrator's to change — the HR-only reconciliation re-asserts it on every boot,
// so an edit here would be reverted rather than refused if the server did not stop it first.
import { type RoleManagement } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Badge, type Tone } from '../../../../shared/ui';

const TONE: Record<RoleManagement, Tone> = {
  system: 'brand',
  derived: 'info',
  none: 'neutral',
};

interface ManagedRoleBadgeProps {
  managed: RoleManagement;
  /** Passed to the chip — e.g. `shrink-0`, so a row that wraps a long name never squeezes the chip. */
  className?: string;
}

export const ManagedRoleBadge = ({
  managed,
  className,
}: ManagedRoleBadgeProps): JSX.Element | null =>
  managed === 'none' ? null : (
    <ManagedChip managed={managed} {...(className === undefined ? {} : { className })} />
  );

const ManagedChip = ({ managed, className }: ManagedRoleBadgeProps): JSX.Element => {
  const t = useT();
  return (
    <Badge size="sm" tone={TONE[managed]} {...(className === undefined ? {} : { className })}>
      {t(`systemAdmin.roles.managed.${managed}`)}
    </Badge>
  );
};
