// «تمام نفذا الـ Dashboard بتاعت الفحص» — the dashboard's rules, proven without a screen: what each
// period covers, what the two requests ask (and that the API's strict schemas take every key of
// them), how the matrix narrows the latest reports by the car — its digits folded — «بها عطل» and the
// device, a bar's click, the words a count takes, and the photos read one by one by their route.
import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  IT_VEHICLE_CHECK_ITEMS,
  ItVehicleCheckDashboardQuerySchema,
  ListItVehicleChecksQuerySchema,
  type ItVehicleCheckAnswer,
  type ItVehicleCheckItem,
  type ItVehicleCheckLatestDto,
} from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';
import { detailKey, featureKey, listKey } from '../../../shared/lib/query-keys';
import {
  answerCounts,
  cairoToday,
  carMatches,
  carPinned,
  carReportsPatch,
  counted,
  dashboardQuery,
  deviceLabel,
  deviceShortLabel,
  failedDevices,
  faultBars,
  forgetsDeletedReport,
  hasVehicleCheckFilters,
  loadVehicleCheckPhotos,
  matrixRows,
  overdueEmptyWords,
  overdueWords,
  patchedSearch,
  periodWindow,
  photoWords,
  readDevice,
  readPeriod,
  reportsPageBeyondEnd,
  reportsQuery,
  reportsWindow,
  rereadAfterDelete,
  sentWhen,
  statusWords,
  toggleDevice,
  type VehicleCheckFilters,
} from './vehicle-check-dashboard';

const t = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

const NONE: VehicleCheckFilters = {
  period: '7',
  branchId: '',
  car: '',
  vehicleId: '',
  faults: false,
  device: null,
};

const TODAY = '2026-11-10';
const B_OCT = '64b7f0c2a1b2c3d4e5f60001';
const V_150 = '64b7f0c2a1b2c3d4e5f60150';

type Items = Record<ItVehicleCheckItem, ItVehicleCheckAnswer | null>;
const items = (over: Partial<Items> = {}): Items => ({
  ...(Object.fromEntries(IT_VEHICLE_CHECK_ITEMS.map((item) => [item, 'works'])) as Items),
  ...over,
});

const latest = (over: Partial<ItVehicleCheckLatestDto>): ItVehicleCheckLatestDto => ({
  reportId: 'r-1',
  vehicleId: 'v-1',
  vehicleCode: '150',
  branchId: B_OCT,
  checkDate: '2026-11-09',
  createdAt: '2026-11-09T06:12:00.000Z',
  items: items(),
  photoCount: 1,
  hasNotes: false,
  reportedByName: 'وليد صفوت جلال',
  ...over,
});

describe('the period', () => {
  it('is «اليوم», «آخر ٧ أيام» or «آخر ٣٠ يومًا» — and «آخر ٧ أيام» for anything else', () => {
    expect(readPeriod('today')).toBe('today');
    expect(readPeriod('30')).toBe('30');
    expect(readPeriod(null)).toBe('7');
    expect(readPeriod('90')).toBe('7');
  });

  it('covers Cairo days ending today, today included', () => {
    expect(periodWindow('today', TODAY)).toEqual({ from: TODAY, to: TODAY });
    expect(periodWindow('7', TODAY)).toEqual({ from: '2026-11-04', to: TODAY });
    expect(periodWindow('30', TODAY)).toEqual({ from: '2026-10-12', to: TODAY });
    // Across a month's end, by the calendar.
    expect(periodWindow('7', '2026-03-02')).toEqual({ from: '2026-02-24', to: '2026-03-02' });
  });

  it('ends on today IN CAIRO — at 00:30 Cairo the UTC clock is still on yesterday', () => {
    // 2026-11-09T22:30Z is 00:30 on the 10th in Cairo (UTC+2).
    expect(cairoToday(new Date('2026-11-09T22:30:00.000Z'))).toBe('2026-11-10');
  });
});

describe('the requests', () => {
  const everything: VehicleCheckFilters = {
    period: '30',
    branchId: B_OCT,
    car: ' ١٥٠ ',
    vehicleId: '',
    faults: true,
    device: 'camera7',
  };

  it('ask the dashboard for the period and the branch only', () => {
    expect(dashboardQuery(everything, TODAY)).toEqual({
      from: '2026-10-12',
      to: TODAY,
      branchId: B_OCT,
    });
    expect(dashboardQuery(NONE, TODAY)).toEqual({ from: '2026-11-04', to: TODAY });
  });

  it('send every filter to the reports list, the car as typed', () => {
    expect(reportsQuery(everything, TODAY, 3)).toEqual({
      page: 3,
      pageSize: 12,
      from: '2026-10-12',
      to: TODAY,
      branchId: B_OCT,
      carCode: '١٥٠',
      faultsOnly: true,
      device: 'camera7',
    });
    expect(reportsQuery(NONE, TODAY)).toEqual({
      page: 1,
      pageSize: 12,
      from: '2026-11-04',
      to: TODAY,
    });
  });

  it('send a car picked from a report by its id, not by its code', () => {
    const picked = reportsQuery({ ...NONE, car: '150', vehicleId: V_150 }, TODAY);
    expect(picked.vehicleId).toBe(V_150);
    expect(picked).not.toHaveProperty('carCode');
  });

  // A car last checked nine days ago, under «آخر ٧ أيام»: its report was open a moment before, and
  // «كل تقارير هذه السيارة» listed nothing.
  it('list EVERY day of a car pinned by its id — the period set aside, the branch kept', () => {
    const pinned: VehicleCheckFilters = { ...NONE, branchId: B_OCT, car: '150', vehicleId: V_150 };
    // The same code typed in the box, not picked from a report: the period applies.
    const typed: VehicleCheckFilters = { ...NONE, car: '150' };
    expect(carPinned(pinned)).toBe(true);
    expect(carPinned(typed)).toBe(false);
    expect(reportsWindow(pinned, TODAY)).toBeNull();
    expect(reportsWindow({ ...pinned, period: 'today' }, TODAY)).toBeNull();
    expect(reportsWindow(typed, TODAY)).toEqual(periodWindow('7', TODAY));
    expect(reportsQuery(pinned, TODAY, 2)).toEqual({
      page: 2,
      pageSize: 12,
      branchId: B_OCT,
      vehicleId: V_150,
    });
    // The figures still read the period: only the list sets it aside.
    expect(dashboardQuery(pinned, TODAY)).toEqual({
      from: '2026-11-04',
      to: TODAY,
      branchId: B_OCT,
    });
  });

  it('«كل تقارير هذه السيارة» pins the car and clears «بها عطل» and the device', () => {
    expect(carReportsPatch({ vehicleId: V_150, vehicleCode: '150' })).toEqual({
      car: '150',
      vehicle: V_150,
      faults: null,
      device: null,
    });
    const url = patchedSearch(
      new URLSearchParams('period=30&branch=b&faults=true&device=dvr&page=3'),
      carReportsPatch({ vehicleId: V_150, vehicleCode: '150' }),
    );
    // The period stays for the figures; the page starts again.
    expect(url?.toString()).toBe(`period=30&branch=b&car=150&vehicle=${V_150}`);
  });

  it('never send a car longer than the schema takes', () => {
    expect(reportsQuery({ ...NONE, car: 'x'.repeat(80) }, TODAY).carCode).toHaveLength(50);
  });

  // The API's schemas are strict: a key only the page knows typechecks here and answers 400 there.
  it('are taken whole by the API’s strict schemas', () => {
    for (const filters of [
      NONE,
      everything,
      { ...NONE, vehicleId: V_150, car: '150' },
      { ...everything, vehicleId: V_150 },
    ]) {
      expect(
        ItVehicleCheckDashboardQuerySchema.safeParse(dashboardQuery(filters, TODAY)).success,
      ).toBe(true);
      expect(ListItVehicleChecksQuerySchema.safeParse(reportsQuery(filters, TODAY)).success).toBe(
        true,
      );
    }
  });
});

describe('the filters', () => {
  it('read a device only among the eleven', () => {
    expect(readDevice('dvr')).toBe('dvr');
    expect(readDevice('camera9')).toBeNull();
    expect(readDevice(null)).toBeNull();
  });

  it('offer «مسح الفلاتر» for any filter but the period', () => {
    expect(hasVehicleCheckFilters(NONE)).toBe(false);
    expect(hasVehicleCheckFilters({ ...NONE, period: 'today' })).toBe(false);
    expect(hasVehicleCheckFilters({ ...NONE, branchId: B_OCT })).toBe(true);
    expect(hasVehicleCheckFilters({ ...NONE, car: '15' })).toBe(true);
    expect(hasVehicleCheckFilters({ ...NONE, car: '  ' })).toBe(false);
    expect(hasVehicleCheckFilters({ ...NONE, vehicleId: V_150 })).toBe(true);
    expect(hasVehicleCheckFilters({ ...NONE, faults: true })).toBe(true);
    expect(hasVehicleCheckFilters({ ...NONE, device: 'radio' })).toBe(true);
  });

  it('a bar pressed sets its device, and pressed again clears it', () => {
    expect(toggleDevice(null, 'dvr')).toBe('dvr');
    expect(toggleDevice('radio', 'dvr')).toBe('dvr');
    expect(toggleDevice('dvr', 'dvr')).toBeNull();
  });

  it('count a car box of direction marks alone as no car', () => {
    expect(hasVehicleCheckFilters({ ...NONE, car: '\u200f' })).toBe(false);
    expect(reportsQuery({ ...NONE, car: '\u200f\u2066' }, TODAY)).not.toHaveProperty('carCode');
    expect(reportsQuery({ ...NONE, car: '\u200f150' }, TODAY).carCode).toBe('150');
  });
});

describe('the URL', () => {
  const sp = (query: string): URLSearchParams => new URLSearchParams(query);

  it('is written only when it would read differently', () => {
    // «   » in the car box, already in the URL: the box writes it again, and nothing moves — no
    // navigation, so no render to re-arm the box's 300 ms timer.
    expect(patchedSearch(sp('car=+++'), { car: '   ', vehicle: null })).toBeNull();
    expect(patchedSearch(sp(''), { car: null, vehicle: null })).toBeNull();
    expect(patchedSearch(sp('period=30'), { device: null })).toBeNull();
    expect(patchedSearch(sp('car=15'), { car: '150', vehicle: null })?.toString()).toBe('car=150');
  });

  it('starts the list again from its first page on any filter, but not on a page of its own', () => {
    expect(patchedSearch(sp('car=15&page=3'), { faults: 'true' })?.toString()).toBe(
      'car=15&faults=true',
    );
    // A filter that does not change still drops a page… which is a change.
    expect(patchedSearch(sp('car=15&page=3'), { car: '15' })?.toString()).toBe('car=15');
    expect(patchedSearch(sp('car=15&page=3'), { page: '4' }, false)?.toString()).toBe(
      'car=15&page=4',
    );
    expect(patchedSearch(sp('car=15&page=3'), { page: null }, false)?.toString()).toBe('car=15');
  });

  it('moves a page past the last to the last, and leaves a page in range alone', () => {
    // `?page=2` once its only card was deleted: one page left, so the URL drops its page.
    expect(reportsPageBeyondEnd(2, { totalItems: 12, totalPages: 1 })).toBe(1);
    // An old link past the end of three pages.
    expect(reportsPageBeyondEnd(9, { totalItems: 30, totalPages: 3 })).toBe(3);
    expect(reportsPageBeyondEnd(3, { totalItems: 30, totalPages: 3 })).toBeNull();
    expect(reportsPageBeyondEnd(1, { totalItems: 5, totalPages: 1 })).toBeNull();
    // Nothing matches: no page to go to — the list says so itself.
    expect(reportsPageBeyondEnd(4, { totalItems: 0, totalPages: 0 })).toBeNull();
  });
});

describe('after a delete', () => {
  const DELETED = 'r-150';

  it('reads every query of the subtree again but the deleted report’s own', () => {
    expect(rereadAfterDelete(detailKey('it', 'vehicleChecks', DELETED), DELETED)).toBe(false);
    expect(rereadAfterDelete(detailKey('it', 'vehicleChecks', 'r-152'), DELETED)).toBe(true);
    expect(rereadAfterDelete(listKey('it', 'vehicleChecks', { page: 1 }), DELETED)).toBe(true);
    expect(
      rereadAfterDelete(listKey('it', 'vehicleChecks', { dashboard: true, from: 'x' }), DELETED),
    ).toBe(true);
  });

  it('is a predicate TanStack applies to the keys the hooks build', async () => {
    const qc = new QueryClient();
    const keys = {
      dashboard: listKey('it', 'vehicleChecks', { dashboard: true, ...periodWindow('7', TODAY) }),
      list: listKey('it', 'vehicleChecks', reportsQuery(NONE, TODAY)),
      deleted: detailKey('it', 'vehicleChecks', DELETED),
      other: detailKey('it', 'vehicleChecks', 'r-152'),
    };
    for (const key of Object.values(keys)) qc.setQueryData(key, {});
    await qc.invalidateQueries({
      queryKey: featureKey('it', 'vehicleChecks'),
      predicate: (query) => rereadAfterDelete(query.queryKey, DELETED),
    });
    const invalidated = (key: readonly unknown[]): boolean | undefined =>
      qc.getQueryState(key)?.isInvalidated;
    expect(invalidated(keys.dashboard)).toBe(true);
    expect(invalidated(keys.list)).toBe(true);
    expect(invalidated(keys.other)).toBe(true);
    expect(invalidated(keys.deleted)).toBe(false);
  });

  it('lets the deleted report’s read go only once its panel has closed or moved on', () => {
    expect(forgetsDeletedReport(DELETED, DELETED)).toBe(false);
    expect(forgetsDeletedReport(DELETED, null)).toBe(true);
    expect(forgetsDeletedReport(DELETED, 'r-152')).toBe(true);
    expect(forgetsDeletedReport(null, null)).toBe(false);
  });
});

describe('the matrix', () => {
  const rows = [
    latest({ vehicleId: 'v-150', vehicleCode: '150', items: items({ camera7: 'notWorking' }) }),
    latest({ vehicleId: 'v-152', vehicleCode: '152' }),
    latest({
      vehicleId: 'v-corolla',
      vehicleCode: 'كورولا 1',
      items: items({ dvr: 'notWorking', radio: 'notWorking' }),
    }),
    latest({ vehicleId: 'v-1003', vehicleCode: '1003', items: items({ camera8: null }) }),
  ];
  const codes = (filters: Partial<VehicleCheckFilters>): string[] =>
    matrixRows(rows, { ...NONE, ...filters }).map((row) => row.vehicleCode);

  it('shows every car’s latest report, in Fleet’s order, with no filter', () => {
    expect(codes({})).toEqual(['150', '152', 'كورولا 1', '1003']);
  });

  it('matches the car anywhere in its code, whichever digits were typed', () => {
    expect(codes({ car: '15' })).toEqual(['150', '152']);
    expect(codes({ car: '١٥' })).toEqual(['150', '152']);
    expect(codes({ car: 'كورولا ١' })).toEqual(['كورولا 1']);
    expect(carMatches('ABC-12', 'abc')).toBe(true);
    expect(carMatches('150', '')).toBe(true);
  });

  // A code pasted out of a chat or a sheet carries invisible direction marks; the server's
  // `registerSearchPattern` drops them, so the matrix must too, or the two disagree on a «150»
  // pasted with a U+200F before it.
  it('drops the direction marks of a pasted code, as the server does', () => {
    for (const mark of ['\u200e', '\u200f', '\u202a', '\u202e', '\u2066', '\u2069', '\ufeff']) {
      expect(carMatches('150', `${mark}150`), JSON.stringify(mark)).toBe(true);
    }
    expect(codes({ car: '\u200f١٥\u200e' })).toEqual(['150', '152']);
    // Marks alone are no car at all.
    expect(codes({ car: '\u200f\u2066' })).toHaveLength(4);
  });

  it('matches a car picked from a report by its id alone — «1» does not bring «150» along', () => {
    expect(codes({ car: '1', vehicleId: 'v-1003' })).toEqual(['1003']);
  });

  it('keeps the cars with a fault, or with THAT device «لا يعمل»', () => {
    expect(codes({ faults: true })).toEqual(['150', 'كورولا 1']);
    expect(codes({ device: 'radio' })).toEqual(['كورولا 1']);
    // An unanswered device is not a fault.
    expect(codes({ device: 'camera8' })).toEqual([]);
    expect(codes({ faults: true, car: '15' })).toEqual(['150']);
  });
});

describe('a report’s answers', () => {
  const report = items({ dvr: 'notWorking', radio: 'notWorking', camera8: null });

  it('count each state, and name the failed devices in the owner’s order', () => {
    expect(answerCounts(report)).toEqual({ works: 8, notWorking: 2, unanswered: 1 });
    expect(failedDevices(report)).toEqual(['dvr', 'radio']);
  });

  it('read as the chip: its faults counted, or every device «يعمل»', () => {
    expect(statusWords(t, 'ar', report)).toEqual({ text: 'عطلان', tone: 'danger' });
    expect(statusWords(t, 'ar', items({ screen: 'notWorking' })).text).toBe('عطل واحد');
    expect(statusWords(t, 'ar', items())).toEqual({ text: 'كل الأجهزة تعمل', tone: 'success' });
    // No fault, but a device left unanswered: not «every device works».
    expect(statusWords(t, 'ar', items({ camera8: null })).text).toBe('لا توجد أعطال');
  });
});

describe('the bars', () => {
  it('measure each device against the one with the most faults', () => {
    const counts = Object.fromEntries(IT_VEHICLE_CHECK_ITEMS.map((item) => [item, 0])) as Record<
      ItVehicleCheckItem,
      number
    >;
    const bars = faultBars({ ...counts, camera7: 3, dvr: 3, screen: 2, radio: 1 });
    expect(bars.map((bar) => bar.item)).toEqual([...IT_VEHICLE_CHECK_ITEMS]);
    const width = (item: ItVehicleCheckItem): number =>
      bars.find((bar) => bar.item === item)?.width ?? -1;
    expect(width('camera7')).toBe(100);
    expect(width('screen')).toBe(67);
    expect(width('radio')).toBe(33);
    expect(width('camera1')).toBe(0);
    // Nothing failing anywhere: no bar, and no division by nought.
    expect(faultBars(counts).every((bar) => bar.width === 0)).toBe(true);
  });
});

describe('the words', () => {
  it('name each device as the sample does, the camera’s number in Arabic digits', () => {
    expect(deviceLabel(t, 'ar', 'screen')).toBe('الشاشة');
    expect(deviceLabel(t, 'ar', 'camera1')).toBe('كاميرا ١ — أمام المركبة');
    expect(deviceLabel(t, 'ar', 'radio')).toBe('جهاز الاتصال (موتورولا)');
  });

  // The form's own label writes «داخل الخزينة 1»; beside «كاميرا ٧» the two digit systems read as a
  // mistake. The approved sample wrote «داخل الخزينة ١».
  it('write the reused label’s digits in Arabic too — one digit system in a label', () => {
    expect(t('it.vehicleCheck.item.camera7')).toBe('داخل الخزينة 1');
    expect(deviceLabel(t, 'ar', 'camera7')).toBe('كاميرا ٧ — داخل الخزينة ١');
    expect(deviceLabel(t, 'ar', 'camera8')).toBe('كاميرا ٨ — داخل الخزينة ٢');
    for (const item of IT_VEHICLE_CHECK_ITEMS) {
      expect(deviceLabel(t, 'ar', item), item).not.toMatch(/[0-9]/u);
    }
    // English keeps its own digits.
    const en = (key: string, params?: Record<string, string | number>): string =>
      translate('en', key, params);
    expect(deviceLabel(en, 'en', 'camera7')).toBe('Camera 7 — Inside safe 1');
  });

  it('name each matrix column head short', () => {
    expect(IT_VEHICLE_CHECK_ITEMS.map((item) => deviceShortLabel(t, 'ar', item))).toEqual([
      'الشاشة',
      'ك١',
      'ك٢',
      'ك٣',
      'ك٤',
      'ك٥',
      'ك٦',
      'ك٧',
      'ك٨',
      'DVR',
      'الاتصال',
    ]);
  });

  it('count in Arabic’s five forms', () => {
    expect([1, 2, 3, 11, 100].map((n) => counted(t, 'ar', 'faults', n))).toEqual([
      'عطل واحد',
      'عطلان',
      '٣ أعطال',
      '١١ عطلًا',
      '١٠٠ عطل',
    ]);
    expect(counted(t, 'ar', 'days', 7)).toBe('٧ أيام');
    expect(counted(t, 'ar', 'reporters', 12)).toBe('أرسلها ١٢ مستخدمًا');
    expect(counted(t, 'ar', 'activeCars', 71)).toBe('من ٧١ سيارة نشطة');
    expect(photoWords(t, 'ar', 0)).toBe('بلا صور');
    expect(photoWords(t, 'ar', 3)).toBe('٣ صور');
  });

  it('say how long an overdue car has waited, or that it was never checked', () => {
    expect(overdueWords(t, 'ar', { lastCheckDate: '2026-10-30', daysSince: 11 })).toBe(
      'آخر فحص منذ ١١ يومًا',
    );
    expect(overdueWords(t, 'ar', { lastCheckDate: '2026-11-02', daysSince: 8 })).toBe(
      'آخر فحص منذ ٨ أيام',
    );
    expect(overdueWords(t, 'ar', { lastCheckDate: null, daysSince: null })).toBe('لم تُفحص بعد');
  });

  it('say every active car was checked only when there is one — not «all of none»', () => {
    expect(overdueEmptyWords(t, 'ar', { overdueDays: 7, totals: { activeCars: 12 } })).toBe(
      'فُحصت كل السيارات النشطة خلال آخر ٧ أيام.',
    );
    expect(overdueEmptyWords(t, 'ar', { overdueDays: 7, totals: { activeCars: 0 } })).toBe(
      t('it.vehicleChecks.tiles.noActiveCars'),
    );
  });

  it('give the time a report was sent, and its day too when that is not the day it is for', () => {
    const en = (key: string, params?: Record<string, string | number>): string =>
      translate('en', key, params);
    // 06:12Z is 08:12 in Cairo, on the day the report is for.
    const sameDay = sentWhen(en, 'en', {
      checkDate: '2026-11-09',
      createdAt: '2026-11-09T06:12:00.000Z',
    });
    expect(sameDay).toBe('08:12');
    const later = sentWhen(en, 'en', {
      checkDate: '2026-11-07',
      createdAt: '2026-11-09T06:12:00.000Z',
    });
    expect(later.startsWith('sent on ')).toBe(true);
    expect(later).toContain('08:12');
    expect(
      sentWhen(t, 'ar', { checkDate: '2026-11-07', createdAt: '2026-11-09T06:12:00.000Z' }),
    ).toMatch(/^أُرسل في /u);
  });

  it('say what a delete does to the car’s latest report in plain formal words', () => {
    expect(t('it.vehicleChecks.report.deleteBody')).toBe(
      'سيُحذف التقرير من اللوحة ومن قائمة التقارير، ولن يُعدّ بعد ذلك آخرَ تقرير للسيارة. لا يمكن التراجع عن ذلك من هنا.',
    );
  });
});

describe('the photos', () => {
  it('are fetched one after another by their route, each made an object URL', async () => {
    const fetchPhoto = vi.fn((_id: string, fileId: string) =>
      fileId === 'f-2' ? Promise.reject(new Error('404')) : Promise.resolve(new Blob([fileId])),
    );
    const seen: string[] = [];
    const loaded = await loadVehicleCheckPhotos('r-9', ['f-1', 'f-2', 'f-3'], {
      fetchPhoto,
      toUrl: () => `blob:${seen.length + 1}`,
      onEach: (photo) => seen.push(photo.fileId),
    });
    expect(fetchPhoto.mock.calls).toEqual([
      ['r-9', 'f-1'],
      ['r-9', 'f-2'],
      ['r-9', 'f-3'],
    ]);
    // A photo that failed is said to have failed; the others still show.
    expect(loaded).toEqual([
      { fileId: 'f-1', url: 'blob:1' },
      { fileId: 'f-2', url: null },
      { fileId: 'f-3', url: 'blob:3' },
    ]);
    expect(seen).toEqual(['f-1', 'f-2', 'f-3']);
  });

  it('stop when the report is closed, and hand back what was made so it can be let go', async () => {
    let closed = false;
    const loaded = await loadVehicleCheckPhotos('r-9', ['f-1', 'f-2'], {
      fetchPhoto: () => {
        closed = true;
        return Promise.resolve(new Blob(['x']));
      },
      toUrl: () => 'blob:1',
      isCancelled: () => closed,
    });
    expect(loaded).toEqual([{ fileId: 'f-1', url: 'blob:1' }]);
  });
});
