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
var catalogExportStateHelper = null;
var activeManifest = null;
var stateRun = null;
var manifestEnabled = false;
var statePromoted = false;
var syncStartedAt = null;
var deletesToExport = [];
var MAX_OPERATIONS_PER_UPLOAD = 1000;
var MAX_OPERATION_PAYLOAD_BYTES = 5 * 1024 * 1024;
var pendingOperationBytes = 0;

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

function cleanupProductFile(parameters, file) {
    if (parameters.get('deleteFile')) {
        file.remove();
        Logger.info('File uploaded successfully and removed - ' + file.path + '');
    } else if (!empty(parameters.get('archivePath'))) {
        coveoHelper.archiveFeedFile(parameters, file);
    }
}

function uploadPendingOperations(parameters) {
    if (!productsToExport.length && !deletesToExport.length) {
        return;
    }

    productFile = coveoHelper.writeProductOperationsFile(
        sourceFolder,
        productsToExport,
        deletesToExport,
        exportContext
    );
    Logger.info(
        'Uploading Coveo delta operations - addOrUpdate={0}, delete={1}',
        productsToExport.length,
        deletesToExport.length
    );

    var fileContainer = ensureSuccessfulResponse(streamHelper.createFileContainer(exportContext), 'file container creation');
    var uploadUri = fileContainer.object.uploadUri;
    var requiredHeaders = fileContainer.object.requiredHeaders || {};
    ensureSuccessfulResponse(streamHelper.uploadStreamService(productFile, uploadUri, requiredHeaders), 'file upload');
    ensureSuccessfulResponse(streamHelper.sendFileContainer(fileContainer.object.fileId, exportContext), 'stream update');
    cleanupProductFile(parameters, productFile);
    productsToExport = [];
    deletesToExport = [];
    pendingOperationBytes = 0;
}

function getEstimatedSerializedBytes(value) {
    return JSON.stringify(value).length * 3;
}

function appendRootOperations(rootId, currentRecord, previousRecord, parameters) {
    var currentDocumentIds = {};
    var previousDocumentIds = previousRecord && previousRecord.documentIds ? previousRecord.documentIds : [];
    var rootDeletes = [];
    var currentItems = (!previousRecord || previousRecord.payloadChecksum !== currentRecord.payloadChecksum)
        ? (currentRecord.items || [])
        : [];
    var rootOperationCount;
    var rootOperationBytes;

    (currentRecord.documentIds || []).forEach(function (documentId) {
        currentDocumentIds['$' + documentId] = true;
    });

    previousDocumentIds.forEach(function (documentId) {
        if (!currentDocumentIds['$' + documentId]) {
            rootDeletes.push(documentId);
        }
    });

    rootOperationCount = currentItems.length + rootDeletes.length;
    rootOperationBytes = rootOperationCount ? getEstimatedSerializedBytes({
        addOrUpdate: currentItems,
        delete: rootDeletes
    }) : 0;

    if (rootOperationBytes > MAX_OPERATION_PAYLOAD_BYTES) {
        throw new Error('The Coveo delta payload for root product ' + rootId + ' exceeds the safe per-upload size. Reduce mapped payload size or variant count for this root.');
    }

    if ((productsToExport.length || deletesToExport.length)
        && ((productsToExport.length + deletesToExport.length + rootOperationCount) > MAX_OPERATIONS_PER_UPLOAD
            || (pendingOperationBytes + rootOperationBytes) > MAX_OPERATION_PAYLOAD_BYTES)) {
        uploadPendingOperations(parameters);
    }

    currentItems.forEach(function (item) {
        if (item) {
            productsToExport.push(item);
        }
    });
    rootDeletes.forEach(function (documentId) {
        deletesToExport.push(documentId);
    });
    pendingOperationBytes += rootOperationBytes;

    if (rootOperationCount) {
        exportedRootIds[rootId] = true;
    }
}

function appendDeletedDocument(documentId, parameters) {
    var operationBytes = getEstimatedSerializedBytes(documentId);

    if ((productsToExport.length + deletesToExport.length) >= MAX_OPERATIONS_PER_UPLOAD
        || (pendingOperationBytes + operationBytes) > MAX_OPERATION_PAYLOAD_BYTES) {
        uploadPendingOperations(parameters);
    }

    deletesToExport.push(documentId);
    pendingOperationBytes += operationBytes;
}

function reconcileManifestRun(parameters) {
    var shardIndex;

    catalogExportStateHelper.closeRun(stateRun);

    for (shardIndex = 0; shardIndex < catalogExportStateHelper.MANIFEST_SHARD_COUNT; shardIndex += 1) {
        var previousRecords = {};

        catalogExportStateHelper.forEachShardRecord(activeManifest, shardIndex, function (record) {
            previousRecords['$' + record.rootId] = record;
        });

        catalogExportStateHelper.forEachShardRecord(stateRun, shardIndex, function (currentRecord) {
            var key = '$' + currentRecord.rootId;
            var previousRecord = previousRecords[key] || null;

            appendRootOperations(currentRecord.rootId, currentRecord, previousRecord, parameters);
            delete previousRecords[key];
        });

        Object.keys(previousRecords).forEach(function (key) {
            var removedRecord = previousRecords[key];

            (removedRecord.documentIds || []).forEach(function (documentId) {
                appendDeletedDocument(documentId, parameters);
            });
            exportedRootIds[removedRecord.rootId] = true;
        });

        previousRecords = null;
    }

    uploadPendingOperations(parameters);
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
    catalogExportStateHelper = require('*/cartridge/scripts/helper/catalogExportStateHelper');
    syncStartedAt = new Date();
    sourceFolder = parameters.get('srcFolder');
    productsToExport = [];
    deletesToExport = [];
    pendingOperationBytes = 0;
    exportedRootIds = {};
    activeManifest = null;
    stateRun = null;
    statePromoted = false;
    exportContext = exportTargetHelper.resolveExportContext(parameters);
    previousLocale = exportTargetHelper.applyRequestLocale(exportContext);
    manifestEnabled = catalogExportStateHelper.isManifestEnabled(exportContext);

    try {
        purchaseMetricHelper.attachSnapshotsToExportContext(exportContext, purchaseMetricHelper.DEFAULT_STATE_PATH);
        purchaseMetricHelper.ensureMetricFields(exportContext, exportContext.purchaseMetrics);
        Logger.info(
            'Resolved Coveo delta export context - site={0}, targetId={1}, locale={2}, language={3}, source={4}, catalog={5}, mappingProfile={6}, catalogStructureMode={7}, productEligibilityMode={8}, legacyMode={9}',
            exportContext.siteId,
            exportContext.targetId || '[single target]',
            exportContext.locale,
            exportContext.language,
            exportContext.coveoSourceId,
            exportContext.catalogId || '[site catalog]',
            exportContext.mappingProfileId || '[built-in only]',
            exportContext.catalogStructureMode,
            exportContext.productEligibilityMode,
            exportContext.legacyMode
        );

        if (manifestEnabled) {
            activeManifest = catalogExportStateHelper.loadActiveManifest(exportContext, catalogExportStateHelper.DEFAULT_STATE_PATH);
            catalogExportStateHelper.assertCompatibleManifest(exportContext, activeManifest);
            stateRun = catalogExportStateHelper.beginRun(exportContext, syncStartedAt, catalogExportStateHelper.DEFAULT_STATE_PATH);
        }

        products = coveoHelper.buildProductQuery(
            isDelta,
            exportContext,
            purchaseMetricHelper.getSnapshotDrivenRootIds(exportContext, exportContext.purchaseMetrics, purchaseMetricHelper.DEFAULT_STATE_PATH)
        );
    } catch (error) {
        if (stateRun) {
            catalogExportStateHelper.abortRun(stateRun);
            stateRun = null;
        }

        exportTargetHelper.restoreRequestLocale(previousLocale);
        throw error;
    }
};

exports.read = function (parameters, stepExecution) { // eslint-disable-line
    if (products.hasNext()) {
        return products.next();
    }
};

exports.process = function (product, parameters, stepExecution) {
    var items = productRequestGenerator.processProducts(product, isDelta, exportContext);

    if (manifestEnabled) {
        return {
            rootId: product,
            items: items
        };
    }

    exportedRootIds[product] = true;
    return items;
};

exports.write = function (lines, parameters, stepExecution) {
    var productsList = new ArrayList(lines).toArray();

    if (manifestEnabled) {
        productsList.forEach(function (result) {
            catalogExportStateHelper.writeRootRecord(
                stateRun,
                result.rootId,
                catalogExportStateHelper.getDocumentIds(result.items),
                {
                    payloadChecksum: catalogExportStateHelper.getPayloadChecksum(result.items),
                    items: result.items
                }
            );
        });
        return;
    }

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
        if (success === false) {
            Logger.error('Skipping final Coveo delta export upload and reconciliation because a previous chunk already failed.');

            if (stateRun) {
                catalogExportStateHelper.abortRun(stateRun);
                stateRun = null;
            }

            return;
        }

        if (manifestEnabled) {
            closeProductsIterator();
            reconcileManifestRun(parameters);
        } else if (!empty(productsToExport) && productsToExport.length > 0) {
            productFile = coveoHelper.writeProductFile(sourceFolder, productsToExport, exportContext);
            Logger.info('exportProducts-write - Total products Exported: {0}', productsToExport.length);

            var fileContainer = ensureSuccessfulResponse(streamHelper.createFileContainer(exportContext), 'file container creation');
            var uploadUri = fileContainer.object.uploadUri;
            var requiredHeaders = fileContainer.object.requiredHeaders || {};
            ensureSuccessfulResponse(streamHelper.uploadStreamService(productFile, uploadUri, requiredHeaders), 'file upload');
            ensureSuccessfulResponse(streamHelper.sendFileContainer(fileContainer.object.fileId, exportContext), 'stream update');
            cleanupProductFile(parameters, productFile);
        } else {
            Logger.info('No delta products were exported to Coveo.');
        }

        purchaseMetricHelper.markDeltaExportApplied(
            exportContext,
            exportContext.purchaseMetrics,
            purchaseMetricHelper.DEFAULT_STATE_PATH,
            Object.keys(exportedRootIds)
        );
        exportTargetHelper.updateLastSync(exportContext, syncStartedAt);

        if (manifestEnabled) {
            catalogExportStateHelper.promoteRun(stateRun);
            statePromoted = true;
            stateRun = null;
        }
    } catch (error) {
        if (manifestEnabled && stateRun && !statePromoted) {
            catalogExportStateHelper.abortRun(stateRun);
            stateRun = null;
        }

        throw error;
    } finally {
        closeProductsIterator();
        exportTargetHelper.restoreRequestLocale(previousLocale);
    }
};
