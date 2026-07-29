import { Types, type FilterQuery } from 'mongoose';
import {
  type AutomationCredentialDto,
  type CreateAutomationCredential,
  type ListAutomationCredentialsQuery,
  type Paginated,
  type ReplaceAutomationCredentialValue,
  type UpdateAutomationCredential,
} from '@ecms/contracts';
import { type ScopeSelector } from '../../../shared/types';
import { BusinessRuleError, NotFoundError } from '../../../shared/errors';
import { diffChanges } from '../../../shared/utils/diff';
import { auditService } from '../../../platform/audit';
import { cryptoService, CryptoUnavailableError } from '../../../platform/crypto';
import { logger } from '../../../infrastructure/logging/logger';
import { automationCredentialRepository } from './credential.repository';
import { type AutomationCredentialDoc } from './credential.model';

const entityRef = (id: string) => ({
  moduleId: 'automation',
  entityType: 'credential',
  entityId: id,
});

/**
 * The AAD a value is sealed under. Includes the record id, so a ciphertext moved to another row
 * fails authentication instead of decrypting into the wrong credential (see platform-crypto.md).
 */
const contextFor = (id: string): string => `automation_credentials:${id}:value`;

/**
 * Everything about a credential EXCEPT its value. Used for audit diffs, so that an audit row can
 * never carry what the API refuses to return.
 */
const snapshot = (doc: AutomationCredentialDoc) => ({
  key: doc.key,
  name: doc.name,
  type: doc.type,
  branchScope: doc.branchScope,
  branchId: doc.branchId === null ? null : String(doc.branchId),
  keyId: doc.sealed.keyId,
  valueVersion: doc.valueVersion,
});

export interface ResolvedSecret {
  key: string;
  type: string;
  value: string;
}

class AutomationCredentialService {
  private assertCryptoAvailable(): void {
    if (cryptoService.available()) return;
    // Better to refuse the write than to store a secret in the clear or silently drop it.
    throw new BusinessRuleError(
      'credential storage is unavailable: no encryption key is configured on this deployment',
    );
  }

  async create(input: CreateAutomationCredential, by: string): Promise<AutomationCredentialDoc> {
    this.assertCryptoAvailable();

    const existing = await automationCredentialRepository.findByKey(input.key);
    if (existing !== null) {
      throw new BusinessRuleError(`a credential with the key '${input.key}' already exists`);
    }

    // The id is minted HERE rather than by the insert, because the AAD binds the ciphertext to the
    // record id — and sealing after the insert would leave a window with a row and no value, or
    // force a second write. One id, one seal, one insert.
    const id = new Types.ObjectId();
    const sealed = cryptoService.seal(input.value, contextFor(String(id)));

    const doc = await automationCredentialRepository.create(
      {
        _id: id,
        key: input.key,
        name: input.name,
        type: input.type,
        sealed,
        ownerUserId: new Types.ObjectId(by),
        branchScope: input.branchScope,
        branchId: null,
        lastUsedAt: null,
        valueVersion: 1,
      },
      { by },
    );

    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    return doc;
  }

  /**
   * Replace the secret. There is no "edit the value" that shows the old one first — a diff would
   * require reading it back, which is the thing §7.3 exists to prevent.
   */
  async replaceValue(
    id: string,
    input: ReplaceAutomationCredentialValue,
    by: string,
    scope: ScopeSelector,
  ): Promise<AutomationCredentialDoc> {
    this.assertCryptoAvailable();
    const before = await automationCredentialRepository.getById(id, scope);
    const sealed = cryptoService.seal(input.value, contextFor(id));

    const doc = await automationCredentialRepository.updateById(
      id,
      { sealed, valueVersion: before.valueVersion + 1 },
      { by, version: input.version },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      // The VALUE never appears in the audit trail; the fact that it changed does.
      changes: diffChanges(
        { valueVersion: before.valueVersion },
        { valueVersion: doc.valueVersion },
      ),
    });
    return doc;
  }

  /** Metadata only. The value cannot be reached through this path or any other. */
  async updateMetadata(
    id: string,
    input: UpdateAutomationCredential,
    by: string,
    scope: ScopeSelector,
  ): Promise<AutomationCredentialDoc> {
    const before = await automationCredentialRepository.getById(id, scope);
    const set: Record<string, unknown> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.branchScope !== undefined) set.branchScope = input.branchScope;

    const doc = await automationCredentialRepository.updateById(id, set, {
      by,
      version: input.version,
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(doc)),
    });
    return doc;
  }

  async softDelete(id: string, by: string, scope: ScopeSelector): Promise<void> {
    await automationCredentialRepository.getById(id, scope);
    await automationCredentialRepository.softDeleteById(id, { by });
    await auditService.record({ entityRef: entityRef(id), action: 'delete' });
  }

  async getById(id: string, scope: ScopeSelector): Promise<AutomationCredentialDoc> {
    return automationCredentialRepository.getById(id, scope);
  }

  async list(
    query: ListAutomationCredentialsQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<AutomationCredentialDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.type !== undefined) filter.type = query.type;
    if (query.branchId !== undefined) filter.branchId = new Types.ObjectId(query.branchId);
    if (query.q !== undefined) {
      const pattern = new RegExp(query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ key: pattern }, { 'name.ar': pattern }, { 'name.en': pattern }];
    }
    return automationCredentialRepository.list({
      filter: filter as FilterQuery<AutomationCredentialDoc>,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['key', 'type', 'lastUsedAt', 'createdAt'],
      scope,
    });
  }

  // ── Internal: the only place a plaintext secret exists ────────────────────
  // Reachable from the dispatcher (A-5/A-6) and from nowhere on the HTTP surface. Not exported
  // through the module barrel for the same reason.

  /**
   * Open the named credentials for one execution. The caller holds the values in memory for the
   * duration of the run and must never persist, log or snapshot them — `redactSnapshot` is what
   * keeps that promise on the way to `automation_executions`.
   */
  async resolveForExecution(keys: readonly string[]): Promise<ResolvedSecret[]> {
    const resolved: ResolvedSecret[] = [];
    for (const key of keys) {
      const doc = await automationCredentialRepository.findByKey(key);
      if (doc === null) throw new NotFoundError(`Credential '${key}' not found`);

      try {
        const value = cryptoService.open(doc.sealed, contextFor(String(doc._id)));
        resolved.push({ key: doc.key, type: doc.type, value });
        await automationCredentialRepository.touchLastUsed(String(doc._id));
      } catch (error) {
        // Never include the sealed document or the error's own message in a log line: the message
        // distinguishes tamper from wrong-key, which is operationally useful and is exactly the
        // oracle an attacker probing the store would want.
        logger.error(
          { credentialKey: doc.key, keyId: doc.sealed.keyId },
          'automation: failed to open a credential',
        );
        throw error instanceof CryptoUnavailableError
          ? error
          : new BusinessRuleError(`credential '${key}' could not be opened`);
      }
    }
    return resolved;
  }

  /**
   * Re-wrap everything not on the active key (§7.3). Unwraps and re-wraps the DATA KEY only — the
   * ciphertext is untouched and no plaintext exists at any point, which is what lets this run
   * unattended on a schedule instead of asking humans to re-enter secrets.
   */
  async rotateKeys(batchSize = 200): Promise<{ rotated: number; failed: number }> {
    if (!cryptoService.available()) return { rotated: 0, failed: 0 };
    const activeKeyId = cryptoService.status().activeKeyId;
    const stale = await automationCredentialRepository.listNotOnKey(activeKeyId, batchSize);

    let rotated = 0;
    let failed = 0;
    for (const doc of stale) {
      try {
        const sealed = cryptoService.rewrap(doc.sealed);
        await automationCredentialRepository.updateById(
          String(doc._id),
          { sealed },
          { by: null, version: doc.__v },
        );
        rotated += 1;
      } catch {
        // One credential on a key that has already left the ring must not stop the sweep for the
        // rest — and it is recoverable by putting the key back, so it is a count, not a throw.
        failed += 1;
      }
    }
    if (rotated > 0 || failed > 0) {
      logger.info({ activeKeyId, rotated, failed }, 'automation: credential key rotation pass');
    }
    return { rotated, failed };
  }

  toDto(doc: AutomationCredentialDoc): AutomationCredentialDto {
    return {
      id: String(doc._id),
      key: doc.key,
      name: doc.name,
      type: doc.type,
      // A fixed mask, never a prefix of the real value: a prefix leaks entropy and, for a short
      // secret, most of the secret.
      masked: '••••••••',
      branchScope: doc.branchScope,
      branchId: doc.branchId === null ? null : String(doc.branchId),
      ownerUserId: doc.ownerUserId === null ? null : String(doc.ownerUserId),
      lastUsedAt: doc.lastUsedAt === null ? null : doc.lastUsedAt.toISOString(),
      keyId: doc.sealed.keyId,
      version: doc.__v,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }
}

export const automationCredentialService = new AutomationCredentialService();
