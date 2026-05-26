'use strict';

var ArrayList = require('dw/util/ArrayList');
var CustomObjectMgr = require('dw/object/CustomObjectMgr');
var Logger = require('dw/system/Logger').getLogger('Coveo');
var ObjectAttributeDefinition = require('dw/object/ObjectAttributeDefinition');

var PROFILE_CUSTOM_OBJECT_TYPE = 'CoveoCatalogFieldMappingProfile';
var MAPPING_CUSTOM_OBJECT_TYPE = 'CoveoCatalogFieldMapping';

var RESERVED_TARGET_FIELDS = [
    'documentId',
    'FileExtension',
    'model',
    'language',
    'permanentid',
    'ec_product_id',
    'ec_images',
    'ec_thumbnails',
    'ec_swatch',
    'ec_price',
    'ec_promo_price',
    'ec_category',
    'ec_primary_category',
    'objecttype',
    'ec_rating',
    'ec_brand',
    'ec_description',
    'ec_shortdesc',
    'ec_color',
    'ec_size',
    'ec_item_group_id',
    'ec_sku',
    'ec_variant_id',
    'ec_name'
];

var SUPPORTED_APPLIES_TO = {
    Product: true,
    Variant: true,
    Both: true
};

var SUPPORTED_SOURCE_OBJECTS = {
    product: true,
    masterProduct: true,
    primaryCategory: true
};

var SUPPORTED_SOURCE_SCOPES = {
    system: true,
    custom: true
};

var SUPPORTED_VALUE_MODES = {
    raw: true,
    displayValue: true,
    displayValueArray: true
};

var DEFAULT_FIELD_MAPPINGS = [
    {
        mappingId: '__default-ec-name',
        siteId: '',
        profileId: '',
        enabled: true,
        sortOrder: 0,
        appliesTo: 'Both',
        sourceObject: 'product',
        sourceScope: 'system',
        sourceAttributeId: 'name',
        targetField: 'ec_name',
        valueMode: 'raw',
        builtIn: true
    }
];

/**
 * Returns whether the provided value should be treated as empty.
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
 * @returns {string} normalized value.
 */
function normalizeString(value) {
    if (value === null || value === undefined) {
        return '';
    }

    return String(value).trim();
}

/**
 * Converts supported truthy values to boolean.
 * @param {*} value - Value to normalize.
 * @returns {boolean} normalized boolean.
 */
function toBoolean(value) {
    if (value === true || value === false) {
        return value;
    }

    return normalizeString(value).toLowerCase() === 'true';
}

/**
 * Closes iterators returned by SFCC APIs when supported.
 * @param {Object} iterator - Iterator to close.
 */
function closeIterator(iterator) {
    if (!isEmptyValue(iterator) && typeof iterator.close === 'function') {
        iterator.close();
    }
}

/**
 * Returns whether a value exposes a callable toArray method without throwing.
 * @param {*} value - Value to inspect.
 * @returns {boolean} whether the value exposes toArray.
 */
function hasToArrayFunction(value) {
    try {
        return !isEmptyValue(value) && typeof value.toArray === 'function';
    } catch (error) {
        return false;
    }
}

/**
 * Returns whether a value behaves like an array without being a native JS array.
 * @param {*} value - Value to inspect.
 * @returns {boolean} whether the value is array-like.
 */
function isArrayLikeValue(value) {
    try {
        return !isEmptyValue(value)
            && !Array.isArray(value)
            && typeof value !== 'string'
            && typeof value.length === 'number'
            && value.length >= 0;
    } catch (error) {
        return false;
    }
}

/**
 * Converts an array-like value into a native array.
 * @param {*} value - Value to convert.
 * @returns {Array} native array.
 */
function arrayLikeToArray(value) {
    var arrayValues = [];
    var index;

    for (index = 0; index < value.length; index += 1) {
        arrayValues.push(value[index]);
    }

    return arrayValues;
}

/**
 * Safely returns a callable method from a source object when available.
 * Some SFCC script objects throw when reading unknown properties directly.
 * @param {Object} sourceObject - Source object to inspect.
 * @param {string} methodName - Method name to resolve.
 * @returns {Function|null} bound method when available.
 */
function getCallableMethod(sourceObject, methodName) {
    try {
        if (!isEmptyValue(sourceObject) && typeof sourceObject[methodName] === 'function') {
            return sourceObject[methodName].bind(sourceObject);
        }
    } catch (error) {
        return null;
    }

    return null;
}

/**
 * Safely reads a property from an SFCC-backed script object.
 * Some platform-backed values throw when an unknown property is accessed.
 * @param {Object} sourceObject - Source object to inspect.
 * @param {string} propertyName - Property name to read.
 * @returns {*} resolved property value or undefined.
 */
function getSafeProperty(sourceObject, propertyName) {
    if (isEmptyValue(sourceObject)) {
        return undefined;
    }

    try {
        return sourceObject[propertyName];
    } catch (error) {
        return undefined;
    }
}

/**
 * Parses a sort order into a stable integer value.
 * @param {*} value - Value to parse.
 * @returns {number} parsed sort order.
 */
function parseSortOrder(value) {
    var parsedValue = parseInt(normalizeString(value), 10);

    return isNaN(parsedValue) ? 0 : parsedValue;
}

/**
 * Returns whether the provided field name is reserved.
 * @param {string} fieldName - Target field.
 * @returns {boolean} whether the field is reserved.
 */
function isReservedField(fieldName) {
    var normalizedFieldName = normalizeString(fieldName).toLowerCase();

    return RESERVED_TARGET_FIELDS.some(function (reservedField) {
        return reservedField.toLowerCase() === normalizedFieldName;
    });
}

/**
 * Maps a custom object row to a normalized field mapping definition.
 * @param {Object} mappingObject - Custom object instance.
 * @param {number} index - Stable fallback order.
 * @returns {Object} normalized mapping.
 */
function normalizeFieldMapping(mappingObject, index) {
    var custom = mappingObject.custom || {};

    return {
        mappingId: normalizeString(custom.mappingId),
        siteId: normalizeString(custom.siteId),
        profileId: normalizeString(custom.profileId),
        enabled: toBoolean(custom.enabled),
        sortOrder: parseSortOrder(custom.sortOrder),
        appliesTo: normalizeString(custom.appliesTo),
        sourceObject: normalizeString(custom.sourceObject),
        sourceScope: normalizeString(custom.sourceScope),
        sourceAttributeId: normalizeString(custom.sourceAttributeId),
        targetField: normalizeString(custom.targetField),
        valueMode: normalizeString(custom.valueMode),
        _creationIndex: index
    };
}

/**
 * Maps a plain definition to a normalized field mapping definition.
 * @param {Object} definition - Plain mapping definition.
 * @param {number} index - Stable fallback order.
 * @returns {Object} normalized mapping.
 */
function normalizeFieldMappingDefinition(definition, index) {
    var mapping = definition || {};

    return {
        mappingId: normalizeString(mapping.mappingId),
        siteId: normalizeString(mapping.siteId),
        profileId: normalizeString(mapping.profileId),
        enabled: toBoolean(mapping.enabled),
        sortOrder: parseSortOrder(mapping.sortOrder),
        appliesTo: normalizeString(mapping.appliesTo),
        sourceObject: normalizeString(mapping.sourceObject),
        sourceScope: normalizeString(mapping.sourceScope),
        sourceAttributeId: normalizeString(mapping.sourceAttributeId),
        targetField: normalizeString(mapping.targetField),
        valueMode: normalizeString(mapping.valueMode),
        _creationIndex: index
    };
}

/**
 * Validates a configured field mapping.
 * @param {Object} mapping - Mapping row.
 * @param {Object} seenTargetFields - Duplicate tracking map.
 */
function validateFieldMapping(mapping, seenTargetFields) {
    var missingFields = [];
    var normalizedTargetField = normalizeString(mapping.targetField).toLowerCase();

    if (isEmptyValue(mapping.mappingId)) {
        missingFields.push('mappingId');
    }

    if (isEmptyValue(mapping.siteId)) {
        missingFields.push('siteId');
    }

    if (isEmptyValue(mapping.profileId)) {
        missingFields.push('profileId');
    }

    if (isEmptyValue(mapping.sourceAttributeId)) {
        missingFields.push('sourceAttributeId');
    }

    if (isEmptyValue(mapping.targetField)) {
        missingFields.push('targetField');
    }

    if (!isEmptyValue(missingFields)) {
        throw new Error('The Coveo field mapping ' + (mapping.mappingId || '[unknown]') + ' is missing required values: ' + missingFields.join(', ') + '.');
    }

    if (!Object.prototype.hasOwnProperty.call(SUPPORTED_APPLIES_TO, mapping.appliesTo)) {
        throw new Error('The Coveo field mapping ' + mapping.mappingId + ' uses unsupported appliesTo value ' + mapping.appliesTo + '.');
    }

    if (!Object.prototype.hasOwnProperty.call(SUPPORTED_SOURCE_OBJECTS, mapping.sourceObject)) {
        throw new Error('The Coveo field mapping ' + mapping.mappingId + ' uses unsupported sourceObject value ' + mapping.sourceObject + '.');
    }

    if (!Object.prototype.hasOwnProperty.call(SUPPORTED_SOURCE_SCOPES, mapping.sourceScope)) {
        throw new Error('The Coveo field mapping ' + mapping.mappingId + ' uses unsupported sourceScope value ' + mapping.sourceScope + '.');
    }

    if (!Object.prototype.hasOwnProperty.call(SUPPORTED_VALUE_MODES, mapping.valueMode)) {
        throw new Error('The Coveo field mapping ' + mapping.mappingId + ' uses unsupported valueMode value ' + mapping.valueMode + '.');
    }

    if (isReservedField(mapping.targetField)) {
        throw new Error('The Coveo field mapping ' + mapping.mappingId + ' targets protected field ' + mapping.targetField + '.');
    }

    if (Object.prototype.hasOwnProperty.call(seenTargetFields, normalizedTargetField)) {
        throw new Error('The Coveo field mapping profile ' + mapping.profileId + ' defines duplicate targetField ' + mapping.targetField + '.');
    }

    seenTargetFields[normalizedTargetField] = true;
}

/**
 * Validates and sorts plain field mapping definitions.
 * Disabled mappings are ignored to match runtime export behavior.
 * @param {Array} mappingDefinitions - Mapping definitions to validate.
 * @returns {Array} validated enabled field mappings.
 */
function validateFieldMappings(mappingDefinitions) {
    var mappings = [];
    var seenTargetFields = {};

    new ArrayList(mappingDefinitions || []).toArray().forEach(function (mappingDefinition, index) {
        var normalizedMapping = mappingDefinition && Object.prototype.hasOwnProperty.call(mappingDefinition, '_creationIndex')
            ? mappingDefinition
            : normalizeFieldMappingDefinition(mappingDefinition, index);

        if (normalizedMapping.enabled !== true) {
            return;
        }

        validateFieldMapping(normalizedMapping, seenTargetFields);
        mappings.push(normalizedMapping);
    });

    mappings.sort(function (left, right) {
        if (left.sortOrder === right.sortOrder) {
            return left._creationIndex - right._creationIndex;
        }

        return left.sortOrder - right.sortOrder;
    });

    return mappings.map(function (mapping) {
        delete mapping._creationIndex;
        return mapping;
    });
}

/**
 * Loads enabled field mappings for a site/profile pair.
 * @param {string} siteId - Owning site identifier.
 * @param {string} profileId - Profile identifier.
 * @returns {Array} normalized mapping rows.
 */
function loadFieldMappings(siteId, profileId) {
    var mappings = [];
    var mappingIterator = CustomObjectMgr.queryCustomObjects(
        MAPPING_CUSTOM_OBJECT_TYPE,
        'custom.siteId = {0} AND custom.profileId = {1}',
        'creationDate asc',
        siteId,
        profileId
    );
    var index = 0;

    try {
        while (mappingIterator.hasNext()) {
            mappings.push(normalizeFieldMapping(mappingIterator.next(), index));
            index += 1;
        }
    } finally {
        closeIterator(mappingIterator);
    }

    return validateFieldMappings(mappings);
}

/**
 * Resolves the mapping profile selected for an export target.
 * @param {Object} exportContext - Export context.
 * @returns {Object} resolved field mapping context.
 */
function buildFieldMappingContext(exportContext) {
    var mappingProfileId = normalizeString(exportContext && exportContext.mappingProfileId);

    if (isEmptyValue(mappingProfileId)) {
        return {
            mappingProfileId: '',
            mappingProfile: null,
            fieldMappings: []
        };
    }

    var mappingProfile = CustomObjectMgr.getCustomObject(PROFILE_CUSTOM_OBJECT_TYPE, mappingProfileId);
    var profileCustom = mappingProfile && mappingProfile.custom ? mappingProfile.custom : {};

    if (isEmptyValue(mappingProfile)) {
        throw new Error('No Coveo field mapping profile with profileId ' + mappingProfileId + ' exists.');
    }

    if (normalizeString(profileCustom.siteId) !== normalizeString(exportContext.siteId)) {
        throw new Error('The Coveo field mapping profile ' + mappingProfileId + ' is configured for site ' + profileCustom.siteId + ' but the current export context is site ' + exportContext.siteId + '.');
    }

    if (!toBoolean(profileCustom.enabled)) {
        throw new Error('The Coveo field mapping profile ' + mappingProfileId + ' is disabled.');
    }

    return {
        mappingProfileId: mappingProfileId,
        mappingProfile: mappingProfile,
        fieldMappings: loadFieldMappings(exportContext.siteId, mappingProfileId)
    };
}

/**
 * Returns the effective primary category for a product or variant.
 * @param {Object} product - Exported product object.
 * @returns {Object|null} primary category.
 */
function getPrimaryCategory(product) {
    if (isEmptyValue(product)) {
        return null;
    }

    if (product.variant && !isEmptyValue(product.masterProduct) && !isEmptyValue(product.masterProduct.primaryCategory)) {
        return product.masterProduct.primaryCategory;
    }

    return product.primaryCategory || null;
}

/**
 * Resolves the source object used by a mapping row.
 * @param {Object} product - Exported product object.
 * @param {string} sourceObject - Source object id.
 * @returns {Object|null} resolved source object.
 */
function resolveSourceObject(product, sourceObject) {
    switch (sourceObject) {
        case 'product':
            return product;
        case 'masterProduct':
            return !isEmptyValue(product) && !isEmptyValue(product.masterProduct)
                ? product.masterProduct
                : null;
        case 'primaryCategory':
            return getPrimaryCategory(product);
        default:
            return null;
    }
}

/**
 * Returns the attribute definition for a mapped attribute when supported.
 * @param {Object} sourceObject - Resolved source object.
 * @param {Object} mapping - Mapping row.
 * @returns {Object|null} attribute definition.
 */
function getAttributeDefinition(sourceObject, mapping) {
    if (isEmptyValue(sourceObject) || isEmptyValue(mapping)) {
        return null;
    }

    var getAttributeModel = getCallableMethod(sourceObject, 'getAttributeModel');
    var getProductAttributeModel = getCallableMethod(sourceObject, 'getProductAttributeModel');
    var describe = getCallableMethod(sourceObject, 'describe');

    try {
        if (mapping.sourceScope === 'custom' && describe) {
            var typeDefinition = describe();

            if (!isEmptyValue(typeDefinition) && typeof typeDefinition.getCustomAttributeDefinition === 'function') {
                return typeDefinition.getCustomAttributeDefinition(mapping.sourceAttributeId);
            }
        }

        if (getAttributeModel) {
            return getAttributeModel().getAttributeDefinition(mapping.sourceAttributeId);
        }

        if (getProductAttributeModel) {
            return getProductAttributeModel().getAttributeDefinition(mapping.sourceAttributeId);
        }
    } catch (error) {
        Logger.warn('Unable to resolve attribute definition for {0}. {1}', mapping.sourceAttributeId, error.message || error);
        return null;
    }

    return null;
}

/**
 * Returns the raw mapped value from the selected source object.
 * @param {Object} sourceObject - Resolved source object.
 * @param {Object} mapping - Mapping row.
 * @returns {*} raw source value.
 */
function getSourceValue(sourceObject, mapping) {
    if (isEmptyValue(sourceObject)) {
        return null;
    }

    if (mapping.sourceScope === 'custom') {
        return sourceObject.custom ? sourceObject.custom[mapping.sourceAttributeId] : null;
    }

    return sourceObject[mapping.sourceAttributeId];
}

/**
 * Returns whether a raw value should be normalized as an array.
 * @param {*} value - Value to inspect.
 * @param {Object|null} attributeDefinition - Attribute definition.
 * @returns {boolean} whether the value should be normalized as an array.
 */
function shouldNormalizeAsArray(value, attributeDefinition) {
    if (Array.isArray(value) || hasToArrayFunction(value) || isArrayLikeValue(value)) {
        return true;
    }

    if (isEmptyValue(attributeDefinition)) {
        return false;
    }

    return attributeDefinition.valueTypeCode === ObjectAttributeDefinition.VALUE_TYPE_SET_OF_NUMBER
        || attributeDefinition.valueTypeCode === ObjectAttributeDefinition.VALUE_TYPE_SET_OF_STRING
        || attributeDefinition.valueTypeCode === ObjectAttributeDefinition.VALUE_TYPE_SET_OF_INT;
}

/**
 * Normalizes an SFCC collection or scalar into an array.
 * @param {*} value - Value to normalize.
 * @returns {Array} normalized array.
 */
function toValueArray(value) {
    if (isEmptyValue(value)) {
        return [];
    }

    if (Array.isArray(value)) {
        return value;
    }

    if (hasToArrayFunction(value)) {
        return value.toArray();
    }

    if (isArrayLikeValue(value)) {
        return arrayLikeToArray(value);
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return [value];
    }

    try {
        return new ArrayList(value).toArray();
    } catch (error) {
        return [value];
    }
}

/**
 * Normalizes a raw value into a JSON-serializable primitive when possible.
 * @param {*} value - Value to normalize.
 * @returns {*} normalized value.
 */
function toSerializableRawValue(value) {
    var rawValue;
    var valueId;

    if (value === null || value === undefined) {
        return value;
    }

    if (Array.isArray(value)) {
        return value.map(toSerializableRawValue);
    }

    if (hasToArrayFunction(value)) {
        return value.toArray().map(toSerializableRawValue);
    }

    if (isArrayLikeValue(value)) {
        return arrayLikeToArray(value).map(toSerializableRawValue);
    }

    if (typeof value === 'object') {
        rawValue = getSafeProperty(value, 'value');
        if (!isEmptyValue(rawValue)) {
            return rawValue;
        }

        valueId = getSafeProperty(value, 'ID');
        if (!isEmptyValue(valueId)) {
            return valueId;
        }
    }

    return value;
}

/**
 * Returns the display value for an enum-like value when available.
 * @param {*} value - Value to normalize.
 * @returns {*} display value.
 */
function toDisplayValue(value) {
    var displayValue;

    if (value === null || value === undefined) {
        return value;
    }

    if (typeof value === 'object') {
        displayValue = getSafeProperty(value, 'displayValue');

        if (!isEmptyValue(displayValue)) {
            return displayValue;
        }
    }

    return toSerializableRawValue(value);
}

/**
 * Converts a raw source value into the configured export value.
 * @param {*} rawValue - Raw source value.
 * @param {Object} mapping - Mapping row.
 * @param {Object|null} attributeDefinition - Attribute definition.
 * @returns {*} converted value.
 */
function convertValue(rawValue, mapping, attributeDefinition) {
    if (mapping.valueMode === 'displayValueArray') {
        return toValueArray(rawValue).map(toDisplayValue).filter(function (value) {
            return !isEmptyValue(value);
        });
    }

    if (mapping.valueMode === 'displayValue') {
        if (shouldNormalizeAsArray(rawValue, attributeDefinition)) {
            return toValueArray(rawValue).map(toDisplayValue).filter(function (value) {
                return !isEmptyValue(value);
            });
        }

        return toDisplayValue(rawValue);
    }

    if (shouldNormalizeAsArray(rawValue, attributeDefinition)) {
        return toValueArray(rawValue).map(toSerializableRawValue).filter(function (value) {
            return !isEmptyValue(value);
        });
    }

    return toSerializableRawValue(rawValue);
}

/**
 * Returns whether a mapping should apply to the current item type.
 * @param {string} appliesTo - Mapping appliesTo value.
 * @param {string} objectType - Exported item type.
 * @returns {boolean} whether the mapping applies.
 */
function mappingAppliesTo(appliesTo, objectType) {
    return appliesTo === 'Both' || appliesTo === objectType;
}

/**
 * Returns the combined built-in and configured field mappings for a context.
 * @param {Object} exportContext - Export context.
 * @returns {Array} mapping rows.
 */
function getResolvedMappings(exportContext) {
    var configuredMappings = exportContext && Array.isArray(exportContext.fieldMappings)
        ? exportContext.fieldMappings
        : [];

    return DEFAULT_FIELD_MAPPINGS.concat(configuredMappings);
}

/**
 * Returns whether a converted mapping value should be written to the payload.
 * @param {*} value - Value to inspect.
 * @returns {boolean} whether the value should be written.
 */
function shouldWriteValue(value) {
    if (value === null || value === undefined) {
        return false;
    }

    if (typeof value === 'string') {
        return value !== '';
    }

    if (Array.isArray(value)) {
        return value.length > 0;
    }

    return true;
}

/**
 * Returns a stable product identifier for mapping diagnostics.
 * @param {Object} product - Exported product object.
 * @returns {string} product identifier.
 */
function getProductIdentifier(product) {
    if (product && product.ID) {
        return String(product.ID);
    }

    return '[unknown product]';
}

/**
 * Applies the built-in and configured mappings to a product payload.
 * @param {Object} payload - Export payload.
 * @param {Object} product - Exported product object.
 * @param {string} objectType - Product or Variant.
 * @param {Object} exportContext - Export context.
 * @returns {Object} updated payload.
 */
function applyFieldMappings(payload, product, objectType, exportContext) {
    getResolvedMappings(exportContext).forEach(function (mapping) {
        try {
            if (!mappingAppliesTo(mapping.appliesTo, objectType)) {
                return;
            }

            var sourceObject = resolveSourceObject(product, mapping.sourceObject);
            var attributeDefinition = getAttributeDefinition(sourceObject, mapping);
            var mappedValue = convertValue(getSourceValue(sourceObject, mapping), mapping, attributeDefinition);

            if (!shouldWriteValue(mappedValue)) {
                return;
            }

            payload[mapping.targetField] = mappedValue;
        } catch (error) {
            Logger.error(
                '(fieldMappingHelper-applyFieldMappings) -> Skipping mapping {0} for {1} {2}. {3}',
                mapping.mappingId || mapping.targetField || '[unknown mapping]',
                objectType || '[unknown object type]',
                getProductIdentifier(product),
                error.message || error
            );
        }
    });

    return payload;
}

module.exports = {
    MAPPING_CUSTOM_OBJECT_TYPE: MAPPING_CUSTOM_OBJECT_TYPE,
    PROFILE_CUSTOM_OBJECT_TYPE: PROFILE_CUSTOM_OBJECT_TYPE,
    RESERVED_TARGET_FIELDS: RESERVED_TARGET_FIELDS,
    applyFieldMappings: applyFieldMappings,
    buildFieldMappingContext: buildFieldMappingContext,
    validateFieldMappings: validateFieldMappings
};
