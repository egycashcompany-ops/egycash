// The done pages' from/to day filter — legacy mohDate00/mohDate1000 (contad_app.js:936), default
// today. URL-synced so a shared link shows the same day.
import { useT } from '../../../platform/localization/useT';
import { Field, Input } from '../../../shared/ui/form';

export const DoneRangeBar = ({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (next: { from: string; to: string }) => void;
}): JSX.Element => {
  const t = useT();
  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <Field label={t('atm.done.from')}>
        <Input type="date" value={from} onChange={(e) => onChange({ from: e.target.value, to })} />
      </Field>
      <Field label={t('atm.done.to')}>
        <Input type="date" value={to} onChange={(e) => onChange({ from, to: e.target.value })} />
      </Field>
    </div>
  );
};
