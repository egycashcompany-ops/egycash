// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type AddComplianceDocument,
  type ComplianceContentQuery,
  type ComplianceVersionQuery,
  type ListComplianceDocumentsQuery,
  type RenameComplianceDocument,
} from '@ecms/contracts';
import { created, noContent, ok, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { toComplianceDocumentDto } from '../compliance.mappers';
import { documentBinary, requireFile } from '../shared/file-intake';
import { complianceDocumentService as service } from './document.service';

type IdParam = { id: string };

/** RFC 6266: the plain name for old clients, the UTF-8 one for every current browser. */
const disposition = (kind: 'inline' | 'attachment', fileName: string): string => {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
};

export const listComplianceDocuments = async (req: Request, res: Response): Promise<void> => {
  const { query, params } = validated<never, ListComplianceDocumentsQuery, IdParam>(req);
  const ctx = authContext(req);
  const { page, seen } = await service.list(ctx, params.id, query);
  ok(
    res,
    page.items.map((doc) => toComplianceDocumentDto(doc, seen?.get(String(doc._id)) ?? null)),
    page.meta,
  );
};

export const addComplianceDocument = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<AddComplianceDocument, never, IdParam>(req);
  const ctx = authContext(req);
  const { binary, kind } = documentBinary(requireFile(req.file));
  const doc = await service.add(ctx, params.id, body, binary, kind);
  // The seen line is the list's: a screen reads the folder again after an upload.
  created(res, toComplianceDocumentDto(doc, null));
};

export const renameComplianceDocument = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<RenameComplianceDocument, never, IdParam>(req);
  const doc = await service.rename(authContext(req), params.id, body.name, body.version);
  ok(res, toComplianceDocumentDto(doc, null));
};

export const deleteComplianceDocument = async (req: Request, res: Response): Promise<void> => {
  const { query, params } = validated<never, ComplianceVersionQuery, IdParam>(req);
  await service.remove(authContext(req), params.id, query.version);
  noContent(res);
};

export const getComplianceDocumentContent = async (req: Request, res: Response): Promise<void> => {
  const { query, params } = validated<never, ComplianceContentQuery, IdParam>(req);
  const content = await service.content(authContext(req), params.id, query.mode);
  res.setHeader('Content-Type', content.mime);
  res.setHeader(
    'Content-Disposition',
    disposition(query.mode === 'download' ? 'attachment' : 'inline', content.fileName),
  );
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(content.buffer);
};

export const getComplianceDocumentPreview = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, await service.preview(authContext(req), params.id));
};

export const getComplianceSeenReport = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, await service.seenReport(authContext(req), params.id));
};
