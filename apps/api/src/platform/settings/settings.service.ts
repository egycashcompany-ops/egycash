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
import { type AuthContext } from '../../shared/types';
import { getCache } from '../../infrastructure/redis/cache';
import { auditService } from '../audit';
import { emit } from '../kernel/event-bus';
import {
  flagSettingKey,
  getSettingDeclaration,
  listSettingDeclarations,
  type SettingDeclaration,
} from './settings.registry';
import { SettingValueModel } from './setting-value.model';

const CACHE_TTL_SECONDS = 60;

export interface SettingSubject {
  userId: string | null;
  branchId: string | null;
}

interface ResolvedValue {
  value: unknown;
  resolvedFrom: SettingScope | 'default';
}

class SettingsService {
  private cacheKey(key: string, subject: SettingSubject): string {
    return `settings:${key}:u:${subject.userId ?? '-'}:b:${subject.branchId ?? '-'}`;
  }

  private async resolveUncached(
    declaration: SettingDeclaration,
    subject: SettingSubject,
  ): Promise<ResolvedValue> {
    const candidates: { scope: SettingScope; scopeRef: Types.ObjectId | null }[] = [];
    if (subject.userId !== null && declaration.allowedScopes.includes('user')) {
      candidates.push({ scope: 'user', scopeRef: new Types.ObjectId(subject.userId) });
    }
    if (subject.branchId !== null && declaration.allowedScopes.includes('branch')) {
      candidates.push({ scope: 'branch', scopeRef: new Types.ObjectId(subject.branchId) });
    }
    if (declaration.allowedScopes.includes('organization')) {
      candidates.push({ scope: 'organization', scopeRef: null });
    }

    if (candidates.length > 0) {
      const rows = await SettingValueModel.find({
        key: declaration.key,
        $or: candidates.map((c) => ({ scope: c.scope, scopeRef: c.scopeRef })),
      })
        .lean()
        .exec();
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
    }
    return { value: declaration.defaultValue, resolvedFrom: 'default' };
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

  async resolveAll(subject: SettingSubject): Promise<ResolvedSettingDto[]> {
    const out: ResolvedSettingDto[] = [];
    for (const declaration of listSettingDeclarations()) {
      const resolved = await this.resolveUncached(declaration, subject);
      out.push({
        key: declaration.key,
        value: resolved.value,
        resolvedFrom: resolved.resolvedFrom,
      });
    }
    return out;
  }

  /**
   * Scope authority: `setting.edit @ organization` sets anything; `@ branch` sets its own
   * branch and own user values; `@ own` sets own user values only.
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
      scopeRef === ctx.branchId
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
