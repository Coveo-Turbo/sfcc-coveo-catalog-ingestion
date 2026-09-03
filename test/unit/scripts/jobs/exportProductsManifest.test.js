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
        close: onClose
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
    var rootIds = fixtureOptions.rootIds || ['ELIGIBLE', 'INELIGIBLE'];
    var itemsByRoot = fixtureOptions.itemsByRoot || {
        ELIGIBLE: [{
            documentId: 'doc-eligible',
            objecttype: 'Product',
            language: 'en',
            permanentid: 'ELIGIBLE',
            ec_product_id: 'ELIGIBLE'
        }],
        INELIGIBLE: []
    };
    var run = {
        records: []
    };
    var calls = {
        aborted: false,
        addBatches: [],
        closed: false,
        deleteBatches: [],
        deleteOlderThan: [],
        localeRestored: false,
        markedApplied: false,
        promoted: false,
        updatedLastSync: null
    };
    var context = {
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
        abortRun: function () {
            calls.aborted = true;
        },
        beginRun: function () {
            return run;
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
        promoteRun: function () {
            calls.promoted = true;
        },
        writeRootRecord: function (stateRun, rootId, documentIds, state) {
            stateRun.records.push({
                rootId: rootId,
                documentIds: documentIds,
                payloadChecksum: state.payloadChecksum
            });
        }
    };
    var orderingId = 100;
    var job = proxyquire(path.resolve(__dirname, '../../../../cartridges/bm_coveo/cartridge/scripts/jobs/exportProducts'), {
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
                return createIterator(rootIds, function () {
                    calls.closed = true;
                });
            },
            writeProductFile: function (sourceFolder, products) {
                calls.addBatches.push(products.slice());
                return {
                    path: '/IMPEX/full.json',
                    remove: function () {},
                    name: 'full.json'
                };
            },
            writeProductOperationsFile: function (sourceFolder, products, deletes) {
                calls.addBatches.push(products.slice());
                calls.deleteBatches.push(deletes.slice());
                return {
                    path: '/IMPEX/full-delete.json',
                    remove: function () {},
                    name: 'full-delete.json'
                };
            }
        },
        '*/cartridge/scripts/helper/exportTargetHelper': {
            applyRequestLocale: function () {
                return 'fr_CA';
            },
            resolveExportContext: function () {
                return context;
            },
            restoreRequestLocale: function () {
                calls.localeRestored = true;
            },
            updateLastSync: function (exportContext, lastSync) {
                calls.updatedLastSync = lastSync;
            }
        },
        '*/cartridge/scripts/generators/productRequestGenerator': {
            processProducts: function (rootId) {
                return itemsByRoot[rootId] || [];
            }
        },
        '*/cartridge/scripts/helper/purchaseMetricHelper': {
            DEFAULT_STATE_PATH: '/src/coveo/state/purchase-enrichment/',
            attachSnapshotsToExportContext: function () {
                context.purchaseMetrics = [];
            },
            ensureMetricFields: function () {},
            markFullExportApplied: function () {
                if (fixtureOptions.failMarkApplied) {
                    throw new Error('purchase state failed');
                }

                calls.markedApplied = true;
            }
        },
        '*/cartridge/scripts/helper/streamHelper': {
            createFileContainer: function () {
                return {
                    ok: true,
                    object: {
                        uploadUri: 'https://upload.example.com',
                        requiredHeaders: {},
                        fileId: 'file-' + orderingId
                    }
                };
            },
            uploadStreamService: function () {
                return {
                    ok: true,
                    object: {}
                };
            },
            sendFileContainer: function () {
                var response = {
                    ok: true,
                    object: {
                        orderingId: orderingId
                    }
                };
                orderingId += 1;
                return response;
            },
            deleteOlderThan: function (value) {
                calls.deleteOlderThan.push(value);
                return fixtureOptions.failDeleteOlderThan ? {
                    ok: false,
                    errorMessage: 'delete older than failed'
                } : {
                    ok: true,
                    object: {}
                };
            }
        }
    });

    return {
        calls: calls,
        job: job,
        parameters: createParameters(),
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
    fixture.job.afterChunk(null, fixture.parameters);
    fixture.job.afterStep(true, fixture.parameters);
}

describe('exportProducts manifest reconciliation', function () {
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

    it('records every root and promotes state only after deleteolderthan succeeds', function () {
        var fixture = createFixture();

        executeJob(fixture);

        assert.lengthOf(fixture.run.records, 2);
        assert.deepEqual(fixture.run.records[0].documentIds, ['doc-eligible']);
        assert.deepEqual(fixture.run.records[1].documentIds, []);
        assert.lengthOf(fixture.calls.addBatches, 1);
        assert.deepEqual(fixture.calls.deleteOlderThan, [100]);
        assert.isTrue(fixture.calls.promoted);
        assert.isFalse(fixture.calls.aborted);
        assert.isTrue(fixture.calls.markedApplied);
        assert.instanceOf(fixture.calls.updatedLastSync, Date);
        assert.isTrue(fixture.calls.closed);
        assert.isTrue(fixture.calls.localeRestored);
    });

    it('uses a delete-only operation as the ordering boundary when no products are eligible', function () {
        var fixture = createFixture({
            rootIds: ['INELIGIBLE'],
            itemsByRoot: {
                INELIGIBLE: []
            }
        });

        executeJob(fixture);

        assert.lengthOf(fixture.calls.deleteBatches, 1);
        assert.deepEqual(fixture.calls.deleteBatches[0], [
            'coveo://catalog-export/empty-full-reconciliation-boundary'
        ]);
        assert.deepEqual(fixture.calls.deleteOlderThan, [100]);
        assert.isTrue(fixture.calls.promoted);
        assert.instanceOf(fixture.calls.updatedLastSync, Date);
    });

    it('does not promote state or advance lastSync when source reconciliation fails', function () {
        var fixture = createFixture({
            failDeleteOlderThan: true
        });

        assert.throws(function () {
            executeJob(fixture);
        }, /delete older than failed/);
        assert.isTrue(fixture.calls.aborted);
        assert.isFalse(fixture.calls.promoted);
        assert.isNull(fixture.calls.updatedLastSync);
        assert.isTrue(fixture.calls.localeRestored);
    });

    it('keeps the previous manifest active when purchase state persistence fails', function () {
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
});
