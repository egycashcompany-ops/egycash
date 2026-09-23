// WHO FLEET MAY SHOW A NAME FOR — Fleet's own people, and nobody else.
//
// «انا عاوز اعرض السواقيين بتوع الحركه للناس اللى واخده موديول الحركه بس ... لا انا عاوز الحركه
// يظهر الناس بتاعت الحركه بس».
//
// Every Fleet screen that prints a driver used to read HR's employee endpoint under HR's own
// `employee.view`, and that grant is the whole directory: letting a dispatcher see who drove car
// 150 meant handing them «الموظفون» and every employee in the company with it.
//
// The roster here is the SAME one the drivers registry is built from — everyone whose job title
// requires a driving test — read through the directory seam, which is the org chart answering a
// question and grants nothing. So there is no list to keep in step, and no way to reach a person
// who does not hold a driving seat: a reader with `fleetDriver.view` and nothing else sees
// exactly the people Fleet already shows them, and not one more.
//
// FR-11 IS UNTOUCHED. Fleet does not own these facts: it writes none of them, stores none of them
// and reads them fresh every time. What changed is which grant a reader needs for the names Fleet
// was already printing.
import { type FleetPersonDto } from '@ecms/contracts';
import { drivingSeatRoster } from '../driver-profiles/driving-seat-roster';

class FleetPeopleService {
  /**
   * The whole roster, unpaginated.
   *
   * The drivers registry itself is paged in memory for the same reason — the roster is the
   * company's drivers, hundreds at most — and every consumer of THIS is a lookup table a screen
   * holds while it renders. A page would make «who is this id» a question that sometimes has no
   * answer depending on which page happened to be fetched.
   *
   * EVERY status, including `exited`. A reading taken last year by a driver who has since left is
   * still that driver's, and a cell that fell back to a raw id the day somebody resigned would be
   * losing history rather than tidying it.
   */
  async list(): Promise<FleetPersonDto[]> {
    const roster = await drivingSeatRoster();
    return roster.map((employee) => ({
      employeeId: employee.employeeId,
      code: employee.code,
      fullNameAr: employee.fullNameAr,
      status: employee.status,
      branchId: employee.branchId,
      address: employee.address,
      governorate: employee.governorate,
      phone: employee.phone,
      hiredAt: employee.hiredAt === null ? null : employee.hiredAt.toISOString(),
    }));
  }
}

export const fleetPeopleService = new FleetPeopleService();
