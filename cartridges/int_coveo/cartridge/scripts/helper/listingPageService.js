'use strict';

var coveoConstant = require('*/cartridge/scripts/utils/coveoConstant');
var platformService = require('*/cartridge/scripts/services/platformService');

var LISTING_PAGE_BULK_LIMIT = 100;
var LISTING_PAGE_LIST_LIMIT = 1000;

/**
 * Returns Public Listing Page API headers.
 * @returns {Object} headers.
 */
function getPlatformAPIHeaders() {
    return {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        useCredentialAuth: true
    };
}

/**
 * Builds a listing pages endpoint.
 * @param {Object} exportContext - Export context.
 * @param {string} suffix - Endpoint suffix.
 * @param {Object} query - Query parameters.
 * @returns {string} endpoint.
 */
function buildListingPagesEndpoint(exportContext, suffix, query) {
    var endpoint = exportContext.coveoOrganizationId + '/commerce/v2/listings/pages' + (suffix || '');
    var queryParts = [];
    var queryParameters = query || {};

    Object.keys(queryParameters).forEach(function (key) {
        var value = queryParameters[key];
        if (value === null || value === undefined || value === '') {
            return;
        }

        queryParts.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
    });

    if (queryParts.length) {
        endpoint += '?' + queryParts.join('&');
    }

    return endpoint;
}

/**
 * Reads one page of existing CMH listing pages.
 * @param {Object} exportContext - Export context.
 * @param {number} page - Zero-based page index.
 * @returns {Object} service response.
 */
function getListingPagesPage(exportContext, page) {
    var endpoint = buildListingPagesEndpoint(exportContext, '', {
        trackingId: exportContext.coveoTrackingId,
        perPage: LISTING_PAGE_LIST_LIMIT,
        page: page
    });
    var request = platformService.createPlatformRequest(coveoConstant.COVEO_HTTP_METHOD.GET, endpoint, getPlatformAPIHeaders());

    return request.call();
}

/**
 * Creates a bulk-create request.
 * @param {Object} exportContext - Export context.
 * @param {Array} listingPages - Listing pages to create.
 * @returns {Object} service response.
 */
function bulkCreateListingPages(exportContext, listingPages) {
    var endpoint = buildListingPagesEndpoint(exportContext, '/bulk-create');
    var request = platformService.createPlatformRequest(coveoConstant.COVEO_HTTP_METHOD.POST, endpoint, getPlatformAPIHeaders());

    return request.call(listingPages);
}

/**
 * Creates a bulk-update request.
 * @param {Object} exportContext - Export context.
 * @param {Array} listingPages - Listing pages to update.
 * @returns {Object} service response.
 */
function bulkUpdateListingPages(exportContext, listingPages) {
    var endpoint = buildListingPagesEndpoint(exportContext, '/bulk-update');
    var request = platformService.createPlatformRequest(coveoConstant.COVEO_HTTP_METHOD.PUT, endpoint, getPlatformAPIHeaders());

    return request.call(listingPages);
}

module.exports = {
    LISTING_PAGE_BULK_LIMIT: LISTING_PAGE_BULK_LIMIT,
    LISTING_PAGE_LIST_LIMIT: LISTING_PAGE_LIST_LIMIT,
    bulkCreateListingPages: bulkCreateListingPages,
    bulkUpdateListingPages: bulkUpdateListingPages,
    buildListingPagesEndpoint: buildListingPagesEndpoint,
    getListingPagesPage: getListingPagesPage,
    getPlatformAPIHeaders: getPlatformAPIHeaders
};
