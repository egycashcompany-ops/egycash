import { Types } from 'mongoose';
import { BaseRepository } from '../../shared/base/base.repository';
import { UserApplicationModel, type UserApplicationDoc } from './user-application.model';

class UserApplicationRepository extends BaseRepository<UserApplicationDoc> {
  constructor() {
    super(UserApplicationModel, {}); // platform-level link: scope = organization
  }

  /** All live assignments for a user. */
  findByUser(userId: string): Promise<UserApplicationDoc[]> {
    return this.model
      .find({ userId: new Types.ObjectId(userId), isDeleted: false })
      .lean<UserApplicationDoc[]>()
      .exec();
  }
}

export const userApplicationRepository = new UserApplicationRepository();
