// The selected line (§9.4 «Side panel»): its bags and cassettes, the counts (editable on a draft),
// the standard load, the machine total, its issues, and the actions its status allows.
//
// ONE METHOD FOR SEVERAL CASSETTES OF A DENOMINATION (S-4): «إجمالي فئة 200» sends the
// denomination's total and the server splits it evenly in hundreds (`denominationNotes`,
// `splitByDenomination`); a single cassette can still be set by hand afterwards (`notes`).
// Counts are integers; a count that is not a multiple of 100 is a warning, never refused (DS-12).
//
// EVERY EDIT CARRIES THE LINE'S VERSION, so an edit made on a line someone changed meanwhile is a
// 409 and the page re-reads it rather than overwriting it (§6.5).
import { useEffect, useState } from 'react';
import {
  ATM_PLAN_RUNS,
  isPlanned,
  type AtmEgpDenomination,
  type AtmPlanLineDto,
  type AtmPlanRun,
  type AtmPlanSlot,
  type AtmStandardLoadDto,
  type Locale,
  type UpdateAtmPlanLine,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { formatBusinessDateTime, formatNumber } from '../../../../shared/lib/format';
import { Badge } from '../../../../shared/ui/Badge';
import { Button } from '../../../../shared/ui/Button';
import { Input, Select } from '../../../../shared/ui/form';
import {
  DENOMINATION_COLOURS,
  LINE_STATUS_TONE,
  bagSlotsText,
  denominationMinor,
  formatEgp,
  issueText,
  lineBags,
  lineCode,
  lineStatusKey,
  offersLayoutRefresh,
  runLabel,
} from '../../lib/settlement-view';
import { formatTime12 } from '../../lib/settlement-dates';

/** The patch a change sends; the panel adds the version. */
export type LinePatch = Omit<UpdateAtmPlanLine, 'version'>;

/** The count box's step (§9.4): notes go into cassettes in hundreds (S-4, DS-12). */
const NOTES_STEP = 100;

/** One step of the notes box: to the next hundred up or down, never below 0. */
export const stepNotes = (notes: number, direction: 1 | -1): number =>
  Math.max(
    0,
    direction === 1
      ? Math.floor(notes / NOTES_STEP) * NOTES_STEP + NOTES_STEP
      : Math.ceil(notes / NOTES_STEP) * NOTES_STEP - NOTES_STEP,
  );

/**
 * A draft's run or time, changed in place (S-5, §6.5 S16) — without deleting and re-adding the line,
 * which would lose its counts. The patch only when the value changed; a cleared time is null.
 */
export const schedulePatch = (
  line: Pick<AtmPlanLineDto, 'run' | 'scheduleTime'>,
  change: { run: AtmPlanRun } | { time: string },
): LinePatch | null => {
  if ('run' in change) return change.run === line.run ? null : { run: change.run };
  const scheduleTime = change.time.trim() === '' ? null : change.time.trim();
  return scheduleTime === line.scheduleTime ? null : { scheduleTime };
};

/** The time box: commits on Enter or when it loses focus (a time input changes per segment). */
const TimeInput = ({
  id,
  line,
  disabled,
  onPatch,
}: {
  id: string;
  line: AtmPlanLineDto;
  disabled: boolean;
  onPatch: (patch: LinePatch) => void;
}): JSX.Element => {
  const [text, setText] = useState(line.scheduleTime ?? '');
  useEffect(() => setText(line.scheduleTime ?? ''), [line.scheduleTime]);
  const commit = (): void => {
    const patch = schedulePatch(line, { time: text });
    if (patch !== null) onPatch(patch);
  };
  return (
    <Input
      id={id}
      type="time"
      dir="ltr"
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        commit();
      }}
    />
  );
};

/** A count box that commits on Enter or when it loses focus, and only when the number changed. */
const CountInput = ({
  value,
  label,
  disabled,
  onCommit,
}: {
  value: number;
  label: string;
  disabled: boolean;
  onCommit: (notes: number) => void;
}): JSX.Element => {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = (): void => {
    const next = Number(text);
    if (text.trim() === '' || !Number.isSafeInteger(next) || next < 0) {
      setText(String(value));
      return;
    }
    if (next !== value) onCommit(next);
  };
  return (
    <Input
      aria-label={label}
      rule="integer"
      inputMode="numeric"
      dir="ltr"
      density="tight"
      className="min-w-24 max-w-24 text-end tabular-nums"
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
          return;
        }
        // The step is 100 notes (§9.4): the arrows move the box by a hundred, saved on Enter or
        // when the box loses focus, like a typed number.
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        const current = Number(text);
        const base = text.trim() === '' || !Number.isSafeInteger(current) ? value : current;
        setText(String(stepNotes(base, e.key === 'ArrowUp' ? 1 : -1)));
      }}
    />
  );
};

/** A profile as the select names it: its label, or its total. */
export const standardLoadLabel = (load: AtmStandardLoadDto, locale: Locale): string =>
  load.label ?? formatEgp(load.egpTotalMinor, locale);

export const PlanLinePanel = ({
  line,
  locale,
  canManage,
  standardLoads,
  busy,
  onPatch,
  onRefreshLayout,
  onDelete,
  onReopen,
  onCancel,
  onSpareUse,
}: {
  line: AtmPlanLineDto;
  locale: Locale;
  canManage: boolean;
  standardLoads: readonly AtmStandardLoadDto[];
  busy: boolean;
  onPatch: (patch: LinePatch) => void;
  onRefreshLayout: () => void;
  onDelete: () => void;
  onReopen: () => void;
  onCancel: () => void;
  onSpareUse: () => void;
}): JSX.Element => {
  const t = useT();
  const editable = canManage && line.status === 'draft';
  const planned = line.slots.filter(isPlanned).sort((a, b) => a.slot - b.slot);
  const slotOf = (n: number): AtmPlanSlot | undefined => planned.find((s) => s.slot === n);
  const bags = lineBags(line.slots);
  const time = formatTime12(line.scheduleTime, locale);

  // A denomination held by more than one cassette gets one total that splits evenly (S-4).
  const shared = [...new Set(planned.map((s) => s.denomination ?? 0))].filter(
    (d) => planned.filter((s) => s.denomination === d).length > 1,
  );
  const sumOf = (d: number): number =>
    planned.filter((s) => s.denomination === d).reduce((sum, s) => sum + s.notes, 0);

  const errors = line.issues.filter((i) => i.severity === 'error');
  const warnings = line.issues.filter((i) => i.severity === 'warning');

  return (
    <div className="space-y-4" data-line-panel={line.id}>
      <div className="space-y-1 border-b border-slate-100 pb-3 dark:border-slate-800">
        <div className="flex flex-wrap items-center gap-2">
          <strong dir="ltr" className="text-lg text-slate-900 dark:text-white">
            {lineCode(line)}
          </strong>
          <span className="text-sm text-slate-500 dark:text-slate-400">
            {time === '' ? runLabel(line.run, t) : `${runLabel(line.run, t)} · ${time}`}
          </span>
          <Badge tone={LINE_STATUS_TONE[line.status]} size="sm">
            {t(lineStatusKey(line.status))}
          </Badge>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {[
            line.kind === 'spare'
              ? `${t('atm.paper.spareSet')} ${line.typeLabel ?? ''}`.trim()
              : line.machineName,
            line.hubLabel ?? line.area,
          ]
            .filter((part) => part !== null && part !== '')
            .join(' · ')}
        </p>
        {line.spareUse !== null && (
          <p className="text-xs text-slate-500 dark:text-slate-400" data-spare-use="true">
            {t('atm.plan.spareUse.code')}:{' '}
            <span dir="ltr" className="font-medium">
              {line.spareUse.machineCode}
            </span>{' '}
            · {line.spareUse.machineName} · {formatBusinessDateTime(line.spareUse.at, locale)}
          </p>
        )}
      </div>

      {bags.map((bag) => {
        return (
          <section key={bag.bag} className="space-y-2" data-line-bag={bag.bag}>
            <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {bagSlotsText(bag.bag, bag.slots, t, locale)}
            </h3>
            {bag.slots.map((n) => {
              const slot = slotOf(n);
              if (slot === undefined) return null;
              const d = slot.denomination ?? 0;
              const [background, colour] = DENOMINATION_COLOURS[d] ?? ['#f1f5f9', '#334155'];
              return (
                <div key={n} className="flex items-center gap-2" data-line-slot={n}>
                  <span className="w-16 shrink-0 text-sm text-slate-600 dark:text-slate-300">
                    {t('atm.settlement.slot', { slot: n })}
                  </span>
                  <span
                    dir="ltr"
                    className="inline-flex min-w-12 justify-center rounded-md px-1.5 py-0.5 text-xs font-semibold"
                    style={{ background, color: colour }}
                  >
                    {d}
                  </span>
                  {editable ? (
                    <CountInput
                      value={slot.notes}
                      label={`${t('atm.plan.panel.notes')} — ${t('atm.settlement.slot', { slot: n })}`}
                      disabled={busy}
                      onCommit={(notes) => onPatch({ notes: [{ slot: n, notes }] })}
                    />
                  ) : (
                    <span className="min-w-24 text-end text-sm tabular-nums">
                      {formatNumber(slot.notes, locale)}
                    </span>
                  )}
                  <span className="ms-auto text-sm tabular-nums text-slate-600 dark:text-slate-300">
                    {formatEgp(denominationMinor(d, slot.notes), locale)}
                  </span>
                </div>
              );
            })}
          </section>
        );
      })}

      {editable && shared.length > 0 && (
        <section className="space-y-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
          {shared.map((d) => (
            <div key={d} className="flex items-center gap-2" data-denomination-total={d}>
              <span className="text-sm text-slate-700 dark:text-slate-200">
                {t('atm.plan.panel.denominationTotal', { d })}
              </span>
              <CountInput
                value={sumOf(d)}
                label={t('atm.plan.panel.denominationTotal', { d })}
                disabled={busy}
                onCommit={(notes) =>
                  onPatch({
                    denominationNotes: [{ denomination: d as AtmEgpDenomination, notes }],
                  })
                }
              />
            </div>
          ))}
          <p className="text-xs text-slate-600 dark:text-slate-300">
            {t('atm.plan.panel.splitNote', { list: shared.join('، ') })}
          </p>
        </section>
      )}

      {editable && (
        <div className="flex flex-wrap items-end gap-3" data-line-schedule={line.id}>
          <label className="block space-y-1.5" htmlFor="line-run">
            <span className="block text-sm font-medium text-slate-700 dark:text-slate-200">
              {t('atm.settlement.run')}
            </span>
            <Select
              id="line-run"
              value={String(line.run)}
              disabled={busy}
              onChange={(e) => {
                const patch = schedulePatch(line, { run: Number(e.target.value) as AtmPlanRun });
                if (patch !== null) onPatch(patch);
              }}
            >
              {ATM_PLAN_RUNS.map((n) => (
                <option key={n} value={String(n)}>
                  {runLabel(n, t)}
                </option>
              ))}
            </Select>
          </label>
          <label className="block space-y-1.5" htmlFor="line-time">
            <span className="block text-sm font-medium text-slate-700 dark:text-slate-200">
              {t('atm.plan.add.times')}
            </span>
            <TimeInput id="line-time" line={line} disabled={busy} onPatch={onPatch} />
          </label>
        </div>
      )}

      {editable && (
        <label className="block space-y-1.5" htmlFor="line-standard-load">
          <span className="block text-sm font-medium text-slate-700 dark:text-slate-200">
            {t('atm.plan.panel.standardLoad')}
          </span>
          <Select
            id="line-standard-load"
            value={line.standardLoadId ?? ''}
            disabled={busy}
            onChange={(e) =>
              onPatch({ standardLoadId: e.target.value === '' ? null : e.target.value })
            }
          >
            <option value="">{t('atm.plan.panel.standardDefault')}</option>
            {standardLoads.map((load) => (
              <option key={load.id} value={load.id}>
                {standardLoadLabel(load, locale)}
              </option>
            ))}
          </Select>
        </label>
      )}

      <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
        <span className="text-sm text-slate-600 dark:text-slate-300">
          {t('atm.plan.panel.machineTotal')}
        </span>
        <strong className="tabular-nums text-slate-900 dark:text-white">
          {formatEgp(line.egpTotalMinor, locale)}
        </strong>
      </div>

      {line.issues.length > 0 && (
        <section className="space-y-1" data-line-issue-list="true">
          <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            {t('atm.plan.panel.issues')}
          </h3>
          <ul className="space-y-1 text-sm">
            {errors.map((issue) => (
              <li
                key={`${issue.code}-${String(issue.slot ?? '')}`}
                className="text-red-600 dark:text-red-400"
              >
                {issueText(issue, t)}
              </li>
            ))}
            {warnings.map((issue) => (
              <li
                key={`${issue.code}-${String(issue.slot ?? '')}`}
                className="text-amber-700 dark:text-amber-400"
              >
                {issueText(issue, t)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {canManage && (
        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          {offersLayoutRefresh(line) && (
            <Button variant="secondary" size="sm" disabled={busy} onClick={onRefreshLayout}>
              {t('atm.plan.action.refreshLayout')}
            </Button>
          )}
          {line.status === 'draft' && (
            <Button variant="ghost-danger" size="sm" disabled={busy} onClick={onDelete}>
              {t('atm.plan.action.deleteLine')}
            </Button>
          )}
          {line.status === 'issued' && (
            <Button variant="secondary" size="sm" disabled={busy} onClick={onReopen}>
              {t('atm.plan.action.reopen')}
            </Button>
          )}
          {(line.status === 'issued' || line.status === 'prepared') && (
            <Button variant="ghost-danger" size="sm" disabled={busy} onClick={onCancel}>
              {t('atm.plan.action.cancelLine')}
            </Button>
          )}
          {line.kind === 'spare' && (line.status === 'issued' || line.status === 'prepared') && (
            <Button variant="secondary" size="sm" disabled={busy} onClick={onSpareUse}>
              {t('atm.plan.action.spareUse')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
};
