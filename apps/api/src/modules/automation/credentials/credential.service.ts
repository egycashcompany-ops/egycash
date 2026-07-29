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
import { getSecretStore, SecretStoreMismatchError } from '../../../platform/secrets';
import { logger } from '../../../infrastructure/logging/logger';
import { automationCredentialRepository } from './credential.repository';
import { type AutomationCredentialDoc } from './credential.model';

const entityRef = (id: string) => ({
  moduleId: 'automation',
  entityType: 'credential',
  entityId: id,
});

/**
 * The context a value is sealed under. Includes the record id, so a ref moved to another row fails
 * to open instead of resolving into the wrong credential (see platform-crypto.md / secret-store).
 */
const contextFor = (id: string): string => `automation_credentials:${id}:value`;

/**
 * Everything about a credential EXCEPT its value. Used for audit diffs, so an audit row can never
 * carry what the API refuses to return.
 */
const snapshot = (doc: AutomationCredentialDoc) => ({
  key: doc.key,
  name: doc.name,
  type: doc.type,
  branchScope: doc.branchScope,
  branchId: doc.branchId === null ? null : String(doc.branchId),
  provider: doc.secretRef.provider,
  keyId: doc.secretRef.keyId,
  valueVersion: doc.valueVersion,
});

export interface ResolvedSecret {
  key: string;
  type: string;
  value: string;
}

/**
 * Who and what is opening a credential, for the usage audit (§7.4 · approver request 2026-07-29).
 * Carries no secret — it exists precisely so usage can be traced WITHOUT exposing the value. The
 * dispatcher (A-5/A-6) supplies it; every field is nullable so an early caller can pass what it
 * knows and the audit degrades to "less context" rather than "no audit".
 */
export interface CredentialUsageContext {
  workflowId: string | null;
  executionId: string | null;
  /** The automation provider running the workflow, e.g. `n8n` or `null`. */
  provider: string;
  principal: { userId: string | null; kind: 'user' | 'system' | 'automation' };
  branchId: string | null;
}

class AutomationCredentialService {
  private assertStoreAvailable(): void {
    if (getSecretStore().available()) return;
    // Better to refuse the write than to store a secret in the clear or silently drop it.
    throw new BusinessRuleError(
      'credential storage is unavailable: the secret store has no usable key on this deployment',
    );
  }

  async create(input: CreateAutomationCredential, by: string): Promise<AutomationCredentialDoc> {
    this.assertStoreAvailable();

    const existing = await automationCredentialRepository.findByKey(input.key);
    if (existing !== null) {
      throw new BusinessRuleError(`a credential with the key '${input.key}' already exists`);
    }

    // The id is minted HERE, not by the insert, because the sealing context binds the ref to the
    // record id — sealing after the insert would leave a window with a row and no value.
    const id = new Types.ObjectId();
    const secretRef = await getSecretStore().seal(input.value, contextFor(String(id)));

    const doc = await automationCredentialRepository.create(
      {
        _id: id,
        key: input.key,
        name: input.name,
        type: input.type,
        secretRef,
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
    this.assertStoreAvailable();
    const before = await automationCredentialRepository.getById(id, scope);
    const secretRef = await getSecretStore().seal(input.value, contextFor(id));

    const doc = await automationCredentialRepository.updateById(
      id,
      { secretRef, valueVersion: before.valueVersion + 1 },
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
  // Reachable from the dispatcher (A-5/A-6) and from nowhere on the HTTP surface.

  /**
   * Open the named credentials for one execution, and AUDIT each open (approver request). The
   * audit records credential, workflow, execution, provider, principal, branch, time and
   * success/failure — never the value, which is what makes usage traceable without exposing it.
   *
   * The caller holds the returned values in memory for the run and must never persist, log or
   * snapshot them; `redactSnapshot` keeps that promise on the way to `automation_executions`.
   */
  async resolveForExecution(
    keys: readonly string[],
    usage: CredentialUsageContext,
  ): Promise<ResolvedSecret[]> {
    const resolved: ResolvedSecret[] = [];
    for (const key of keys) {
      const doc = await automationCredentialRepository.findByKey(key);
      if (doc === null) {
        // Audit the failed attempt too: "a workflow tried to use a credential that is gone" is
        // exactly the kind of thing a usage audit exists to surface.
        await this.recordUsage(null, key, usage, 'failure', 'not-found');
        throw new NotFoundError(`Credential '${key}' not found`);
      }

      try {
        const value = await getSecretStore().open(doc.secretRef, contextFor(String(doc._id)));
        resolved.push({ key: doc.key, type: doc.type, value });
        await automationCredentialRepository.touchLastUsed(String(doc._id));
        await this.recordUsage(doc, key, usage, 'success');
      } catch (error) {
        await this.recordUsage(doc, key, usage, 'failure', this.failureReason(error));
        // Never include the sealed ref or the error's own message in a log line: the message
        // distinguishes tamper from wrong-key, which is the oracle an attacker would want.
        logger.error(
          { credentialKey: doc.key, provider: doc.secretRef.provider, keyId: doc.secretRef.keyId },
          'automation: failed to open a credential',
        );
        throw error instanceof BusinessRuleError
          ? error
          : new BusinessRuleError(`credential '${key}' could not be opened`);
      }
    }
    return resolved;
  }

  private failureReason(error: unknown): string {
    if (error instanceof SecretStoreMismatchError) return 'store-mismatch';
    return 'open-failed';
  }

  /**
   * One audit row per credential open. The traceability fields ride in `changes` (the audit
   * contract's structured slot) as `null → value` entries, so they read naturally in the log
   * without widening the platform audit schema.
   */
  private async recordUsage(
    doc: AutomationCredentialDoc | null,
    key: string,
    usage: CredentialUsageContext,
    outcome: 'success' | 'failure',
    detail?: string,
  ): Promise<void> {
    const entry = (field: string, value: unknown) => ({ field, old: null, new: value });
    await auditService.record({
      // Anchored on the credential when we found it, else on its key so the row is still findable.
      entityRef: entityRef(doc === null ? key : String(doc._id)),
      action: 'automationCredentialUsed',
      actor: { userId: usage.principal.userId, ip: null, userAgent: null },
      changes: [
        entry('credentialKey', key),
        entry('outcome', outcome),
        ...(detail === undefined ? [] : [entry('detail', detail)]),
        entry('workflowId', usage.workflowId),
        entry('executionId', usage.executionId),
        entry('provider', usage.provider),
        entry('principalKind', usage.principal.kind),
        entry('branchId', usage.branchId),
        ...(doc === null ? [] : [entry('credentialType', doc.type), entry('store', doc.secretRef.provider)]),
      ],
    });
  }

  /**
   * Re-wrap everything not on the current key (§7.3), through the secret store so a KMS/vault
   * backend rotates the same way. The store touches only the wrapping — no plaintext exists at any
   * point — which is what lets this run unattended instead of asking humans to re-enter secrets.
   */
  async rotateKeys(batchSize = 200): Promise<{ rotated: number; failed: number }> {
    const store = getSecretStore();
    const status = store.status();
    // A backend that rotates itself (a KMS) or has no key configured has nothing for us to drive.
    if (!status.available || !status.rotatable || status.currentKeyId === null) {
      return { rotated: 0, failed: 0 };
    }
    const stale = await automationCredentialRepository.listNotOnKey(status.currentKeyId, batchSize);

    let rotated = 0;
    let failed = 0;
    for (const doc of stale) {
      try {
        const secretRef = await store.rewrap(doc.secretRef);
        await automationCredentialRepository.updateById(
          String(doc._id),
          { secretRef },
          { by: null, version: doc.__v },
        );
        rotated += 1;
      } catch {
        // One credential on a key that already left the ring must not stop the sweep — it is
        // recoverable by restoring the key, so it is a count, not a throw.
        failed += 1;
      }
    }
    if (rotated > 0 || failed > 0) {
      logger.info(
        { provider: status.provider, currentKeyId: status.currentKeyId, rotated, failed },
        'automation: credential key rotation pass',
      );
    }
    return { rotated, failed };
  }

  toDto(doc: AutomationCredentialDoc): AutomationCredentialDto {
    return {
      id: String(doc._id),
      key: doc.key,
      name: doc.name,
      type: doc.type,
      // Where the secret lives — metadata an operator needs, never the secret itself.
      provider: doc.secretRef.provider,
      // A fixed mask, never a prefix of the real value: a prefix leaks entropy and, for a short
      // secret, most of the secret.
      masked: '••••••••',
      branchScope: doc.branchScope,
      branchId: doc.branchId === null ? null : String(doc.branchId),
      ownerUserId: doc.ownerUserId === null ? null : String(doc.ownerUserId),
      lastUsedAt: doc.lastUsedAt === null ? null : doc.lastUsedAt.toISOString(),
      keyId: doc.secretRef.keyId,
      version: doc.__v,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }
}

export const automationCredentialService = new AutomationCredentialService();
