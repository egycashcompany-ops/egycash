// What the gold module teaches the platform at boot, and the one role it owns.
//
// Three registrations, all of them the platform asking the module a question it cannot answer for
// itself — the same shape HR uses for employee-code login:
//
//   · WHERE an external customer may read (the confinement gate's allow-list);
//   · WHAT to call the record they belong to (the portal header's greeting);
//   · the role that carries their single grant.
import { registerExternalSubjectLabel, registerExternalSurface } from '../../platform/auth';
import { rbacService } from '../../platform/rbac';
import { goldCompanyRepository } from './companies/company.repository';
import { GOLD_PORTAL_SUBJECT } from './portal';

/** The role every portal account holds, and the only one. */
export const GOLD_PORTAL_ROLE_KEY = 'gold-portal-customer';

export const runGoldSeed = async (): Promise<void> => {
  registerExternalSurface('gold', GOLD_PORTAL_SUBJECT, '/gold/portal');

  registerExternalSubjectLabel(async (subject) => {
    if (subject.moduleId !== 'gold' || subject.subjectType !== GOLD_PORTAL_SUBJECT) return null;
    const company = await goldCompanyRepository.findById(subject.subjectId);
    return company === null ? null : company.name;
  });

  // `ensureManagedRole`, not `createRole`: it re-asserts the grant set on every boot, so a role
  // widened by hand in the Roles screen is pulled back at the next deploy. It also creates the role
  // with `isSystem: false`, which is load-bearing rather than incidental — a system role makes its
  // holder PRIVILEGED, and privileged accounts are forced through TOTP enrollment, which is not a
  // thing to impose on a customer looking up their own bars.
  await rbacService.ensureManagedRole(
    GOLD_PORTAL_ROLE_KEY,
    { en: 'Gold portal customer', ar: 'عميل بوابة الذهب' },
    ['goldPortal.view'],
  );
};
