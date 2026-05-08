'use strict';

var CustomObjectMgr = require('dw/object/CustomObjectMgr');
var Logger = require('dw/system/Logger').getLogger('Coveo');
var Site = require('dw/system/Site');
var Transaction = require('dw/system/Transaction');
var fieldMappingHelper = require('*/cartridge/scripts/helper/fieldMappingHelper');

var SUPPORTED_COVEO_FIELD_TYPES = {
    LONG: true,
    LONG_64: true,
    DOUBLE: true,
    DATE: true,
    STRING: true
};

var SUPPORTED_COVEO_FIELD_BOOLEAN_OPTIONS = [
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
 * Converts supported truthy values to boolean.
 * @param {*} value - Value to normalize.
 * @param {boolean} defaultValue - Default value when unset.
 * @returns {boolean} normalized boolean.
 */
function toBoolean(value, defaultValue) {
    if (value === true || value === false) {
        return value;
    }

    var normalized = normalizeString(value);

    if (normalized === '') {
        return defaultValue === true;
    }

    return normalized.toLowerCase() === 'true';
}

/**
 * Converts supported truthy values to boolean while preserving undefined when unset.
 * @param {*} value - Value to normalize.
 * @returns {boolean|undefined} normalized boolean or undefined.
 */
function toOptionalBoolean(value) {
    if (value === null || value === undefined) {
        return undefined;
    }

    if (value === true || value === false) {
        return value;
    }

    var normalized = normalizeString(value);

    if (normalized === '') {
        return undefined;
    }

    return normalized.toLowerCase() === 'true';
}

/**
 * Normalizes a multi-value facet tokenizer setting into a string value.
 * @param {*} value - Raw tokenizer config value.
 * @param {string} mappingId - Owning mapping identifier.
 * @returns {string|undefined} normalized tokenizer string or undefined when unset.
 */
function normalizeOptionalString(value, mappingId) {
    if (value === null || value === undefined) {
        return undefined;
    }

    if (Array.isArray(value)) {
        var normalizedValues = value.map(normalizeString).filter(function (entry) {
            return entry !== '';
        });

        if (!normalizedValues.length) {
            return undefined;
        }

        return normalizedValues.join('');
    }

    if (typeof value === 'string') {
        var normalizedValue = normalizeString(value);
        return normalizedValue === '' ? undefined : normalizedValue;
    }

    throwConfigError('Mapping ' + mappingId + ' must define coveoField.multiValueFacetTokenizers as a string or array of strings when provided.');
}

/**
 * Closes iterators returned by SFCC APIs when supported.
 * @param {Object} iterator - Iterator to close.
 */
function closeIterator(iterator) {
    if (iterator && typeof iterator.close === 'function') {
        iterator.close();
    }
}

/**
 * Throws a normalized import configuration error.
 * @param {string} message - Error message.
 */
function throwConfigError(message) {
    throw new Error('Invalid Coveo field mapping import file. ' + message);
}

/**
 * Throws when a required configuration value is missing.
 * @param {string} fieldName - Field name.
 * @param {string} value - Field value.
 * @param {string} label - Human-readable config label.
 */
function requireValue(fieldName, value, label) {
    if (normalizeString(value) === '') {
        throwConfigError(label + ' is missing required value ' + fieldName + '.');
    }
}

/**
 * Normalizes an optional Coveo platform field definition nested under a mapping row.
 * @param {Object|undefined|null} coveoField - Raw field definition.
 * @param {string} mappingId - Owning mapping identifier.
 * @returns {Object|null} normalized field definition.
 */
function normalizeCoveoFieldDefinition(coveoField, mappingId) {
    if (coveoField === null || coveoField === undefined) {
        return null;
    }

    if (typeof coveoField !== 'object' || Array.isArray(coveoField)) {
        throwConfigError('Mapping ' + mappingId + ' must define coveoField as an object when provided.');
    }

    var normalizedField = {
        sync: toBoolean(coveoField.sync, true),
        description: normalizeString(coveoField.description),
        type: normalizeString(coveoField.type),
        multiValueFacetTokenizers: normalizeOptionalString(coveoField.multiValueFacetTokenizers, mappingId)
    };

    SUPPORTED_COVEO_FIELD_BOOLEAN_OPTIONS.forEach(function (optionName) {
        normalizedField[optionName] = toOptionalBoolean(coveoField[optionName]);
    });

    if (normalizedField.type !== '' && !Object.prototype.hasOwnProperty.call(SUPPORTED_COVEO_FIELD_TYPES, normalizedField.type)) {
        throwConfigError(
            'Mapping '
            + mappingId
            + ' uses unsupported coveoField.type '
            + normalizedField.type
            + '. Supported values are '
            + Object.keys(SUPPORTED_COVEO_FIELD_TYPES).join(', ')
            + '.'
        );
    }

    return normalizedField;
}

/**
 * Normalizes a profile definition from the JSON payload.
 * @param {Object} profile - Raw profile definition.
 * @returns {Object} normalized profile definition.
 */
function normalizeProfileDefinition(profile) {
    var currentSiteId = normalizeString(Site.current && Site.current.ID);

    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
        throwConfigError('The top-level profile property must be an object.');
    }

    var normalizedProfile = {
        profileId: normalizeString(profile.profileId),
        siteId: normalizeString(profile.siteId) || currentSiteId,
        enabled: toBoolean(profile.enabled, true),
        label: normalizeString(profile.label),
        notes: normalizeString(profile.notes)
    };

    requireValue('profileId', normalizedProfile.profileId, 'The profile definition');
    requireValue('siteId', normalizedProfile.siteId, 'The profile definition');

    if (currentSiteId && normalizedProfile.siteId !== currentSiteId) {
        throw new Error(
            'The field mapping import file targets site '
            + normalizedProfile.siteId
            + ', but the current job context is site '
            + currentSiteId
            + '.'
        );
    }

    return normalizedProfile;
}

/**
 * Normalizes mapping definitions from the JSON payload.
 * @param {Array} mappings - Raw mapping definitions.
 * @param {Object} profile - Normalized profile definition.
 * @returns {Array} normalized mapping definitions.
 */
function normalizeMappingDefinitions(mappings, profile) {
    var rawMappings = mappings;
    var seenMappingIds = {};

    if (rawMappings === null || rawMappings === undefined) {
        return [];
    }

    if (!Array.isArray(rawMappings)) {
        throwConfigError('The top-level mappings property must be an array.');
    }

    return rawMappings.map(function (mapping, index) {
        if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
            throwConfigError('Mapping at index ' + index + ' must be an object.');
        }

        var normalizedMapping = {
            mappingId: normalizeString(mapping.mappingId),
            siteId: normalizeString(mapping.siteId) || profile.siteId,
            profileId: normalizeString(mapping.profileId) || profile.profileId,
            enabled: toBoolean(mapping.enabled, true),
            sortOrder: normalizeString(mapping.sortOrder),
            appliesTo: normalizeString(mapping.appliesTo),
            sourceObject: normalizeString(mapping.sourceObject),
            sourceScope: normalizeString(mapping.sourceScope),
            sourceAttributeId: normalizeString(mapping.sourceAttributeId),
            targetField: normalizeString(mapping.targetField),
            valueMode: normalizeString(mapping.valueMode),
            coveoField: normalizeCoveoFieldDefinition(mapping.coveoField, normalizeString(mapping.mappingId) || ('index ' + index))
        };

        requireValue('mappingId', normalizedMapping.mappingId, 'Mapping at index ' + index);
        requireValue('appliesTo', normalizedMapping.appliesTo, 'Mapping ' + normalizedMapping.mappingId);
        requireValue('sourceObject', normalizedMapping.sourceObject, 'Mapping ' + normalizedMapping.mappingId);
        requireValue('sourceScope', normalizedMapping.sourceScope, 'Mapping ' + normalizedMapping.mappingId);
        requireValue('sourceAttributeId', normalizedMapping.sourceAttributeId, 'Mapping ' + normalizedMapping.mappingId);
        requireValue('targetField', normalizedMapping.targetField, 'Mapping ' + normalizedMapping.mappingId);
        requireValue('valueMode', normalizedMapping.valueMode, 'Mapping ' + normalizedMapping.mappingId);

        if (normalizedMapping.siteId !== profile.siteId) {
            throwConfigError(
                'Mapping '
                + normalizedMapping.mappingId
                + ' uses siteId '
                + normalizedMapping.siteId
                + ', but the imported profile uses siteId '
                + profile.siteId
                + '.'
            );
        }

        if (normalizedMapping.profileId !== profile.profileId) {
            throwConfigError(
                'Mapping '
                + normalizedMapping.mappingId
                + ' uses profileId '
                + normalizedMapping.profileId
                + ', but the imported profile uses profileId '
                + profile.profileId
                + '.'
            );
        }

        if (Object.prototype.hasOwnProperty.call(seenMappingIds, normalizedMapping.mappingId)) {
            throwConfigError('Duplicate mappingId ' + normalizedMapping.mappingId + ' was found in the import file.');
        }

        seenMappingIds[normalizedMapping.mappingId] = true;

        return normalizedMapping;
    });
}

/**
 * Normalizes and validates the full JSON payload.
 * @param {Object} config - Parsed JSON payload.
 * @returns {Object} normalized profile and mappings.
 */
function normalizeImportConfig(config) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
        throwConfigError('The root JSON value must be an object.');
    }

    var profile = normalizeProfileDefinition(config.profile);

    return {
        profile: profile,
        mappings: normalizeMappingDefinitions(config.mappings, profile)
    };
}

/**
 * Converts a custom object row into a plain mapping definition.
 * @param {Object} mappingObject - Custom object instance.
 * @returns {Object} plain mapping definition.
 */
function toMappingDefinition(mappingObject) {
    var custom = mappingObject && mappingObject.custom ? mappingObject.custom : {};

    return {
        mappingId: normalizeString(custom.mappingId),
        siteId: normalizeString(custom.siteId),
        profileId: normalizeString(custom.profileId),
        enabled: custom.enabled,
        sortOrder: normalizeString(custom.sortOrder),
        appliesTo: normalizeString(custom.appliesTo),
        sourceObject: normalizeString(custom.sourceObject),
        sourceScope: normalizeString(custom.sourceScope),
        sourceAttributeId: normalizeString(custom.sourceAttributeId),
        targetField: normalizeString(custom.targetField),
        valueMode: normalizeString(custom.valueMode)
    };
}

/**
 * Queries all mappings for a profile.
 * @param {string} siteId - Owning site identifier.
 * @param {string} profileId - Profile identifier.
 * @returns {Array} matching mapping objects.
 */
function getMappingsForProfile(siteId, profileId) {
    var mappings = [];
    var iterator = CustomObjectMgr.queryCustomObjects(
        fieldMappingHelper.MAPPING_CUSTOM_OBJECT_TYPE,
        'custom.siteId = {0} AND custom.profileId = {1}',
        'creationDate asc',
        siteId,
        profileId
    );

    try {
        while (iterator.hasNext()) {
            mappings.push(iterator.next());
        }
    } finally {
        closeIterator(iterator);
    }

    return mappings;
}

/**
 * Creates or updates the mapping profile custom object.
 * @param {Object} profile - Normalized profile definition.
 * @returns {boolean} true when the profile was created.
 */
function upsertProfile(profile) {
    var profileObject = CustomObjectMgr.getCustomObject(fieldMappingHelper.PROFILE_CUSTOM_OBJECT_TYPE, profile.profileId);
    var created = false;

    if (!profileObject) {
        profileObject = CustomObjectMgr.createCustomObject(fieldMappingHelper.PROFILE_CUSTOM_OBJECT_TYPE, profile.profileId);
        created = true;
    }

    profileObject.custom.profileId = profile.profileId;
    profileObject.custom.siteId = profile.siteId;
    profileObject.custom.enabled = profile.enabled;
    profileObject.custom.label = profile.label;
    profileObject.custom.notes = profile.notes;

    return created;
}

/**
 * Applies imported mapping definitions to custom objects.
 * @param {Array} mappings - Normalized mapping definitions.
 * @param {Array} existingMappings - Existing mapping custom objects.
 * @returns {Object} import counters and imported IDs.
 */
function upsertMappings(mappings, existingMappings) {
    var existingById = {};
    var importedIds = {};
    var created = 0;
    var updated = 0;

    existingMappings.forEach(function (mappingObject) {
        existingById[normalizeString(mappingObject.custom && mappingObject.custom.mappingId)] = mappingObject;
    });

    mappings.forEach(function (mapping) {
        var mappingObject = existingById[mapping.mappingId];

        if (!mappingObject) {
            mappingObject = CustomObjectMgr.createCustomObject(fieldMappingHelper.MAPPING_CUSTOM_OBJECT_TYPE, mapping.mappingId);
            created += 1;
        } else {
            updated += 1;
        }

        mappingObject.custom.mappingId = mapping.mappingId;
        mappingObject.custom.siteId = mapping.siteId;
        mappingObject.custom.profileId = mapping.profileId;
        mappingObject.custom.enabled = mapping.enabled;
        mappingObject.custom.sortOrder = mapping.sortOrder;
        mappingObject.custom.appliesTo = mapping.appliesTo;
        mappingObject.custom.sourceObject = mapping.sourceObject;
        mappingObject.custom.sourceScope = mapping.sourceScope;
        mappingObject.custom.sourceAttributeId = mapping.sourceAttributeId;
        mappingObject.custom.targetField = mapping.targetField;
        mappingObject.custom.valueMode = mapping.valueMode;

        importedIds[mapping.mappingId] = true;
    });

    return {
        created: created,
        updated: updated,
        importedIds: importedIds
    };
}

/**
 * Removes stale mapping rows when replace mode is enabled.
 * @param {Array} existingMappings - Existing mapping custom objects.
 * @param {Object} importedIds - Imported mapping IDs keyed by mappingId.
 * @returns {number} number of removed mappings.
 */
function removeStaleMappings(existingMappings, importedIds) {
    var deleted = 0;

    existingMappings.forEach(function (mappingObject) {
        var mappingId = normalizeString(mappingObject.custom && mappingObject.custom.mappingId);

        if (!Object.prototype.hasOwnProperty.call(importedIds, mappingId)) {
            CustomObjectMgr.remove(mappingObject);
            deleted += 1;
        }
    });

    return deleted;
}

/**
 * Validates the final profile state using the export runtime rules.
 * @param {string} siteId - Owning site identifier.
 * @param {string} profileId - Profile identifier.
 */
function validateFinalMappings(siteId, profileId) {
    var finalDefinitions = getMappingsForProfile(siteId, profileId).map(toMappingDefinition);

    fieldMappingHelper.validateFieldMappings(finalDefinitions);
}

/**
 * Imports a field mapping profile and mapping rows from a parsed JSON payload.
 * @param {Object} config - Parsed JSON payload.
 * @param {Object} options - Import options.
 * @returns {Object} import summary.
 */
function importFromConfig(config, options) {
    var replaceExistingMappings = !!(options && options.replaceExistingMappings);
    var normalizedConfig = normalizeImportConfig(config);
    var profile = normalizedConfig.profile;
    var mappings = normalizedConfig.mappings;
    var summary = {
        profileId: profile.profileId,
        siteId: profile.siteId,
        profileCreated: false,
        mappingsImported: mappings.length,
        mappingsCreated: 0,
        mappingsUpdated: 0,
        mappingsDeleted: 0,
        replaceExistingMappings: replaceExistingMappings
    };

    Transaction.wrap(function () {
        var existingMappings = getMappingsForProfile(profile.siteId, profile.profileId);
        var upsertSummary;

        summary.profileCreated = upsertProfile(profile);
        upsertSummary = upsertMappings(mappings, existingMappings);
        summary.mappingsCreated = upsertSummary.created;
        summary.mappingsUpdated = upsertSummary.updated;

        if (replaceExistingMappings) {
            summary.mappingsDeleted = removeStaleMappings(existingMappings, upsertSummary.importedIds);
        }

        validateFinalMappings(profile.siteId, profile.profileId);
    });

    Logger.info(
        'Imported Coveo field mapping profile {0} for site {1}. profileCreated={2}, mappingsImported={3}, mappingsCreated={4}, mappingsUpdated={5}, mappingsDeleted={6}, replaceExistingMappings={7}',
        summary.profileId,
        summary.siteId,
        summary.profileCreated,
        summary.mappingsImported,
        summary.mappingsCreated,
        summary.mappingsUpdated,
        summary.mappingsDeleted,
        summary.replaceExistingMappings
    );

    return summary;
}

module.exports = {
    importFromConfig: importFromConfig,
    normalizeImportConfig: normalizeImportConfig
};
