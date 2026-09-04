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
var modeSelection = null;
var reconciliationStats = null;
var scanStartedAt = null;
var scanDurationMs = 0;
var uploadDurationMs = 0;

function createReconciliationStats() {
    return {
        rootsScanned: 0,
        rootsCarriedForward: 0,
        rootsGenerated: 0,
        rootsRemoved: 0,
        addUpdateOperations: 0,
        deleteOperations: 0,
        generationDurationMs: 0,
        reconciliationDurationMs: 0,
        dirtyReasons: {
            new: 0,
            modified: 0,
            eligibilityOwnership: 0,
            purchase: 0,
            forced: 0,
            migration: 0
        }
    };
}

function parseBooleanParameter(value) {
    return value === true || String(value || '').toLowerCase() === 'true';
}

function documentIdsMatch(left, right) {
    return JSON.stringify(left || []) === JSON.stringify(right || []);
}

function getDirtyReason(descriptor, previousRecord, purchaseRootLookup) {
    if (modeSelection.mode === 'deep') {
        return 'forced';
    }

    if (!previousRecord) {
        return 'new';
    }

    if (previousRecord.descriptorVersion !== catalogExportStateHelper.DESCRIPTOR_SCHEMA_VERSION
        || !previousRecord.modificationSignature
        || !previousRecord.eligibilitySignature
        || !previousRecord.ownershipSignature) {
        return 'migration';
    }

    if (previousRecord.modificationSignature !== descriptor.modificationSignature) {
        return 'modified';
    }

    if (previousRecord.eligibilitySignature !== descriptor.eligibilitySignature
        || previousRecord.ownershipSignature !== descriptor.ownershipSignature) {
        return 'eligibilityOwnership';
    }

    if (purchaseRootLookup['$' + descriptor.rootId]) {
        return 'purchase';
    }

    return '';
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

    var uploadStartedAt = new Date().getTime();

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

    try {
        var fileContainer = ensureSuccessfulResponse(streamHelper.createFileContainer(exportContext), 'file container creation');
        var uploadUri = fileContainer.object.uploadUri;
        var requiredHeaders = fileContainer.object.requiredHeaders || {};
        ensureSuccessfulResponse(streamHelper.uploadStreamService(productFile, uploadUri, requiredHeaders), 'file upload');
        ensureSuccessfulResponse(streamHelper.sendFileContainer(fileContainer.object.fileId, exportContext), 'stream update');
        cleanupProductFile(parameters, productFile);
    } catch (error) {
        if (productFile && typeof productFile.remove === 'function') {
            productFile.remove();
        }

        throw error;
    }
    productsToExport = [];
    deletesToExport = [];
    pendingOperationBytes = 0;
    uploadDurationMs += new Date().getTime() - uploadStartedAt;
}

function getEstimatedSerializedBytes(value) {
    return JSON.stringify(value).length * 3;
}

function buildBoundedItemBatches(rootId, items, requiredItems) {
    var batches = [];
    var required = (requiredItems || []).slice();
    var batch = required.slice();
    var batchBytes = getEstimatedSerializedBytes({
        addOrUpdate: batch,
        delete: []
    });

    if (batch.length > MAX_OPERATIONS_PER_UPLOAD || batchBytes > MAX_OPERATION_PAYLOAD_BYTES) {
        throw new Error('The Coveo delta payload for root product ' + rootId + ' has a required Product item that exceeds the safe per-upload limits.');
    }

    (items || []).forEach(function (item) {
        var itemBytes = getEstimatedSerializedBytes(item) + (batch.length ? 3 : 0);

        if (batch.length >= MAX_OPERATIONS_PER_UPLOAD || (batchBytes + itemBytes) > MAX_OPERATION_PAYLOAD_BYTES) {
            if (batch.length === required.length) {
                throw new Error('The Coveo delta payload for root product ' + rootId + ' contains an item that exceeds the safe per-upload size. Reduce mapped payload size for this root.');
            }

            batches.push(batch);
            batch = required.slice();
            batchBytes = getEstimatedSerializedBytes({
                addOrUpdate: batch,
                delete: []
            });
            itemBytes = getEstimatedSerializedBytes(item) + (batch.length ? 3 : 0);

            if (batch.length >= MAX_OPERATIONS_PER_UPLOAD || (batchBytes + itemBytes) > MAX_OPERATION_PAYLOAD_BYTES) {
                throw new Error('The Coveo delta payload for root product ' + rootId + ' contains an item that exceeds the safe per-upload size. Reduce mapped payload size for this root.');
            }
        }

        batch.push(item);
        batchBytes += itemBytes;
    });

    if (batch.length > required.length || (required.length && !(items || []).length)) {
        batches.push(batch);
    }

    return batches;
}

function buildRootItemBatches(rootId, items) {
    if (exportContext.catalogStructureMode !== 'product_variant') {
        return buildBoundedItemBatches(rootId, items, []);
    }

    var parentGroups = [];
    var parentGroupsById = {};
    var otherItems = [];

    (items || []).forEach(function (item) {
        if (item && item.objecttype === 'Product') {
            var group = {
                parent: item,
                variants: []
            };

            parentGroups.push(group);
            parentGroupsById['$' + item.ec_product_id] = group;
        } else if (!item || item.objecttype !== 'Variant') {
            otherItems.push(item);
        }
    });

    (items || []).forEach(function (item) {
        if (item && item.objecttype === 'Variant') {
            var parentGroup = parentGroupsById['$' + item.ec_product_id];

            if (!parentGroup) {
                throw new Error('The Coveo delta payload for root product ' + rootId + ' contains a Variant without its Product parent.');
            }

            parentGroup.variants.push(item);
        }
    });

    var batches = [];

    parentGroups.forEach(function (group) {
        batches = batches.concat(buildBoundedItemBatches(rootId, group.variants, [group.parent]));
    });

    return batches.concat(buildBoundedItemBatches(rootId, otherItems, []));
}

function appendRootItemBatch(rootId, items, parameters) {
    var operationBytes = getEstimatedSerializedBytes({
        addOrUpdate: items,
        delete: []
    });

    if (items.length > MAX_OPERATIONS_PER_UPLOAD || operationBytes > MAX_OPERATION_PAYLOAD_BYTES) {
        throw new Error('The Coveo delta payload batch for root product ' + rootId + ' exceeds the safe per-upload limits.');
    }

    if ((productsToExport.length || deletesToExport.length)
        && ((productsToExport.length + deletesToExport.length + items.length) > MAX_OPERATIONS_PER_UPLOAD
            || (pendingOperationBytes + operationBytes) > MAX_OPERATION_PAYLOAD_BYTES)) {
        uploadPendingOperations(parameters);
    }

    items.forEach(function (item) {
        if (item) {
            productsToExport.push(item);
        }
    });
    reconciliationStats.addUpdateOperations += items.length;
    pendingOperationBytes += operationBytes;
}

function appendRootOperations(rootId, currentRecord, previousRecord, parameters) {
    var currentDocumentIds = {};
    var previousDocumentIds = previousRecord && previousRecord.documentIds ? previousRecord.documentIds : [];
    var currentItems = (!previousRecord || previousRecord.payloadChecksum !== currentRecord.payloadChecksum)
        ? (currentRecord.items || [])
        : [];
    var rootItemBatches;

    (currentRecord.documentIds || []).forEach(function (documentId) {
        currentDocumentIds['$' + documentId] = true;
    });

    previousDocumentIds.forEach(function (documentId) {
        if (!currentDocumentIds['$' + documentId]) {
            catalogExportStateHelper.writeDeleteCandidate(stateRun, documentId);
        }
    });

    rootItemBatches = buildRootItemBatches(rootId, currentItems);
    rootItemBatches.forEach(function (batch) {
        appendRootItemBatch(rootId, batch, parameters);
    });

}

function appendDeletedDocument(documentId, parameters) {
    var operationBytes = getEstimatedSerializedBytes(documentId);

    if ((productsToExport.length + deletesToExport.length) >= MAX_OPERATIONS_PER_UPLOAD
        || (pendingOperationBytes + operationBytes) > MAX_OPERATION_PAYLOAD_BYTES) {
        uploadPendingOperations(parameters);
    }

    deletesToExport.push(documentId);
    reconciliationStats.deleteOperations += 1;
    pendingOperationBytes += operationBytes;
}

function appendEligibleDeleteCandidates(parameters) {
    var shardIndex;

    catalogExportStateHelper.closeDeleteCandidates(stateRun);

    for (shardIndex = 0; shardIndex < catalogExportStateHelper.MANIFEST_SHARD_COUNT; shardIndex += 1) {
        var currentDocumentIds = {};
        var processedDeleteCandidates = {};

        catalogExportStateHelper.forEachCurrentDocumentId(stateRun, shardIndex, function (documentId) {
            currentDocumentIds['$' + documentId] = true;
        });

        catalogExportStateHelper.forEachDeleteCandidate(stateRun, shardIndex, function (documentId) {
            var key = '$' + documentId;

            if (!processedDeleteCandidates[key] && !currentDocumentIds[key]) {
                appendDeletedDocument(documentId, parameters);
            }

            processedDeleteCandidates[key] = true;
        });
    }
}

function reconcileManifestRun(parameters) {
    var shardIndex;
    var reconciliationStartedAt = new Date().getTime();

    catalogExportStateHelper.closeRootDescriptors(stateRun);

    for (shardIndex = 0; shardIndex < catalogExportStateHelper.MANIFEST_SHARD_COUNT; shardIndex += 1) {
        var previousRecords = {};
        var purchaseRootLookup = {};

        catalogExportStateHelper.forEachShardRecord(activeManifest, shardIndex, function (record) {
            previousRecords['$' + record.rootId] = record;
        });
        catalogExportStateHelper.forEachPurchaseRootId(stateRun, shardIndex, function (rootId) {
            purchaseRootLookup['$' + rootId] = true;
        });

        catalogExportStateHelper.forEachRootDescriptor(stateRun, shardIndex, function (descriptor) {
            var key = '$' + descriptor.rootId;
            var previousRecord = previousRecords[key] || null;
            var dirtyReason = getDirtyReason(descriptor, previousRecord, purchaseRootLookup);

            reconciliationStats.rootsScanned += 1;

            if (dirtyReason !== '') {
                var generationStartedAt = new Date().getTime();
                var generatedRoot = productRequestGenerator.generateRoot(descriptor.rootId, isDelta, exportContext);
                var items = generatedRoot.items;
                var refreshedDescriptor = generatedRoot.descriptor;

                reconciliationStats.generationDurationMs += new Date().getTime() - generationStartedAt;

                if (!refreshedDescriptor) {
                    throw new Error('Catalog root ' + descriptor.rootId + ' disappeared during delta payload generation. Retry the delta export.');
                }

                var generatedDocumentIds = catalogExportStateHelper.getDocumentIds(items);

                if (!documentIdsMatch(generatedDocumentIds, refreshedDescriptor.documentIds)) {
                    throw new Error('Catalog root ' + descriptor.rootId + ' changed document ownership during delta payload generation. Retry the delta export.');
                }

                var currentRecord = catalogExportStateHelper.writeRootRecord(
                    stateRun,
                    descriptor.rootId,
                    generatedDocumentIds,
                    {
                        modifiedAt: refreshedDescriptor.modifiedAt,
                        modificationSignature: refreshedDescriptor.modificationSignature,
                        eligibilitySignature: refreshedDescriptor.eligibilitySignature,
                        ownershipSignature: refreshedDescriptor.ownershipSignature,
                        payloadChecksum: catalogExportStateHelper.getPayloadChecksum(items)
                    }
                );
                currentRecord.items = items;
                appendRootOperations(descriptor.rootId, currentRecord, previousRecord, parameters);
                reconciliationStats.rootsGenerated += 1;
                reconciliationStats.dirtyReasons[dirtyReason] += 1;
            } else {
                catalogExportStateHelper.writeRootRecord(
                    stateRun,
                    descriptor.rootId,
                    previousRecord.documentIds,
                    {
                        modifiedAt: descriptor.modifiedAt,
                        modificationSignature: descriptor.modificationSignature,
                        eligibilitySignature: descriptor.eligibilitySignature,
                        ownershipSignature: descriptor.ownershipSignature,
                        payloadChecksum: previousRecord.payloadChecksum
                    }
                );
                reconciliationStats.rootsCarriedForward += 1;
            }

            delete previousRecords[key];
        });

        Object.keys(previousRecords).forEach(function (key) {
            var removedRecord = previousRecords[key];

            (removedRecord.documentIds || []).forEach(function (documentId) {
                catalogExportStateHelper.writeDeleteCandidate(stateRun, documentId);
            });
            reconciliationStats.rootsRemoved += 1;
        });

        previousRecords = null;
        purchaseRootLookup = null;
    }

    catalogExportStateHelper.closeRun(stateRun);
    appendEligibleDeleteCandidates(parameters);
    uploadPendingOperations(parameters);
    reconciliationStats.reconciliationDurationMs = new Date().getTime() - reconciliationStartedAt;
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
    uploadDurationMs = 0;
    modeSelection = null;
    reconciliationStats = createReconciliationStats();
    scanStartedAt = new Date().getTime();
    scanDurationMs = 0;
    exportedRootIds = null;
    activeManifest = null;
    stateRun = null;
    statePromoted = false;
    exportContext = exportTargetHelper.resolveExportContext(parameters);
    previousLocale = exportTargetHelper.applyRequestLocale(exportContext);
    manifestEnabled = catalogExportStateHelper.isManifestEnabled(exportContext);
    exportedRootIds = manifestEnabled ? null : purchaseMetricHelper.createHashMap();

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
            modeSelection = catalogExportStateHelper.selectReconciliationMode(activeManifest, {
                requestedMode: parameters.get('reconciliationMode') || 'auto',
                forceDeep: parseBooleanParameter(parameters.get('forceDeepReconciliation')),
                maxAgeHours: parameters.get('maxDeepReconciliationAgeHours')
            }, syncStartedAt);
            stateRun = catalogExportStateHelper.beginRun(exportContext, syncStartedAt, catalogExportStateHelper.DEFAULT_STATE_PATH, {
                reconciliationMode: modeSelection.mode,
                activeManifest: activeManifest
            });
            purchaseMetricHelper.forEachSnapshotDrivenRootId(
                exportContext,
                exportContext.purchaseMetrics,
                purchaseMetricHelper.DEFAULT_STATE_PATH,
                function (rootId) {
                    catalogExportStateHelper.writePurchaseRootId(stateRun, rootId);
                }
            );
            catalogExportStateHelper.closePurchaseRootIds(stateRun);
            Logger.info(
                'Selected Coveo manifest reconciliation mode={0}, reason={1}, deepBaselineAgeHours={2}.',
                modeSelection.mode,
                modeSelection.reason,
                modeSelection.baselineAgeHours === null ? '[unavailable]' : modeSelection.baselineAgeHours
            );
        }

        var snapshotDrivenRootIds = manifestEnabled
            ? null
            : purchaseMetricHelper.getSnapshotDrivenRootIds(exportContext, exportContext.purchaseMetrics, purchaseMetricHelper.DEFAULT_STATE_PATH);

        products = coveoHelper.buildProductQuery(
            isDelta,
            exportContext,
            snapshotDrivenRootIds
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
    if (manifestEnabled) {
        var descriptor = productRequestGenerator.buildRootDescriptor(product, exportContext);

        if (!descriptor) {
            throw new Error('Unable to build a lightweight catalog descriptor for root product ' + product + '.');
        }

        return descriptor;
    }

    var items = productRequestGenerator.processProducts(product, isDelta, exportContext);
    purchaseMetricHelper.putMapValue(exportedRootIds, product, true);
    return items;
};

exports.write = function (lines, parameters, stepExecution) {
    var productsList = new ArrayList(lines).toArray();

    if (manifestEnabled) {
        productsList.forEach(function (descriptor) {
            catalogExportStateHelper.writeRootDescriptor(stateRun, descriptor);
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
            scanDurationMs = new Date().getTime() - scanStartedAt;
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

        if (manifestEnabled) {
            purchaseMetricHelper.markFullExportApplied(
                exportContext,
                exportContext.purchaseMetrics,
                purchaseMetricHelper.DEFAULT_STATE_PATH
            );
        } else {
            purchaseMetricHelper.markDeltaExportApplied(
                exportContext,
                exportContext.purchaseMetrics,
                purchaseMetricHelper.DEFAULT_STATE_PATH,
                exportedRootIds
            );
        }

        if (manifestEnabled) {
            catalogExportStateHelper.promoteRun(stateRun);
            statePromoted = true;
            stateRun = null;
        }
        exportTargetHelper.updateLastSync(exportContext, syncStartedAt);

        if (manifestEnabled) {
            Logger.info(
                'Coveo manifest delta summary - mode={0}, reason={1}, deepBaselineAt={2}, deepBaselineAgeHours={3}, rootsScanned={4}, rootsCarried={5}, rootsGenerated={6}, rootsRemoved={7}, dirtyNew={8}, dirtyModified={9}, dirtyEligibilityOwnership={10}, dirtyPurchase={11}, dirtyForced={12}, dirtyMigration={13}, addUpdateOperations={14}, deleteOperations={15}, scanMs={16}, generationMs={17}, reconciliationMs={18}, uploadMs={19}.',
                modeSelection.mode,
                modeSelection.reason,
                activeManifest.lastDeepReconciledAt || '[unavailable]',
                modeSelection.baselineAgeHours === null ? '[unavailable]' : modeSelection.baselineAgeHours,
                reconciliationStats.rootsScanned,
                reconciliationStats.rootsCarriedForward,
                reconciliationStats.rootsGenerated,
                reconciliationStats.rootsRemoved,
                reconciliationStats.dirtyReasons.new,
                reconciliationStats.dirtyReasons.modified,
                reconciliationStats.dirtyReasons.eligibilityOwnership,
                reconciliationStats.dirtyReasons.purchase,
                reconciliationStats.dirtyReasons.forced,
                reconciliationStats.dirtyReasons.migration,
                reconciliationStats.addUpdateOperations,
                reconciliationStats.deleteOperations,
                scanDurationMs,
                reconciliationStats.generationDurationMs,
                reconciliationStats.reconciliationDurationMs,
                uploadDurationMs
            );
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
