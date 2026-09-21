// Violations + grievances (FW-9, legacy car_villes) — ONE screen, TWO LEDGERS side by side.
//
// «مخالفات تتحملها الشركــة» on the right, «مخالفات يتحملها السائقين» on the left. They were a
// filter over one list before, which read as one book with a column for who pays. They are not:
// they are filed differently (a yearly statement whose amount the server derives, versus a
// per-event fine with a person and a day on it), settled by different people, and reported as two
// separate figures a branch is judged on. Two ledgers, so two halves.
//
// This file is the SHELL: the URL state both halves read, and the dialogs either can open. Every
// figure and every rule lives below — in the panels, in the pure libs they call, and behind them
// in the server, which refuses a type filed on the wrong side however the client asks.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  splitVehicleCodeList,
  type FleetViolationDto,
  type FleetViolationRollupDto,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { readList, writeList } from '../../../shared/lib/list-param';
import { clickSort, readSorts, writeSorts } from '../lib/table-sort';
import { useAppSelector } from '../../../store';
import { PageContainer } from '../../../platform/layout/PageContainer';
import { toast } from '../../../shared/ui/toast/toast-store';
import { errorMessage } from '../../../shared/lib/errors';
import { type Locale } from '@ecms/contracts';
import { useDeleteViolation } from '../api/fleet-queries';
import { CompanyViolationsPanel } from '../components/CompanyViolationsPanel';
import { DriverViolationsPanel } from '../components/DriverViolationsPanel';
import { CompanyViolationsDetailLayer } from '../components/CompanyViolationsDetailLayer';
import {
  DriverViolationDialog,
  GrievanceDialog,
  VehicleViolationDialog,
} from '../components/ViolationDialogs';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';

/**
 * Remembered across visits. `page` is derived, never kept.
 *
 * Each half keeps its OWN car filter — `codes` for the company board, `dcodes` for the drivers'.
 * One shared filter would mean narrowing the left half every time somebody looked up a car on the
 * right, and the two halves are read side by side precisely so they can disagree.
 */
const REMEMBERED_FILTERS = [
  'year',
  'codes',
  'cset',
  'dcodes',
  'driver',
  'dtype',
  'damt',
  'dset',
  'dsort',
] as const;


/**
 * The order the DRIVERS ledger opens in. Named because it is used twice and the two must
 * agree: the board is drawn in it, and a first click replaces it — see `clickSort`.
 */
const DRIVER_DEFAULT_SORT = 'date:desc';

export const ViolationsPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  // SEVERAL years, in the same `year` key — a comma-separated list, which is what the rollup
  // endpoint parses and what a saved one-year link still means.
  const years = readList(sp, 'year');
  /**
   * The DRIVERS ledger's order, in the address bar like every other filter on this screen.
   *
   * `dsort`, not `sort`: the two halves of this page are two boards, and one key would make the
   * company half's arrows reorder the drivers' and the other way round. It opens on `date:desc`,
   * the order the ledger has always arrived in.
   */
  const driverSortParam = sp.get('dsort');
  const driverSorts = useMemo(() => readSorts(driverSortParam, DRIVER_DEFAULT_SORT), [driverSortParam]);
  const codes = splitVehicleCodeList(sp.get('codes') ?? '');
  const driverCodes = splitVehicleCodeList(sp.get('dcodes') ?? '');
  const driverEmployeeIds = splitVehicleCodeList(sp.get('driver') ?? '');
  const driverAmount = sp.get('damt') ?? '';
  // «الحالة» on each half: '' = both, 'true' = settled, 'false' = still outstanding.
  const companySettled = sp.get('cset') ?? '';
  const driverSettled = sp.get('dset') ?? '';
  // A LIST, like `driver` above: «speeding AND seatbelt» is one question, not two.
  const typeIds = splitVehicleCodeList(sp.get('dtype') ?? '');
  /**
   * NO PAGE NUMBER AT ALL on this screen any more.
   *
   * It was read from the URL while the pager existed, then pinned to 1 when the pager went, and is
   * now gone entirely: the drivers' board loads its pages cumulatively (`useViolationsPages`) and
   * owns its own page numbers, and the company board is a rollup that is never paged. That closes
   * the `?page=3` trap for good rather than defending against it — `useRememberedFilters`
   * deliberately lets a URL that already carries a query string win, so a pinned `page` was still
   * a value somebody could contradict. There is nothing left to contradict.
   */

  /** Null or '' deletes the key. There is no page key left to reset — see `page` above. */
  const patch = (updates: Record<string, string | null>): void => {
    const next = new URLSearchParams(sp);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    setSp(next, { replace: true });
  };

  /**
   * THE CAR BOTH ENTRY BARS ARE FILING AGAINST — «لما احدد كود عربيه يتحدد فى التانيه تلقائى».
   *
   * Held here rather than in either panel, because it belongs to neither: a clerk works a car at
   * a time, and that car's statement and its drivers' fines are the same sitting. Picking it twice
   * — once on each side — was two chances to pick two different cars and file half the sitting
   * against the wrong one.
   *
   * NOT in the address bar, where every FILTER on this screen lives. A filter is what somebody
   * shares in a link or comes back to; a half-filled entry bar is neither, and putting the car
   * there would make the back button undo a pick and a shared link arrive with a form part-filled.
   * The two boards keep their own car filters, on purpose — they are read side by side precisely
   * so they can disagree.
   */
  const [entryVehicleId, setEntryVehicleId] = useState('');
  const [inspecting, setInspecting] = useState<FleetViolationRollupDto | null>(null);
  const [editing, setEditing] = useState<FleetViolationDto | null>(null);
  const [deleting, setDeleting] = useState<FleetViolationDto | null>(null);
  const [grieving, setGrieving] = useState<FleetViolationRollupDto | null>(null);
  const remove = useDeleteViolation();

  const confirmDelete = async (): Promise<void> => {
    if (deleting === null) return;
    try {
      await remove.mutateAsync(deleting.id);
      setDeleting(null);
      toast.success(t('fleet.violations.deleted'));
    } catch (error) {
      toast.error(errorMessage(error, locale));
    }
  };

  return (
    <PageContainer fullHeight>
      {/* NO PAGE HEADER, and no pager under the board — both by the owner's instruction:
          «انا عاوز اشيلهم خالص ميبقوش فى البيدج دى بس». This is the only screen in the app
          without one, so it is a deliberate exception rather than a pattern: the two panels name
          themselves, and the ~85px the h1, its rule and its margin took now go to the ledgers,
          which is what the rest of this screen's rules have all been asking for.

          What goes with it, and is worth knowing: the breadcrumb «الحركة › مخالفات السيارات»,
          which was the only in-page link back to /fleet. The sidebar and ⌘K still carry it —
          they read the server's nav, not this page. */}
      {/*
        Company FIRST in the DOM. The app is RTL, so the first child of a row sits on the RIGHT —
        which is where the business reads its own ledger. On a narrow screen the grid collapses to
        one column and the same order becomes top-to-bottom, so the reading order survives.
      */}
      {/* The two ledgers fill whatever the shell left, and the PAGE never scrolls: each panel
          scrolls its own board instead. Comparing the company's total to the drivers' is the whole
          reason these sit side by side, and a page-level scrollbar takes one of them off screen at
          exactly the moment a reader is looking from one to the other. */}
      <div
        data-violations-split="true"
        className="grid min-h-0 min-w-0 flex-1 gap-4 2xl:grid-cols-2"
      >
        <CompanyViolationsPanel
          years={years}
          vehicleCodes={codes}
          settled={companySettled}
          entryVehicleId={entryVehicleId}
          onEntryVehicleChange={setEntryVehicleId}
          onSettledChange={(next) => patch({ cset: next })}
          onYearsChange={(next) => patch({ year: writeList(next) })}
          onVehicleCodesChange={(next) =>
            patch({ codes: next.length === 0 ? null : next.join(',') })
          }
          onClear={() => patch({ year: null, codes: null, cset: null })}
          onInspect={setInspecting}
        />
        <DriverViolationsPanel
          entryVehicleId={entryVehicleId}
          onEntryVehicleChange={setEntryVehicleId}
          sorts={driverSorts}
          onSortChange={(by) => patch({ dsort: writeSorts(clickSort(driverSortParam, DRIVER_DEFAULT_SORT, by)) })}
          vehicleCodes={driverCodes}
          driverEmployeeIds={driverEmployeeIds}
          typeIds={typeIds}
          amount={driverAmount}
          settled={driverSettled}
          onSettledChange={(next) => patch({ dset: next })}
          onVehicleCodesChange={(next) =>
            patch({ dcodes: next.length === 0 ? null : next.join(',') })
          }
          onDriverChange={(next) => patch({ driver: next })}
          onTypeChange={(next) => patch({ dtype: next.length === 0 ? null : next.join(',') })}
          onAmountChange={(next) => patch({ damt: next })}
          onClear={() => patch({ dcodes: null, driver: null, dtype: null, damt: null, dset: null })}
          onEdit={setEditing}
          onDelete={setDeleting}
        />
      </div>

      <CompanyViolationsDetailLayer
        row={inspecting}
        onClose={() => setInspecting(null)}
        onEdit={setEditing}
        onDelete={setDeleting}
        onGrievance={(row) => setGrieving(row)}
      />

      {/* The two edit forms, each opened only for the shape it edits. */}
      <VehicleViolationDialog
        open={editing?.kind === 'vehicle'}
        onClose={() => setEditing(null)}
        violation={editing?.kind === 'vehicle' ? editing : null}
      />
      <DriverViolationDialog
        open={editing?.kind === 'driver'}
        onClose={() => setEditing(null)}
        violation={editing?.kind === 'driver' ? editing : null}
      />
      {grieving !== null && grieving.vehicleId !== null && (
        <GrievanceDialog
          open
          onClose={() => setGrieving(null)}
          vehicleId={grieving.vehicleId}
          code={grieving.code}
          year={grieving.year}
          current={grieving.totalBeforeGrievance}
        />
      )}

      {/* DELETING SHOWS THE FINE, not a sentence about it. The same form the edit path uses,
          read-only, over a delete button: a reader confirming the removal of one of nine fines on
          one car needs to see WHICH one — its year, its kind, its value, its count and what those
          come to. The old dialog asked «are you sure?» about a row it never showed. */}
      <VehicleViolationDialog
        open={deleting?.kind === 'vehicle'}
        onClose={() => setDeleting(null)}
        violation={deleting?.kind === 'vehicle' ? deleting : null}
        mode="delete"
        deleting={remove.isPending}
        onConfirmDelete={() => void confirmDelete()}
      />
      <DriverViolationDialog
        open={deleting?.kind === 'driver'}
        onClose={() => setDeleting(null)}
        violation={deleting?.kind === 'driver' ? deleting : null}
        mode="delete"
        deleting={remove.isPending}
        onConfirmDelete={() => void confirmDelete()}
      />
    </PageContainer>
  );
};
