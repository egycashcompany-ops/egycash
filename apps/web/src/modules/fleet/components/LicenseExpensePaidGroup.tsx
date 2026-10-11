// One payment group of a licensing-expenses memo — its counters, its cards and its template — and
// what it needs around it. Shared by the memo editor and «إعداد النماذج»: a template is written with
// the very controls a memo is, so what is set up is what a new memo starts with, card for card.
// Both pages wear the Fleet forms' design (`DesignDialog`) as pages, from the pieces below.
import { useEffect, useState, type ReactNode } from 'react';
import { type FleetCatalogItemDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Field, Input } from '../../../shared/ui/form';
import { MoneyInput } from '../../../shared/ui/MoneyInput';
import { toast } from '../../../shared/ui/toast/toast-store';
import { cn } from '../../../shared/lib/cn';
import { errorMessage } from '../../../shared/lib/errors';
import { localized } from '../../../shared/lib/format';
import { useCreateCatalogItem, useFleetCatalog } from '../api/fleet-queries';
import { violationTypeColour } from '../lib/violation-type-colour';
import { PATH } from './FuelCardBoard';
import { LOOK, MONO, SANS, Stroke } from './FuelCardDialog';
import {
  type LicenseExpenseItemLine,
  type LicenseExpenseKind,
  type LicenseExpensePaidBy,
} from '../lib/license-expense-memo';

/** Today, `yyyy-mm-dd`, as the browser's clock reads it. */
export const today = (): string => {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

// ONE counter for every line's key, the editor's and the groups' alike: a card added here and a
// line brought in from a template sit in the same list, and two cards with one key would be
// counted, changed and removed as one.
let nextKey = 0;
export const newKey = (): string => {
  nextKey += 1;
  return `x${nextKey}`;
};

export interface CatalogEntry {
  id: string;
  name: string;
  index: number;
  /** The memo that counts it, as set on «قوائم الحركة» — `null` is both. */
  memo: LicenseExpenseKind | null;
}

/** The department's items as the counters read them; the index keeps each one's colour. */
export const catalogEntriesOf = (
  items: readonly FleetCatalogItemDto[],
  locale: Locale,
): CatalogEntry[] =>
  items.map((item, index) => ({
    id: item.id,
    name: localized(item.name, locale),
    index,
    memo: item.licenseExpenseKind ?? null,
  }));

/**
 * The forms' switch (the receipt form's «وقود / كاوتش / غسيل»): a sunken tray, the pressed side in
 * the site's purple — what is pressed, nothing else. Compact, for the memo's narrow cards; the
 * memo editor and «إعداد النماذج» draw their own switches with it too.
 */
export const SWITCH_TRAY =
  'inline-flex gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 shadow-inner dark:border-[#2b3b6b] dark:bg-[#0a1233]';
export const switchOption = (pressed: boolean): string =>
  cn(
    'rounded-lg px-3 py-1.5 text-xs font-bold transition-all active:scale-[0.98] disabled:cursor-not-allowed',
    pressed
      ? 'bg-brand-600 text-white shadow-md shadow-brand-700/30'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-60 disabled:hover:bg-transparent dark:text-slate-300 dark:hover:bg-slate-800/60 dark:hover:text-white',
  );

/**
 * The design's box (`boxTone`) a step in, for the cards' narrow boxes: `boxTone`'s own padding is
 * `!important` and `cn` does not merge, so a smaller one passed beside it would be a coin toss.
 * The control's `tight` density sets the padding instead; this brings the colours and the focus.
 */
export const CARD_BOX = cn(
  '!rounded-xl border font-medium text-slate-900 shadow-inner dark:text-white',
  'border-slate-200 bg-slate-50 dark:border-[#2b3b6b] dark:bg-[#0a1233]',
  LOOK.add.placeholder,
  'transition-all focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus-visible:ring-offset-0',
  'aria-[invalid=true]:!border-rose-500/70 aria-[invalid=true]:shadow-[0_0_0_1px_#ef4444,0_0_14px_-2px_rgba(239,68,68,0.3)]',
);

/** A `Textarea` in the design's box — it takes no `tone`, so the box is laid over its base. */
export const NOTE_BOX = cn(
  '!rounded-xl !px-4 !py-3 !text-[15px] !font-medium shadow-inner transition-all',
  '!border-slate-200 !bg-slate-50 !text-slate-900 dark:!border-[#2b3b6b] dark:!bg-[#0a1233] dark:!text-white',
  'placeholder:!text-slate-500 dark:placeholder:!text-slate-400',
  'focus:!border-indigo-500 focus:!outline-none focus:!ring-1 focus:!ring-indigo-500',
);
/** The design's tile: a list, a figure — sunk into the panel. */
export const DESIGN_TILE =
  'rounded-xl border border-slate-200 bg-slate-50 dark:border-[#2b3b6b] dark:bg-[#0a1233]/80';
/**
 * The page's own header, in the forms' design (`DesignDialog`): the icon tile, the title, the grey
 * line under it, and the buttons — outside the scrolling columns, so Save is never below the edge.
 */
export const DesignPageHeader = ({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: readonly string[];
  title: string;
  subtitle?: string;
  children: ReactNode;
}): JSX.Element => (
  <header
    className={cn(
      SANS,
      'flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 sm:px-6',
      LOOK.add.header,
    )}
  >
    {/* A title wider than what the buttons leave on a phone takes a row of its own. */}
    <div className="flex min-w-0 flex-1 basis-64 items-center gap-3">
      <div
        className={cn('flex shrink-0 items-center justify-center rounded-xl border', LOOK.add.icon)}
      >
        <Stroke d={[...icon]} className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-wide text-slate-900 dark:text-white">{title}</h1>
        {subtitle !== undefined && subtitle !== '' && (
          <p className="text-[13px] font-medium text-slate-600 dark:text-slate-300">{subtitle}</p>
        )}
      </div>
    </div>
    <div className="flex max-w-full flex-wrap items-center gap-2 sm:gap-3">{children}</div>
  </header>
);
/** Back, as the design's Cancel — a link, since the page is one. */
export const DESIGN_BACK =
  'rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[15px] font-bold text-slate-900 transition-all hover:bg-slate-100 active:scale-[0.98] sm:px-7 dark:border-[#2b3b6b] dark:bg-[#1a2550] dark:text-slate-100 dark:hover:bg-slate-700/80';
/** The form column: the design's panel colours, its Cairo and its padding, scrolling on its own. */
export const DESIGN_COLUMN = cn(
  SANS,
  'min-h-0 space-y-7 overflow-auto rounded-2xl border text-slate-900 antialiased lg:w-[46%] dark:text-slate-100',
  'border-slate-200 bg-white dark:border-[#2b3b6b] dark:bg-[#121c3f]/95',
  LOOK.add.body,
);
/** A section's grey hint, as a design field writes one under its box. */
export const DESIGN_HINT = 'text-[13px] font-medium text-slate-600 dark:text-slate-300';

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
  <div className={SWITCH_TRAY}>
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        aria-pressed={value === option.value}
        data-segment={`${testId}:${option.value}`}
        onClick={() => onChange(option.value)}
        className={switchOption(value === option.value)}
      >
        {option.label}
      </button>
    ))}
  </div>
);

/**
 * One payment group of a memo: its counters, its cards, its total, and its template.
 *
 * `setDraft` writes into whatever holds the memo's lines — the editor's draft, or one template of
 * the set-up — and keeps the rest of it as it was.
 */
export const PaidGroup = <H extends { items: LicenseExpenseItemLine[] }>({
  kind,
  paid,
  items,
  setDraft,
  catalogItems,
  template,
  onAddToCatalog,
  onSaveTemplate,
}: {
  kind: LicenseExpenseKind;
  paid: LicenseExpensePaidBy;
  items: LicenseExpenseItemLine[];
  setDraft: (update: (held: H) => H) => void;
  catalogItems: readonly CatalogEntry[];
  /**
   * The saved template's lines, for «تطبيق النموذج». Absent on «إعداد النماذج», where the group's
   * lines ARE the template — neither applying one nor saving one means anything there.
   */
  template?: LicenseExpenseItemLine[];
  onAddToCatalog?: (label: string) => Promise<string | null>;
  onSaveTemplate?: (items: LicenseExpenseItemLine[]) => void;
}): JSX.Element => {
  const t = useT();
  const indexOf = new Map(catalogItems.map((item) => [item.id, item.index]));
  const countOf = (itemId: string): number => items.filter((item) => item.itemId === itemId).length;
  // The memo's own items — and any other this group has counted, so a line from an older memo or
  // a template keeps the counter that changes it. KEPT once seen: a counter brought down to 0 stays
  // where it was, or the item could not be counted back in.
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const counted = items.flatMap((item) =>
      item.itemId === null || kept.has(item.itemId) ? [] : [item.itemId],
    );
    if (counted.length > 0) setKept((held) => new Set([...held, ...counted]));
  }, [items, kept]);
  // «هضيف البنود واحدد تبع تجديد التراخيص ولا مد المده»: this memo's items as «قوائم الحركة» sets
  // them, and those in both.
  const counters = catalogItems.filter(
    (item) => item.memo === null || item.memo === kind || kept.has(item.id) || countOf(item.id) > 0,
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
  const applyTemplate = (lines: LicenseExpenseItemLine[]): void =>
    setDraft((held) => ({
      ...held,
      items: [
        ...held.items.filter((item) => item.paidBy !== paid),
        ...lines.map((line) => ({ ...line, key: newKey(), paidBy: paid })),
      ],
    }));

  return (
    // A way of paying, not a state: the boards keep green, amber and red for states, so the two
    // groups share the design's neutral tile and the card and the cash tell them apart.
    <div
      data-license-expense-group={`${kind}:${paid}`}
      className="rounded-xl border border-slate-200 bg-white p-3 dark:border-[#2b3b6b] dark:bg-[#0f1838]/40"
    >
      {/* The design's section heading (`DesignSection`), with the group's two buttons at its end. */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2 dark:border-[#2b3b6b]/60">
        <h3 className="flex items-center gap-2 text-[15px] font-bold text-slate-900 dark:text-white">
          <Stroke
            d={[...(paid === 'visa' ? PATH.card : PATH.box)]}
            className="h-4 w-4 text-indigo-500 dark:text-indigo-400"
          />
          {t(`fleet.licenseExpenses.group.${paid}`)}
        </h3>
        <span className="flex items-center gap-1.5">
          {template !== undefined && (
            <button
              type="button"
              data-license-expense-apply-template={`${kind}:${paid}`}
              disabled={template.length === 0}
              onClick={() => applyTemplate(template)}
              title={t('fleet.licenseExpenses.template.applyHint')}
              className="rounded-md border border-brand-500/50 bg-brand-500/10 px-2 py-1 text-[11px] font-bold text-brand-700 hover:bg-brand-500/20 disabled:opacity-40 dark:text-brand-200"
            >
              {t('fleet.licenseExpenses.template.apply')}
            </button>
          )}
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
                  ? 'border-slate-200 bg-slate-50 dark:border-[#2b3b6b] dark:bg-[#0a1233]/60'
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
                    density="tight"
                    tone={CARD_BOX}
                  />
                ) : (
                  <span className="text-sm font-bold">{item.label}</span>
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
                  {/* The design's figures: monospace, held at the box's right edge. */}
                  <MoneyInput
                    aria-label={t('fleet.licenseExpenses.columns.amount')}
                    placeholder={t('fleet.licenseExpenses.columns.amount')}
                    value={item.amount === null ? '' : String(item.amount)}
                    onChange={(value) =>
                      patchItem(item.key, { amount: value === '' ? null : Number(value) })
                    }
                    density="tight"
                    tone={cn(CARD_BOX, MONO, 'text-right')}
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
                    density="tight"
                    tone={cn(CARD_BOX, MONO, 'text-center')}
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

/**
 * «البيان … قائمة + نص حر»: a hand-written line kept on «قوائم الحركة» for next time — the id of
 * the item it is now, or `null` when the list refused it (the toast says why).
 */
export const useAddToCatalog = (): ((
  kind: LicenseExpenseKind,
  label: string,
) => Promise<string | null>) => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const catalog = useFleetCatalog('licenseExpenseItem');
  const createCatalogItem = useCreateCatalogItem();
  return async (kind, label) => {
    // ALREADY ON THE LIST — under the other memo, or archived: the line is linked to it instead of
    // being refused as a duplicate and left a loose line. Which memo it belongs to stays as
    // «قوائم الحركة» set it; the line keeps its counter here because it is counted.
    const existing = (catalog.data?.items ?? []).find((item) => item.name.ar.trim() === label);
    if (existing !== undefined) {
      toast.success(t('fleet.licenseExpenses.linkedToListToast'));
      return existing.id;
    }
    try {
      const item = await createCatalogItem.mutateAsync({
        kind: 'licenseExpenseItem',
        name: { ar: label, en: label },
        countsForAlarm: false,
        // Added from this memo, it is this memo's item — «قوائم الحركة» can put it in both.
        licenseExpenseKind: kind,
      });
      toast.success(t('fleet.licenseExpenses.addedToListToast'));
      return item.id;
    } catch (failure) {
      toast.error(errorMessage(failure, locale));
      return null;
    }
  };
};
