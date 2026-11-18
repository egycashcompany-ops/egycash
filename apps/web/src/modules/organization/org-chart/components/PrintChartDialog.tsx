// «طباعة الهيكل» (P-ORG-3 §2.4): «زرار لطباعة الكل أو اللى أحدده». Every department, or the ones
// ticked — the one open on the page is ticked first — each printed on its own landscape A4 sheet.
import { useMemo, useState } from 'react';
import { type Locale, type OrgChartDepartmentDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Button } from '../../../../shared/ui/Button';
import { Dialog } from '../../../../shared/ui/Dialog';
import { Checkbox } from '../../../../shared/ui/form';
import { SearchInput } from '../../../../shared/ui/SearchInput';
import { localized } from '../../../../shared/lib/format';

export type PrintChoice = 'all' | 'chosen';

/** The departments to print, in the page's order (the tiles' order). */
export const departmentsToPrint = (
  departments: readonly OrgChartDepartmentDto[],
  choice: PrintChoice,
  ticked: ReadonlySet<string>,
): OrgChartDepartmentDto[] =>
  choice === 'all' ? [...departments] : departments.filter((d) => ticked.has(d.key));

export const PrintChartDialog = ({
  departments,
  currentKey,
  locale,
  onClose,
  onPrint,
}: {
  departments: readonly OrgChartDepartmentDto[];
  /** The department open on the page: ticked when the dialog opens. */
  currentKey: string | null;
  locale: Locale;
  onClose: () => void;
  onPrint: (departments: OrgChartDepartmentDto[]) => void;
}): JSX.Element => {
  const t = useT();
  const [choice, setChoice] = useState<PrintChoice>('all');
  const [ticked, setTicked] = useState<Set<string>>(
    () => new Set(currentKey === null ? [] : [currentKey]),
  );
  const [search, setSearch] = useState('');
  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term === ''
      ? departments
      : departments.filter(
          (d) => d.name.ar.toLowerCase().includes(term) || d.name.en.toLowerCase().includes(term),
        );
  }, [departments, search]);
  const toggle = (key: string): void =>
    setTicked((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const chosen = departmentsToPrint(departments, choice, ticked);

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('organization.chart.printTitle')}
      description={t('organization.chart.printHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={chosen.length === 0} onClick={() => onPrint(chosen)}>
            {t('organization.chart.printCount', { n: chosen.length })}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-700 dark:text-slate-200">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="print-choice"
              checked={choice === 'all'}
              onChange={() => setChoice('all')}
            />
            {t('organization.chart.printAll', { n: departments.length })}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="print-choice"
              checked={choice === 'chosen'}
              onChange={() => setChoice('chosen')}
            />
            {t('organization.chart.printChosen')}
          </label>
        </div>

        {choice === 'chosen' && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {departments.length > 7 && (
                <SearchInput
                  value={search}
                  onChange={setSearch}
                  placeholder={t('organization.chart.search')}
                  className="min-w-0 flex-1"
                />
              )}
              <Button
                size="sm"
                variant="ghost-brand"
                onClick={() => setTicked(new Set(departments.map((d) => d.key)))}
              >
                {t('organization.chart.printTickAll')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setTicked(new Set())}>
                {t('organization.chart.printTickNone')}
              </Button>
            </div>
            <div className="grid max-h-72 gap-2 overflow-y-auto sm:grid-cols-2">
              {shown.map((department) => (
                <Checkbox
                  key={department.key}
                  checked={ticked.has(department.key)}
                  onChange={() => toggle(department.key)}
                  label={localized(department.name, locale)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
};
