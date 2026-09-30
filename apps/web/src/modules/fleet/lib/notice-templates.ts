// The insurers' printed forms (الإخطارات) — WHERE each answer is written on each page.
//
// Every position is in the form's own units: the scanned page is 744 wide and 1053 tall, and a
// box is the span `left … right` on the line whose middle is at `y`. The preview and the print
// both place text by these numbers as percentages of the page, so the same notice lands in the
// same place on the screen and on paper. They were measured on the scans the owner sent, box by
// box — «اماكن الحاجات ... فى حاجات نازله وحاجات طالعه» was fixed here, not in the renderer.
//
// A form's WORDS are the form's own: the labels below are how the insurer printed them.
//
// «ومش عاوز اى داتا اجبارى» — no box is required. A box left empty stays empty on the page.
import { type FleetNoticeTemplate } from '@ecms/contracts';

/** The scanned page's size, in the units every position below is written in. */
export const NOTICE_PAGE = { width: 744, height: 1053 } as const;

/** A box on the page: the span it may fill, and the middle of its line. */
export interface NoticeSlot {
  right: number;
  left: number;
  y: number;
}

/** What «املأ من السيستم» can supply — see `notice-autofill.ts`. */
export type NoticeSource =
  | 'companyName'
  | 'driverName'
  | 'driverPhone'
  | 'licenseNumber'
  | 'licenseExpiry'
  | 'motorNumber'
  | 'chassisNumber'
  | 'plateNumber'
  | 'vehicleType'
  | 'accidentDate'
  | 'accidentTime'
  | 'accidentStatement';

export interface NoticeField {
  key: string;
  label: string;
  /** 0-based page of the form. */
  page: number;
  /**
   * `text` — one box. `date` — day, month and year each between the form's printed slashes.
   * `multiline` — flows word by word across the form's lines. `plate` — letters and digits on the
   * two sides of the printed slash.
   */
  kind: 'text' | 'date' | 'multiline' | 'plate';
  slot?: NoticeSlot;
  /** `date`: [day, month, year]. `plate`: [letters, digits]. */
  parts?: NoticeSlot[];
  lines?: NoticeSlot[];
  /** The form prints «٢٠٢» and leaves room for one digit — the year's last. */
  yearLastDigit?: boolean;
  source?: NoticeSource;
}

export interface NoticeSection {
  title: string;
  fields: NoticeField[];
}

/** A question answered by ticking one of the form's own circles. */
export interface NoticeCheck {
  key: string;
  label: string;
  page: number;
  /** The form section the question is asked under, so the screen asks it in the same place. */
  afterSection: string;
  /** More than one circle may be ticked — «أسباب الحادث». A yes/no takes one. */
  multiple?: boolean;
  /** Each circle's centre. */
  options: { label: string; x: number; y: number }[];
}

export interface NoticeTemplate {
  key: FleetNoticeTemplate;
  /** The insurer, as the chooser names it. */
  insurer: string;
  /** The form's own title. */
  title: string;
  /** The scanned pages, in order — served from `public/fleet-notices`. */
  pages: string[];
  sections: NoticeSection[];
  checks: NoticeCheck[];
}

const page = (file: string): string => `${import.meta.env.BASE_URL}fleet-notices/${file}`;

export const NOTICE_TEMPLATES: readonly NoticeTemplate[] = [
  {
    key: 'misrInsurance',
    insurer: 'مصر للتأمين',
    title: 'إخطار بلاغ حادث تأمين سيارات',
    pages: [page('misr-insurance-1.jpg'), page('misr-insurance-2.jpg')],
    sections: [
      {
        title: 'رأس الإخطار',
        fields: [
          {
            key: 'accidentNo',
            label: 'رقم الحادث',
            page: 0,
            kind: 'text',
            slot: { right: 225, left: 127, y: 169 },
          },
          {
            key: 'accidentDate',
            label: 'تاريخ الحادث',
            page: 0,
            kind: 'date',
            parts: [
              { right: 229, left: 204, y: 188 },
              { right: 199, left: 181, y: 188 },
              { right: 176, left: 127, y: 188 },
            ],
            source: 'accidentDate',
          },
          {
            key: 'reportDate',
            label: 'تاريخ الإبلاغ',
            page: 0,
            kind: 'text',
            slot: { right: 228, left: 127, y: 206 },
          },
        ],
      },
      {
        title: 'بيانات المؤمن له',
        fields: [
          {
            key: 'insuredName',
            label: 'الاسم (رباعي)',
            page: 0,
            kind: 'text',
            slot: { right: 598, left: 395, y: 235 },
            source: 'companyName',
          },
          {
            key: 'insuredMobile',
            label: 'رقم الموبايل',
            page: 0,
            kind: 'text',
            slot: { right: 287, left: 40, y: 237 },
          },
          {
            key: 'insuredNid',
            label: 'الرقم القومي',
            page: 0,
            kind: 'text',
            slot: { right: 607, left: 395, y: 264 },
          },
          {
            key: 'insuredEmail',
            label: 'البريد الإلكتروني',
            page: 0,
            kind: 'text',
            slot: { right: 280, left: 40, y: 265 },
          },
        ],
      },
      {
        title: 'بيانات قائد السيارة وقت الحادث',
        fields: [
          {
            key: 'driverName',
            label: 'الاسم (رباعي)',
            page: 0,
            kind: 'text',
            slot: { right: 597, left: 372, y: 333 },
            source: 'driverName',
          },
          {
            key: 'driverBirth',
            label: 'تاريخ الميلاد',
            page: 0,
            kind: 'date',
            parts: [
              { right: 268, left: 242, y: 332 },
              { right: 234, left: 203, y: 332 },
              { right: 195, left: 140, y: 332 },
            ],
          },
          {
            key: 'driverNid',
            label: 'الرقم القومي',
            page: 0,
            kind: 'text',
            slot: { right: 609, left: 372, y: 362 },
          },
          {
            key: 'driverJob',
            label: 'المهنة',
            page: 0,
            kind: 'text',
            slot: { right: 300, left: 70, y: 363 },
          },
          {
            key: 'relation',
            label: 'العلاقة بالمؤمن له',
            page: 0,
            kind: 'text',
            slot: { right: 575, left: 372, y: 390 },
          },
          {
            key: 'driverEmail',
            label: 'البريد الإلكتروني',
            page: 0,
            kind: 'text',
            slot: { right: 257, left: 70, y: 392 },
          },
          {
            key: 'driverMobile',
            label: 'رقم الموبايل',
            page: 0,
            kind: 'text',
            slot: { right: 263, left: 70, y: 421 },
            source: 'driverPhone',
          },
          {
            key: 'licenseNo',
            label: 'رقم ونوع رخصة القيادة',
            page: 0,
            kind: 'text',
            slot: { right: 540, left: 410, y: 448 },
            source: 'licenseNumber',
          },
          {
            key: 'licenseIssue',
            label: 'تاريخ الإصدار',
            page: 0,
            kind: 'text',
            slot: { right: 307, left: 215, y: 450 },
          },
          {
            key: 'licenseExpiry',
            label: 'تاريخ الانتهاء',
            page: 0,
            kind: 'text',
            slot: { right: 110, left: 40, y: 451 },
            source: 'licenseExpiry',
          },
        ],
      },
      {
        title: 'بيانات الوثيقة',
        fields: [
          {
            key: 'policyNo',
            label: 'رقم الوثيقة',
            page: 0,
            kind: 'text',
            slot: { right: 617, left: 395, y: 519 },
          },
          {
            key: 'policyIssuer',
            label: 'جهة الإصدار',
            page: 0,
            kind: 'text',
            slot: { right: 290, left: 72, y: 521 },
          },
          {
            key: 'policyTerm',
            label: 'مدة التأمين',
            page: 0,
            kind: 'text',
            slot: { right: 615, left: 395, y: 548 },
          },
          {
            key: 'sumInsured',
            label: 'مبلغ التأمين',
            page: 0,
            kind: 'text',
            slot: { right: 290, left: 72, y: 550 },
          },
        ],
      },
      {
        title: 'بيانات السيارة',
        fields: [
          {
            key: 'motorNo',
            label: 'رقم الموتور',
            page: 0,
            kind: 'text',
            slot: { right: 623, left: 395, y: 621 },
            source: 'motorNumber',
          },
          {
            key: 'chassisNo',
            label: 'رقم الشاسيه',
            page: 0,
            kind: 'text',
            slot: { right: 280, left: 72, y: 623 },
            source: 'chassisNumber',
          },
          {
            key: 'plateNo',
            label: 'رقم اللوحة',
            page: 0,
            kind: 'text',
            slot: { right: 623, left: 395, y: 650 },
            source: 'plateNumber',
          },
          {
            key: 'model',
            label: 'الماركة / الموديل',
            page: 0,
            kind: 'text',
            slot: { right: 245, left: 72, y: 652 },
            source: 'vehicleType',
          },
        ],
      },
      {
        title: 'معلومات الحادث',
        fields: [
          {
            key: 'place',
            label: 'المكان',
            page: 0,
            kind: 'text',
            slot: { right: 655, left: 72, y: 732 },
          },
          {
            key: 'time',
            label: 'الوقت',
            page: 0,
            kind: 'text',
            slot: { right: 658, left: 390, y: 760 },
            source: 'accidentTime',
          },
          {
            key: 'date',
            label: 'التاريخ',
            page: 0,
            kind: 'date',
            parts: [
              { right: 328, left: 298, y: 760 },
              { right: 288, left: 258, y: 760 },
              { right: 248, left: 190, y: 761 },
            ],
            source: 'accidentDate',
          },
          {
            key: 'how',
            label: 'كيفية وقوع الحادث (شرح مبسط)',
            page: 0,
            kind: 'multiline',
            lines: [
              { right: 480, left: 72, y: 926 },
              { right: 705, left: 72, y: 949 },
            ],
            source: 'accidentStatement',
          },
        ],
      },
      {
        title: 'الطرف الثالث (السيارة المتضررة)',
        fields: [
          {
            key: 'tpName',
            label: 'الاسم',
            page: 1,
            kind: 'text',
            slot: { right: 670, left: 445, y: 197 },
          },
          {
            key: 'tpMobile',
            label: 'رقم الموبايل',
            page: 1,
            kind: 'text',
            slot: { right: 350, left: 290, y: 197 },
          },
          {
            key: 'tpPlate',
            label: 'رقم ونوع اللوحة',
            page: 1,
            kind: 'plate',
            parts: [
              { right: 166, left: 142, y: 198 },
              { right: 136, left: 86, y: 198 },
            ],
          },
          {
            key: 'tpModel',
            label: 'الماركة / الموديل',
            page: 1,
            kind: 'text',
            slot: { right: 610, left: 445, y: 224 },
          },
          {
            key: 'tpAddress',
            label: 'العنوان',
            page: 1,
            kind: 'text',
            slot: { right: 375, left: 86, y: 224 },
          },
          {
            key: 'tpDamage',
            label: 'الأضرار التي لحقت بسيارة الغير',
            page: 1,
            kind: 'text',
            slot: { right: 520, left: 86, y: 244 },
          },
        ],
      },
      {
        title: 'أضرار السيارة المؤمن عليها',
        fields: [
          {
            key: 'repairPlace',
            label: 'مكان الإصلاح',
            page: 1,
            kind: 'text',
            slot: { right: 626, left: 500, y: 295 },
          },
          {
            key: 'repairAddress',
            label: 'العنوان',
            page: 1,
            kind: 'text',
            slot: { right: 436, left: 240, y: 295 },
          },
          {
            key: 'repairPhone',
            label: 'رقم التليفون',
            page: 1,
            kind: 'text',
            slot: { right: 150, left: 86, y: 295 },
          },
          {
            key: 'damageDetail',
            label: 'بيان تفصيلي بالأضرار',
            page: 1,
            kind: 'multiline',
            lines: [
              { right: 428, left: 95, y: 378 },
              { right: 715, left: 93, y: 397 },
            ],
          },
          {
            key: 'signedAt',
            label: 'تحريراً في',
            page: 1,
            kind: 'date',
            parts: [
              { right: 657, left: 644, y: 857 },
              { right: 637, left: 617, y: 857 },
              { right: 609, left: 572, y: 857 },
            ],
          },
        ],
      },
    ],
    checks: [
      {
        key: 'cause',
        label: 'أسباب الحادث',
        multiple: true,
        page: 0,
        afterSection: 'معلومات الحادث',
        options: [
          { label: 'تصادم', x: 703, y: 829 },
          { label: 'انقلاب', x: 490, y: 829 },
          { label: 'حريق', x: 275, y: 829 },
          { label: 'سرقة', x: 703, y: 857 },
          { label: 'أثناء النقل', x: 490, y: 857 },
          { label: 'أثناء عبور مجرى مائي', x: 275, y: 857 },
          { label: 'ظواهر طبيعية', x: 703, y: 884 },
        ],
      },
      {
        key: 'licensed',
        label: 'هل كان السائق بتصريح منك؟',
        page: 0,
        afterSection: 'بيانات قائد السيارة وقت الحادث',
        options: [{ label: 'نعم', x: 468, y: 422 }],
      },
      {
        key: 'police',
        label: 'هل تم عمل محضر شرطة؟',
        page: 1,
        afterSection: 'أضرار السيارة المؤمن عليها',
        options: [{ label: 'نعم', x: 536, y: 329 }],
      },
      {
        key: 'movable',
        label: 'هل السيارة قابلة للتحريك؟',
        page: 1,
        afterSection: 'أضرار السيارة المؤمن عليها',
        options: [{ label: 'نعم', x: 536, y: 360 }],
      },
    ],
  },
  {
    key: 'deltaInsurance',
    insurer: 'الدلتا للتأمين',
    title: 'إخطار عن حادث سيارة (QF-112)',
    pages: [page('delta-insurance-1.jpg')],
    sections: [
      {
        title: 'رأس الإخطار',
        fields: [
          {
            key: 'claimNo',
            label: 'رقم المطالبة',
            page: 0,
            kind: 'text',
            slot: { right: 175, left: 55, y: 158 },
          },
          {
            key: 'reportDate',
            label: 'تاريخ تقديم الإخطار',
            page: 0,
            kind: 'date',
            parts: [
              { right: 143, left: 126, y: 178 },
              { right: 120, left: 100, y: 178 },
              { right: 95, left: 55, y: 178 },
            ],
          },
        ],
      },
      {
        title: 'بيانات المؤمن له',
        fields: [
          {
            key: 'insuredName',
            label: 'الاسم',
            page: 0,
            kind: 'text',
            slot: { right: 580, left: 380, y: 222 },
            source: 'companyName',
          },
          {
            key: 'insuredAddress',
            label: 'العنوان',
            page: 0,
            kind: 'text',
            slot: { right: 580, left: 380, y: 247 },
          },
          {
            key: 'insuredPhone',
            label: 'رقم التليفون',
            page: 0,
            kind: 'text',
            slot: { right: 585, left: 380, y: 272 },
          },
          {
            key: 'insuredFax',
            label: 'رقم الفاكس',
            page: 0,
            kind: 'text',
            slot: { right: 585, left: 380, y: 296 },
          },
        ],
      },
      {
        title: 'بيانات الوثيقة',
        fields: [
          {
            key: 'policyNo',
            label: 'رقم الوثيقة',
            page: 0,
            kind: 'text',
            slot: { right: 257, left: 62, y: 220 },
          },
          {
            key: 'policyIssuer',
            label: 'جهة الإصدار',
            page: 0,
            kind: 'text',
            slot: { right: 255, left: 62, y: 246 },
          },
          {
            key: 'policyTerm',
            label: 'مدة التأمين',
            page: 0,
            kind: 'text',
            slot: { right: 257, left: 62, y: 272 },
          },
          {
            key: 'sumInsured',
            label: 'مبلغ التأمين',
            page: 0,
            kind: 'text',
            slot: { right: 257, left: 62, y: 296 },
          },
        ],
      },
      {
        title: 'بيانات السيارة',
        fields: [
          {
            key: 'plateNo',
            label: 'رقم السيارة',
            page: 0,
            kind: 'text',
            slot: { right: 567, left: 380, y: 349 },
            source: 'plateNumber',
          },
          {
            key: 'chassisNo',
            label: 'رقم الشاسيه',
            page: 0,
            kind: 'text',
            slot: { right: 567, left: 380, y: 374 },
            source: 'chassisNumber',
          },
          {
            key: 'model',
            label: 'الماركة / الموديل',
            page: 0,
            kind: 'text',
            slot: { right: 560, left: 380, y: 398 },
            source: 'vehicleType',
          },
        ],
      },
      {
        title: 'بيانات الحادث',
        fields: [
          {
            key: 'accidentDate',
            label: 'تاريخ الحادث',
            page: 0,
            kind: 'text',
            slot: { right: 239, left: 62, y: 350 },
            source: 'accidentDate',
          },
          {
            key: 'time',
            label: 'وقت وقوع الحادث',
            page: 0,
            kind: 'text',
            slot: { right: 242, left: 62, y: 374 },
            source: 'accidentTime',
          },
          {
            key: 'notifyDate',
            label: 'تاريخ الإبلاغ',
            page: 0,
            kind: 'text',
            slot: { right: 242, left: 62, y: 398 },
          },
        ],
      },
      {
        title: 'بيانات السائق',
        fields: [
          {
            key: 'driverName',
            label: 'اسم السائق',
            page: 0,
            kind: 'text',
            slot: { right: 547, left: 380, y: 453 },
            source: 'driverName',
          },
          {
            key: 'licenseNo',
            label: 'رقم ونوع رخصة القيادة',
            page: 0,
            kind: 'text',
            slot: { right: 522, left: 380, y: 477 },
            source: 'licenseNumber',
          },
          {
            key: 'licenseExpiry',
            label: 'تاريخ انتهائها',
            page: 0,
            kind: 'text',
            slot: { right: 547, left: 380, y: 501 },
            source: 'licenseExpiry',
          },
        ],
      },
      {
        title: 'بيانات محضر الشرطة',
        fields: [
          {
            key: 'policeNo',
            label: 'رقم المحضر',
            page: 0,
            kind: 'text',
            slot: { right: 260, left: 62, y: 454 },
          },
          {
            key: 'policeDate',
            label: 'تاريخ المحضر',
            page: 0,
            kind: 'text',
            slot: { right: 260, left: 62, y: 480 },
          },
          {
            key: 'policePlace',
            label: 'مكان تحريره',
            page: 0,
            kind: 'text',
            slot: { right: 260, left: 62, y: 503 },
          },
        ],
      },
      {
        title: 'شرح كيفية وقوع الحادث',
        fields: [
          {
            key: 'how',
            label: 'الشرح',
            page: 0,
            kind: 'multiline',
            lines: [
              { right: 645, left: 65, y: 549 },
              { right: 645, left: 65, y: 569 },
              { right: 645, left: 65, y: 590 },
            ],
            source: 'accidentStatement',
          },
        ],
      },
      {
        title: 'الأضرار التي لحقت بالسيارة',
        fields: [
          {
            key: 'damage',
            label: 'البيان التفصيلي',
            page: 0,
            kind: 'multiline',
            lines: [
              { right: 645, left: 65, y: 642 },
              { right: 645, left: 65, y: 661 },
            ],
          },
        ],
      },
      {
        title: 'مكان إصلاح السيارة المؤمن عليها',
        fields: [
          {
            key: 'repairPlace',
            label: 'مكان الإصلاح',
            page: 0,
            kind: 'text',
            slot: { right: 570, left: 100, y: 720 },
          },
          {
            key: 'repairAddress',
            label: 'العنوان',
            page: 0,
            kind: 'text',
            slot: { right: 570, left: 100, y: 741 },
          },
          {
            key: 'repairPhone',
            label: 'رقم التليفون',
            page: 0,
            kind: 'text',
            slot: { right: 575, left: 100, y: 762 },
          },
        ],
      },
      {
        title: 'السيارة الأخرى (الخصم)',
        fields: [
          {
            key: 'tpPlate',
            label: 'رقم السيارة',
            page: 0,
            kind: 'text',
            slot: { right: 545, left: 325, y: 819 },
          },
          {
            key: 'tpModel',
            label: 'الماركة / الموديل',
            page: 0,
            kind: 'text',
            slot: { right: 235, left: 75, y: 819 },
          },
          {
            key: 'tpOwner',
            label: 'اسم مالك السيارة',
            page: 0,
            kind: 'text',
            slot: { right: 545, left: 75, y: 840 },
          },
          {
            key: 'tpAddress',
            label: 'العنوان',
            page: 0,
            kind: 'text',
            slot: { right: 552, left: 75, y: 861 },
          },
          {
            key: 'tpDamage',
            label: 'الأضرار التي لحقت بسيارة الغير',
            page: 0,
            kind: 'text',
            slot: { right: 447, left: 75, y: 883 },
          },
          {
            key: 'signedAt',
            label: 'تحريراً في',
            page: 0,
            kind: 'date',
            parts: [
              { right: 600, left: 581, y: 1019 },
              { right: 574, left: 553, y: 1019 },
              { right: 546, left: 533, y: 1019 },
            ],
            yearLastDigit: true,
          },
        ],
      },
    ],
    checks: [],
  },
];

export const noticeTemplate = (key: string): NoticeTemplate | undefined =>
  NOTICE_TEMPLATES.find((template) => template.key === key);
