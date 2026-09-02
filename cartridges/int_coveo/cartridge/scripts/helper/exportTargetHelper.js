'use strict';

var CustomObjectMgr = require('dw/object/CustomObjectMgr');
var fieldMappingHelper = require('*/cartridge/scripts/helper/fieldMappingHelper');
var Logger = require('dw/system/Logger').getLogger('Coveo');
var Site = require('dw/system/Site');
var Transaction = require('dw/system/Transaction');

var TARGET_CUSTOM_OBJECT_TYPE = 'CoveoCatalogExportTarget';
var CATALOG_STRUCTURE_MODE_PRODUCT_VARIANT = 'product_variant';
var CATALOG_STRUCTURE_MODE_PRODUCT_ONLY = 'product_only';
var PRODUCT_ELIGIBILITY_MODE_LEGACY = 'legacy';
var PRODUCT_ELIGIBILITY_MODE_ALL = 'all';
var PRODUCT_ELIGIBILITY_MODE_ONLINE_AND_SEARCHABLE = 'online_and_searchable';

/**
 * Returns the normalized catalog structure mode for an export target.
 * @param {*} value - Raw catalog structure mode.
 * @returns {string} normalized mode.
 */
function normalizeCatalogStructureMode(value) {
    var normalizedValue = normalizeString(value).toLowerCase();

    if (normalizedValue === '') {
        return CATALOG_STRUCTURE_MODE_PRODUCT_ONLY;
    }

    return normalizedValue;
}

/**
 * Returns the normalized product eligibility mode for an export target.
 * Blank values preserve the behavior of targets created before this setting existed.
 * @param {*} value - Raw product eligibility mode.
 * @returns {string} normalized mode.
 */
function normalizeProductEligibilityMode(value) {
    var normalizedValue = normalizeString(value).toLowerCase();

    if (normalizedValue === '') {
        return PRODUCT_ELIGIBILITY_MODE_LEGACY;
    }

    return normalizedValue;
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
 * Converts a locale value into a language code.
 * @param {string} locale - Locale identifier.
 * @returns {string} language code.
 */
function getLanguageFromLocale(locale) {
    var normalizedLocale = normalizeString(locale);

    if (empty(normalizedLocale)) {
        return '';
    }

    return normalizedLocale.split(/[-_]/)[0].toLowerCase();
}

/**
 * Converts supported truthy values to boolean.
 * @param {*} value - Value to inspect.
 * @returns {boolean} normalized boolean.
 */
function toBoolean(value) {
    if (value === true || value === false) {
        return value;
    }

    return normalizeString(value).toLowerCase() === 'true';
}

/**
 * Returns whether a Coveo organization id is structurally valid.
 * Coveo organization ids must be strictly alphanumeric.
 * @param {string} organizationId - Organization id to validate.
 * @returns {boolean} whether the id is valid.
 */
function isValidOrganizationId(organizationId) {
    return /^[A-Za-z0-9]+$/.test(normalizeString(organizationId));
}

/**
 * Closes iterators returned by SFCC APIs when supported.
 * @param {Object} iterator - Iterator to close.
 */
function closeIterator(iterator) {
    if (!empty(iterator) && typeof iterator.close === 'function') {
        iterator.close();
    }
}

/**
 * Builds the legacy single-target export context from site preferences.
 * @returns {Object} export context.
 */
function buildLegacyExportContext() {
    var currentSite = Site.current;
    var sitePreferences = currentSite.preferences.custom;
    var locale = normalizeString(currentSite.defaultLocale);

    return {
        legacyMode: true,
        targetObject: null,
        targetId: '',
        siteId: normalizeString(currentSite.ID),
        locale: locale,
        language: getLanguageFromLocale(locale),
        coveoOrganizationId: normalizeString(sitePreferences.coveoOrganizationId),
        coveoSourceId: normalizeString(sitePreferences.coveoSourceId),
        coveoTrackingId: '',
        coveoCountry: '',
        coveoCurrency: '',
        storefrontBaseUrl: '',
        listingCategoryUrlTemplate: '',
        listingBrandUrlTemplate: '',
        listingSlugAmpersandToken: '',
        catalogId: '',
        catalogStructureMode: CATALOG_STRUCTURE_MODE_PRODUCT_ONLY,
        productEligibilityMode: PRODUCT_ELIGIBILITY_MODE_LEGACY,
        mappingProfileId: '',
        mappingProfile: null,
        fieldMappings: [],
        enabled: true,
        lastSync: sitePreferences.coveoCatalogLastSync || null,
        label: 'Legacy site export'
    };
}

/**
 * Maps a custom object to a normalized export context.
 * @param {Object} targetObject - Custom object instance.
 * @param {string} targetId - Explicit target identifier, when known.
 * @returns {Object} export context.
 */
function buildTargetExportContext(targetObject, targetId) {
    var custom = targetObject.custom || {};

    return {
        legacyMode: false,
        targetObject: targetObject,
        targetId: normalizeString(targetId) || normalizeString(custom.targetId),
        siteId: normalizeString(custom.siteId),
        locale: normalizeString(custom.locale),
        language: normalizeString(custom.language).toLowerCase(),
        coveoOrganizationId: normalizeString(Site.current.preferences.custom.coveoOrganizationId),
        coveoSourceId: normalizeString(custom.coveoSourceId),
        coveoTrackingId: normalizeString(custom.coveoTrackingId),
        coveoCountry: normalizeString(custom.coveoCountry).toUpperCase(),
        coveoCurrency: normalizeString(custom.coveoCurrency).toUpperCase(),
        storefrontBaseUrl: normalizeString(custom.storefrontBaseUrl),
        listingCategoryUrlTemplate: normalizeString(custom.listingCategoryUrlTemplate),
        listingBrandUrlTemplate: normalizeString(custom.listingBrandUrlTemplate),
        listingSlugAmpersandToken: normalizeString(custom.listingSlugAmpersandToken),
        catalogId: normalizeString(custom.catalogId),
        catalogStructureMode: normalizeCatalogStructureMode(custom.catalogStructureMode),
        productEligibilityMode: normalizeProductEligibilityMode(custom.productEligibilityMode),
        mappingProfileId: normalizeString(custom.mappingProfileId),
        mappingProfile: null,
        fieldMappings: [],
        enabled: toBoolean(custom.enabled),
        lastSync: custom.lastSync || null,
        label: normalizeString(custom.label),
        notes: normalizeString(custom.notes)
    };
}

/**
 * Enriches an export context with resolved field-mapping profile data.
 * @param {Object} exportContext - Export context.
 * @returns {Object} enriched export context.
 */
function enrichExportContext(exportContext) {
    var mappingContext = fieldMappingHelper.buildFieldMappingContext(exportContext);

    exportContext.mappingProfileId = mappingContext.mappingProfileId;
    exportContext.mappingProfile = mappingContext.mappingProfile;
    exportContext.fieldMappings = mappingContext.fieldMappings;

    return exportContext;
}

/**
 * Throws when a resolved export context is not valid.
 * @param {Object} exportContext - Export context.
 */
function validateExportContext(exportContext) {
    var missing = [];
    var contextLabel = exportContext.legacyMode
        ? 'legacy site preferences'
        : 'target ' + (exportContext.targetId || exportContext.label || exportContext.locale || '[unknown]');

    if (empty(exportContext.siteId)) {
        missing.push('siteId');
    }

    if (empty(exportContext.locale)) {
        missing.push('locale');
    }

    if (empty(exportContext.language)) {
        missing.push('language');
    }

    if (empty(exportContext.coveoOrganizationId)) {
        missing.push('coveoOrganizationId');
    }

    if (empty(exportContext.coveoSourceId)) {
        missing.push('coveoSourceId');
    }

    if (!exportContext.legacyMode && exportContext.enabled !== true) {
        throw new Error('The Coveo export target ' + (exportContext.targetId || exportContext.label || exportContext.locale) + ' is disabled.');
    }

    if (!empty(missing)) {
        throw new Error('The Coveo export ' + contextLabel + ' is missing required values: ' + missing.join(', ') + '.');
    }

    if (!isValidOrganizationId(exportContext.coveoOrganizationId)) {
        throw new Error(
            'The Coveo export ' + contextLabel
            + ' has an invalid coveoOrganizationId value "'
            + exportContext.coveoOrganizationId
            + '". Coveo organization ids must be alphanumeric. '
            + 'Update the site preference before running the export.'
        );
    }

    if (exportContext.catalogStructureMode !== CATALOG_STRUCTURE_MODE_PRODUCT_VARIANT
        && exportContext.catalogStructureMode !== CATALOG_STRUCTURE_MODE_PRODUCT_ONLY) {
        throw new Error(
            'The Coveo export ' + contextLabel
            + ' has unsupported catalogStructureMode value "'
            + exportContext.catalogStructureMode
            + '". Supported values are '
            + CATALOG_STRUCTURE_MODE_PRODUCT_VARIANT
            + ' and '
            + CATALOG_STRUCTURE_MODE_PRODUCT_ONLY
            + '.'
        );
    }

    if (exportContext.productEligibilityMode !== PRODUCT_ELIGIBILITY_MODE_LEGACY
        && exportContext.productEligibilityMode !== PRODUCT_ELIGIBILITY_MODE_ALL
        && exportContext.productEligibilityMode !== PRODUCT_ELIGIBILITY_MODE_ONLINE_AND_SEARCHABLE) {
        throw new Error(
            'The Coveo export ' + contextLabel
            + ' has unsupported productEligibilityMode value "'
            + exportContext.productEligibilityMode
            + '". Supported values are '
            + PRODUCT_ELIGIBILITY_MODE_LEGACY
            + ', '
            + PRODUCT_ELIGIBILITY_MODE_ALL
            + ', and '
            + PRODUCT_ELIGIBILITY_MODE_ONLINE_AND_SEARCHABLE
            + '.'
        );
    }

    if (exportContext.siteId !== normalizeString(Site.current.ID)) {
        throw new Error('The Coveo export target ' + (exportContext.targetId || exportContext.label || exportContext.locale) + ' is configured for site ' + exportContext.siteId + ' but the current job context is site ' + Site.current.ID + '.');
    }
}

/**
 * Returns all export targets configured for the current site.
 * @returns {Array} target custom objects.
 */
function getTargetsForCurrentSite() {
    var siteTargets = [];
    var targets = CustomObjectMgr.queryCustomObjects(
        TARGET_CUSTOM_OBJECT_TYPE,
        'custom.siteId = {0}',
        'creationDate asc',
        Site.current.ID
    );

    try {
        while (targets.hasNext()) {
            siteTargets.push(targets.next());
        }
    } finally {
        closeIterator(targets);
    }

    return siteTargets;
}

/**
 * Compares two normalized string values.
 * @param {string} left - Left-hand value.
 * @param {string} right - Right-hand value.
 * @returns {number} comparison result.
 */
function compareStrings(left, right) {
    var leftValue = normalizeString(left);
    var rightValue = normalizeString(right);

    if (leftValue === rightValue) {
        return 0;
    }

    return leftValue < rightValue ? -1 : 1;
}

/**
 * Returns a normalized target context for listing sync use.
 * @param {Object} targetObject - Custom object instance.
 * @param {string} targetId - Explicit target identifier, when known.
 * @returns {Object} export context.
 */
function buildListingSyncContext(targetObject, targetId) {
    var exportContext = buildTargetExportContext(targetObject, targetId);

    validateExportContext(exportContext);

    if (empty(exportContext.coveoTrackingId)) {
        throw new Error('The Coveo listing page sync target ' + (exportContext.targetId || exportContext.label || exportContext.locale || '[unknown]') + ' is missing required value coveoTrackingId.');
    }

    return exportContext;
}

/**
 * Builds a minimal context used to read existing listing pages.
 * @param {Object} targetObject - Custom object instance.
 * @returns {Object|null} read context or null when unusable.
 */
function buildListingReadContext(targetObject) {
    var exportContext = buildTargetExportContext(targetObject, '');

    if (empty(exportContext.siteId)
        || empty(exportContext.coveoOrganizationId)
        || empty(exportContext.coveoTrackingId)
        || exportContext.siteId !== normalizeString(Site.current.ID)
        || !isValidOrganizationId(exportContext.coveoOrganizationId)) {
        return null;
    }

    return exportContext;
}

/**
 * Groups export contexts by tracking ID.
 * @param {Array} exportContexts - Export contexts.
 * @returns {Array} grouped contexts.
 */
function groupListingSyncContexts(exportContexts) {
    var groupsByTrackingId = {};
    var groups = [];

    exportContexts.sort(function (left, right) {
        var localeComparison = compareStrings(left.locale, right.locale);

        if (localeComparison !== 0) {
            return localeComparison;
        }

        return compareStrings(left.targetId, right.targetId);
    }).forEach(function (exportContext) {
        var trackingId = normalizeString(exportContext.coveoTrackingId);
        var group = groupsByTrackingId[trackingId];

        if (empty(group)) {
            group = {
                trackingId: trackingId,
                exportContexts: [],
                primaryContext: exportContext
            };
            groupsByTrackingId[trackingId] = group;
            groups.push(group);
        }

        group.exportContexts.push(exportContext);
    });

    groups.sort(function (left, right) {
        return compareStrings(left.trackingId, right.trackingId);
    });

    return groups;
}

/**
 * Resolves listing-sync contexts grouped by tracking ID.
 * @param {Object} parameters - Job parameters.
 * @returns {Array} listing sync groups.
 */
function resolveListingSyncGroups(parameters) {
    var requestedTargetId = normalizeString(parameters && typeof parameters.get === 'function' ? parameters.get('targetId') : null);
    var targetObjects = [];
    var exportContexts = [];
    var siteReadContexts = [];
    var requestedTrackingId = '';
    var siteTargets = getTargetsForCurrentSite();

    if (!empty(requestedTargetId)) {
        var requestedTarget = CustomObjectMgr.getCustomObject(TARGET_CUSTOM_OBJECT_TYPE, requestedTargetId);

        if (empty(requestedTarget)) {
            throw new Error('No Coveo export target with targetId ' + requestedTargetId + ' exists.');
        }

        requestedTrackingId = normalizeString((requestedTarget.custom || {}).coveoTrackingId);

        if (empty(requestedTrackingId)) {
            throw new Error('The Coveo listing page sync target ' + requestedTargetId + ' is missing required value coveoTrackingId.');
        }

        targetObjects = siteTargets.filter(function (targetObject) {
            return normalizeString((targetObject.custom || {}).coveoTrackingId) === requestedTrackingId;
        });

        if (!targetObjects.length) {
            targetObjects = [requestedTarget];
        }
    } else {
        targetObjects = siteTargets;
    }

    if (!targetObjects.length) {
        throw new Error('No Coveo listing page sync targets are configured for site ' + Site.current.ID + '.');
    }

    targetObjects.forEach(function (targetObject) {
        exportContexts.push(buildListingSyncContext(targetObject, ''));
    });

    siteTargets.forEach(function (targetObject) {
        var readContext = buildListingReadContext(targetObject);

        if (!empty(readContext)) {
            siteReadContexts.push(readContext);
        }
    });

    return groupListingSyncContexts(exportContexts).map(function (group) {
        group.existingListingReadContexts = siteReadContexts;
        return group;
    });
}

/**
 * Resolves the export context based on job parameters and configured targets.
 * @param {Object} parameters - Job parameters.
 * @returns {Object} export context.
 */
function resolveExportContext(parameters) {
    var requestedTargetId = normalizeString(parameters && typeof parameters.get === 'function' ? parameters.get('targetId') : null);
    var resolvedContext;
    var siteTargets;

    if (!empty(requestedTargetId)) {
        var requestedTarget = CustomObjectMgr.getCustomObject(TARGET_CUSTOM_OBJECT_TYPE, requestedTargetId);

        if (empty(requestedTarget)) {
            throw new Error('No Coveo export target with targetId ' + requestedTargetId + ' exists.');
        }

        resolvedContext = buildTargetExportContext(requestedTarget, requestedTargetId);
        validateExportContext(resolvedContext);
        return enrichExportContext(resolvedContext);
    }

    siteTargets = getTargetsForCurrentSite();

    if (!siteTargets.length) {
        resolvedContext = buildLegacyExportContext();
        validateExportContext(resolvedContext);
        return enrichExportContext(resolvedContext);
    }

    if (siteTargets.length > 1) {
        throw new Error('Multiple Coveo export targets are configured for site ' + Site.current.ID + '. Run the job with a targetId parameter.');
    }

    resolvedContext = buildTargetExportContext(siteTargets[0], '');
    validateExportContext(resolvedContext);
    return enrichExportContext(resolvedContext);
}

/**
 * Applies the target locale to the current request when supported.
 * @param {Object} exportContext - Export context.
 * @returns {string} previous locale.
 */
function applyRequestLocale(exportContext) {
    if (empty(exportContext) || empty(exportContext.locale)) {
        return '';
    }

    if (typeof request === 'undefined' || empty(request) || typeof request.setLocale !== 'function') {
        Logger.warn('Unable to apply target locale {0} because the global request object is unavailable in this job context.', exportContext.locale);
        return '';
    }

    var previousLocale = normalizeString(request.locale);

    if (previousLocale !== exportContext.locale) {
        request.setLocale(exportContext.locale);
    }

    return previousLocale;
}

/**
 * Restores the previous request locale when supported.
 * @param {string} previousLocale - Previous locale.
 */
function restoreRequestLocale(previousLocale) {
    var normalizedLocale = normalizeString(previousLocale);

    if (empty(normalizedLocale)) {
        return;
    }

    if (typeof request === 'undefined' || empty(request) || typeof request.setLocale !== 'function') {
        return;
    }

    if (normalizeString(request.locale) !== normalizedLocale) {
        request.setLocale(normalizedLocale);
    }
}

/**
 * Persists the last successful sync time for the resolved context.
 * @param {Object} exportContext - Export context.
 * @param {Date} lastSync - Sync timestamp.
 */
function updateLastSync(exportContext, lastSync) {
    Transaction.wrap(function () {
        if (exportContext.legacyMode) {
            Site.current.preferences.custom.coveoCatalogLastSync = lastSync;
            return;
        }

        var targetObject = exportContext.targetObject;

        if (empty(targetObject) && !empty(exportContext.targetId)) {
            targetObject = CustomObjectMgr.getCustomObject(TARGET_CUSTOM_OBJECT_TYPE, exportContext.targetId);
        }

        if (empty(targetObject)) {
            throw new Error('Unable to update lastSync for the Coveo export target because the target object could not be resolved.');
        }

        targetObject.custom.lastSync = lastSync;
    });
}

module.exports = {
    CATALOG_STRUCTURE_MODE_PRODUCT_ONLY: CATALOG_STRUCTURE_MODE_PRODUCT_ONLY,
    CATALOG_STRUCTURE_MODE_PRODUCT_VARIANT: CATALOG_STRUCTURE_MODE_PRODUCT_VARIANT,
    PRODUCT_ELIGIBILITY_MODE_ALL: PRODUCT_ELIGIBILITY_MODE_ALL,
    PRODUCT_ELIGIBILITY_MODE_LEGACY: PRODUCT_ELIGIBILITY_MODE_LEGACY,
    PRODUCT_ELIGIBILITY_MODE_ONLINE_AND_SEARCHABLE: PRODUCT_ELIGIBILITY_MODE_ONLINE_AND_SEARCHABLE,
    TARGET_CUSTOM_OBJECT_TYPE: TARGET_CUSTOM_OBJECT_TYPE,
    applyRequestLocale: applyRequestLocale,
    buildLegacyExportContext: buildLegacyExportContext,
    buildListingSyncContext: buildListingSyncContext,
    getLanguageFromLocale: getLanguageFromLocale,
    getTargetsForCurrentSite: getTargetsForCurrentSite,
    normalizeCatalogStructureMode: normalizeCatalogStructureMode,
    normalizeProductEligibilityMode: normalizeProductEligibilityMode,
    resolveExportContext: resolveExportContext,
    resolveListingSyncGroups: resolveListingSyncGroups,
    restoreRequestLocale: restoreRequestLocale,
    updateLastSync: updateLastSync,
    validateExportContext: validateExportContext
};
