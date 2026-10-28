// GET/PUT /atm/branch-links — «فروع تعمل معاً» on /atm/settings (setting `atm.branchLinks`; what a
// link does on a request is link-context.ts).
//
// `atmSettings.manage` at ORGANIZATION scope (shared/settings-authority.ts). The list is written
// THROUGH the platform settings service, so the change is audited (`platform.setting`) and every
// cached read of it — the refiner reads it on each ATM request — is dropped at once.
//
// The contract refuses a list that breaks its shape (a branch acting as itself, a source on two
// rows, a chain); this service adds the one rule the contract cannot see: both branches exist and
// are active. A link to a retired or unknown branch would file October's ATM work under a branch
// nobody can open.
import {
  AtmSettingKeys,
  type AtmBranchLinksDto,
  type AtmBranchLinksSetting,
  type SaveAtmBranchLinks,
} from '@ecms/contracts';
import { branchRepository } from '../../../platform/organization';
import { settingsService } from '../../../platform/settings';
import { ValidationError } from '../../../shared/errors';
import { type AuthContext } from '../../../shared/types';
import { asSettingsEditor, assertAtmSettingsManager } from '../shared/settings-authority';

const ORG_SUBJECT = { userId: null, branchId: null };

const LINK_FIELDS = ['branchId', 'actsAsBranchId'] as const;

class AtmBranchLinksService {
  async get(ctx: AuthContext): Promise<AtmBranchLinksDto> {
    assertAtmSettingsManager(ctx);
    return this.toDto(
      await settingsService.resolve<AtmBranchLinksSetting>(AtmSettingKeys.BranchLinks, ORG_SUBJECT),
    );
  }

  /** The whole list, replacing the stored one. 400 at the row and field naming a dead branch. */
  async save(input: SaveAtmBranchLinks, ctx: AuthContext): Promise<AtmBranchLinksDto> {
    assertAtmSettingsManager(ctx);
    const branches = await branchRepository.findByIdsSystem(
      input.links.flatMap((link) => [link.branchId, link.actsAsBranchId]),
    );
    const live = new Set(
      branches
        .filter((branch) => !branch.isDeleted && branch.status === 'active')
        .map((branch) => String(branch._id)),
    );
    const issues = input.links.flatMap((link, index) =>
      LINK_FIELDS.filter((field) => !live.has(link[field])).map((field) => ({
        field: `body.links.${String(index)}.${field}`,
        code: 'BRANCH_NOT_ACTIVE',
        message: 'the branch does not exist or is not active',
      })),
    );
    if (issues.length > 0) throw new ValidationError(issues);

    await settingsService.set(asSettingsEditor(ctx), {
      key: AtmSettingKeys.BranchLinks,
      scope: 'organization',
      value: input.links,
    });
    return this.toDto(input.links);
  }

  /** Names resolved for the card; a branch gone since is named null so its row can be removed. */
  private async toDto(links: AtmBranchLinksSetting): Promise<AtmBranchLinksDto> {
    const branches = await branchRepository.findByIdsSystem(
      links.flatMap((link) => [link.branchId, link.actsAsBranchId]),
    );
    const named = new Map(
      branches
        .filter((branch) => !branch.isDeleted)
        .map((branch) => [String(branch._id), { ar: branch.name.ar, en: branch.name.en }]),
    );
    return {
      links: links.map((link) => ({
        branchId: link.branchId,
        branchName: named.get(link.branchId) ?? null,
        actsAsBranchId: link.actsAsBranchId,
        actsAsBranchName: named.get(link.actsAsBranchId) ?? null,
      })),
    };
  }
}

export const atmBranchLinksService = new AtmBranchLinksService();
