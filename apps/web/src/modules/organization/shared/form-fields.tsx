// Small bilingual/status form helpers shared by the org-structure forms (units, job titles,
// company). They wrap the shared UI-kit primitives so every screen renders name/status identically
// and stays RTL-safe.
import { type LocalizedString } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Field, Input, Select } from '../../../shared/ui/form';

export type LocalizedValue = { ar: string; en: string };

/** Paired Arabic + English inputs bound to a `{ ar, en }` value. */
export const LocalizedNameFields = ({
  label,
  value,
  onChange,
  required = false,
}: {
  label: string;
  value: LocalizedValue;
  onChange: (next: LocalizedValue) => void;
  required?: boolean;
}): JSX.Element => {
  const t = useT();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={`${label} (${t('organization.lang.ar')})`} required={required}>
        <Input dir="rtl" value={value.ar} onChange={(e) => onChange({ ...value, ar: e.target.value })} />
      </Field>
      <Field label={`${label} (${t('organization.lang.en')})`} required={required}>
        <Input dir="ltr" value={value.en} onChange={(e) => onChange({ ...value, en: e.target.value })} />
      </Field>
    </div>
  );
};

/** active / inactive selector. */
export const StatusSelect = ({
  value,
  onChange,
}: {
  value: 'active' | 'inactive';
  onChange: (next: 'active' | 'inactive') => void;
}): JSX.Element => {
  const t = useT();
  return (
    <Field label={t('organization.field.status')}>
      <Select value={value} onChange={(e) => onChange(e.target.value as 'active' | 'inactive')}>
        <option value="active">{t('organization.status.active')}</option>
        <option value="inactive">{t('organization.status.inactive')}</option>
      </Select>
    </Field>
  );
};

/** Treat a bilingual free-text value as "empty" when neither language is filled. */
export const localizedOrNull = (v: LocalizedValue): LocalizedString | null =>
  v.ar.trim() === '' && v.en.trim() === '' ? null : { ar: v.ar.trim(), en: v.en.trim() };
