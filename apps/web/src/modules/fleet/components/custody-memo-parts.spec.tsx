// The pieces «المذكرات», «سجل العهدة», the memo editor and the fund's dialogs share — drawn once, so
// each screen says a memo's name, its status, a sum and a tick the same way. Proven against what
// the pieces produce, rendered to markup.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { type FleetCustodyMemoRowDto, type Locale, type MeDto } from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { translate } from '../../../platform/localization/i18n';
import {
  CodeChip,
  Dates,
  Day,
  DoneChip,
  ExportPill,
  KindPill,
  MemoName,
  MemoStatus,
  Money,
  PrintButton,
  Signed,
  Tick,
  WAIT_CHIP,
  WaitChip,
  isUnnamedMemo,
  memoDisplayName,
} from './custody-memo-parts';
import { CUSTODY_KIND } from './CustodyKinds';

const HERE = dirname(fileURLToPath(import.meta.url));
const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

const draw = (node: JSX.Element, locale: Locale = 'ar'): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
      auth: { me: null as unknown as MeDto, status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <MemoryRouter>{node}</MemoryRouter>
    </Provider>,
  );
};
const text = (html: string): string =>
  html
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&quot;/gu, '"')
    .replace(/\s+/gu, ' ')
    .trim();

const memo = (over: Partial<FleetCustodyMemoRowDto> = {}): FleetCustodyMemoRowDto => ({
  id: '650000000000000000000007',
  no: 7,
  kind: 'tyres',
  name: '',
  date: '2026-10-19',
  from: '2026-10-06',
  to: '2026-10-18',
  receipts: 2,
  total: 1690,
  replenishment: null,
  version: 0,
  createdAt: '2026-10-19T09:00:00.000Z',
  updatedAt: '2026-10-19T09:00:00.000Z',
  ...over,
});

describe('a memo’s name — typed, or «مذكرة <النوع> رقم N» in muted ink', () => {
  it('says the name he typed, trimmed', () => {
    const named = memo({ name: '  كاوتش أكتوبر  ' });
    expect(isUnnamedMemo(named)).toBe(false);
    expect(memoDisplayName(named, ar)).toBe('كاوتش أكتوبر');
    const html = draw(<MemoName memo={named} />);
    expect(html).toContain('data-memo-name="typed"');
    expect(text(html)).toBe('كاوتش أكتوبر');
    expect(html).not.toContain('text-slate-400');
  });

  it('calls a memo saved with no name by its kind and number, muted', () => {
    const unnamed = memo({ name: '   ' });
    expect(isUnnamedMemo(unnamed)).toBe(true);
    const fallback = ar('fleet.custody.parts.memoFallback', {
      kind: ar('fleet.custody.source.tyres'),
      no: 7,
    });
    expect(memoDisplayName(unnamed, ar)).toBe(fallback);
    const html = draw(<MemoName memo={unnamed} boxed />);
    expect(html).toContain('data-memo-name="fallback"');
    expect(html).toContain(`title="${ar('fleet.custody.parts.unnamed')}"`);
    expect(html).toContain('text-slate-400');
    expect(html).toContain('max-w-[16rem]');
  });

  it('keeps a dash on the line of the word before it', () => {
    const html = draw(<MemoName memo={memo({ name: 'كاوتش — أكتوبر' })} />);
    expect(html).toContain('كاوتش — أكتوبر');
  });
});

describe('a memo’s status', () => {
  it('waits in amber while it is not replenished', () => {
    const html = draw(<MemoStatus memo={memo()} />);
    expect(html).toContain('data-status="memo-pending"');
    expect(text(html)).toBe(ar('fleet.custody.parts.status.pending'));
    expect(html).not.toContain('href=');
  });

  it('once replenished, says so on its day and leads to that «استعاضة» in the log', () => {
    const html = draw(
      <MemoStatus memo={memo({ replenishment: { id: 'op-1', date: '2026-09-29' } })} />,
    );
    expect(html).toContain('data-status="memo-replenished"');
    expect(html).toContain('href="/fleet/custody/log?open=op-1"');
    expect(html).toContain(`title="${ar('fleet.custody.parts.status.open')}"`);
    expect(text(html)).toBe(`${ar('fleet.custody.parts.status.replenished')} ✓ 2026/09/29`);
    expect(html).toMatch(/<span dir="ltr" class="[^"]*">2026\/09\/29<\/span>/u);
  });

  it('draws a done chip with no link when there is nowhere to go', () => {
    const html = draw(
      <DoneChip label="تمت التسوية" date="2026-10-05" to={null} title="t" mark="licence-settled" />,
    );
    expect(html).toMatch(/^<span title="t" data-status="licence-settled"/u);
    expect(html).not.toContain('href=');
    const link = draw(
      <DoneChip label="تمت التسوية" date="2026-10-05" to="/x" title="t" mark="licence-settled" />,
    );
    expect(link).toMatch(/^<a [^>]*href="\/x"/u);
  });

  it('keeps the amber in its own chip — never on a row action', () => {
    expect(WAIT_CHIP).toContain('amber');
    const html = draw(<WaitChip label="لم تُسوَّ بعد" mark="licence-waiting" />);
    expect(html).toContain(WAIT_CHIP.replace(/'/gu, '&#x27;'));
  });
});

describe('sums and days', () => {
  it('writes money as the boards do — Latin digits, the currency beside them', () => {
    const html = draw(<Money value={1690} />);
    expect(text(html)).toBe('1,690.00 ج.م.');
    expect(html).toContain('dir="ltr"');
    // `wide`: the currency only from a tablet up; `false`: none.
    expect(draw(<Money value={1690} unit="wide" />)).toContain('hidden sm:inline');
    expect(text(draw(<Money value={1690} unit={false} />))).toBe('1,690.00');
  });

  it('signs a ledger amount — «+» emerald in, «−» red out, left to right', () => {
    const plus = draw(<Signed value={100_000} />);
    expect(plus).toContain('data-ledger-amount="in"');
    expect(plus).toContain('text-emerald-700');
    expect(text(plus)).toBe('+100,000.00 ج.م.');
    const minus = draw(<Signed value={-124_139.46} />);
    expect(minus).toContain('data-ledger-amount="out"');
    expect(minus).toContain('text-red-600 dark:text-red-400');
    expect(text(minus)).toBe('−124,139.46 ج.م.');
  });

  it('writes a period year first, on one line or two', () => {
    const line = draw(<Dates from="2026-09-01" to="2026-09-30" />);
    expect(text(line)).toBe(`2026/09/01 ${ar('fleet.custody.parts.to')} 2026/09/30`);
    expect(line).toContain('data-dates="line"');
    expect(draw(<Dates from="2026-09-01" to="2026-09-30" stack />)).toContain('data-dates="stack"');
    expect(text(draw(<Day day="2026-10-06" />))).toBe('2026/10/06');
  });

  it('draws a car’s code and a kind’s pill', () => {
    expect(text(draw(<CodeChip code="204" />))).toBe('204');
    const pill = draw(<KindPill kind="fuel" />);
    expect(pill).toContain(CUSTODY_KIND.fuel.badge);
    expect(text(pill)).toBe(ar('fleet.custody.source.fuel'));
    expect(text(draw(<KindPill kind="fuel" label="وقود ٢" />))).toBe('وقود ٢');
  });
});

describe('the tick, the print button and the export pair', () => {
  it('ticks round — on, off, and «mixed» while only some are picked', () => {
    const on = draw(<Tick on onClick={() => undefined} label="اختيار" data-memo-tick="r-1" />);
    expect(on).toContain('role="checkbox"');
    expect(on).toContain('aria-checked="true"');
    expect(on).toContain('data-memo-tick="r-1"');
    expect(on).toContain('bg-emerald-500');
    expect(draw(<Tick on={false} onClick={() => undefined} label="x" />)).toContain(
      'aria-checked="false"',
    );
    const some = draw(<Tick on={false} partly onClick={() => undefined} label="الكل" />);
    expect(some).toContain('aria-checked="mixed"');
  });

  it('cannot be pressed twice while it works — `busy` dims it and spins', () => {
    const idle = draw(<PrintButton label="حفظ وطباعة" onClick={() => undefined} />);
    expect(idle).not.toContain('disabled=""');
    expect(idle).not.toContain('animate-spin');
    const busy = draw(
      <PrintButton label="حفظ وطباعة" onClick={() => undefined} busy data-memo-save-print="true" />,
    );
    expect(busy).toContain('disabled=""');
    expect(busy).toContain('aria-busy="true"');
    expect(busy).toContain('animate-spin');
    expect(busy).toContain('data-memo-save-print="true"');
  });

  it('frames the Excel / PDF pair, the pressed one spinning, both resting meanwhile', () => {
    const html = draw(
      <ExportPill
        name="custody-memos"
        exporting="pdf"
        onExcel={() => undefined}
        onPdf={() => undefined}
      />,
    );
    expect(html).toContain('data-export="custody-memos"');
    expect(html).toContain('data-print="custody-memos"');
    expect(html.match(/disabled=""/gu)).toHaveLength(2);
    expect(html.match(/animate-spin/gu)).toHaveLength(1);
  });

  it('has no Arabic word of its own — every word is the dictionary’s', () => {
    const source = readFileSync(join(HERE, 'custody-memo-parts.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//gu, '')
      .replace(/\/\/.*$/gmu, '');
    const literals = [...source.matchAll(/(['"`])((?:(?!\1)[^\\\n]|\\.)*)\1/gu)]
      .map((m) => m[2] ?? '')
      .filter((s) => /[ء-ي]/u.test(s));
    expect(literals).toEqual([]);
  });
});
