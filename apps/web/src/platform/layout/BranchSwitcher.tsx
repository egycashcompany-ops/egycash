// «الشركة كلها» or one branch — the control that decides what every list in ECMS shows.
//
// It exists for one population: an account that sees the whole company. Everybody else is already
// confined to their own branch by their grants, so the switcher would be a no-op on their screen
// and is not rendered for them.
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

/** The stored choice, read once at module load so the very first request already carries it. */
export const readStoredBranch = (): string | null => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === null || raw === '' ? null : raw;
  } catch {
    // Private mode, or storage disabled. Not remembering is not an error.
    return null;
  }
};

const writeStoredBranch = (value: string | null): void => {
  try {
    if (value === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* not remembering is not an error worth showing anyone */
  }
};

export const BranchSwitcher = (): JSX.Element => {
  const t = useT();
  const me = useAppSelector((state) => state.auth.me);
  const locale = useAppSelector((state) => state.locale.locale);
  const [active, setActive] = useState<string | null>(readStoredBranch);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOnClickOutside(ref, () => setOpen(false), open);

  // An account placed IN a branch already sees only that branch, whatever it sends — so it is
  // never offered a choice that would do nothing.
  const orgWide = me !== null && me.branchId === null;

  // `/branches/options` rather than the branches LIST: the list is gated on `branch.view`, an
  // organization-administration grant that an operator narrowing their own view has no reason to
  // hold. The options endpoint exists for exactly this — authenticated, active branches only.
  const branches = useQuery({
    queryKey: ['platform', 'branches', 'options', 'switcher'],
    queryFn: () => get<OrgUnitOptionDto[]>('/platform/branches/options'),
    enabled: orgWide,
    staleTime: 5 * 60 * 1000,
  });

  const choose = (value: string | null): void => {
    setActive(value);
    writeStoredBranch(value);
    setActiveBranch(value);
    setOpen(false);
    // A full reload rather than a cache invalidation: the choice changes what EVERY query in the
    // application means, including ones already rendered on this screen, and reloading is the one
    // way to be sure nothing is left showing the previous answer.
    window.location.reload();
  };

  // A stored branch that no longer exists (retired, or the account moved companies) silently
  // becomes "the whole company" rather than a filter nobody can see or clear. Cleared without a
  // reload — there is nothing narrowed to reload away from.
  //
  // Only ever on a SUCCESSFUL list: a failed request knows nothing about which branches exist, and
  // clearing on it would throw away a working choice every time the network hiccuped.
  useEffect(() => {
    if (!orgWide || branches.data === undefined || active === null) return;
    if (branches.data.some((branch) => branch.id === active)) return;
    setActive(null);
    writeStoredBranch(null);
    setActiveBranch(null);
  }, [orgWide, branches.data, active]);

  if (!orgWide) return <></>;

  const options = branches.data ?? [];
  const current = options.find((branch) => branch.id === active);
  const label = current === undefined ? t('nav.branchSwitcher.all') : current.name[locale];

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
          <button
            type="button"
            role="option"
            aria-selected={active === null}
            onClick={() => choose(null)}
            className={`flex w-full items-center px-3 py-2 text-start text-sm hover:bg-slate-50 dark:hover:bg-slate-700/60 ${
              active === null
                ? 'font-semibold text-brand-700 dark:text-brand-300'
                : 'text-slate-700 dark:text-slate-200'
            }`}
          >
            {t('nav.branchSwitcher.all')}
          </button>
          <div className="my-1 h-px bg-slate-100 dark:bg-slate-700" />
          {options.map((branch) => (
            <button
              key={branch.id}
              type="button"
              role="option"
              aria-selected={active === branch.id}
              onClick={() => choose(branch.id)}
              className={`flex w-full items-center px-3 py-2 text-start text-sm hover:bg-slate-50 dark:hover:bg-slate-700/60 ${
                active === branch.id
                  ? 'font-semibold text-brand-700 dark:text-brand-300'
                  : 'text-slate-700 dark:text-slate-200'
              }`}
            >
              {branch.name[locale]}
            </button>
          ))}
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
