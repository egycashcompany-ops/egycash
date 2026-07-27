// Router: authenticate → authorize → validate → thin handlers (ADR-003). Reads under
// contract.view (branch-scoped), lifecycle actions each under their own grant; the
// document/PDF exports are audited under contract.print (A12 list search included).
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import {
  ErrorCodes,
  AddContractAttachmentSchema,
  AmendOrRenewContractSchema,
  ContractVersionOnlySchema,
  CreateContractSchema,
  DecideContractApprovalSchema,
  ListContractsQuerySchema,
  PreviewContractSchema,
  SignContractBlockSchema,
  TerminateContractSchema,
  UpdateContractDraftSchema,
  objectId,
  type AddContractAttachment,
  type AmendOrRenewContract,
  type ContractVersionOnly,
  type CreateContract,
  type DecideContractApproval,
  type ListContractsQuery,
  type PreviewContract,
  type SignContractBlock,
  type TerminateContract,
  type UpdateContractDraft,
  VerifyContractQuerySchema,
  type VerifyContractQuery,
} from '@ecms/contracts';
import { AppError, BusinessRuleError } from '../../../../shared/errors';
import { asyncHandler, created, ok, okPage, validate, validated } from '../../../../platform/web';
import { authContext, authenticate } from '../../../../platform/auth';
import { authorize, authorizeAny } from '../../../../platform/rbac';
import { fileService } from '../../../../platform/files';
import { scopeSelector } from '../../../../shared/types';
import { CONTRACT_VARIABLE_CATALOG } from '../shared/variable-catalog';
import { contractTypeService } from '../contract-types';
import { contractService } from './contract.service';
import { verifyContract } from './contract-verify';

const IdParamSchema = z.object({ id: objectId() }).strict();
const AttachmentParamSchema = z.object({ id: objectId(), attachmentId: objectId() }).strict();
/** Multipart fields arrive as strings — coerce the concurrency version. */
const UploadAttachmentFieldsSchema = AddContractAttachmentSchema.omit({ fileId: true }).extend({
  version: z.coerce.number().int().min(0),
});

const ATTACHMENT_MAX_MB = 20;
const multipartSingle = (): RequestHandler => {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: ATTACHMENT_MAX_MB * 1024 * 1024, files: 1 },
  }).single('file');
  return (req: Request, res: Response, next: NextFunction): void => {
    upload(req, res, (error: unknown) => {
      if (error === undefined || error === null) {
        next();
        return;
      }
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        next(new AppError(ErrorCodes.FILE_TOO_LARGE, 422, `File exceeds the ${ATTACHMENT_MAX_MB} MB cap`));
        return;
      }
      next(error);
    });
  };
};

type IdParam = { id: string };

/** DTO + the type name filled from the catalog (kept out of the hot mapper). */
const withTypeName = async (docId: string, ctx: ReturnType<typeof authContext>) => {
  const doc = await contractService.getById(docId, scopeSelector(ctx, 'contract.view'));
  const dto = contractService.toDto(doc);
  const type = await contractTypeService.getById(dto.typeId).catch(() => null);
  if (type !== null) dto.typeName = type.name;
  return dto;
};

const listContracts = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ListContractsQuery>(req);
  const page = await contractService.list(query, scopeSelector(ctx, 'contract.view'));
  const types = new Map((await contractTypeService.listAll()).map((t) => [String(t._id), t.name]));
  okPage(res, page, (doc) => {
    const dto = contractService.toDto(doc);
    dto.typeName = types.get(dto.typeId) ?? dto.typeName;
    return dto;
  });
};

const getContract = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  ok(res, await withTypeName(params.id, ctx));
};

const listContractVariables = async (_req: Request, res: Response): Promise<void> => {
  ok(res, CONTRACT_VARIABLE_CATALOG);
};

/** A23 — PUBLIC document verification (the QR target). Non-PII by design. */
const verifyContractHandler = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, VerifyContractQuery>(req);
  ok(res, await verifyContract(query.code, query.key));
};

const createContract = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateContract>(req);
  const doc = await contractService.createDraft(ctx, body, scopeSelector(ctx, 'contract.create'));
  created(res, contractService.toDto(doc), `/api/v1/hr/contracts/${String(doc._id)}`);
};

const previewContract = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<PreviewContract>(req);
  ok(res, await contractService.preview(ctx, body, scopeSelector(ctx, 'contract.create')));
};

const act =
  <T>(fn: (ctx: ReturnType<typeof authContext>, id: string, body: T) => Promise<unknown>) =>
  async (req: Request, res: Response): Promise<void> => {
    const ctx = authContext(req);
    const { body, params } = validated<T, never, IdParam>(req);
    await fn(ctx, params.id, body);
    ok(res, await withTypeName(params.id, ctx));
  };

const documentHtml = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  const html = await contractService.documentHtml(ctx, params.id, scopeSelector(ctx, 'contract.view'));
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
};

const pdfTicket = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  const doc = await contractService.getById(params.id, scopeSelector(ctx, 'contract.view'));
  if (doc.generation.pdfFileId === null) {
    ok(res, { ready: false, ticket: null });
    return;
  }
  ok(res, { ready: true, ticket: await fileService.issueDownloadTicket(ctx, String(doc.generation.pdfFileId)) });
};

const deleteDraft = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  await contractService.deleteDraft(ctx, params.id, scopeSelector(ctx, 'contract.create'));
  res.status(204).end();
};

const uploadAttachment = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<
    Omit<AddContractAttachment, 'fileId'> & { version: number },
    never,
    IdParam
  >(req);
  const file = req.file;
  if (file === undefined) throw new BusinessRuleError('a file part named "file" is required');
  await contractService.uploadAttachment(
    ctx,
    params.id,
    { category: body.category, label: body.label },
    body.version,
    { originalName: file.originalname, mime: file.mimetype, size: file.size, buffer: file.buffer },
    scopeSelector(ctx, 'contract.create'),
  );
  ok(res, await withTypeName(params.id, ctx));
};

const removeAttachment = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<ContractVersionOnly, never, { id: string; attachmentId: string }>(req);
  await contractService.removeAttachment(
    ctx, params.id, params.attachmentId, body.version, scopeSelector(ctx, 'contract.terminate'),
  );
  ok(res, await withTypeName(params.id, ctx));
};

export const buildContractsRouter = (): Router => {
  const router = Router();
  const guard = (permission: string) => [authenticate, authorize(permission)] as const;

  router.get('/', ...guard('contract.view'), validate({ query: ListContractsQuerySchema }), asyncHandler(listContracts));
  router.get('/variables', ...guard('contract.view'), asyncHandler(listContractVariables));
  // A23 — public (no authenticate): anyone scanning the QR can verify authenticity.
  router.get('/verify', validate({ query: VerifyContractQuerySchema }), asyncHandler(verifyContractHandler));
  router.post('/', ...guard('contract.create'), validate({ body: CreateContractSchema }), asyncHandler(createContract));
  // Preview also serves the template editor's sample render (no employeeId in the body).
  router.post('/preview', authenticate, authorizeAny('contract.create', 'contractTemplate.manage'),
    validate({ body: PreviewContractSchema }), asyncHandler(previewContract));
  router.get('/:id', ...guard('contract.view'), validate({ params: IdParamSchema }), asyncHandler(getContract));
  router.patch('/:id', ...guard('contract.create'), validate({ body: UpdateContractDraftSchema, params: IdParamSchema }),
    asyncHandler(act<UpdateContractDraft>((ctx, id, body) => contractService.updateDraft(ctx, id, body, scopeSelector(ctx, 'contract.create')))));
  router.delete('/:id', ...guard('contract.create'), validate({ params: IdParamSchema }), asyncHandler(deleteDraft));
  router.post('/:id/submit', ...guard('contract.create'), validate({ body: ContractVersionOnlySchema, params: IdParamSchema }),
    asyncHandler(act<ContractVersionOnly>((ctx, id, body) => contractService.submitForApproval(ctx, id, body.version, scopeSelector(ctx, 'contract.create')))));
  router.post('/:id/approval', ...guard('contract.approve'), validate({ body: DecideContractApprovalSchema, params: IdParamSchema }),
    asyncHandler(act<DecideContractApproval>((ctx, id, body) => contractService.decideApproval(ctx, id, body, scopeSelector(ctx, 'contract.approve')))));
  router.post('/:id/generate', ...guard('contract.generate'), validate({ body: ContractVersionOnlySchema, params: IdParamSchema }),
    asyncHandler(act<ContractVersionOnly>((ctx, id, body) => contractService.generate(ctx, id, body.version, scopeSelector(ctx, 'contract.generate')))));
  router.post('/:id/generate/retry', ...guard('contract.generate'), validate({ body: ContractVersionOnlySchema, params: IdParamSchema }),
    asyncHandler(act<ContractVersionOnly>((ctx, id, body) => contractService.retryPdf(ctx, id, body.version, scopeSelector(ctx, 'contract.generate')))));
  router.post('/:id/sign', ...guard('contract.generate'), validate({ body: SignContractBlockSchema, params: IdParamSchema }),
    asyncHandler(act<SignContractBlock>((ctx, id, body) => contractService.signBlock(ctx, id, body, scopeSelector(ctx, 'contract.generate')))));
  router.post('/:id/amend', ...guard('contract.amend'), validate({ body: AmendOrRenewContractSchema, params: IdParamSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const ctx = authContext(req);
      const { body, params } = validated<AmendOrRenewContract, never, IdParam>(req);
      const doc = await contractService.amend(ctx, params.id, body, scopeSelector(ctx, 'contract.amend'));
      created(res, contractService.toDto(doc), `/api/v1/hr/contracts/${String(doc._id)}`);
    }));
  router.post('/:id/renew', ...guard('contract.renew'), validate({ body: AmendOrRenewContractSchema, params: IdParamSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const ctx = authContext(req);
      const { body, params } = validated<AmendOrRenewContract, never, IdParam>(req);
      const doc = await contractService.renew(ctx, params.id, body, scopeSelector(ctx, 'contract.renew'));
      created(res, contractService.toDto(doc), `/api/v1/hr/contracts/${String(doc._id)}`);
    }));
  router.post('/:id/terminate', ...guard('contract.terminate'), validate({ body: TerminateContractSchema, params: IdParamSchema }),
    asyncHandler(act<TerminateContract>((ctx, id, body) => contractService.terminate(ctx, id, body, scopeSelector(ctx, 'contract.terminate')))));
  router.post('/:id/archive', ...guard('contract.terminate'), validate({ body: ContractVersionOnlySchema, params: IdParamSchema }),
    asyncHandler(act<ContractVersionOnly>((ctx, id, body) => contractService.archive(ctx, id, body.version, scopeSelector(ctx, 'contract.terminate')))));
  router.post('/:id/attachments', ...guard('contract.create'),
    validate({ body: AddContractAttachmentSchema.extend({ version: z.number().int().min(0) }), params: IdParamSchema }),
    asyncHandler(act<AddContractAttachment & { version: number }>((ctx, id, body) =>
      contractService.addAttachment(ctx, id, body, body.version, scopeSelector(ctx, 'contract.create')))));
  router.post('/:id/attachments/upload', ...guard('contract.create'), multipartSingle(),
    validate({ body: UploadAttachmentFieldsSchema, params: IdParamSchema }), asyncHandler(uploadAttachment));
  router.delete('/:id/attachments/:attachmentId', ...guard('contract.terminate'),
    validate({ body: ContractVersionOnlySchema, params: AttachmentParamSchema }), asyncHandler(removeAttachment));
  router.get('/:id/document', ...guard('contract.print'), validate({ params: IdParamSchema }), asyncHandler(documentHtml));
  router.get('/:id/pdf', ...guard('contract.print'), validate({ params: IdParamSchema }), asyncHandler(pdfTicket));

  return router;
};
