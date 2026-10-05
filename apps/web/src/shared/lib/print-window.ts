// Printed documents in their own tab — and why such a page cannot print itself.
//
// Fleet's reports and notices, gold's receipts, statements and minutes, IT's custody receipt and
// label sheet: each is a standalone HTML document written into a tab the app opens with
// `window.open('')`. That tab INHERITS the app's Content-Security-Policy — Helmet's defaults in
// `apps/api/src/app.ts`: `script-src 'self'`, `script-src-attr 'none'`. So a `<script>` written
// into the document, or an `onclick="window.print()"` on a button in it, NEVER RUNS. That is the
// whole of «مش بعرف اطبع الpdf بيفتح شاشه وخلاص»: the page opened, and the dialog its own script
// was meant to open never did.
//
// What does run is the app's own script, which the policy allows: it may attach listeners to the
// tab's document and call the tab's `print()`. Every printed document therefore goes through
// here, carries no script of its own, and marks its buttons with `data-print` / `data-close`
// instead of inline handlers (`print-window.spec.ts` holds the codebase to that).

/** A button marked with this attribute prints the document again. */
export const PRINT_BUTTON_ATTRIBUTE = 'data-print';
/** A button marked with this attribute closes the tab. */
export const CLOSE_BUTTON_ATTRIBUTE = 'data-close';

export interface PrintWindowOptions {
  /**
   * Open the print dialog by itself once the page is ready (the default). A document read on the
   * screen before anyone prints it — the drawer-inventory minutes — passes false and relies on
   * its own print button.
   */
  autoPrint?: boolean;
  /**
   * The longest the dialog waits for the page's images and fonts. A page that prints with a
   * fallback font beats a page that does not print at all.
   */
  readyTimeoutMs?: number;
  /** Passed to `window.open` — a sized popup rather than a tab, where a caller wants one. */
  features?: string;
}

const DEFAULT_READY_TIMEOUT_MS = 2500;

/**
 * Open the dialog once — after the page has loaded, its images have decoded and the fonts it lays
 * out with have arrived, or after the timeout, whichever comes first. A company document on paper
 * without its letterhead is not the document, which is what the wait is for; the timer is what
 * makes sure the dialog opens even when something it waits on never reports.
 */
export const printWhenReady = (win: Window, timeoutMs = DEFAULT_READY_TIMEOUT_MS): void => {
  let printed = false;
  const go = (): void => {
    if (printed || win.closed) return;
    printed = true;
    win.focus();
    win.print();
  };
  const settle = (): void => {
    const doc = win.document;
    const images = Array.from(doc.images)
      .filter((image) => !image.complete)
      .map(
        (image) =>
          new Promise<void>((resolve) => {
            image.addEventListener('load', () => resolve(), { once: true });
            image.addEventListener('error', () => resolve(), { once: true });
          }),
      );
    // Reading the layout starts the fonts the page uses loading; `fonts.ready` then waits on them.
    void doc.body?.offsetHeight;
    const fonts = 'fonts' in doc ? doc.fonts.ready : Promise.resolve();
    const later = (): void => {
      win.setTimeout(go, 80);
    };
    void Promise.all([...images, fonts]).then(later, later);
  };
  if (win.document.readyState === 'complete') settle();
  else win.addEventListener('load', settle, { once: true });
  win.setTimeout(go, timeoutMs);
};

/** What the page cannot do for itself: its buttons, and — unless told otherwise — the dialog. */
export const wirePrintWindow = (win: Window, options: PrintWindowOptions = {}): void => {
  const doc = win.document;
  doc.querySelectorAll(`[${PRINT_BUTTON_ATTRIBUTE}]`).forEach((button) => {
    button.addEventListener('click', () => {
      win.focus();
      win.print();
    });
  });
  doc.querySelectorAll(`[${CLOSE_BUTTON_ATTRIBUTE}]`).forEach((button) => {
    button.addEventListener('click', () => win.close());
  });
  if (options.autoPrint !== false) printWhenReady(win, options.readyTimeoutMs);
};

/**
 * Open the tab NOW, while the click still counts as the user's: a tab opened once a fetch has
 * come back is one a popup blocker refuses. Shows `placeholder` until the document is written.
 * Null when the browser blocked it anyway — the caller says so rather than doing nothing.
 */
export const openPrintWindow = (placeholder = '', features?: string): Window | null => {
  const win = window.open('', '_blank', features);
  if (win === null) return null;
  win.document.open();
  win.document.write(
    `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8" /></head><body style="margin: 0; padding: 48px 16px; text-align: center; font-family: Tahoma, sans-serif; color: #2e2e74;">${placeholder
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')}</body></html>`,
  );
  win.document.close();
  return win;
};

/** Write a composed document into a tab `openPrintWindow` opened, and make it work. */
export const writePrintWindow = (
  win: Window,
  html: string,
  options: PrintWindowOptions = {},
): void => {
  win.document.open();
  win.document.write(html);
  win.document.close();
  wirePrintWindow(win, options);
  win.focus();
};

/**
 * Open, write and wire, in one go — for a document already composed when the button is pressed.
 * Null when the browser refused the tab.
 */
export const openPrintDocument = (
  html: string,
  options: PrintWindowOptions = {},
): Window | null => {
  const win = window.open('', '_blank', options.features);
  if (win === null) return null;
  writePrintWindow(win, html, options);
  return win;
};
