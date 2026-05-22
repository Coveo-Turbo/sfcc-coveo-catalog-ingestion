'use strict';

var Logger = require('dw/system/Logger').getLogger('Coveo');
var Status = require('dw/system/Status');

var exportTargetHelper = require('*/cartridge/scripts/helper/exportTargetHelper');
var listingPageHelper = require('*/cartridge/scripts/helper/listingPageHelper');
var listingPageService = require('*/cartridge/scripts/helper/listingPageService');

/**
 * Returns a trimmed string value.
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
 * Formats service failure details for logs and thrown errors.
 * @param {Object} response - Service response.
 * @returns {string} formatted detail string.
 */
function formatFailureDetails(response) {
    var details = [];
    var responseObject = response && response.object;

    if (!empty(response) && !empty(response.status)) {
        details.push('status=' + response.status);
    }

    if (!empty(response) && !empty(response.error)) {
        details.push('error=' + response.error);
    }

    if (!empty(response) && !empty(response.errorMessage)) {
        details.push('errorMessage=' + response.errorMessage);
    }

    if (!empty(response) && !empty(response.msg)) {
        details.push('message=' + response.msg);
    }

    if (!empty(responseObject) && !empty(responseObject.message)) {
        details.push('responseMessage=' + responseObject.message);
    } else if (!empty(responseObject) && !empty(responseObject.text)) {
        details.push('responseBody=' + responseObject.text);
    }

    return details.join(', ');
}

/**
 * Serializes a listing-page payload for troubleshooting logs.
 * @param {*} payload - Payload to serialize.
 * @returns {string} serialized payload.
 */
function formatPayload(payload) {
    try {
        return JSON.stringify(payload, null, 2);
    } catch (ex) {
        return '[unserializable payload]';
    }
}

/**
 * Returns whether a response looks like a JSON/schema validation failure.
 * @param {Object} response - Service response.
 * @returns {boolean} whether the response is an invalid JSON/schema error.
 */
function isInvalidJsonFailure(response) {
    var detail = formatFailureDetails(response).toLowerCase();

    return detail.indexOf('invalid_json') !== -1
        || detail.indexOf('invalid json') !== -1
        || detail.indexOf('invalid format') !== -1;
}

/**
 * Returns a compact debug label for a listing page payload.
 * @param {Object} listingPage - Listing page payload.
 * @returns {string} debug label.
 */
function formatListingPageDebugLabel(listingPage) {
    var primaryUrl = (listingPage && listingPage.patterns && listingPage.patterns.length) ? normalizeString(listingPage.patterns[0].url) : '';
    var name = normalizeString(listingPage && listingPage.name);

    return name + (primaryUrl ? ' [' + primaryUrl + ']' : '');
}

/**
 * Logs a request failure with the payload.
 * @param {string} operation - Operation name.
 * @param {Object} response - Service response.
 * @param {*} payload - Request payload.
 */
function logRequestFailure(operation, response, payload) {
    var detail = formatFailureDetails(response);

    Logger.error('Coveo CMH {0} request failed. Payload={1}. {2}', operation, formatPayload(payload), detail);
}

/**
 * Attempts to send a chunk one item at a time after a bulk JSON/schema failure.
 * @param {Array} listingPageChunk - Listing pages to send.
 * @param {Function} requestFunction - Service request function.
 * @param {Object} exportContext - Export context.
 * @param {string} operation - Operation name.
 * @returns {Array} written listing pages.
 */
function retryChunkIndividually(listingPageChunk, requestFunction, exportContext, operation) {
    var writtenListingPages = [];
    var failedPages = [];

    listingPageChunk.forEach(function (listingPage) {
        var response = requestFunction(exportContext, [listingPage]);

        if (response && response.ok) {
            writtenListingPages.push(listingPage);
            return;
        }

        failedPages.push(formatListingPageDebugLabel(listingPage));
        logRequestFailure(operation, response, [listingPage]);
    });

    if (failedPages.length) {
        throw new Error('Coveo CMH ' + operation + ' request failed for ' + failedPages.length + ' listing page(s) after bulk fallback: ' + failedPages.join('; ') + '.');
    }

    return writtenListingPages;
}

/**
 * Throws when a service call failed.
 * @param {Object} response - Service response.
 * @param {string} operation - Operation name.
 * @returns {Object} the validated response.
 */
function ensureSuccessfulResponse(response, operation) {
    if (empty(response) || !response.ok) {
        var detail = formatFailureDetails(response);

        if (!empty(detail)) {
            Logger.error('Coveo CMH {0} request failed. {1}', operation, detail);
            throw new Error('Coveo CMH ' + operation + ' request failed. ' + detail);
        }

        throw new Error('Coveo CMH ' + operation + ' request failed.');
    }

    return response;
}

/**
 * Validates listing-page-specific target configuration.
 * @param {Object} exportContext - Export context.
 */
function validateListingContext(exportContext) {
    var missing = [];

    [
        'coveoOrganizationId',
        'coveoTrackingId',
        'coveoCountry',
        'coveoCurrency',
        'storefrontBaseUrl',
        'listingCategoryUrlTemplate',
        'listingBrandUrlTemplate'
    ].forEach(function (fieldName) {
        if (empty(exportContext[fieldName])) {
            missing.push(fieldName);
        }
    });

    if (!empty(missing)) {
        throw new Error('The Coveo listing page sync target ' + (exportContext.targetId || exportContext.label || exportContext.locale || '[unknown]') + ' is missing required values: ' + missing.join(', ') + '.');
    }
}

/**
 * Counts generated listing pages by source type.
 * @param {Array} desiredListingPages - Desired listing pages.
 * @returns {Object} counts.
 */
function countDesiredListingPages(desiredListingPages) {
    var counts = {
        categories: 0,
        brands: 0
    };

    desiredListingPages.forEach(function (listingPage) {
        if (listingPage.generatedType === listingPageHelper.PAGE_TYPE_CATEGORY) {
            counts.categories += 1;
        } else if (listingPage.generatedType === listingPageHelper.PAGE_TYPE_BRAND) {
            counts.brands += 1;
        }
    });

    return counts;
}

/**
 * Runs a request function for every chunk.
 * @param {Array} listingPages - Listing pages to send.
 * @param {Function} requestFunction - Service request function.
 * @param {Object} exportContext - Export context.
 * @param {string} operation - Operation name.
 * @returns {Array} written listing pages.
 */
function writeListingPageChunks(listingPages, requestFunction, exportContext, operation) {
    var writtenListingPages = [];

    listingPageHelper.chunk(listingPages, listingPageService.LISTING_PAGE_BULK_LIMIT).forEach(function (listingPageChunk) {
        var response = requestFunction(exportContext, listingPageChunk);

        if (response && response.ok) {
            writtenListingPages = writtenListingPages.concat(listingPageChunk);
            return;
        }

        if (listingPageChunk.length > 1 && isInvalidJsonFailure(response)) {
            Logger.warn(
                'Coveo CMH {0} bulk request failed with invalid JSON/schema validation for {1} listing page(s); payload={2}; retrying individually.',
                operation,
                listingPageChunk.length,
                formatPayload(listingPageChunk)
            );
            writtenListingPages = writtenListingPages.concat(retryChunkIndividually(listingPageChunk, requestFunction, exportContext, operation));
            return;
        }

        logRequestFailure(operation, response, listingPageChunk);

        if (!empty(formatFailureDetails(response))) {
            throw new Error('Coveo CMH ' + operation + ' request failed. ' + formatFailureDetails(response));
        }

        throw new Error('Coveo CMH ' + operation + ' request failed.');
    });

    return writtenListingPages;
}

/**
 * Synchronizes one tracking-ID group of CMH listing pages.
 * @param {Object} group - Tracking-ID group.
 * @param {boolean} dryRun - Whether to skip writes.
 */
function syncListingPageGroup(group, dryRun) {
    var exportContexts = group.exportContexts || [];
    var primaryContext = group.primaryContext || exportContexts[0];
    var desiredListingPages;
    var existingListingPages;
    var syncPlan;
    var desiredCounts;
    var writtenListingPages = [];
    var localeLabels = exportContexts.map(function (exportContext) {
        return exportContext.locale;
    }).join(', ');

    exportContexts.forEach(function (exportContext) {
        validateListingContext(exportContext);
    });

    desiredListingPages = listingPageHelper.buildDesiredListingPages(exportContexts);
    desiredCounts = countDesiredListingPages(desiredListingPages);
    existingListingPages = listingPageHelper.readExistingListingPages(primaryContext, ensureSuccessfulResponse);
    syncPlan = listingPageHelper.planListingPageChanges(desiredListingPages, existingListingPages);

    Logger.info(
        'Resolved Coveo listing page sync - site={0}, trackingId={1}, locales={2}, targets={3}, categories={4}, brands={5}, creates={6}, updates={7}, dryRun={8}',
        primaryContext.siteId,
        group.trackingId,
        localeLabels,
        exportContexts.length,
        desiredCounts.categories,
        desiredCounts.brands,
        syncPlan.creates.length,
        syncPlan.updates.length,
        dryRun
    );

    if (dryRun) {
        return writtenListingPages;
    }

    writtenListingPages = writtenListingPages.concat(writeListingPageChunks(syncPlan.creates, listingPageService.bulkCreateListingPages, primaryContext, 'listing pages bulk create'));
    writtenListingPages = writtenListingPages.concat(writeListingPageChunks(syncPlan.updates, listingPageService.bulkUpdateListingPages, primaryContext, 'listing pages bulk update'));

    if (writtenListingPages.length) {
        listingPageHelper.verifyWrittenListingPages(
            writtenListingPages,
            listingPageHelper.readExistingListingPages(primaryContext, ensureSuccessfulResponse)
        );
    }

    Logger.info('Coveo listing page sync completed for trackingId={0}. Created={1}, updated={2}.', group.trackingId, syncPlan.creates.length, syncPlan.updates.length);

    return writtenListingPages;
}

/**
 * Synchronizes CMH listing pages for the resolved export target.
 * @param {Object} parameters - Job parameters.
 * @param {Object} stepExecution - Job step execution.
 * @returns {Status} job status.
 */
exports.execute = function (parameters, stepExecution) { // eslint-disable-line no-unused-vars
    var dryRun = toBoolean(parameters && typeof parameters.get === 'function' ? parameters.get('dryRun') : false);
    var listingSyncGroups = exportTargetHelper.resolveListingSyncGroups(parameters);

    listingSyncGroups.forEach(function (group) {
        syncListingPageGroup(group, dryRun);
    });

    return new Status(Status.OK);
};
