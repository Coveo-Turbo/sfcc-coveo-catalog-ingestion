'use strict';

var CustomObjectMgr = require('dw/object/CustomObjectMgr');
var Logger = require('dw/system/Logger').getLogger('Coveo');
var Site = require('dw/system/Site');
var Transaction = require('dw/system/Transaction');

var TARGET_CUSTOM_OBJECT_TYPE = 'CoveoCatalogExportTarget';

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
        catalogId: '',
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
        catalogId: normalizeString(custom.catalogId),
        enabled: toBoolean(custom.enabled),
        lastSync: custom.lastSync || null,
        label: normalizeString(custom.label),
        notes: normalizeString(custom.notes)
    };
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
        return resolvedContext;
    }

    siteTargets = getTargetsForCurrentSite();

    if (!siteTargets.length) {
        resolvedContext = buildLegacyExportContext();
        validateExportContext(resolvedContext);
        return resolvedContext;
    }

    if (siteTargets.length > 1) {
        throw new Error('Multiple Coveo export targets are configured for site ' + Site.current.ID + '. Run the job with a targetId parameter.');
    }

    resolvedContext = buildTargetExportContext(siteTargets[0], '');
    validateExportContext(resolvedContext);
    return resolvedContext;
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
    TARGET_CUSTOM_OBJECT_TYPE: TARGET_CUSTOM_OBJECT_TYPE,
    applyRequestLocale: applyRequestLocale,
    buildLegacyExportContext: buildLegacyExportContext,
    getLanguageFromLocale: getLanguageFromLocale,
    resolveExportContext: resolveExportContext,
    restoreRequestLocale: restoreRequestLocale,
    updateLastSync: updateLastSync,
    validateExportContext: validateExportContext
};
