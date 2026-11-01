// The plan's lines (§9.4 «Table»): one row per line, in the server's order (serial first, then run,
// time and position). A click selects the line for the side panel; the checkbox picks the issued
// lines «السطور المحددة» prints. A real table (§9.10): the status is written, never colour only.
import { type AtmPlanLineDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { cn } from '../../../../shared/lib/cn';
import { formatNumber } from '../../../../shared/lib/format';
import { Badge } from '../../../../shared/ui/Badge';
import { AlertIcon } from '../../../../shared/ui/icons';
import {
  LINE_STATUS_TONE,
  formatEgp,
  lineBags,
  lineCode,
  lineStatusKey,
} from '../../lib/settlement-view';
import { LineChips } from './LineChips';
import { RunChip } from './RunChip';

/** Only an issued or prepared line has a Note to print (§6.7 `notes`). */
export const printable = (line: Pick<AtmPlanLineDto, 'status'>): boolean =>
  line.status === 'issued' || line.status === 'prepared';

const TH = 'px-3 py-2.5 text-start text-xs font-semibold text-slate-600 dark:text-slate-300';
const TD = 'px-3 py-2.5 align-middle text-sm text-slate-700 dark:text-slate-200';

export const PlanLinesTable = ({
  lines,
  locale,
  selectedId,
  checked,
  onSelect,
  onCheck,
}: {
  lines: readonly AtmPlanLineDto[];
  locale: Locale;
  selectedId: string | null;
  checked: ReadonlySet<string>;
  onSelect: (lineId: string) => void;
  onCheck: (lineId: string, on: boolean) => void;
}): JSX.Element => {
  const t = useT();
  return (
    // The board frame's scroll box (`shared/ui/board-scroll.ts`): on a computer the page hands it
    // the height left and its rows scroll under a head that stays — opaque, as `DataTable
    // stickyHead` paints it, since rows pass beneath. A phone scrolls sideways only, as before.
    <div className="relative overflow-x-auto rounded-xl border border-slate-200 bg-white lg:overflow-auto dark:border-slate-800 dark:bg-slate-900">
      <table className="w-full min-w-[56rem] border-collapse" data-plan-lines="true">
        <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-800">
          <tr>
            <th className={cn(TH, 'w-10')}>
              <span className="sr-only">{t('atm.plan.column.select')}</span>
            </th>
            <th className={TH}>{t('atm.settlement.serial')}</th>
            <th className={TH}>{t('atm.settlement.machineCode')}</th>
            <th className={TH}>{t('atm.settlement.machineName')}</th>
            <th className={TH}>{t('atm.settlement.run')}</th>
            <th className={TH}>{t('atm.plan.column.cassettes')}</th>
            <th className={TH}>{t('atm.plan.column.bags')}</th>
            <th className={cn(TH, 'text-end')}>{t('atm.settlement.total')}</th>
            <th className={TH}>{t('atm.settlement.status')}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const errors = line.issues.filter((i) => i.severity === 'error').length;
            const warnings = line.issues.length - errors;
            const selected = line.id === selectedId;
            return (
              <tr
                key={line.id}
                data-plan-line={line.id}
                onClick={() => onSelect(line.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.target === e.currentTarget) onSelect(line.id);
                }}
                tabIndex={0}
                aria-selected={selected}
                className={cn(
                  'cursor-pointer border-t border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60',
                  selected && 'bg-brand-50/70 dark:bg-brand-950/40',
                  line.status === 'cancelled' && 'text-slate-400',
                )}
              >
                <td className={TD} onClick={(e) => e.stopPropagation()}>
                  {printable(line) && (
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                      checked={checked.has(line.id)}
                      onChange={(e) => onCheck(line.id, e.target.checked)}
                      aria-label={`${t('atm.plan.column.select')} — ${lineCode(line)}`}
                    />
                  )}
                </td>
                <td className={cn(TD, 'tabular-nums')} data-plan-serial={line.id}>
                  {line.serial === null ? '—' : formatNumber(line.serial, locale)}
                </td>
                <td className={TD}>
                  <span dir="ltr" className="font-medium">
                    {lineCode(line)}
                  </span>
                </td>
                <td className={TD}>
                  {line.kind === 'spare'
                    ? `${t('atm.paper.spareSet')} ${line.typeLabel ?? ''}`.trim()
                    : (line.machineName ?? '—')}
                </td>
                <td className={TD}>
                  <RunChip run={line.run} time={line.scheduleTime} locale={locale} />
                </td>
                <td className={TD}>
                  <LineChips slots={line.slots} locale={locale} />
                </td>
                <td className={cn(TD, 'tabular-nums')}>
                  {formatNumber(lineBags(line.slots).length, locale)}
                </td>
                <td className={cn(TD, 'text-end tabular-nums')}>
                  {formatEgp(line.egpTotalMinor, locale)}
                </td>
                <td className={TD}>
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    <Badge tone={LINE_STATUS_TONE[line.status]} size="sm">
                      {t(lineStatusKey(line.status))}
                    </Badge>
                    {line.issues.length > 0 && (
                      <span
                        data-line-issues={line.id}
                        title={t('atm.plan.issuesCount', {
                          errors: formatNumber(errors, locale),
                          warnings: formatNumber(warnings, locale),
                        })}
                        className={cn(
                          'inline-flex items-center gap-1 text-xs',
                          errors > 0
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-amber-600 dark:text-amber-400',
                        )}
                      >
                        <AlertIcon className="h-4 w-4" aria-hidden="true" />
                        <span>
                          {t('atm.plan.issuesCount', {
                            errors: formatNumber(errors, locale),
                            warnings: formatNumber(warnings, locale),
                          })}
                        </span>
                      </span>
                    )}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
