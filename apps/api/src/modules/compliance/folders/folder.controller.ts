// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type ComplianceFolderDto,
  type ComplianceVersionQuery,
  type CreateComplianceFolder,
  type ListComplianceFoldersQuery,
  type SetComplianceFolderCover,
  type UpdateComplianceFolder,
} from '@ecms/contracts';
import { created, noContent, ok, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { type AuthContext } from '../../../shared/types';
import { toComplianceFolderDto } from '../compliance.mappers';
import { complianceDocumentRepository } from '../documents/document.repository';
import { compliancePeopleService } from '../people/people.service';
import { isComplianceManager } from '../shared/authority';
import { coverBinary, requireFile } from '../shared/file-intake';
import { type ComplianceFolderDoc } from './folder.model';
import { complianceFolderService as service } from './folder.service';

type IdParam = { id: string };

/** A page of folders as this caller may see them: counts for all, the lists for the manager. */
const present = async (
  ctx: AuthContext,
  docs: readonly ComplianceFolderDoc[],
): Promise<ComplianceFolderDto[]> => {
  const ids = docs.map((doc) => String(doc._id));
  const counts = await complianceDocumentRepository.countByFolder(ids);
  const people = isComplianceManager(ctx)
    ? await compliancePeopleService.byIds(
        docs.flatMap((doc) => doc.viewerUserIds.map(String)),
        ctx.userId,
      )
    : null;
  return docs.map((doc) => toComplianceFolderDto(doc, counts.get(String(doc._id)) ?? 0, people));
};

const one = async (ctx: AuthContext, doc: ComplianceFolderDoc): Promise<ComplianceFolderDto> => {
  const [dto] = await present(ctx, [doc]);
  if (dto === undefined) throw new Error('a folder presented as nothing');
  return dto;
};

export const listComplianceFolders = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListComplianceFoldersQuery>(req);
  const ctx = authContext(req);
  const page = await service.list(ctx, query);
  ok(res, await present(ctx, page.items), page.meta);
};

export const getComplianceFolder = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const ctx = authContext(req);
  ok(res, await one(ctx, await service.getReadable(ctx, params.id)));
};

export const createComplianceFolder = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateComplianceFolder>(req);
  const ctx = authContext(req);
  created(res, await one(ctx, await service.create(ctx, body)));
};

export const updateComplianceFolder = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateComplianceFolder, never, IdParam>(req);
  const ctx = authContext(req);
  ok(res, await one(ctx, await service.update(ctx, params.id, body)));
};

export const deleteComplianceFolder = async (req: Request, res: Response): Promise<void> => {
  const { query, params } = validated<never, ComplianceVersionQuery, IdParam>(req);
  await service.remove(authContext(req), params.id, query.version);
  noContent(res);
};

export const setComplianceFolderCover = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<SetComplianceFolderCover, never, IdParam>(req);
  const ctx = authContext(req);
  const binary = coverBinary(requireFile(req.file));
  ok(res, await one(ctx, await service.setCover(ctx, params.id, body.version, binary)));
};

export const removeComplianceFolderCover = async (req: Request, res: Response): Promise<void> => {
  const { query, params } = validated<never, ComplianceVersionQuery, IdParam>(req);
  const ctx = authContext(req);
  ok(res, await one(ctx, await service.removeCover(ctx, params.id, query.version)));
};

export const getComplianceFolderCover = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const cover = await service.readCover(authContext(req), params.id);
  res.setHeader('Content-Type', cover.mime);
  // The picture's address carries its version (`?v=`), so a changed picture is a new address.
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.send(cover.buffer);
};
