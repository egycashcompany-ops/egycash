// The two halves' printer buttons.
//
// Built on the module's existing print idiom (`components/vehicle-print.ts`, itself ported from
// `hr/contracts`): compose a self-contained document, open it in a window, print it. Standalone
// HTML on purpose — independent of the app's stylesheet, so what prints is what the panel says
// and nothing the shell contributes.
//
// Nothing is fetched: both panels print exactly the rows they are showing, which is the only
// honest thing a print button on a filtered board can do.
export interface PrintTable {
  title: string;
  /** The filters in force, so a printed page says what it is a view OF. */
  subtitle: string;
  header: readonly string[];
  rows: readonly (readonly string[])[];
  /** Rendered under the table in bold — «إجمالي المخالفات» and friends. */
  totals: readonly { label: string; value: string }[];
  rtl: boolean;
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** The printable HTML. Exported for testing — composing it is where the rules actually live. */
export const buildViolationsPrintHtml = (doc: PrintTable): string => {
  const head = doc.header.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
  const body = doc.rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
    .join('');
  const totals = doc.totals
    .map(
      (total) =>
        `<tr><th>${escapeHtml(total.label)}</th><td>${escapeHtml(total.value)}</td></tr>`,
    )
    .join('');
  // An empty board still prints — a page saying a filter matched nothing is a result, and a
  // reader who prints it has evidence rather than a blank sheet.
  return `<!doctype html>
<html dir="${doc.rtl ? 'rtl' : 'ltr'}" lang="${doc.rtl ? 'ar' : 'en'}">
<head><meta charset="utf-8"><title>${escapeHtml(doc.title)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; color: #1f2340; margin: 0; }
  h1 { font-size: 18px; margin: 0 0 2px; color: #2e2e74; }
  p.sub { font-size: 12px; color: #6b6f86; margin: 0 0 14px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border: 1px solid #d4d5ea; padding: 5px 7px; text-align: ${doc.rtl ? 'right' : 'left'}; }
  thead th { background: #e9e9f7; font-weight: 600; }
  tbody tr:nth-child(even) td { background: #f7f7fc; }
  table.totals { width: auto; margin-top: 12px; }
  table.totals th { background: #d7d7f0; }
  .empty { font-size: 12px; color: #6b6f86; padding: 12px 0; }
</style></head>
<body>
  <h1>${escapeHtml(doc.title)}</h1>
  <p class="sub">${escapeHtml(doc.subtitle)}</p>
  ${
    doc.rows.length === 0
      ? '<p class="empty">—</p>'
      : `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
  }
  ${totals === '' ? '' : `<table class="totals"><tbody>${totals}</tbody></table>`}
</body></html>`;
};

/**
 * Open the composed document and print it — the module's existing idiom, verbatim from
 * `components/vehicle-print.ts`: open, write, close, focus, print on the next tick.
 *
 * Throws on a blocked popup so the caller can say so; a silent no-op would read as a broken
 * button. No image to decode here, so the wait is one frame rather than the 350ms that file
 * needs — the table is laid out by the time `onload` fires.
 */
export const printViolations = (doc: PrintTable): void => {
  const win = window.open('', '_blank');
  if (win === null) throw new Error('popup blocked');
  win.document.open();
  win.document.write(buildViolationsPrintHtml(doc));
  win.document.close();
  win.focus();
  win.setTimeout(() => win.print(), 100);
};
