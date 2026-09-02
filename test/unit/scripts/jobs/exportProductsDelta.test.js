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

function createParameters() {
    return {
        get: function (name) {
            return {
                srcFolder: '/src/coveo/feeds/products/',
                archivePath: '',
                deleteFile: true
            }[name];
        }
    };
}

function createFixture(options) {
    var fixtureOptions = options || {};
    var currentItems = fixtureOptions.currentItems || {
        KEEP: [{ documentId: 'doc-keep', value: 'same' }],
        CHANGE: [{ documentId: 'doc-change', value: 'new' }],
        NEW: [{ documentId: 'doc-new', value: 'new' }],
        INELIGIBLE: []
    };
    var previousRecords = fixtureOptions.previousRecords || [
        { rootId: 'KEEP', documentIds: ['doc-keep'], payloadChecksum: JSON.stringify(currentItems.KEEP) },
        { rootId: 'CHANGE', documentIds: ['doc-change'], payloadChecksum: 'old-checksum' },
        { rootId: 'INELIGIBLE', documentIds: ['doc-offline'], payloadChecksum: 'old-checksum' },
        { rootId: 'DELETED', documentIds: ['doc-deleted'], payloadChecksum: 'old-checksum' }
    ];
    var currentRootIds = fixtureOptions.currentRootIds || ['KEEP', 'CHANGE', 'NEW', 'INELIGIBLE'];
    var run = {
        records: []
    };
    var calls = {
        aborted: false,
        closed: false,
        localeRestored: false,
        markedRoots: null,
        operations: [],
        processCounts: {},
        promoted: false,
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
        catalogStructureMode: 'product_only',
        productEligibilityMode: 'online_and_searchable',
        purchaseMetrics: []
    };
    var stateHelper = {
        DEFAULT_STATE_PATH: '/src/coveo/state/catalog-export/',
        MANIFEST_SHARD_COUNT: 2,
        abortRun: function () {
            calls.aborted = true;
        },
        assertCompatibleManifest: function (context, manifest) {
            if (!manifest) {
                throw new Error('missing manifest');
            }
        },
        beginRun: function () {
            return run;
        },
        closeRun: function () {},
        forEachShardRecord: function (manifest, shardIndex, callback) {
            if (shardIndex !== 0) {
                return;
            }

            var records = manifest === run ? run.records : previousRecords;
            records.forEach(callback);
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
                generation: 'previous'
            };
        },
        promoteRun: function () {
            calls.promoted = true;
        },
        writeRootRecord: function (stateRun, rootId, documentIds, state) {
            stateRun.records.push({
                rootId: rootId,
                documentIds: documentIds,
                payloadChecksum: state.payloadChecksum,
                items: state.items
            });
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
                    remove: function () {},
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
            processProducts: function (rootId) {
                if (fixtureOptions.failRoot === rootId) {
                    throw new Error('payload generation failed');
                }

                calls.processCounts[rootId] = (calls.processCounts[rootId] || 0) + 1;
                return currentItems[rootId] || [];
            }
        },
        '*/cartridge/scripts/helper/purchaseMetricHelper': {
            DEFAULT_STATE_PATH: '/src/coveo/state/purchase-enrichment/',
            attachSnapshotsToExportContext: function () {
                exportContext.purchaseMetrics = [];
            },
            ensureMetricFields: function () {},
            getSnapshotDrivenRootIds: function () {
                return [];
            },
            markDeltaExportApplied: function (context, metrics, statePath, rootIds) {
                if (fixtureOptions.failMarkApplied) {
                    throw new Error('purchase state failed');
                }

                calls.markedRoots = rootIds;
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
        parameters: createParameters()
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
        assert.strictEqual(fixture.calls.processCounts.KEEP, 1);
        assert.strictEqual(fixture.calls.processCounts.CHANGE, 1);
        assert.strictEqual(fixture.calls.processCounts.NEW, 1);
        assert.isTrue(fixture.calls.promoted);
        assert.isFalse(fixture.calls.aborted);
        assert.instanceOf(fixture.calls.updatedLastSync, Date);
        assert.sameMembers(fixture.calls.markedRoots, ['CHANGE', 'NEW', 'INELIGIBLE', 'DELETED']);
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
        assert.isTrue(fixture.calls.promoted);
        assert.deepEqual(fixture.calls.markedRoots, []);
        assert.instanceOf(fixture.calls.updatedLastSync, Date);
    });

    it('aborts the candidate manifest and does not advance lastSync when upload fails', function () {
        var fixture = createFixture({
            failUpload: true
        });

        assert.throws(function () {
            executeJob(fixture);
        }, /upload failed/);
        assert.isTrue(fixture.calls.aborted);
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

        fixture.job.beforeStep(fixture.parameters);

        assert.throws(function () {
            fixture.job.process(fixture.job.read());
        }, /payload generation failed/);

        fixture.job.afterStep(false, fixture.parameters);

        assert.lengthOf(fixture.calls.operations, 0);
        assert.isTrue(fixture.calls.aborted);
        assert.isFalse(fixture.calls.promoted);
    });
});
