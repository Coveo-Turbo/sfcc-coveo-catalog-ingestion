'use strict';

var HashSet = require('dw/util/HashSet');

var CATALOG_STRUCTURE_MODE_PRODUCT_VARIANT = 'product_variant';
var CATALOG_STRUCTURE_MODE_PRODUCT_ONLY = 'product_only';

/**
 * Checks whether a value should be treated as missing in the export payload.
 * @param {*} value - Value to validate.
 * @returns {boolean} true when the value is missing.
 */
function isMissing(value) {
    return value === null || value === undefined || value === '';
}

/**
 * Returns the normalized catalog structure mode for validation.
 * @param {*} value - Raw catalog structure mode.
 * @returns {string} normalized mode.
 */
function normalizeCatalogStructureMode(value) {
    if (value === null || value === undefined || value === '') {
        return CATALOG_STRUCTURE_MODE_PRODUCT_VARIANT;
    }

    return String(value).trim().toLowerCase();
}

/**
 * Validates catalog items before they are uploaded to Coveo.
 * @param {Array} items - Catalog items to validate.
 * @param {Object} options - Validation options.
 * @returns {Array} validation errors.
 */
function validateCatalogItems(items, options) {
    var errors = [];
    var productIds = new HashSet();
    var variantIds = new HashSet();
    var expectedLanguage = options && options.expectedLanguage ? String(options.expectedLanguage).toLowerCase() : '';
    var catalogStructureMode = normalizeCatalogStructureMode(options && options.catalogStructureMode);

    items.forEach(function (item, index) {
        if (!item || typeof item !== 'object') {
            errors.push('Catalog item at index ' + index + ' is not an object.');
            return;
        }

        if (!isMissing(item.ec_productid)) {
            errors.push('Catalog item at index ' + index + ' still contains the legacy ec_productid field.');
        }

        if (isMissing(item.documentId)) {
            errors.push('Catalog item at index ' + index + ' is missing documentId.');
        }

        if (isMissing(item.language)) {
            errors.push('Catalog item at index ' + index + ' is missing language.');
        } else if (!isMissing(expectedLanguage) && String(item.language).toLowerCase() !== expectedLanguage) {
            errors.push('Catalog item at index ' + index + ' has language ' + item.language + ' but the export target expects ' + expectedLanguage + '.');
        }

        if (item.objecttype === 'Product') {
            if (isMissing(item.ec_product_id)) {
                errors.push('Product item at index ' + index + ' is missing ec_product_id.');
            } else if (item.permanentid !== item.ec_product_id) {
                errors.push('Product item at index ' + index + ' must set permanentid to ec_product_id.');
            } else {
                productIds.add(item.ec_product_id);
            }
        }

        if (item.objecttype === 'Variant') {
            if (catalogStructureMode === CATALOG_STRUCTURE_MODE_PRODUCT_ONLY) {
                errors.push('Catalog item at index ' + index + ' uses objecttype Variant, which is not allowed in product_only mode.');
                return;
            }

            if (isMissing(item.ec_product_id)) {
                errors.push('Variant item at index ' + index + ' is missing ec_product_id.');
            }

            if (isMissing(item.ec_variant_id)) {
                errors.push('Variant item at index ' + index + ' is missing ec_variant_id.');
            } else if (item.permanentid !== item.ec_variant_id) {
                errors.push('Variant item at index ' + index + ' must set permanentid to ec_variant_id.');
            } else if (variantIds.contains(item.ec_variant_id)) {
                errors.push('Variant item at index ' + index + ' duplicates ec_variant_id ' + item.ec_variant_id + '.');
            } else {
                variantIds.add(item.ec_variant_id);
            }
        }
    });

    if (catalogStructureMode === CATALOG_STRUCTURE_MODE_PRODUCT_ONLY) {
        return errors;
    }

    items.forEach(function (item, index) {
        if (item && item.objecttype === 'Variant' && !isMissing(item.ec_product_id) && !productIds.contains(item.ec_product_id)) {
            errors.push('Variant item at index ' + index + ' references missing parent ec_product_id ' + item.ec_product_id + '.');
        }
    });

    return errors;
}

/**
 * Builds a validated addOrUpdate payload for the Stream API.
 * @param {Array} items - Catalog items to upload.
 * @param {Object} options - Validation options.
 * @returns {Object} validated payload.
 */
function buildAddOrUpdatePayload(items, options) {
    var addOrUpdate = (items || []).filter(function (item) {
        return !!item;
    });

    if (!addOrUpdate.length) {
        throw new Error('Catalog export does not contain any valid addOrUpdate operations.');
    }

    var errors = validateCatalogItems(addOrUpdate, options);
    if (errors.length) {
        throw new Error(errors.join(' '));
    }

    return {
        addOrUpdate: addOrUpdate
    };
}

module.exports = {
    buildAddOrUpdatePayload: buildAddOrUpdatePayload,
    validateCatalogItems: validateCatalogItems
};
