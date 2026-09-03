'use strict';

var exportTargetHelper = require('*/cartridge/scripts/helper/exportTargetHelper');

/**
 * Returns a boolean product property, preferring its SFCC getter when available.
 * @param {Object} product - Product to inspect.
 * @param {string} propertyName - Property name.
 * @param {string} methodName - Getter method name.
 * @returns {boolean} property value.
 */
function getBooleanProductValue(product, propertyName, methodName) {
    if (empty(product)) {
        return false;
    }

    if (typeof product[methodName] === 'function') {
        return product[methodName]() === true;
    }

    return product[propertyName] === true;
}

/**
 * Returns whether the configured policy restricts products to storefront visibility.
 * @param {Object} exportContext - Export context.
 * @returns {boolean} whether storefront eligibility is required.
 */
function requiresOnlineAndSearchable(exportContext) {
    return exportTargetHelper.normalizeProductEligibilityMode(exportContext && exportContext.productEligibilityMode)
        === exportTargetHelper.PRODUCT_ELIGIBILITY_MODE_ONLINE_AND_SEARCHABLE;
}

/**
 * Returns whether a product satisfies the configured target policy.
 * @param {Object} product - Product to inspect.
 * @param {Object} exportContext - Export context.
 * @returns {boolean} whether the product is eligible.
 */
function isProductEligible(product, exportContext) {
    if (empty(product)) {
        return false;
    }

    if (!requiresOnlineAndSearchable(exportContext)) {
        return true;
    }

    return getBooleanProductValue(product, 'online', 'isOnline')
        && getBooleanProductValue(product, 'searchable', 'isSearchable');
}

/**
 * Returns whether a variant and its master satisfy the configured target policy.
 * @param {Object} variant - Variant to inspect.
 * @param {Object} master - Parent master product.
 * @param {Object} exportContext - Export context.
 * @returns {boolean} whether the variant is eligible.
 */
function isVariantEligible(variant, master, exportContext) {
    return isProductEligible(variant, exportContext)
        && (empty(master) || isProductEligible(master, exportContext));
}

/**
 * Returns the eligible variants for a master without mutating the SFCC collection.
 * @param {Object} master - Master product.
 * @param {Object} exportContext - Export context.
 * @returns {Array} eligible variants.
 */
function getEligibleVariants(master, exportContext) {
    var variants = !empty(master) && !empty(master.variants) && typeof master.variants.toArray === 'function'
        ? master.variants.toArray()
        : [];

    return variants.filter(function (variant) {
        return isVariantEligible(variant, master, exportContext);
    });
}

module.exports = {
    getEligibleVariants: getEligibleVariants,
    isProductEligible: isProductEligible,
    isVariantEligible: isVariantEligible,
    requiresOnlineAndSearchable: requiresOnlineAndSearchable
};
