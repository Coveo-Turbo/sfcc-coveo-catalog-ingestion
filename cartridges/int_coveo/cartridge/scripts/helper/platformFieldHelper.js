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
 * Builds searchable Coveo fields for an export target's alternate locales.
 * @param {Object} exportContext - Resolved catalog export context.
 * @returns {Array} field definitions.
 */
function buildAlternateLanguageFieldDefinitions(exportContext) {
    var fields = [];

    (exportContext && exportContext.alternateLocalizations || []).forEach(function (localization) {
        [
            localization.nameField,
            localization.descriptionField,
            localization.shortDescriptionField
        ].forEach(function (fieldName) {
            fields.push({
                name: fieldName,
                description: 'Generated from SFCC alternate locale ' + localization.locale + ' for export target ' + exportContext.targetId + '.',
                type: 'STRING',
                includeInQuery: true,
                includeInResults: true
            });
        });
    });

    return fields;
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
 * Returns field names reported as already existing by the Platform API.
 * @param {Object} response - Service response.
 * @returns {Array} existing field names.
 */
function getAlreadyExistingFieldNames(response) {
    var errorMessage = normalizeString(response && response.errorMessage);
    var parsedMessage = '';
    var match = null;

    if (isEmptyValue(errorMessage)) {
        return [];
    }

    try {
        parsedMessage = JSON.parse(errorMessage).message || '';
    } catch (error) {
        parsedMessage = errorMessage;
    }

    match = /Fields \[([^\]]+)\] already exist\./.exec(parsedMessage);

    if (!match || isEmptyValue(match[1])) {
        return [];
    }

    return match[1].split(',').map(function (fieldName) {
        return normalizeString(fieldName);
    }).filter(function (fieldName) {
        return !isEmptyValue(fieldName);
    });
}

/**
 * Creates the requested platform field definitions with existing-field recovery.
 * @param {Array} fieldDefinitions - Validated field definitions.
 * @param {Object} summary - Summary identity for a profile or export target.
 * @param {Object} options - Runtime options.
 * @returns {Object} sync summary.
 */
function createFieldDefinitions(fieldDefinitions, summary, options) {
    var organizationId = getOrganizationId(options);
    var response = null;
    var existingFieldNames = [];
    var existingFieldLookup = {};
    var missingFieldDefinitions = [];
    var resolvedSummary = summary || {};

    resolvedSummary.organizationId = organizationId;
    resolvedSummary.fieldsRequested = fieldDefinitions.length;
    resolvedSummary.fieldNames = fieldDefinitions.map(function (fieldDefinition) {
        return fieldDefinition.name;
    });
    resolvedSummary.fieldDefinitions = fieldDefinitions;

    if (isEmptyValue(organizationId)) {
        throw new Error('The Coveo platform field creation requires the site preference coveoOrganizationId to be configured.');
    }

    if (fieldDefinitions.length === 0) {
        Logger.info(
            'Skipped Coveo platform field creation for {0} on site {1} because no fields were requested.',
            resolvedSummary.profileId || resolvedSummary.targetId,
            resolvedSummary.siteId
        );

        return resolvedSummary;
    }

    response = platformFieldService.createFields(fieldDefinitions, {
        coveoOrganizationId: organizationId
    });
    resolvedSummary.response = response;

    if (isFieldAlreadyExistsResponse(response)) {
        existingFieldNames = getAlreadyExistingFieldNames(response);
        resolvedSummary.existingFieldNames = existingFieldNames;

        if (existingFieldNames.length === fieldDefinitions.length) {
            resolvedSummary.response = {
                ok: true,
                status: 'OK',
                object: {}
            };

            return resolvedSummary;
        }

        existingFieldNames.forEach(function (fieldName) {
            existingFieldLookup[fieldName] = true;
        });

        missingFieldDefinitions = fieldDefinitions.filter(function (fieldDefinition) {
            return !existingFieldLookup[fieldDefinition.name];
        });

        resolvedSummary.fallbackMode = 'single';
        resolvedSummary.individualResults = createFieldsIndividually(missingFieldDefinitions, organizationId);

        if (resolvedSummary.individualResults.failed.length === 0) {
            Logger.info(
                'Recovered Coveo platform field creation for {0} on site {1} by creating {2} missing fields individually after the batch reported {3} existing fields.',
                resolvedSummary.profileId || resolvedSummary.targetId,
                resolvedSummary.siteId,
                missingFieldDefinitions.length,
                existingFieldNames.length
            );

            resolvedSummary.response = {
                ok: true,
                status: 'OK',
                object: {}
            };
        }
    } else if (!response.ok) {
        resolvedSummary.fallbackMode = 'single';
        resolvedSummary.individualResults = createFieldsIndividually(fieldDefinitions, organizationId);

        if (resolvedSummary.individualResults.failed.length === 0) {
            Logger.info(
                'Recovered Coveo platform field creation for {0} on site {1} by retrying {2} fields individually after a failed batch request.',
                resolvedSummary.profileId || resolvedSummary.targetId,
                resolvedSummary.siteId,
                resolvedSummary.fieldsRequested
            );

            resolvedSummary.response = {
                ok: true,
                status: 'OK',
                object: {}
            };
        }
    }

    return resolvedSummary;
}

/**
 * Creates missing platform fields from the JSON payload.
 * @param {Object} config - Parsed JSON payload.
 * @param {Object} options - Runtime options.
 * @returns {Object} sync summary.
 */
function createFieldsFromConfig(config, options) {
    var generatedFields = buildFieldDefinitionsFromConfig(config);

    return createFieldDefinitions(generatedFields.fields, {
        profileId: generatedFields.profile.profileId,
        siteId: generatedFields.profile.siteId
    }, options);
}

/**
 * Creates missing alternate-language fields for one export target.
 * @param {Object} exportContext - Resolved export context.
 * @returns {Object} sync summary.
 */
function createFieldsForExportTarget(exportContext) {
    return createFieldDefinitions(buildAlternateLanguageFieldDefinitions(exportContext), {
        targetId: exportContext.targetId,
        siteId: exportContext.siteId
    }, {
        coveoOrganizationId: exportContext.coveoOrganizationId
    });
}

module.exports = {
    buildAlternateLanguageFieldDefinitions: buildAlternateLanguageFieldDefinitions,
    buildFieldDefinitionsFromConfig: buildFieldDefinitionsFromConfig,
    createFieldsForExportTarget: createFieldsForExportTarget,
    createFieldsFromConfig: createFieldsFromConfig
};
