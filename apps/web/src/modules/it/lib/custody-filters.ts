// The custody register's three filters that read ONE fact — whether the asset is back:
//   · the status («المُسلَّم حاليًا» / «المُسترجَع» / الكل), the `open` param, absent = still out;
//   · «تاريخ الاسترجاع» from/to — a return day exists only on a returned interval;
//   · «متأخر عن موعد الإعادة» — only an interval still out can be late.
// Two of them set at odds ask for something no interval can be, and the server answers with an
// empty table while the status box — not highlighted at its default — hides why. So they are kept
// consistent twice: as they are PICKED (each pick moves or drops the others), and as they are READ
// (a link or a remembered view that contradicts itself is read without what cannot be met — the
// status first, then the return days), so the boxes, the request and the files always agree.

/** The `open` param as the screen reads it: absent is the default, the intervals still out. */
export const custodyStatusOf = (sp: URLSearchParams): string => sp.get('open') ?? 'true';

export interface CustodyBackFilters {
  returnedFrom: string;
  returnedTo: string;
  overdue: boolean;
}

/** The return days and «متأخر» as they apply beside the status — what is shown and sent. */
export const readBackFilters = (sp: URLSearchParams): CustodyBackFilters => {
  const status = custodyStatusOf(sp);
  const returnDaysApply = status !== 'true';
  const returnedFrom = returnDaysApply ? (sp.get('returnedFrom') ?? '') : '';
  const returnedTo = returnDaysApply ? (sp.get('returnedTo') ?? '') : '';
  return {
    returnedFrom,
    returnedTo,
    overdue:
      sp.get('overdue') === 'true' &&
      status !== 'false' &&
      returnedFrom === '' &&
      returnedTo === '',
  };
};

type Updates = Record<string, string | null>;

/** A return day picked: the status moves to the returned intervals, and «متأخر» goes. */
export const returnDayUpdates = (
  status: string,
  key: 'returnedFrom' | 'returnedTo',
  day: string,
): Updates => ({
  [key]: day || null,
  ...(day === '' ? {} : { overdue: null, ...(status === 'true' ? { open: 'false' } : {}) }),
});

/** «متأخر» picked: the status moves to the intervals still out, and the return days go. */
export const overdueUpdates = (status: string, on: boolean): Updates => ({
  overdue: on ? 'true' : null,
  ...(on
    ? { returnedFrom: null, returnedTo: null, ...(status === 'false' ? { open: null } : {}) }
    : {}),
});

/** A status picked: what it rules out goes with it. */
export const statusUpdates = (value: string): Updates => ({
  open: value,
  ...(value === 'true' ? { returnedFrom: null, returnedTo: null } : {}),
  ...(value === 'false' ? { overdue: null } : {}),
});
