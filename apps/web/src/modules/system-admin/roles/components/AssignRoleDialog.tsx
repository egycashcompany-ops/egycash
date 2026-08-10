// Grant a role to one account.
//
// Three things the form states rather than hides, because each is a rule the server enforces and an
// administrator would otherwise discover as a 422:
//
//   • **A hierarchical scope resolves to the account's OWN placement.** There is no unit picker
//     here: a branch-scoped grant means "this account's branch", and the server re-derives it from
//     the account rather than trusting an id in the request. So the form SHOWS the placement the
//     scope will resolve to, and refuses to submit when there is none.
//   • **`section` and `department` are honoured by four collections.** Everywhere else the grant
//     behaves as branch scope — see AssignmentScopeBadge. Choosing one of them says so.
//   • **A grant can never be wider than the granter's own.** The server refuses it (S-guards), and
//     saying it here first is cheaper than a round trip.
import { useState } from 'react';
import { DATA_SCOPES, type CreateRoleAssignment, type DataScope, type UserDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Button, Dialog, Field, Form, Input, Select, toast } from '../../../../shared/ui';
import { RolePicker } from './RolePicker';
import { useCreateAssignment } from '../api/role-queries';

/** The placement each hierarchical scope resolves against. `own` and `organization` need none. */
const REQUIRED_PLACEMENT: Partial<Record<DataScope, 'branchId' | 'departmentId' | 'sectionId'>> = {
  branch: 'branchId',
  department: 'departmentId',
  section: 'sectionId',
};

export const AssignRoleDialog = ({
  user,
  heldRoleIds,
  onClose,
}: {
  user: UserDto;
  heldRoleIds: readonly string[];
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const [roleId, setRoleId] = useState('');
  const [scope, setScope] = useState<DataScope>('own');
  const [validFrom, setValidFrom] = useState('');
  const [validTo, setValidTo] = useState('');
  const assign = useCreateAssignment();

  const needed = REQUIRED_PLACEMENT[scope];
  const missingPlacement = needed !== undefined && user.organization[needed] === null;
  const badWindow = validFrom !== '' && validTo !== '' && validFrom >= validTo;

  const submit = (): void => {
    if (roleId === '' || missingPlacement || badWindow) return;
    const body: CreateRoleAssignment = {
      userId: user.id,
      roleId,
      scope,
      ...(validFrom === '' ? {} : { validFrom: new Date(validFrom) }),
      ...(validTo === '' ? {} : { validTo: new Date(validTo) }),
    };
    assign.mutate(body, {
      onSuccess: () => {
        toast.success(t('systemAdmin.assignments.granted'));
        onClose();
      },
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={t('systemAdmin.assignments.grantTitle')}
      description={t('systemAdmin.assignments.grantHint')}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            size="sm"
            loading={assign.isPending}
            disabled={roleId === '' || missingPlacement || badWindow}
            onClick={submit}
          >
            {t('systemAdmin.assignments.grant')}
          </Button>
        </div>
      }
    >
      <Form onSubmit={submit}>
        <Field label={t('systemAdmin.assignments.role')} required>
          <RolePicker
            value={roleId}
            onChange={setRoleId}
            alreadyHeld={heldRoleIds}
            ariaLabel={t('systemAdmin.roles.picker.placeholder')}
          />
        </Field>

        <Field
          label={t('systemAdmin.assignments.scope')}
          hint={t('systemAdmin.assignments.scopeHint')}
          error={missingPlacement ? t('systemAdmin.assignments.noPlacement') : undefined}
        >
          <Select value={scope} onChange={(e) => setScope(e.target.value as DataScope)}>
            {DATA_SCOPES.map((value) => (
              <option key={value} value={value}>
                {t(`systemAdmin.assignments.scopes.${value}`)}
              </option>
            ))}
          </Select>
        </Field>

        {(scope === 'section' || scope === 'department') && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {t('systemAdmin.assignments.scopeWidens')}
          </p>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('systemAdmin.assignments.validFrom')}>
            <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          </Field>
          <Field
            label={t('systemAdmin.assignments.validTo')}
            hint={t('systemAdmin.assignments.validToHint')}
            error={badWindow ? t('systemAdmin.assignments.badWindow') : undefined}
          >
            <Input
              type="date"
              value={validTo}
              error={badWindow}
              onChange={(e) => setValidTo(e.target.value)}
            />
          </Field>
        </div>
      </Form>
    </Dialog>
  );
};
