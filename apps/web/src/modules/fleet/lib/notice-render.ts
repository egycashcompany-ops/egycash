// How a notice's answers are written onto the insurer's form — one renderer for the preview and
// for the printed page, so what the screen shows is what the paper gets.
//
// Everything is placed in PERCENT of the page, and every size is in `cqw` (a hundredth of the
// page's width), so the same markup is right at 640px on the screen and at 210mm on paper. Two
// things cannot be decided without a browser — how long a word is, and so how many fit on a line
// and how small a long answer has to be to stay inside its box — and `fitNotice` does those on the
// rendered page. It writes its results back as `cqw` too, which is what lets the print copy the
// preview's fitted page as it is.
import {
  NOTICE_PAGE,
  type NoticeCheck,
  type NoticeField,
  type NoticeSlot,
  type NoticeTemplate,
} from './notice-templates';
import { openPrintDocument } from '../../../shared/lib/print-window';

export interface NoticeAnswers {
  values: Record<string, string>;
  checks: Record<string, string[]>;
}

const esc = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const pct = (value: number, of: number): string => `${((value / of) * 100).toFixed(3)}%`;

/** A box's position: its right edge, its width, and the middle of its line. */
export const slotStyle = (slot: NoticeSlot): string =>
  `right:${pct(NOTICE_PAGE.width - slot.right, NOTICE_PAGE.width)};` +
  `width:${pct(slot.right - slot.left, NOTICE_PAGE.width)};` +
  `top:${pct(slot.y, NOTICE_PAGE.height)}`;

/**
 * A date answer as the form's three boxes: [day, month, year].
 *
 * Read from what the date input stores (`2026-09-28`) or from a date typed by hand with any
 * separator (`28/9/2026`, `2026/09/28`). Anything else goes into the first box as typed — a
 * notice is never refused for how somebody wrote a date.
 */
export const dateParts = (value: string, yearLastDigit = false): [string, string, string] => {
  const text = value.trim();
  const iso = /^(\d{4})\D(\d{1,2})\D(\d{1,2})$/u.exec(text);
  const dmy = /^(\d{1,2})\D(\d{1,2})\D(\d{4})$/u.exec(text);
  const found =
    iso === null ? (dmy === null ? null : [dmy[3], dmy[2], dmy[1]]) : [iso[1], iso[2], iso[3]];
  if (found === null) return [text, '', ''];
  const [year = '', month = '', day = ''] = found;
  return [day.padStart(2, '0'), month.padStart(2, '0'), yearLastDigit ? year.slice(-1) : year];
};

/** A plate as the form's two boxes: [letters, digits] — the form prints a slash between them. */
export const plateParts = (value: string): [string, string] => {
  const digits = (value.match(/[0-9٠-٩]+/gu) ?? []).join('');
  const letters = value
    .replace(/[0-9٠-٩]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  return [letters, digits];
};

const box = (
  text: string,
  slot: NoticeSlot,
  key: string,
  focus: string | undefined,
  center = false,
): string =>
  text === ''
    ? ''
    : `<div class="nt-s nt-fit${key === focus ? ' nt-hl' : ''}" data-box="${esc(key)}" style="${slotStyle(slot)}${center ? ';text-align:center' : ''}">${esc(text)}</div>`;

const fieldMarkup = (field: NoticeField, value: string, focus: string | undefined): string => {
  if (value.trim() === '') return '';
  switch (field.kind) {
    case 'date': {
      const parts = dateParts(value, field.yearLastDigit === true);
      return (field.parts ?? [])
        .map((slot, i) => box(parts[i] ?? '', slot, field.key, focus, true))
        .join('');
    }
    case 'plate': {
      const parts = plateParts(value);
      return (field.parts ?? [])
        .map((slot, i) => box(parts[i] ?? '', slot, field.key, focus, true))
        .join('');
    }
    case 'multiline':
      // Flowed across the lines by `fitNotice` — how many words fit is a browser's question.
      return `<div class="nt-ml${field.key === focus ? ' nt-hl' : ''}" data-box="${esc(field.key)}" data-lines="${esc(
        JSON.stringify((field.lines ?? []).map(slotStyle)),
      )}">${esc(value.replace(/\s+/gu, ' ').trim())}</div>`;
    default:
      return field.slot === undefined ? '' : box(value.trim(), field.slot, field.key, focus);
  }
};

/** A tick — drawn, not typed, so it is the same bold mark on every printer. */
const TICK =
  '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 10.5 L8 15.5 L17.5 3.5" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const checkMarkup = (check: NoticeCheck, chosen: readonly string[]): string =>
  check.options
    .filter((option) => chosen.includes(option.label))
    .map(
      (option) =>
        `<div class="nt-c" data-check="${esc(check.key)}" style="right:${pct(NOTICE_PAGE.width - option.x, NOTICE_PAGE.width)};top:${pct(option.y, NOTICE_PAGE.height)}">${TICK}</div>`,
    )
    .join('');

/** What goes over ONE page of the form. `focus` marks the box being typed in. */
export const noticePageMarkup = (
  template: NoticeTemplate,
  page: number,
  answers: NoticeAnswers,
  focus?: string,
): string => {
  const fields = template.sections
    .flatMap((section) => section.fields)
    .filter((field) => field.page === page)
    .map((field) => fieldMarkup(field, answers.values[field.key] ?? '', focus));
  const checks = template.checks
    .filter((check) => check.page === page)
    .map((check) => checkMarkup(check, answers.checks[check.key] ?? []));
  return [...fields, ...checks].join('');
};

/** The styles both the preview and the print use. Sizes in `cqw` — see the file's head. */
export const NOTICE_CSS = `
.nt-page { position: relative; aspect-ratio: ${NOTICE_PAGE.width} / ${NOTICE_PAGE.height}; background: #fff; container-type: inline-size; overflow: hidden; }
.nt-page > img { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.nt-page.nt-blank > img { visibility: hidden; }
.nt-over { position: absolute; inset: 0; }
.nt-s { position: absolute; white-space: nowrap; text-align: right; line-height: 1.2; transform: translateY(-50%); font-weight: 700; color: #1e3a8a; font-size: 1.6cqw; direction: rtl; }
.nt-ml { display: none; }
.nt-c { position: absolute; width: 3.2cqw; height: 3.2cqw; transform: translate(50%, -50%); color: #1e3a8a; }
.nt-c svg { width: 100%; height: 100%; overflow: visible; }
.nt-hl { background: rgba(245, 158, 11, 0.25); outline: 1.5px solid #f59e0b; border-radius: 2px; }
`;

/** The smallest a long answer is shrunk to, as a share of the normal size. */
const MIN_SHRINK = 0.55;

/**
 * Lay out what only a browser can: flow each multi-line answer across its lines, and shrink any
 * answer that is wider than its box until it fits. Idempotent — the preview calls it after every
 * change.
 */
export const fitNotice = (root: ParentNode): void => {
  root.querySelectorAll<HTMLElement>('.nt-ml').forEach((source) => {
    const over = source.parentElement;
    if (over === null) return;
    over
      .querySelectorAll(`[data-flow="${source.dataset['box'] ?? ''}"]`)
      .forEach((old) => old.remove());
    const lines = JSON.parse(source.dataset['lines'] ?? '[]') as string[];
    const words = (source.textContent ?? '').split(' ').filter((word) => word !== '');
    const probe = document.createElement('div');
    probe.className = 'nt-s';
    probe.style.visibility = 'hidden';
    over.appendChild(probe);
    let next = 0;
    lines.forEach((style, i) => {
      probe.setAttribute('style', `${style};visibility:hidden`);
      const width = probe.clientWidth;
      let text = '';
      while (next < words.length) {
        const candidate = text === '' ? (words[next] ?? '') : `${text} ${words[next] ?? ''}`;
        probe.textContent = candidate;
        // The last line takes whatever is left, and is shrunk below if it has to be.
        if (probe.scrollWidth > width && text !== '' && i < lines.length - 1) break;
        text = candidate;
        next += 1;
      }
      if (text === '') return;
      const line = document.createElement('div');
      line.className = `nt-s nt-fit${source.classList.contains('nt-hl') ? ' nt-hl' : ''}`;
      line.dataset['flow'] = source.dataset['box'] ?? '';
      line.setAttribute('style', style);
      line.textContent = text;
      over.appendChild(line);
    });
    probe.remove();
  });
  root.querySelectorAll<HTMLElement>('.nt-fit').forEach((element) => {
    const page = element.closest('.nt-page');
    const pageWidth = page instanceof HTMLElement ? page.clientWidth : 0;
    if (pageWidth === 0) return;
    element.style.fontSize = '';
    const base = parseFloat(getComputedStyle(element).fontSize);
    let size = base;
    while (element.scrollWidth > element.clientWidth + 0.5 && size > base * MIN_SHRINK) {
      size -= base * 0.03;
      element.style.fontSize = `${((size / pageWidth) * 100).toFixed(3)}cqw`;
    }
  });
};

/**
 * Print the pages exactly as the preview laid them out.
 *
 * `pages` are the preview's own fitted page elements. They are copied rather than re-rendered so
 * no second layout can disagree with the one on screen; the highlight of the box being typed in
 * is taken off, and the scans' addresses are made absolute because the print window has no page
 * address of its own to resolve them against. `blank` leaves the form off the paper and prints
 * the answers alone — for feeding the insurer's own printed form through the printer.
 *
 * Throws when the browser refuses the window, so the caller can say so.
 */
export const printNoticePages = (
  pages: readonly HTMLElement[],
  title: string,
  blank: boolean,
): void => {
  const copies = pages.map((page) => {
    const copy = page.cloneNode(true) as HTMLElement;
    copy.classList.toggle('nt-blank', blank);
    copy.querySelectorAll('.nt-hl').forEach((element) => element.classList.remove('nt-hl'));
    copy.querySelectorAll('img').forEach((img) => {
      img.setAttribute('src', new URL(img.getAttribute('src') ?? '', window.location.href).href);
    });
    copy.removeAttribute('style');
    return copy.outerHTML;
  });
  // No script in the page: the tab inherits the app's Content-Security-Policy, which never runs
  // one. The dialog opens from the app's own script once every scan has decoded, with the same
  // timer behind it (`shared/lib/print-window.ts`).
  const html = `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8" /><title>${esc(title)}</title>
<style>
${NOTICE_CSS}
@page { size: A4 portrait; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans Arabic', Arial, sans-serif; }
.nt-page { width: 210mm; }
.nt-page + .nt-page { break-before: page; page-break-before: always; }
</style></head>
<body>${copies.join('')}
</body></html>`;
  if (openPrintDocument(html, { readyTimeoutMs: 2500 }) === null) throw new Error('popup blocked');
};
