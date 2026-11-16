// The insurer behind each notice form — ONE source for every screen that names it: the notices
// screen and its chooser (through `notice-templates.ts`, which reads its names from here) and the
// dashboard's «إخطارات ينقصها مرفق», which needs the names without the forms' printed geometry (the
// dashboard's chunk never pulls the scanned pages' positions in).
//
// The names are the insurers' own, in Arabic in both languages — as the notices screen has always
// written them.
import { type FleetNoticeTemplate } from '@ecms/contracts';

/** The insurer a notice was filled for, by its form. */
export const NOTICE_INSURER: Readonly<Record<FleetNoticeTemplate, string>> = {
  misrInsurance: 'مصر للتأمين',
  deltaInsurance: 'الدلتا للتأمين',
};
