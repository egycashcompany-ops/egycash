// Leave Management boot migration (frozen design §12) — idempotent, additive only:
//   ① seed the Egyptian-law leave-type defaults (⚠️ L4: EDITABLE configuration — HR must
//     verify the legal values before production; this is a starting point, not legal advice)
//   ② seed the current year's public holidays (only while the calendar is empty — deletions
//     by admins are never resurrected)
//   ③ grant current-year entitlements pro-rata (delegates to the idempotent year-end routine)
//   ④ seed the Employee Self-Service role (L7) and assign it to users linked to employees.
// The "unreconciled leave" panel (§12 ③) is a READ over employees currently onLeave without
// an active request — no migration write.
import { CreateLeaveTypeSchema, type CreateLeaveType } from '@ecms/contracts';
import { rbacService } from '../../../platform/rbac';
import { logger } from '../../../infrastructure/logging/logger';
import { employeeRepository } from '../employee-management/employees';
import { HolidayModel } from '../work-calendar';
import { toDateOnly } from '../shared/business-date';
import { leaveTypeService } from './leave-types';
import { leaveBalanceService } from './leave-balances';

type SeedType = CreateLeaveType & { balanceTypeCode?: string };

const t = (input: Record<string, unknown>): CreateLeaveType => CreateLeaveTypeSchema.parse(input);

const SEED_TYPES: SeedType[] = [
  {
    ...t({
      code: 'ANNUAL',
      name: { ar: 'إجازة سنوية', en: 'Annual leave' },
      baseDays: 15,
      entitlementSteps: [
        { afterServiceYears: 1, days: 21 },
        { afterServiceYears: 10, days: 30 },
      ],
      ageStepAge: 50,
      ageStepDays: 30,
      minServiceMonths: 6,
      minNoticeDays: 3,
      sortOrder: 10,
    }),
  },
  {
    ...t({
      code: 'CASUAL',
      name: { ar: 'إجازة عارضة', en: 'Casual leave' },
      balanceSource: 'otherType',
      balanceTypeId: '000000000000000000000000', // resolved by balanceTypeCode below
      maxPerYearDays: 6,
      maxPerOccasionDays: 2,
      backdateDays: 3,
      sortOrder: 20,
    }),
    balanceTypeCode: 'ANNUAL',
  },
  {
    ...t({
      code: 'SICK',
      name: { ar: 'إجازة مرضية', en: 'Sick leave' },
      payModel: 'tiered',
      payTiers: [
        { days: 90, payRate: 75 },
        { days: 90, payRate: 85 },
      ],
      balanceSource: 'none',
      requiresAttachment: true,
      backdateDays: 3,
      countingMode: 'calendarDays',
      sortOrder: 30,
    }),
  },
  {
    ...t({
      code: 'MATERNITY',
      name: { ar: 'إجازة وضع', en: 'Maternity leave' },
      balanceSource: 'none',
      gender: 'female',
      minServiceMonths: 10,
      maxPerService: 3,
      maxConsecutiveDays: 90,
      countingMode: 'calendarDays',
      affectsEmployeeStatus: true,
      approvalShape: 'managerThenHr',
      sortOrder: 40,
    }),
  },
  {
    ...t({
      code: 'HAJJ',
      name: { ar: 'إجازة حج', en: 'Pilgrimage leave' },
      balanceSource: 'none',
      minServiceMonths: 60,
      maxPerService: 1,
      maxConsecutiveDays: 30,
      countingMode: 'calendarDays',
      affectsEmployeeStatus: true,
      approvalShape: 'managerThenHr',
      sortOrder: 50,
    }),
  },
  {
    ...t({
      code: 'UNPAID',
      name: { ar: 'إجازة بدون أجر', en: 'Unpaid leave' },
      payModel: 'unpaid',
      balanceSource: 'none',
      maxConsecutiveDays: 365,
      countingMode: 'calendarDays',
      affectsEmployeeStatus: true,
      statusThresholdDays: 14,
      approvalShape: 'managerThenHr',
      sortOrder: 60,
    }),
  },
];

/** 2026 Egyptian public holidays — an EDITABLE starting set (Islamic dates are approximate). */
const SEED_HOLIDAYS_2026: { date: string; ar: string; en: string }[] = [
  { date: '2026-01-07', ar: 'عيد الميلاد المجيد', en: 'Coptic Christmas' },
  { date: '2026-01-25', ar: 'عيد الثورة وعيد الشرطة', en: 'Revolution & Police Day' },
  { date: '2026-03-20', ar: 'عيد الفطر', en: 'Eid al-Fitr' },
  { date: '2026-03-21', ar: 'عيد الفطر (اليوم الثاني)', en: 'Eid al-Fitr (day 2)' },
  { date: '2026-03-22', ar: 'عيد الفطر (اليوم الثالث)', en: 'Eid al-Fitr (day 3)' },
  { date: '2026-04-13', ar: 'شم النسيم', en: 'Sham El-Nessim' },
  { date: '2026-04-25', ar: 'عيد تحرير سيناء', en: 'Sinai Liberation Day' },
  { date: '2026-05-01', ar: 'عيد العمال', en: 'Labour Day' },
  { date: '2026-05-26', ar: 'وقفة عرفات', en: 'Arafat Day' },
  { date: '2026-05-27', ar: 'عيد الأضحى', en: 'Eid al-Adha' },
  { date: '2026-05-28', ar: 'عيد الأضحى (اليوم الثاني)', en: 'Eid al-Adha (day 2)' },
  { date: '2026-05-29', ar: 'عيد الأضحى (اليوم الثالث)', en: 'Eid al-Adha (day 3)' },
  { date: '2026-06-16', ar: 'رأس السنة الهجرية', en: 'Islamic New Year' },
  { date: '2026-06-30', ar: 'ثورة ٣٠ يونيو', en: 'June 30 Revolution' },
  { date: '2026-07-23', ar: 'عيد ثورة ٢٣ يوليو', en: 'July 23 Revolution Day' },
  { date: '2026-08-25', ar: 'المولد النبوي الشريف', en: "Prophet's Birthday" },
  { date: '2026-10-06', ar: 'عيد القوات المسلحة', en: 'Armed Forces Day' },
];

export const migrateLeaveModule = async (): Promise<void> => {
  // ① types (create-if-missing by code; ANNUAL first so CASUAL can reference it).
  for (const seed of SEED_TYPES) {
    await leaveTypeService.ensure(seed);
  }

  // ② holidays — seed only while the calendar is EMPTY (admin deletions stay deleted).
  const holidayCount = await HolidayModel.countDocuments({ isDeleted: false }).exec();
  if (holidayCount === 0) {
    for (const h of SEED_HOLIDAYS_2026) {
      await HolidayModel.create({
        date: toDateOnly(new Date(h.date)),
        name: { ar: h.ar, en: h.en },
        createdBy: null,
      });
    }
  }

  // ③ current-year grants (idempotent by the ledger grant key).
  try {
    await leaveBalanceService.yearEndProcessing();
  } catch (error) {
    logger.error({ err: error }, 'leave grant migration failed — rerun on next boot');
  }

  // ④ Employee Self-Service role (L7): leave.view + leave.request at OWN scope.
  const essRole = await rbacService.ensureSystemRole(
    'employee-self-service',
    { en: 'Employee Self-Service', ar: 'الخدمة الذاتية للموظفين' },
    ['leave.view', 'leave.request'],
  );
  const employed = await employeeRepository.listEmployedSystem();
  for (const employee of employed) {
    if (employee.userId !== null) {
      await rbacService.ensureAssignment(String(employee.userId), String(essRole._id), 'own');
    }
  }
};
