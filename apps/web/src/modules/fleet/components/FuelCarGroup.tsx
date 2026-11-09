// The fuel boards' car block — «الكروت» and «شحن الكروت» — with the car card on its big code:
// «عاوز لما اماوس يقف على كود عربيه يجيب بيانات زى اما اقف على اسم السواق نفس الموضوع كدا».
//
// A file of its own because `FuelCardBoard` cannot import the card: the card reads that file's
// icons, and a value import back would be a cycle that breaks at load. So the card is asked for
// here and handed to `VehicleFuelGroup` as a prop.
//
// By hover only (`focusable: false`): the block's tab stops are its cards' own buttons. A tile of
// cards on no car («سفر 1», «اسبير») names no car, and has no card.
import { type ComponentProps } from 'react';
import { VehicleFuelGroup } from './FuelCardBoard';
import { useVehicleHoverCard } from './VehicleHoverCard';

/** `VehicleFuelGroup` with the car card on its code. `noCar`: the tile of a label on no car. */
export const FuelCarGroup = ({
  noCar = false,
  ...group
}: Omit<ComponentProps<typeof VehicleFuelGroup>, 'car'> & { noCar?: boolean }): JSX.Element => {
  const car = useVehicleHoverCard(
    noCar ? { vehicleId: null } : { vehicleId: group.vehicleId, code: group.code },
    { focusable: false },
  );
  return <VehicleFuelGroup {...group} car={car} />;
};
