// Printed output — receipts, the drawer-inventory minutes and the monthly statements.
//
// Ported from the gold system's `lib/print.js` essentially unchanged, and DELIBERATELY not
// restyled. The app's chrome is now the ECMS theme; these are not chrome. Each function renders a
// standalone document in a new window: EGYCASH letterhead, the company's own indigo, the signature
// blocks the business signs, in the wording it has always used. Re-theming a document people file
// in a binder would be changing the record, not the interface.
//
// They are self-contained HTML on purpose — independent of the app's stylesheet, so what prints is
// what the page says and nothing the shell contributes.
import { EGYCASH_LOGO } from './egycash-logo';

const BRAND = {
  primary: '#2e2e74',
  primaryDark: '#23234f',
  tintHead: '#e9e9f7',
  tintTotal: '#d7d7f0',
  text: '#1f2340',
  muted: '#6b6f86',
  line: '#d4d5ea',
} as const;

/** Escape anything that came from the database before it lands inside the document's markup. */
const esc = (value: unknown): string =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const stamp = (): { weekday: string; date: string } => {
  const d = new Date();
  return {
    weekday: d.toLocaleDateString('ar-EG', { weekday: 'long' }),
    date: `${String(d.getFullYear())}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`,
  };
};

/**
 * The tiny script each generated document carries, so it prints once the fonts and the logo have
 * loaded rather than mid-render.
 *
 * The closing tag is assembled from two pieces on purpose: writing the literal `</script>` inside
 * this module would end the tag early if the bundle were ever inlined into an HTML page.
 */
const PRINT_ON_LOAD = `<script>window.onload = () => { window.print(); };</${'script'}>`;

const FONTS =
  "@import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&family=Tajawal:wght@400;500;700&display=swap');";

/**
 * The company block every gold document opens with.
 *
 * `subtitle` takes one line or several — the drawer-audit minutes name the department on its own
 * line above the vault, which is how gold printed it and how the signed copies read.
 */
const letterhead = (branch: string, subtitle: string | string[], withDate: boolean): string => {
  const { weekday, date } = stamp();
  const lines = (Array.isArray(subtitle) ? subtitle : [subtitle])
    .map((line) => `<div>${esc(line)}</div>`)
    .join('');
  return `<div class="head">
      <div class="org"><div class="b">ايجى كاش للحلول النقدية</div>${lines}${
        branch === '' ? '' : `<div>فرع : <span class="b">${esc(branch)}</span></div>`
      }${withDate ? `<div>التاريخ : <span class="b">${esc(weekday)} ${esc(date)}</span></div>` : ''}</div>
      <img src="${EGYCASH_LOGO}" alt="EGYCASH" />
    </div>`;
};

/** Open the rendered document in its own window. Returns false when the popup was blocked. */
const openDocument = (html: string, features?: string): boolean => {
  const w = window.open('', '_blank', features);
  if (w === null) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
};

export interface PrintTable {
  head: string[];
  rows: (string | number)[][];
  total?: (string | number)[];
}

/**
 * A receipt — عمليات الدخول / الخروج / التحويل and the key-handover slip.
 * Header key/value pairs, an optional line-item table, three signature blocks, a footer note.
 */
export const printReceiptHtml = ({
  title,
  number,
  meta = [],
  table,
  footer = '',
  branch = '',
}: {
  title: string;
  number: string;
  meta?: [string, string][];
  table?: PrintTable;
  footer?: string;
  branch?: string;
}): boolean => {
  const metaHtml =
    meta.length === 0
      ? ''
      : `<div class="meta">${meta
          .map(
            ([k, v]) =>
              `<div class="cell"><span class="k">${esc(k)}</span><span class="v">${esc(v === '' ? '—' : v)}</span></div>`,
          )
          .join('')}</div>`;
  const tableHtml =
    table === undefined
      ? ''
      : `<table class="data"><thead><tr>${table.head
          .map((h) => `<th>${esc(h)}</th>`)
          .join('')}</tr></thead><tbody>${table.rows
          .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`;

  return openDocument(
    `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8" />
  <title>${esc(title)} ${esc(number)}</title>
  <style>
    ${FONTS}
    * { box-sizing:border-box; }
    body { font-family:Tajawal, sans-serif; color:${BRAND.text}; padding:34px 40px; }
    .head { display:flex; align-items:center; justify-content:space-between; gap:20px; border-bottom:3px solid ${BRAND.primary}; padding-bottom:14px; }
    .head img { height:54px; }
    .org { text-align:right; font-size:12.5px; line-height:1.75; color:${BRAND.text}; min-width:190px; }
    .org .b { font-weight:700; }
    .rtitle { text-align:center; margin:18px 0 6px; }
    .rtitle h1 { font-family:Cairo; font-weight:800; font-size:21px; color:${BRAND.primary}; margin:0; }
    .rtitle .sub { font-size:13px; color:${BRAND.muted}; margin-top:3px; font-weight:600; }
    .meta { display:grid; grid-template-columns:1fr 1fr; gap:0 28px; margin:16px 0 6px; }
    .meta .cell { display:flex; justify-content:space-between; gap:10px; padding:7px 2px; border-bottom:1px solid ${BRAND.line}; font-size:13px; }
    .meta .k { color:${BRAND.muted}; }
    .meta .v { font-weight:700; color:${BRAND.text}; }
    table.data { width:100%; border-collapse:collapse; margin-top:14px; }
    table.data th { background:${BRAND.tintHead}; color:${BRAND.primaryDark}; font-family:Cairo; font-weight:700; font-size:13px; padding:10px 8px; border:1px solid ${BRAND.line}; text-align:center; }
    table.data td { padding:8px; font-size:12.5px; border:1px solid ${BRAND.line}; text-align:center; color:${BRAND.text}; }
    table.data tbody tr:nth-child(even) td { background:#fafaff; }
    .sign { margin-top:52px; display:flex; justify-content:space-between; gap:24px; }
    .sign div { flex:1; text-align:center; border-top:1px solid #a9abc4; padding-top:8px; font-size:12.5px; color:${BRAND.text}; }
    .foot { margin-top:22px; text-align:center; color:${BRAND.muted}; font-size:12px; }
    @media print { body { padding:8px 12px; } }
  </style></head>
  <body>
    ${letterhead(branch, 'خزينة المعادن الثمينة', true)}
    <div class="rtitle"><h1>${esc(title)}</h1>${number === '' ? '' : `<div class="sub">رقم : ${esc(number)}</div>`}</div>
    ${metaHtml}
    ${tableHtml}
    <div class="sign"><div>أمين الخزينة</div><div>المندوب</div><div>المشرف</div></div>
    ${footer === '' ? '' : `<div class="foot">${esc(footer)}</div>`}
    ${PRINT_ON_LOAD}
  </body></html>`,
    'width=900,height=1000',
  );
};

/** A branded statement — the balances, control and movement reports. */
export const printReportHtml = ({
  title,
  subtitle = '',
  branch = '',
  note = '',
  table,
  signature = '',
}: {
  title: string;
  subtitle?: string;
  branch?: string;
  note?: string;
  table?: PrintTable;
  /** Raw, trusted markup for the signature block — built by the caller from literals only. */
  signature?: string;
}): boolean => {
  const headHtml =
    table === undefined ? '' : `<tr>${table.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>`;
  const bodyHtml =
    table === undefined
      ? ''
      : table.rows
          .map(
            (r) =>
              `<tr>${r.map((c, i) => `<td class="${i === 1 ? 'name' : ''}">${esc(c)}</td>`).join('')}</tr>`,
          )
          .join('');
  const totalHtml =
    table?.total === undefined
      ? ''
      : `<tr class="total">${table.total.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`;

  return openDocument(
    `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8" />
  <title>${esc(title)}</title>
  <style>
    ${FONTS}
    * { box-sizing: border-box; }
    body { font-family: Tajawal, sans-serif; color:${BRAND.text}; padding:34px 40px; }
    .head { display:flex; align-items:center; justify-content:space-between; gap:20px; border-bottom:3px solid ${BRAND.primary}; padding-bottom:14px; }
    .head img { height:54px; }
    .org { text-align:right; font-size:12.5px; line-height:1.75; color:${BRAND.text}; min-width:190px; }
    .org .b { font-weight:700; }
    .rtitle { text-align:center; margin:18px 0 2px; }
    .rtitle h1 { font-family:Cairo; font-weight:800; font-size:21px; color:${BRAND.primary}; margin:0; }
    .rtitle .sub { font-family:Cairo; font-weight:700; font-size:15px; color:${BRAND.text}; margin-top:4px; }
    .note { margin:18px 2px 4px; font-size:13px; color:${BRAND.muted}; font-weight:600; }
    table.data { width:100%; border-collapse:collapse; margin-top:14px; }
    table.data th { background:${BRAND.tintHead}; color:${BRAND.primaryDark}; font-family:Cairo; font-weight:700; font-size:13px; padding:11px 8px; border:1px solid ${BRAND.line}; text-align:center; }
    table.data td { padding:9px 8px; font-size:13px; border:1px solid ${BRAND.line}; text-align:center; color:${BRAND.text}; }
    table.data td.name { font-weight:600; }
    table.data tbody tr:nth-child(even) td { background:#fafaff; }
    table.data tr.total td { background:${BRAND.tintTotal}; color:${BRAND.primaryDark}; font-family:Cairo; font-weight:700; font-size:13.5px; }
    .sign { margin-top:50px; font-size:13px; }
    .sign .line { color:${BRAND.muted}; }
    .sign .who { font-weight:700; margin-top:36px; color:${BRAND.text}; }
    @media print { body { padding:6px 10px; } }
  </style></head>
  <body>
    ${letterhead(branch, 'خزينة المعادن الثمينة', true)}
    <div class="rtitle"><h1>${esc(title)}</h1>${subtitle === '' ? '' : `<div class="sub">${esc(subtitle)}</div>`}</div>
    ${note === '' ? '' : `<div class="note">${esc(note)}</div>`}
    ${table === undefined ? '' : `<table class="data"><thead>${headHtml}</thead><tbody>${bodyHtml}</tbody><tfoot>${totalHtml}</tfoot></table>`}
    ${signature === '' ? '' : `<div class="sign">${signature}</div>`}
    ${PRINT_ON_LOAD}
  </body></html>`,
    'width=900,height=1000',
  );
};

export interface DrawerAuditBar {
  metalType: string;
  weight: number;
}

/**
 * محضر جرد درج — the minutes signed when a drawer is opened and counted.
 * Opens in a tab rather than printing straight away: it is filled in by hand before it is printed.
 */
export const printDrawerAuditHtml = ({
  drawerNumber,
  company = '',
  branch = '',
  bars = [],
  metalLabel,
}: {
  drawerNumber: number | null;
  company?: string;
  branch?: string;
  bars?: DrawerAuditBar[];
  metalLabel: (metal: string) => string;
}): boolean => {
  const { weekday, date } = stamp();
  const fmt = (n: number): string =>
    Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Identical bars are counted together — the minutes record "12 × 100g gold", not twelve lines.
  const groups = new Map<string, { metalType: string; weight: number; count: number }>();
  for (const bar of bars) {
    const key = `${bar.metalType}|${String(bar.weight)}`;
    const entry = groups.get(key) ?? { metalType: bar.metalType, weight: bar.weight, count: 0 };
    entry.count += 1;
    groups.set(key, entry);
  }
  const sorted = [...groups.values()].sort((a, b) =>
    a.metalType === b.metalType ? b.weight - a.weight : a.metalType.localeCompare(b.metalType),
  );
  const totalCount = bars.length;
  const totalWeight = bars.reduce((sum, bar) => sum + bar.weight, 0);
  const owner = company.trim() === '' ? '..........................' : company;
  const bodyRows =
    sorted.length === 0
      ? '<tr><td colspan="4" style="text-align:center;color:#999;padding:14px">الدرج فارغ</td></tr>'
      : sorted
          .map(
            (g) =>
              `<tr><td>${esc(metalLabel(g.metalType))}</td><td>${fmt(g.weight)}</td><td>${String(g.count)}</td><td>${fmt(g.weight * g.count)}</td></tr>`,
          )
          .join('');
  const dots = (n: number): string => '.'.repeat(n);

  return openDocument(
    `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8" /><title>محضر جرد درج ${esc(drawerNumber)}</title>
  <style>
    ${FONTS}
    * { box-sizing:border-box; }
    body { font-family:Tajawal, sans-serif; color:${BRAND.text}; padding:34px 44px; }
    .printbtn { position:fixed; top:14px; left:14px; background:${BRAND.primary}; color:#fff; border:0; border-radius:10px; padding:9px 16px; font-family:Tajawal; font-size:14px; cursor:pointer; box-shadow:0 4px 14px rgba(46,46,116,.3); }
    .head { display:flex; align-items:center; justify-content:space-between; gap:20px; border-bottom:3px solid ${BRAND.primary}; padding-bottom:14px; }
    .head img { height:54px; }
    .org { text-align:right; font-size:12.5px; line-height:1.75; color:${BRAND.text}; min-width:190px; }
    .org .b { font-weight:700; }
    .rtitle { text-align:center; margin:20px 0 10px; }
    .rtitle h1 { font-family:Cairo; font-weight:800; font-size:21px; color:${BRAND.primary}; margin:0; }
    .body { font-size:14px; line-height:2.1; }
    table.data { width:100%; border-collapse:collapse; margin-top:16px; }
    table.data th { background:${BRAND.tintHead}; color:${BRAND.primaryDark}; font-family:Cairo; font-weight:700; font-size:13px; padding:10px 8px; border:1px solid ${BRAND.line}; text-align:center; }
    table.data td { padding:9px 8px; font-size:13px; border:1px solid ${BRAND.line}; text-align:center; }
    table.data tr.total td { background:${BRAND.tintTotal}; color:${BRAND.primaryDark}; font-family:Cairo; font-weight:700; }
    .notes { margin-top:22px; font-size:13.5px; color:${BRAND.muted}; }
    .sigs { margin-top:30px; }
    .sigrow { display:flex; justify-content:space-between; gap:30px; margin-top:34px; font-size:13.5px; }
    @media print { .printbtn { display:none; } body { padding:8px 14px; } }
  </style></head>
  <body>
    <button class="printbtn" onclick="window.print()">طباعة المحضر 🖨️</button>
    ${letterhead(branch, ['ادارة الخزينة', 'خزينة المعادن الثمينة'], false)}
    <div class="rtitle"><h1>محضر جرد درج</h1></div>
    <div class="body">
      <p>انه فى يوم ${esc(weekday)} الموافق ${esc(date)}</p>
      <p>- تم فتح <b>الدرج رقم: ${esc(drawerNumber)}</b> الخاص بـ <b>${esc(owner)}</b> لاجراء عملية الجرد</p>
      <p>بواسطة السيد مفوض <b>${esc(owner)}</b></p>
      <p>وبناءً عليه تم جرد محتوى الدرج</p>
      <p>وبيان محتوى الدرج كالتالى :</p>
    </div>
    <table class="data">
      <thead><tr><th>نوع السبائك</th><th>وزن السبيكة</th><th>عدد السبائك</th><th>إجمالي الوزن</th></tr></thead>
      <tbody>${bodyRows}</tbody>
      <tfoot><tr class="total"><td colspan="2">اجمالى رصيد الدرج</td><td>${String(totalCount)} سبيكة</td><td>${fmt(totalWeight)} جرام</td></tr></tfoot>
    </table>
    <div class="notes">ملاحظات الجرد : ${dots(80)}</div>
    <div class="sigs">
      <div class="sigrow"><span>مفوض ${esc(owner)} أ /${dots(22)}</span><span>التوقيع / ${dots(22)}</span></div>
      <div class="sigrow"><span>مشرف الخزينة أ /${dots(22)}</span><span>التوقيع / ${dots(22)}</span></div>
    </div>
  </body></html>`,
  );
};

export interface ClosingRow {
  year: number;
  month: number;
  inCount: number;
  outCount: number;
  inWeight: number;
  outWeight: number;
  netWeight: number;
  balanceCount: number;
  balanceWeight: number;
}

/** تقرير الإقفال الشهرى — one fund per printed page. */
export const printFundClosingHtml = ({
  title = 'تقرير الإقفال الشهرى',
  branch = '',
  metalLabel = '',
  funds = [],
}: {
  title?: string;
  branch?: string;
  metalLabel?: string;
  funds?: { name: string; rows: ClosingRow[] }[];
}): boolean => {
  const nf = (n: number): string =>
    Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const head = letterhead(branch, 'خزينة المعادن الثمينة', true);
  const pages =
    funds.length === 0
      ? `<section class="page">${head}<div class="rtitle"><h1>${esc(title)}</h1></div><p style="text-align:center;margin-top:40px;color:${BRAND.muted}">لا توجد صناديق</p></section>`
      : funds
          .map((fund) => {
            const body = fund.rows
              .map((r) => {
                const colour = r.netWeight > 0 ? '#1a7f37' : '#b42318';
                return `<tr>
        <td class="name">${String(r.year)}-${String(r.month).padStart(2, '0')}</td>
        <td>${String(r.inCount)}</td><td>${String(r.outCount)}</td>
        <td>${nf(r.inWeight)}</td><td>${nf(r.outWeight)}</td>
        <td style="color:${colour};font-weight:700">${nf(r.netWeight)}</td>
        <td>${String(r.balanceCount)}</td><td>${nf(r.balanceWeight)}</td>
      </tr>`;
              })
              .join('');
            return `<section class="page">
      ${head}
      <div class="rtitle"><h1>${esc(title)}</h1><div class="sub">${metalLabel === '' ? '' : `${esc(metalLabel)} — `}${esc(fund.name)}</div></div>
      <div class="banner">${esc(fund.name)}</div>
      <table class="data">
        <thead><tr><th>الشهر - السنة</th><th>دخول سبائك</th><th>خروج سبائك</th><th>دخول وزن</th><th>خروج وزن</th><th>المعدل بالجرام</th><th>عدد السبائك</th><th>رصيد الاغلاق</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </section>`;
          })
          .join('');

  return openDocument(
    `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8" />
  <title>${esc(title)}</title>
  <style>
    ${FONTS}
    * { box-sizing: border-box; }
    body { font-family: Tajawal, sans-serif; color:${BRAND.text}; padding:34px 40px; }
    .page { break-after: page; }
    .page:last-child { break-after: auto; }
    .head { display:flex; align-items:center; justify-content:space-between; gap:20px; border-bottom:3px solid ${BRAND.primary}; padding-bottom:14px; }
    .head img { height:54px; }
    .org { text-align:right; font-size:12.5px; line-height:1.75; color:${BRAND.text}; min-width:190px; }
    .org .b { font-weight:700; }
    .rtitle { text-align:center; margin:18px 0 2px; }
    .rtitle h1 { font-family:Cairo; font-weight:800; font-size:21px; color:${BRAND.primary}; margin:0; }
    .rtitle .sub { font-family:Cairo; font-weight:700; font-size:15px; color:${BRAND.text}; margin-top:4px; }
    .banner { background:${BRAND.primary}; color:#fff; font-family:Cairo; font-weight:800; font-size:16px; text-align:center; padding:9px; border-radius:8px; margin:14px 0 0; }
    table.data { width:100%; border-collapse:collapse; margin-top:14px; }
    table.data th { background:${BRAND.tintHead}; color:${BRAND.primaryDark}; font-family:Cairo; font-weight:700; font-size:12.5px; padding:10px 6px; border:1px solid ${BRAND.line}; text-align:center; }
    table.data td { padding:8px 6px; font-size:12.5px; border:1px solid ${BRAND.line}; text-align:center; color:${BRAND.text}; }
    table.data td.name { font-weight:700; }
    table.data tbody tr:nth-child(even) td { background:#fafaff; }
    @media print { body { padding:6px 10px; } }
  </style></head>
  <body>
    ${pages}
    ${PRINT_ON_LOAD}
  </body></html>`,
    'width=1000,height=1000',
  );
};
