'use strict';

var HashSet = require('dw/util/HashSet');

/**
 * Checks whether a value should be treated as missing in the export payload.
 * @param {*} value - Value to validate.
 * @returns {boolean} true when the value is missing.
 */
function isMissing(value) {
    return value === null || value === undefined || value === '';
}

/**
 * Validates catalog items before they are uploaded to Coveo.
 * @param {Array} items - Catalog items to validate.
 * @returns {Array} validation errors.
 */
function validateCatalogItems(items) {
    var errors = [];
    var productIds = new HashSet();
    var variantIds = new HashSet();

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

        if (item.objecttype === 'Product') {
            if (isMissing(item.ec_product_id)) {
                errors.push('Product item at index ' + index + ' is missing ec_product_id.');
            } else {
                productIds.add(item.ec_product_id);
            }
        }

        if (item.objecttype === 'Variant') {
            if (isMissing(item.ec_product_id)) {
                errors.push('Variant item at index ' + index + ' is missing ec_product_id.');
            }

            if (isMissing(item.ec_variant_id)) {
                errors.push('Variant item at index ' + index + ' is missing ec_variant_id.');
            } else if (variantIds.contains(item.ec_variant_id)) {
                errors.push('Variant item at index ' + index + ' duplicates ec_variant_id ' + item.ec_variant_id + '.');
            } else {
                variantIds.add(item.ec_variant_id);
            }
        }
    });

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
 * @returns {Object} validated payload.
 */
function buildAddOrUpdatePayload(items) {
    var addOrUpdate = (items || []).filter(function (item) {
        return !!item;
    });

    if (!addOrUpdate.length) {
        throw new Error('Catalog export does not contain any valid addOrUpdate operations.');
    }

    var errors = validateCatalogItems(addOrUpdate);
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
