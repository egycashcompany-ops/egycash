// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type CreateGoldKeyHandover,
  type GoldKeyHolderDto,
  type GoldKeysOverviewDto,
  type ListGoldKeysQuery,
} from '@ecms/contracts';
import { authContext } from '../../../platform/auth';
import { created, noContent, ok, validated } from '../../../platform/web';
import { directoryProfileService } from '../../../platform/directory';
import { scopeSelector } from '../../../shared/types';
import { goldDrawerRepository } from '../vaults/drawer.repository';
import { goldRepresentativeRepository } from '../representatives/representative.repository';
import { toGoldKeyHandoverDto } from '../gold.mappers';
import { resolveGoldLabels } from '../shared/labels';
import { goldKeyHandoverService } from './key-handover.service';
import { type GoldKeyHandoverDoc } from './key-handover.model';

type IdParam = { id: string };

/**
 * Everything a page of key rows renders: the owner, the holder (with their phone and national id,
 * which the printed handover slip carries), the vault name, the drawer number, and the ECMS user
 * who handed the key over. Resolved once for the page.
 */
const decorate = async (docs: GoldKeyHandoverDoc[]) => {
  const [labels, drawers, reps, users] = await Promise.all([
    resolveGoldLabels({
      companyIds: docs.map((k) => k.companyId),
      representativeIds: docs.map((k) => k.representativeId),
      vaultNameIds: docs.map((k) => k.vaultId),
      branches: true,
    }),
    Promise.all(docs.map(async (k) => goldDrawerRepository.findById(String(k.drawerId)))),
    Promise.all(
      docs.map(async (k) => goldRepresentativeRepository.findById(String(k.representativeId))),
    ),
    directoryProfileService.resolve([
      ...new Set(
        docs
          .flatMap((k) => [k.handedOverByUserId, k.returnedByUserId])
          .filter((v) => v !== null)
          .map(String),
      ),
    ]),
  ]);
  // The Arabic side of the profile's localized name — this module's screens are Arabic-first, and
  // the handover slip prints the name the operator signed with.
  const userNames = new Map([...users.values()].map((p) => [p.userId, p.displayName.ar]));
  return docs.map((doc, i) =>
    toGoldKeyHandoverDto(
      doc,
      { ...labels, users: userNames },
      { phone: reps[i]?.phone ?? null, nationalId: reps[i]?.nationalId ?? null },
      { number: drawers[i]?.number ?? null, label: drawers[i]?.label ?? null },
    ),
  );
};

export const listGoldKeys = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListGoldKeysQuery>(req);
  const ctx = authContext(req);
  const page = await goldKeyHandoverService.list(query, scopeSelector(ctx, 'goldKey.view'));
  ok(res, await decorate(page.items), page.meta);
};

export const goldKeysOverview = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { totalDrawers, active, holders, companies } = await goldKeyHandoverService.overview(
    scopeSelector(ctx, 'goldKey.view'),
  );
  const byDrawer: Record<string, GoldKeyHolderDto> = {};
  for (const key of active) {
    byDrawer[String(key.drawerId)] = {
      holder: holders.get(String(key.representativeId)) ?? '—',
      company: companies.get(String(key.companyId)) ?? '—',
      date: key.handoverDate.toISOString(),
    };
  }
  const payload: GoldKeysOverviewDto = {
    totalDrawers,
    handedOver: active.length,
    notHandedOver: Math.max(totalDrawers - active.length, 0),
    byDrawer,
  };
  ok(res, payload);
};

export const getGoldKey = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const ctx = authContext(req);
  const doc = await goldKeyHandoverService.getById(params.id, scopeSelector(ctx, 'goldKey.view'));
  const [dto] = await decorate([doc]);
  ok(res, dto);
};

export const createGoldKey = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateGoldKeyHandover>(req);
  const doc = await goldKeyHandoverService.create(body, authContext(req).userId);
  const [dto] = await decorate([doc]);
  created(res, dto);
};

export const returnGoldKey = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const ctx = authContext(req);
  const doc = await goldKeyHandoverService.returnKey(
    params.id,
    ctx.userId,
    scopeSelector(ctx, 'goldKey.return'),
  );
  const [dto] = await decorate([doc]);
  ok(res, dto);
};

export const deleteGoldKey = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const ctx = authContext(req);
  await goldKeyHandoverService.remove(params.id, ctx.userId, scopeSelector(ctx, 'goldKey.delete'));
  noContent(res);
};
