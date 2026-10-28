// Who may administer /atm/settings — «إعدادات الصراف الآلي»: the maintenance mailbox the central
// reader polls and the branches that work as one in ATM.
//
// `atmSettings.manage`, held at ORGANIZATION scope (the `atmBank.*` rule, catalogs/
// bank.service.ts): one mailbox serves every branch, and which branch works as which is one fact
// about the company — a branch-scoped holder editing either would be editing it for everybody.
import { ForbiddenError } from '../../../shared/errors';
import { scopeOf, type AuthContext } from '../../../shared/types';

export const ATM_SETTINGS_KEY = 'atmSettings.manage';

/** 403 unless the caller holds `atmSettings.manage` company-wide. */
export const assertAtmSettingsManager = (ctx: AuthContext): void => {
  if (scopeOf(ctx, ATM_SETTINGS_KEY) !== 'organization') {
    throw new ForbiddenError(
      `${ATM_SETTINGS_KEY} must be held at organization scope — ` +
        'the mailbox and the branch links are company-wide',
    );
  }
};

/**
 * The context an ATM-owned platform setting is written with, once `assertAtmSettingsManager` has
 * passed. The platform settings service guards the GENERIC settings screen with `setting.edit`;
 * this screen's authority is the module's own key, so the one write is made with `setting.edit`
 * added at organization scope (the seed's synthetic context does the same, seed-data.ts). The
 * caller stays the actor: the settings audit reads it from the request, not from this context.
 */
export const asSettingsEditor = (ctx: AuthContext): AuthContext => ({
  ...ctx,
  permissions: { ...ctx.permissions, 'setting.edit': 'organization' },
});
