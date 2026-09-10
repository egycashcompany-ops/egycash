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
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  splitVehicleCodeList,
  type FleetViolationDto,
  type FleetViolationRollupDto,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
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
  'size',
] as const;

const DEFAULT_PAGE_SIZE = 25;

export const ViolationsPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  const year = sp.get('year') ?? '';
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
   * ALWAYS THE FIRST PAGE, because there is no longer any control that can ask for another.
   *
   * `page` used to be read from the URL. With the pager gone that read became a trap rather than a
   * feature: `useRememberedFilters` deliberately lets a URL that already carries a query string
   * win, and nothing left on this screen writes or clears `page` — so a shared or bookmarked
   * `?page=3` would land a reader on a blank board under a ٠٫٠٠ total, with no control anywhere to
   * get them back. How many rows to show is «لكل صفحة» beside the title; how to narrow them is the
   * filter bar.
   */
  const page = 1;
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;

  /** Null or '' deletes the key. There is no page key left to reset — see `page` above. */
  const patch = (updates: Record<string, string | null>): void => {
    const next = new URLSearchParams(sp);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    setSp(next, { replace: true });
  };

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
          year={year}
          vehicleCodes={codes}
          settled={companySettled}
          onSettledChange={(next) => patch({ cset: next })}
          onYearChange={(next) => patch({ year: next })}
          onVehicleCodesChange={(next) =>
            patch({ codes: next.length === 0 ? null : next.join(',') })
          }
          onClear={() => patch({ year: null, codes: null, cset: null })}
          onInspect={setInspecting}
        />
        <DriverViolationsPanel
          vehicleCodes={driverCodes}
          driverEmployeeIds={driverEmployeeIds}
          typeIds={typeIds}
          amount={driverAmount}
          settled={driverSettled}
          onSettledChange={(next) => patch({ dset: next })}
          page={page}
          pageSize={pageSize}
          onVehicleCodesChange={(next) =>
            patch({ dcodes: next.length === 0 ? null : next.join(',') })
          }
          onDriverChange={(next) => patch({ driver: next })}
          onTypeChange={(next) => patch({ dtype: next.length === 0 ? null : next.join(',') })}
          onAmountChange={(next) => patch({ damt: next })}
          onClear={() => patch({ dcodes: null, driver: null, dtype: null, damt: null, dset: null })}
          onPageSizeChange={(next) => patch({ size: String(next) })}
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
      {grieving !== null && (
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
