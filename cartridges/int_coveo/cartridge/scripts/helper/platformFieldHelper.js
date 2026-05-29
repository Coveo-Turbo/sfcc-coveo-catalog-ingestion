'use strict';

var Logger = require('dw/system/Logger').getLogger('Coveo');
var Site = require('dw/system/Site');
var fieldMappingHelper = require('*/cartridge/scripts/helper/fieldMappingHelper');
var fieldMappingImportHelper = require('*/cartridge/scripts/helper/fieldMappingImportHelper');
var platformFieldService = require('*/cartridge/scripts/services/platformFieldService');

var FIELD_NAME_PATTERN = /^([a-z][a-z0-9_]{0,254})$/;
var DEFAULT_MULTI_VALUE_FACET_TOKENIZERS = ';';
var SUPPORTED_FIELD_TYPES = {
    LONG: true,
    LONG_64: true,
    DOUBLE: true,
    DATE: true,
    STRING: true
};
var SUPPORTED_BOOLEAN_FIELD_OPTIONS = [
    'facet',
    'includeInQuery',
    'includeInResults',
    'mergeWithLexicon',
    'multiValueFacet',
    'ranking',
    'sort',
    'smartDateFacet',
    'stemming',
    'useCacheForComputedFacet',
    'useCacheForNestedQuery',
    'useCacheForNumericQuery',
    'useCacheForSort'
];

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
 * Returns whether the value should be treated as empty.
 * @param {*} value - Value to inspect.
 * @returns {boolean} whether the value is empty.
 */
function isEmptyValue(value) {
    return value === null || value === undefined || value === '';
}

/**
 * Returns the configured Coveo organization id for the current site or options.
 * @param {Object} options - Optional runtime options.
 * @returns {string} organization id.
 */
function getOrganizationId(options) {
    var sitePreferences = Site.current && Site.current.preferences && Site.current.preferences.custom
        ? Site.current.preferences.custom
        : {};

    return normalizeString(options && options.coveoOrganizationId) || normalizeString(sitePreferences.coveoOrganizationId);
}

/**
 * Builds a stable generated field description.
 * @param {Object} profile - Mapping profile definition.
 * @param {Object} mapping - Field mapping row.
 * @returns {string} generated description.
 */
function buildDefaultDescription(profile, mapping) {
    return [
        'Generated from SFCC mapping profile',
        profile.profileId + ':',
        mapping.sourceObject + '.' + mapping.sourceScope + '.' + mapping.sourceAttributeId,
        '->',
        mapping.targetField
    ].join(' ');
}

/**
 * Applies boolean field options to a definition when explicitly set.
 * @param {Object} definition - Target field definition.
 * @param {Object|null} coveoField - Optional mapping field configuration.
 */
function applyExplicitBooleanOptions(definition, coveoField) {
    SUPPORTED_BOOLEAN_FIELD_OPTIONS.forEach(function (optionName) {
        if (coveoField && coveoField[optionName] !== undefined) {
            definition[optionName] = coveoField[optionName];
        }
    });
}

/**
 * Validates a derived Coveo field definition before sending it to the API.
 * @param {Object} definition - Field definition to validate.
 * @param {Object} mapping - Source mapping row.
 */
function validateFieldDefinition(definition, mapping) {
    if (!FIELD_NAME_PATTERN.test(definition.name)) {
        throw new Error(
            'The mapping '
            + mapping.mappingId
            + ' targets field '
            + definition.name
            + ', which is not a valid Coveo field name. Use lowercase letters, digits, and underscores only.'
        );
    }

    if (!Object.prototype.hasOwnProperty.call(SUPPORTED_FIELD_TYPES, definition.type)) {
        throw new Error(
            'The mapping '
            + mapping.mappingId
            + ' uses unsupported Coveo field type '
            + definition.type
            + '. Supported values are '
            + Object.keys(SUPPORTED_FIELD_TYPES).join(', ')
            + '.'
        );
    }

    if (definition.type !== 'STRING' && definition.multiValueFacet === true) {
        throw new Error(
            'The mapping '
            + mapping.mappingId
            + ' configures multiValueFacet on non-STRING field '
            + definition.name
            + '.'
        );
    }

    if (definition.multiValueFacet === true) {
        if (isEmptyValue(definition.multiValueFacetTokenizers)) {
            throw new Error(
                'The mapping '
                + mapping.mappingId
                + ' configures multiValueFacet on field '
                + definition.name
                + ' without multiValueFacetTokenizers.'
            );
        }
    }

    if (definition.type !== 'STRING' && definition.stemming === true) {
        throw new Error(
            'The mapping '
            + mapping.mappingId
            + ' configures stemming on non-STRING field '
            + definition.name
            + '.'
        );
    }
}

/**
 * Builds a Platform Field API definition from a field mapping row.
 * @param {Object} profile - Mapping profile definition.
 * @param {Object} mapping - Validated mapping row.
 * @returns {Object|null} field definition or null when remote sync is disabled.
 */
function buildFieldDefinition(profile, mapping) {
    var coveoField = mapping.coveoField || null;
    var definition = null;

    if (coveoField && coveoField.sync === false) {
        return null;
    }

    definition = {
        name: normalizeString(mapping.targetField),
        description: coveoField && !isEmptyValue(coveoField.description)
            ? coveoField.description
            : buildDefaultDescription(profile, mapping),
        type: coveoField && !isEmptyValue(coveoField.type) ? coveoField.type : 'STRING'
    };

    applyExplicitBooleanOptions(definition, coveoField);

    if (mapping.valueMode === 'displayValueArray' && definition.facet === true && definition.multiValueFacet === undefined) {
        definition.multiValueFacet = true;
    }

    if (mapping.valueMode === 'displayValueArray' && definition.multiValueFacet === undefined) {
        definition.multiValueFacet = true;
    }

    if (definition.multiValueFacet === true && definition.facet === true) {
        delete definition.facet;
    }

    if (definition.multiValueFacet === true) {
        definition.multiValueFacetTokenizers = coveoField && !isEmptyValue(coveoField.multiValueFacetTokenizers)
            ? coveoField.multiValueFacetTokenizers
            : DEFAULT_MULTI_VALUE_FACET_TOKENIZERS;
    }

    validateFieldDefinition(definition, mapping);

    return definition;
}

/**
 * Returns validated enabled field mappings while preserving optional coveoField config.
 * @param {Object} config - Parsed JSON payload.
 * @returns {Object} normalized profile and validated mappings.
 */
function getValidatedMappings(config) {
    var normalizedConfig = fieldMappingImportHelper.normalizeImportConfig(config);
    var coveoFieldsByMappingId = {};
    var validatedMappings = null;

    normalizedConfig.mappings.forEach(function (mapping) {
        coveoFieldsByMappingId[mapping.mappingId] = mapping.coveoField || null;
    });

    validatedMappings = fieldMappingHelper.validateFieldMappings(normalizedConfig.mappings).map(function (mapping) {
        mapping.coveoField = coveoFieldsByMappingId[mapping.mappingId] || null;
        return mapping;
    });

    return {
        profile: normalizedConfig.profile,
        mappings: validatedMappings
    };
}

/**
 * Builds the list of Coveo platform field definitions from the JSON payload.
 * @param {Object} config - Parsed JSON payload.
 * @returns {Object} profile and field definition list.
 */
function buildFieldDefinitionsFromConfig(config) {
    var validatedConfig = getValidatedMappings(config);

    return {
        profile: validatedConfig.profile,
        fields: validatedConfig.mappings.map(function (mapping) {
            return buildFieldDefinition(validatedConfig.profile, mapping);
        }).filter(function (fieldDefinition) {
            return fieldDefinition !== null;
        })
    };
}

/**
 * Creates fields individually to diagnose or recover from batch failures.
 * @param {Array} fields - Field definitions to create.
 * @param {string} organizationId - Coveo organization id.
 * @returns {Object} per-field results.
 */
function createFieldsIndividually(fields, organizationId) {
    var results = {
        succeeded: [],
        failed: []
    };

    (fields || []).forEach(function (fieldDefinition) {
        var response = platformFieldService.createFields([fieldDefinition], {
            coveoOrganizationId: organizationId
        });

        if (isFieldAlreadyExistsResponse(response) || (response && response.ok)) {
            results.succeeded.push(fieldDefinition.name);
            return;
        }

        results.failed.push({
            name: fieldDefinition.name,
            response: response
        });
    });

    return results;
}

/**
 * Returns whether a service response indicates the target field already exists.
 * @param {Object} response - Service response.
 * @returns {boolean} whether the field already exists.
 */
function isFieldAlreadyExistsResponse(response) {
    var errorMessage = normalizeString(response && response.errorMessage);

    return normalizeString(response && response.status) === 'ERROR'
        && (String(response && response.error) === '412' || String(response && response.error) === '')
        && errorMessage.indexOf('FIELD_ALREADY_EXISTS') !== -1;
}

/**
 * Creates missing platform fields from the JSON payload.
 * @param {Object} config - Parsed JSON payload.
 * @param {Object} options - Runtime options.
 * @returns {Object} sync summary.
 */
function createFieldsFromConfig(config, options) {
    var organizationId = getOrganizationId(options);
    var generatedFields = buildFieldDefinitionsFromConfig(config);
    var response = null;
    var summary = {
        profileId: generatedFields.profile.profileId,
        siteId: generatedFields.profile.siteId,
        organizationId: organizationId,
        fieldsRequested: generatedFields.fields.length,
        fieldNames: generatedFields.fields.map(function (fieldDefinition) {
            return fieldDefinition.name;
        }),
        fieldDefinitions: generatedFields.fields
    };

    if (isEmptyValue(organizationId)) {
        throw new Error('The Coveo platform field creation requires the site preference coveoOrganizationId to be configured.');
    }

    if (generatedFields.fields.length === 0) {
        Logger.info(
            'Skipped Coveo platform field creation for profile {0} on site {1} because no enabled mappings requested remote fields.',
            summary.profileId,
            summary.siteId
        );

        return summary;
    }

    response = platformFieldService.createFields(generatedFields.fields, {
        coveoOrganizationId: organizationId
    });
    summary.response = response;

    if (isFieldAlreadyExistsResponse(response) || !response.ok) {
        summary.fallbackMode = 'single';
        summary.individualResults = createFieldsIndividually(generatedFields.fields, organizationId);

        if (summary.individualResults.failed.length === 0) {
            Logger.info(
                'Recovered Coveo platform field creation for profile {0} on site {1} by retrying {2} fields individually after a failed batch request.',
                summary.profileId,
                summary.siteId,
                summary.fieldsRequested
            );

            summary.response = {
                ok: true,
                status: 'OK',
                object: {}
            };
        }
    }

    return summary;
}

module.exports = {
    buildFieldDefinitionsFromConfig: buildFieldDefinitionsFromConfig,
    createFieldsFromConfig: createFieldsFromConfig
};
