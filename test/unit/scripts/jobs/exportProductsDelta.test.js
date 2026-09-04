'use strict';

var path = require('path');
var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();

function createIterator(values, onClose) {
    var index = 0;

    return {
        hasNext: function () {
            return index < values.length;
        },
        next: function () {
            var value = values[index];
            index += 1;
            return value;
        },
        close: function () {
            onClose();
        }
    };
}

function createParameters(options) {
    var parameterOptions = options || {};

    return {
        get: function (name) {
            return {
                srcFolder: '/src/coveo/feeds/products/',
                archivePath: '',
                deleteFile: true,
                reconciliationMode: parameterOptions.reconciliationMode,
                forceDeepReconciliation: parameterOptions.forceDeepReconciliation,
                maxDeepReconciliationAgeHours: parameterOptions.maxDeepReconciliationAgeHours
            }[name];
        }
    };
}

function hasOwn(object, propertyName) {
    return Object.prototype.hasOwnProperty.call(object, propertyName);
}

function createFixture(options) {
    var fixtureOptions = options || {};
    var descriptorSchemaVersion = 2;
    var currentItems = hasOwn(fixtureOptions, 'currentItems') ? fixtureOptions.currentItems : {
        KEEP: [{ documentId: 'doc-keep', value: 'same' }],
        CHANGE: [{ documentId: 'doc-change', value: 'new' }],
        NEW: [{ documentId: 'doc-new', value: 'new' }],
        INELIGIBLE: []
    };
    var currentRootIds = hasOwn(fixtureOptions, 'currentRootIds')
        ? fixtureOptions.currentRootIds
        : ['KEEP', 'CHANGE', 'NEW', 'INELIGIBLE'];
    var currentRootLookup = {};
    var currentDescriptors = fixtureOptions.currentDescriptors || {};

    currentRootIds.forEach(function (rootId) {
        currentRootLookup[rootId] = true;
    });

    function getDocumentIds(rootId) {
        return (currentItems[rootId] || []).map(function (item) {
            return item.documentId;
        });
    }

    function buildDescriptor(rootId) {
        var overrides = currentDescriptors[rootId] || {};
        var documentIds = getDocumentIds(rootId);

        return {
            rootId: rootId,
            documentIds: documentIds,
            modifiedAt: hasOwn(overrides, 'modifiedAt') ? overrides.modifiedAt : '2026-09-04T12:00:00.000Z',
            modificationSignature: overrides.modificationSignature || 'modified-' + rootId,
            eligibilitySignature: overrides.eligibilitySignature || (documentIds.length ? 'eligible-' + rootId : 'ineligible-' + rootId),
            ownershipSignature: overrides.ownershipSignature || JSON.stringify(documentIds)
        };
    }

    function completePreviousRecord(record) {
        var descriptor = currentRootLookup[record.rootId] ? buildDescriptor(record.rootId) : null;

        return {
            rootId: record.rootId,
            documentIds: record.documentIds || [],
            descriptorVersion: hasOwn(record, 'descriptorVersion') ? record.descriptorVersion : descriptorSchemaVersion,
            modifiedAt: hasOwn(record, 'modifiedAt')
                ? record.modifiedAt
                : (descriptor ? descriptor.modifiedAt : '2026-09-03T12:00:00.000Z'),
            modificationSignature: record.modificationSignature || (descriptor ? descriptor.modificationSignature : 'modified-' + record.rootId),
            eligibilitySignature: record.eligibilitySignature || (descriptor ? descriptor.eligibilitySignature : 'eligible-' + record.rootId),
            ownershipSignature: record.ownershipSignature || (descriptor ? descriptor.ownershipSignature : JSON.stringify(record.documentIds || [])),
            payloadChecksum: record.payloadChecksum
        };
    }

    var defaultPreviousRecords = [
        {
            rootId: 'KEEP',
            documentIds: ['doc-keep'],
            payloadChecksum: JSON.stringify(currentItems.KEEP)
        },
        {
            rootId: 'CHANGE',
            documentIds: ['doc-change'],
            modificationSignature: 'previous-modified-CHANGE',
            payloadChecksum: 'old-checksum'
        },
        {
            rootId: 'INELIGIBLE',
            documentIds: ['doc-offline'],
            eligibilitySignature: 'eligible-INELIGIBLE',
            ownershipSignature: JSON.stringify(['doc-offline']),
            payloadChecksum: 'old-checksum'
        },
        {
            rootId: 'DELETED',
            documentIds: ['doc-deleted'],
            payloadChecksum: 'old-checksum'
        }
    ];
    var previousRecords = (hasOwn(fixtureOptions, 'previousRecords')
        ? fixtureOptions.previousRecords
        : defaultPreviousRecords).map(completePreviousRecord);
    var run = {
        records: [],
        descriptors: [],
        currentDocumentIds: [],
        deleteCandidates: [],
        purchaseRoots: []
    };
    var calls = {
        aborted: false,
        closed: false,
        localeRestored: false,
        markedRoots: null,
        markedFull: false,
        modeSelections: [],
        operations: [],
        processCounts: {},
        descriptorCounts: {},
        descriptorsClosed: false,
        purchaseIteratorClosed: false,
        promoted: false,
        productFileRemoved: false,
        runOptions: null,
        updatedLastSync: null
    };
    var exportContext = {
        legacyMode: false,
        siteId: 'RefArch',
        targetId: 'mondou-en',
        locale: 'en_CA',
        language: 'en',
        coveoSourceId: 'source-id',
        catalogId: 'catalog',
        catalogStructureMode: fixtureOptions.catalogStructureMode || 'product_only',
        productEligibilityMode: 'online_and_searchable',
        purchaseMetrics: []
    };
    var stateHelper = {
        DEFAULT_STATE_PATH: '/src/coveo/state/catalog-export/',
        DESCRIPTOR_SCHEMA_VERSION: descriptorSchemaVersion,
        MANIFEST_SHARD_COUNT: 2,
        abortRun: function () {
            calls.aborted = true;
        },
        assertCompatibleManifest: function (context, manifest) {
            if (!manifest) {
                throw new Error('missing manifest');
            }
        },
        beginRun: function (context, startedAt, statePath, runOptions) {
            calls.runOptions = runOptions;
            return run;
        },
        closeDeleteCandidates: function () {},
        closeRun: function () {},
        closeRootDescriptors: function () {
            calls.descriptorsClosed = true;
        },
        closePurchaseRootIds: function () {},
        forEachCurrentDocumentId: function (stateRun, shardIndex, callback) {
            if (shardIndex === 0) {
                stateRun.currentDocumentIds.forEach(callback);
            }
        },
        forEachDeleteCandidate: function (stateRun, shardIndex, callback) {
            if (shardIndex === 0) {
                stateRun.deleteCandidates.forEach(callback);
            }
        },
        forEachShardRecord: function (manifest, shardIndex, callback) {
            if (shardIndex !== 0) {
                return;
            }

            var records = manifest === run ? run.records : previousRecords;
            records.forEach(callback);
        },
        forEachRootDescriptor: function (stateRun, shardIndex, callback) {
            if (shardIndex === 0) {
                stateRun.descriptors.forEach(callback);
            }
        },
        forEachPurchaseRootId: function (stateRun, shardIndex, callback) {
            if (shardIndex === 0) {
                stateRun.purchaseRoots.forEach(callback);
            }
        },
        getDocumentIds: function (items) {
            return items.map(function (item) {
                return item.documentId;
            });
        },
        getPayloadChecksum: function (items) {
            return JSON.stringify(items);
        },
        isManifestEnabled: function () {
            return true;
        },
        loadActiveManifest: function () {
            return fixtureOptions.missingManifest ? null : {
                generation: 'previous',
                descriptorVersion: descriptorSchemaVersion,
                lastDeepReconciliationAt: '2026-09-04T08:00:00.000Z'
            };
        },
        promoteRun: function () {
            calls.promoted = true;
        },
        selectReconciliationMode: function (manifest, selectionOptions, syncStartedAt) {
            calls.modeSelections.push({
                manifest: manifest,
                options: selectionOptions,
                syncStartedAt: syncStartedAt
            });

            var mode = fixtureOptions.selectedMode
                || (selectionOptions.forceDeep || selectionOptions.requestedMode === 'deep' ? 'deep' : 'fast');

            return {
                mode: mode,
                reason: selectionOptions.forceDeep ? 'forced' : 'test-baseline',
                baselineAgeHours: 1
            };
        },
        writeDeleteCandidate: function (stateRun, documentId) {
            stateRun.deleteCandidates.push(documentId);
        },
        writeRootRecord: function (stateRun, rootId, documentIds, state) {
            var record = {
                rootId: rootId,
                documentIds: documentIds,
                descriptorVersion: descriptorSchemaVersion,
                modifiedAt: state.modifiedAt,
                modificationSignature: state.modificationSignature,
                eligibilitySignature: state.eligibilitySignature,
                ownershipSignature: state.ownershipSignature,
                payloadChecksum: state.payloadChecksum,
                items: state.items
            };

            stateRun.records.push(record);
            stateRun.currentDocumentIds = stateRun.currentDocumentIds.concat(documentIds);
            return record;
        },
        writeRootDescriptor: function (stateRun, descriptor) {
            stateRun.descriptors.push(descriptor);
        },
        writePurchaseRootId: function (stateRun, rootId) {
            stateRun.purchaseRoots.push(rootId);
        }
    };
    var job = proxyquire(path.resolve(__dirname, '../../../../cartridges/bm_coveo/cartridge/scripts/jobs/exportProductsDelta'), {
        'dw/util/ArrayList': function ArrayList(values) {
            return {
                toArray: function () {
                    return values;
                }
            };
        },
        'dw/system/Logger': {
            getLogger: function () {
                return {
                    error: function () {},
                    info: function () {}
                };
            }
        },
        '*/cartridge/scripts/helper/catalogExportStateHelper': stateHelper,
        '*/cartridge/scripts/helper/coveoHelper': {
            archiveFeedFile: function () {},
            buildProductQuery: function () {
                return createIterator(currentRootIds, function () {
                    calls.closed = true;
                });
            },
            writeProductOperationsFile: function (sourceFolder, additions, deletes) {
                calls.operations.push({
                    additions: additions.slice(),
                    deletes: deletes.slice()
                });
                return {
                    path: '/IMPEX/feed.json',
                    remove: function () {
                        calls.productFileRemoved = true;
                    },
                    name: 'feed.json'
                };
            }
        },
        '*/cartridge/scripts/helper/exportTargetHelper': {
            applyRequestLocale: function () {
                return 'fr_CA';
            },
            resolveExportContext: function () {
                return exportContext;
            },
            restoreRequestLocale: function () {
                calls.localeRestored = true;
            },
            updateLastSync: function (context, lastSync) {
                calls.updatedLastSync = lastSync;
            }
        },
        '*/cartridge/scripts/generators/productRequestGenerator': {
            buildRootDescriptor: function (rootId) {
                calls.descriptorCounts[rootId] = (calls.descriptorCounts[rootId] || 0) + 1;
                return buildDescriptor(rootId);
            },
            processProducts: function (rootId) {
                if (fixtureOptions.failRoot === rootId) {
                    throw new Error('payload generation failed');
                }

                calls.processCounts[rootId] = (calls.processCounts[rootId] || 0) + 1;
                return currentItems[rootId] || [];
            },
            generateRoot: function (rootId) {
                if (fixtureOptions.failRoot === rootId) {
                    throw new Error('payload generation failed');
                }

                calls.processCounts[rootId] = (calls.processCounts[rootId] || 0) + 1;
                calls.descriptorCounts[rootId] = (calls.descriptorCounts[rootId] || 0) + 1;
                return {
                    descriptor: buildDescriptor(rootId),
                    items: currentItems[rootId] || []
                };
            }
        },
        '*/cartridge/scripts/helper/purchaseMetricHelper': {
            DEFAULT_STATE_PATH: '/src/coveo/state/purchase-enrichment/',
            createHashMap: function () {
                return {};
            },
            containsMapKey: function (map, key) {
                return Boolean(map[key]);
            },
            putMapValue: function (map, key, value) {
                map[key] = value;
            },
            attachSnapshotsToExportContext: function () {
                exportContext.purchaseMetrics = [];
            },
            ensureMetricFields: function () {},
            forEachSnapshotDrivenRootId: function (context, metrics, statePath, callback) {
                (fixtureOptions.purchaseRootIds || []).forEach(callback);
                calls.purchaseIteratorClosed = true;
            },
            getSnapshotDrivenRootIds: function () {
                return createIterator(fixtureOptions.purchaseRootIds || [], function () {
                    calls.purchaseIteratorClosed = true;
                });
            },
            markDeltaExportApplied: function (context, metrics, statePath, rootIds) {
                if (fixtureOptions.failMarkApplied) {
                    throw new Error('purchase state failed');
                }

                calls.markedRoots = Object.keys(rootIds);
            },
            markFullExportApplied: function () {
                if (fixtureOptions.failMarkApplied) {
                    throw new Error('purchase state failed');
                }

                calls.markedFull = true;
            }
        },
        '*/cartridge/scripts/helper/streamHelper': {
            createFileContainer: function () {
                return {
                    ok: true,
                    object: {
                        uploadUri: 'https://upload.example.com',
                        requiredHeaders: {},
                        fileId: 'file-1'
                    }
                };
            },
            uploadStreamService: function () {
                return fixtureOptions.failUpload ? {
                    ok: false,
                    errorMessage: 'upload failed'
                } : {
                    ok: true,
                    object: {}
                };
            },
            sendFileContainer: function () {
                return {
                    ok: true,
                    object: {
                        orderingId: 101
                    }
                };
            }
        }
    });

    return {
        calls: calls,
        job: job,
        parameters: createParameters(fixtureOptions.parameters),
        previousRecords: previousRecords,
        run: run
    };
}

function executeJob(fixture) {
    var processed = [];
    var rootId;

    fixture.job.beforeStep(fixture.parameters);
    rootId = fixture.job.read();

    while (rootId !== undefined) {
        processed.push(fixture.job.process(rootId));
        rootId = fixture.job.read();
    }

    fixture.job.write(processed);
    fixture.job.afterStep(true, fixture.parameters);
}

describe('exportProductsDelta job', function () {
    beforeEach(function () {
        global.empty = function (value) {
            return value === null
                || value === undefined
                || value === ''
                || (Array.isArray(value) && value.length === 0);
        };
    });

    afterEach(function () {
        delete global.empty;
    });

    it('uploads changed and new roots while deleting ineligible and removed roots', function () {
        var fixture = createFixture();

        executeJob(fixture);

        assert.lengthOf(fixture.calls.operations, 1);
        assert.sameMembers(fixture.calls.operations[0].additions.map(function (item) {
            return item.documentId;
        }), ['doc-change', 'doc-new']);
        assert.sameMembers(fixture.calls.operations[0].deletes, ['doc-offline', 'doc-deleted']);
        assert.notProperty(fixture.calls.processCounts, 'KEEP');
        assert.strictEqual(fixture.calls.processCounts.CHANGE, 1);
        assert.strictEqual(fixture.calls.processCounts.NEW, 1);
        assert.strictEqual(fixture.calls.processCounts.INELIGIBLE, 1);
        var carriedRecord = fixture.run.records.filter(function (record) {
            return record.rootId === 'KEEP';
        })[0];
        assert.deepEqual({
            documentIds: carriedRecord.documentIds,
            payloadChecksum: carriedRecord.payloadChecksum,
            modificationSignature: carriedRecord.modificationSignature,
            eligibilitySignature: carriedRecord.eligibilitySignature,
            ownershipSignature: carriedRecord.ownershipSignature
        }, {
            documentIds: ['doc-keep'],
            payloadChecksum: JSON.stringify([{ documentId: 'doc-keep', value: 'same' }]),
            modificationSignature: 'modified-KEEP',
            eligibilitySignature: 'eligible-KEEP',
            ownershipSignature: JSON.stringify(['doc-keep'])
        });
        assert.isTrue(fixture.calls.promoted);
        assert.isFalse(fixture.calls.aborted);
        assert.instanceOf(fixture.calls.updatedLastSync, Date);
        assert.isTrue(fixture.calls.markedFull);
        assert.isTrue(fixture.calls.closed);
        assert.isTrue(fixture.calls.localeRestored);
    });

    it('promotes a no-change manifest without creating a Stream file', function () {
        var keepItems = [{ documentId: 'doc-keep', value: 'same' }];
        var fixture = createFixture({
            currentItems: {
                KEEP: keepItems
            },
            currentRootIds: ['KEEP'],
            previousRecords: [{
                rootId: 'KEEP',
                documentIds: ['doc-keep'],
                payloadChecksum: JSON.stringify(keepItems)
            }]
        });

        executeJob(fixture);

        assert.lengthOf(fixture.calls.operations, 0);
        assert.notProperty(fixture.calls.processCounts, 'KEEP');
        assert.deepEqual({
            rootId: fixture.run.records[0].rootId,
            documentIds: fixture.run.records[0].documentIds,
            payloadChecksum: fixture.run.records[0].payloadChecksum,
            modificationSignature: fixture.run.records[0].modificationSignature,
            eligibilitySignature: fixture.run.records[0].eligibilitySignature,
            ownershipSignature: fixture.run.records[0].ownershipSignature
        }, {
            rootId: 'KEEP',
            documentIds: ['doc-keep'],
            payloadChecksum: JSON.stringify(keepItems),
            modificationSignature: 'modified-KEEP',
            eligibilitySignature: 'eligible-KEEP',
            ownershipSignature: JSON.stringify(['doc-keep'])
        });
        assert.isTrue(fixture.calls.descriptorsClosed);
        assert.isTrue(fixture.calls.promoted);
        assert.isTrue(fixture.calls.markedFull);
        assert.instanceOf(fixture.calls.updatedLastSync, Date);
    });

    it('scans 10000 descriptors while generating only two modified roots', function () {
        var currentItems = {};
        var currentRootIds = [];
        var previousRecords = [];
        var index;

        for (index = 0; index < 10000; index += 1) {
            var rootId = 'ROOT-' + index;
            var items = [{ documentId: 'doc-' + index }];

            currentRootIds.push(rootId);
            currentItems[rootId] = items;
            previousRecords.push({
                rootId: rootId,
                documentIds: ['doc-' + index],
                modificationSignature: index === 123 || index === 9876 ? 'previous-' + rootId : '',
                payloadChecksum: index === 123 || index === 9876 ? 'old-checksum' : JSON.stringify(items)
            });
        }

        var fixture = createFixture({
            currentItems: currentItems,
            currentRootIds: currentRootIds,
            previousRecords: previousRecords
        });

        executeJob(fixture);

        assert.strictEqual(Object.keys(fixture.calls.descriptorCounts).length, 10000);
        assert.deepEqual(Object.keys(fixture.calls.processCounts).sort(), ['ROOT-123', 'ROOT-9876']);
        assert.strictEqual(fixture.calls.processCounts['ROOT-123'], 1);
        assert.strictEqual(fixture.calls.processCounts['ROOT-9876'], 1);
        assert.strictEqual(fixture.run.records.length, 10000);
    });

    it('generates a purchase-driven root even when its catalog timestamp is unchanged', function () {
        var previousItems = [{ documentId: 'doc-keep', ec_units_sold_30d: 1 }];
        var currentItems = [{ documentId: 'doc-keep', ec_units_sold_30d: 2 }];
        var unchangedTimestamp = '2026-09-04T12:00:00.000Z';
        var fixture = createFixture({
            currentItems: {
                KEEP: currentItems
            },
            currentRootIds: ['KEEP'],
            currentDescriptors: {
                KEEP: {
                    modifiedAt: unchangedTimestamp
                }
            },
            previousRecords: [{
                rootId: 'KEEP',
                documentIds: ['doc-keep'],
                modifiedAt: unchangedTimestamp,
                payloadChecksum: JSON.stringify(previousItems)
            }],
            purchaseRootIds: ['KEEP']
        });

        executeJob(fixture);

        assert.strictEqual(fixture.calls.processCounts.KEEP, 1);
        assert.lengthOf(fixture.calls.operations, 1);
        assert.deepEqual(fixture.calls.operations[0].additions, currentItems);
        assert.deepEqual(fixture.calls.operations[0].deletes, []);
        assert.deepEqual(fixture.run.records[0].documentIds, currentItems.map(function (item) {
            return item.documentId;
        }));
        assert.isTrue(fixture.calls.markedFull);
        assert.isTrue(fixture.calls.purchaseIteratorClosed);
    });

    it('generates every current root in forced deep mode and passes mode selection parameters', function () {
        var firstItems = [{ documentId: 'doc-first', value: 'same' }];
        var secondItems = [{ documentId: 'doc-second', value: 'same' }];
        var fixture = createFixture({
            currentItems: {
                FIRST: firstItems,
                SECOND: secondItems
            },
            currentRootIds: ['FIRST', 'SECOND'],
            previousRecords: [{
                rootId: 'FIRST',
                documentIds: ['doc-first'],
                payloadChecksum: JSON.stringify(firstItems)
            }, {
                rootId: 'SECOND',
                documentIds: ['doc-second'],
                payloadChecksum: JSON.stringify(secondItems)
            }],
            parameters: {
                reconciliationMode: 'fast',
                forceDeepReconciliation: 'true',
                maxDeepReconciliationAgeHours: '12'
            }
        });

        executeJob(fixture);

        assert.strictEqual(fixture.calls.processCounts.FIRST, 1);
        assert.strictEqual(fixture.calls.processCounts.SECOND, 1);
        assert.strictEqual(fixture.calls.descriptorCounts.FIRST, 2);
        assert.strictEqual(fixture.calls.descriptorCounts.SECOND, 2);
        assert.lengthOf(fixture.calls.operations, 0);
        assert.lengthOf(fixture.calls.modeSelections, 1);
        assert.deepEqual(fixture.calls.modeSelections[0].options, {
            requestedMode: 'fast',
            forceDeep: true,
            maxAgeHours: '12'
        });
        assert.instanceOf(fixture.calls.modeSelections[0].syncStartedAt, Date);
        assert.strictEqual(fixture.calls.runOptions.reconciliationMode, 'deep');
        assert.isTrue(fixture.calls.markedFull);
    });

    it('does not delete a document that moved from a removed root to a current root', function () {
        var fixture = createFixture({
            currentItems: {
                NEW_ROOT: [{ documentId: 'doc-reassigned', value: 'current' }]
            },
            currentRootIds: ['NEW_ROOT'],
            previousRecords: [{
                rootId: 'OLD_ROOT',
                documentIds: ['doc-reassigned'],
                payloadChecksum: 'old-checksum'
            }]
        });

        executeJob(fixture);

        assert.lengthOf(fixture.calls.operations, 1);
        assert.deepEqual(fixture.calls.operations[0].additions.map(function (item) {
            return item.documentId;
        }), ['doc-reassigned']);
        assert.deepEqual(fixture.calls.operations[0].deletes, []);
        assert.isTrue(fixture.calls.promoted);
    });

    it('splits a product-only root with more than the per-upload operation limit', function () {
        var items = [];
        var index;

        for (index = 0; index < 1001; index += 1) {
            items.push({
                documentId: 'doc-' + index
            });
        }

        var fixture = createFixture({
            currentItems: {
                LARGE_ROOT: items
            },
            currentRootIds: ['LARGE_ROOT'],
            previousRecords: []
        });

        executeJob(fixture);

        assert.lengthOf(fixture.calls.operations, 2);
        assert.strictEqual(fixture.calls.operations.reduce(function (count, operation) {
            assert.isAtMost(operation.additions.length + operation.deletes.length, 1000);
            return count + operation.additions.length;
        }, 0), 1001);
        assert.isTrue(fixture.calls.promoted);
        assert.isFalse(fixture.calls.aborted);
    });

    it('splits large product-variant roots and repeats each Variant parent', function () {
        var items = [{
            documentId: 'parent-document',
            objecttype: 'Product',
            ec_product_id: 'PARENT'
        }];
        var index;

        for (index = 0; index < 1000; index += 1) {
            items.push({
                documentId: 'variant-document-' + index,
                objecttype: 'Variant',
                ec_product_id: 'PARENT',
                ec_variant_id: 'VARIANT-' + index
            });
        }

        var fixture = createFixture({
            catalogStructureMode: 'product_variant',
            currentItems: {
                LARGE_ROOT: items
            },
            currentRootIds: ['LARGE_ROOT'],
            previousRecords: []
        });

        executeJob(fixture);

        assert.lengthOf(fixture.calls.operations, 2);
        assert.strictEqual(fixture.calls.operations.reduce(function (variantCount, operation) {
            var parentItems = operation.additions.filter(function (item) {
                return item.objecttype === 'Product' && item.ec_product_id === 'PARENT';
            });
            var variantItems = operation.additions.filter(function (item) {
                return item.objecttype === 'Variant';
            });

            assert.lengthOf(parentItems, 1);
            assert.isAtMost(operation.additions.length + operation.deletes.length, 1000);
            return variantCount + variantItems.length;
        }, 0), 1000);
        assert.isTrue(fixture.calls.promoted);
    });

    it('aborts the candidate manifest and does not advance lastSync when upload fails', function () {
        var fixture = createFixture({
            failUpload: true
        });

        assert.throws(function () {
            executeJob(fixture);
        }, /upload failed/);
        assert.isTrue(fixture.calls.aborted);
        assert.isTrue(fixture.calls.productFileRemoved);
        assert.isFalse(fixture.calls.promoted);
        assert.isNull(fixture.calls.updatedLastSync);
        assert.isTrue(fixture.calls.localeRestored);
    });

    it('requires an active compatible manifest before scanning products', function () {
        var fixture = createFixture({
            missingManifest: true
        });

        assert.throws(function () {
            fixture.job.beforeStep(fixture.parameters);
        }, /missing manifest/);
        assert.isTrue(fixture.calls.localeRestored);
        assert.isFalse(fixture.calls.promoted);
    });

    it('does not promote the manifest when purchase state persistence fails', function () {
        var fixture = createFixture({
            failMarkApplied: true
        });

        assert.throws(function () {
            executeJob(fixture);
        }, /purchase state failed/);
        assert.isTrue(fixture.calls.aborted);
        assert.isFalse(fixture.calls.promoted);
        assert.isNull(fixture.calls.updatedLastSync);
    });

    it('does not delete prior documents when payload generation fails', function () {
        var fixture = createFixture({
            currentRootIds: ['CHANGE'],
            failRoot: 'CHANGE'
        });

        assert.throws(function () {
            executeJob(fixture);
        }, /payload generation failed/);

        assert.lengthOf(fixture.calls.operations, 0);
        assert.isTrue(fixture.calls.aborted);
        assert.isFalse(fixture.calls.promoted);
    });
});
