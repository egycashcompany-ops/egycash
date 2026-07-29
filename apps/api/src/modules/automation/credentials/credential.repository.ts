import { BaseRepository } from '../../../shared/base/base.repository';
import { AutomationCredentialModel, type AutomationCredentialDoc } from './credential.model';

class AutomationCredentialRepository extends BaseRepository<AutomationCredentialDoc> {
  constructor() {
    super(AutomationCredentialModel, { branchField: 'branchId', ownerUserField: 'ownerUserId' });
  }

  async findByKey(key: string): Promise<AutomationCredentialDoc | null> {
    return this.model.findOne({ key, isDeleted: false }).exec();
  }

  /** Rotation input: everything sealed under a key that is no longer the current one. */
  async listNotOnKey(currentKeyId: string, limit: number): Promise<AutomationCredentialDoc[]> {
    return this.model
      .find({ 'secretRef.keyId': { $ne: currentKeyId }, isDeleted: false })
      .limit(limit)
      .exec();
  }

  async touchLastUsed(id: string): Promise<void> {
    // Deliberately not a versioned update: recording use must never fail an execution, and two
    // concurrent runs racing on a timestamp is not a conflict worth reporting.
    await this.model.updateOne({ _id: id }, { $set: { lastUsedAt: new Date() } }).exec();
  }
}

export const automationCredentialRepository = new AutomationCredentialRepository();
