export { buildAdministrationItemCategoriesRouter } from './item-category.routes';
export { administrationItemCategoryService, type ItemCategoryLabel } from './item-category.service';
// What an item asks of the category it names (§5.3): the category's own answer, not a copy of it.
export { activeFor as categoryActiveFor } from './item-category-rules';
