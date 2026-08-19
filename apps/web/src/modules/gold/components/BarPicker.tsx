// Choosing which bars leave the vault (delivery) or change hands (transfer).
//
// Two ways in, both the gold system's: tick them one by one, or PASTE a column of serials copied
// out of a spreadsheet and let the picker tick the matches. The paste report names what it could
// not find, because a silent partial match on a delivery order is how metal goes missing on paper.
//
// The list is filtered server-side by owner and metal — it only ever offers bars that are actually
// in the vault.
import { useState } from 'react';
import { type GoldBarDto, type GoldMetalType } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Button } from '../../../shared/ui/Button';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { Spinner } from '../../../shared/ui/Spinner';
import { Textarea } from '../../../shared/ui/form';
import { useGoldBars } from '../api/gold-queries';
import { fmtWeightValue } from '../lib/gold-format';

export const BarPicker = ({
  selected,
  companyId,
  metalType,
  onChange,
}: {
  selected: string[];
  companyId?: string | undefined;
  metalType?: GoldMetalType | undefined;
  onChange: (ids: string[], bars: GoldBarDto[]) => void;
}): JSX.Element => {
  const t = useT();
  const [search, setSearch] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [report, setReport] = useState<{ matched: number; unmatched: string[] } | null>(null);

  const { data, isFetching } = useGoldBars({
    status: 'in_vault',
    search: search === '' ? undefined : search,
    companyId,
    metalType,
    pageSize: 100,
  });
  const bars = data?.items ?? [];

  const emit = (ids: string[]): void => {
    onChange(
      ids,
      bars.filter((bar) => ids.includes(bar.id)),
    );
  };

  const toggle = (bar: GoldBarDto): void => {
    emit(
      selected.includes(bar.id) ? selected.filter((id) => id !== bar.id) : [...selected, bar.id],
    );
  };

  const applyPaste = (): void => {
    const wanted = pasteText
      .split(/[\s,;\t\n]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s !== '');
    if (wanted.length === 0) return;
    const bySerial = new Map(bars.map((bar) => [bar.serialNumber.toLowerCase(), bar]));
    const ids = new Set(selected);
    let matched = 0;
    const unmatched: string[] = [];
    for (const serial of wanted) {
      const bar = bySerial.get(serial);
      if (bar === undefined) unmatched.push(serial);
      else {
        ids.add(bar.id);
        matched += 1;
      }
    }
    emit([...ids]);
    setReport({ matched, unmatched });
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t('gold.barPicker.search')}
          className="flex-1"
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            setShowPaste((v) => !v);
          }}
        >
          {t('gold.barPicker.paste')}
        </Button>
      </div>

      {showPaste && (
        <div className="mb-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
            {t('gold.barPicker.pasteHint')}
          </p>
          <Textarea
            value={pasteText}
            onChange={(e) => {
              setPasteText(e.target.value);
            }}
            className="min-h-[80px] font-mono text-xs"
            placeholder={'GB-001\nGB-002'}
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <Button type="button" size="sm" onClick={applyPaste}>
              {t('gold.barPicker.pasteApply')}
            </Button>
            {report !== null && (
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {t('gold.barPicker.pasteReport', { matched: report.matched })}
                {report.unmatched.length > 0 && (
                  <span className="text-red-600 dark:text-red-400">
                    {t('gold.barPicker.pasteMissing', {
                      list:
                        report.unmatched.slice(0, 5).join(', ') +
                        (report.unmatched.length > 5 ? '…' : ''),
                    })}
                  </span>
                )}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="max-h-64 space-y-1.5 overflow-y-auto">
        {isFetching && <Spinner />}
        {!isFetching && bars.length === 0 && (
          <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
            {t('gold.barPicker.none')}
          </p>
        )}
        {bars.map((bar) => {
          const on = selected.includes(bar.id);
          return (
            <button
              key={bar.id}
              type="button"
              onClick={() => {
                toggle(bar);
              }}
              className={`flex w-full items-center justify-between rounded-lg border p-2.5 text-start transition ${
                on
                  ? 'border-brand-400 bg-brand-50 dark:border-brand-600 dark:bg-brand-950/40'
                  : 'border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800'
              }`}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <input type="checkbox" readOnly checked={on} className="accent-brand-600" />
                <span className="min-w-0">
                  <span className="block truncate text-sm text-slate-900 dark:text-slate-100">
                    {bar.serialNumber}
                  </span>
                  <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                    {[
                      bar.companyName,
                      bar.currentVaultId === null
                        ? null
                        : `${bar.currentVaultCode ?? ''} / ${t('gold.common.drawerNumber', {
                            number: bar.currentDrawerNumber ?? '—',
                          })}`,
                      bar.brand,
                      bar.purity,
                    ]
                      .filter((part) => part !== null && part !== '')
                      .join(' · ')}
                  </span>
                </span>
              </span>
              <span className="shrink-0 text-sm text-slate-600 dark:text-slate-300">
                {t('gold.common.grams', { value: fmtWeightValue(bar.weight) })}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
