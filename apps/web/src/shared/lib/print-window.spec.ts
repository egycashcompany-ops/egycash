// Printed documents print from the app's own script — never from one of their own.
//
// The tab a printed document is written into inherits the app's Content-Security-Policy, which
// never runs an inline `<script>` or an `onclick`: that is why fleet's reports, gold's receipts and
// IT's custody receipt opened and then sat there without a print dialog. Two things are held
// here: what the one door (`print-window.ts`) does, and that no printed page anywhere in the app
// goes back to carrying a script of its own.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { printWhenReady, wirePrintWindow } from './print-window';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** A tab as small as the door needs: buttons by attribute, images, a clock run by hand. */
const fakeTab = ({
  readyState = 'complete',
  imagesComplete = true,
}: { readyState?: string; imagesComplete?: boolean } = {}) => {
  const listeners = new Map<string, (() => void)[]>();
  const on = (key: string) => (type: string, fn: () => void) => {
    listeners.set(`${key}:${type}`, [...(listeners.get(`${key}:${type}`) ?? []), fn]);
  };
  const fire = (key: string) => {
    for (const fn of listeners.get(key) ?? []) fn();
  };
  const timers: (() => void)[] = [];
  const buttons = {
    '[data-print]': [{ addEventListener: on('print-button') }],
    '[data-close]': [{ addEventListener: on('close-button') }],
  } as Record<string, { addEventListener: ReturnType<typeof on> }[]>;
  const win = {
    closed: false,
    focus: vi.fn(),
    print: vi.fn(),
    close: vi.fn(),
    addEventListener: on('window'),
    setTimeout: (fn: () => void) => {
      timers.push(fn);
      return timers.length;
    },
    document: {
      readyState,
      body: { offsetHeight: 1 },
      images: [{ complete: imagesComplete, addEventListener: on('logo') }],
      querySelectorAll: (selector: string) => buttons[selector] ?? [],
    },
  };
  return { win, fire, timers };
};

/** Let every promise the door waits on settle. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('the dialog opens by itself, once the page is ready', () => {
  it('prints once the letterhead has decoded — and only once, whatever else fires', async () => {
    const { win, fire, timers } = fakeTab({ imagesComplete: false });
    printWhenReady(win as unknown as Window);
    expect(timers).toHaveLength(1); // the backstop: the logo has not decoded yet

    fire('logo:load');
    await flush();
    expect(timers).toHaveLength(2); // …and now the short wait before the dialog
    timers[1]?.();
    expect(win.print).toHaveBeenCalledTimes(1);

    fire('logo:error');
    await flush();
    for (const timer of timers) timer();
    expect(win.print).toHaveBeenCalledTimes(1);
  });

  it('waits for a page still loading, and prints when it has', async () => {
    const { win, fire, timers } = fakeTab({ readyState: 'loading' });
    printWhenReady(win as unknown as Window);
    expect(timers).toHaveLength(1); // the backstop only: nothing is ready yet

    fire('window:load');
    await flush();
    timers[1]?.();
    expect(win.print).toHaveBeenCalledTimes(1);
  });

  it('a page whose images never report still prints — the timer is the backstop', () => {
    const { win, timers } = fakeTab({ imagesComplete: false });
    printWhenReady(win as unknown as Window, 2500);
    timers[0]?.();
    expect(win.print).toHaveBeenCalledTimes(1);
  });

  it('never prints into a tab the reader already closed', async () => {
    const { win, timers } = fakeTab();
    printWhenReady(win as unknown as Window);
    win.closed = true;
    await flush();
    for (const timer of timers) timer();
    expect(win.print).not.toHaveBeenCalled();
  });
});

describe('the page’s own buttons are wired from the app', () => {
  it('data-print prints again, data-close closes the tab', () => {
    const { win, fire } = fakeTab();
    wirePrintWindow(win as unknown as Window, { autoPrint: false });

    expect(win.print).not.toHaveBeenCalled();
    fire('print-button:click');
    fire('print-button:click');
    expect(win.print).toHaveBeenCalledTimes(2);
    fire('close-button:click');
    expect(win.close).toHaveBeenCalledTimes(1);
  });
});

/** Every non-spec source file of the web app, comments removed. */
const sources = (dir = SRC): [string, string][] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    if (!/\.tsx?$/u.test(entry.name) || entry.name.includes('.spec.')) return [];
    const code = readFileSync(full, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//gu, '')
      .replace(/^\s*\/\/.*$/gmu, '');
    return [[relative(SRC, full), code] as [string, string]];
  });

describe('no printed page carries a script of its own', () => {
  const all = sources();

  it('no document the app composes holds a <script> or an inline handler', () => {
    const offenders = all
      .filter(([, code]) => /<script\b/iu.test(code) || /\son[a-z]+=["']/u.test(code))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });

  it('fleet, gold and IT print through the one door', () => {
    for (const file of [
      'modules/fleet/lib/fleet-report-print.ts',
      'modules/fleet/lib/notice-render.ts',
      'modules/fleet/components/vehicle-print.ts',
      'modules/gold/lib/gold-print.ts',
      'modules/it/lib/custody-receipt-print.ts',
      'modules/it/components/useAssetLabels.ts',
    ]) {
      const code = all.find(([name]) => name === file)?.[1] ?? '';
      expect(code, file).toMatch(/from '\.\.\/\.\.\/\.\.\/shared\/lib\/print-window'/u);
      expect(code, `${file} writes no document itself`).not.toContain('document.write(');
    }
  });
});
