// The employee box (ADR-019 rule 5): it searches the server, and the browser never holds the staff
// list to filter it.
//
// Custody references employees, which the design makes a live HR integration (§9.1). The names
// are HR's, read through IT's OWN endpoint (`/it/people`) under IT's own grants — not HR's list
// under `employee.view`, which is the whole HR file and which a technician used to need before they
// could see who they were handing a laptop to. Three registers hand things to people — the assets,
// the mobile lines and the consumables — and since 2026-11-17 each has its own read grant, so ANY
// of the three opens the list (`IT_PEOPLE_GRANTS`, the server's own rule): a lines keeper finds
// whom to hand a line to without being given the assets. Without any of them the box says so
// rather than searching into a 403 the user cannot interpret.
//
// Resolve-by-id is the CALLER's: a filter arriving on a link resolves its chip through
// `useItPerson`, and a custody dialog always opens on a fresh choice.
//
// WHO THE BOX FINDS depends on what the pick is for — «لما يعمل بحث ... كل المواظفين سواء اللى
// مشى او اللى موجود لكن فى حاله الاضافه اللى موجود بس»:
//   • a SEARCH (every filter that picks a person) finds everyone HR has, leavers included — the
//     records still hold them, and a leaver who kept a laptop is exactly who a filter gets asked
//     about;
//   • a HAND-OVER (assign, transfer) finds the people who work here today, and nobody else.
// The hand-over is the default, so a new box that forgets to choose cannot offer a leaver
// custody. The server refuses that hand-over too; this only keeps the box from offering it.
//
// A HAND-OVER'S BOX IN EVERY BRANCH (2026-11-18 — «لما حد فى فرع بيسلم جهاز لحد فى فرع تاني مش
// بيعرف يشوف اسمه ... أسمح إنه يعرف يسلم لحد فى فرع تاني»): `/it/people` reaches only the people the
// reader's read grants reach — a branch keeper's own branch — so a keeper could not name a colleague
// of another branch. With `handOver` the box asks `/it/people/recipients` instead: whoever works
// here today in ANY branch, opened by the act's own grant — any of the three registers' «تسليم»
// (`IT_RECIPIENT_GRANTS`, the owner's «صاحب صلاحية التسليم») — and each row also says the branch, so
// two people of one name are told apart. Only the hand-over dialogs pass it; every filter, the
// employees register and a person's page keep `/it/people` and its scope. Without the prop the box
// is exactly the one it was: the same request, the same key, the same rows.
//
// The decisions — which grants, which request, the rows of an answer, a branch's name — are the
// pure helpers below the component, proven without a browser; the component only wires them.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  type ItPersonDto,
  type ItRecipientDto,
  type Locale,
  type OrgUnitOptionDto,
  type Paginated,
} from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { Badge } from '../../../shared/ui/Badge';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { Spinner } from '../../../shared/ui/Spinner';
import { CloseIcon } from '../../../shared/ui/icons';
import { listKey } from '../../../shared/lib/query-keys';
import { localized } from '../../../shared/lib/format';
import { useItBranchOptions } from '../api/it-queries';
import * as api from '../api/it-api';

/**
 * The read grants of the registers that name a holder — ANY of them opens `/it/people`, as the
 * route's `authorizeAny` says (`apps/api/src/modules/it/people/people.controller.ts`).
 */
export const IT_PEOPLE_GRANTS = ['itAsset.view', 'itMobileLine.view', 'itConsumable.view'] as const;

/**
 * The hand-over grants of the same three registers — ANY of them opens `/it/people/recipients`,
 * the hand-over box's search in every branch, as that route's `authorizeAny` says.
 */
export const IT_RECIPIENT_GRANTS = [
  'itAsset.assign',
  'itMobileLine.assign',
  'itConsumable.assign',
] as const;

export const EmployeePicker = ({
  value,
  valueLabel,
  onChange,
  ariaLabel,
  placeholder,
  includeExited = false,
  handOver = false,
}: {
  /** The picked employee id, '' when none. */
  value: string;
  /** Label for the current pick, kept by the caller so the chip survives a refetch. */
  valueLabel: string;
  onChange: (employeeId: string, label: string) => void;
  ariaLabel?: string;
  /** What the box asks for — a filter says WHICH person it narrows by. */
  placeholder?: string;
  /** `true` for a search: the people who have left are found too, and marked as such. */
  includeExited?: boolean;
  /**
   * `true` in a hand-over dialog: whoever works here today in EVERY branch, under the act's own
   * grant, each row with its branch. Never with `includeExited` — a hand-over names nobody who left.
   */
  handOver?: boolean;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const [search, setSearch] = useState('');
  const allowed = employeePickerGrants(handOver).some((grant) => can(grant));
  const request = employeePickerRequest({ search, includeExited, handOver });

  const results = useQuery({
    // The population is part of the key: a search's wider answer must never be served from the
    // cache to a hand-over box that was typed into with the same letters.
    queryKey: request.queryKey,
    queryFn: request.queryFn,
    enabled: allowed && search.trim() !== '',
    staleTime: 30_000,
  });
  const rows = employeePickerRows(results.data);

  if (!allowed) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        {t(handOver ? 'it.custody.pickerNoAccessHandOver' : 'it.custody.pickerNoAccess')}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {value !== '' && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm dark:border-brand-900 dark:bg-brand-950/40">
          <span className="text-brand-800 dark:text-brand-200">{valueLabel}</span>
          <button
            type="button"
            onClick={() => onChange('', '')}
            aria-label={t('it.custody.clearPick')}
            title={t('it.custody.clearPick')}
            className="rounded-md p-1 text-brand-700 hover:bg-brand-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-brand-300 dark:hover:bg-brand-900/60"
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <SearchInput
        value={search}
        onChange={setSearch}
        aria-label={ariaLabel ?? placeholder ?? t('it.custody.pickerPlaceholder')}
        placeholder={placeholder ?? t('it.custody.pickerPlaceholder')}
      />
      {search.trim() !== '' && (
        <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
          {results.isPending ? (
            <div className="grid place-items-center p-4">
              <Spinner />
            </div>
          ) : rows.length === 0 ? (
            <p className="p-4 text-sm text-slate-500 dark:text-slate-400">
              {t('it.custody.pickerNoResults')}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((employee) => (
                <li key={employee.employeeId}>
                  <EmployeePickerRow
                    employee={employee}
                    handOver={handOver}
                    pressed={employee.employeeId === value}
                    onPick={() => {
                      onChange(employee.employeeId, pickerLabel(employee));
                      setSearch('');
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

/** One person a row lists, whichever search answered — a recipient is employed, so has no status. */
export interface PickerPerson {
  employeeId: string;
  code: string;
  fullNameAr: string;
  branchId: string | null;
  status?: ItPersonDto['status'];
}

/** What the two searches answer: the people's page, or the recipients' list itself. */
export type PickerAnswer = Paginated<ItPersonDto> | ItRecipientDto[];

/** The label a pick carries to the caller's chip — the same for either search. */
export const pickerLabel = (employee: PickerPerson): string =>
  `${employee.fullNameAr} (${employee.code})`;

/** The grants that open the box: a hand-over's are the act's own; any other box's, the reads. */
export const employeePickerGrants = (handOver: boolean): readonly string[] =>
  handOver ? IT_RECIPIENT_GRANTS : IT_PEOPLE_GRANTS;

/**
 * The request the box makes, and the key it is cached under — a hand-over asks the recipients in
 * every branch; every other box asks the people, exactly as it always did.
 */
export const employeePickerRequest = ({
  search,
  includeExited,
  handOver,
}: {
  search: string;
  includeExited: boolean;
  handOver: boolean;
}): { queryKey: readonly unknown[]; queryFn: () => Promise<PickerAnswer> } =>
  handOver
    ? {
        queryKey: listKey('it', 'recipientSearch', { search }),
        queryFn: () => api.searchRecipients(search),
      }
    : {
        queryKey: listKey('it', 'employeeSearch', { search, includeExited }),
        queryFn: () => api.searchPeople(search, { includeExited }),
      };

/** The rows an answer lists, none before it arrives. */
export const employeePickerRows = (data: PickerAnswer | undefined): readonly PickerPerson[] =>
  data === undefined ? [] : Array.isArray(data) ? data : data.items;

/** A branch named from the session's branch list — «—» when it is not there (or not yet). */
export const recipientBranchName = (
  branchId: string | null,
  branches: readonly OrgUnitOptionDto[] | undefined,
  locale: Locale,
): string => {
  const branch = branchId === null ? undefined : branches?.find((b) => b.id === branchId);
  return branch === undefined ? '—' : localized(branch.name, locale);
};

/** Where HR places a recipient — read from the cached branch list, so no request of its own. */
const RecipientBranch = ({ branchId }: { branchId: string | null }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const branches = useItBranchOptions();
  return (
    <span
      data-picker-branch={branchId ?? ''}
      className="text-xs text-slate-500 dark:text-slate-400"
    >
      {t('it.custody.pickerBranch', {
        name: recipientBranchName(branchId, branches.data, locale),
      })}
    </span>
  );
};

/**
 * One person in the list: the name — marked when they have left — and the code. A hand-over's row
 * also says the branch under the name; without `handOver` it is the row every box always had.
 */
export const EmployeePickerRow = ({
  employee,
  handOver = false,
  pressed,
  onPick,
}: {
  employee: PickerPerson;
  handOver?: boolean;
  pressed: boolean;
  onPick: () => void;
}): JSX.Element => {
  const t = useT();
  const name = (
    <span className="flex items-center gap-2">
      <span>{employee.fullNameAr}</span>
      {employee.status === 'exited' && <Badge size="sm">{t('it.custody.pickerExited')}</Badge>}
    </span>
  );
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onPick}
      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:hover:bg-slate-800/60 ${
        pressed
          ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-950/40 dark:text-brand-300'
          : 'text-slate-700 dark:text-slate-200'
      }`}
    >
      {handOver ? (
        <span className="flex min-w-0 flex-col gap-0.5">
          {name}
          <RecipientBranch branchId={employee.branchId} />
        </span>
      ) : (
        name
      )}
      <span className="font-mono text-xs text-slate-500" dir="ltr">
        {employee.code}
      </span>
    </button>
  );
};
