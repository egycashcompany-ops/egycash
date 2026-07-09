// Zod validation at the route edge (ADR-007): controllers and services receive
// already-parsed, typed input and never re-validate.
import { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { type ZodType, type ZodError } from 'zod';
import { type ApiErrorDetail } from '@ecms/contracts';
import { ValidationError } from '../../shared/errors';

export interface ValidatedRequest<
  TBody = unknown,
  TQuery = unknown,
  TParams = unknown,
> extends Request {
  validated: { body: TBody; query: TQuery; params: TParams };
}

const toDetails = (error: ZodError, source: 'body' | 'query' | 'params'): ApiErrorDetail[] =>
  error.issues.map((issue) => ({
    field: `${source}${issue.path.length > 0 ? '.' + issue.path.join('.') : ''}`,
    code: issue.code.toUpperCase(),
    message: issue.message,
  }));

export const validate = <TBody = unknown, TQuery = unknown, TParams = unknown>(schemas: {
  body?: ZodType<TBody>;
  query?: ZodType<TQuery>;
  params?: ZodType<TParams>;
}): RequestHandler => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const details: ApiErrorDetail[] = [];
    const validated: { body: unknown; query: unknown; params: unknown } = {
      body: undefined,
      query: undefined,
      params: undefined,
    };

    if (schemas.body !== undefined) {
      const result = schemas.body.safeParse(req.body);
      if (result.success) validated.body = result.data;
      else details.push(...toDetails(result.error, 'body'));
    }
    if (schemas.query !== undefined) {
      const result = schemas.query.safeParse(req.query);
      if (result.success) validated.query = result.data;
      else details.push(...toDetails(result.error, 'query'));
    }
    if (schemas.params !== undefined) {
      const result = schemas.params.safeParse(req.params);
      if (result.success) validated.params = result.data;
      else details.push(...toDetails(result.error, 'params'));
    }

    if (details.length > 0) {
      next(new ValidationError(details));
      return;
    }
    (req as ValidatedRequest).validated = validated as ValidatedRequest['validated'];
    next();
  };
};

/** Typed accessor for handlers behind `validate(...)`. */
export const validated = <TBody = unknown, TQuery = unknown, TParams = unknown>(
  req: Request,
): { body: TBody; query: TQuery; params: TParams } =>
  (req as ValidatedRequest<TBody, TQuery, TParams>).validated;
