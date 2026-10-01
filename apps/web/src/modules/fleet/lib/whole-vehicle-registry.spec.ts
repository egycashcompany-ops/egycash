import { describe, expect, it } from 'vitest';
import { type FleetVehicleDto, type Paginated } from '@ecms/contracts';
import { fetchWholeVehicleRegistry } from './whole-vehicle-registry';
import { type FleetListParams } from '../api/fleet-api';

/** A registry of `count` cars, codes 1…count, served the way the server serves it: text order. */
const registry = (count: number) => {
  const cars = Array.from({ length: count }, (_, i) => ({ id: `v${i + 1}`, code: String(i + 1) }))
    .sort((a, b) => a.code.localeCompare(b.code))
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
  it('brings EVERY car, past the hundred a page holds', async () => {
    const { list, asked } = registry(250);
    const whole = await fetchWholeVehicleRegistry(list, true);
    expect(whole.items).toHaveLength(250);
    expect(asked.map((p) => p['page'])).toEqual([1, 2, 3]);
  });

  it('puts the cars in the order a reader counts them — 99 before 100', async () => {
    const { list } = registry(120);
    const codes = (await fetchWholeVehicleRegistry(list, true)).items.map((v) => v.code);
    expect(codes.slice(97, 101)).toEqual(['98', '99', '100', '101']);
  });

  it('asks every status for a historical fact, the active cars otherwise', async () => {
    const any = registry(5);
    await fetchWholeVehicleRegistry(any.list, true);
    expect(any.asked[0]).not.toHaveProperty('status');
    const active = registry(5);
    await fetchWholeVehicleRegistry(active.list, false);
    expect(active.asked[0]).toMatchObject({ status: 'active' });
  });
});
