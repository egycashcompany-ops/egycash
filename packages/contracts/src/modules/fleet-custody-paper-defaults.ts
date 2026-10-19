// The names each custody paper starts with — his papers, word for word.
//
// «عاوز زيهم بالظبط»: every string here is copied from the owner's own printed papers, spelling and
// spacing included («مدير إدارة  الحركة» has two spaces on his tyres paper, «اجمالى» is his). His
// papers spell the same people differently, and each paper keeps its own spelling: the tyres paper
// «عميد / ايهاب عبد السلام سليمان», the maintenance paper «عميد / إيهاب عبدالسلام سليمان», the fuel
// paper «عميد / ايهاب»; the general manager «لواء أ ح» / «لواء أح» / «لواء ا. ح» / «لواء ا . ح».
// The replenish and settle letters write «الاستاذ», the charge letter «الأستاذ».
//
// That is why this file is in `VERBATIM_PAPERS` (scripts/check-formal-arabic.mjs): it is a record
// of his documents, like a quotation in a comment, not prose of ours. Nothing but his printed names
// lives here.
//
// They are only the STARTING names: «إعداد المذكرات» saves his own set, and each memo or letter
// keeps the set it was made with. Every paper is its own object literal — no paper shares a block
// with another, so a copy of one can never change another.
import type { FleetCustodyPaperSet } from './fleet.js';

export const DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES: FleetCustodyPaperSet = {
  tyres: {
    blocks: [
      { role: 'preparer', office: 'مشرف الصيانه', name: 'النقيب / صلاح صبري علي', on: true },
      {
        role: 'director',
        office: 'مدير إدارة  الحركة',
        name: 'عميد / ايهاب عبد السلام سليمان',
        on: true,
      },
      {
        role: 'endorser',
        office: '',
        name: 'لواء أ ح / جمال أحمد أبواسماعيل  -  المدير العام',
        on: true,
      },
    ],
    note: 'يرجى المراجعة والتصديق على اجمالى المصروفات',
  },
  fuel: {
    blocks: [
      { role: 'preparer', office: 'محاسب الحركه', name: 'الأستاذ/ عبدالرحمن محمد محمود', on: true },
      // His fuel paper breaks the office over two lines: «مدير إدارة» / «الحركة».
      { role: 'director', office: 'مدير إدارة الحركة', name: 'عميد / ايهاب', on: true },
      {
        role: 'endorser',
        office: 'السيد مدير عام الشركه',
        name: 'لواء ا. ح / جمال احمد ابو إسماعيل',
        on: true,
      },
    ],
    note: '',
  },
  maintenance: {
    blocks: [
      { role: 'preparer', office: 'رئيس قسم الصيانه', name: 'المقدم / محمد حسين محمد', on: true },
      {
        role: 'director',
        office: 'مدير اداره الحركة',
        name: 'عميد / إيهاب عبدالسلام سليمان',
        on: true,
      },
      {
        role: 'endorser',
        office: '',
        name: 'لواء أح / جمال أحمد أبواسماعيل  -  المدير العام التنفيذى  -  شركة ايجى كاش للحلول النقدية',
        on: true,
      },
    ],
    note: 'يرجى المراجعة والتصديق على اجمالى المصروفات',
  },
  // The washing memo is his tyres paper with another title — its names too.
  wash: {
    blocks: [
      { role: 'preparer', office: 'مشرف الصيانه', name: 'النقيب / صلاح صبري علي', on: true },
      {
        role: 'director',
        office: 'مدير إدارة  الحركة',
        name: 'عميد / ايهاب عبد السلام سليمان',
        on: true,
      },
      {
        role: 'endorser',
        office: '',
        name: 'لواء أ ح / جمال أحمد أبواسماعيل  -  المدير العام',
        on: true,
      },
    ],
    note: 'يرجى المراجعة والتصديق على اجمالى المصروفات',
  },
  replenish: {
    blocks: [
      {
        role: 'director',
        office: 'مدير اداره الحركه',
        name: 'العميد : إيهاب عبد السلام سليمان',
        on: true,
      },
      {
        role: 'finance',
        office: 'مدير الادارة المالية',
        name: 'الاستاذ : مصطفى حسب الله',
        on: true,
      },
      {
        role: 'endorser',
        office: 'مدير عام الشركة',
        name: 'لواء ا . ح  : جمال أبو إسماعيل',
        on: true,
      },
    ],
    note: '',
  },
  // His settle letter leaves the general manager off.
  settle: {
    blocks: [
      {
        role: 'director',
        office: 'مدير اداره الحركه',
        name: 'العميد : إيهاب عبد السلام سليمان',
        on: true,
      },
      {
        role: 'finance',
        office: 'مدير الادارة المالية',
        name: 'الاستاذ : مصطفى حسب الله',
        on: true,
      },
      {
        role: 'endorser',
        office: 'مدير عام الشركة',
        name: 'لواء ا . ح  : جمال أبو إسماعيل',
        on: false,
      },
    ],
    note: '',
  },
  charge: {
    blocks: [
      {
        role: 'director',
        office: 'مدير اداره الحركه',
        name: 'العميد : إيهاب عبد السلام سليمان',
        on: true,
      },
      {
        role: 'finance',
        office: 'مدير الادارة المالية',
        name: 'الأستاذ : مصطفى حسب الله',
        on: true,
      },
      {
        role: 'endorser',
        office: 'مدير عام الشركة',
        name: 'لواء ا . ح  : جمال أبو إسماعيل',
        on: true,
      },
    ],
    note: '',
  },
};
