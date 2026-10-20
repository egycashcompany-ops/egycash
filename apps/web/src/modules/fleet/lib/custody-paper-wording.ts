// HIS PRINTED WORDS — the custody papers' text, word for word, and nothing else.
//
// «عاوز زيهم بالظبط بنفس كل حاجه»: the four Excel memos (كاوتش، وقود، صيانة، غسيل) and the three
// Word letters (استعاضه عهدة، تسويه عهدة، صرف عهدة) print exactly what his own papers print — his
// spelling included («اداره الحركه», «الاجمالى النهائى», «تسويه عهدة», «المأموريه»). This file is
// a record of HIS documents, like a quotation in a comment, so it is listed in `VERBATIM_PAPERS`
// (`scripts/check-formal-arabic.mjs`) and the formal-Arabic check does not correct it: «الاجمالى»
// written «الإجمالي» would print a paper that is not his.
//
// Rules for this file, held by `formal-arabic.spec.ts` and `custody-papers.spec.ts`:
//   · only `export const` strings, string records and the letters' body-sentence functions;
//   · no screen text — everything a SCREEN says about a paper is an i18n key;
//   · every space is his: runs of two, three, four spaces are written out and are significant;
//   · only `lib/custody-paper*.ts` imports it; every other paper file carries no Arabic letter.
import type {
  FleetCustodyLetter,
  FleetCustodySource,
  FleetLicenseExpenseKind,
} from '@ecms/contracts';

// ── The Excel memos ──────────────────────────────────────────────────────────────────────────────

/** The two small lines over his maintenance and fuel sheets. */
export const MEMO_COMPANY = 'شركة إيجي كاش للحلول النقديه';
export const MEMO_DEPT = 'إداره الحركه';

/** His maintenance sheet (the one with no title line — its band stands for one). */
export const MAINTENANCE_WORDS = {
  /** Two spaces before «اليومى», as he typed it. */
  request: 'الرجاء من سيادتكم التكرم بصرف المبالغ الأتية نظير اصلاح و تشغيل السيارات  اليومى',
  band: 'بيان بمصروفات الصيانة',
  heads: ['م', 'البيان', 'الاجمالى', 'ملاحظات'],
  total: 'الاجمالى النهائى',
  grand: 'الاجمالى النهائى للمصروفات',
  sign: 'التوقيع (',
  finalSign: 'التوقيع  /   (',
} as const;

/**
 * His tyres sheet, and the washing one made from it. The title is printed with two trailing
 * underlined spaces — the renderer adds them (`TITLE_TAIL`).
 */
export const TYRES_WORDS = {
  title: { tyres: 'مذكرة بمصروفات الكاوتش', wash: 'مذكرة بمصروفات الغسيل' },
  band: { tyres: 'بيان بمصروفات الكاوتش', wash: 'بيان بمصروفات الغسيل' },
  heads: ['م', 'الكود', 'القيمة'],
  total: 'الاجمالى النهائى',
  sign: 'التوقيع / (',
  finalSign: 'التوقيع  /   (',
} as const;

/** His fuel sheet. Two spaces after «داخلية» in the title. */
export const FUEL_WORDS = {
  title: 'مذكرة داخلية  بمصروفات التمويل',
  heads: ['م', 'الكود', 'التاريخ', 'المبلغ', 'المأموريه', 'ملاحظات'],
  prepSign: 'التوقيع /',
  dirSign: 'التوقيع /  (',
  gmSign: 'التوقيع /    (',
} as const;

/**
 * The name a memo's PDF is saved under when it was given none — his paper's title, as the print
 * window's `<title>` (the maintenance paper has no title line: its band stands for it).
 */
export const MEMO_FILE_NAME: Readonly<Record<FleetCustodySource, string>> = {
  tyres: 'مذكرة بمصروفات الكاوتش',
  fuel: 'مذكرة داخلية بمصروفات التمويل',
  maintenance: 'بيان بمصروفات الصيانة',
  wash: 'مذكرة بمصروفات الغسيل',
};

// ── The Word letters ─────────────────────────────────────────────────────────────────────────────

/** His letterhead's two lines. */
export const LETTER_HEADER = {
  company: 'إيجي كاش للحلول النقدية',
  dept: 'إدارة الحركة',
} as const;

/** Each letter's underlined title — also the name its PDF is saved under. */
export const LETTER_TITLE: Readonly<Record<FleetCustodyLetter, string>> = {
  replenish: 'استعاضه عهدة',
  settle: 'تسويه عهدة',
  charge: 'صرف عهدة',
};

export const LETTER_WORDS = {
  date: 'التاريخ',
  greet: 'تحية طيبة وبعد،',
  close: 'والأمر مفوض لسيادتكم ...',
  /** The charge letter's closing has no comma … */
  regards: 'وتفضلوا بقبول فائق الاحترام',
  /** … the replenish and settle letters' has one. */
  regardsComma: 'وتفضلوا بقبول فائق الاحترام،',
  tableHeads: ['م', 'المذكره', 'القيمه'],
  /** «الاجمالي» on the replenish table, «الاجمالى» on the settle one — as his two letters write it. */
  replenishTotal: 'الاجمالي',
  settleTotal: 'الاجمالى',
} as const;

/**
 * The three signers' «التوقيع» lines: the first with his eight leading spaces and 27 inside the
 * bracket, the second with 37, the general manager's with 36.
 */
export const LETTER_SIGN_LINES = {
  first: '        التوقيع : (                           )',
  second: 'التوقيع : (                                     )',
  third: 'التوقيع : (                                    )',
} as const;

/** The kinds as his replenish letter names them — the table's rows and the body's list. */
export const KIND_WORD: Readonly<Record<FleetCustodySource, string>> = {
  tyres: 'كاوتش',
  fuel: 'وقود',
  maintenance: 'صيانه',
  wash: 'غسيل',
};

/** The order his body sentence lists the kinds in: «وقود و كاوتش و صيانه». */
export const BODY_ORDER: readonly FleetCustodySource[] = ['fuel', 'tyres', 'maintenance', 'wash'];
/** The order his replenish table lists them in: كاوتش · وقود · صيانه · غسيل. */
export const TABLE_ORDER: readonly FleetCustodySource[] = ['tyres', 'fuel', 'maintenance', 'wash'];

/** His settle table's licence words. */
export const LICENCE_WORD: Readonly<Record<FleetLicenseExpenseKind, string>> = {
  renewal: 'تجديد',
  extension: 'مد مده',
};

/** A settle table row's label — «تجديد 5 سياره» (digits made Arabic-Indic by the caller). */
export const settleRowLabel = (part: FleetLicenseExpenseKind, cars: string): string =>
  `${LICENCE_WORD[part]} ${cars} سياره`;

/** The word a typed charge reason may start with — the letter writes it itself. */
export const REASON_LEAD = 'نظير';

/**
 * «استعاضه عهدة»'s request sentence. The parts come in formatted: the amounts Arabic-Indic, the
 * dates his tatweel dates (HTML), the kinds his words in `BODY_ORDER`.
 */
export const replenishBody = (
  amount: string,
  custody: string,
  from: string,
  to: string,
  kinds: readonly string[],
): string =>
  ` برجاء التكرم من استعاضه  مبلغ (${amount}) من العهده حيث ان عهده اداره الحركه  ( ${custody}) عن الفتره من ${from} الى الفتره ${to} وذلك نظير ${kinds.join(' و ')}.`;

/** «تسويه عهدة»'s request sentence — no closing full stop, as his. */
export const settleBody = (amount: string, custody: string, from: string, to: string): string =>
  ` برجاء التكرم من تسويه  مبلغ (${amount}) من العهده (${custody}) حيث تم صرف مصروفات تراخيص سيارات عن الفتره من ${from} الى الفتره ${to}`;

/** «صرف عهدة»'s request — the whole sentence when there is no reason. */
export const chargeRequest = (amount: string): string =>
  `برجاء التكرم من صرف مبلغ ( ${amount}) العهده`;

/** What follows the request when there is a reason; his second paragraph comes after it. */
export const CHARGE_FOR = ' و ذلك نظير';

/** His second paragraph: the reason, a space and the full stop after it. */
export const chargeReason = (reason: string): string => ` ${reason} .`;
