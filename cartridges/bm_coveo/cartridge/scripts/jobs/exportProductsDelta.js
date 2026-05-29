'use strict';

var ArrayList = require('dw/util/ArrayList');
var Logger = require('dw/system/Logger').getLogger('Coveo');

var coveoHelper = null;
var exportTargetHelper = null;
var isDelta = true;
var products = null;
var productFile = null;
var productRequestGenerator = null;
var productsToExport = [];
var sourceFolder = null;
var streamHelper = null;
var exportContext = null;
var previousLocale = null;
var purchaseMetricHelper = null;
var exportedRootIds = {};

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
    purchaseMetricHelper = require('*/cartridge/scripts/helper/purchaseMetricHelper');
    sourceFolder = parameters.get('srcFolder');
    productsToExport = [];
    exportedRootIds = {};
    exportContext = exportTargetHelper.resolveExportContext(parameters);
    previousLocale = exportTargetHelper.applyRequestLocale(exportContext);
    purchaseMetricHelper.attachSnapshotsToExportContext(exportContext, purchaseMetricHelper.DEFAULT_STATE_PATH);
    purchaseMetricHelper.ensureMetricFields(exportContext, exportContext.purchaseMetrics);
    Logger.info(
        'Resolved Coveo delta export context - site={0}, targetId={1}, locale={2}, language={3}, source={4}, catalog={5}, mappingProfile={6}, legacyMode={7}',
        exportContext.siteId,
        exportContext.targetId || '[single target]',
        exportContext.locale,
        exportContext.language,
        exportContext.coveoSourceId,
        exportContext.catalogId || '[site catalog]',
        exportContext.mappingProfileId || '[built-in only]',
        exportContext.legacyMode
    );
    products = coveoHelper.buildProductQuery(
        isDelta,
        exportContext,
        purchaseMetricHelper.getSnapshotDrivenRootIds(exportContext, exportContext.purchaseMetrics, purchaseMetricHelper.DEFAULT_STATE_PATH)
    );
};

exports.read = function (parameters, stepExecution) { // eslint-disable-line
    if (products.hasNext()) {
        return products.next();
    }
};

exports.process = function (product, parameters, stepExecution) {
    exportedRootIds[product] = true;
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

exports.afterStep = function (success, parameters) {
    try {
        if (!empty(productsToExport) && productsToExport.length > 0) {
            productFile = coveoHelper.writeProductFile(sourceFolder, productsToExport, exportContext);
            Logger.info('exportProducts-write - Total products Exported: {0}', productsToExport.length);

            var fileContainer = ensureSuccessfulResponse(streamHelper.createFileContainer(exportContext), 'file container creation');
            var uploadUri = fileContainer.object.uploadUri;
            var requiredHeaders = fileContainer.object.requiredHeaders || {};
            ensureSuccessfulResponse(streamHelper.uploadStreamService(productFile, uploadUri, requiredHeaders), 'file upload');
            ensureSuccessfulResponse(streamHelper.sendFileContainer(fileContainer.object.fileId, exportContext), 'stream update');

            if (parameters.get('deleteFile')) {
                productFile.remove();
                Logger.info('File uploaded successfully and removed - ' + productFile.path + '');
            } else if (!empty(parameters.get('archivePath'))) {
                coveoHelper.archiveFeedFile(parameters, productFile);
            }
        } else {
            Logger.info('No delta products were exported to Coveo.');
        }

        purchaseMetricHelper.markDeltaExportApplied(
            exportContext,
            exportContext.purchaseMetrics,
            purchaseMetricHelper.DEFAULT_STATE_PATH,
            Object.keys(exportedRootIds)
        );
        exportTargetHelper.updateLastSync(exportContext, new Date());
    } finally {
        closeProductsIterator();
        exportTargetHelper.restoreRequestLocale(previousLocale);
    }
};
