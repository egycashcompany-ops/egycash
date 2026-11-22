# Hand-off — package `dash-api` (contracts + server side of answer 1)

TEMPORARY NOTES (inside `.wip-notes/`, removed before the PR).

## Status

- contracts built 2026-11-22T08:54:50Z (`packages/contracts/dist` holds the eleven tabs, no `period` tab, no
  `FLEET_DASHBOARD_PERIOD_TABS`, no R2 `visits`, no `accidents.openRemaining`). dash-web may run its specs.
- `node scripts/gen-permission-matrix.mjs --check` → "permission matrix is up to date" (rc 0).

## 1. Key arrays recorded BEFORE any edit (node over `packages/contracts/dist`, base 53594fd2)

- `FLEET_DASHBOARD_NOW_KEYS` = `["fleetVehicle.view","fleetRoster.view","fleetMaintenance.view","fleetOdometer.view","fleetDriver.view","fleetLicensing.view","fleetFuelCard.view","fleetFuelCharge.view","fleetNotice.view","fleetDealership.view","fleetAccident.view","fleetViolation.view"]`
- `FLEET_DASHBOARD_PERIOD_KEYS` = `["fleetOdometer.view","fleetMaintenance.view","fleetAccident.view","fleetViolation.view","fleetReceipt.view","fleetCustody.view","fleetDealership.view","fleetLicenseExpense.view"]`
- `FLEET_DASHBOARD_PAGE_KEYS` = `["fleetVehicle.view","fleetRoster.view","fleetMaintenance.view","fleetOdometer.view","fleetDriver.view","fleetLicensing.view","fleetFuelCard.view","fleetFuelCharge.view","fleetNotice.view","fleetDealership.view","fleetAccident.view","fleetViolation.view","fleetReceipt.view","fleetCustody.view"]`
- `FLEET_DASHBOARD_SCOPE_KEYS` = `["fleetVehicle.view","fleetRoster.view","fleetMaintenance.view","fleetOdometer.view","fleetDriver.view","fleetLicensing.view","fleetFuelCard.view","fleetFuelCharge.view","fleetNotice.view","fleetDealership.view","fleetAccident.view","fleetViolation.view","fleetReceipt.view"]`
- `FLEET_DASHBOARD_UNSCOPED_KEYS` = `["fleetCustody.view","fleetLicenseExpense.view"]`
