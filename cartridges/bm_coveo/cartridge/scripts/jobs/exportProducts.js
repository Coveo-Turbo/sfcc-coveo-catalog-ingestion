'use strict';

var ArrayList = require('dw/util/ArrayList');
var Logger = require('dw/system/Logger').getLogger('Coveo');

var coveoHelper = null;
var exportTargetHelper = null;
var isDelta = false;
var products = null;
var productFile = null;
var productRequestGenerator = null;
var productsToExport = [];
var sourceFolder = null;
var streamHelper = null;
var firstOrderingId = null;
var exportContext = null;
var previousLocale = null;
var MAX_RETRYABLE_REQUEST_ATTEMPTS = 3;

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
 * Throws when a service call failed.
 * @param {Object} response - Service response.
 * @param {string} operation - Operation name.
 * @returns {Object} the validated response.
 */
function ensureSuccessfulResponse(response, operation) {
    if (empty(response) || !response.ok) {
        var detail = formatFailureDetails(response);

        if (!empty(detail)) {
            Logger.error('Coveo {0} request failed. {1}', operation, detail);
            throw new Error('Coveo ' + operation + ' request failed. ' + detail);
        }

        throw new Error('Coveo ' + operation + ' request failed.');
    }

    return response;
}

/**
 * Returns whether a failed service response is likely transient.
 * @param {Object} response - Service response.
 * @returns {boolean} whether the operation can be retried safely.
 */
function isRetryableServiceFailure(response) {
    if (empty(response) || response.ok) {
        return false;
    }

    var detail = formatFailureDetails(response);

    return response.error === 0
        || String(response.error) === '0'
        || /NoHttpResponseException|failed to respond|SocketTimeoutException|timed out|Connection reset|ECONNRESET|502|503|504/i.test(detail);
}

/**
 * Calls a Coveo service request and retries transient transport failures.
 * @param {Function} request - Request callback.
 * @param {string} operation - Operation name.
 * @returns {Object} successful response.
 */
function callCoveoRequestWithRetry(request, operation) {
    var response = null;
    var attempt;

    for (attempt = 1; attempt <= MAX_RETRYABLE_REQUEST_ATTEMPTS; attempt += 1) {
        response = request();

        if (!empty(response) && response.ok) {
            if (attempt > 1) {
                Logger.info('Recovered Coveo {0} request on attempt {1}.', operation, attempt);
            }

            return response;
        }

        if (attempt >= MAX_RETRYABLE_REQUEST_ATTEMPTS || !isRetryableServiceFailure(response)) {
            return ensureSuccessfulResponse(response, operation);
        }

        Logger.info(
            'Retrying Coveo {0} request after transient failure on attempt {1}. {2}',
            operation,
            attempt,
            formatFailureDetails(response)
        );
    }

    return ensureSuccessfulResponse(response, operation);
}

/**
 * Removes or archives the local file based on the job parameters.
 * @param {Object} parameters - Job parameters.
 * @param {Object} file - File to cleanup.
 */
function cleanupProductFile(parameters, file) {
    if (parameters.get('deleteFile')) {
        file.remove();
        Logger.info('File uploaded successfully and removed - ' + file.path + '');
    } else if (!empty(parameters.get('archivePath'))) {
        coveoHelper.archiveFeedFile(parameters, file);
    }
}

/**
 * Uploads the current batch using a file container update.
 * @param {Object} parameters - Job parameters.
 */
function uploadPendingProducts(parameters) {
    if (empty(productsToExport) || productsToExport.length === 0) {
        return;
    }

    productFile = coveoHelper.writeProductFile(sourceFolder, productsToExport, exportContext);
    Logger.info('exportProducts-write - Total products Exported: {0}', productsToExport.length);

    var fileContainer = callCoveoRequestWithRetry(function () {
        return streamHelper.createFileContainer(exportContext);
    }, 'file container creation');
    var uploadUri = fileContainer.object.uploadUri;
    var requiredHeaders = fileContainer.object.requiredHeaders || {};
    callCoveoRequestWithRetry(function () {
        return streamHelper.uploadStreamService(productFile, uploadUri, requiredHeaders);
    }, 'file upload');

    var updateResponse = callCoveoRequestWithRetry(function () {
        return streamHelper.sendFileContainer(fileContainer.object.fileId, exportContext);
    }, 'stream update');
    Logger.info('Coveo stream update accepted for fileId={0}, orderingId={1}', fileContainer.object.fileId, updateResponse.object.orderingId);
    if (empty(firstOrderingId)) {
        firstOrderingId = updateResponse.object.orderingId;
        Logger.info('Captured first Coveo stream orderingId={0} for deleteolderthan reconciliation.', firstOrderingId);
    }

    cleanupProductFile(parameters, productFile);
    productsToExport = [];
}

/**
 * Closes the product iterator when supported.
 */
function closeProductsIterator() {
    if (!empty(products) && typeof products.close === 'function') {
        products.close();
    }
}

/**
 * Initialize readers and writers for job processing
 * @param {Object} parameters job parameters
 * @param {JobStepExecution} stepExecution job step execution
 */
exports.beforeStep = function (parameters, stepExecution) {
    coveoHelper = require('*/cartridge/scripts/helper/coveoHelper');
    exportTargetHelper = require('*/cartridge/scripts/helper/exportTargetHelper');
    productRequestGenerator = require('*/cartridge/scripts/generators/productRequestGenerator');
    streamHelper = require('*/cartridge/scripts/helper/streamHelper');
    sourceFolder = parameters.get('srcFolder');
    firstOrderingId = null;
    productsToExport = [];
    exportContext = exportTargetHelper.resolveExportContext(parameters);
    previousLocale = exportTargetHelper.applyRequestLocale(exportContext);
    Logger.info(
        'Resolved Coveo full export context - site={0}, targetId={1}, locale={2}, language={3}, source={4}, catalog={5}, mappingProfile={6}, legacyMode={7}',
        exportContext.siteId,
        exportContext.targetId || '[single target]',
        exportContext.locale,
        exportContext.language,
        exportContext.coveoSourceId,
        exportContext.catalogId || '[site catalog]',
        exportContext.mappingProfileId || '[built-in only]',
        exportContext.legacyMode
    );
    products = coveoHelper.buildProductQuery(isDelta, exportContext);
};

exports.read = function (parameters, stepExecution) { // eslint-disable-line
    if (products.hasNext()) {
        return products.next();
    }
};

exports.process = function (product, parameters, stepExecution) {
    return productRequestGenerator.processProducts(product, isDelta, exportContext);
};

exports.write = function (lines, parameters, stepExecution) {
    var productsList = new ArrayList(lines).toArray();
    productsList.forEach(function (item) {
        var id = item;
        if (id && id.length >= 1) {
            Object.keys(id).forEach(function (key) {
                productsToExport.push(item[key]);
            });
        }
    });
};

exports.afterChunk = function (stepExecution, parameters) {
    uploadPendingProducts(parameters);
};

exports.afterStep = function (success, parameters) {
    try {
        if (success === false) {
            Logger.error('Skipping final Coveo full export upload and reconciliation because a previous chunk already failed.');
            return;
        }

        uploadPendingProducts(parameters);

        if (empty(firstOrderingId)) {
            throw new Error('The Coveo full export did not upload any catalog payload.');
        }

        Logger.info('Submitting Coveo deleteolderthan request for source={0}, orderingId={1}', exportContext.coveoSourceId, firstOrderingId);
        callCoveoRequestWithRetry(function () {
            return streamHelper.deleteOlderThan(firstOrderingId, exportContext);
        }, 'delete older than');
        Logger.info('Coveo deleteolderthan request accepted for source={0}, orderingId={1}', exportContext.coveoSourceId, firstOrderingId);
        exportTargetHelper.updateLastSync(exportContext, new Date());
    } finally {
        closeProductsIterator();
        exportTargetHelper.restoreRequestLocale(previousLocale);
    }
};
