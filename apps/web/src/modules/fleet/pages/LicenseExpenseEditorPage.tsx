// «مصروفات التراخيص» — the memos, written and seen at once.
//
// «تكون مزيج بين شاشه المخالفات وانا بسجل المخالفات و شاشه الاخطارات وانا بملئ النموذج … وانا بملى
// اشوف ان بملى ايه»: the form sits beside the memo as it will print, the way the notices editor
// does, and the expenses are counted in like the drivers' fines — a counter for each item of the
// department's list, and one card per counted expense to name its amount, how it was paid and
// whether a receipt exists.
//
// «ممكن اعمل مد مده لوحده او تجديد ترخيص لوحده او الاتنين»: a renewal, an extension, or both —
// each in its own block with its own cars and expenses, and each its own memo on paper.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  type CreateFleetLicenseExpense,
  type FleetLicenseExpenseDto,
  type FleetLicenseExpensePartDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { Field, Input, Textarea } from '../../../shared/ui/form';
import { MoneyInput } from '../../../shared/ui/MoneyInput';
import { toast } from '../../../shared/ui/toast/toast-store';
import { cn } from '../../../shared/lib/cn';
import { errorMessage } from '../../../shared/lib/errors';
import { localized } from '../../../shared/lib/format';
import {
  useAllVehicles,
  useCreateCatalogItem,
  useCreateLicenseExpense,
  useFleetCatalog,
  useLicenseExpense,
  useLicenseExpenseSettings,
  useSaveLicenseExpenseSettings,
  useUpdateLicenseExpense,
} from '../api/fleet-queries';
import { VehicleCodeFilter } from '../components/VehicleCodeFilter';
import { LicenseExpenseItemChoiceDialog } from '../components/LicenseExpenseItemChoiceDialog';
import { BoardIcon, PATH } from '../components/FuelCardBoard';
import { violationTypeColour } from '../lib/violation-type-colour';
import {
  DEFAULT_SIGNATURES,
  type LicenseExpenseItemLine,
  type LicenseExpenseKind,
  type LicenseExpenseMemoDoc,
  type LicenseExpensePaidBy,
  type LicenseExpenseSignatures,
  memoHtml,
  memoTitle,
  money,
  printMemos,
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

const KINDS: readonly LicenseExpenseKind[] = ['renewal', 'extension'];

/** One kind's half of the form, as it is being written. */
interface Draft {
  codes: string[];
  plates: Record<string, string>;
  manual: { key: string; plate: string }[];
  items: LicenseExpenseItemLine[];
}
const emptyDraft = (): Draft => ({ codes: [], plates: {}, manual: [], items: [] });

/** A saved half, back into the form: registry cars by code, hand-typed plates as they were. */
const draftOf = (part: FleetLicenseExpensePartDto | null): Draft => {
  if (part === null) return emptyDraft();
  const draft = emptyDraft();
  for (const v of part.vehicles) {
    if (v.code !== null && !draft.codes.includes(v.code)) {
      draft.codes.push(v.code);
      draft.plates[v.code] = v.plate;
    } else {
      draft.manual.push({ key: newKey(), plate: v.plate });
    }
  }
  draft.items = part.items.map((item) => ({ ...item, key: newKey() }));
  return draft;
};

interface CatalogEntry {
  id: string;
  name: string;
  index: number;
}

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

/** One payment group of a memo: its counters, its cards, its total, and its template. */
const PaidGroup = ({
  kind,
  paid,
  items,
  setDraft,
  catalogItems,
  chosen,
  template,
  onAddToCatalog,
  onSaveTemplate,
}: {
  kind: LicenseExpenseKind;
  paid: LicenseExpensePaidBy;
  items: LicenseExpenseItemLine[];
  setDraft: (update: (held: Draft) => Draft) => void;
  catalogItems: readonly CatalogEntry[];
  /** The items this memo offers — `null` is every item. */
  chosen: ReadonlySet<string> | null;
  template: LicenseExpenseItemLine[];
  onAddToCatalog?: (label: string) => Promise<string | null>;
  onSaveTemplate?: (items: LicenseExpenseItemLine[]) => void;
}): JSX.Element => {
  const t = useT();
  const indexOf = new Map(catalogItems.map((item) => [item.id, item.index]));
  const countOf = (itemId: string): number => items.filter((item) => item.itemId === itemId).length;
  // The memo's own items — and any other this group already counts, so a line from an older memo
  // or a template keeps the counter that changes it.
  const counters = catalogItems.filter(
    (item) => chosen === null || chosen.has(item.id) || countOf(item.id) > 0,
  );
  const newLine = (itemId: string | null, label: string): LicenseExpenseItemLine => ({
    key: newKey(),
    itemId,
    label,
    amount: null,
    count: 1,
    paidBy: paid,
    receipt: true,
  });
  /** «٣» typed under «براءة ذمة» is three cards of it; fewer removes the newest. */
  const setCount = (itemId: string, label: string, raw: string): void => {
    const want = Math.max(0, Math.min(50, Number(raw.replace(/\D/gu, '')) || 0));
    setDraft((held) => {
      const mine = held.items.filter((item) => item.paidBy === paid && item.itemId === itemId);
      if (want === mine.length) return held;
      if (want < mine.length) {
        const drop = new Set(mine.slice(want).map((item) => item.key));
        return { ...held, items: held.items.filter((item) => !drop.has(item.key)) };
      }
      const added = Array.from({ length: want - mine.length }, () => newLine(itemId, label));
      return { ...held, items: [...held.items, ...added] };
    });
  };
  const patchItem = (key: string, patch: Partial<LicenseExpenseItemLine>): void =>
    setDraft((held) => ({
      ...held,
      items: held.items.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    }));
  const removeItem = (key: string): void =>
    setDraft((held) => ({ ...held, items: held.items.filter((item) => item.key !== key) }));
  /** The group's lines become the template's — fresh cards, the other group left alone. */
  const applyTemplate = (): void =>
    setDraft((held) => ({
      ...held,
      items: [
        ...held.items.filter((item) => item.paidBy !== paid),
        ...template.map((line) => ({ ...line, key: newKey(), paidBy: paid })),
      ],
    }));

  return (
    <div
      data-license-expense-group={`${kind}:${paid}`}
      className={cn(
        'rounded-lg border p-3',
        paid === 'visa'
          ? 'border-emerald-500/30 bg-emerald-500/[0.04]'
          : 'border-amber-500/30 bg-amber-500/[0.04]',
      )}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3
          className={cn(
            'text-sm font-black',
            paid === 'visa'
              ? 'text-emerald-700 dark:text-emerald-300'
              : 'text-amber-700 dark:text-amber-300',
          )}
        >
          {t(`fleet.licenseExpenses.group.${paid}`)}
        </h3>
        <span className="flex items-center gap-1.5">
          <button
            type="button"
            data-license-expense-apply-template={`${kind}:${paid}`}
            disabled={template.length === 0}
            onClick={applyTemplate}
            title={t('fleet.licenseExpenses.template.applyHint')}
            className="rounded-md border border-brand-500/50 bg-brand-500/10 px-2 py-1 text-[11px] font-bold text-brand-700 hover:bg-brand-500/20 disabled:opacity-40 dark:text-brand-200"
          >
            {t('fleet.licenseExpenses.template.apply')}
          </button>
          {onSaveTemplate !== undefined && (
            <button
              type="button"
              data-license-expense-save-template={`${kind}:${paid}`}
              disabled={items.length === 0}
              onClick={() => onSaveTemplate(items)}
              className="rounded-md border border-slate-300 px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {t('fleet.licenseExpenses.template.save')}
            </button>
          )}
        </span>
      </div>
      {/* «عاوز اختار … زى مخالفات السواقين»: a counter for each item, in its own colour. */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {counters.map((item) => (
          <Field key={item.id} label={item.name}>
            <Input
              data-license-expense-count={`${kind}:${paid}:${item.id}`}
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
        onClick={() => setDraft((held) => ({ ...held, items: [...held.items, newLine(null, '')] }))}
        className="mt-2 text-xs font-bold text-brand-600 hover:underline dark:text-brand-300"
      >
        + {t('fleet.licenseExpenses.addFreeItem')}
      </button>

      {items.length > 0 && (
        <ul className="mt-3 space-y-2">
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
                {item.itemId === null && onAddToCatalog !== undefined && (
                  <button
                    type="button"
                    data-license-expense-add-to-list={item.key}
                    disabled={item.label.trim() === ''}
                    onClick={() =>
                      void onAddToCatalog(item.label.trim()).then((itemId) => {
                        if (itemId !== null) patchItem(item.key, { itemId });
                      })
                    }
                    className="shrink-0 whitespace-nowrap rounded-md border border-brand-500/50 bg-brand-500/10 px-2 py-1 text-[11px] font-bold text-brand-700 hover:bg-brand-500/20 disabled:opacity-40 dark:text-brand-200"
                  >
                    + {t('fleet.licenseExpenses.addToList')}
                  </button>
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
    </div>
  );
};

/** One memo's block: its cars, then its expenses counted in and named card by card. */
const MemoBlock = ({
  kind,
  draft,
  setDraft,
  byCode,
  catalogItems,
  chosen,
  onChooseItems,
  choosing,
  onAddToCatalog,
  templateOf,
  onSaveTemplate,
}: {
  kind: LicenseExpenseKind;
  draft: Draft;
  setDraft: (update: (held: Draft) => Draft) => void;
  byCode: ReadonlyMap<string, { id: string; plateNumber: string }>;
  catalogItems: readonly CatalogEntry[];
  /** «انا اللى احدد يبقى فى كل واحده»: the items this memo offers — `null` is every item. */
  chosen: ReadonlySet<string> | null;
  /** Keep this memo's choice of items; absent without the grant. Resolves once it is saved. */
  onChooseItems?: (ids: string[]) => Promise<boolean>;
  choosing: boolean;
  /** «البيان … قائمة + نص حر»: a hand-written item kept for next time; absent without the grant. */
  onAddToCatalog?: (label: string) => Promise<string | null>;
  /** The saved template's lines for one group, ready to drop in. */
  templateOf: (paid: LicenseExpensePaidBy) => LicenseExpenseItemLine[];
  /** Keep a group's lines as its template; absent without the grant. */
  onSaveTemplate?: (paid: LicenseExpensePaidBy, items: LicenseExpenseItemLine[]) => void;
}): JSX.Element => {
  const t = useT();
  const [choiceOpen, setChoiceOpen] = useState(false);
  const items = draft.items;
  const offered = catalogItems.filter((item) => chosen === null || chosen.has(item.id)).length;
  const visaTotal = sumOf(items.filter((item) => item.paidBy === 'visa'));
  const cashTotal = sumOf(items.filter((item) => item.paidBy === 'cash'));
  const subTitle = (text: string): JSX.Element => (
    <h3 className="mb-2 text-xs font-bold text-slate-500 dark:text-slate-400">{text}</h3>
  );

  return (
    <div
      data-license-expense-block={kind}
      className={cn(
        'space-y-5 rounded-xl border-2 p-3',
        kind === 'renewal'
          ? 'border-sky-500/40 bg-sky-500/[0.04]'
          : 'border-violet-500/40 bg-violet-500/[0.04]',
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'rounded-full px-3 py-1 text-sm font-black',
            kind === 'renewal'
              ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
              : 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
          )}
        >
          {t(`fleet.licenseExpenses.kinds.${kind}`)}
        </span>
        <span className="flex-1" />
        {onChooseItems !== undefined && (
          <button
            type="button"
            data-license-expense-choose-items={kind}
            onClick={() => setChoiceOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-brand-500/50 bg-brand-500/10 px-2.5 py-1 text-xs font-bold text-brand-700 hover:bg-brand-500/20 dark:text-brand-200"
          >
            <span aria-hidden>⚙</span>
            {t('fleet.licenseExpenses.itemChoice.button', {
              n: offered,
              total: catalogItems.length,
            })}
          </button>
        )}
      </div>
      {onChooseItems !== undefined && (
        <LicenseExpenseItemChoiceDialog
          open={choiceOpen}
          onClose={() => setChoiceOpen(false)}
          kind={kind}
          items={catalogItems}
          chosen={chosen}
          saving={choosing}
          onSave={(ids) =>
            void onChooseItems(ids).then((done) => {
              if (done) setChoiceOpen(false);
            })
          }
        />
      )}

      <div>
        {subTitle(t('fleet.licenseExpenses.carsSection'))}
        <VehicleCodeFilter
          fullWidth
          value={draft.codes}
          onChange={(codes) => setDraft((held) => ({ ...held, codes }))}
          placeholder={t('fleet.licenseExpenses.pickCars')}
        />
        {(draft.codes.length > 0 || draft.manual.length > 0) && (
          <ul className="mt-3 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-[#0c121e]">
            {draft.codes.map((code, index) => (
              <li key={code} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="w-6 text-center font-mono text-slate-400">{index + 1}</span>
                <span className="w-16 font-bold text-slate-800 dark:text-slate-100">{code}</span>
                <Input
                  aria-label={t('fleet.licenseExpenses.plate')}
                  value={draft.plates[code] ?? byCode.get(code)?.plateNumber ?? ''}
                  onChange={(e) =>
                    setDraft((held) => ({
                      ...held,
                      plates: { ...held.plates, [code]: e.target.value },
                    }))
                  }
                />
              </li>
            ))}
            {draft.manual.map((row, index) => (
              <li key={row.key} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="w-6 text-center font-mono text-slate-400">
                  {draft.codes.length + index + 1}
                </span>
                <span className="w-16 text-xs text-slate-400">
                  {t('fleet.licenseExpenses.manualPlate')}
                </span>
                <Input
                  aria-label={t('fleet.licenseExpenses.plate')}
                  value={row.plate}
                  onChange={(e) =>
                    setDraft((held) => ({
                      ...held,
                      manual: held.manual.map((r) =>
                        r.key === row.key ? { ...r, plate: e.target.value } : r,
                      ),
                    }))
                  }
                />
                <button
                  type="button"
                  aria-label={t('common.delete')}
                  onClick={() =>
                    setDraft((held) => ({
                      ...held,
                      manual: held.manual.filter((r) => r.key !== row.key),
                    }))
                  }
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
          onClick={() =>
            setDraft((held) => ({
              ...held,
              manual: [...held.manual, { key: newKey(), plate: '' }],
            }))
          }
          className="mt-2 text-xs font-bold text-brand-600 hover:underline dark:text-brand-300"
        >
          + {t('fleet.licenseExpenses.addManualPlate')}
        </button>
      </div>

      {/* «مش كل خانه اقول عليها فيزا ولا نقدى يبقى فيه تجميع»: the card's lines and the cash
          lines are two groups, each with its own counters — the group is how a line was paid. */}
      {(['visa', 'cash'] as const).map((paid) => (
        <PaidGroup
          key={paid}
          kind={kind}
          paid={paid}
          items={items.filter((item) => item.paidBy === paid)}
          setDraft={setDraft}
          catalogItems={catalogItems}
          chosen={chosen}
          template={templateOf(paid)}
          {...(onAddToCatalog === undefined ? {} : { onAddToCatalog })}
          {...(onSaveTemplate === undefined
            ? {}
            : { onSaveTemplate: (lines) => onSaveTemplate(paid, lines) })}
        />
      ))}

      <div>
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
              className="rounded-lg border border-slate-200 bg-white px-2 py-2 dark:border-slate-800 dark:bg-[#0c121e]"
            >
              <span className="block text-slate-500 dark:text-slate-400">{label}</span>
              <span className="font-mono text-sm font-black text-slate-900 dark:text-white">
                {money(value)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export const LicenseExpenseEditorPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const navigate = useNavigate();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { id: routeId = 'new' } = useParams();
  const editingId = routeId === 'new' ? '' : routeId;
  const saved = useLicenseExpense(editingId);
  const settings = useLicenseExpenseSettings();
  const create = useCreateLicenseExpense();
  const update = useUpdateLicenseExpense();
  const saveSettings = useSaveLicenseExpenseSettings();
  const createCatalogItem = useCreateCatalogItem();

  // «ممكن اعمل مد مده لوحده او تجديد ترخيص لوحده او الاتنين» — one, the other, or both.
  const [kinds, setKinds] = useState<LicenseExpenseKind[]>(['renewal']);
  const [date, setDate] = useState(today());
  const [drafts, setDrafts] = useState<Record<LicenseExpenseKind, Draft>>({
    renewal: emptyDraft(),
    extension: emptyDraft(),
  });
  const [signatures, setSignatures] = useState<LicenseExpenseSignatures>(DEFAULT_SIGNATURES);

  // A saved memo fills the form once; a new one starts from the set-up's signatures, until the
  // writer changes them.
  const loaded = useRef<FleetLicenseExpenseDto | null>(null);
  const signaturesTouched = useRef(false);
  useEffect(() => {
    const row = saved.data;
    if (row === undefined || loaded.current?.id === row.id) return;
    loaded.current = row;
    setKinds(KINDS.filter((kind) => row[kind] !== null));
    setDate(row.date);
    setDrafts({ renewal: draftOf(row.renewal), extension: draftOf(row.extension) });
    setSignatures(row.signatures);
  }, [saved.data]);
  useEffect(() => {
    if (editingId !== '' || signaturesTouched.current || settings.data === undefined) return;
    setSignatures(settings.data.signatures);
  }, [editingId, settings.data]);
  // «عاوز اعمل نموذج … 4 حالات»: a new memo's renewal or extension starts from its two saved
  // templates, once — a memo being edited keeps what it was saved with.
  const templateOf = (
    kind: LicenseExpenseKind,
    paid: LicenseExpensePaidBy,
  ): LicenseExpenseItemLine[] =>
    (settings.data?.templates[kind][paid] ?? []).map((line) => ({
      ...line,
      key: newKey(),
      paidBy: paid,
    }));
  const prefilled = useRef(new Set<LicenseExpenseKind>());
  useEffect(() => {
    if (editingId !== '' || settings.data === undefined) return;
    const fresh = kinds.filter((kind) => !prefilled.current.has(kind));
    if (fresh.length === 0) return;
    for (const kind of fresh) prefilled.current.add(kind);
    setDrafts((held) => {
      const next = { ...held };
      for (const kind of fresh) {
        if (held[kind].items.length > 0) continue;
        next[kind] = {
          ...held[kind],
          items: [...templateOf(kind, 'visa'), ...templateOf(kind, 'cash')],
        };
      }
      return next;
    });
    // `templateOf` reads `settings.data`, which is a dependency.
  }, [editingId, settings.data, kinds]);
  const onSaveTemplate = async (
    kind: LicenseExpenseKind,
    paid: LicenseExpensePaidBy,
    items: LicenseExpenseItemLine[],
  ): Promise<void> => {
    if (settings.data === undefined) return;
    const lines = items.map((item) => ({
      itemId: item.itemId,
      label: item.label.trim(),
      amount: item.amount,
      count: item.count,
      receipt: item.receipt,
    }));
    const templates = {
      ...settings.data.templates,
      [kind]: { ...settings.data.templates[kind], [paid]: lines },
    };
    try {
      await saveSettings.mutateAsync({
        signatures: settings.data.signatures,
        templates,
        ...(settings.data.version == null ? {} : { version: settings.data.version }),
      });
      toast.success(t('fleet.licenseExpenses.template.savedToast'));
    } catch (failure) {
      toast.error(errorMessage(failure, locale));
    }
  };
  /** «انا اللى احدد يبقى فى كل واحده»: the items one memo offers — `null` is every item. */
  const chosenByKind = useMemo(() => {
    const side = (ids: string[] | null | undefined): ReadonlySet<string> | null =>
      ids === null || ids === undefined ? null : new Set(ids);
    return {
      renewal: side(settings.data?.items?.renewal),
      extension: side(settings.data?.items?.extension),
    };
  }, [settings.data]);
  const saveChoice = async (kind: LicenseExpenseKind, ids: string[]): Promise<boolean> => {
    if (settings.data === undefined) return false;
    try {
      await saveSettings.mutateAsync({
        signatures: settings.data.signatures,
        items: {
          renewal: settings.data.items?.renewal ?? null,
          extension: settings.data.items?.extension ?? null,
          [kind]: ids,
        },
        ...(settings.data.version == null ? {} : { version: settings.data.version }),
      });
      toast.success(t('fleet.licenseExpenses.itemChoice.savedToast'));
      return true;
    } catch (failure) {
      toast.error(errorMessage(failure, locale));
      return false;
    }
  };
  const editSignatures = (patch: Partial<LicenseExpenseSignatures>): void => {
    signaturesTouched.current = true;
    setSignatures((held) => ({ ...held, ...patch }));
  };

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

  const toggleKind = (kind: LicenseExpenseKind): void =>
    setKinds((held) => {
      if (!held.includes(kind)) return KINDS.filter((k) => k === kind || held.includes(k));
      // At least one memo stays: the last one cannot be switched off.
      return held.length === 1 ? held : held.filter((k) => k !== kind);
    });

  const docs: LicenseExpenseMemoDoc[] = kinds.map((kind) => {
    const draft = drafts[kind];
    return {
      kind,
      date,
      signatures,
      vehicles: [
        ...draft.codes.map((code) => {
          const car = byCode.get(code);
          return {
            vehicleId: car?.id ?? null,
            code,
            plate: draft.plates[code] ?? car?.plateNumber ?? code,
          };
        }),
        ...draft.manual
          .filter((row) => row.plate.trim() !== '')
          .map((row) => ({ vehicleId: null, code: null, plate: row.plate.trim() })),
      ],
      items: draft.items,
    };
  });

  const body = (): CreateFleetLicenseExpense => {
    const partOf = (kind: LicenseExpenseKind) => {
      const doc = docs.find((d) => d.kind === kind);
      return doc === undefined
        ? null
        : {
            vehicles: doc.vehicles.map((v) => ({ vehicleId: v.vehicleId, plate: v.plate })),
            items: doc.items.map((item) => ({
              itemId: item.itemId,
              label: item.label.trim(),
              amount: item.amount,
              count: item.count,
              paidBy: item.paidBy,
              receipt: item.receipt,
            })),
          };
    };
    return {
      // An emptied date box writes today's, as a new memo starts with.
      date: new Date(date === '' ? today() : date),
      renewal: partOf('renewal'),
      extension: partOf('extension'),
      signatures,
    };
  };
  const pending = create.isPending || update.isPending;
  const onSave = async (): Promise<void> => {
    try {
      if (editingId === '') {
        await create.mutateAsync(body());
      } else {
        await update.mutateAsync({
          id: editingId,
          body: { ...body(), version: saved.data?.version ?? 0 },
        });
      }
      toast.success(t('fleet.licenseExpenses.savedToast'));
      navigate('/fleet/license-expenses');
    } catch (failure) {
      toast.error(errorMessage(failure, locale));
    }
  };
  const onSaveDefaults = async (): Promise<void> => {
    try {
      await saveSettings.mutateAsync({
        signatures,
        ...(settings.data?.version == null ? {} : { version: settings.data.version }),
      });
      toast.success(t('fleet.licenseExpenses.defaultsSavedToast'));
    } catch (failure) {
      toast.error(errorMessage(failure, locale));
    }
  };
  const addToCatalog = async (kind: LicenseExpenseKind, label: string): Promise<string | null> => {
    try {
      const item = await createCatalogItem.mutateAsync({
        kind: 'licenseExpenseItem',
        name: { ar: label, en: label },
        countsForAlarm: false,
      });
      toast.success(t('fleet.licenseExpenses.addedToListToast'));
      // Added from this memo, it is one of this memo's items from now on — the other memo's
      // choice is left to its owner.
      const chosen = chosenByKind[kind];
      if (chosen !== null) await saveChoice(kind, [...chosen, item.id]);
      return item.id;
    } catch (failure) {
      toast.error(errorMessage(failure, locale));
      return null;
    }
  };

  const onPrint = (): void => {
    try {
      printMemos(docs);
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
          {editingId === ''
            ? t('fleet.licenseExpenses.newTitle')
            : t('fleet.licenseExpenses.editTitle')}
        </h1>
        <span className="flex-1" />
        <button
          type="button"
          data-license-expense-save="true"
          disabled={pending || (editingId !== '' && saved.data === undefined)}
          onClick={() => void onSave()}
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
                {/* Either, or both — each pressed one is a memo below. */}
                <div className="inline-flex overflow-hidden rounded-lg border border-slate-300 text-xs font-bold dark:border-slate-600">
                  {KINDS.map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      aria-pressed={kinds.includes(kind)}
                      data-license-expense-kind={kind}
                      onClick={() => toggleKind(kind)}
                      className={cn(
                        'px-3 py-1.5 transition',
                        kinds.includes(kind)
                          ? 'bg-brand-600 text-white'
                          : 'bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800',
                      )}
                    >
                      {kinds.includes(kind) ? '✓ ' : ''}
                      {t(`fleet.licenseExpenses.kinds.${kind}`)}
                    </button>
                  ))}
                </div>
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
            <ul className="mt-2 space-y-1">
              {docs.map((doc) => (
                <li
                  key={doc.kind}
                  className="rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600 dark:bg-slate-800/60 dark:text-slate-300"
                >
                  {memoTitle(doc)}
                </li>
              ))}
            </ul>
          </div>

          {kinds.map((kind) => (
            <MemoBlock
              key={kind}
              kind={kind}
              draft={drafts[kind]}
              setDraft={(update) => setDrafts((held) => ({ ...held, [kind]: update(held[kind]) }))}
              byCode={byCode}
              catalogItems={catalogItems}
              chosen={chosenByKind[kind]}
              choosing={saveSettings.isPending}
              {...(can('fleetLicenseExpense.edit')
                ? { onChooseItems: (ids: string[]) => saveChoice(kind, ids) }
                : {})}
              {...(can('fleetCatalog.manage')
                ? { onAddToCatalog: (label: string) => addToCatalog(kind, label) }
                : {})}
              templateOf={(paid) => templateOf(kind, paid)}
              {...(can('fleetLicenseExpense.edit')
                ? {
                    onSaveTemplate: (paid: LicenseExpensePaidBy, items: LicenseExpenseItemLine[]) =>
                      void onSaveTemplate(kind, paid, items),
                  }
                : {})}
            />
          ))}

          <div>
            {sectionTitle(t('fleet.licenseExpenses.signaturesSection'))}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('fleet.licenseExpenses.signatures.agent')}>
                <Input
                  value={signatures.agent}
                  onChange={(e) => editSignatures({ agent: e.target.value })}
                />
              </Field>
              <Field label={t('fleet.licenseExpenses.signatures.director')}>
                <Input
                  value={signatures.director}
                  onChange={(e) => editSignatures({ director: e.target.value })}
                />
              </Field>
              <Field
                label={t('fleet.licenseExpenses.signatures.generalManager')}
                className="sm:col-span-2"
              >
                <Textarea
                  rows={3}
                  value={signatures.generalManager}
                  onChange={(e) => editSignatures({ generalManager: e.target.value })}
                />
              </Field>
            </div>
            {/* «تتظبط مرة في الإعداد وتتعدل في كل مذكرة»: these names become every new memo's. */}
            {can('fleetLicenseExpense.edit') && (
              <button
                type="button"
                data-license-expense-save-defaults="true"
                disabled={saveSettings.isPending}
                onClick={() => void onSaveDefaults()}
                className="mt-3 text-xs font-bold text-brand-600 hover:underline disabled:opacity-50 dark:text-brand-300"
              >
                {t('fleet.licenseExpenses.saveDefaults')}
              </button>
            )}
          </div>
        </section>

        <section className="min-h-0 flex-1 space-y-4 overflow-auto rounded-xl bg-slate-200 p-4 dark:bg-slate-800">
          <p className="mx-auto max-w-[640px] text-sm text-slate-600 dark:text-slate-300">
            {t('fleet.licenseExpenses.preview')}
          </p>
          {/* Each memo as it prints — the same HTML the print window receives, one per page. */}
          {docs.map((doc) => (
            <div
              key={doc.kind}
              className="mx-auto w-[640px] max-w-full overflow-hidden rounded shadow-xl"
            >
              <div
                data-license-expense-preview={doc.kind}
                className="origin-top-right"
                style={{ zoom: 0.8, width: '210mm' }}
                dangerouslySetInnerHTML={{ __html: memoHtml(doc) }}
              />
            </div>
          ))}
        </section>
      </div>
    </div>
  );
};
