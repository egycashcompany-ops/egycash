// «إقرار استلام كارنيه» — the A4 paper the employee signs when HR hands over the printed card.
//
// Arabic whatever the screen's language, like the card. The EGYCASH logo heads it, the details are
// the card's own (the copy number is the print just recorded, so the paper names the card it is
// for), a picture of the card's front is on it, and the only signature is the receiver's.
//
// Pure HTML — no React — printed by `printHtml` from its own frame.
import { toArabicDigits } from './card-render';

export interface CardReceipt {
  name: string;
  code: string;
  employeeNumber: string;
  nationalId: string;
  jobTitle: string;
  branch: string;
  department: string;
  /** Which card this is for the person: 1 for the first, 2 for the second, … */
  copyNumber: number;
  issuedAt: Date;
  /** The card's front as printed, a data URL. */
  cardImage: string | null;
}

export const RECEIPT_LOGO = '/id-card/egycash-logo.png';

const ORDINALS = [
  'الأول',
  'الثاني',
  'الثالث',
  'الرابع',
  'الخامس',
  'السادس',
  'السابع',
  'الثامن',
  'التاسع',
  'العاشر',
];

/** «الأول» … «العاشر», then the number itself. */
export const copyLabel = (n: number): string =>
  ORDINALS[n - 1] ?? `رقم ${toArabicDigits(String(n))}`;

const escape = (text: string): string =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

const dash = (text: string): string => (text.trim() === '' ? '—' : escape(text));

const dateOf = (date: Date): string =>
  toArabicDigits(
    `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`,
  );

export const RECEIPT_STYLE = `
@page { size: A4; margin: 12mm 15mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; color: #111; }
body { font-family: 'Times New Roman', 'Traditional Arabic', 'Arial', serif; font-size: 12.5pt; line-height: 1.6;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.sheet { display: flex; flex-direction: column; min-height: calc(297mm - 24mm); }
.head { text-align: center; padding-bottom: 3mm; border-bottom: 1.2mm solid #222566; position: relative; }
.head::after { content: ''; position: absolute; inset-inline: 0; bottom: -2.4mm; border-bottom: 0.4mm solid #5d60a9; }
.head img { height: 18mm; width: auto; }
.meta { display: flex; justify-content: space-between; margin-top: 6mm; font-size: 11pt; color: #333; }
h1 { text-align: center; font-size: 20pt; margin: 3mm 0 0; color: #222566; letter-spacing: 0.2mm; }
.sub { text-align: center; font-size: 11pt; color: #5d60a9; margin: 0 0 4mm; }
.top { display: flex; gap: 6mm; align-items: stretch; }
table { flex: 1; border-collapse: collapse; font-size: 11.5pt; }
th, td { border: 0.3mm solid #b9bbd8; padding: 1mm 3mm; text-align: start; vertical-align: middle; }
th { background: #eef0fb; color: #222566; width: 32%; font-weight: bold; white-space: nowrap; }
td.num { direction: ltr; text-align: end; unicode-bidi: plaintext; font-weight: bold; letter-spacing: 0.3mm; }
.card { width: 64mm; display: flex; flex-direction: column; align-items: center; justify-content: center;
  border: 0.3mm dashed #b9bbd8; border-radius: 2mm; padding: 2mm; font-size: 10pt; color: #555; }
.card img { width: 58mm; height: auto; border-radius: 1.6mm; box-shadow: 0 0 0 0.3mm #ccc; }
.body { margin-top: 5mm; text-align: justify; }
ol { margin: 2mm 0 0; padding-inline-start: 7mm; }
li { margin-bottom: 0.5mm; }
.sign { margin-top: auto; display: flex; gap: 8mm; align-items: flex-end; padding-top: 6mm; }
.lines { flex: 1; }
.line { display: flex; align-items: flex-end; gap: 3mm; margin-bottom: 5mm; }
.line b { white-space: nowrap; color: #222566; }
.line span { flex: 1; border-bottom: 0.3mm dotted #444; min-height: 8mm; padding-inline-start: 2mm; }
.thumb { width: 26mm; height: 30mm; border: 0.3mm solid #444; border-radius: 1.5mm; display: flex;
  align-items: flex-end; justify-content: center; font-size: 10pt; color: #666; padding-bottom: 1.5mm; }
.foot { margin-top: 3mm; padding-top: 2mm; border-top: 0.3mm solid #b9bbd8; display: flex;
  justify-content: space-between; font-size: 9.5pt; color: #777; }
`;

/** The receipt's body: everything inside `<body>`. */
export const receiptHtml = (r: CardReceipt): string => {
  const ref = `${r.code}-${String(r.copyNumber)}`;
  return `<div class="sheet">
  <div class="head"><img src="${RECEIPT_LOGO}" alt="EGYCASH"></div>
  <div class="meta"><span>رقم الإقرار: <b dir="ltr">${escape(ref)}</b></span><span>التاريخ: <b>${dateOf(r.issuedAt)}</b></span></div>
  <h1>إقرار استلام كارنيه الشركة</h1>
  <p class="sub">إدارة الموارد البشرية</p>
  <div class="top">
    <table>
      <tr><th>الاسم</th><td><b>${dash(r.name)}</b></td></tr>
      <tr><th>كود الموظف</th><td class="num">${dash(r.code)}</td></tr>
      <tr><th>الرقم الوظيفي</th><td class="num">${dash(toArabicDigits(r.employeeNumber))}</td></tr>
      <tr><th>الرقم القومي</th><td class="num">${dash(toArabicDigits(r.nationalId))}</td></tr>
      <tr><th>الوظيفة</th><td>${dash(r.jobTitle)}</td></tr>
      <tr><th>الفرع</th><td>${dash(r.branch)}</td></tr>
      <tr><th>الإدارة</th><td>${dash(r.department)}</td></tr>
      <tr><th>الكارنيه</th><td>الإصدار ${copyLabel(r.copyNumber)}</td></tr>
    </table>
    ${r.cardImage === null ? '' : `<div class="card"><img src="${r.cardImage}" alt=""><div>صورة الكارنيه المُسلَّم</div></div>`}
  </div>
  <div class="body">
    أقر أنا الموقع أدناه / <b>${dash(r.name)}</b> بأنني استلمت من إدارة الموارد البشرية بشركة إيجي كاش
    كارنيه الشركة الخاص بي (الإصدار ${copyLabel(r.copyNumber)}) بحالة سليمة، وأتعهد بما يلي:
    <ol>
      <li>المحافظة على الكارنيه وعدم إعارته أو تسليمه للغير تحت أي ظرف.</li>
      <li>استخدامه في أغراض العمل فقط، وإبرازه عند الطلب داخل مقار الشركة ومواقع العمل.</li>
      <li>إبلاغ إدارة الموارد البشرية فوراً في حالة فقده أو تلفه، وتحمل تكلفة إصدار البديل وفقاً للوائح الشركة.</li>
      <li>رد الكارنيه إلى إدارة الموارد البشرية عند انتهاء العلاقة التعاقدية مع الشركة لأي سبب.</li>
    </ol>
    وهذا إقرار مني بذلك، وأتحمل المسئولية كاملة في حالة مخالفة ما سبق.
  </div>
  <div class="sign">
    <div class="lines">
      <div class="line"><b>المُقِر بما فيه:</b><span>${dash(r.name)}</span></div>
      <div class="line"><b>التوقيع:</b><span></span></div>
      <div class="line"><b>تاريخ الاستلام:</b><span></span></div>
    </div>
    <div class="thumb">البصمة</div>
  </div>
  <div class="foot"><span>إيجي كاش — إدارة الموارد البشرية</span><span dir="ltr">${escape(ref)}</span></div>
</div>`;
};
