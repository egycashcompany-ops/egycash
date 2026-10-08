// «عاوز البيان اللى فى تجديد التراخيص و مد المده انا اللى احدد يبقى فى كل واحده»: the owner ticks
// which of the department's items one memo — the renewal or the extension — offers as counters.
// Every item is listed, in the catalog's order and colour; a pressed one is in the memo.
import { useState } from 'react';
import { useT } from '../../../platform/localization/useT';
import { Button } from '../../../shared/ui/Button';
import { Dialog } from '../../../shared/ui/Dialog';
import { cn } from '../../../shared/lib/cn';

interface ChoiceProps {
  onClose: () => void;
  kind: 'renewal' | 'extension';
  /** Every item of the department's list, in its order. */
  items: readonly { id: string; name: string }[];
  /** The memo's saved choice — `null` while nobody has chosen, which is every item. */
  chosen: ReadonlySet<string> | null;
  saving: boolean;
  /** The ticked items' ids, in the list's order. */
  onSave: (ids: string[]) => void;
}

/**
 * Mounted only while open, so each OPENING starts from what is saved — not from a choice abandoned
 * last time — and only the opening does: a refetch while the list is open (somebody else saving a
 * template) does not undo the ticks being made.
 */
export const LicenseExpenseItemChoiceDialog = ({
  open,
  ...props
}: ChoiceProps & { open: boolean }): JSX.Element | null =>
  open ? <ItemChoice {...props} /> : null;

const ItemChoice = ({ onClose, kind, items, chosen, saving, onSave }: ChoiceProps): JSX.Element => {
  const t = useT();
  const [picked, setPicked] = useState<ReadonlySet<string>>(
    () => chosen ?? new Set(items.map((item) => item.id)),
  );
  // The ticked items in the list's order, and any saved one the list no longer shows (archived)
  // kept as it was — a choice is never narrowed by what this screen happened not to load.
  const listed = new Set(items.map((item) => item.id));
  const toSave = (): string[] => [
    ...items.filter((item) => picked.has(item.id)).map((item) => item.id),
    ...[...(chosen ?? [])].filter((id) => !listed.has(id)),
  ];

  const toggle = (id: string): void =>
    setPicked((held) => {
      const next = new Set(held);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      dismissOnOutsideClick={false}
      title={t(`fleet.licenseExpenses.itemChoice.title.${kind}`)}
      description={t('fleet.licenseExpenses.itemChoice.hint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={saving}
            disabled={items.length === 0}
            data-license-expense-item-choice-save={kind}
            onClick={() => onSave(toSave())}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="mb-3 flex items-center justify-between gap-2 text-xs">
        <span className="font-bold text-slate-600 dark:text-slate-300">
          {t('fleet.licenseExpenses.itemChoice.count', {
            n: items.filter((item) => picked.has(item.id)).length,
            total: items.length,
          })}
        </span>
        <span className="flex gap-1.5">
          <button
            type="button"
            data-license-expense-item-choice-all={kind}
            onClick={() => setPicked(new Set(items.map((item) => item.id)))}
            className="rounded-md border border-slate-300 px-2 py-1 font-bold text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {t('fleet.licenseExpenses.itemChoice.all')}
          </button>
          <button
            type="button"
            data-license-expense-item-choice-none={kind}
            onClick={() => setPicked(new Set())}
            className="rounded-md border border-slate-300 px-2 py-1 font-bold text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {t('fleet.licenseExpenses.itemChoice.none')}
          </button>
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {items.map((item) => {
          const on = picked.has(item.id);
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={on}
              data-license-expense-item-choice={`${kind}:${item.id}`}
              onClick={() => toggle(item.id)}
              className={cn(
                'flex items-center gap-2 rounded-lg border px-3 py-2 text-start text-sm font-bold transition',
                on
                  ? 'border-brand-500 bg-brand-600 text-white'
                  : 'border-slate-300 bg-white text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800',
              )}
            >
              <span
                className={cn(
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px]',
                  on ? 'border-white bg-white text-brand-700' : 'border-slate-400',
                )}
              >
                {on ? '✓' : ''}
              </span>
              {item.name}
            </button>
          );
        })}
      </div>
    </Dialog>
  );
};
