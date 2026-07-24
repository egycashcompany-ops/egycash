// Edit the employee's OWNED personal data — a plain audited update, NOT a personnel action
// (frozen design I4). Covers the routinely-maintained groups (names, marital status, religion,
// dependents, national-id expiry, contact); the richer arrays keep their hire-time copy and can
// be extended later. A national-id change re-derives birth data server-side.
import { useState } from 'react';
import { type EmployeeDto, type MaritalStatus, type UpdateEmployeePersonal } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Button } from '../../../../../shared/ui/Button';
import { Field, Input, Select } from '../../../../../shared/ui/form';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { useUpdateEmployeePersonal } from '../api/employee-queries';

const MARITAL: MaritalStatus[] = ['single', 'married', 'divorced', 'widowed'];

export const EditPersonalDialog = ({
  employee,
  open,
  onClose,
}: {
  employee: EmployeeDto;
  open: boolean;
  onClose: () => void;
}): JSX.Element | null => {
  const t = useT();
  const update = useUpdateEmployeePersonal(employee.id);
  const p = employee.personal;
  const [fullNameAr, setFullNameAr] = useState(p.fullNameAr);
  const [fullNameEn, setFullNameEn] = useState(p.fullNameEn ?? '');
  const [maritalStatus, setMaritalStatus] = useState(p.maritalStatus ?? '');
  const [religion, setReligion] = useState(p.religion ?? '');
  const [dependents, setDependents] = useState(p.dependentsCount === null ? '' : String(p.dependentsCount));
  const [nationalIdExpiry, setNationalIdExpiry] = useState(
    p.nationalIdExpiry === null ? '' : p.nationalIdExpiry.slice(0, 10),
  );
  const [primaryPhone, setPrimaryPhone] = useState(p.contact.primaryPhone);
  const [secondaryPhone, setSecondaryPhone] = useState(p.contact.secondaryPhone ?? '');
  const [email, setEmail] = useState(p.contact.email ?? '');

  if (!open) return null;

  const submit = async (): Promise<void> => {
    if (fullNameAr.trim().length < 2) {
      toast.error(t('employees.personal.nameRequired'));
      return;
    }
    const body: UpdateEmployeePersonal = {
      identity: {
        fullNameAr: fullNameAr.trim(),
        ...(fullNameEn.trim() === '' ? {} : { fullNameEn: fullNameEn.trim() }),
        ...(maritalStatus === '' ? {} : { maritalStatus: maritalStatus as MaritalStatus }),
        ...(religion.trim() === '' ? {} : { religion: religion.trim() }),
        ...(dependents === '' ? {} : { dependentsCount: Number(dependents) }),
        ...(nationalIdExpiry === '' ? {} : { nationalIdExpiry: new Date(nationalIdExpiry) }),
      },
      contact: {
        primaryPhone,
        ...(secondaryPhone.trim() === '' ? {} : { secondaryPhone }),
        ...(email.trim() === '' ? {} : { email }),
      },
      version: employee.version,
    };
    try {
      await update.mutateAsync(body);
      toast.success(t('employees.personal.updated'));
      onClose();
    } catch {
      // surfaced globally
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('employees.personal.edit')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={update.isPending}>
            {t('common.cancel')}
          </Button>
          <Button loading={update.isPending} onClick={() => void submit()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('applicants.form.fullNameAr')} required>
          <Input value={fullNameAr} onChange={(e) => setFullNameAr(e.target.value)} maxLength={200} />
        </Field>
        <Field label={t('applicants.form.fullNameEn')}>
          <Input value={fullNameEn} onChange={(e) => setFullNameEn(e.target.value)} maxLength={200} dir="ltr" />
        </Field>
        <Field label={t('applicants.form.maritalStatus')}>
          <Select value={maritalStatus} onChange={(e) => setMaritalStatus(e.target.value)}>
            <option value="">—</option>
            {MARITAL.map((m) => (
              <option key={m} value={m}>
                {t(`applicants.maritalStatus.${m}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('applicants.form.religion')}>
          <Input value={religion} onChange={(e) => setReligion(e.target.value)} maxLength={100} />
        </Field>
        <Field label={t('applicants.form.dependents')}>
          <Input type="number" min={0} max={50} value={dependents} onChange={(e) => setDependents(e.target.value)} dir="ltr" />
        </Field>
        <Field label={t('applicants.form.nationalIdExpiry')}>
          <Input type="date" value={nationalIdExpiry} onChange={(e) => setNationalIdExpiry(e.target.value)} />
        </Field>
        <Field label={t('applicants.form.primaryPhone')} required>
          <Input value={primaryPhone} onChange={(e) => setPrimaryPhone(e.target.value)} dir="ltr" maxLength={30} />
        </Field>
        <Field label={t('applicants.form.secondaryPhone')}>
          <Input value={secondaryPhone} onChange={(e) => setSecondaryPhone(e.target.value)} dir="ltr" maxLength={30} />
        </Field>
        <Field label={t('applicants.form.email')}>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" maxLength={200} />
        </Field>
      </div>
    </Dialog>
  );
};
