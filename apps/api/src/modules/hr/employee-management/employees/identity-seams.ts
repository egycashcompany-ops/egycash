// HR side of the platform identity seams (frozen auth design 4.3/4.4): the platform cannot
// import HR, so employee-code login resolution and the NID temp-password source register here
// at module load. Registration is idempotent (last write wins with identical functions).
import {
  registerEmployeeCodeResolver,
  registerTempPasswordSource,
} from '../../../../platform/auth/identity-seams';
import { employeeRepository } from './employee.repository';

export const registerHrIdentitySeams = (): void => {
  registerEmployeeCodeResolver(async (code) => {
    const employee = await employeeRepository.findByCodeSystem(code);
    return employee === null || employee.userId === null ? null : String(employee.userId);
  });
  registerTempPasswordSource(async (userId) => {
    const employee = await employeeRepository.findByUserIdSystem(userId);
    return employee?.personal.nationalId ?? null;
  });
};
