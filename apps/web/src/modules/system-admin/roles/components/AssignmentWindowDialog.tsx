// Move an existing grant's validity window — and nothing else.
//
// The role, the account and the scope are absent on purpose: changing any of those is a DIFFERENT
// grant, which is a revoke and a new assignment, not an edit. What is genuinely an edit is
// extending a grant that is about to lapse, or ending one early — expressing either as
// revoke + re-grant would throw away when the grant was first made and split one decision into two
// rows in the trail.
//
// The stored `version` rides along. A validity window is exactly the field two administrators reach
// for at the same moment — one extending, the other ending — and last-write-wins would let the
// second silently undo the first. A stale send answers 409 and the dialog says so.
import { useState } from 'react';
import { type RoleAssignmentDto, type UpdateRoleAssignment } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Button, Dialog, Field, Form, Input, toast } from '../../../../shared/ui';
import { useUpdateAssignment } from '../api/role-queries';

/** ISO instant → the `yyyy-mm-dd` a date input speaks. */
const asDateInput = (value: string | null): string => (value === null ? '' : value.slice(0, 10));

export const AssignmentWindowDialog = ({
  assignment,
  onClose,
}: {
  assignment: RoleAssignmentDto;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const [validFrom, setValidFrom] = useState(asDateInput(assignment.validFrom));
  const [validTo, setValidTo] = useState(asDateInput(assignment.validTo));
  const update = useUpdateAssignment();

  const badWindow = validFrom !== '' && validTo !== '' && validFrom >= validTo;

  const submit = (): void => {
    if (badWindow) return;
    // Both fields are always sent: the schema demands at least one, and sending both is what makes
    // "clear the end date" expressible — `null` is a value here, not an omission.
    const body: UpdateRoleAssignment = {
      validFrom: validFrom === '' ? null : new Date(validFrom),
      validTo: validTo === '' ? null : new Date(validTo),
      version: assignment.version,
    };
    update.mutate(
      { id: assignment.id, body },
      {
        onSuccess: () => {
          toast.success(t('systemAdmin.assignments.windowSaved'));
          onClose();
        },
      },
    );
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={t('systemAdmin.assignments.editWindow')}
      description={t('systemAdmin.assignments.editWindowHint')}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" loading={update.isPending} disabled={badWindow} onClick={submit}>
            {t('common.save')}
          </Button>
        </div>
      }
    >
      <Form onSubmit={submit}>
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
      </Form>
    </Dialog>
  );
};
