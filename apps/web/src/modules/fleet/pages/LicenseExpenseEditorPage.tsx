// «مصروفات التراخيص» — one memo, written and seen at once.
//
// «تكون مزيج بين شاشه المخالفات وانا بسجل المخالفات و شاشه الاخطارات وانا بملئ النموذج … وانا بملى
// اشوف ان بملى ايه»: the form sits beside the memo as it will print, the way the notices editor
// does, and the expenses are counted in like the drivers' fines — a counter for each item of the
// department's list, and one card per counted expense to name its amount, how it was paid and
// whether a receipt exists. Both tables of the department's sheet — the card's and the cash —
// fill from the same cards.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Field, Input, Textarea } from '../../../shared/ui/form';
import { MoneyInput } from '../../../shared/ui/MoneyInput';
import { toast } from '../../../shared/ui/toast/toast-store';
import { cn } from '../../../shared/lib/cn';
import { localized } from '../../../shared/lib/format';
import { useAllVehicles, useFleetCatalog } from '../api/fleet-queries';
import { VehicleCodeFilter } from '../components/VehicleCodeFilter';
import { BoardIcon, PATH } from '../components/FuelCardBoard';
import { violationTypeColour } from '../lib/violation-type-colour';
import {
  DEFAULT_SIGNATURES,
  type LicenseExpenseItemLine,
  type LicenseExpenseKind,
  type LicenseExpensePaidBy,
  type LicenseExpenseSignatures,
  type LicenseExpenseVehicleLine,
  memoHtml,
  memoTitle,
  money,
  printMemo,
  sumOf,
} from '../lib/license-expense-memo';

const today = (): string => {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

let nextKey = 0;
const newKey = (): string => {
  nextKey += 1;
  return `x${nextKey}`;
};

/** A two-way switch in the site's purple: the pressed side is the chosen one. */
const Segmented = <T extends string>({
  value,
  options,
  onChange,
  testId,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (next: T) => void;
  testId: string;
}): JSX.Element => (
  <div className="inline-flex overflow-hidden rounded-lg border border-slate-300 text-xs font-bold dark:border-slate-600">
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        aria-pressed={value === option.value}
        data-segment={`${testId}:${option.value}`}
        onClick={() => onChange(option.value)}
        className={cn(
          'px-3 py-1.5 transition',
          value === option.value
            ? 'bg-brand-600 text-white'
            : 'bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800',
        )}
      >
        {option.label}
      </button>
    ))}
  </div>
);

export const LicenseExpenseEditorPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);

  const [kind, setKind] = useState<LicenseExpenseKind>('renewal');
  const [date, setDate] = useState(today());
  const [codes, setCodes] = useState<string[]>([]);
  const [plates, setPlates] = useState<Record<string, string>>({});
  const [manual, setManual] = useState<{ key: string; plate: string }[]>([]);
  const [items, setItems] = useState<LicenseExpenseItemLine[]>([]);
  const [signatures, setSignatures] = useState<LicenseExpenseSignatures>(DEFAULT_SIGNATURES);

  const registry = useAllVehicles({ anyStatus: true });
  const byCode = useMemo(
    () => new Map((registry.data?.items ?? []).map((v) => [v.code, v])),
    [registry.data],
  );
  const catalog = useFleetCatalog('licenseExpenseItem');
  const catalogItems = useMemo(
    () =>
      (catalog.data?.items ?? []).map((item, index) => ({
        id: item.id,
        name: localized(item.name, locale),
        index,
      })),
    [catalog.data, locale],
  );

  const vehicles: LicenseExpenseVehicleLine[] = [
    ...codes.map((code) => {
      const car = byCode.get(code);
      return {
        vehicleId: car?.id ?? null,
        code,
        plate: plates[code] ?? car?.plateNumber ?? code,
      };
    }),
    ...manual
      .filter((row) => row.plate.trim() !== '')
      .map((row) => ({ vehicleId: null, code: null, plate: row.plate.trim() })),
  ];
  const doc = { kind, date, vehicles, items, signatures };
  // The renewal is paid by the card first; an extension in cash — as the department's sheets are.
  const defaultPaidBy: LicenseExpensePaidBy = kind === 'renewal' ? 'visa' : 'cash';

  const countOf = (itemId: string): number => items.filter((item) => item.itemId === itemId).length;
  /** «٣» typed under «براءة ذمة» is three cards of it; fewer removes the newest. */
  const setCount = (itemId: string, label: string, raw: string): void => {
    const want = Math.max(0, Math.min(50, Number(raw.replace(/\D/gu, '')) || 0));
    setItems((held) => {
      const mine = held.filter((item) => item.itemId === itemId);
      if (want === mine.length) return held;
      if (want < mine.length) {
        const drop = new Set(mine.slice(want).map((item) => item.key));
        return held.filter((item) => !drop.has(item.key));
      }
      const added = Array.from({ length: want - mine.length }, () => ({
        key: newKey(),
        itemId,
        label,
        amount: null,
        count: 1,
        paidBy: defaultPaidBy,
        receipt: true,
      }));
      return [...held, ...added];
    });
  };
  const patchItem = (key: string, patch: Partial<LicenseExpenseItemLine>): void =>
    setItems((held) => held.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  const removeItem = (key: string): void =>
    setItems((held) => held.filter((item) => item.key !== key));
  const addFree = (): void =>
    setItems((held) => [
      ...held,
      {
        key: newKey(),
        itemId: null,
        label: '',
        amount: null,
        count: 1,
        paidBy: defaultPaidBy,
        receipt: true,
      },
    ]);
  const indexOf = new Map(catalogItems.map((item) => [item.id, item.index]));

  const visaTotal = sumOf(items.filter((item) => item.paidBy === 'visa'));
  const cashTotal = sumOf(items.filter((item) => item.paidBy === 'cash'));

  const onPrint = (): void => {
    try {
      printMemo(doc);
    } catch {
      toast.error(t('fleet.vehicles.print.failed'));
    }
  };

  const sectionTitle = (text: string): JSX.Element => (
    <h2 className="mb-3 flex items-center gap-2 border-b border-brand-100 pb-1.5 text-sm font-bold text-brand-700 dark:border-brand-900 dark:text-brand-300">
      <span className="h-3.5 w-1 rounded-full bg-brand-500" />
      {text}
    </h2>
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-license-expense-editor="true">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-[#111827]">
        <Link
          to="/fleet/license-expenses"
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          {t('fleet.licenseExpenses.back')}
        </Link>
        <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">
          {t('fleet.licenseExpenses.newTitle')}
        </h1>
        <span className="flex-1" />
        <button
          type="button"
          data-license-expense-save="true"
          className="inline-flex items-center gap-1.5 rounded-lg border border-brand-500/50 bg-brand-500/15 px-4 py-2 text-sm font-bold text-brand-700 transition hover:bg-brand-500/25 active:scale-95 dark:text-brand-200"
        >
          {t('fleet.licenseExpenses.save')}
        </button>
        <button
          type="button"
          data-license-expense-print="true"
          onClick={onPrint}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-brand-700 to-brand-500 px-4 py-2 text-sm font-black text-white shadow-md shadow-brand-700/30 transition hover:from-brand-600 hover:to-brand-400 active:scale-95"
        >
          <BoardIcon d={PATH.pdf} className="h-4 w-4" />
          {t('fleet.licenseExpenses.print')}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 lg:flex-row">
        <section className="min-h-0 space-y-6 overflow-auto rounded-xl border border-slate-200 bg-white p-4 lg:w-[46%] dark:border-slate-800 dark:bg-[#111827]">
          <div>
            {sectionTitle(t('fleet.licenseExpenses.memoSection'))}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('fleet.licenseExpenses.kind')}>
                <Segmented
                  testId="kind"
                  value={kind}
                  onChange={setKind}
                  options={[
                    { value: 'renewal', label: t('fleet.licenseExpenses.kinds.renewal') },
                    { value: 'extension', label: t('fleet.licenseExpenses.kinds.extension') },
                  ]}
                />
              </Field>
              <Field label={t('fleet.licenseExpenses.date')}>
                <Input
                  type="date"
                  dir="ltr"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </Field>
            </div>
            <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
              {memoTitle(doc)}
            </p>
          </div>

          <div>
            {sectionTitle(t('fleet.licenseExpenses.carsSection'))}
            <VehicleCodeFilter
              fullWidth
              value={codes}
              onChange={setCodes}
              placeholder={t('fleet.licenseExpenses.pickCars')}
            />
            {(codes.length > 0 || manual.length > 0) && (
              <ul className="mt-3 divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                {codes.map((code, index) => (
                  <li key={code} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="w-6 text-center font-mono text-slate-400">{index + 1}</span>
                    <span className="w-16 font-bold text-slate-800 dark:text-slate-100">
                      {code}
                    </span>
                    <Input
                      aria-label={t('fleet.licenseExpenses.plate')}
                      value={plates[code] ?? byCode.get(code)?.plateNumber ?? ''}
                      onChange={(e) => setPlates((held) => ({ ...held, [code]: e.target.value }))}
                    />
                  </li>
                ))}
                {manual.map((row, index) => (
                  <li key={row.key} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="w-6 text-center font-mono text-slate-400">
                      {codes.length + index + 1}
                    </span>
                    <span className="w-16 text-xs text-slate-400">
                      {t('fleet.licenseExpenses.manualPlate')}
                    </span>
                    <Input
                      aria-label={t('fleet.licenseExpenses.plate')}
                      value={row.plate}
                      onChange={(e) =>
                        setManual((held) =>
                          held.map((r) =>
                            r.key === row.key ? { ...r, plate: e.target.value } : r,
                          ),
                        )
                      }
                    />
                    <button
                      type="button"
                      aria-label={t('common.delete')}
                      onClick={() => setManual((held) => held.filter((r) => r.key !== row.key))}
                      className="rounded-md p-1 text-slate-400 hover:text-red-500"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              onClick={() => setManual((held) => [...held, { key: newKey(), plate: '' }])}
              className="mt-2 text-xs font-bold text-brand-600 hover:underline dark:text-brand-300"
            >
              + {t('fleet.licenseExpenses.addManualPlate')}
            </button>
          </div>

          <div>
            {sectionTitle(t('fleet.licenseExpenses.itemsSection'))}
            {/* «عاوز اختار … زى مخالفات السواقين»: a counter for each item, in its own colour. */}
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {catalogItems.map((item) => (
                <Field key={item.id} label={item.name}>
                  <Input
                    data-license-expense-count={item.id}
                    aria-label={item.name}
                    value={String(countOf(item.id))}
                    onChange={(e) => setCount(item.id, item.name, e.target.value)}
                    tone={violationTypeColour(item.id, { index: item.index })}
                    rule="integer"
                  />
                </Field>
              ))}
            </div>
            <button
              type="button"
              onClick={addFree}
              className="mt-2 text-xs font-bold text-brand-600 hover:underline dark:text-brand-300"
            >
              + {t('fleet.licenseExpenses.addFreeItem')}
            </button>

            {items.length > 0 && (
              <ul className="mt-3 space-y-2" data-license-expense-cards="true">
                {items.map((item) => (
                  <li
                    key={item.key}
                    data-license-expense-card={item.key}
                    className={cn(
                      'rounded-lg border p-2',
                      item.itemId === null
                        ? 'border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/40'
                        : violationTypeColour(item.itemId, { index: indexOf.get(item.itemId) }),
                    )}
                  >
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      {item.itemId === null ? (
                        <Input
                          aria-label={t('fleet.licenseExpenses.columns.label')}
                          placeholder={t('fleet.licenseExpenses.columns.label')}
                          value={item.label}
                          onChange={(e) => patchItem(item.key, { label: e.target.value })}
                        />
                      ) : (
                        <span className="text-xs font-bold">{item.label}</span>
                      )}
                      <button
                        type="button"
                        aria-label={t('common.delete')}
                        onClick={() => removeItem(item.key)}
                        className="shrink-0 rounded-md p-1 text-slate-400 hover:text-red-500"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="w-28">
                        <MoneyInput
                          aria-label={t('fleet.licenseExpenses.columns.amount')}
                          placeholder={t('fleet.licenseExpenses.columns.amount')}
                          value={item.amount === null ? '' : String(item.amount)}
                          onChange={(value) =>
                            patchItem(item.key, { amount: value === '' ? null : Number(value) })
                          }
                        />
                      </div>
                      <div className="w-16">
                        <Input
                          aria-label={t('fleet.licenseExpenses.columns.count')}
                          value={String(item.count)}
                          onChange={(e) =>
                            patchItem(item.key, {
                              count: Math.max(1, Number(e.target.value.replace(/\D/gu, '')) || 1),
                            })
                          }
                          rule="integer"
                        />
                      </div>
                      <Segmented
                        testId={`paid-${item.key}`}
                        value={item.paidBy}
                        onChange={(paidBy) => patchItem(item.key, { paidBy })}
                        options={[
                          { value: 'visa', label: t('fleet.licenseExpenses.paidBy.visa') },
                          { value: 'cash', label: t('fleet.licenseExpenses.paidBy.cash') },
                        ]}
                      />
                      <Segmented
                        testId={`receipt-${item.key}`}
                        value={item.receipt ? 'yes' : 'no'}
                        onChange={(next) => patchItem(item.key, { receipt: next === 'yes' })}
                        options={[
                          { value: 'yes', label: t('fleet.licenseExpenses.receipt.yes') },
                          { value: 'no', label: t('fleet.licenseExpenses.receipt.no') },
                        ]}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
              {(
                [
                  [t('fleet.licenseExpenses.totals.visa'), visaTotal],
                  [t('fleet.licenseExpenses.totals.cash'), cashTotal],
                  [t('fleet.licenseExpenses.totals.all'), visaTotal + cashTotal],
                ] as const
              ).map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 dark:border-slate-800 dark:bg-[#0c121e]"
                >
                  <span className="block text-slate-500 dark:text-slate-400">{label}</span>
                  <span className="font-mono text-sm font-black text-slate-900 dark:text-white">
                    {money(value)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div>
            {sectionTitle(t('fleet.licenseExpenses.signaturesSection'))}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('fleet.licenseExpenses.signatures.agent')}>
                <Input
                  value={signatures.agent}
                  onChange={(e) => setSignatures((s) => ({ ...s, agent: e.target.value }))}
                />
              </Field>
              <Field label={t('fleet.licenseExpenses.signatures.director')}>
                <Input
                  value={signatures.director}
                  onChange={(e) => setSignatures((s) => ({ ...s, director: e.target.value }))}
                />
              </Field>
              <Field
                label={t('fleet.licenseExpenses.signatures.generalManager')}
                className="sm:col-span-2"
              >
                <Textarea
                  rows={3}
                  value={signatures.generalManager}
                  onChange={(e) => setSignatures((s) => ({ ...s, generalManager: e.target.value }))}
                />
              </Field>
            </div>
          </div>
        </section>

        <section className="min-h-0 flex-1 overflow-auto rounded-xl bg-slate-200 p-4 dark:bg-slate-800">
          <p className="mx-auto mb-3 max-w-[640px] text-sm text-slate-600 dark:text-slate-300">
            {t('fleet.licenseExpenses.preview')}
          </p>
          {/* The memo as it prints — the same HTML the print window receives. */}
          <div className="mx-auto w-[640px] max-w-full overflow-hidden rounded shadow-xl">
            <div
              data-license-expense-preview="true"
              className="origin-top-right"
              style={{ transform: 'scale(0.8)', width: '210mm', marginBottom: '-20%' }}
              dangerouslySetInnerHTML={{ __html: memoHtml(doc) }}
            />
          </div>
        </section>
      </div>
    </div>
  );
};
