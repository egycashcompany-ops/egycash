// One side of a shipment — «من فرع» or «إلى فرع» — as the legacy form drew it: a bank chooser
// above the branch box, the branch list narrowed to that bank (main_ops.ejs:418-433, 497-503).
//
// THE BRANCH BOX IS SEARCHED ON THE SERVER, as the operator types. A large bank has hundreds of
// branches and a page holds a hundred; filtering what one page happened to fetch would hide the
// rest, and the operator would add a branch that already exists.
//
// «لو فرع مش موجود»: when nothing found is exactly what was typed, the list's last row offers to add
// it (`onRequestCreate`) — the catalogs screen's own branch form, opened with the bank and the
// typed name already in. Offered only once the search for that text has ANSWERED: before that,
// "not found" only means "not looked for yet", and adding then would duplicate a branch the
// answer was about to show.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  type OperationsBankBranchDto,
  type OperationsBankDto,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { Combobox } from '../../../shared/ui/Combobox';
import { DesignField, Stroke, carBoxClass } from '../../fleet/components/FuelCardDialog';
import { useBankBranch, useBranchSearch } from '../api/operations-queries';
import { SHIPMENT_PATH } from './shipment-icons';

/** How long the box waits after the last keystroke before asking the server. */
const SEARCH_PAUSE_MS = 200;

/** What a side knows about a branch without asking: its name, for the box's label. */
export interface KnownBranch {
  id: string;
  name: string;
}

export const ShipmentBranchSide = ({
  side,
  title,
  banks,
  bankId,
  onBankChange,
  branchId,
  onBranchChange,
  known,
  canCreate,
  onRequestCreate,
  branchMissing,
  children,
}: {
  side: 'origin' | 'destination';
  /** «من فرع» / «إلى فرع». */
  title: string;
  /**
   * EVERY bank, active or not: the active ones are offered, and all of them name a bank already
   * held — a shipment whose branch belongs to a bank deactivated since must not show a raw id.
   */
  banks: readonly OperationsBankDto[];
  bankId: string;
  onBankChange: (bankId: string) => void;
  branchId: string;
  /** The branch picked — whole, so the form can read its area — or null when cleared. */
  onBranchChange: (branch: OperationsBankBranchDto | null) => void;
  /** A name already in hand for the branch held (the board row's) — saves a request on edit. */
  known?: KnownBranch | null;
  /** May this reader add a branch to the catalog (`operationsCatalog.manage`)? */
  canCreate: boolean;
  onRequestCreate: (bankId: string, name: string) => void;
  branchMissing: boolean;
  /** What belongs to this side under its branch — the destination's area. */
  children?: ReactNode;
}): JSX.Element => {
  const t = useT();

  // What is typed, and the same text once the typing has paused — the one the server is asked.
  const [typed, setTyped] = useState('');
  const [asked, setAsked] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setAsked(typed), SEARCH_PAUSE_MS);
    return () => window.clearTimeout(timer);
  }, [typed]);
  // A new bank is a new list: what was typed under the old one asks nothing of the new one.
  useEffect(() => {
    setTyped('');
    setAsked('');
  }, [bankId]);

  const search = useBranchSearch(bankId, asked);
  // Only THIS bank's branches. While the next answer loads, the previous one stays on screen
  // (`placeholderData`) — which, right after the bank changed, is the OLD bank's list.
  const found = useMemo(
    () => (search.data?.items ?? []).filter((branch) => branch.bankId === bankId),
    [search.data, bankId],
  );

  // The held branch's name, when neither the answer nor the caller has it: one read by id.
  const inList = found.some((branch) => branch.id === branchId);
  const held = useBankBranch(branchId !== '' && !inList && known?.id !== branchId ? branchId : '');
  const nameOf = (id: string): string =>
    found.find((branch) => branch.id === id)?.name ??
    (known?.id === id ? known.name : undefined) ??
    (held.data?.id === id ? held.data.name : '…');

  // «Add» only once the answer for exactly this text is in: before that, nothing-found is a guess.
  const answered = asked === typed && !search.isFetching;
  const bankName = banks.find((bank) => bank.id === bankId)?.opsName ?? '';

  return (
    <div
      data-branch-side={side}
      className="space-y-4 rounded-2xl border border-slate-200 bg-white/60 p-4 dark:border-[#2b3b6b] dark:bg-[#0f1838]/40"
    >
      <div className="flex items-center gap-2 text-[15px] font-bold text-slate-900 dark:text-white">
        <Stroke
          d={[...(side === 'origin' ? SHIPMENT_PATH.bank : SHIPMENT_PATH.route)]}
          className="h-4 w-4 text-indigo-500 dark:text-indigo-400"
        />
        {title}
      </div>

      <DesignField label={t('operations.shipment.form.sideBank')}>
        <div className={carBoxClass(false)}>
          <Combobox
            value={bankId}
            options={banks.filter((bank) => bank.isActive).map((bank) => bank.id)}
            optionLabel={(id) => banks.find((bank) => bank.id === id)?.opsName ?? id}
            onChange={onBankChange}
            placeholder={t('operations.shipment.form.pickBank')}
            emptyText={t('common.noResults')}
            clearLabel={t('common.clear')}
            ariaLabel={`${title} — ${t('operations.shipment.form.sideBank')}`}
            testId={`${side}-bank`}
          />
        </div>
      </DesignField>

      <DesignField label={t('operations.shipment.form.branch')} required missing={branchMissing}>
        <div
          className={cn(
            carBoxClass(false),
            branchMissing &&
              '[&_input]:!border-rose-500/70 [&_input]:shadow-[0_0_0_1px_#ef4444,0_0_14px_-2px_rgba(239,68,68,0.3)] [&_input]:!pe-28 [&_.end-2]:!end-10',
          )}
        >
          <Combobox
            value={branchId}
            options={found.map((branch) => branch.id)}
            optionLabel={nameOf}
            onSearch={setTyped}
            onChange={(id) => {
              // Picking the branch already held changes nothing. Not a nicety: the held branch is
              // shown pinned at the top of the list even when it is not on the page the server
              // answered (a bank of hundreds of branches), and resolving it from that page alone
              // would turn "keep this one" into "clear it".
              if (id === branchId) return;
              onBranchChange(id === '' ? null : (found.find((branch) => branch.id === id) ?? null));
            }}
            disabled={bankId === ''}
            placeholder={
              bankId === ''
                ? t('operations.shipment.form.pickBankFirst')
                : t('operations.shipment.form.pickBranch')
            }
            emptyText={t(search.isFetching ? 'common.loading' : 'common.noResults')}
            clearLabel={t('common.clear')}
            ariaLabel={`${title} — ${t('operations.shipment.form.branch')}`}
            testId={`${side}-branch`}
            tallList
            {...(canCreate && answered
              ? {
                  onCreate: (name: string) => onRequestCreate(bankId, name),
                  createLabel: (name: string) =>
                    t('operations.shipment.form.addBranch', { name, bank: bankName }),
                }
              : {})}
          />
        </div>
      </DesignField>
      {children}
    </div>
  );
};
