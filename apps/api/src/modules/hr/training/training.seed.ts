// The starting catalogue (P-HR-TRN D1).
//
// A STARTING POINT, NOT A FIXED LIST. These four are what an Egyptian cash-logistics company needs
// on day one — the safety and compliance courses a driver or a cash officer is put through — and
// every one of them is an ordinary row an administrator may rename, reorder or retire. The seed
// creates what is MISSING and never overwrites: somebody who renamed «الإسعافات الأولية» meant it,
// and the next boot must not undo the decision.
//
// NO COURSE HERE IS REQUIRED OF ANYBODY. D13 froze that «every driver must hold defensive driving»
// is a rule about job titles nobody has stated, so these are things we teach, not things we demand.
import { type CreateTrainingCourse } from '@ecms/contracts';
import { trainingCourseService } from './courses/training-course.service';

const COURSES: CreateTrainingCourse[] = [
  {
    key: 'defensiveDriving',
    name: { ar: 'القيادة الدفاعية', en: 'Defensive Driving' },
    description: {
      ar: 'قيادة المركبات في ظروف الطريق الحقيقية وتفادي الحوادث',
      en: 'Driving in real road conditions and avoiding collisions',
    },
    defaultDurationHours: 8,
    defaultDeliveryMode: 'classroom',
    order: 10,
  },
  {
    key: 'cashHandling',
    name: { ar: 'التعامل مع النقدية', en: 'Cash Handling' },
    description: {
      ar: 'إجراءات العد والتسليم والعهدة',
      en: 'Counting, handover and custody procedures',
    },
    defaultDurationHours: 6,
    defaultDeliveryMode: 'classroom',
    order: 20,
  },
  {
    key: 'firstAid',
    name: { ar: 'الإسعافات الأولية', en: 'First Aid' },
    defaultDurationHours: 4,
    defaultDeliveryMode: 'classroom',
    order: 30,
  },
  {
    key: 'occupationalSafety',
    name: { ar: 'السلامة والصحة المهنية', en: 'Occupational Health and Safety' },
    defaultDurationHours: 6,
    defaultDeliveryMode: 'classroom',
    order: 40,
  },
];

export const seedTrainingCourses = async (): Promise<void> => {
  for (const course of COURSES) {
    await trainingCourseService.ensure(course);
  }
};
