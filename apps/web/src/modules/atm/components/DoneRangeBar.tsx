// The done pages' from/to day filter — legacy mohDate00/mohDate1000 (contad_app.js:936), default
// today. URL-synced so a shared link shows the same day. Whatever the page puts in `trailing` — its
// Excel and PDF — sits at the far end of the same row.
import { type ReactNode } from 'react';
import { useT } from '../../../platform/localization/useT';
import { Field, Input } from '../../../shared/ui/form';

export const DoneRangeBar = ({
  from,
  to,
  onChange,
  trailing,
}: {
  from: string;
  to: string;
  onChange: (next: { from: string; to: string }) => void;
  trailing?: ReactNode;
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
      {trailing !== undefined && (
        <div className="ms-auto flex flex-wrap items-center gap-2">{trailing}</div>
      )}
    </div>
  );
};
