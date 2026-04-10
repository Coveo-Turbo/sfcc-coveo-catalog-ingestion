'use strict';

var Site = require('dw/system/Site');

/**
 * Returns the site preference object for the current site.
 * @returns {Object} site preferences.
 */
function getSitePreferences() {
    return Site.current.preferences.custom;
}

/**
 * Returns the Coveo organization id for the current export context.
 * @param {Object} exportContext - Export context.
 * @returns {string} organization id.
 */
function getOrganizationId(exportContext) {
    var sitePrefs = getSitePreferences();

    return exportContext && exportContext.coveoOrganizationId
        ? exportContext.coveoOrganizationId
        : sitePrefs.coveoOrganizationId;
}

/**
 * Returns the Coveo source id for the current export context.
 * @param {Object} exportContext - Export context.
 * @returns {string} source id.
 */
function getSourceId(exportContext) {
    var sitePrefs = getSitePreferences();

    return exportContext && exportContext.coveoSourceId
        ? exportContext.coveoSourceId
        : sitePrefs.coveoSourceId;
}

/**
 * Returns the last sync baseline for the current export context.
 * @param {Object} exportContext - Export context.
 * @returns {Date|null} last sync.
 */
function getCatalogLastSync(exportContext) {
    var sitePrefs = getSitePreferences();

    if (exportContext && Object.prototype.hasOwnProperty.call(exportContext, 'lastSync')) {
        return exportContext.lastSync;
    }

    return sitePrefs.coveoCatalogLastSync;
}

/**
 * Builds the Stream API endpoints for the current export context.
 * @param {Object} exportContext - Export context.
 * @returns {Object} API endpoints.
 */
function getApiEndpoints(exportContext) {
    var organizationId = getOrganizationId(exportContext);
    var sourceId = getSourceId(exportContext);

    return {
        STREAM: organizationId + '/sources/' + sourceId + '/stream/',
        FILECONTAINER: organizationId + '/files',
        UPDATEFILE: organizationId + '/sources/' + sourceId + '/stream/update?fileId=<fileId>',
        DELETEOLDERTHAN: organizationId + '/sources/' + sourceId + '/stream/deleteolderthan/<orderingId>',
        CHUNK: '/chunk',
        CLOSE: '/close',
        OPEN: 'open'
    };
}

/**
 * Returns the shared constants for the current export context.
 * @param {Object} exportContext - Export context.
 * @returns {Object} constants.
 */
function getCoveoConstants(exportContext) {
    return {
        ORGANIZATION_ID: getOrganizationId(exportContext),
        SOURCE_ID: getSourceId(exportContext),
        CATALOG_LAST_SYNC: getCatalogLastSync(exportContext),
        COVEO_FILE_FORMAT: '.json',
        PRODUCT: 'product://',
        EXTENSION: '.html',
        MODEL: 'Authentic',
        OBJECT_TYPE_PRODUCT: 'Product',
        VARIANT: 'variant://',
        OBJECT_TYPE_VARIANT: 'Variant'
    };
}

exports.SERVICE_ID = {
    COVEO_STREAM: 'int.coveo.http.api'
};

exports.COVEO_API_ENDPOINT = getApiEndpoints();

exports.COVEO_HTTP_METHOD = {
    POST: 'POST',
    PUT: 'PUT'
};

exports.COVEO_CONSTANTS = getCoveoConstants();

exports.CoveoFeedType = {
    PRODUCT_FEED: 'PRODUCT_FEED'
};

exports.getApiEndpoints = getApiEndpoints;
exports.getCoveoConstants = getCoveoConstants;
