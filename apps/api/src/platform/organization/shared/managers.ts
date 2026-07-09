// Manager references on org units (Review R11) must point at live users.
import { BusinessRuleError } from '../../../shared/errors';
import { userService } from '../../users';

export const assertManagerExists = async (userId: string): Promise<void> => {
  const user = await userService.getById(userId).catch(() => null);
  if (user === null || user.status === 'archived') {
    throw new BusinessRuleError('Manager must reference an existing, non-archived user');
  }
};
