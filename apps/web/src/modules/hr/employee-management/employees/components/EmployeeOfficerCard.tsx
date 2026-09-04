// The employee's officer / armed-security profile (بيانات الضباط).
//
// A cash-in-transit company holds facts about its armed staff that fit nowhere else: a weapon
// licence and when it expires, a military rank, whether the profession-practice licence was issued,
// and the date of referral to pension. Around a tenth of the workforce carries any of it, so the
// empty state is the COMMON one and the card says "none recorded" rather than rendering a grid of
// dashes for everybody else.
//
// The licence expiry is the one field here with an operational edge — an expired weapon licence is
// a person who must not be rostered armed — so it is badged when it has passed.
import { useEffect, useState } from 'react';
import { WEAPON_LICENSE_TYPES, type EmployeeDto, type Locale, type WeaponLicenseType } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Can } from '../../../../../platform/rbac/Can';
import { Card, CardBody, CardHeader } from '../../../../../shared/ui/Card';
import { Button } from '../../../../../shared/ui/Button';
import { Badge } from '../../../../../shared/ui/Badge';
import { Checkbox, Field, Input, Select } from '../../../../../shared/ui/form';
import { formatDate } from '../../../../../shared/lib/format';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { useUpdateEmployeeOfficer } from '../api/employee-queries';

interface Draft {
  reserveOfficer: boolean;
  rank: string;
  licenseType: '' | WeaponLicenseType;
  licenseExpiry: string;
  professionPractice: boolean;
  retirementDate: string;
}

const EMPTY: Draft = {
  reserveOfficer: false,
  rank: '',
  licenseType: '',
  licenseExpiry: '',
  professionPractice: false,
  retirementDate: '',
};

/** ISO instant → the `yyyy-mm-dd` a date input needs. */
const dateInput = (iso: string | null): string => (iso === null ? '' : iso.slice(0, 10));

const draftOf = (e: EmployeeDto): Draft => {
  const o = e.officer;
  if (o === null) return EMPTY;
  return {
    reserveOfficer: o.reserveOfficer,
    rank: o.rank ?? '',
    licenseType: o.weaponLicense?.type ?? '',
    licenseExpiry: dateInput(o.weaponLicense?.expiry ?? null),
    professionPractice: o.professionPractice,
    retirementDate: dateInput(o.retirementDate),
  };
};

export const EmployeeOfficerCard = ({ e }: { e: EmployeeDto }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const update = useUpdateEmployeeOfficer(e.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftOf(e));

  useEffect(() => {
    if (!editing) setDraft(draftOf(e));
  }, [e, editing]);

  const submit = async (): Promise<void> => {
    try {
      await update.mutateAsync({
        reserveOfficer: draft.reserveOfficer,
        rank: draft.rank.trim() === '' ? null : draft.rank.trim(),
        // A licence is its type; an expiry with no type is not a licence, so the whole block goes
        // null together rather than storing a dangling date.
        weaponLicense:
          draft.licenseType === ''
            ? null
            : {
                type: draft.licenseType,
                expiry: draft.licenseExpiry === '' ? null : new Date(draft.licenseExpiry),
              },
        professionPractice: draft.professionPractice,
        retirementDate: draft.retirementDate === '' ? null : new Date(draft.retirementDate),
        version: e.version,
      });
      setEditing(false);
      toast.success(t('employees.officer.saved'));
    } catch {
      // Refusals surface globally in the server's own words.
    }
  };

  if (!e.officerVisible) {
    return (
      <Card>
        <CardHeader title={t('employees.officer.title')} />
        <CardBody>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('employees.officer.hidden')}
          </p>
        </CardBody>
      </Card>
    );
  }

  const expiry = e.officer?.weaponLicense?.expiry ?? null;
  const expired = expiry !== null && new Date(expiry).getTime() < Date.now();

  return (
    <Card>
      <CardHeader
        title={t('employees.officer.title')}
        description={t('employees.officer.hint')}
        actions={
          <Can permission="employee.manageOfficer">
            {editing ? null : (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                {t('common.edit')}
              </Button>
            )}
          </Can>
        }
      />
      <CardBody className="space-y-4">
        {editing ? (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t('employees.officer.rank')} htmlFor="off-rank">
                <Input
                  id="off-rank"
                  value={draft.rank}
                  onChange={(ev) => setDraft((d) => ({ ...d, rank: ev.target.value }))}
                />
              </Field>
              <Field label={t('employees.officer.retirementDate')} htmlFor="off-retirement">
                <Input
                  id="off-retirement"
                  type="date"
                  value={draft.retirementDate}
                  onChange={(ev) => setDraft((d) => ({ ...d, retirementDate: ev.target.value }))}
                  dir="ltr"
                />
              </Field>
              <Field label={t('employees.officer.weaponLicense')} htmlFor="off-license">
                <Select
                  id="off-license"
                  value={draft.licenseType}
                  onChange={(ev) =>
                    setDraft((d) => ({ ...d, licenseType: ev.target.value as '' | WeaponLicenseType }))
                  }
                >
                  <option value="">{t('employees.officer.noLicense')}</option>
                  {WEAPON_LICENSE_TYPES.map((w) => (
                    <option key={w} value={w}>
                      {t(`employees.officer.license.${w}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label={t('employees.officer.licenseExpiry')}
                htmlFor="off-license-expiry"
                hint={draft.licenseType === '' ? t('employees.officer.expiryNeedsType') : undefined}
              >
                <Input
                  id="off-license-expiry"
                  type="date"
                  value={draft.licenseExpiry}
                  disabled={draft.licenseType === ''}
                  onChange={(ev) => setDraft((d) => ({ ...d, licenseExpiry: ev.target.value }))}
                  dir="ltr"
                />
              </Field>
            </div>
            <div className="space-y-2">
              <Checkbox
                label={t('employees.officer.reserveOfficer')}
                checked={draft.reserveOfficer}
                onChange={(ev) => setDraft((d) => ({ ...d, reserveOfficer: ev.target.checked }))}
              />
              <Checkbox
                label={t('employees.officer.professionPractice')}
                checked={draft.professionPractice}
                onChange={(ev) => setDraft((d) => ({ ...d, professionPractice: ev.target.checked }))}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={() => void submit()} disabled={update.isPending}>
                {t('common.save')}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setDraft(draftOf(e));
                  setEditing(false);
                }}
              >
                {t('common.cancel')}
              </Button>
            </div>
          </>
        ) : e.officer === null ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('employees.officer.none')}</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {e.officer.reserveOfficer ? (
                <Badge tone="info">{t('employees.officer.reserveOfficer')}</Badge>
              ) : null}
              {e.officer.professionPractice ? (
                <Badge tone="success">{t('employees.officer.professionPractice')}</Badge>
              ) : null}
              {expired ? <Badge tone="danger">{t('employees.officer.licenseExpired')}</Badge> : null}
            </div>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500 dark:text-slate-400">
                  {t('employees.officer.rank')}
                </dt>
                <dd className="font-medium">{e.officer.rank ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500 dark:text-slate-400">
                  {t('employees.officer.weaponLicense')}
                </dt>
                <dd className="font-medium">
                  {e.officer.weaponLicense === null
                    ? '—'
                    : t(`employees.officer.license.${e.officer.weaponLicense.type}`)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500 dark:text-slate-400">
                  {t('employees.officer.licenseExpiry')}
                </dt>
                <dd className="font-medium" dir="ltr">
                  {expiry === null ? '—' : formatDate(expiry, locale)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500 dark:text-slate-400">
                  {t('employees.officer.retirementDate')}
                </dt>
                <dd className="font-medium" dir="ltr">
                  {e.officer.retirementDate === null
                    ? '—'
                    : formatDate(e.officer.retirementDate, locale)}
                </dd>
              </div>
            </dl>
          </>
        )}
      </CardBody>
    </Card>
  );
};
