'use strict';

var ArrayList = require('dw/util/ArrayList');
var Logger = require('dw/system/Logger').getLogger('Coveo');
var Site = require('dw/system/Site');
var Transaction = require('dw/system/Transaction');

var coveoHelper = null;
var isDelta = false;
var products = null;
var productFile = null;
var productRequestGenerator = null;
var productsToExport = [];
var sourceFolder = null;
var streamHelper = null;
var firstOrderingId = null;

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

    productFile = coveoHelper.writeProductFile(sourceFolder, productsToExport);
    Logger.info('exportProducts-write - Total products Exported: {0}', productsToExport.length);

    var fileContainer = ensureSuccessfulResponse(streamHelper.createFileContainer(), 'file container creation');
    var uploadUri = fileContainer.object.uploadUri;
    var requiredHeaders = fileContainer.object.requiredHeaders || {};
    ensureSuccessfulResponse(streamHelper.uploadStreamService(productFile, uploadUri, requiredHeaders), 'file upload');

    var updateResponse = ensureSuccessfulResponse(streamHelper.sendFileContainer(fileContainer.object.fileId), 'stream update');
    if (empty(firstOrderingId)) {
        firstOrderingId = updateResponse.object.orderingId;
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
    productRequestGenerator = require('*/cartridge/scripts/generators/productRequestGenerator');
    streamHelper = require('*/cartridge/scripts/helper/streamHelper');
    sourceFolder = parameters.get('srcFolder');
    firstOrderingId = null;
    productsToExport = [];
    products = coveoHelper.buildProductQuery(isDelta);
};

exports.read = function (parameters, stepExecution) { // eslint-disable-line
    if (products.hasNext()) {
        return products.next();
    }
};

exports.process = function (product, parameters, stepExecution) {
    return productRequestGenerator.processProducts(product, isDelta);
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

        ensureSuccessfulResponse(streamHelper.deleteOlderThan(firstOrderingId), 'delete older than');
        Transaction.wrap(function () {
            var lastRunTime = new Date();
            Site.current.preferences.custom.coveoCatalogLastSync = lastRunTime;
        });
    } finally {
        closeProductsIterator();
    }
};
