// The ATM papers' one door (docs/12-planning/atm-settlements-phase1.md §8, DS-21): the tab first,
// no request when it is blocked, the tab closed when the request fails.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openPrintWindow, writePrintWindow } from '../../../../shared/lib/print-window';
import {
  esc,
  int,
  ltr,
  paperDocument,
  printSettlementPaper,
  settlementPaperWords,
} from './settlement-print';

vi.mock('../../../../shared/lib/print-window', () => ({
  openPrintWindow: vi.fn(),
  writePrintWindow: vi.fn(),
}));

const open = vi.mocked(openPrintWindow);
const write = vi.mocked(writePrintWindow);

describe('printSettlementPaper', () => {
  beforeEach(() => {
    open.mockReset();
    write.mockReset();
  });

  it('a blocked tab sends no request, so nothing is counted or audited', async () => {
    open.mockReturnValue(null);
    const load = vi.fn(() => Promise.resolve({ ok: true }));
    expect(await printSettlementPaper({ loading: '…', load, compose: () => '' })).toBeNull();
    expect(load).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('opens the tab before the request, then writes the composed paper', async () => {
    const order: string[] = [];
    const win = { close: vi.fn() } as unknown as Window;
    open.mockImplementation(() => {
      order.push('open');
      return win;
    });
    const load = vi.fn(() => {
      order.push('load');
      return Promise.resolve({ serial: 7 });
    });
    const result = await printSettlementPaper({
      loading: 'جارٍ التحميل…',
      load,
      compose: (dto) => `<p>${String(dto.serial)}</p>`,
    });
    expect(order).toEqual(['open', 'load']);
    expect(open).toHaveBeenCalledWith('جارٍ التحميل…');
    expect(write).toHaveBeenCalledWith(win, '<p>7</p>');
    expect(result).toEqual({ serial: 7 });
  });

  it('a failed request closes the tab and rethrows', async () => {
    const win = { close: vi.fn() } as unknown as Window;
    open.mockReturnValue(win);
    const failure = new Error('409');
    await expect(
      printSettlementPaper({ loading: '', load: () => Promise.reject(failure), compose: () => '' }),
    ).rejects.toBe(failure);
    expect(win.close).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
  });
});

describe('the document and its text', () => {
  it('escapes, isolates codes left-to-right and groups like Excel’s #,##0', () => {
    expect(esc('<a href="x">\'&\'</a>')).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
    expect(ltr('BRKN9001')).toBe('<bdi dir="ltr">BRKN9001</bdi>');
    expect(ltr(null)).toBe('');
    expect(int(800000)).toBe('800,000');
    expect(int(0)).toBe('0');
  });

  it('writes the logo only when asked, and the toolbar’s Arabic buttons', () => {
    const words = settlementPaperWords();
    const plain = paperDocument({
      title: 't',
      orientation: 'portrait',
      style: '',
      pages: '',
      words,
    });
    expect(plain).not.toContain('egc-logo');
    expect(plain).toContain('<button type="button" class="primary" data-print>طباعة</button>');
    expect(plain).toContain('<button type="button" data-close>إغلاق</button>');
    const logo = paperDocument({
      title: 't',
      orientation: 'landscape',
      style: '',
      pages: '',
      words,
      logo: true,
    });
    expect(logo.match(/\.egc-logo \{/gu)).toHaveLength(1);
    expect(logo).toContain('@page { size: A4 landscape; margin: 0; }');
  });
});
