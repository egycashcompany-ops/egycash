// Hierarchical, typed settings (Platform Core §5, ADR-015):
// resolution chain user → branch → organization → code default. Values are
// Zod-validated against the declared type; unknown keys are rejected.
import { Types } from 'mongoose';
import {
  ErrorCodes,
  PlatformEvents,
  featureFlags,
  type FeatureFlagStateDto,
  type ResolvedSettingDto,
  type SettingDefinitionDto,
  type SettingScope,
  type SetSetting,
} from '@ecms/contracts';
import { BusinessRuleError, ForbiddenError, ValidationError } from '../../shared/errors';
import {
  type AuthContext,
  keyReachesBranch,
} from '../../shared/types';
import { getCache } from '../../infrastructure/redis/cache';
import { auditService } from '../audit';
import { emit } from '../kernel/event-bus';
import {
  flagSettingKey,
  getSettingDeclaration,
  listSettingDeclarations,
  type SettingDeclaration,
} from './settings.registry';
import { SettingValueModel, type SettingValueDoc } from './setting-value.model';

const CACHE_TTL_SECONDS = 60;

export interface SettingSubject {
  userId: string | null;
  branchId: string | null;
}

interface ResolvedValue {
  value: unknown;
  resolvedFrom: SettingScope | 'default';
}

interface ScopeCandidate {
  scope: SettingScope;
  scopeRef: Types.ObjectId | null;
}

type StoredValue = Pick<SettingValueDoc, 'key' | 'scope' | 'scopeRef' | 'value'>;

/**
 * Where a declaration may hold a value for this subject, MOST SPECIFIC FIRST — the order is the
 * precedence (user → branch → organization, ADR-015). A scope the declaration does not allow is
 * never a candidate, so a row stored there is never read.
 */
const candidatesFor = (
  declaration: SettingDeclaration,
  subject: SettingSubject,
): ScopeCandidate[] => {
  const candidates: ScopeCandidate[] = [];
  if (subject.userId !== null && declaration.allowedScopes.includes('user')) {
    candidates.push({ scope: 'user', scopeRef: new Types.ObjectId(subject.userId) });
  }
  if (subject.branchId !== null && declaration.allowedScopes.includes('branch')) {
    candidates.push({ scope: 'branch', scopeRef: new Types.ObjectId(subject.branchId) });
  }
  if (declaration.allowedScopes.includes('organization')) {
    candidates.push({ scope: 'organization', scopeRef: null });
  }
  return candidates;
};

/**
 * The first candidate holding a value that still parses wins; with none, the code default. `rows`
 * are the declaration's own stored values — any scopes, in any order. One rule for the single-key
 * read and the read-everything one, so the two cannot disagree about a value.
 */
const pickResolved = (
  declaration: SettingDeclaration,
  candidates: readonly ScopeCandidate[],
  rows: readonly StoredValue[],
): ResolvedValue => {
  for (const candidate of candidates) {
    const row = rows.find(
      (r) =>
        r.scope === candidate.scope &&
        String(r.scopeRef ?? '') === String(candidate.scopeRef ?? ''),
    );
    if (row !== undefined) {
      const parsed = declaration.schema.safeParse(row.value);
      if (parsed.success) return { value: parsed.data, resolvedFrom: candidate.scope };
      // A stored value that no longer matches the declared type is skipped, not fatal.
    }
  }
  return { value: declaration.defaultValue, resolvedFrom: 'default' };
};

class SettingsService {
  private cacheKey(key: string, subject: SettingSubject): string {
    return `settings:${key}:u:${subject.userId ?? '-'}:b:${subject.branchId ?? '-'}`;
  }

  private async resolveUncached(
    declaration: SettingDeclaration,
    subject: SettingSubject,
  ): Promise<ResolvedValue> {
    const candidates = candidatesFor(declaration, subject);
    if (candidates.length === 0) return pickResolved(declaration, candidates, []);
    const rows = await SettingValueModel.find({
      key: declaration.key,
      $or: candidates.map((c) => ({ scope: c.scope, scopeRef: c.scopeRef })),
    })
      .lean<StoredValue[]>()
      .exec();
    return pickResolved(declaration, candidates, rows);
  }

  async resolve<T = unknown>(key: string, subject: SettingSubject): Promise<T> {
    const declaration = getSettingDeclaration(key);
    if (declaration === undefined) {
      throw new BusinessRuleError(`Unknown setting key: ${key}`, ErrorCodes.SETTING_UNKNOWN_KEY);
    }
    const cache = getCache();
    const cacheKey = this.cacheKey(key, subject);
    const cached = await cache.get(cacheKey);
    if (cached !== null) return (JSON.parse(cached) as ResolvedValue).value as T;

    const resolved = await this.resolveUncached(declaration, subject);
    await cache.set(cacheKey, JSON.stringify(resolved), CACHE_TTL_SECONDS);
    return resolved.value as T;
  }

  /**
   * Every declared setting for one subject, in ONE query. It used to be `resolveUncached` once per
   * declaration — a sequential round trip each, fifty-seven of them in production behind every
   * `GET /platform/settings/me`. Now every declared key at every scope this subject could be
   * answered from is read together, and each declaration then takes its value with the same rule
   * the single-key read uses (`pickResolved`). The query may return a row at a scope one
   * declaration does not allow (another one does); that declaration's candidates never name it,
   * so it is never read — exactly as before.
   */
  async resolveAll(subject: SettingSubject): Promise<ResolvedSettingDto[]> {
    const plans = listSettingDeclarations().map((declaration) => ({
      declaration,
      candidates: candidatesFor(declaration, subject),
    }));
    const keys = plans.filter((p) => p.candidates.length > 0).map((p) => p.declaration.key);
    // One candidate per scope: a scope's reference is the subject's, whichever declaration names it.
    const scopes = new Map<SettingScope, ScopeCandidate>();
    for (const { candidates } of plans) {
      for (const candidate of candidates) scopes.set(candidate.scope, candidate);
    }

    const rows =
      keys.length === 0
        ? []
        : await SettingValueModel.find({
            key: { $in: keys },
            $or: [...scopes.values()].map((c) => ({ scope: c.scope, scopeRef: c.scopeRef })),
          })
            .lean<StoredValue[]>()
            .exec();
    const rowsByKey = new Map<string, StoredValue[]>();
    for (const row of rows) {
      const own = rowsByKey.get(row.key);
      if (own === undefined) rowsByKey.set(row.key, [row]);
      else own.push(row);
    }

    return plans.map(({ declaration, candidates }) => {
      const resolved = pickResolved(declaration, candidates, rowsByKey.get(declaration.key) ?? []);
      return {
        key: declaration.key,
        value: resolved.value,
        resolvedFrom: resolved.resolvedFrom,
      };
    });
  }

  /**
   * Scope authority: `setting.edit @ organization` sets anything; `@ branch` sets the branches
   * that key covers WHOLLY (their own, and any their grants add as whole branches — a department
   * in a branch is not the branch) and own user values; `@ own` sets own user values only.
   */
  private assertEditAuthority(
    ctx: AuthContext,
    scope: SettingScope,
    scopeRef: string | null,
  ): void {
    const editScope = ctx.permissions['setting.edit'];
    if (editScope === undefined) throw new ForbiddenError();
    if (editScope === 'organization') return;
    if (scope === 'user' && scopeRef === ctx.userId) return;
    if (
      editScope === 'branch' &&
      scope === 'branch' &&
      scopeRef !== null &&
      keyReachesBranch(ctx, 'setting.edit', scopeRef)
    )
      return;
    throw new ForbiddenError('setting.edit scope does not cover the requested target');
  }

  async set(ctx: AuthContext, input: SetSetting): Promise<void> {
    const declaration = getSettingDeclaration(input.key);
    if (declaration === undefined) {
      throw new BusinessRuleError(
        `Unknown setting key: ${input.key}`,
        ErrorCodes.SETTING_UNKNOWN_KEY,
      );
    }
    if (!declaration.allowedScopes.includes(input.scope)) {
      throw new BusinessRuleError(
        `Setting ${input.key} cannot be set at ${input.scope} scope`,
        ErrorCodes.SETTING_SCOPE_NOT_ALLOWED,
      );
    }
    const scopeRef = input.scope === 'organization' ? null : (input.scopeRef ?? null);
    if (input.scope !== 'organization' && scopeRef === null) {
      throw new ValidationError([
        { field: 'body.scopeRef', code: 'REQUIRED', message: 'scopeRef required for this scope' },
      ]);
    }
    this.assertEditAuthority(ctx, input.scope, scopeRef);

    const parsed = declaration.schema.safeParse(input.value);
    if (!parsed.success) {
      throw new BusinessRuleError(
        `Invalid value for ${input.key}: ${parsed.error.issues[0]?.message ?? 'type mismatch'}`,
        ErrorCodes.SETTING_INVALID_VALUE,
      );
    }

    const previous = await SettingValueModel.findOneAndUpdate(
      {
        key: input.key,
        scope: input.scope,
        scopeRef: scopeRef === null ? null : new Types.ObjectId(scopeRef),
      },
      {
        $set: { value: parsed.data, updatedBy: new Types.ObjectId(ctx.userId) },
      },
      { upsert: true, new: false },
    )
      .lean()
      .exec();

    await getCache().delByPrefix(`settings:${input.key}:`);

    await auditService.record({
      entityRef: { moduleId: 'platform', entityType: 'setting', entityId: input.key },
      action: 'settingChanged',
      changes: [
        {
          field: `${input.scope}${scopeRef === null ? '' : `:${scopeRef}`}`,
          old: previous?.value ?? null,
          new: parsed.data,
        },
      ],
    });
    await emit(PlatformEvents.SettingsChanged, {
      key: input.key,
      scope: input.scope,
      scopeRef,
    });
  }

  listDefinitions(): SettingDefinitionDto[] {
    return listSettingDeclarations().map((declaration) => ({
      key: declaration.key,
      description: declaration.description,
      // Zod keeps the type name in _def; the public API has no accessor for it.
      type: ((declaration.schema._def as { typeName?: string }).typeName ?? 'unknown')
        .replace(/^Zod/, '')
        .toLowerCase(),
      defaultValue: declaration.defaultValue,
      allowedScopes: declaration.allowedScopes,
    }));
  }

  // ── Feature flags (Review R27) ────────────────────────────────────────────

  async getFlagsFor(subject: SettingSubject): Promise<Record<string, boolean>> {
    const out: Record<string, boolean> = {};
    for (const flag of featureFlags) {
      out[flag.key] = await this.resolve<boolean>(flagSettingKey(flag.key), subject);
    }
    return out;
  }

  async listFlagStates(subject: SettingSubject): Promise<FeatureFlagStateDto[]> {
    const states: FeatureFlagStateDto[] = [];
    for (const flag of featureFlags) {
      states.push({
        key: flag.key,
        description: flag.description,
        owner: flag.owner,
        expiresAt: flag.expiresAt,
        defaultValue: flag.defaultValue,
        value: await this.resolve<boolean>(flagSettingKey(flag.key), subject),
      });
    }
    return states;
  }
}

export const settingsService = new SettingsService();
