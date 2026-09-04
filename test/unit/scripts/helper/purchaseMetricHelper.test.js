'use strict';

var path = require('path');
var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();

function createFixture(options) {
    var fixtureOptions = options || {};
    var storage = {};
    var failWritePattern = null;
    var failRenamePattern = null;
    var getStringLimit = 1000;

    function normalizePath(value) {
        return String(value).replace(/\/{2,}/g, '/');
    }

    function toSfccStringArray(values) {
        var result = {
            length: values.length
        };

        values.forEach(function (value, index) {
            result[index] = value;
        });
        Object.defineProperty(result, 'toArray', {
            get: function () {
                throw new Error('Java String[] does not expose toArray');
            }
        });
        return result;
    }

    function File(filePath) {
        this.fullPath = normalizePath(filePath);
        this.path = this.fullPath;
        this.name = this.fullPath.split('/').pop();
    }

    File.IMPEX = '/impex';
    File.SEPARATOR = '/';
    File.prototype.exists = function () {
        return Object.prototype.hasOwnProperty.call(storage, this.fullPath);
    };
    File.prototype.mkdirs = function () {
        return true;
    };
    File.prototype.createNewFile = function () {
        if (this.exists()) {
            return false;
        }
        storage[this.fullPath] = '';
        return true;
    };
    File.prototype.remove = function () {
        if (!this.exists()) {
            return false;
        }
        delete storage[this.fullPath];
        return true;
    };
    File.prototype.renameTo = function (target) {
        if (failRenamePattern && failRenamePattern.test(this.fullPath + '->' + target.fullPath)) {
            return false;
        }
        if (!this.exists() || target.exists()) {
            return false;
        }
        storage[target.fullPath] = storage[this.fullPath];
        delete storage[this.fullPath];
        return true;
    };
    File.prototype.getName = function () {
        return this.name;
    };
    File.prototype.listFiles = function () {
        var prefix = this.fullPath.replace(/\/$/, '') + '/';
        return Object.keys(storage).filter(function (filePath) {
            return filePath.indexOf(prefix) === 0 && filePath.indexOf('/', prefix.length) === -1;
        }).map(function (filePath) {
            return new File(filePath);
        });
    };

    function FileWriter(file) {
        this.file = file;
        storage[file.fullPath] = '';
    }

    FileWriter.prototype.write = function (value) {
        if (failWritePattern && failWritePattern.test(this.file.fullPath)) {
            throw new Error('simulated file write failure');
        }
        storage[this.file.fullPath] += String(value);
    };
    FileWriter.prototype.flush = function () {};
    FileWriter.prototype.close = function () {};

    function FileReader(file) {
        this.file = file;
    }

    FileReader.prototype.getString = function () {
        var value = storage[this.file.fullPath] || '';
        if (value.length > getStringLimit) {
            throw new Error('getString quota exceeded');
        }
        return value;
    };
    FileReader.prototype.close = function () {};

    function CSVStreamReader(fileReader) {
        this.text = storage[fileReader.file.fullPath] || '';
        this.index = 0;
    }

    CSVStreamReader.prototype.readNext = function () {
        var row = [];
        var cell = '';
        var inQuotes = false;

        if (this.index >= this.text.length) {
            return null;
        }

        while (this.index < this.text.length) {
            var currentChar = this.text.charAt(this.index);
            var nextChar = this.text.charAt(this.index + 1);
            this.index += 1;

            if (currentChar === '"') {
                if (inQuotes && nextChar === '"') {
                    cell += '"';
                    this.index += 1;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (currentChar === ',' && !inQuotes) {
                row.push(cell);
                cell = '';
            } else if ((currentChar === '\n' || currentChar === '\r') && !inQuotes) {
                if (currentChar === '\r' && nextChar === '\n') {
                    this.index += 1;
                }
                row.push(cell);
                return toSfccStringArray(row);
            } else {
                cell += currentChar;
            }
        }

        row.push(cell);
        return toSfccStringArray(row);
    };
    CSVStreamReader.prototype.close = function () {};

    function HashMap() {
        this.values = {};
        this.count = 0;
    }

    HashMap.prototype.put = function (key, value) {
        if (!Object.prototype.hasOwnProperty.call(this.values, key)) {
            if (this.count >= 1000) {
                throw new Error('collection quota exceeded');
            }
            this.count += 1;
        }
        this.values[key] = value;
    };
    HashMap.prototype.get = function (key) {
        return Object.prototype.hasOwnProperty.call(this.values, key) ? this.values[key] : null;
    };
    HashMap.prototype.containsKey = function (key) {
        return Object.prototype.hasOwnProperty.call(this.values, key);
    };
    HashMap.prototype.remove = function (key) {
        if (this.containsKey(key)) {
            delete this.values[key];
            this.count -= 1;
        }
    };
    HashMap.prototype.entrySet = function () {
        var map = this;
        return {
            iterator: function () {
                var keys = Object.keys(map.values);
                var index = 0;
                return {
                    hasNext: function () {
                        return index < keys.length;
                    },
                    next: function () {
                        var key = keys[index++];
                        return {
                            getKey: function () {
                                return key;
                            },
                            getValue: function () {
                                return map.values[key];
                            }
                        };
                    }
                };
            }
        };
    };

    var helper = proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/helper/purchaseMetricHelper'), {
        'dw/io/File': File,
        'dw/io/FileReader': FileReader,
        'dw/io/FileWriter': FileWriter,
        'dw/io/CSVStreamReader': CSVStreamReader,
        'dw/util/HashMap': HashMap,
        'dw/util/UUIDUtils': {
            createUUID: function () {
                if (fixtureOptions.failUuid) {
                    throw new Error('simulated UUID failure');
                }

                return {
                    toString: function () {
                        return 'purchase-state-test-token';
                    }
                };
            }
        },
        'dw/system/Logger': {
            getLogger: function () {
                return {
                    info: function () {},
                    warn: function () {},
                    error: function () {}
                };
            }
        },
        '*/cartridge/scripts/services/platformFieldService': {
            createFields: function () {}
        }
    });

    return {
        helper: helper,
        storage: storage,
        setFailWritePattern: function (pattern) {
            failWritePattern = pattern;
        },
        setFailRenamePattern: function (pattern) {
            failRenamePattern = pattern;
        }
    };
}

function createContext() {
    return {
        targetId: 'rens-ca',
        coveoTrackingId: 'rens-pets',
        locale: 'en_CA'
    };
}

describe('purchaseMetricHelper', function () {
    it('streams more than 20000 products through quota-bounded snapshot and target state', function () {
        var fixture = createFixture();
        var helper = fixture.helper;
        var counts = helper.createHashMap();
        var mappedRows = helper.createHashMap();
        var skippedRows = helper.createHashMap();
        var index;

        for (index = 0; index < 25000; index += 1) {
            var productId = 'product-' + index;
            helper.putMapValue(counts, productId, 1);
            helper.putMapValue(mappedRows, productId, {
                productId: productId,
                rootProductId: 'root-' + index,
                documentId: 'https://example.com/' + productId,
                count: 1
            });
        }

        var snapshot = helper.writeSharedSnapshot('/state/', 'rens-pets', 90, {
            counts: counts,
            quantityDimension: 'custom_events.c_quantity',
            exportId: 'export-large',
            generatedAt: new Date().toISOString(),
            processedRows: 25000
        });

        helper.writeTargetSnapshotState('/state/', createContext(), snapshot, mappedRows, skippedRows);

        var reloaded = helper.readSharedSnapshot('/state/', 'rens-pets', 90);
        assert.strictEqual(helper.getMapSize(reloaded.counts), 25000);
        assert.strictEqual(helper.getMapValue(reloaded.counts, 'product-24999'), 1);
        assert.match(fixture.storage['/impex/state/coveo_purchase_target_current_rens-ca_90d.csv'], /^productId,/);
        assert.include(fixture.storage['/impex/state/coveo_purchase_target_current_rens-ca_90d.csv'], 'product-24999');

        helper.markFullExportApplied(createContext(), [snapshot], '/state/');
        helper.iterateMap(mappedRows, function (productId, row) {
            row.count = 2;
            helper.putMapValue(mappedRows, productId, row);
        });
        helper.writeTargetSnapshotState('/state/', createContext(), snapshot, mappedRows, skippedRows);

        var streamedChangedRootCount = 0;
        helper.forEachSnapshotDrivenRootId(createContext(), [snapshot], '/state/', function () {
            streamedChangedRootCount += 1;
        });
        assert.strictEqual(streamedChangedRootCount, 25000);

        var changedRoots = helper.getSnapshotDrivenRootIds(createContext(), [snapshot], '/state/');
        var exportedRoots = helper.createHashMap();
        var changedRootCount = 0;
        while (changedRoots.hasNext()) {
            helper.putMapValue(exportedRoots, changedRoots.next(), true);
            changedRootCount += 1;
        }
        assert.strictEqual(changedRootCount, 25000);

        helper.markDeltaExportApplied(createContext(), [snapshot], '/state/', exportedRoots);
        assert.isFalse(helper.getSnapshotDrivenRootIds(createContext(), [snapshot], '/state/').hasNext());
    });

    it('marks the target rows captured by the export instead of a concurrently published generation', function () {
        var fixture = createFixture();
        var helper = fixture.helper;
        var context = createContext();
        var firstCounts = helper.createHashMap();
        var firstRows = helper.createHashMap();
        var secondCounts = helper.createHashMap();
        var secondRows = helper.createHashMap();
        var skippedRows = helper.createHashMap();

        helper.putMapValue(firstCounts, 'sku-1', 1);
        helper.putMapValue(firstRows, 'sku-1', {
            rootProductId: 'root-1',
            documentId: 'https://example.com/sku-1',
            count: 1
        });
        var firstSnapshot = helper.writeSharedSnapshot('/state/', 'rens-pets', 90, {
            counts: firstCounts,
            exportId: 'export-1',
            generatedAt: new Date().toISOString()
        });
        helper.writeTargetSnapshotState('/state/', context, firstSnapshot, firstRows, skippedRows);
        helper.attachSnapshotsToExportContext(context, '/state/');
        var exportedSnapshots = context.purchaseMetrics;

        helper.putMapValue(secondCounts, 'sku-1', 2);
        helper.putMapValue(secondRows, 'sku-1', {
            rootProductId: 'root-1',
            documentId: 'https://example.com/sku-1',
            count: 2
        });
        var secondSnapshot = helper.writeSharedSnapshot('/state/', 'rens-pets', 90, {
            counts: secondCounts,
            exportId: 'export-2',
            generatedAt: new Date().toISOString()
        });
        helper.writeTargetSnapshotState('/state/', context, secondSnapshot, secondRows, skippedRows);

        helper.markFullExportApplied(context, exportedSnapshots, '/state/');

        var changedRoots = helper.getSnapshotDrivenRootIds(context, [secondSnapshot], '/state/');
        assert.isTrue(changedRoots.hasNext());
        assert.strictEqual(changedRoots.next(), 'root-1');
        assert.isFalse(changedRoots.hasNext());
    });

    it('keeps the previous snapshot active when new metadata publication fails', function () {
        var fixture = createFixture();
        var helper = fixture.helper;
        var firstCounts = helper.createHashMap();
        var secondCounts = helper.createHashMap();

        helper.putMapValue(firstCounts, 'sku-1', 2);
        helper.writeSharedSnapshot('/state/', 'rens-pets', 90, {
            counts: firstCounts,
            exportId: 'export-1',
            generatedAt: new Date().toISOString()
        });

        var metadataPath = '/impex/state/coveo_purchase_snapshot_rens-pets_90d.json';
        var previousMetadataText = fixture.storage[metadataPath];
        var previousCountFile = JSON.parse(previousMetadataText).countFile;

        helper.putMapValue(secondCounts, 'sku-2', 3);
        fixture.setFailWritePattern(/coveo_purchase_snapshot_rens-pets_90d\.json\.tmp$/);

        assert.throws(function () {
            helper.writeSharedSnapshot('/state/', 'rens-pets', 90, {
                counts: secondCounts,
                exportId: 'export-2',
                generatedAt: new Date().toISOString()
            });
        }, /simulated file write failure/);

        assert.strictEqual(fixture.storage[metadataPath], previousMetadataText);
        assert.property(fixture.storage, '/impex/state/' + previousCountFile);
        assert.strictEqual(Object.keys(fixture.storage).filter(function (filePath) {
            return /coveo_purchase_snapshot_rens-pets_90d_.*\.csv$/.test(filePath);
        }).length, 1);
    });

    it('does not reuse snapshot metadata whose referenced count file is missing', function () {
        var fixture = createFixture();
        var helper = fixture.helper;

        fixture.storage['/impex/state/coveo_purchase_snapshot_rens-pets_90d.json'] = JSON.stringify({
            trackingId: 'rens-pets',
            windowDays: 90,
            generatedAt: new Date().toISOString(),
            countFile: 'missing-counts.csv'
        });

        assert.isNull(helper.findReusableSharedSnapshot('/state/', 'rens-pets', 90, 60));
    });

    it('loads legacy snapshot metadata that uses the fixed count filename', function () {
        var fixture = createFixture();

        fixture.storage['/impex/state/coveo_purchase_snapshot_rens-pets_90d.json'] = JSON.stringify({
            trackingId: 'rens-pets',
            windowDays: 90,
            fieldName: 'ec_units_sold_90d',
            exportId: 'legacy-export',
            generatedAt: new Date().toISOString()
        });
        fixture.storage['/impex/state/coveo_purchase_snapshot_rens-pets_90d.csv'] = 'productId,unitsSold\nlegacy-sku,7\n';

        var snapshot = fixture.helper.readSharedSnapshot('/state/', 'rens-pets', 90);
        assert.strictEqual(fixture.helper.getMapValue(snapshot.counts, 'legacy-sku'), 7);
    });

    it('restores the previous snapshot pointer when metadata promotion rename fails', function () {
        var fixture = createFixture();
        var helper = fixture.helper;
        var firstCounts = helper.createHashMap();
        var secondCounts = helper.createHashMap();

        helper.putMapValue(firstCounts, 'sku-1', 2);
        helper.writeSharedSnapshot('/state/', 'rens-pets', 90, {
            counts: firstCounts,
            exportId: 'export-1',
            generatedAt: new Date().toISOString()
        });

        var metadataPath = '/impex/state/coveo_purchase_snapshot_rens-pets_90d.json';
        var previousMetadataText = fixture.storage[metadataPath];
        helper.putMapValue(secondCounts, 'sku-2', 3);
        fixture.setFailRenamePattern(/coveo_purchase_snapshot_rens-pets_90d\.json\.tmp->.*coveo_purchase_snapshot_rens-pets_90d\.json$/);

        assert.throws(function () {
            helper.writeSharedSnapshot('/state/', 'rens-pets', 90, {
                counts: secondCounts,
                exportId: 'export-2',
                generatedAt: new Date().toISOString()
            });
        }, /Unable to promote purchase enrichment state file/);
        assert.strictEqual(fixture.storage[metadataPath], previousMetadataText);
    });

    it('rejects overlapping state operations for the same tracking id', function () {
        var fixture = createFixture();
        var helper = fixture.helper;

        fixture.storage['/impex/state/coveo_purchase_state_rens-pets.lock'] = 'another-owner\n';

        assert.throws(function () {
            helper.readSharedSnapshot('/state/', 'rens-pets', 90);
        }, /state operation is already running/);
    });

    it('removes a newly created lock when owner-token setup fails', function () {
        var fixture = createFixture({ failUuid: true });

        assert.throws(function () {
            fixture.helper.readSharedSnapshot('/state/', 'rens-pets', 90);
        }, /simulated UUID failure/);
        assert.notProperty(fixture.storage, '/impex/state/coveo_purchase_state_rens-pets.lock');
    });

    it('allows nested state operations owned by the same execution', function () {
        var fixture = createFixture();

        var result = fixture.helper.withPurchaseStateLock('/state/', 'rens-pets', function () {
            return fixture.helper.readSharedSnapshot('/state/', 'rens-pets', 90);
        });

        assert.isNull(result);
        assert.notProperty(fixture.storage, '/impex/state/coveo_purchase_state_rens-pets.lock');
    });

    it('rolls back the shared snapshot when target-state publication fails', function () {
        var fixture = createFixture();
        var helper = fixture.helper;
        var context = createContext();
        var firstCounts = helper.createHashMap();
        var firstRows = helper.createHashMap();
        var secondCounts = helper.createHashMap();
        var secondRows = helper.createHashMap();
        var skippedRows = helper.createHashMap();

        helper.putMapValue(firstCounts, 'sku-1', 1);
        helper.putMapValue(firstRows, 'sku-1', {
            rootProductId: 'root-1',
            documentId: 'doc-1',
            count: 1
        });
        var firstSnapshot = helper.writeSharedSnapshot('/state/', 'rens-pets', 90, {
            counts: firstCounts,
            exportId: 'export-1',
            generatedAt: new Date().toISOString()
        });
        helper.writeTargetSnapshotState('/state/', context, firstSnapshot, firstRows, skippedRows);

        var metadataPath = '/impex/state/coveo_purchase_snapshot_rens-pets_90d.json';
        var currentPath = '/impex/state/coveo_purchase_target_current_rens-ca_90d.csv';
        var previousMetadataText = fixture.storage[metadataPath];
        var previousCurrentText = fixture.storage[currentPath];

        helper.putMapValue(secondCounts, 'sku-1', 2);
        helper.putMapValue(secondRows, 'sku-1', {
            rootProductId: 'root-1',
            documentId: 'doc-1',
            count: 2
        });
        fixture.setFailWritePattern(/coveo_purchase_target_skipped_rens-ca_90d\.csv\.tmp$/);

        assert.throws(function () {
            helper.publishSharedSnapshotAndTargetState('/state/', context, 90, {
                counts: secondCounts,
                exportId: 'export-2',
                generatedAt: new Date().toISOString()
            }, secondRows, skippedRows);
        }, /simulated file write failure/);

        assert.strictEqual(fixture.storage[metadataPath], previousMetadataText);
        assert.strictEqual(fixture.storage[currentPath], previousCurrentText);
        assert.strictEqual(Object.keys(fixture.storage).filter(function (filePath) {
            return /coveo_purchase_snapshot_rens-pets_90d_.*\.csv$/.test(filePath);
        }).length, 1);
    });

    it('does not advance current target state when report publication fails', function () {
        var fixture = createFixture();
        var helper = fixture.helper;
        var mappedRows = helper.createHashMap();
        var skippedRows = helper.createHashMap();
        var currentPath = '/impex/state/coveo_purchase_target_current_rens-ca_90d.csv';

        fixture.storage[currentPath] = 'productId,rootProductId,documentId,unitsSold\nold,old-root,old-doc,1\n';
        helper.putMapValue(mappedRows, 'new', {
            rootProductId: 'new-root',
            documentId: 'new-doc',
            count: 2
        });
        helper.putMapValue(skippedRows, 'missing', {
            count: 1,
            reason: 'missing-product-mapping'
        });
        fixture.setFailWritePattern(/coveo_purchase_target_skipped_rens-ca_90d\.csv\.tmp$/);

        assert.throws(function () {
            helper.writeTargetSnapshotState('/state/', createContext(), {
                windowDays: 90,
                fieldName: 'ec_units_sold_90d',
                exportId: 'export-2'
            }, mappedRows, skippedRows);
        }, /simulated file write failure/);

        assert.include(fixture.storage[currentPath], 'old-root');
        assert.notInclude(fixture.storage[currentPath], 'new-root');
    });
});
