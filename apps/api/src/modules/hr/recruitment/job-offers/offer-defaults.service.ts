// «اكتب العرض» opens filled in — A28: «لما بدخل علي المتقدم و اكتبلو عرض عاوزو يجيب المسمي الوظيفي و
// الاداره و الفرع و المدير المباشر اوتوماتيك … نوع التوظيف هيبقا by default دوام كامل … الراتب … فيه فال
// system حاجه اسمها الهيكل التنظيمي جواها حاجه اسمها المسميات الوظيفيه … المسمي الوظيفي اللي عندنا و
// الراتب بتاعو».
//
// A read, nothing more: what the form starts from. The candidate's placement gives the job, the
// department, the branch and the section. The organization chart gives the direct manager — the
// section's, else the department's, else the branch's, an acting manager inside their window
// first (`effectiveManagerId`). The job's «الراتب الثابت» gives the salary, and every active job's
// is sent too, so the form can follow the job when HR changes it. Every value stays editable.
import { type OfferDefaultsDto } from '@ecms/contracts';
import { type ScopeSelector } from '../../../../shared/types';
import {
  branchService,
  departmentService,
  effectiveManagerId,
  jobTitleRepository,
  sectionService,
} from '../../../../platform/organization';
import { userService } from '../../../../platform/users';
import { applicantService } from '../applicants';

class OfferDefaultsService {
  async forApplicant(applicantId: string, scope: ScopeSelector): Promise<OfferDefaultsDto> {
    const applicant = await applicantService.getById(applicantId, scope);
    const placement = applicant.placement;
    const id = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
    const jobTitleId = id(placement.jobTitleId);
    const departmentId = id(placement.departmentId) ?? id(applicant.departmentId);
    const branchId = id(placement.branchId) ?? id(applicant.branchId);
    const sectionId = id(placement.sectionId);

    // The nearest unit up the chart that names a manager.
    const units = [
      sectionId === null ? null : await sectionService.getById(sectionId).catch(() => null),
      departmentId === null ? null : await departmentService.getById(departmentId).catch(() => null),
      branchId === null ? null : await branchService.getById(branchId).catch(() => null),
    ];
    let manager: OfferDefaultsDto['manager'] = null;
    for (const unit of units) {
      const managerId = unit === null ? null : effectiveManagerId(unit);
      if (managerId === null) continue;
      const user = await userService.findByIdSystem(managerId);
      if (user === null) continue;
      manager = {
        id: managerId,
        name: {
          ar: `${user.profile.firstName.ar} ${user.profile.lastName.ar}`.trim(),
          en: `${user.profile.firstName.en} ${user.profile.lastName.en}`.trim(),
        },
      };
      break;
    }

    const jobSalaries = await jobTitleRepository.activeFixedSalariesSystem();
    const own = jobSalaries.find((row) => row.jobTitleId === jobTitleId);
    return {
      jobTitleId,
      departmentId,
      branchId,
      sectionId,
      manager,
      employmentType: 'fullTime',
      salary: own === undefined ? null : { amount: own.amount, currency: own.currency },
      jobSalaries,
    };
  }
}

export const offerDefaultsService = new OfferDefaultsService();
