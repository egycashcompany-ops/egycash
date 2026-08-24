// Create or edit a company delegate — the customer's authorised signatory.
//
// A delegate always belongs to a company: the gold system required it, and the receipt that names
// the delegate also names the owner they signed for.
import { useState, type FormEvent } from 'react';
import { type GoldActiveStatus, type GoldRepresentativeDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Field, Input, Select, Textarea } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import {
  useCreateGoldRepresentative,
  useGoldCompanies,
  useUpdateGoldRepresentative,
} from '../api/gold-queries';
import { toDateInput } from '../lib/gold-format';

export const RepresentativeDialog = ({
  representative,
  onClose,
}: {
  representative: GoldRepresentativeDto | null;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const create = useCreateGoldRepresentative();
  const update = useUpdateGoldRepresentative();
  const companies = useGoldCompanies({ pageSize: 100 });

  const [companyId, setCompanyId] = useState(representative?.companyId ?? '');
  const [fullName, setFullName] = useState(representative?.fullName ?? '');
  const [nationalId, setNationalId] = useState(representative?.nationalId ?? '');
  const [phone, setPhone] = useState(representative?.phone ?? '');
  const [jobTitle, setJobTitle] = useState(representative?.jobTitle ?? '');
  const [joinDate, setJoinDate] = useState(toDateInput(representative?.joinDate));
  const [status, setStatus] = useState<GoldActiveStatus>(representative?.status ?? 'active');
  const [notes, setNotes] = useState(representative?.notes ?? '');

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (companyId === '' || fullName.trim() === '') return;
    const optional = (value: string): string | undefined => {
      const text = value.trim();
      return text === '' ? undefined : text;
    };
    // An empty date field means "not recorded", which is a null on update and simply absent on
    // create — never today's date, which is what a blank input would otherwise become. Emptied
    // TEXT fields read the same way on update: `null` clears them, `undefined` would keep the old
    // value.
    const joined = joinDate === '' ? undefined : new Date(joinDate);
    try {
      if (representative === null) {
        await create.mutateAsync({
          companyId,
          fullName: fullName.trim(),
          status,
          nationalId: optional(nationalId),
          phone: optional(phone),
          jobTitle: optional(jobTitle),
          notes: optional(notes),
          ...(joined === undefined ? {} : { joinDate: joined }),
        });
      } else {
        await update.mutateAsync({
          id: representative.id,
          body: {
            companyId,
            fullName: fullName.trim(),
            status,
            nationalId: optional(nationalId) ?? null,
            phone: optional(phone) ?? null,
            jobTitle: optional(jobTitle) ?? null,
            notes: optional(notes) ?? null,
            joinDate: joined ?? null,
            version: representative.version,
          },
        });
      }
      toast.success(t('gold.common.saved'));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={
        representative === null
          ? t('gold.representatives.newTitle')
          : t('gold.representatives.editTitle')
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('gold.common.cancel')}
          </Button>
          <Button
            form="gold-representative-form"
            type="submit"
            loading={create.isPending || update.isPending}
            disabled={companyId === '' || fullName.trim() === ''}
          >
            {t('gold.common.save')}
          </Button>
        </>
      }
    >
      <form id="gold-representative-form" onSubmit={(e) => void submit(e)} className="space-y-4">
        <Field label={t('gold.representatives.company')} required>
          <Select
            value={companyId}
            onChange={(e) => {
              setCompanyId(e.target.value);
            }}
            required
          >
            <option value="">{t('gold.representatives.selectCompany')}</option>
            {(companies.data?.items ?? []).map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('gold.representatives.fullName')} required>
            <Input
              value={fullName}
              onChange={(e) => {
                setFullName(e.target.value);
              }}
              required
            />
          </Field>
          <Field label={t('gold.common.nationalId')}>
            <Input
              value={nationalId}
              dir="ltr"
              onChange={(e) => {
                setNationalId(e.target.value);
              }}
            />
          </Field>
          <Field label={t('gold.representatives.phone')}>
            <Input
              value={phone}
              dir="ltr"
              onChange={(e) => {
                setPhone(e.target.value);
              }}
            />
          </Field>
          <Field label={t('gold.representatives.jobTitle')}>
            <Input
              value={jobTitle}
              onChange={(e) => {
                setJobTitle(e.target.value);
              }}
            />
          </Field>
          <Field label={t('gold.representatives.joinDate')}>
            <Input
              type="date"
              value={joinDate}
              onChange={(e) => {
                setJoinDate(e.target.value);
              }}
            />
          </Field>
          <Field label={t('gold.common.status')}>
            <Select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as GoldActiveStatus);
              }}
            >
              <option value="active">{t('gold.activeStatus.active')}</option>
              <option value="inactive">{t('gold.activeStatus.inactive')}</option>
            </Select>
          </Field>
        </div>
        <Field label={t('gold.common.notes')}>
          <Textarea
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
            }}
          />
        </Field>
      </form>
    </Dialog>
  );
};
