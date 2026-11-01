// The paste dialogs whose requests are safe to send again take any number of lines (2026-11-01,
// «صلّح كمان إضافة الماكينات والـ bulk add»): the settlement plan's «إضافة ماكينات» (requests of
// ATM_BULK_MAX_IDS) and the data-edit bulk add and delete (requests of ATM_MACHINES_BULK_MAX).
// Repeats are decided over the whole paste first; the answers are joined as one; a run that stops
// puts every line not confirmed back — the failed request's own lines too, which may have partly
// gone through unless the endpoint's refusals write nothing — and a top-bar branch switch between
// two requests stops the runs that depend on it (the open forms too).
//
// Every code below is synthetic.
import { type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ATM_BULK_MAX_IDS,
  ATM_MACHINES_BULK_MAX,
  BulkCreateAtmMachinesSchema,
  BulkDeleteAtmMachinesSchema,
  type Locale,
} from '@ecms/contracts';
import * as ApiClientModule from '../../shared/lib/api-client';
import { localeSlice } from '../../store/localeSlice';
import { translate } from '../../platform/localization/i18n';
import {
  BranchChangedError,
  firstOfEach,
  inPasteBatches,
  runFailureText,
} from './lib/paste-batches';
import {
  bulkCreateMachinesInBatches,
  bulkDeleteMachinesInBatches,
  openReplenishments,
} from './api/atm-api';
import { addPlanLinesInBatches } from './api/settlements-api';
import { joinBulkAdd, joinBulkDelete } from './components/DataEditDialogs';
import { PasteStopNotice } from './components/PasteStopNotice';

const { ApiError, setActiveBranch } = ApiClientModule;

interface Sent {
  path: string;
  body: Record<string, unknown>;
}
const sent: Sent[] = [];
/** The request (1-based) that fails, and with what. */
let failOn: number | null = null;
let failure: unknown = null;
/** Run after a request is answered — to switch the branch between two requests. */
let afterRequest: ((n: number) => void) | null = null;

const answerFor = (path: string, body: Record<string, unknown>): unknown => {
  if (path.endsWith('/atm/machines/bulk')) {
    const machines = body['machines'] as { machineCode: string; name: string }[];
    return {
      created: machines.map((m) => ({ machineCode: m.machineCode })),
      skippedCodes: [],
      reactivatedCodes: [],
      refused: [],
      register: { created: [], received: [], linked: [], existing: [], notRecorded: [] },
    };
  }
  if (path.endsWith('/atm/machines/bulk-delete')) {
    const codes = body['machineCodes'] as string[];
    return {
      deletedCodes: codes.filter((c) => !c.endsWith('9')),
      unknownCodes: codes.filter((c) => c.endsWith('9')),
    };
  }
  if (path.endsWith('/lines')) {
    // A code ending in 7 has no layout: refused; every other line is added.
    const rows = body['rows'] as { machineCode: string }[];
    return {
      added: rows
        .filter((r) => !r.machineCode.endsWith('7'))
        .map((r) => ({ machineCode: r.machineCode })),
      refused: rows
        .filter((r) => r.machineCode.endsWith('7'))
        .map((r) => ({ code: r.machineCode, reason: 'noLayout' })),
    };
  }
  // The open forms.
  const rows = body['rows'] as { machineCode: string }[];
  return {
    opened: rows.map((r) => ({ machineCode: r.machineCode })),
    unknownCodes: [],
    alreadyOpenCodes: [],
  };
};

vi.mock('../../shared/lib/api-client', async () => {
  const actual = await vi.importActual<typeof ApiClientModule>('../../shared/lib/api-client');
  return {
    ...actual,
    post: (path: string, body: Record<string, unknown>) => {
      sent.push({ path, body });
      const n = sent.length;
      if (failOn !== null && n === failOn) return Promise.reject(failure);
      const answer = answerFor(path, body);
      afterRequest?.(n);
      return Promise.resolve(answer);
    },
  };
});

afterEach(() => {
  sent.length = 0;
  failOn = null;
  failure = null;
  afterRequest = null;
  setActiveBranch(null);
});

const codes = (n: number, from = 99990000): string[] =>
  Array.from({ length: n }, (_unused, i) => String(from + i));
const sizes = (): number[] =>
  sent.map(
    (s) => ((s.body['rows'] ?? s.body['machines'] ?? s.body['machineCodes']) as unknown[]).length,
  );
const refusal = new ApiError('ATM_PLAN_FULL', 'the plan is full', 422);
const dropped = new TypeError('Failed to fetch');

describe('inPasteBatches — the run itself', () => {
  const send = (batch: number[]): Promise<number[]> =>
    ApiClientModule.post<number[]>('/x', { rows: batch }).then(() => batch);

  it('consecutive requests of the size, in order; every answer kept', async () => {
    const rows = Array.from({ length: 450 }, (_u, i) => i);
    const run = await inPasteBatches(rows, 200, send, {
      pinBranch: false,
      refusalWritesNothing: true,
    });
    expect(sizes()).toEqual([200, 200, 50]);
    expect(run.answers.flat()).toEqual(rows);
    expect(run).toMatchObject({ left: [], maybeDone: 0, failure: null });
  });

  it('the FIRST request failing fails the run as one request did', async () => {
    failOn = 1;
    failure = dropped;
    await expect(
      inPasteBatches([1, 2, 3], 2, send, { pinBranch: false, refusalWritesNothing: true }),
    ).rejects.toBe(dropped);
  });

  it('a LATER one: the rest from the failed request on is left; its lines may be done', async () => {
    failOn = 2;
    failure = dropped;
    const rows = Array.from({ length: 5 }, (_u, i) => i);
    const run = await inPasteBatches(rows, 2, send, {
      pinBranch: false,
      refusalWritesNothing: true,
    });
    expect(run.answers).toEqual([[0, 1]]);
    expect(run.left).toEqual([2, 3, 4]);
    expect(run.maybeDone).toBe(2);
    expect(run.failure).toBe(dropped);
  });

  it('a 4xx on an endpoint whose refusals write nothing: nothing of it may be done', async () => {
    failOn = 2;
    failure = refusal;
    const run = await inPasteBatches([0, 1, 2, 3], 2, send, {
      pinBranch: false,
      refusalWritesNothing: true,
    });
    expect(run.left).toEqual([2, 3]);
    expect(run.maybeDone).toBe(0);
  });

  it('a 4xx where refusals CAN follow writes (the bulk forms): its lines may be done', async () => {
    failOn = 2;
    failure = new ApiError('ATM_BRANCH_MOVE_RUNNING', 'move', 423);
    const run = await inPasteBatches([0, 1, 2, 3], 2, send, {
      pinBranch: true,
      refusalWritesNothing: false,
    });
    expect(run.maybeDone).toBe(2);
  });

  it('a top-bar branch switch between two requests stops before the next — nothing of it went', async () => {
    setActiveBranch('branch-a');
    afterRequest = (n) => {
      if (n === 1) setActiveBranch('branch-b');
    };
    const run = await inPasteBatches([0, 1, 2, 3], 2, send, {
      pinBranch: true,
      refusalWritesNothing: false,
    });
    expect(sent).toHaveLength(1);
    expect(run.left).toEqual([2, 3]);
    expect(run.maybeDone).toBe(0);
    expect(run.failure).toBeInstanceOf(BranchChangedError);
  });

  it('…unless the run does not depend on the top bar (the plan names its branch)', async () => {
    setActiveBranch('branch-a');
    afterRequest = () => setActiveBranch('branch-b');
    const run = await inPasteBatches([0, 1, 2, 3], 2, send, {
      pinBranch: false,
      refusalWritesNothing: true,
    });
    expect(sent).toHaveLength(2);
    expect(run.left).toEqual([]);
  });
});

describe('firstOfEach — repeats decided over the whole paste', () => {
  it('keeps the first line of each key, in order, and returns the rest with their index', () => {
    const out = firstOfEach(['a', 'b', 'a', 'c', 'b'], (x) => x);
    expect(out.kept).toEqual(['a', 'b', 'c']);
    expect(out.keptIndex).toEqual([0, 1, 3]);
    expect(out.repeats).toEqual([
      { row: 'a', index: 2 },
      { row: 'b', index: 4 },
    ]);
  });
});

describe('the data-edit bulk add', () => {
  it('the cap is the API’s own', () => {
    expect(ATM_MACHINES_BULK_MAX).toBe(500);
    const machines = (n: number) => codes(n).map((machineCode) => ({ machineCode, name: 'SYN' }));
    expect(() =>
      BulkCreateAtmMachinesSchema.parse({ bankName: 'B', area: 'A', machines: machines(500) }),
    ).not.toThrow();
    expect(() =>
      BulkCreateAtmMachinesSchema.parse({ bankName: 'B', area: 'A', machines: machines(501) }),
    ).toThrow();
    expect(() => BulkDeleteAtmMachinesSchema.parse({ machineCodes: codes(501) })).toThrow();
  });

  it('1,200 lines: 500, 500, 200 — each code once (the first line wins), one bank and area for all', async () => {
    const machines = [
      ...codes(1200).map((machineCode) => ({ machineCode, name: `SYN ${machineCode}` })),
      { machineCode: '99990000', name: 'a repeat' },
      { machineCode: '099990001', name: 'a repeat, zero-padded' },
    ];
    setActiveBranch('branch-a');
    const run = await bulkCreateMachinesInBatches({ bankName: 'NBE', area: 'Abdeen', machines });
    expect(sizes()).toEqual([500, 500, 200]);
    expect(sent.every((s) => s.body['bankName'] === 'NBE' && s.body['area'] === 'Abdeen')).toBe(
      true,
    );
    const joined = joinBulkAdd(run.answers);
    expect(joined.created).toHaveLength(1200);
    expect(sent[0]?.body['machines']).toContainEqual({
      machineCode: '99990000',
      name: 'SYN 99990000',
    });
    expect(run.left).toEqual([]);
  });

  it('a later request with no answer: every line from it on comes back, its own marked may-be-done', async () => {
    failOn = 2;
    failure = dropped;
    const machines = codes(1200).map((machineCode) => ({
      machineCode,
      name: `SYN ${machineCode}`,
    }));
    const run = await bulkCreateMachinesInBatches({ bankName: 'NBE', area: 'Abdeen', machines });
    expect(run.left).toEqual(machines.slice(500));
    expect(run.maybeDone).toBe(500);
    expect(joinBulkAdd(run.answers).created).toHaveLength(500);
  });
});

describe('the data-edit bulk delete', () => {
  it('each code once, normalized as the server reads it, in requests of 500; answers joined', async () => {
    const run = await bulkDeleteMachinesInBatches([...codes(700), '099990000', ' 99990001 ', '']);
    expect(sizes()).toEqual([500, 200]);
    const joined = joinBulkDelete(run.answers);
    expect(joined.deletedCodes.length + joined.unknownCodes.length).toBe(700);
    expect(joined.unknownCodes.every((c) => c.endsWith('9'))).toBe(true);
  });

  it('a branch switch between requests stops it — the rest comes back, none of it sent', async () => {
    setActiveBranch('branch-a');
    afterRequest = () => setActiveBranch('branch-b');
    const run = await bulkDeleteMachinesInBatches(codes(700));
    expect(sent).toHaveLength(1);
    expect(run.left).toEqual(codes(700).slice(500));
    expect(run.maybeDone).toBe(0);
    expect(run.failure).toBeInstanceOf(BranchChangedError);
  });
});

describe('the settlement plan’s «إضافة ماكينات»', () => {
  const rows = (list: string[]) => list.map((machineCode) => ({ machineCode, scheduleTime: null }));

  it('450 lines: 200, 200, 50 with one run; added and refused joined in the paste’s order', async () => {
    const list = codes(450);
    const run = await addPlanLinesInBatches('plan-1', { run: 2, rows: rows(list) });
    expect(ATM_BULK_MAX_IDS).toBe(200);
    expect(sizes()).toEqual([200, 200, 50]);
    expect(sent.every((s) => s.path.endsWith('/plans/plan-1/lines') && s.body['run'] === 2)).toBe(
      true,
    );
    expect(run.added).toHaveLength(list.filter((c) => !c.endsWith('7')).length);
    expect(run.refused.map((r) => r.code)).toEqual(list.filter((c) => c.endsWith('7')));
    expect(run.left).toEqual([]);
  });

  it('a repeat anywhere in the paste is «مكررة في القائمة» — sent once, even across requests', async () => {
    const list = [...codes(250), '99990003', '99990249'];
    const run = await addPlanLinesInBatches('plan-1', { run: 1, rows: rows(list) });
    expect(sizes()).toEqual([200, 50]);
    const sentCodes = sent.flatMap((s) =>
      (s.body['rows'] as { machineCode: string }[]).map((r) => r.machineCode),
    );
    expect(new Set(sentCodes).size).toBe(sentCodes.length);
    expect(run.refused.slice(-2)).toEqual([
      { code: '99990003', reason: 'duplicateInRequest' },
      { code: '99990249', reason: 'duplicateInRequest' },
    ]);
    // In the paste's order: «99990007» (no layout, line 7) before the repeats (lines 250–251).
    expect(run.refused[0]).toEqual({ code: '99990007', reason: 'noLayout' });
  });

  it('the plan full on the 2nd request: the first 200 stand, the rest comes back, none may be done', async () => {
    failOn = 2;
    failure = refusal;
    const list = codes(450);
    const run = await addPlanLinesInBatches('plan-1', { run: 1, rows: rows(list) });
    expect(sent).toHaveLength(2);
    expect(run.left.map((r) => r.machineCode)).toEqual(list.slice(200));
    expect(run.maybeDone).toBe(0);
    expect(run.failure).toBe(refusal);
  });

  it('no answer on the 2nd: its lines may be done (a resend reads them «موجودة في هذه التغذية»)', async () => {
    failOn = 2;
    failure = dropped;
    const run = await addPlanLinesInBatches('plan-1', { run: 1, rows: rows(codes(450)) });
    expect(run.maybeDone).toBe(200);
    expect(run.left).toHaveLength(250);
  });
});

describe('the open forms stop too when the branch is switched mid-run', () => {
  it('the lines not sent come back as unsent — never as uncertain', async () => {
    setActiveBranch('branch-a');
    afterRequest = () => setActiveBranch('branch-b');
    const list = codes(450).map((machineCode) => ({ machineCode, scheduleTime: null }));
    const outcome = await openReplenishments({ rows: list, forceDate: null });
    expect(sent).toHaveLength(1);
    expect(outcome.opened).toHaveLength(200);
    expect(outcome.unsent).toEqual(list.slice(200));
    expect(outcome.uncertain).toEqual([]);
    expect(outcome.failure).toBeInstanceOf(BranchChangedError);
  });
});

describe('what the reader is told', () => {
  const render = (locale: Locale, node: ReactNode): string =>
    renderToStaticMarkup(
      <Provider
        store={configureStore({
          reducer: { locale: localeSlice.reducer },
          preloadedState: {
            locale: { locale, dir: (locale === 'ar' ? 'rtl' : 'ltr') as 'rtl' | 'ltr' },
          },
        })}
      >
        {node}
      </Provider>,
    );
  const t = (locale: Locale) => (key: string, params?: Record<string, string | number>) =>
    translate(locale, key, params);

  it('a branch switch has its own words', () => {
    expect(runFailureText(new BranchChangedError(), t('ar'), 'ar')).toBe(
      'تغيّر الفرع المختار أثناء الإرسال، فتوقف قبل الطلب التالي.',
    );
    expect(runFailureText(refusal, t('ar'), 'ar')).not.toBe('');
  });

  it.each(['ar', 'en'] as const)(
    'in %s: the lines back in the boxes, and which may be done',
    (locale) => {
      const markup = render(
        locale,
        <PasteStopNotice
          left={300}
          maybeDone={200}
          action="إضافة"
          safeHint={translate(locale, 'atm.plan.add.resendSafe')}
        />,
      );
      expect(markup).toContain('data-paste-stop="true"');
      expect(markup).toContain(translate(locale, 'atm.common.openStopped', { count: 300 }));
      expect(markup).toContain(translate(locale, 'atm.common.pasteLeft', { action: 'إضافة' }));
      expect(markup).toContain(translate(locale, 'atm.common.pasteMaybeDone', { count: 200 }));
      expect(markup).toContain(translate(locale, 'atm.plan.add.resendSafe'));
    },
  );

  it('nothing may be done → only the lines back; nothing left → nothing said', () => {
    const none = render('ar', <PasteStopNotice left={5} maybeDone={0} action="حذف" safeHint="X" />);
    expect(none).not.toContain(
      translate('ar', 'atm.common.pasteMaybeDone', { count: 0 }).slice(0, 8),
    );
    expect(none).not.toContain('X');
    expect(render('ar', <PasteStopNotice left={0} maybeDone={0} action="حذف" safeHint="X" />)).toBe(
      '',
    );
  });

  it('the Arabic reads as the catalog writes it', () => {
    expect(translate('ar', 'atm.common.pasteLeft', { action: 'إضافة' })).toBe(
      'أُعيدت إلى الخانات، فاضغط «إضافة» مرة أخرى.',
    );
    expect(translate('ar', 'atm.dataEdit.addResendSafe')).toBe(
      'ما أُضيف منها يظهر «مسجلة من قبل».',
    );
  });
});
