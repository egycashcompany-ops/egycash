// One machine's cassettes (S-1, S-2, §9.5 «Editor panel»): how many, and per cassette its kind,
// denomination and currency; the three Full list labels the papers print (DS-5); the standard load
// it fills from (DS-8). Every save keeps a version, listed under «سجل التعديلات».
//
// A CHANGE APPLIES FROM THE MOMENT IT IS SAVED (GS-26): lines already on today's or a later plan
// keep their snapshot and warn (`LAYOUT_CHANGED`, `LAYOUT_CHANGED_AFTER_ISSUE`), so the save first
// lists those lines and asks.
//
// THE RULES ARE THE CONTRACTS' (`layoutIssues`): what is wrong shows under its slot, and the save
// stays disabled until nothing is — the server applies the same rules again.
import { useEffect, useMemo, useState } from 'react';
import {
  ATM_LABEL_MAX,
  ATM_LAYOUT_SLOTS_MAX,
  ATM_LAYOUT_SLOTS_MIN,
  bagAllocation,
  layoutIssues,
  type AtmCassetteLayoutDetailDto,
  type AtmCassetteLayoutVersionDto,
  type AtmCassetteSlot,
  type AtmLayoutIssueCode,
  type AtmStandardLoadDto,
  type Locale,
  type SaveAtmCassetteLayout,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { cn } from '../../../../shared/lib/cn';
import { formatBusinessDateTime, formatNumber } from '../../../../shared/lib/format';
import { Button } from '../../../../shared/ui/Button';
import { Dialog } from '../../../../shared/ui/Dialog';
import { Field, Input, Select, Textarea } from '../../../../shared/ui/form';
import { formatPaperDate } from '../../lib/settlement-dates';
import { bagsText } from '../../lib/settlement-view';
import { standardLoadLabel } from './PlanLinePanel';
import { SlotEditor } from './SlotEditor';

type Translate = (key: string, params?: Record<string, string | number>) => string;

const SLOT_COUNTS = Array.from(
  { length: ATM_LAYOUT_SLOTS_MAX - ATM_LAYOUT_SLOTS_MIN + 1 },
  (_, i) => ATM_LAYOUT_SLOTS_MIN + i,
);

const freshSlot = (n: number): AtmCassetteSlot => ({
  slot: n,
  kind: 'withdrawal',
  denomination: null,
  currency: 'EGP',
});

/** A slot as the history line names it: its denomination, «↻» recycle, the kind otherwise. */
const slotWord = (slot: AtmCassetteSlot | undefined, t: Translate): string => {
  if (slot === undefined || slot.kind === 'empty') return '—';
  if (slot.kind === 'deposit') return t('atm.settlement.slotKind.deposit');
  const currency = slot.currency !== null && slot.currency !== 'EGP' ? ` ${slot.currency}` : '';
  return `${slot.kind === 'recycle' ? '↻' : ''}${String(slot.denomination ?? '—')}${currency}`;
};

/** «الكاسيت 3: 50 ← 100» for every slot that differs from the version before. */
export const versionDiff = (
  newer: Pick<AtmCassetteLayoutVersionDto, 'slots'>,
  older: Pick<AtmCassetteLayoutVersionDto, 'slots'> | undefined,
  t: Translate,
): string => {
  if (older === undefined) return '';
  const count = Math.max(newer.slots.length, older.slots.length);
  const parts: string[] = [];
  for (let n = 1; n <= count; n += 1) {
    const before = slotWord(
      older.slots.find((s) => s.slot === n),
      t,
    );
    const after = slotWord(
      newer.slots.find((s) => s.slot === n),
      t,
    );
    if (before !== after)
      parts.push(t('atm.layouts.editor.historyDiff', { slot: n, before, after }));
  }
  return parts.join(' · ');
};

interface Draft {
  slots: AtmCassetteSlot[];
  typeLabel: string;
  featuresLabel: string;
  hubLabel: string;
  standardLoadId: string;
  reason: string;
}

const draftOf = (detail: AtmCassetteLayoutDetailDto): Draft => ({
  slots:
    detail.layout === null
      ? [1, 2, 3, 4].map(freshSlot)
      : [...detail.layout.slots].sort((a, b) => a.slot - b.slot),
  typeLabel: detail.layout?.typeLabel ?? '',
  featuresLabel: detail.layout?.featuresLabel ?? '',
  hubLabel: detail.layout?.hubLabel ?? '',
  standardLoadId: detail.layout?.standardLoadId ?? '',
  reason: '',
});

const textOrNull = (value: string): string | null => (value.trim() === '' ? null : value.trim());

export const LayoutEditor = ({
  detail,
  locale,
  canManage,
  standardLoads,
  busy,
  error,
  onSave,
}: {
  detail: AtmCassetteLayoutDetailDto;
  locale: Locale;
  canManage: boolean;
  standardLoads: readonly AtmStandardLoadDto[];
  busy: boolean;
  error: string | null;
  onSave: (body: SaveAtmCassetteLayout) => void;
}): JSX.Element => {
  const t = useT();
  const [draft, setDraft] = useState<Draft>(() => draftOf(detail));
  const [confirmOpen, setConfirmOpen] = useState(false);
  // A new machine, or a new saved version of this one, starts the editor again from the server.
  const seed = `${detail.machineId}:${String(detail.layout?.version ?? -1)}`;
  useEffect(() => {
    setDraft(draftOf(detail));
    setConfirmOpen(false);
  }, [seed]);

  const editable = canManage && detail.active;
  const issues = useMemo(() => layoutIssues(draft.slots), [draft.slots]);
  const issuesOf = (n: number): AtmLayoutIssueCode[] =>
    issues.filter((i) => i.slot === n).map((i) => i.code);
  const general = issues.filter((i) => i.slot === null);
  const bags = bagAllocation(draft.slots).length;

  const setCount = (count: number): void =>
    setDraft((d) => ({
      ...d,
      slots:
        count <= d.slots.length
          ? d.slots.slice(0, count)
          : [
              ...d.slots,
              ...Array.from({ length: count - d.slots.length }, (_, i) =>
                freshSlot(d.slots.length + i + 1),
              ),
            ],
    }));

  const body = (): SaveAtmCassetteLayout => ({
    version: detail.layout?.version ?? null,
    slots: draft.slots,
    typeLabel: textOrNull(draft.typeLabel),
    featuresLabel: textOrNull(draft.featuresLabel),
    hubLabel: textOrNull(draft.hubLabel),
    standardLoadId: draft.standardLoadId === '' ? null : draft.standardLoadId,
    reason: textOrNull(draft.reason),
  });
  const save = (): void => {
    if (detail.affectedLines.length > 0) {
      setConfirmOpen(true);
      return;
    }
    onSave(body());
  };

  return (
    <div className="space-y-4" data-layout-editor={detail.machineId}>
      <div className="border-b border-slate-100 pb-3 dark:border-slate-800">
        <strong dir="ltr" className="text-lg text-slate-900 dark:text-white">
          {detail.machineCode}
        </strong>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {[detail.machineName, detail.area].filter((p) => p !== '').join(' · ')}
        </p>
      </div>

      <div className="space-y-1.5">
        <span className="block text-sm font-medium text-slate-700 dark:text-slate-200">
          {t('atm.layouts.editor.slotCount')}
        </span>
        <div
          role="radiogroup"
          aria-label={t('atm.layouts.editor.slotCount')}
          className="inline-flex overflow-hidden rounded-lg border border-slate-300 dark:border-slate-600"
        >
          {SLOT_COUNTS.map((count) => (
            <button
              key={count}
              type="button"
              role="radio"
              aria-checked={draft.slots.length === count}
              disabled={!editable}
              onClick={() => setCount(count)}
              className={cn(
                'h-9 min-w-10 border-e border-slate-300 px-3 text-sm last:border-e-0 disabled:cursor-not-allowed dark:border-slate-600',
                draft.slots.length === count
                  ? 'bg-brand-600 font-semibold text-white'
                  : 'bg-white text-slate-700 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200',
              )}
            >
              {formatNumber(count, locale)}
            </button>
          ))}
        </div>
        {bags > 0 && (
          <p className="text-xs text-slate-500 dark:text-slate-400" data-layout-bags={bags}>
            {bagsText(bags, t)}
          </p>
        )}
      </div>

      <div className="space-y-2">
        {draft.slots.map((slot, i) => (
          <SlotEditor
            key={slot.slot}
            slot={slot}
            label={t('atm.layouts.editor.slot', { slot: slot.slot })}
            issues={issuesOf(slot.slot)}
            disabled={!editable}
            onChange={(next) =>
              setDraft((d) => ({ ...d, slots: d.slots.map((s, k) => (k === i ? next : s)) }))
            }
          />
        ))}
        {general.length > 0 && (
          <ul className="text-xs text-red-600 dark:text-red-400">
            {general.map((issue) => (
              <li key={issue.code}>{t(`atm.layouts.layoutIssue.${issue.code}`)}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-3">
        <Field label={t('atm.layouts.editor.typeLabel')} htmlFor="layout-type">
          <Input
            id="layout-type"
            maxLength={ATM_LABEL_MAX.typeLabel}
            value={draft.typeLabel}
            disabled={!editable}
            onChange={(e) => setDraft((d) => ({ ...d, typeLabel: e.target.value }))}
          />
        </Field>
        <Field label={t('atm.layouts.editor.featuresLabel')} htmlFor="layout-features">
          <Input
            id="layout-features"
            maxLength={ATM_LABEL_MAX.featuresLabel}
            value={draft.featuresLabel}
            disabled={!editable}
            onChange={(e) => setDraft((d) => ({ ...d, featuresLabel: e.target.value }))}
          />
        </Field>
        <Field label={t('atm.layouts.editor.hubLabel')} htmlFor="layout-hub">
          <Input
            id="layout-hub"
            maxLength={ATM_LABEL_MAX.hubLabel}
            value={draft.hubLabel}
            disabled={!editable}
            onChange={(e) => setDraft((d) => ({ ...d, hubLabel: e.target.value }))}
          />
        </Field>
        <Field label={t('atm.layouts.column.standardLoad')} htmlFor="layout-load">
          <Select
            id="layout-load"
            value={draft.standardLoadId}
            disabled={!editable}
            onChange={(e) => setDraft((d) => ({ ...d, standardLoadId: e.target.value }))}
          >
            <option value="">{t('atm.plan.panel.standardDefault')}</option>
            {standardLoads.map((load) => (
              <option key={load.id} value={load.id}>
                {standardLoadLabel(load, locale)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {editable && (
        <div className="space-y-3">
          <Field label={t('atm.layouts.editor.reason')} htmlFor="layout-reason">
            <Textarea
              id="layout-reason"
              rows={2}
              maxLength={300}
              value={draft.reason}
              onChange={(e) => setDraft((d) => ({ ...d, reason: e.target.value }))}
            />
          </Field>
          {error !== null && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          <Button loading={busy} disabled={issues.length > 0} onClick={save}>
            {t('atm.layouts.editor.save')}
          </Button>
        </div>
      )}

      {detail.versions.length > 0 && (
        <section className="space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            {t('atm.layouts.editor.history')}
          </h3>
          <ol
            className="space-y-2 text-xs text-slate-600 dark:text-slate-300"
            data-layout-history="true"
          >
            {detail.versions.map((version, i) => {
              const diff = versionDiff(version, detail.versions[i + 1], t);
              return (
                <li key={version.revision}>
                  <span className="text-slate-500 dark:text-slate-400">
                    {formatBusinessDateTime(version.changedAt, locale)}
                  </span>{' '}
                  — {version.changedByName ?? '—'} · {t(`atm.layouts.source.${version.source}`)}
                  {diff !== '' && <span className="block">{diff}</span>}
                  {version.reason !== null && (
                    <span className="block text-slate-500 dark:text-slate-400">
                      {version.reason}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t('atm.layouts.editor.save')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              loading={busy}
              onClick={() => {
                setConfirmOpen(false);
                onSave(body());
              }}
            >
              {t('atm.layouts.editor.save')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-700 dark:text-slate-200">
          {t('atm.layouts.editor.affected', {
            n: formatNumber(detail.affectedLines.length, locale),
          })}
        </p>
        <ul
          className="mt-3 space-y-1 text-sm text-slate-600 dark:text-slate-300"
          data-affected-lines="true"
        >
          {detail.affectedLines.map((line) => (
            <li key={line.lineId}>
              {formatPaperDate(line.replenishDate)} ·{' '}
              {line.serial === null
                ? t('atm.settlement.status.draft')
                : `${t('atm.settlement.serial')} ${formatNumber(line.serial, locale)}`}{' '}
              · {t(`atm.settlement.run.${String(line.run)}`)}
            </li>
          ))}
        </ul>
      </Dialog>
    </div>
  );
};
