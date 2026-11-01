// One line's bags and seals as Preparation scans them (S-7, §9.6): per bag, its cassettes in slot
// order, each with its seal, then the bag's QR (GS-32). A 0-note cassette's seal and the QR of a bag
// whose cassettes all hold 0 notes are optional (DS-13).
//
// The page owns the form and the focus (`PreparationPage.tsx`); this panel draws the fields, the
// warnings under each — duplicates, Arabic letters, a value somebody else saved meanwhile — and the
// buttons. Nothing here blocks a save: a duplicate is a warning (S-7), and only «تم التجهيز» waits
// for what is required.
import { type Ref } from 'react';
import {
  isPlanned,
  type AtmPreparationLineDto,
  type AtmSealDuplicateDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { formatNumber } from '../../../../shared/lib/format';
import { Badge } from '../../../../shared/ui/Badge';
import { Button } from '../../../../shared/ui/Button';
import {
  fieldId,
  fieldOrder,
  type CaptureFieldId,
  type CaptureForm,
  type LocalDuplicate,
} from '../../lib/preparation-form';
import {
  PREPARATION_STATUS_TONE,
  formatEgp,
  lineCode,
  preparationStatusKey,
  prepStateOf,
  runLabel,
} from '../../lib/settlement-view';
import { formatTime12 } from '../../lib/settlement-dates';
import { DuplicateNote } from './DuplicateNote';
import { SealInput } from './SealInput';

/** «حفظ»'s id: the last field's scan moves the focus to it (§9.6). */
export const CAPTURE_SAVE_ID = 'capture-save';

/** The server's duplicate for one field of the line. */
const serverDuplicateOf = (
  line: AtmPreparationLineDto,
  id: CaptureFieldId,
): AtmSealDuplicateDto | undefined => {
  const [kind, n] = id.split(':') as ['seal' | 'qr', string];
  return line.duplicates.find((d) =>
    kind === 'seal'
      ? d.field === 'seal' && d.slot === Number(n)
      : d.field === 'bag' && d.bag === Number(n),
  );
};

export const CapturePanel = ({
  line,
  form,
  locale,
  readOnly,
  canCapture,
  localDuplicates,
  arabicFields,
  missing,
  busy,
  fieldRef,
  onChange,
  onAdvance,
  onResolve,
  onSave,
  onPrepared,
  onReopen,
}: {
  line: AtmPreparationLineDto;
  form: CaptureForm;
  locale: Locale;
  /** Cancelled, prepared, or no capture key: the values are shown, not edited. */
  readOnly: boolean;
  canCapture: boolean;
  localDuplicates: readonly LocalDuplicate[];
  arabicFields: ReadonlySet<CaptureFieldId>;
  /** What «تم التجهيز» still waits for, in words. */
  missing: readonly string[];
  busy: boolean;
  fieldRef: (id: CaptureFieldId) => Ref<HTMLInputElement>;
  onChange: (id: CaptureFieldId, value: string) => void;
  onAdvance: (id: CaptureFieldId) => void;
  onResolve: (id: CaptureFieldId, choice: 'mine' | 'server') => void;
  onSave: () => void;
  onPrepared: () => void;
  onReopen: () => void;
}): JSX.Element => {
  const t = useT();
  const state = prepStateOf(line);
  const time = formatTime12(line.scheduleTime, locale);
  const slotOf = (n: number) => line.slots.filter(isPlanned).find((s) => s.slot === n);
  const required = (id: CaptureFieldId): boolean => {
    const [kind, n] = id.split(':') as ['seal' | 'qr', string];
    return kind === 'seal'
      ? (line.preparation.seals.find((s) => s.slot === Number(n))?.required ?? false)
      : (line.preparation.bags.find((b) => b.bag === Number(n))?.required ?? false);
  };
  const order = fieldOrder(line.preparation.bags);
  const requiredIds = order.map(fieldId).filter(required);
  const captured = requiredIds.filter((id) => (form.values[id] ?? '').trim() !== '').length;

  const field = (id: CaptureFieldId, label: string, caption: string | undefined): JSX.Element => {
    const local = localDuplicates.find((d) => d.field === id);
    const server = serverDuplicateOf(line, id);
    const conflict = form.conflicts.find((c) => c.field === id);
    const arabic = arabicFields.has(id);
    const optional = !required(id);
    return (
      <SealInput
        key={id}
        ref={fieldRef(id)}
        id={`capture-${id.replace(':', '-')}`}
        label={label}
        caption={[caption, optional ? t('atm.prep.optional') : undefined]
          .filter((p) => p !== undefined)
          .join(' · ')}
        value={form.values[id] ?? ''}
        disabled={readOnly}
        duplicate={local !== undefined || server !== undefined}
        warning={arabic || conflict !== undefined}
        onChange={(value) => onChange(id, value)}
        onAdvance={() => onAdvance(id)}
      >
        <DuplicateNote local={local} server={server} />
        {arabic && <span className="block">⚠ {t('atm.prep.warning.arabicLetters')}</span>}
        {conflict !== undefined && (
          <span className="block space-y-1" data-capture-conflict={id}>
            <span className="block">⚠ {t('atm.prep.conflict')}</span>
            <span className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => onResolve(id, 'mine')}>
                {t('atm.prep.conflictMine', { value: form.values[id] ?? '' })}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => onResolve(id, 'server')}>
                {t('atm.prep.conflictServer', { value: conflict.server })}
              </Button>
            </span>
          </span>
        )}
      </SealInput>
    );
  };

  return (
    <div className="space-y-4" data-capture-panel={line.lineId}>
      <div className="space-y-1 border-b border-slate-100 pb-3 dark:border-slate-800">
        <div className="flex flex-wrap items-center gap-2">
          <strong dir="ltr" className="text-lg text-slate-900 dark:text-white">
            {lineCode(line)}
          </strong>
          {line.serial !== null && (
            <span className="text-sm text-slate-500 dark:text-slate-400">
              {t('atm.settlement.serial')} {formatNumber(line.serial, locale)}
            </span>
          )}
          <Badge
            tone={state === 'cancelled' ? 'neutral' : PREPARATION_STATUS_TONE[state]}
            size="sm"
          >
            {state === 'cancelled'
              ? t('atm.settlement.status.cancelled')
              : t(preparationStatusKey(state))}
          </Badge>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {[
            line.kind === 'spare'
              ? `${t('atm.paper.spareSet')} ${line.typeLabel ?? ''}`.trim()
              : line.machineName,
            time === '' ? runLabel(line.run, t) : `${runLabel(line.run, t)} · ${time}`,
          ]
            .filter((p) => p !== null && p !== '')
            .join(' · ')}
        </p>
        <p className="text-sm text-slate-700 dark:text-slate-200">
          {t('atm.plan.panel.machineTotal')}:{' '}
          <strong className="tabular-nums">{formatEgp(line.egpTotalMinor, locale)}</strong>
        </p>
      </div>

      {!readOnly && (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
          {t('atm.prep.instruction')}
        </p>
      )}

      {[...line.preparation.bags]
        .sort((a, b) => a.bag - b.bag)
        .map((bag) => (
          <section
            key={bag.bag}
            data-capture-bag={bag.bag}
            className="space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700"
          >
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              {t(`atm.settlement.bag.${String(bag.bag)}`)}
            </h3>
            {[...bag.slots]
              .sort((a, b) => a - b)
              .map((n) => {
                const slot = slotOf(n);
                return field(
                  `seal:${n}`,
                  t('atm.prep.sealLabel', { slot: n }),
                  t('atm.prep.cassetteRow', {
                    slot: n,
                    d: slot?.denomination ?? '—',
                    n: formatNumber(slot?.notes ?? 0, locale),
                  }),
                );
              })}
            {field(`qr:${bag.bag}`, t(`atm.prep.qrLabel.${String(bag.bag)}`), t('atm.prep.bagQr'))}
          </section>
        ))}

      <p className="text-sm text-slate-600 dark:text-slate-300" data-capture-progress="true">
        {t('atm.prep.progress', {
          n: formatNumber(captured, locale),
          m: formatNumber(requiredIds.length, locale),
        })}
      </p>

      {canCapture && line.lineStatus !== 'cancelled' && (
        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          {line.preparation.status === 'open' ? (
            <>
              <Button id={CAPTURE_SAVE_ID} loading={busy} onClick={onSave}>
                {t('atm.prep.save')}
              </Button>
              <Button
                variant="secondary"
                disabled={busy || missing.length > 0}
                title={
                  missing.length > 0
                    ? t('atm.prep.error.incomplete', { list: missing.join('، ') })
                    : undefined
                }
                data-capture-prepared="true"
                onClick={onPrepared}
              >
                {t('atm.prep.prepared')}
              </Button>
            </>
          ) : (
            <Button variant="secondary" loading={busy} onClick={onReopen}>
              {t('atm.prep.reopen')}
            </Button>
          )}
        </div>
      )}
      {missing.length > 0 && line.preparation.status === 'open' && !readOnly && (
        <p className="text-xs text-slate-500 dark:text-slate-400" data-capture-missing="true">
          {t('atm.prep.error.incomplete', { list: missing.join('، ') })}
        </p>
      )}
    </div>
  );
};
