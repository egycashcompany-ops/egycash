export { buildAdministrationSuppliersRouter } from './supplier.routes';
export { administrationSupplierService, ensureSupplierCodeCounter } from './supplier.service';
// The seed ensures the papers' category; the manifest registers their authorizer (ADR-023).
export { ensureSupplierDocumentsCategory, supplierFileAuthorizer } from './supplier-files';
