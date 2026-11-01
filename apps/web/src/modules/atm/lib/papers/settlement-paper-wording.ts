// The owner's printed papers, word for word (docs/12-planning/atm-settlements-phase1.md §8.1,
// DS-18): the Note «محضر جرد ماكينة الصراف الآلى» (`Print`), «بيان التغذية» and «سيلزات», exactly
// as the Al Baraka master prints them — their spelling included («إجمالى», «اجمالى», «جنية», «هذة»).
// Correcting them would print a paper that is not his.
//
// THE ONE EXEMPTION. This file is listed in `VERBATIM_PAPERS` (`scripts/check-formal-arabic.mjs`),
// and it is the only non-spec file of `lib/papers/` that holds an Arabic letter
// (`formal-arabic.spec.ts`). Every word that is NEW on a paper (the run, the spare set, the route
// sheet) is a formal i18n key under `atm.paper.*`, always rendered with `translate('ar', …)`.
export const NOTE_WORDS = {
  title: 'محضر جرد ماكينة الصراف الآلى',
  bagLock: 'رقم قفل الحقيبة',
  serial: 'مسلسل',
  bank: 'البنك',
  area: 'المنطقة',
  bagReturn: 'رقم راجع الحقيبة',
  machineId: 'رقم الماكينة',
  machineName: 'إسم الماكينة',
  date: 'التاريخ',
  cassetteNo: 'رقم الكاسيت',
  denomination: 'الفئة',
  noteCount: 'عدد ورق البنكنوت',
  cassetteLock: 'رقم قفل الكاسيت',
  camera: 'رقم الكاميرا',
  fillTime: 'ساعة التعبئة',
  techSign: 'توقيع وختم فنى التجهيز',
  supervisorStamp: 'ختم و إسم مشرف التجهيز',
  unloadTechStamp: 'ختم و إسم فنى التجهيز لتفريغ الماكينة',
  machineTotal: 'إجمالى قيمة الماكينة',
  egpOnly: 'جنية مصرى فقط لا غير',
  contains: 'هذة الماكينة تحتوى على',
  depositUnload: 'تفريغ الإيداع',
  denominations: 'الفئات',
  deposit: 'الإيداع',
  short: 'العجز',
  over: 'الزيادة',
  envelopes: 'إيداع الأظرف',
  name: 'الإسم',
  time: 'الساعة',
  cassetteUnload: 'تفريغ كاسيتات الماكينة',
  divert: 'ديفرت',
  total: 'اجمالى',
  overShort: 'زيادة',
  shortShort: 'عجز',
  dataEntryStamp: 'ختم وإسم مدخل البيانات',
  cards: 'عدد الكروت',
  result: 'نتيجة جرد الماكينة',
  match: 'مطابق',
  shiftManager: 'ختم وتوقيع مدير الوردية',
  reviewer: 'ختم وإسم المراجع',
  techAck: 'توقيع الفنى بالعلم',
} as const;

export const RECEIPT_WORDS = {
  titlePrefix: 'بيان مرسل من إدارة الباك أوفيس لتغذية',
  titleSuffix: 'عن يوم',
  denomination: 'فئة',
  count: 'عدد ورق',
  total: 'الإجمالى',
  sentenceStart: 'تم إستلام المبلغ المذكور أعلاه لتغذية عدد',
  sentenceEnd: 'ماكينة للبنك المذكور',
  supervisor: 'توقيع المشرف / ',
} as const;

export const SEALS_WORDS = {
  footer: 'تم تسليم الخزينة الماكينات الموضحة اعلاه .',
  supervisor: 'توقيع المشرف / ' + '.'.repeat(54),
  shortBankName: { BRK: 'البركة' },
} as const;
