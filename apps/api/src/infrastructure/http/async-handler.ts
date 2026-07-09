// Express 4 does not forward rejected promises — every async controller is wrapped once here.
import { type NextFunction, type Request, type RequestHandler, type Response } from 'express';

export const asyncHandler = (
  fn: (req: Request, res: Response) => Promise<void>,
): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };
};
