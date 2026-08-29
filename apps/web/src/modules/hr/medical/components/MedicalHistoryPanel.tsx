// One person's medical history — what happened, and what was said (P-HR-MED D7, D8, D9, D13).
//
// EVERY ROW IS READ-ONLY AND THERE IS NO EDIT BUTTON, because there is no edit route: an event
// records what was said on a day, and a correction is a NEW event. The screen agrees with the
// server rather than offering something it would refuse.
//
// A RESTRICTION IS PRINTED AS THE SENTENCE IT IS (D8). It is not parsed, not turned into a chip,
// and not matched against anybody's roster — the manager reading it is the one who acts on it.
//
// AN EXPIRY IS SHOWN AND MEANS NOTHING BY ITSELF (D13). It is printed because it is on the
// certificate. It is not coloured when it passes, not sorted to the top, and nothing here counts
// how many have lapsed — that would be a compliance report computed from a rule nobody has given.
import { useState } from 'react';
import {
  MEDICAL_EVENT_TYPES,
  type FitnessVerdict,
  type Locale,
  type MedicalEventDto,
  type MedicalEventType,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Can } from '../../../../platform/rbac/Can';
import { Button } from '../../../../shared/ui/Button';
import { Badge, type Tone } from '../../../../shared/ui/Badge';
import { Field, Input, Select, Textarea } from '../../../../shared/ui/form';
import { Spinner } from '../../../../shared/ui/Spinner';
import { formatDate } from '../../../../shared/lib/format';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { useMedicalEvents, useRecordMedicalEvent } from '../api/medical-queries';

const PAGE_SIZE = 50;

/**
 * The verdict's tone.
 *
 * `unfit` is `warning` rather than `danger`: a person is not an error. The colour is there so a
 * reader can find the row, not to render a judgement about somebody's body in red.
 */
const VERDICT_TONE: Record<FitnessVerdict, Tone> = {
  fit: 'success',
  fitWithRestrictions: 'info',
  unfitForRole: 'warning',
  unfitGenerally: 'warning',
};

const RecordForm = ({
  employeeId,
  onDone,
}: {
  employeeId: string;
  onDone: () => void;
}): JSX.Element => {
  const t = useT();
  const record = useRecordMedicalEvent();
  const [type, setType] = useState<MedicalEventType>('periodicCheck');
  const [occurredOn, setOccurredOn] = useState('');
  const [provider, setProvider] = useState('');
  const [verdict, setVerdict] = useState<FitnessVerdict | ''>('');
  const [restriction, setRestriction] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);

  // The server refuses a restricted verdict with no restriction; the button agrees with it, so the
  // refusal never has to be the UI.
  const complete =
    occurredOn !== '' && (verdict !== 'fitWithRestrictions' || restriction.trim() !== '');

  const submit = async (): Promise<void> => {
    if (!complete) return;
    try {
      await record.mutateAsync({
        body: {
          employeeId,
          type,
          occurredOn: new Date(occurredOn),
          ...(provider.trim() === '' ? {} : { provider: provider.trim() }),
          ...(verdict === '' ? {} : { verdict }),
          ...(restriction.trim() === '' ? {} : { restriction: restriction.trim() }),
          ...(validUntil === '' ? {} : { validUntil: new Date(validUntil) }),
          ...(note.trim() === '' ? {} : { note: note.trim() }),
        },
        file,
      });
      toast.success(t('medical.event.recorded'));
      onDone();
    } catch {
      // surfaced globally
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <div className="flex gap-3">
        <Field label={t('medical.event.type')} required>
          <Select value={type} onChange={(e) => setType(e.target.value as MedicalEventType)}>
            {MEDICAL_EVENT_TYPES.map((value) => (
              <option key={value} value={value}>
                {t(`medical.event.type.${value}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('medical.event.occurredOn')} required>
          <Input
            type="date"
            value={occurredOn}
            onChange={(e) => setOccurredOn(e.target.value)}
            dir="ltr"
          />
        </Field>
      </div>

      <Field label={t('medical.event.provider')}>
        <Input value={provider} onChange={(e) => setProvider(e.target.value)} maxLength={200} />
      </Field>

      <Field label={t('medical.event.verdict')} hint={t('medical.event.verdictHint')}>
        <Select value={verdict} onChange={(e) => setVerdict(e.target.value as FitnessVerdict | '')}>
          <option value="">{t('medical.event.noVerdict')}</option>
          <option value="fit">{t('medical.event.verdict.fit')}</option>
          <option value="fitWithRestrictions">
            {t('medical.event.verdict.fitWithRestrictions')}
          </option>
          <option value="unfitForRole">{t('medical.event.verdict.unfitForRole')}</option>
          <option value="unfitGenerally">{t('medical.event.verdict.unfitGenerally')}</option>
        </Select>
      </Field>

      {verdict === 'fitWithRestrictions' && (
        <Field
          label={t('medical.event.restriction')}
          hint={t('medical.event.restrictionHint')}
          required
        >
          <Textarea value={restriction} onChange={(e) => setRestriction(e.target.value)} rows={2} />
        </Field>
      )}

      <div className="flex gap-3">
        {/* Recorded because it is on the certificate. Nothing acts on it (D13) — the hint says so. */}
        <Field label={t('medical.event.validUntil')} hint={t('medical.event.validUntilHint')}>
          <Input
            type="date"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
            dir="ltr"
          />
        </Field>
        <Field label={t('medical.event.document')}>
          <input
            type="file"
            accept="application/pdf,image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm"
          />
        </Field>
      </div>

      <Field label={t('medical.event.note')}>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
      </Field>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        {t('medical.event.immutableWarning')}
      </p>

      <div className="flex justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={onDone}>
          {t('common.cancel')}
        </Button>
        <Button
          size="sm"
          loading={record.isPending}
          disabled={!complete}
          onClick={() => void submit()}
        >
          {t('medical.event.record')}
        </Button>
      </div>
    </div>
  );
};

export const MedicalHistoryPanel = ({ employeeId }: { employeeId: string }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [adding, setAdding] = useState(false);
  const { data, isLoading } = useMedicalEvents({ employeeId, page: 1, pageSize: PAGE_SIZE });
  const events = data?.items ?? [];

  return (
    <div className="space-y-3">
      {isLoading && (
        <div className="grid place-items-center py-6">
          <Spinner />
        </div>
      )}

      {!isLoading && events.length === 0 && !adding && (
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('medical.event.none')}</p>
      )}

      <ul className="space-y-2">
        {events.map((event: MedicalEventDto) => (
          <li
            key={event.id}
            className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                {t(`medical.event.type.${event.type}`)}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400" dir="ltr">
                {formatDate(event.occurredOn, locale)}
              </span>
            </div>
            {event.verdict !== null && (
              <div className="mt-1">
                <Badge tone={VERDICT_TONE[event.verdict]} size="sm">
                  {t(`medical.event.verdict.${event.verdict}`)}
                </Badge>
              </div>
            )}
            {/* The sentence, printed. Nothing parses it (D8). */}
            {event.restriction !== null && (
              <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">{event.restriction}</p>
            )}
            {event.provider !== null && (
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{event.provider}</p>
            )}
            {event.validUntil !== null && (
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400" dir="ltr">
                {`${t('medical.event.validUntil')}: ${formatDate(event.validUntil, locale)}`}
              </p>
            )}
            {event.note !== null && (
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{event.note}</p>
            )}
            {event.documentFileName !== null && (
              <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
                {event.documentFileName}
              </p>
            )}
          </li>
        ))}
      </ul>

      {!adding && (
        <Can permission="medicalRecord.manage">
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            {t('medical.event.record')}
          </Button>
        </Can>
      )}
      {adding && <RecordForm employeeId={employeeId} onDone={() => setAdding(false)} />}
    </div>
  );
};
