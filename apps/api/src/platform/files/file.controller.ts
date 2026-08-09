// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import { type ListFilesQuery, type UpdateFile, type UploadFileFields } from '@ecms/contracts';
import { created, noContent, ok, okPage } from '../../infrastructure/http/respond';
import { validated } from '../../infrastructure/http/validate';
import { ValidationError } from '../../shared/errors';
import { scopeSelector } from '../../shared/types';
import { authContext, authContextOrNull } from '../auth';
import { fileService, type UploadedBinary } from './file.service';

type IdParam = { id: string };

const binaryOf = (req: Request): UploadedBinary => {
  const file = req.file;
  if (file === undefined) {
    throw new ValidationError([
      { field: 'body.file', code: 'REQUIRED', message: 'multipart field "file" is required' },
    ]);
  }
  return {
    originalName: file.originalname,
    mime: file.mimetype,
    size: file.size,
    buffer: file.buffer,
  };
};

export const uploadFile = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<UploadFileFields>(req);
  const doc = await fileService.upload(ctx, body, binaryOf(req));
  created(res, fileService.toDto(doc), `/api/v1/platform/files/${String(doc._id)}`);
};

export const replaceFile = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  const doc = await fileService.replace(ctx, params.id, binaryOf(req));
  created(res, fileService.toDto(doc), `/api/v1/platform/files/${String(doc._id)}`);
};

export const listFiles = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ListFilesQuery>(req);
  const page = await fileService.list(query, scopeSelector(ctx, 'file.view'), ctx);
  okPage(res, page, (doc) => fileService.toDto(doc));
};

export const getFile = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  ok(
    res,
    fileService.toDto(
      await fileService.getById(params.id, scopeSelector(ctx, 'file.view'), ctx),
    ),
  );
};

export const listFileVersions = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  const versions = await fileService.listVersions(params.id, scopeSelector(ctx, 'file.view'), ctx);
  ok(
    res,
    versions.map((doc) => fileService.toDto(doc)),
  );
};

export const updateFile = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UpdateFile, never, IdParam>(req);
  ok(res, fileService.toDto(await fileService.update(ctx, params.id, body)));
};

export const archiveFile = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  ok(res, fileService.toDto(await fileService.archive(ctx, params.id)));
};

export const restoreFile = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  ok(res, fileService.toDto(await fileService.restore(ctx, params.id)));
};

export const deleteFile = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  await fileService.softDelete(ctx, params.id, scopeSelector(ctx, 'file.delete'));
  noContent(res);
};

export const purgeFile = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  await fileService.permanentDelete(ctx, params.id);
  noContent(res);
};

export const downloadFile = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  const ticket = await fileService.issueDownloadTicket(ctx, params.id);
  if (req.query.mode === 'ticket') {
    ok(res, ticket);
    return;
  }
  // API Standards §7: authorized redirect to a short-lived signed URL.
  res.redirect(302, ticket.url);
};

export const streamSignedFile = async (req: Request, res: Response): Promise<void> => {
  const { params, query } = validated<never, { e: number; s: string }, IdParam>(req);
  // Null for an anonymous caller — the ordinary capability-URL case. A guarded file (ADR-023)
  // refuses that and requires the session the ticket was minted for.
  const { doc, stream } = await fileService.openSignedStream(
    params.id,
    query.e,
    query.s,
    authContextOrNull(req),
  );
  // The one place the app hands bytes to a browser that is very likely on ANOTHER origin: the web
  // app is served from its own host, so an `<img src>` pointing here is a cross-origin load.
  // Helmet's default `Cross-Origin-Resource-Policy: same-origin` blocks precisely that — Chrome
  // refuses the response (ERR_BLOCKED_BY_RESPONSE.NotSameOrigin) and paints its broken-image
  // glyph, which is what every uploaded logo looked like.
  //
  // Declaring `cross-origin` gives away nothing: this route is unauthenticated BY DESIGN and what
  // protects it is the capability in the URL — an HMAC over the file id and an expiry, checked
  // before a single byte is read. CORP would only decide which page may embed a URL that anyone
  // holding it can already fetch.
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Content-Type', doc.mime);
  res.setHeader('Content-Length', String(doc.size));
  res.setHeader(
    'Content-Disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(`${doc.displayName}${doc.extension}`)}`,
  );
  res.setHeader('Cache-Control', 'private, no-store');
  await new Promise<void>((resolve, reject) => {
    stream.on('error', reject);
    res.on('finish', resolve);
    stream.pipe(res);
  });
};
