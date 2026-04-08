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
 * Throws when a service call failed.
 * @param {Object} response - Service response.
 * @param {string} operation - Operation name.
 * @returns {Object} the validated response.
 */
function ensureSuccessfulResponse(response, operation) {
    if (empty(response) || !response.ok) {
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
