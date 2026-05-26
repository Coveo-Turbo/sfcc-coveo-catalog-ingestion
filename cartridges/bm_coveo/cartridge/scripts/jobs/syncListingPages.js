'use strict';

var Logger = require('dw/system/Logger').getLogger('Coveo');
var Status = require('dw/system/Status');

var exportTargetHelper = require('*/cartridge/scripts/helper/exportTargetHelper');
var listingPageHelper = require('*/cartridge/scripts/helper/listingPageHelper');
var listingPageService = require('*/cartridge/scripts/helper/listingPageService');

var MAX_LISTING_PAGE_VERIFY_READ_ATTEMPTS = 3;

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
 * Parses a comma-separated list of tracking IDs.
 * @param {*} value - Raw job parameter value.
 * @returns {Array} unique tracking IDs.
 */
function parseTrackingIds(value) {
    var seen = {};

    return normalizeString(value).split(',').map(function (trackingId) {
        return normalizeString(trackingId);
    }).filter(function (trackingId) {
        if (empty(trackingId) || seen[trackingId]) {
            return false;
        }

        seen[trackingId] = true;
        return true;
    });
}

/**
 * Parses a comma-separated list of category roots to exclude (IDs or names).
 * @param {*} value - Raw job parameter value.
 * @returns {Array} unique normalized category roots.
 */
function parseExcludedCategoryRoots(value) {
    var seen = {};
    return normalizeString(value).split(',').map(function (categoryRoot) {
        return normalizeString(categoryRoot).toLowerCase();
    }).filter(function (categoryRoot) {
        if (empty(categoryRoot) || seen[categoryRoot]) {
            return false;
        }

        seen[categoryRoot] = true;
        return true;
    });
}

/**
 * Formats service failure details for logs and thrown errors.
 * @param {Object} response - Service response.
 * @returns {string} formatted detail string.
 */
function formatFailureDetails(response) {
    var details = [];
    var responseObject = response && response.object;

    if (!empty(response) && !empty(response.requestMethod) && !empty(response.requestUrl)) {
        details.push('request=' + response.requestMethod + ' ' + response.requestUrl);
    } else if (!empty(response) && !empty(response.requestUrl)) {
        details.push('requestUrl=' + response.requestUrl);
    }

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
 * Parses a structured API error payload from a service response when possible.
 * @param {Object} response - Service response.
 * @returns {Object|null} parsed error payload.
 */
function parseErrorPayload(response) {
    var rawErrorMessage = response && response.errorMessage;
    var responseObject = response && response.object;

    if (!empty(responseObject) && typeof responseObject === 'object' && !empty(responseObject.errorCode)) {
        return responseObject;
    }

    if (typeof rawErrorMessage !== 'string' || empty(rawErrorMessage)) {
        return null;
    }

    try {
        return JSON.parse(rawErrorMessage);
    } catch (ex) {
        return null;
    }
}

/**
 * Builds an actionable hint for bulk create conflicts that likely come from legacy tracking IDs.
 * @param {Object} response - Service response.
 * @param {Object} syncPlan - Planned creates and updates.
 * @param {Array} existingTrackingIds - Tracking IDs scanned for existing pages.
 * @returns {string} hint message or empty string.
 */
function buildBulkCreateConflictHint(response, syncPlan, existingTrackingIds) {
    var errorPayload = parseErrorPayload(response);
    var detailCodes = [];
    var allowedConflictCodes = {
        LISTING_PAGE_NAME_ALREADY_EXISTS: true,
        LISTING_PAGE_URL_ALREADY_EXISTS: true
    };

    if (empty(syncPlan) || (syncPlan.updates || []).length !== 0 || (syncPlan.creates || []).length === 0) {
        return '';
    }

    if (empty(errorPayload) || errorPayload.errorCode !== 'BULK_LISTING_PAGE_VALIDATION_FAILED') {
        return '';
    }

    detailCodes = (errorPayload.details || []).map(function (detail) {
        return normalizeString(detail && detail.errorCode);
    }).filter(function (detailCode) {
        return !empty(detailCode);
    });

    if (!detailCodes.length || detailCodes.some(function (detailCode) {
        return !allowedConflictCodes[detailCode];
    })) {
        return '';
    }

    return 'The sync planned only creates, but CMH reports existing listing page names/URLs. '
        + 'This usually means the existing pages live under tracking IDs that were not scanned for updates. '
        + 'Current existingTrackingIds=' + existingTrackingIds.join(', ')
        + '. Re-run the coveoListingPagesSync job with the existingTrackingIds parameter set to the legacy tracking IDs, '
        + 'add disabled Coveo export target rows for those tracking IDs, or delete the legacy CMH pages before rerunning.';
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
 * Logs a warning when supported.
 * @param {string} message - Message pattern.
 */
function logWarn(message) {
    if (Logger && typeof Logger.warn === 'function') {
        Logger.warn.apply(Logger, arguments);
        return;
    }

    if (Logger && typeof Logger.info === 'function') {
        Logger.info.apply(Logger, arguments);
    }
}

/**
 * Returns a listing page primary URL without requiring helper stubs to expose getPrimaryUrl.
 * @param {Object} listingPage - Listing page.
 * @returns {string} primary URL.
 */
function getPrimaryUrl(listingPage) {
    if (listingPageHelper && typeof listingPageHelper.getPrimaryUrl === 'function') {
        return normalizeString(listingPageHelper.getPrimaryUrl(listingPage));
    }

    return normalizeString(listingPage && listingPage.patterns && listingPage.patterns[0] && listingPage.patterns[0].url);
}

/**
 * Returns a compact summary for logs.
 * @param {Object} listingPage - Listing page.
 * @returns {string} summary text.
 */
function summarizeListingPage(listingPage) {
    if (empty(listingPage)) {
        return '[none]';
    }

    return 'name="' + normalizeString(listingPage.name) + '", primaryUrl="' + getPrimaryUrl(listingPage) + '"';
}

/**
 * Returns own enumerable keys for diagnostics.
 * @param {Object} value - Object to inspect.
 * @returns {string} comma-separated keys.
 */
function summarizeKeys(value) {
    if (empty(value) || typeof value !== 'object') {
        return '[none]';
    }

    return Object.keys(value).join(', ');
}

/**
 * Logs a small diagnostic snapshot when matching unexpectedly resolves to create-only.
 * @param {Array} desiredListingPages - Desired listing pages.
 * @param {Array} existingListingPages - Existing listing pages.
 * @param {Object} syncPlan - Planned creates and updates.
 */
function logCreateOnlyDiagnostics(desiredListingPages, existingListingPages, syncPlan) {
    var firstDesiredListingPage = (desiredListingPages || [])[0] || null;
    var firstExistingListingPage = (existingListingPages || [])[0] || null;
    var desiredUrl = getPrimaryUrl(firstDesiredListingPage);
    var desiredName = normalizeString(firstDesiredListingPage && firstDesiredListingPage.name);
    var urlExists = false;
    var nameExists = false;
    var existingPagesWithName = 0;
    var existingPagesWithPrimaryUrl = 0;

    if (empty(firstDesiredListingPage)
        || empty(syncPlan)
        || !(existingListingPages || []).length
        || syncPlan.updates.length !== 0
        || syncPlan.creates.length === 0) {
        return;
    }

    urlExists = (existingListingPages || []).some(function (listingPage) {
        return (listingPage.patterns || []).some(function (pattern) {
            return normalizeString(pattern && pattern.url) === desiredUrl;
        });
    });
    nameExists = (existingListingPages || []).some(function (listingPage) {
        return normalizeString(listingPage && listingPage.name) === desiredName;
    });
    (existingListingPages || []).forEach(function (listingPage) {
        if (!empty(normalizeString(listingPage && listingPage.name))) {
            existingPagesWithName += 1;
        }

        if (!empty(getPrimaryUrl(listingPage))) {
            existingPagesWithPrimaryUrl += 1;
        }
    });

    logWarn(
        'CMH listing page sync resolved to create-only. desiredCount={0}, existingCount={1}, firstDesired={2}, firstExisting={3}, firstExistingKeys={4}, existingPagesWithName={5}, existingPagesWithPrimaryUrl={6}, firstDesiredUrlExists={7}, firstDesiredNameExists={8}',
        desiredListingPages.length,
        existingListingPages.length,
        summarizeListingPage(firstDesiredListingPage),
        summarizeListingPage(firstExistingListingPage),
        summarizeKeys(firstExistingListingPage),
        existingPagesWithName,
        existingPagesWithPrimaryUrl,
        urlExists,
        nameExists
    );
}

/**
 * Reads existing listing pages across one or more candidate tracking IDs.
 * @param {Array} exportContexts - Export contexts to query.
 * @returns {Array} existing listing pages.
 */
function readExistingListingPages(exportContexts) {
    var pagesById = {};
    var existingListingPages = [];

    (exportContexts || []).forEach(function (exportContext) {
        var trackingId = normalizeString(exportContext && exportContext.coveoTrackingId);

        if (empty(trackingId) || pagesById['__tracking__|' + trackingId]) {
            return;
        }

        pagesById['__tracking__|' + trackingId] = true;

        listingPageHelper.readExistingListingPages(exportContext, ensureSuccessfulResponse).forEach(function (listingPage) {
            var pageId = normalizeString(listingPage && listingPage.id);
            var dedupeKey = !empty(pageId)
                ? 'id|' + pageId
                : 'name|' + normalizeString(listingPage && listingPage.name) + '|url|' + normalizeString(listingPageHelper.getPrimaryUrl(listingPage));

            if (!pagesById[dedupeKey]) {
                pagesById[dedupeKey] = true;
                existingListingPages.push(listingPage);
            }
        });
    });

    return existingListingPages;
}

/**
 * Safely reads an object property in Rhino/SFCC contexts where unsupported property access can throw.
 * @param {Object} value - Source object.
 * @param {string} propertyName - Property name to read.
 * @returns {*} property value.
 */
function getObjectProperty(value, propertyName) {
    if (empty(value) || typeof value !== 'object') {
        return undefined;
    }

    try {
        return value[propertyName];
    } catch (ex) {
        return undefined;
    }
}

/**
 * Extracts listing pages from a successful bulk-write response object.
 * @param {Object|Array} responseObject - Service response payload.
 * @returns {Array} confirmed listing pages.
 */
function extractConfirmedListingPages(responseObject) {
    var items = null;

    if (typeof listingPageHelper.extractListingPageItems === 'function') {
        return listingPageHelper.extractListingPageItems(responseObject);
    }

    if (Array.isArray(responseObject)) {
        return responseObject;
    }

    if (empty(responseObject) || typeof responseObject !== 'object') {
        return [];
    }

    if (typeof responseObject.toArray === 'function') {
        return responseObject.toArray();
    }

    items = getObjectProperty(responseObject, 'items');
    if (Array.isArray(items)) {
        return items;
    }

    items = getObjectProperty(responseObject, 'results');
    if (Array.isArray(items)) {
        return items;
    }

    items = getObjectProperty(responseObject, 'createdListingPages');
    if (Array.isArray(items)) {
        return items;
    }

    items = getObjectProperty(responseObject, 'updatedListingPages');
    if (Array.isArray(items)) {
        return items;
    }

    items = getObjectProperty(responseObject, 'listingPages');
    if (Array.isArray(items)) {
        return items;
    }

    return [];
}

/**
 * Extracts confirmed listing pages from a successful bulk-write response.
 * @param {Object} response - Service response.
 * @returns {Array} confirmed listing pages.
 */
function getConfirmedListingPages(response) {
    var responseObject = response && response.object;

    return extractConfirmedListingPages(responseObject);
}

/**
 * Verifies written listing pages, retrying refreshed reads when needed.
 * Create-only writes can be eventually consistent in CMH, so after retries they only warn.
 * @param {Array} writtenListingPages - Written listing pages.
 * @param {Array} confirmedListingPages - Listing pages returned by bulk-write responses.
 * @param {Function} readFreshListingPages - Function returning freshly read listing pages.
 * @param {number} createCount - Number of planned creates.
 * @param {number} updateCount - Number of planned updates.
 */
function verifyWrittenListingPages(writtenListingPages, confirmedListingPages, readFreshListingPages, createCount, updateCount) {
    var refreshedListingPages = Array.isArray(confirmedListingPages) ? confirmedListingPages : [];
    var verifyAttempt = 0;
    var lastError = null;

    if (refreshedListingPages.length === writtenListingPages.length) {
        try {
            listingPageHelper.verifyWrittenListingPages(writtenListingPages, refreshedListingPages);
            return;
        } catch (ex) {
            lastError = ex;
        }
    }

    while (verifyAttempt < MAX_LISTING_PAGE_VERIFY_READ_ATTEMPTS) {
        refreshedListingPages = readFreshListingPages();

        try {
            listingPageHelper.verifyWrittenListingPages(writtenListingPages, refreshedListingPages);
            return;
        } catch (ex) {
            lastError = ex;
            verifyAttempt += 1;
        }
    }

    if (updateCount === 0 && createCount > 0) {
        logWarn(
            'CMH listing page verification could not confirm {0} created page(s) after {1} read attempt(s). Continuing because the bulk create request succeeded and CMH may not expose new pages immediately.',
            createCount,
            MAX_LISTING_PAGE_VERIFY_READ_ATTEMPTS
        );
        return;
    }

    throw lastError;
}

/**
 * Builds the read contexts used to discover existing listing pages.
 * @param {Object} group - Tracking-ID sync group.
 * @param {Array} additionalTrackingIds - Additional tracking IDs to scan.
 * @returns {Array} existing listing read contexts.
 */
function buildExistingListingReadContexts(group, additionalTrackingIds) {
    var primaryContext = group.primaryContext || (group.exportContexts || [])[0];
    var existingListingReadContexts = (group.existingListingReadContexts || group.exportContexts || []).slice(0);
    var seenTrackingIds = {};

    existingListingReadContexts.forEach(function (exportContext) {
        var trackingId = normalizeString(exportContext && exportContext.coveoTrackingId);

        if (!empty(trackingId)) {
            seenTrackingIds[trackingId] = true;
        }
    });

    (additionalTrackingIds || []).forEach(function (trackingId) {
        var readContext = {};

        if (empty(trackingId) || seenTrackingIds[trackingId] || empty(primaryContext)) {
            return;
        }

        Object.keys(primaryContext).forEach(function (fieldName) {
            readContext[fieldName] = primaryContext[fieldName];
        });
        readContext.coveoTrackingId = trackingId;

        existingListingReadContexts.push(readContext);
        seenTrackingIds[trackingId] = true;
    });

    return existingListingReadContexts;
}

/**
 * Runs a request function for every chunk.
 * @param {Array} listingPages - Listing pages to send.
 * @param {Function} requestFunction - Service request function.
 * @param {Object} exportContext - Export context.
 * @param {string} operation - Operation name.
 * @returns {Object} written listing page request and response payloads.
 */
function writeListingPageChunks(listingPages, requestFunction, exportContext, operation) {
    var writtenListingPages = [];
    var confirmedListingPages = [];
    var listingPageChunks = listingPageHelper.chunk(listingPages, listingPageService.LISTING_PAGE_BULK_LIMIT);

    listingPageChunks.forEach(function (listingPageChunk) {
        var response = requestFunction(exportContext, listingPageChunk);
        var error = null;

        if (response && response.ok) {
            writtenListingPages = writtenListingPages.concat(listingPageChunk);
            confirmedListingPages = confirmedListingPages.concat(getConfirmedListingPages(response));
            return;
        }

        Logger.error('Coveo CMH {0} request failed. {1}', operation, formatFailureDetails(response));

        if (!empty(formatFailureDetails(response))) {
            error = new Error('Coveo CMH ' + operation + ' request failed. ' + formatFailureDetails(response));
            error.response = response;
            throw error;
        }

        error = new Error('Coveo CMH ' + operation + ' request failed.');
        error.response = response;
        throw error;
    });

    return {
        requestedListingPages: writtenListingPages,
        confirmedListingPages: confirmedListingPages
    };
}

/**
 * Synchronizes one tracking-ID group of CMH listing pages.
 * @param {Object} group - Tracking-ID group.
 * @param {boolean} dryRun - Whether to skip writes.
 * @param {Array} additionalTrackingIds - Additional tracking IDs to scan for existing pages.
 * @param {Array} excludedCategoryRoots - Category roots to exclude from listing-page generation.
 */
function syncListingPageGroup(group, dryRun, additionalTrackingIds, excludedCategoryRoots) {
    var exportContexts = group.exportContexts || [];
    var existingListingReadContexts = buildExistingListingReadContexts(group, additionalTrackingIds);
    var primaryContext = group.primaryContext || exportContexts[0];
    var desiredListingPages;
    var existingListingPages;
    var syncPlan;
    var desiredCounts;
    var writtenListingPages = [];
    var confirmedListingPages = [];
    var existingTrackingIds = [];
    var localeLabels = exportContexts.map(function (exportContext) {
        return exportContext.locale;
    }).join(', ');

    existingListingReadContexts.forEach(function (exportContext) {
        var trackingId = normalizeString(exportContext && exportContext.coveoTrackingId);

        if (!empty(trackingId) && existingTrackingIds.indexOf(trackingId) === -1) {
            existingTrackingIds.push(trackingId);
        }
    });

    exportContexts.forEach(function (exportContext) {
        validateListingContext(exportContext);
    });

    desiredListingPages = listingPageHelper.buildDesiredListingPages(exportContexts, {
        excludedCategoryRoots: excludedCategoryRoots
    });
    desiredCounts = countDesiredListingPages(desiredListingPages);
    existingListingPages = readExistingListingPages(existingListingReadContexts);
    syncPlan = listingPageHelper.planListingPageChanges(desiredListingPages, existingListingPages);
    logCreateOnlyDiagnostics(desiredListingPages, existingListingPages, syncPlan);

    Logger.info(
        'Resolved Coveo listing page sync - site={0}, trackingId={1}, locales={2}, targets={3}, existingTrackingIds={4}, excludedCategoryRoots={5}, existingPagesRead={6}, categories={7}, brands={8}, creates={9}, updates={10}, dryRun={11}',
        primaryContext.siteId,
        group.trackingId,
        localeLabels,
        exportContexts.length,
        existingTrackingIds.join(', '),
        excludedCategoryRoots.join(', '),
        existingListingPages.length,
        desiredCounts.categories,
        desiredCounts.brands,
        syncPlan.creates.length,
        syncPlan.updates.length,
        dryRun
    );

    Logger.info(
        'Coveo listing page request URLs - read={0}, create={1}, update={2}',
        existingListingReadContexts.map(function (exportContext) {
            return listingPageService.buildListingPagesRequestUrl(exportContext, '', {
                trackingId: exportContext.coveoTrackingId,
                perPage: listingPageService.LISTING_PAGE_LIST_LIMIT,
                page: 0
            });
        }).filter(function (requestUrl, index, urls) {
            return urls.indexOf(requestUrl) === index;
        }).join(', '),
        listingPageService.buildListingPagesRequestUrl(primaryContext, '/bulk-create'),
        listingPageService.buildListingPagesRequestUrl(primaryContext, '/bulk-update')
    );

    if (dryRun) {
        return writtenListingPages;
    }

    try {
        var createResult = writeListingPageChunks(syncPlan.creates, listingPageService.bulkCreateListingPages, primaryContext, 'listing pages bulk create');

        writtenListingPages = writtenListingPages.concat(createResult.requestedListingPages);
        confirmedListingPages = confirmedListingPages.concat(createResult.confirmedListingPages);
    } catch (ex) {
        var createConflictHint = buildBulkCreateConflictHint(ex.response || null, syncPlan, existingTrackingIds);

        if (!empty(createConflictHint)) {
            throw new Error(ex.message + ' ' + createConflictHint);
        }

        throw ex;
    }
    var updateResult = writeListingPageChunks(syncPlan.updates, listingPageService.bulkUpdateListingPages, primaryContext, 'listing pages bulk update');

    writtenListingPages = writtenListingPages.concat(updateResult.requestedListingPages);
    confirmedListingPages = confirmedListingPages.concat(updateResult.confirmedListingPages);

    if (writtenListingPages.length) {
        verifyWrittenListingPages(
            writtenListingPages,
            confirmedListingPages,
            function () {
                return readExistingListingPages(existingListingReadContexts);
            },
            syncPlan.creates.length,
            syncPlan.updates.length
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
    var additionalTrackingIds = parseTrackingIds(parameters && typeof parameters.get === 'function' ? parameters.get('existingTrackingIds') : null);
    var excludedCategoryRoots = parseExcludedCategoryRoots(parameters && typeof parameters.get === 'function' ? parameters.get('excludedCategoryRoots') : null);
    var listingSyncGroups = exportTargetHelper.resolveListingSyncGroups(parameters);

    listingSyncGroups.forEach(function (group) {
        syncListingPageGroup(group, dryRun, additionalTrackingIds, excludedCategoryRoots);
    });

    return new Status(Status.OK);
};
