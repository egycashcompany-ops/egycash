// HR side of the platform identity seams (frozen auth design 4.3 + §12): the platform cannot
// import HR, so employee-code login resolution and the userId → Employee-Code lookup (for
// credential messages) register here at module load. Registration is idempotent.
import {
  registerEmployeeCodeOfUser,
  registerEmployeeCodeResolver,
} from '../../../../platform/auth/identity-seams';
import { employeeRepository } from './employee.repository';

export const registerHrIdentitySeams = (): void => {
  registerEmployeeCodeResolver(async (code) => {
    const employee = await employeeRepository.findByCodeSystem(code);
    return employee === null || employee.userId === null ? null : String(employee.userId);
  });
  registerEmployeeCodeOfUser(async (userId) => {
    const employee = await employeeRepository.findByUserIdSystem(userId);
    return employee?.code ?? null;
  });
};
