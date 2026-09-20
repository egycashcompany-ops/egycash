// «عاوز لما اعمل فلتر يجبلى العداد فى حالة الفلتر كام» — THE HIGHEST ODOMETER READING ANY CAR IN
// A SET HAS REACHED, answered in ONE place for every screen that asks it.
//
// WHY A MAXIMUM AND NEVER A SUM. A counter is a POSITION on an instrument, not a distance. Adding
// two cars' odometers gives a number that exists on no dashboard in the fleet; adding one car's
// readings to each other counts the same measured instant twice over, because `inReading` of one
// row IS `outReading` of the next (`odometer.model.ts`). The only honest reductions of a column
// of counters are «the highest» and «the lowest», and «وصلتها العربية» asks for the first.
//
// WHY ONE FILE. The odometer screen, the workshop screen and the alarms board all ask it, and a
// figure that disagreed between two screens about where the same car is would be worse than no
// figure at all. It reads `latestReadings` — the same source the maintenance alarm measures
// from — so the number under the table is the number the alarm used.
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';
import { fleetOdometerRepository } from './odometer.repository';
import { type FleetHighestReadingDto } from '@ecms/contracts';

/** No car, or no car with a reading: every field is empty, and none of them is a zero. */
const NOTHING: FleetHighestReadingDto = {
  reading: null,
  vehicleId: null,
  code: null,
  at: null,
  vehicles: 0,
  // The distance is not this helper's to know: it is a property of the ROWS a filter matched, and
  // this one is handed only the cars. The readings register fills it in; every other caller leaves
  // it empty rather than publishing a zero it never measured.
  km: null,
};

export const highestReadingAmong = async (
  vehicleIds: readonly string[],
): Promise<FleetHighestReadingDto> => {
  if (vehicleIds.length === 0) return NOTHING;
  const readings = await fleetOdometerRepository.latestReadings(vehicleIds);
  let best: { vehicleId: string; reading: number; date: Date } | null = null;
  for (const reading of readings.values()) {
    if (best === null || reading.reading > best.reading) best = reading;
  }
  if (best === null) return { ...NOTHING, vehicles: vehicleIds.length };
  // The car HOLDING it — a bare maximum over several cars names none of them, and the reader's
  // next question is always «بتاعة أنهى عربية».
  const codes = await fleetVehicleRepository.codesByIds([best.vehicleId]);
  return {
    reading: best.reading,
    vehicleId: best.vehicleId,
    code: codes.get(best.vehicleId) ?? null,
    at: best.date.toISOString(),
    vehicles: vehicleIds.length,
    km: null,
  };
};
