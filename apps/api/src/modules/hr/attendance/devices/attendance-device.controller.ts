// Thin HTTP mapping only (ADR-003): parse, delegate, respond.
import { type Request, type Response } from 'express';
import {
  type CreateAttendanceDevice,
  type ListAttendanceDevicesQuery,
  type UpdateAttendanceDevice,
} from '@ecms/contracts';
import { created, ok, okPage } from '../../../../platform/web';
import { validated } from '../../../../infrastructure/http/validate';
import { authContext } from '../../../../platform/auth';
import { scopeSelector } from '../../../../shared/types';
import { attendanceDeviceService, toAttendanceDeviceDto } from './attendance-device.service';

type IdParam = { id: string };

/**
 * The registry NARROWS: its repository declares `branchField`, so a branch-scoped reader sees the
 * devices standing in their own branch and no others. That is the point of D12.5 — a device is a
 * thing in a place, and «which devices are there» is a question with a different answer per place.
 */
const deviceScope = (req: Request) => scopeSelector(authContext(req), 'attendanceDevice.view');

export const listAttendanceDevices = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListAttendanceDevicesQuery, never>(req);
  const page = await attendanceDeviceService.list(query, deviceScope(req));
  okPage(res, page, (doc) => toAttendanceDeviceDto(doc));
};

export const getAttendanceDevice = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const doc = await attendanceDeviceService.getById(params.id, deviceScope(req));
  ok(res, toAttendanceDeviceDto(doc));
};

export const createAttendanceDevice = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateAttendanceDevice, never, never>(req);
  const doc = await attendanceDeviceService.create(ctx, body);
  created(
    res,
    toAttendanceDeviceDto(doc),
    `/api/v1/hr/attendance/devices/${String(doc._id)}`,
  );
};

export const updateAttendanceDevice = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UpdateAttendanceDevice, never, IdParam>(req);
  const doc = await attendanceDeviceService.update(ctx, params.id, body, deviceScope(req));
  ok(res, toAttendanceDeviceDto(doc));
};
