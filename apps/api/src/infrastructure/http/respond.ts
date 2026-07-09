// Uniform response envelope (API Standards §2) — implemented once, used by all controllers.
import { type Response } from 'express';
import { type ApiSuccess, type PageMeta, type Paginated } from '@ecms/contracts';

export const ok = <T>(res: Response, data: T, meta?: PageMeta): void => {
  const body: ApiSuccess<T> =
    meta === undefined ? { success: true, data } : { success: true, data, meta };
  res.status(200).json(body);
};

export const okPage = <T, D>(res: Response, page: Paginated<T>, map: (item: T) => D): void => {
  ok(res, page.items.map(map), page.meta);
};

export const created = <T>(res: Response, data: T, location?: string): void => {
  if (location !== undefined) res.location(location);
  const body: ApiSuccess<T> = { success: true, data };
  res.status(201).json(body);
};

export const noContent = (res: Response): void => {
  res.status(204).end();
};
