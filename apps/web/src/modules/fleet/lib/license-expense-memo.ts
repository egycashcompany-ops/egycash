// «مصروفات التراخيص»: the licensing-expenses memo, built once as a sheet of HTML so the editor's
// live preview and the printed page are the same document — the owner's Excel memo, line for
// line: the title, the plates, what was paid by the traffic department's card, what was paid in
// cash, the totals, and the signatures.

/** Which memo: a licence renewal, or an extension of a licence's term. */
export type LicenseExpenseKind = 'renewal' | 'extension';

/** How one expense was paid — by the traffic department's card, or in cash. */
export type LicenseExpensePaidBy = 'visa' | 'cash';

export interface LicenseExpenseVehicleLine {
  vehicleId: string | null;
  code: string | null;
  plate: string;
}

export interface LicenseExpenseItemLine {
  key: string;
  /** The catalog entry it was picked from, when it was — `null` for a hand-written one. */
  itemId: string | null;
  label: string;
  amount: number | null;
  count: number;
  paidBy: LicenseExpensePaidBy;
  /** «متوافر إيصال» when true, «لا يوجد» when false. */
  receipt: boolean;
}

export interface LicenseExpenseSignatures {
  /** مندوب التراخيص */
  agent: string;
  /** مدير إدارة الحركة */
  director: string;
  /** The general manager's block, several lines. */
  generalManager: string;
}

export interface LicenseExpenseMemoDoc {
  kind: LicenseExpenseKind;
  /** `yyyy-mm-dd` */
  date: string;
  vehicles: readonly LicenseExpenseVehicleLine[];
  items: readonly LicenseExpenseItemLine[];
  signatures: LicenseExpenseSignatures;
}

const MONTHS = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
];

/** «٥ سيارات» / «١٣ سيارة» — the count and its noun as Arabic counts them. */
export const carsPhrase = (n: number): string => {
  if (n === 1) return 'سيارة واحدة';
  if (n === 2) return 'سيارتين';
  if (n >= 3 && n <= 10) return `${n} سيارات`;
  return `${n} سيارة`;
};

/** The memo's title, written the way the department writes it. */
export const memoTitle = (
  doc: Pick<LicenseExpenseMemoDoc, 'kind' | 'date' | 'vehicles'>,
): string => {
  const what = doc.kind === 'renewal' ? 'تجديد تراخيص' : 'مد مدة';
  const [y, m, d] = doc.date.split('-');
  const month = MONTHS[Number(m) - 1] ?? '';
  const when = y === undefined || m === undefined || d === undefined ? '' : `${y}/${m}/${d}`;
  return `مذكرة بمصروفات ${what} ${carsPhrase(doc.vehicles.length)} شهر ${month} ${when}`.trim();
};

export const lineTotal = (item: LicenseExpenseItemLine): number => (item.amount ?? 0) * item.count;

export const sumOf = (items: readonly LicenseExpenseItemLine[]): number =>
  items.reduce((sum, item) => sum + lineTotal(item), 0);

export const money = (value: number): string =>
  value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const escape = (text: string): string =>
  text
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');

const table = (
  heading: string,
  items: readonly LicenseExpenseItemLine[],
  minRows: number,
): string => {
  const rows = items
    .map(
      (item, index) => `<tr>
        <td>${index + 1}</td>
        <td class="label">${escape(item.label)}</td>
        <td class="num">${item.amount === null ? '' : money(item.amount)}</td>
        <td class="num">${item.count}</td>
        <td class="num">${item.amount === null ? '' : money(lineTotal(item))}</td>
        <td>${item.receipt ? 'متوافر إيصال' : 'لا يوجد'}</td>
      </tr>`,
    )
    .join('');
  const blanks = Array.from(
    { length: Math.max(0, minRows - items.length) },
    (_, index) =>
      `<tr class="blank"><td>${items.length + index + 1}</td><td></td><td></td><td></td><td></td><td></td></tr>`,
  ).join('');
  return `<div class="section">${escape(heading)}</div>
    <table class="lx-grid">
      <thead><tr><th class="n">م</th><th>البيان</th><th>القيمة</th><th class="n">العدد</th><th>الإجمالي</th><th>ملاحظات</th></tr></thead>
      <tbody>${rows}${blanks}</tbody>
      <tfoot><tr><td colspan="4" class="total-label">الإجمالي النهائي</td><td colspan="2" class="num total">${money(sumOf(items))}</td></tr></tfoot>
    </table>`;
};

/** The memo as one A4 sheet — styles and body together, for the preview and for the printer. */
export const memoHtml = (doc: LicenseExpenseMemoDoc): string => {
  const visa = doc.items.filter((item) => item.paidBy === 'visa');
  const cash = doc.items.filter((item) => item.paidBy === 'cash');
  const plates = doc.vehicles
    .map((v, index) => `<tr><td>${index + 1}</td><td>${escape(v.plate)}</td></tr>`)
    .join('');
  // The renewal memo carries both tables, as the department's sheet does; the extension memo
  // carries the cash one, and the card's only when something was paid by it.
  const withVisa = doc.kind === 'renewal' || visa.length > 0;
  const gm = escape(doc.signatures.generalManager).replace(/\n/gu, '<br/>');
  return `<style>
    .lx-sheet{font-family:'Cairo','Segoe UI',Tahoma,sans-serif;direction:rtl;color:#000;background:#fff;width:210mm;min-height:297mm;box-sizing:border-box;padding:14mm 14mm 12mm;font-size:12.5px;line-height:1.45}
    .lx-sheet .title{text-align:center;font-weight:800;font-size:16px;margin:2mm 0 6mm;text-decoration:underline;text-underline-offset:4px}
    .lx-sheet table{border-collapse:collapse}
    .lx-sheet .plates{margin:0 auto 6mm;min-width:70mm}
    .lx-sheet .plates th,.lx-sheet .plates td{border:1px solid #000;padding:2px 10px;text-align:center}
    .lx-sheet .plates th{background:#d9e1f2}
    .lx-sheet .section{font-weight:800;text-align:center;margin:5mm 0 2mm;background:#fce4d6;border:1px solid #000;padding:3px}
    .lx-sheet .lx-grid{width:100%}
    .lx-sheet .lx-grid th,.lx-sheet .lx-grid td{border:1px solid #000;padding:2px 6px;text-align:center;height:18px}
    .lx-sheet .lx-grid th{background:#d9e1f2;font-weight:800}
    .lx-sheet .lx-grid .n{width:9mm}
    .lx-sheet .lx-grid .label{text-align:right}
    .lx-sheet .num{font-variant-numeric:tabular-nums;direction:ltr}
    .lx-sheet .total-label{font-weight:800;background:#f2f2f2}
    .lx-sheet .total{font-weight:800;background:#f2f2f2}
    .lx-sheet .grand{margin:6mm auto 0;width:70%}
    .lx-sheet .grand td{border:1px solid #000;padding:4px 8px;font-weight:800;text-align:center}
    .lx-sheet .grand .num{background:#fff2cc}
    .lx-sheet .signs{display:flex;justify-content:space-between;margin-top:9mm;text-align:center;font-weight:700}
    .lx-sheet .signs div{min-width:60mm}
    .lx-sheet .signs .line{margin-top:7mm;font-weight:400}
    .lx-sheet .review{text-align:center;font-weight:800;margin-top:9mm}
    .lx-sheet .gm{text-align:center;font-weight:800;margin-top:12mm;line-height:1.8}
    @media print{@page{size:A4;margin:0}body{margin:0}.lx-sheet{width:210mm;height:297mm;break-inside:avoid}}
  </style>
  <div class="lx-sheet">
    <div class="title">${escape(memoTitle(doc))}</div>
    <table class="plates"><thead><tr><th>م</th><th>رقم اللوحة</th></tr></thead><tbody>${plates}</tbody></table>
    ${withVisa ? table('بيانات مصروفات ترخيص السيارات (ما تم صرفه بفيزا إدارة الحركة)', visa, 3) : ''}
    ${table('بيانات مصروفات ترخيص السيارات (تم صرفه نقدًا)', cash, 3)}
    <table class="grand"><tr><td>الإجمالي النهائي لمصروفات الفيزا والنقدي</td><td class="num">${money(sumOf(doc.items))}</td></tr></table>
    <div class="signs">
      <div>مندوب التراخيص<br/>${escape(doc.signatures.agent)}<div class="line">التوقيع</div></div>
      <div>مدير إدارة الحركة<br/>${escape(doc.signatures.director)}<div class="line">التوقيع</div></div>
    </div>
    <div class="review">يرجى المراجعة والتصديق على إجمالي المصروفات</div>
    <div class="gm">${gm}</div>
  </div>`;
};

/**
 * Print the memos, one to a page — «مد مده لوحده او تجديد ترخيص لوحده او الاتنين»: a renewal and an
 * extension written together print as the department's two sheets. Throws when the browser blocks
 * the window.
 */
export const printMemos = (docs: readonly LicenseExpenseMemoDoc[]): void => {
  if (docs.length === 0) return;
  const win = window.open('', '_blank');
  if (win === null) throw new Error('popup blocked');
  win.document.write(
    `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${escape(
      docs.map(memoTitle).join(' — '),
    )}</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;800&display=swap"><style>@media print{.lx-sheet{page-break-after:always}.lx-sheet:last-of-type{page-break-after:auto}}</style></head><body style="margin:0">${docs
      .map(memoHtml)
      .join(
        '',
      )}<script>document.fonts.ready.then(function(){setTimeout(function(){window.print()},150)})</script></body></html>`,
  );
  win.document.close();
};

/** The department's names as the samples carry them — the settings start from these. */
export const DEFAULT_SIGNATURES: LicenseExpenseSignatures = {
  agent: 'طلعت جابر بحيري',
  director: 'عميد / إيهاب عبد السلام',
  generalManager:
    'لواء أ ح / جمال أحمد أبو إسماعيل\nالمدير العام التنفيذي\nشركة النيل لنقل الأموال (إيجي كاش)',
};

/** One kind's half of a saved record: its cars and its expenses. */
export interface LicenseExpensePart {
  vehicles: LicenseExpenseVehicleLine[];
  items: LicenseExpenseItemLine[];
}

/**
 * One saved record — a renewal, an extension, or both written on the same day. Each kind present
 * is its own memo on paper.
 */
export interface LicenseExpenseMemoRow {
  id: string;
  date: string;
  renewal: LicenseExpensePart | null;
  extension: LicenseExpensePart | null;
  signatures: LicenseExpenseSignatures;
  createdAt: string;
  updatedAt: string;
}

/** The memos a record prints as — the renewal first, as the department files them. */
export const memosOf = (
  row: Pick<LicenseExpenseMemoRow, 'date' | 'renewal' | 'extension' | 'signatures'>,
): LicenseExpenseMemoDoc[] =>
  (['renewal', 'extension'] as const).flatMap((kind) => {
    const part = row[kind];
    return part === null ? [] : [{ kind, date: row.date, signatures: row.signatures, ...part }];
  });
