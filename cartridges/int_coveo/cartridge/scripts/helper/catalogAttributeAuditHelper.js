'use strict';

var ArrayList = require('dw/util/ArrayList');
var HashMap = require('dw/util/HashMap');
var ObjectAttributeDefinition = require('dw/object/ObjectAttributeDefinition');

var PRODUCT_TYPE_KEYS = ['master', 'variant', 'standard', 'bundle', 'set', 'other'];

/**
 * Returns whether a value should be treated as empty.
 * @param {*} value - Value to inspect.
 * @returns {boolean} whether the value is empty.
 */
function isEmptyValue(value) {
    return value === null
        || value === undefined
        || value === ''
        || (Array.isArray(value) && value.length === 0);
}

/**
 * Returns a normalized string value.
 * @param {*} value - Value to normalize.
 * @returns {string} normalized string.
 */
function normalizeString(value) {
    if (value === null || value === undefined) {
        return '';
    }

    return String(value).trim();
}

/**
 * Safely reads a property from an SFCC script object.
 * Some platform-backed objects throw when an unknown property is accessed.
 * @param {Object} object - Source object.
 * @param {string} propertyName - Property name to read.
 * @returns {*} resolved property value or undefined.
 */
function getSafeProperty(object, propertyName) {
    if (!object) {
        return undefined;
    }

    try {
        return object[propertyName];
    } catch (error) {
        return undefined;
    }
}

/**
 * Safely returns a callable method from an SFCC script object.
 * @param {Object} object - Source object.
 * @param {string} methodName - Method name to read.
 * @returns {Function|null} callable method or null.
 */
function getSafeMethod(object, methodName) {
    var value = getSafeProperty(object, methodName);

    return typeof value === 'function' ? value : null;
}

/**
 * Returns a serializable array from a platform collection.
 * @param {*} collection - Collection to normalize.
 * @returns {Array} normalized array.
 */
function toArray(collection) {
    if (collection === null || collection === undefined) {
        return [];
    }

    if (Array.isArray(collection)) {
        return collection;
    }

    var toArrayMethod = getSafeMethod(collection, 'toArray');

    if (toArrayMethod) {
        return toArrayMethod.call(collection);
    }

    var hasNextMethod = getSafeMethod(collection, 'hasNext');
    var nextMethod = getSafeMethod(collection, 'next');

    if (hasNextMethod && nextMethod) {
        var values = [];

        while (hasNextMethod.call(collection)) {
            values.push(nextMethod.call(collection));
        }

        return values;
    }

    try {
        return new ArrayList(collection).toArray();
    } catch (error) {
        return [collection];
    }
}

/**
 * Returns a metadata property value through either a getter or a direct property.
 * @param {Object} object - Source object.
 * @param {string} propertyName - Property name.
 * @param {string} getterName - Getter method name.
 * @returns {*} resolved value.
 */
function getMetadataValue(object, propertyName, getterName) {
    if (!object) {
        return null;
    }

    var getter = getterName ? getSafeMethod(object, getterName) : null;

    if (getter) {
        return getter.call(object);
    }

    return getSafeProperty(object, propertyName);
}

/**
 * Returns whether an attribute definition is a system attribute.
 * @param {Object} definition - Attribute definition.
 * @returns {boolean} true when the attribute is system-managed.
 */
function isSystemAttribute(definition) {
    var systemValue = getMetadataValue(definition, 'system', 'isSystem');

    return systemValue === true;
}

/**
 * Returns whether an attribute definition is localizable.
 * @param {Object} definition - Attribute definition.
 * @returns {boolean} true when the attribute is localizable.
 */
function isLocalizableAttribute(definition) {
    var localizableValue = getMetadataValue(definition, 'localizable', 'isLocalizable');

    return localizableValue === true;
}

/**
 * Returns whether an attribute definition can hold multiple values.
 * @param {Object} definition - Attribute definition.
 * @returns {boolean} true when the attribute is multi-value.
 */
function isMultiValueAttribute(definition) {
    var multiValue = getMetadataValue(definition, 'multiValueType', 'isMultiValueType');

    return multiValue === true;
}

/**
 * Returns the identifier of an attribute definition.
 * @param {Object} definition - Attribute definition.
 * @returns {string} attribute identifier.
 */
function getAttributeId(definition) {
    return normalizeString(getMetadataValue(definition, 'ID', 'getID'));
}

/**
 * Returns the display name of an attribute definition.
 * @param {Object} definition - Attribute definition.
 * @returns {string} display name.
 */
function getAttributeDisplayName(definition) {
    return normalizeString(getMetadataValue(definition, 'displayName', 'getDisplayName')) || getAttributeId(definition);
}

/**
 * Returns the configured value type code.
 * @param {Object} definition - Attribute definition.
 * @returns {number|string|null} value type code.
 */
function getValueTypeCode(definition) {
    return getMetadataValue(definition, 'valueTypeCode', 'getValueTypeCode');
}

/**
 * Returns all attribute groups assigned to an attribute definition.
 * @param {Object} definition - Attribute definition.
 * @returns {Array} sorted group ids.
 */
function getAttributeGroupIds(definition) {
    var groups = toArray(getMetadataValue(definition, 'attributeGroups', 'getAttributeGroups'));

    return groups.map(function (group) {
        return normalizeString(getMetadataValue(group, 'ID', 'getID'));
    }).filter(function (groupId) {
        return groupId !== '';
    }).sort();
}

/**
 * Converts an attribute value definition collection into a lookup map.
 * @param {Object} definition - Attribute definition.
 * @returns {Object} lookup from raw value to display value.
 */
function buildDisplayLookup(definition) {
    var valueDefinitions = toArray(getMetadataValue(definition, 'values', 'getValues'));
    var lookup = {};

    valueDefinitions.forEach(function (valueDefinition) {
        var rawValue = getMetadataValue(valueDefinition, 'value', 'getValue');
        var displayValue = normalizeString(getMetadataValue(valueDefinition, 'displayValue', 'getDisplayValue'));
        var rawKey = rawValue === null || rawValue === undefined ? '' : String(rawValue);

        if (rawKey !== '' && displayValue !== '') {
            lookup[rawKey] = displayValue;
        }
    });

    return lookup;
}

/**
 * Returns the human-readable value type name for a definition.
 * @param {Object} definition - Attribute definition.
 * @returns {string} value type name.
 */
function getValueTypeName(definition) {
    var valueTypeCode = getValueTypeCode(definition);
    var valueTypes = {};

    valueTypes[ObjectAttributeDefinition.VALUE_TYPE_BOOLEAN] = 'boolean';
    valueTypes[ObjectAttributeDefinition.VALUE_TYPE_DATE] = 'date';
    valueTypes[ObjectAttributeDefinition.VALUE_TYPE_DATETIME] = 'datetime';
    valueTypes[ObjectAttributeDefinition.VALUE_TYPE_EMAIL] = 'email';
    valueTypes[ObjectAttributeDefinition.VALUE_TYPE_ENUM_OF_INT] = 'enum-of-int';
    valueTypes[ObjectAttributeDefinition.VALUE_TYPE_ENUM_OF_STRING] = 'enum-of-string';
    valueTypes[ObjectAttributeDefinition.VALUE_TYPE_HTML] = 'html';
    valueTypes[ObjectAttributeDefinition.VALUE_TYPE_IMAGE] = 'image';
    valueTypes[ObjectAttributeDefinition.VALUE_TYPE_INT] = 'int';
    valueTypes[ObjectAttributeDefinition.VALUE_TYPE_MONEY] = 'money';
    valueTypes[ObjectAttributeDefinition.VALUE_TYPE_NUMBER] = 'number';
    valueTypes[ObjectAttributeDefinition.VALUE_TYPE_PASSWORD] = 'password';
    valueTypes[ObjectAttributeDefinition.VALUE_TYPE_QUANTITY] = 'quantity';
    valueTypes[ObjectAttributeDefinition.VALUE_TYPE_SET_OF_INT] = 'set-of-int';
    valueTypes[ObjectAttributeDefinition.VALUE_TYPE_SET_OF_NUMBER] = 'set-of-number';
    valueTypes[ObjectAttributeDefinition.VALUE_TYPE_SET_OF_STRING] = 'set-of-string';
    valueTypes[ObjectAttributeDefinition.VALUE_TYPE_STRING] = 'string';
    valueTypes[ObjectAttributeDefinition.VALUE_TYPE_TEXT] = 'text';

    return valueTypes[valueTypeCode] || (valueTypeCode === null || valueTypeCode === undefined ? '' : String(valueTypeCode));
}

/**
 * Returns the recommended valueMode for an attribute based on its metadata.
 * @param {Object} definition - Attribute definition.
 * @returns {string} recommended valueMode.
 */
function getSuggestedValueMode(definition) {
    var valueTypeCode = getValueTypeCode(definition);
    var enumLike = valueTypeCode === ObjectAttributeDefinition.VALUE_TYPE_ENUM_OF_INT
        || valueTypeCode === ObjectAttributeDefinition.VALUE_TYPE_ENUM_OF_STRING;

    if (isMultiValueAttribute(definition) && enumLike) {
        return 'displayValueArray';
    }

    if (enumLike && isLocalizableAttribute(definition)) {
        return 'displayValue';
    }

    return 'raw';
}

/**
 * Converts an object value into a serializable scalar when possible.
 * @param {*} value - Raw value.
 * @returns {*} serializable scalar or structure.
 */
function toSerializableScalar(value) {
    if (value === null || value === undefined) {
        return value;
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'object') {
        var sourceValue = getSafeProperty(value, 'source');

        if (!isEmptyValue(sourceValue)) {
            return sourceValue;
        }

        var httpsURL = getSafeProperty(value, 'httpsURL');

        if (!isEmptyValue(httpsURL)) {
            var httpsURLToString = getSafeMethod(httpsURL, 'toString');

            return httpsURLToString ? httpsURLToString.call(httpsURL) : String(httpsURL);
        }

        var absURL = getSafeProperty(value, 'absURL');

        if (!isEmptyValue(absURL)) {
            var absURLToString = getSafeMethod(absURL, 'toString');

            return absURLToString ? absURLToString.call(absURL) : String(absURL);
        }

        var rawValue = getSafeProperty(value, 'value');

        if (!isEmptyValue(rawValue)) {
            return rawValue;
        }

        var idValue = getSafeProperty(value, 'ID');

        if (!isEmptyValue(idValue)) {
            return idValue;
        }
    }

    return String(value);
}

/**
 * Returns whether a value should be normalized as an array.
 * @param {*} value - Raw value.
 * @param {Object} definition - Attribute definition.
 * @returns {boolean} whether the value should be treated as an array.
 */
function shouldNormalizeAsArray(value, definition) {
    if (Array.isArray(value) || getSafeMethod(value, 'toArray')) {
        return true;
    }

    return isMultiValueAttribute(definition);
}

/**
 * Normalizes a raw value to an array when needed.
 * @param {*} value - Raw value.
 * @returns {Array} normalized array.
 */
function toValueArray(value) {
    if (isEmptyValue(value)) {
        return [];
    }

    if (Array.isArray(value)) {
        return value;
    }

    var toArrayMethod = getSafeMethod(value, 'toArray');

    if (toArrayMethod) {
        return toArrayMethod.call(value);
    }

    return [value];
}

/**
 * Normalizes a raw value into a serializable raw export candidate.
 * @param {*} rawValue - Raw value.
 * @param {Object} definition - Attribute definition.
 * @returns {*} normalized raw value.
 */
function normalizeRawValue(rawValue, definition) {
    if (shouldNormalizeAsArray(rawValue, definition)) {
        return toValueArray(rawValue).map(toSerializableScalar).filter(function (value) {
            return !isEmptyValue(value);
        });
    }

    return toSerializableScalar(rawValue);
}

/**
 * Converts a raw value into a display-oriented value when possible.
 * @param {*} rawValue - Raw value.
 * @param {Object} definition - Attribute definition.
 * @returns {*} normalized display value.
 */
function normalizeDisplayValue(rawValue, definition) {
    var displayLookup = buildDisplayLookup(definition);

    function toDisplay(entry) {
        if (entry === null || entry === undefined) {
            return entry;
        }

        var displayValue = typeof entry === 'object' ? getSafeProperty(entry, 'displayValue') : undefined;

        if (!isEmptyValue(displayValue)) {
            return displayValue;
        }

        var serializable = toSerializableScalar(entry);
        var lookupKey = serializable === null || serializable === undefined ? '' : String(serializable);

        if (lookupKey !== '' && Object.prototype.hasOwnProperty.call(displayLookup, lookupKey)) {
            return displayLookup[lookupKey];
        }

        return serializable;
    }

    if (shouldNormalizeAsArray(rawValue, definition)) {
        return toValueArray(rawValue).map(toDisplay).filter(function (value) {
            return !isEmptyValue(value);
        });
    }

    return toDisplay(rawValue);
}

/**
 * Returns whether a normalized value should count as populated.
 * @param {*} value - Normalized value.
 * @returns {boolean} whether the value should count as populated.
 */
function hasPopulatedValue(value) {
    if (value === null || value === undefined) {
        return false;
    }

    if (Array.isArray(value)) {
        return value.length > 0;
    }

    if (typeof value === 'string') {
        return value !== '';
    }

    return true;
}

/**
 * Formats a normalized value for samples and CSV output.
 * @param {*} value - Value to format.
 * @returns {string} formatted value.
 */
function formatSampleValue(value) {
    if (value === null || value === undefined) {
        return '';
    }

    if (Array.isArray(value)) {
        return value.map(function (entry) {
            return formatSampleValue(entry);
        }).filter(function (entry) {
            return entry !== '';
        }).join(' | ');
    }

    return String(value);
}

/**
 * Adds a unique sample value to a bounded sample list.
 * @param {Array} samples - Target sample list.
 * @param {string} value - Sample value.
 * @param {number} limit - Maximum sample count.
 */
function addSampleValue(samples, value, limit) {
    if (value === '' || samples.length >= limit || samples.indexOf(value) !== -1) {
        return;
    }

    samples.push(value);
}

/**
 * Safely reads a boolean-like property from an SFCC script object.
 * Some platform-backed objects throw when an unknown property is accessed.
 * @param {Object} object - Source object.
 * @param {string} propertyName - Property name to read.
 * @returns {boolean} true when the property resolves truthy.
 */
function getSafeBooleanProperty(object, propertyName) {
    return getSafeProperty(object, propertyName) === true;
}

/**
 * Returns the product type key used for populated-value breakdowns.
 * @param {Object} product - Product to classify.
 * @returns {string} product type key.
 */
function getProductTypeKey(product) {
    if (getSafeBooleanProperty(product, 'variant')) {
        return 'variant';
    }

    if (getSafeBooleanProperty(product, 'master')) {
        return 'master';
    }

    if (getSafeBooleanProperty(product, 'bundle')) {
        return 'bundle';
    }

    if (getSafeBooleanProperty(product, 'productSet')) {
        return 'set';
    }

    if (product) {
        return 'standard';
    }

    return 'other';
}

/**
 * Returns the effective primary category for a product.
 * @param {Object} product - Product to inspect.
 * @returns {Object|null} effective primary category.
 */
function getPrimaryCategory(product) {
    if (!product) {
        return null;
    }

    if (getSafeBooleanProperty(product, 'variant')) {
        var masterProduct = getSafeProperty(product, 'masterProduct');
        var masterPrimaryCategory = getSafeProperty(masterProduct, 'primaryCategory');

        if (masterPrimaryCategory) {
            return masterPrimaryCategory;
        }
    }

    return getSafeProperty(product, 'primaryCategory') || null;
}

/**
 * Builds a metadata summary for an attribute definition.
 * @param {Object} definition - Attribute definition.
 * @param {string[]} usableSourceObjects - Supported source objects.
 * @returns {Object} summary entry.
 */
function createAttributeSummary(definition, usableSourceObjects) {
    var countsByProductType = {};

    PRODUCT_TYPE_KEYS.forEach(function (key) {
        countsByProductType[key] = 0;
    });

    return {
        attributeId: getAttributeId(definition),
        displayName: getAttributeDisplayName(definition),
        system: isSystemAttribute(definition),
        localizable: isLocalizableAttribute(definition),
        multiValue: isMultiValueAttribute(definition),
        valueType: getValueTypeName(definition),
        valueTypeCode: getValueTypeCode(definition),
        groupIds: getAttributeGroupIds(definition),
        suggestedValueMode: getSuggestedValueMode(definition),
        usableSourceObjects: usableSourceObjects,
        populatedCount: 0,
        populatedByProductType: countsByProductType,
        productCountWithValue: 0,
        categoryCountWithValue: 0,
        sampleRawValues: [],
        sampleDisplayValues: []
    };
}

/**
 * Reads a raw value from a source object using an attribute definition.
 * @param {Object} sourceObject - Product or category source object.
 * @param {Object} definition - Attribute definition.
 * @returns {*} raw value.
 */
function getSourceValue(sourceObject, definition) {
    var attributeId = getAttributeId(definition);

    if (isSystemAttribute(definition)) {
        return getSafeProperty(sourceObject, attributeId);
    }

    return getSafeProperty(getSafeProperty(sourceObject, 'custom'), attributeId);
}

/**
 * Returns the declared attribute definitions for an extensible object.
 * @param {Object} sourceObject - Product or category object.
 * @returns {Array} attribute definitions.
 */
function getAttributeDefinitions(sourceObject) {
    var describe = getSafeMethod(sourceObject, 'describe');
    var typeDefinition = describe ? describe.call(sourceObject) : null;

    if (!typeDefinition) {
        return [];
    }

    return toArray(getMetadataValue(typeDefinition, 'attributeDefinitions', 'getAttributeDefinitions'));
}

/**
 * Updates attribute summaries for a single source object.
 * @param {Object} summariesById - Summary map keyed by attribute id.
 * @param {Array} definitions - Attribute definitions.
 * @param {Object} sourceObject - Object whose values are inspected.
 * @param {Object} options - Audit options.
 */
function updateAttributeSummaries(summariesById, definitions, sourceObject, options) {
    var sampleLimit = options.sampleLimit;
    var productType = options.productType;
    var productId = normalizeString(options.productId);
    var categoryId = normalizeString(options.categoryId);
    var countPopulatedCount = options.countPopulatedCount !== false;
    var countProductType = options.countProductType !== false;
    var countProductCount = options.countProductCount === true;
    var countCategoryCount = options.countCategoryCount === true;

    definitions.forEach(function (definition) {
        var attributeId = getAttributeId(definition);
        var rawValue = getSourceValue(sourceObject, definition);
        var normalizedRawValue = normalizeRawValue(rawValue, definition);
        var normalizedDisplayValue = normalizeDisplayValue(rawValue, definition);

        if (!hasPopulatedValue(normalizedRawValue)) {
            return;
        }

        if (!Object.prototype.hasOwnProperty.call(summariesById, attributeId)) {
            summariesById[attributeId] = createAttributeSummary(definition, options.usableSourceObjects);
        }

        var summary = summariesById[attributeId];
        var formattedRawSample = formatSampleValue(normalizedRawValue);
        var formattedDisplaySample = formatSampleValue(normalizedDisplayValue);

        if (countPopulatedCount) {
            summary.populatedCount += 1;
        }

        if (countProductType) {
            if (Object.prototype.hasOwnProperty.call(summary.populatedByProductType, productType)) {
                summary.populatedByProductType[productType] += 1;
            } else {
                summary.populatedByProductType.other += 1;
            }
        }

        if (countProductCount && productId !== '') {
            summary.productCountWithValue += 1;
        }

        if (countCategoryCount && categoryId !== '') {
            summary.categoryCountWithValue += 1;
        }

        addSampleValue(summary.sampleRawValues, formattedRawSample, sampleLimit);
        addSampleValue(summary.sampleDisplayValues, formattedDisplaySample, sampleLimit);
    });
}

/**
 * Finalizes a summary map into a sorted summary array.
 * @param {Object} summariesById - Summary map keyed by attribute id.
 * @returns {Array} sorted summary rows.
 */
function finalizeSummaries(summariesById) {
    return Object.keys(summariesById).map(function (attributeId) {
        return summariesById[attributeId];
    }).sort(function (left, right) {
        if (left.productCountWithValue === right.productCountWithValue) {
            return left.attributeId.localeCompare(right.attributeId);
        }

        return right.productCountWithValue - left.productCountWithValue;
    });
}

/**
 * Builds a catalog attribute audit report for the provided products.
 * @param {Object} productsIterator - Product iterator.
 * @param {Object} options - Audit options.
 * @returns {Object} audit report.
 */
function buildCatalogAttributeAudit(productsIterator, options) {
    var auditOptions = options || {};
    var sampleLimit = auditOptions.sampleLimit > 0 ? auditOptions.sampleLimit : 5;
    var maxProducts = auditOptions.maxProducts > 0 ? auditOptions.maxProducts : 0;
    var productDefinitions = null;
    var categoryDefinitions = null;
    var productSummariesById = {};
    var categorySummariesById = {};
    var referencedCategoriesById = new HashMap();
    var productsScanned = 0;
    var productsByType = {
        master: 0,
        variant: 0,
        standard: 0,
        bundle: 0,
        set: 0,
        other: 0
    };

    while (productsIterator.hasNext() && (maxProducts === 0 || productsScanned < maxProducts)) {
        var product = productsIterator.next();
        var productType = getProductTypeKey(product);
        var primaryCategory = getPrimaryCategory(product);
        var productId = normalizeString(getSafeProperty(product, 'ID'));

        productsScanned += 1;
        productsByType[productType] += 1;

        if (!productDefinitions) {
            productDefinitions = getAttributeDefinitions(product);
        }

        updateAttributeSummaries(productSummariesById, productDefinitions || [], product, {
            sampleLimit: sampleLimit,
            productType: productType,
            productId: productId,
            categoryId: '',
            countProductCount: true,
            usableSourceObjects: ['product', 'masterProduct']
        });

        if (primaryCategory) {
            var primaryCategoryId = normalizeString(getSafeProperty(primaryCategory, 'ID'));

            if (!categoryDefinitions) {
                categoryDefinitions = getAttributeDefinitions(primaryCategory);
            }

            updateAttributeSummaries(categorySummariesById, categoryDefinitions || [], primaryCategory, {
                sampleLimit: sampleLimit,
                productType: productType,
                productId: productId,
                categoryId: '',
                countProductCount: true,
                usableSourceObjects: ['primaryCategory']
            });

            if (primaryCategoryId !== '' && !referencedCategoriesById.containsKey(primaryCategoryId)) {
                referencedCategoriesById.put(primaryCategoryId, primaryCategory);
            }
        }
    }

    if (categoryDefinitions && !referencedCategoriesById.isEmpty()) {
        toArray(referencedCategoriesById.values()).forEach(function (category) {
            updateAttributeSummaries(categorySummariesById, categoryDefinitions || [], category, {
                sampleLimit: sampleLimit,
                productType: 'other',
                productId: '',
                categoryId: normalizeString(getSafeProperty(category, 'ID')),
                countPopulatedCount: false,
                countProductType: false,
                countCategoryCount: true,
                usableSourceObjects: ['primaryCategory']
            });
        });
    }

    return {
        generatedAt: new Date().toISOString(),
        siteId: normalizeString(auditOptions.siteId),
        catalogId: normalizeString(auditOptions.catalogId),
        locale: normalizeString(auditOptions.locale),
        sampleLimit: sampleLimit,
        maxProducts: maxProducts,
        scanSummary: {
            productsScanned: productsScanned,
            productsByType: productsByType
        },
        productAttributes: finalizeSummaries(productSummariesById),
        primaryCategoryAttributes: finalizeSummaries(categorySummariesById)
    };
}

/**
 * Escapes a CSV cell value.
 * @param {*} value - Raw cell value.
 * @returns {string} escaped CSV cell.
 */
function escapeCsv(value) {
    var normalized = value === null || value === undefined ? '' : String(value);

    if (normalized.indexOf('"') !== -1 || normalized.indexOf(',') !== -1 || normalized.indexOf('\n') !== -1) {
        return '"' + normalized.replace(/"/g, '""') + '"';
    }

    return normalized;
}

/**
 * Builds a CSV summary from the audit report.
 * @param {Object} report - Audit report.
 * @returns {string} CSV string.
 */
function buildAuditCsv(report) {
    var rows = [[
        'sourceObject',
        'attributeId',
        'displayName',
        'system',
        'localizable',
        'multiValue',
        'valueType',
        'suggestedValueMode',
        'groupIds',
        'productCountWithValue',
        'categoryCountWithValue',
        'masterCountWithValue',
        'variantCountWithValue',
        'standardCountWithValue',
        'bundleCountWithValue',
        'setCountWithValue',
        'sampleRawValues',
        'sampleDisplayValues'
    ]];

    function appendRows(sourceObject, attributes) {
        attributes.forEach(function (attribute) {
            rows.push([
                sourceObject,
                attribute.attributeId,
                attribute.displayName,
                attribute.system,
                attribute.localizable,
                attribute.multiValue,
                attribute.valueType,
                attribute.suggestedValueMode,
                attribute.groupIds.join('|'),
                attribute.productCountWithValue,
                attribute.categoryCountWithValue,
                attribute.populatedByProductType.master,
                attribute.populatedByProductType.variant,
                attribute.populatedByProductType.standard,
                attribute.populatedByProductType.bundle,
                attribute.populatedByProductType.set,
                attribute.sampleRawValues.join(' || '),
                attribute.sampleDisplayValues.join(' || ')
            ]);
        });
    }

    appendRows('product/masterProduct', report.productAttributes || []);
    appendRows('primaryCategory', report.primaryCategoryAttributes || []);

    return rows.map(function (row) {
        return row.map(escapeCsv).join(',');
    }).join('\n');
}

module.exports = {
    buildAuditCsv: buildAuditCsv,
    buildCatalogAttributeAudit: buildCatalogAttributeAudit
};
