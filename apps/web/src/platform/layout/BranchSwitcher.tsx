// «الشركة كلها» or the branches you tick — the control that decides what every list in ECMS shows.
//
// SEVERAL AT ONCE, and that is the point of it. «كل الشاشات دي موجودة عند كل الفروع، الداتا بس
// اللي بتتغير» — the screens do not change from one site to the next, the rows do. So somebody who
// looks after three branches is COMPARING them, and a control that admits one at a time makes him
// do the comparing in his head, three page loads apart. Ticking «أكتوبر» and «طنطا» puts both
// sites' rows in the same list.
//
// WHO SEES IT. Anyone the server would actually let narrow: an account holding something company-
// wide, or one whose grants reach more than one branch. Read off the GRANTS, never off the
// placement — an organization-wide account that happens to sit in a branch still sees every branch
// on every screen, so deciding from `branchId` left exactly that account with no way to narrow.
//
// It NARROWS, and only narrows. The server treats the caller's granted scope as the ceiling, so
// nothing here can widen anyone's reach — which is why this is a preference rather than a
// permission. The choice is remembered per browser, beside the theme and the language.
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type OrgUnitOptionDto } from '@ecms/contracts';
import { useAppSelector } from '../../store';
import { useT } from '../localization/useT';
import { get, setActiveBranch } from '../../shared/lib/api-client';
import { useOnClickOutside } from '../../shared/lib/useOnClickOutside';
import { BuildingIcon, ChevronIcon } from '../../shared/ui/icons';

const STORAGE_KEY = 'ecms.activeBranch';

/**
 * The stored choice, read once at module load so the very first request already carries it.
 *
 * Stored comma-separated, which is also the wire format — and a value written by a version that
 * only knew one branch reads back as a list of one, so nobody's remembered choice is lost.
 */
export const readStoredBranch = (): string[] => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null || raw === '') return [];
    return raw.split(',').map((part) => part.trim()).filter((part) => part !== '');
  } catch {
    // Private mode, or storage disabled. Not remembering is not an error.
    return [];
  }
};

const writeStoredBranch = (value: readonly string[]): void => {
  try {
    if (value.length === 0) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, value.join(','));
  } catch {
    /* not remembering is not an error worth showing anyone */
  }
};

export const BranchSwitcher = (): JSX.Element => {
  const t = useT();
  const me = useAppSelector((state) => state.auth.me);
  const locale = useAppSelector((state) => state.locale.locale);
  const [active, setActive] = useState<string[]>(readStoredBranch);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOnClickOutside(ref, () => setOpen(false), open);

  // WHO HAS SOMETHING TO CHOOSE — decided from the GRANTS, which is what the server decides from.
  //
  // `scopeSelector` narrows an `organization` grant to whatever the header names, whatever branch
  // the holder happens to sit in. Reading org-wideness off the PLACEMENT therefore got it wrong in
  // the one direction that matters: an organization-wide account with a home branch sees every
  // branch on every screen and was given no control at all to narrow with. The test here is now
  // the same one the server runs — does this account hold anything at `organization` scope.
  //
  // The other population is unchanged: grants that reach more than one branch, offered exactly
  // those. An account confined to a single branch still gets nothing, because for it the control
  // would do nothing.
  const orgWide = me !== null && Object.values(me.permissions ?? {}).includes('organization');
  const reach = me?.branchIds ?? [];
  const multi = !orgWide && reach.length > 1;

  // `/branches/options` rather than the branches LIST: the list is gated on `branch.view`, an
  // organization-administration grant that an operator narrowing their own view has no reason to
  // hold. The options endpoint exists for exactly this — authenticated, active branches only.
  const branches = useQuery({
    queryKey: ['platform', 'branches', 'options', 'switcher'],
    queryFn: () => get<OrgUnitOptionDto[]>('/platform/branches/options'),
    enabled: orgWide || multi,
    staleTime: 5 * 60 * 1000,
  });

  const apply = (next: readonly string[]): void => {
    setActive([...next]);
    writeStoredBranch(next);
    setActiveBranch(next);
    // A full reload rather than a cache invalidation: the choice changes what EVERY query in the
    // application means, including ones already rendered on this screen, and reloading is the one
    // way to be sure nothing is left showing the previous answer.
    window.location.reload();
  };

  /** Tick or untick one branch. The panel stays OPEN — ticking three is three clicks, not three
   *  trips back to the button. The reload lands after each one, which is the price of the rule
   *  above; the panel reopens on the choice that is now stored. */
  const toggle = (id: string): void =>
    apply(active.includes(id) ? active.filter((x) => x !== id) : [...active, id]);

  /** «الشركة كلها» / «كل فروعي» — the unnarrowed view, which is an empty selection. */
  const clear = (): void => {
    setOpen(false);
    apply([]);
  };

  // A stored branch that no longer exists (retired, or the account moved companies) silently
  // becomes "the whole company" rather than a filter nobody can see or clear. Cleared without a
  // reload — there is nothing narrowed to reload away from.
  //
  // Only ever on a SUCCESSFUL list: a failed request knows nothing about which branches exist, and
  // clearing on it would throw away a working choice every time the network hiccuped.
  useEffect(() => {
    if ((!orgWide && !multi) || branches.data === undefined || active.length === 0) return;
    const live = new Set(
      branches.data.filter((b) => orgWide || reach.includes(b.id)).map((b) => b.id),
    );
    const kept = active.filter((id) => live.has(id));
    if (kept.length === active.length) return;
    // Only the dead ids are dropped — the ones beside them are still a choice the reader made.
    setActive(kept);
    writeStoredBranch(kept);
    setActiveBranch(kept);
  }, [orgWide, branches.data, active]);

  if (!orgWide && !multi) return <></>;

  // A multi-branch account is shown ITS branches and no others — the reach is the ceiling.
  const options = (branches.data ?? []).filter((b) => orgWide || reach.includes(b.id));
  const chosen = options.filter((branch) => active.includes(branch.id));
  const allLabel = orgWide ? t('nav.branchSwitcher.all') : t('nav.branchSwitcher.mine');
  // One branch reads as its own name — that is the common case and naming it is clearer than any
  // count. Several read as a count, because three names do not fit in a command bar and a truncated
  // list of sites is worse than a number: «٣ فروع» is true at any width.
  const label =
    chosen.length === 0
      ? allLabel
      : chosen.length === 1
        ? (chosen[0]?.name[locale] ?? allLabel)
        : t('nav.branchSwitcher.count', { count: chosen.length });

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-700 transition-colors hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200 dark:hover:border-slate-600"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={t('nav.branchSwitcher.label')}
      >
        <BuildingIcon className="h-4 w-4 shrink-0 text-slate-400" />
        <span className="hidden max-w-[10rem] truncate md:inline">{label}</span>
        <ChevronIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
      </button>

      {open && (
        <div
          role="listbox"
          // `start-0`, NOT `end-0`, because this is the FIRST control in the utilities row —
          // and below `md` that row is `w-full justify-between`, so the switcher sits flush
          // against the viewport's inline-start edge. `end-0` pins the panel's far edge and lets
          // the box grow OUTWARD from there, which on a phone puts it off the screen. Anchoring
          // the near edge opens it inward, in both directions: `start` is the right edge in
          // Arabic and the left edge in English, which is the edge the button is already on.
          // The width cap is the backstop for a viewport narrower than the panel itself.
          className="absolute start-0 z-30 mt-2 w-64 max-w-[calc(100vw-1.5rem)] origin-top animate-menu-in rounded-lg border border-slate-200 bg-white py-1 shadow-elevated dark:border-slate-700 dark:bg-slate-800"
        >
          <p className="px-3 pb-1 pt-1.5 text-xs font-medium text-slate-400">
            {t('nav.branchSwitcher.label')}
          </p>
          {/* The unnarrowed view is «nothing ticked», so it is a row that CLEARS rather than a
              branch that competes with the others — ticking it alongside «أكتوبر» would be asking
              for the company and one branch at the same time, which is just the company. */}
          <button
            type="button"
            role="option"
            aria-selected={active.length === 0}
            onClick={clear}
            className={`flex w-full items-center px-3 py-2 text-start text-sm hover:bg-slate-50 dark:hover:bg-slate-700/60 ${
              active.length === 0
                ? 'font-semibold text-brand-700 dark:text-brand-300'
                : 'text-slate-700 dark:text-slate-200'
            }`}
          >
            {allLabel}
          </button>
          <div className="my-1 h-px bg-slate-100 dark:bg-slate-700" />
          {options.map((branch) => {
            const on = active.includes(branch.id);
            return (
              <button
                key={branch.id}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => toggle(branch.id)}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-start text-sm hover:bg-slate-50 dark:hover:bg-slate-700/60 ${
                  on
                    ? 'font-semibold text-brand-700 dark:text-brand-300'
                    : 'text-slate-700 dark:text-slate-200'
                }`}
              >
                {/* Drawn, not an <input>: the row itself is the control, and a real checkbox inside
                    a button is a second focus stop that does the same thing. `aria-selected` on the
                    option is what a screen reader reads. */}
                <span
                  aria-hidden
                  className={`grid h-4 w-4 shrink-0 place-items-center rounded border text-[10px] font-bold ${
                    on
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : 'border-slate-300 dark:border-slate-600'
                  }`}
                >
                  {on ? '✓' : ''}
                </span>
                <span className="min-w-0 truncate">{branch.name[locale]}</span>
              </button>
            );
          })}
          {/*
            Three different states, three different sentences. "No branches yet" is a claim about
            the company, and printing it over a request that FAILED is how a wrong path in this
            file reads as "you have not added any branches" — which is what it did.
          */}
          {branches.isPending && (
            <p className="px-3 py-2 text-sm text-slate-400">{t('common.loading')}</p>
          )}
          {branches.isError && (
            <p className="px-3 py-2 text-sm text-rose-600 dark:text-rose-400">
              {t('nav.branchSwitcher.failed')}
            </p>
          )}
          {!branches.isPending && !branches.isError && options.length === 0 && (
            <p className="px-3 py-2 text-sm text-slate-400">{t('nav.branchSwitcher.none')}</p>
          )}
        </div>
      )}
    </div>
  );
};
