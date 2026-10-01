import { describe, expect, it } from 'vitest';
import { compareFleetVehicleCodes, type FleetVehicleDto, type Paginated } from '@ecms/contracts';
import { fetchWholeVehicleRegistry } from './whole-vehicle-registry';
import { type FleetListParams } from '../api/fleet-api';

/**
 * A registry of the given codes, served the way the server serves `sortBy: 'code'`: the fleet's
 * own order (150 upward, then the cars written in words, then «الملاكى» below 150).
 */
const registry = (codes: readonly string[]) => {
  const count = codes.length;
  const cars = codes
    .map((code, i) => ({ id: `v${i + 1}`, code }))
    .sort((a, b) => compareFleetVehicleCodes(a.code, b.code))
    .map((car) => car as unknown as FleetVehicleDto);
  const asked: FleetListParams[] = [];
  const list = async (params: FleetListParams): Promise<Paginated<FleetVehicleDto>> => {
    asked.push(params);
    const page = Number(params['page']);
    const size = Number(params['pageSize']);
    return {
      items: cars.slice((page - 1) * size, page * size),
      meta: { page, pageSize: size, totalItems: count, totalPages: Math.ceil(count / size) },
    };
  };
  return { list, asked };
};

describe('the whole vehicle registry — «كل العربيات تكون موجوده فعلا»', () => {
  const numbered = (count: number): string[] =>
    Array.from({ length: count }, (_, i) => String(150 + i));

  it('brings EVERY car, past the hundred a page holds', async () => {
    const { list, asked } = registry(numbered(250));
    const whole = await fetchWholeVehicleRegistry(list, true);
    expect(whole.items).toHaveLength(250);
    expect(asked.map((p) => p['page'])).toEqual([1, 2, 3]);
  });

  it('keeps the fleet’s own order — 150 upward, then word codes, then «الملاكى» below 150', async () => {
    const { list } = registry(['61', '149', '150', '151', 'تويوتا1', '300', '99']);
    const codes = (await fetchWholeVehicleRegistry(list, true)).items.map((v) => v.code);
    expect(codes).toEqual(['150', '151', '300', 'تويوتا1', '61', '99', '149']);
  });

  it('asks every status for a historical fact, the active cars otherwise', async () => {
    const any = registry(numbered(5));
    await fetchWholeVehicleRegistry(any.list, true);
    expect(any.asked[0]).not.toHaveProperty('status');
    const active = registry(numbered(5));
    await fetchWholeVehicleRegistry(active.list, false);
    expect(active.asked[0]).toMatchObject({ status: 'active' });
  });
});
