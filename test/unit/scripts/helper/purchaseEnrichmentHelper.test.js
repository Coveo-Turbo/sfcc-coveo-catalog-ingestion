'use strict';

var path = require('path');
var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();

function createArrayIterator(values) {
    var index = 0;

    return {
        hasNext: function () {
            return index < values.length;
        },
        next: function () {
            return values[index++];
        },
        close: function () {}
    };
}

function getSortedMapValues(map) {
    return Object.keys(map).map(function (key) {
        return map[key];
    }).sort(function (left, right) {
        return left.productId < right.productId ? -1 : (left.productId > right.productId ? 1 : 0);
    });
}

function createFileStubs(storage) {
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

    function getNormalizedPath(fullPath) {
        return String(fullPath).replace(/\/+/g, '/');
    }

    function File(fullPath) {
        this.fullPath = getNormalizedPath(fullPath);
        this.path = this.fullPath;
        this.name = this.fullPath.split('/').pop();
    }

    File.IMPEX = '/impex';
    File.SEPARATOR = '/';
    File.prototype.exists = function () {
        return Object.prototype.hasOwnProperty.call(storage, this.fullPath);
    };
    File.prototype.mkdirs = function () {};
    File.prototype.remove = function () {
        delete storage[this.fullPath];
        return true;
    };
    File.prototype.renameTo = function (targetFile) {
        storage[targetFile.fullPath] = storage[this.fullPath];
        delete storage[this.fullPath];
        return true;
    };
    File.prototype.getName = function () {
        return this.name;
    };

    function FileReader(file) {
        this.file = file;
    }

    FileReader.prototype.getString = function () {
        var contents = storage[this.file.fullPath] || '';

        if (contents.length > 1000) {
            throw new Error('getString quota exceeded');
        }

        return contents;
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

    function FileWriter(file) {
        this.file = file;
        storage[this.file.fullPath] = '';
    }

    FileWriter.prototype.write = function (value) {
        storage[this.file.fullPath] += String(value);
    };
    FileWriter.prototype.flush = function () {};
    FileWriter.prototype.close = function () {};

    return {
        File: File,
        CSVStreamReader: CSVStreamReader,
        FileReader: FileReader,
        FileWriter: FileWriter
    };
}

function createPurchaseMetricStub(captured) {
    return {
        createHashMap: function () {
            return {};
        },
        putMapValue: function (map, key, value) {
            map[key] = value;
        },
        getMapValue: function (map, key) {
            return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
        },
        containsMapKey: function (map, key) {
            return Object.prototype.hasOwnProperty.call(map, key);
        },
        getMapSize: function (map) {
            return Object.keys(map).length;
        },
        iterateMap: function (map, callback) {
            Object.keys(map).forEach(function (key) {
                callback(key, map[key]);
            });
        },
        parsePositiveInteger: function (value, label, defaultValue) {
            var normalizedValue = value === null || value === undefined ? '' : String(value).trim();
            var parsed = normalizedValue === '' ? defaultValue : parseInt(normalizedValue, 10);

            if (isNaN(parsed) || parsed <= 0) {
                throw new Error('The Coveo purchase enrichment parameter ' + label + ' must be a positive integer.');
            }

            return parsed;
        },
        buildUnitsSoldFieldName: function (windowDays) {
            return 'ec_units_sold_' + windowDays + 'd';
        },
        findReusableSharedSnapshot: function (statePath, trackingId, windowDays) { // eslint-disable-line no-unused-vars
            return captured.reusableSnapshot || null;
        },
        readSharedSnapshot: function () {
            return captured.reusableSnapshot;
        },
        withPurchaseStateLock: function (statePath, trackingId, callback) { // eslint-disable-line no-unused-vars
            return callback();
        },
        writeSharedSnapshot: function (statePath, trackingId, windowDays, snapshot) { // eslint-disable-line no-unused-vars
            captured.sharedSnapshotWrites.push({
                statePath: statePath,
                trackingId: trackingId,
                windowDays: windowDays,
                snapshot: snapshot
            });

            return {
                trackingId: trackingId,
                windowDays: windowDays,
                fieldName: 'ec_units_sold_' + windowDays + 'd',
                exportId: snapshot.exportId,
                processedRows: snapshot.processedRows,
                invalidQuantityRows: snapshot.invalidQuantityRows,
                blankProductRows: snapshot.blankProductRows,
                counts: snapshot.counts
            };
        },
        writeTargetSnapshotState: function (statePath, exportContext, snapshot, mappedRows, skippedRows) {
            captured.targetStateWrites.push({
                statePath: statePath,
                exportContext: exportContext,
                snapshot: snapshot,
                mappedRows: mappedRows,
                skippedRows: skippedRows
            });
        },
        publishSharedSnapshotAndTargetState: function (statePath, exportContext, windowDays, snapshot, mappedRows, skippedRows) {
            captured.sharedSnapshotWrites.push({
                statePath: statePath,
                trackingId: exportContext.coveoTrackingId,
                windowDays: windowDays,
                snapshot: snapshot
            });
            captured.targetStateWrites.push({
                statePath: statePath,
                exportContext: exportContext,
                snapshot: snapshot,
                mappedRows: mappedRows,
                skippedRows: skippedRows
            });

            return snapshot;
        }
    };
}

function createHelper(options) {
    var usageAnalyticsCalls = [];
    var sleepCalls = [];
    var httpClientCalls = [];
    var storage = options && options.storage ? options.storage : {};
    var fileStubs = createFileStubs(storage);
    var captured = {
        reusableSnapshot: options && options.reusableSnapshot ? options.reusableSnapshot : null,
        sharedSnapshotWrites: [],
        targetStateWrites: [],
        usageAnalyticsCalls: usageAnalyticsCalls,
        httpClientCalls: httpClientCalls,
        storage: storage,
        sleepCalls: sleepCalls
    };

    function HTTPClient() {
        this.statusCode = 200;
        this.statusMessage = 'OK';
        this.text = '';
        this.errorText = '';
        this.allowRedirect = true;
        this.headers = {};
        this.url = '';
    }

    HTTPClient.prototype.setTimeout = function () {};
    HTTPClient.prototype.setAllowRedirect = function (allowRedirect) {
        this.allowRedirect = allowRedirect;
    };
    HTTPClient.prototype.open = function (method, url) {
        this.method = method;
        this.url = url;
    };
    HTTPClient.prototype.setRequestHeader = function (name, value) {
        this.headers[name] = value;
    };
    HTTPClient.prototype.getResponseHeader = function (name) {
        return this.responseHeaders && this.responseHeaders[name] ? this.responseHeaders[name] : null;
    };
    HTTPClient.prototype.send = function () {
        var call = {
            method: this.method,
            url: this.url,
            headers: this.headers,
            allowRedirect: this.allowRedirect
        };
        var response = options && typeof options.handleHttpClientCall === 'function'
            ? options.handleHttpClientCall(call)
            : {statusCode: 200, statusMessage: 'OK', text: ''};

        httpClientCalls.push(call);
        this.statusCode = response.statusCode;
        this.statusMessage = response.statusMessage || 'OK';
        this.text = response.text || '';
        this.errorText = response.errorText || '';
        this.responseHeaders = response.responseHeaders || {};
    };
    HTTPClient.prototype.sendAndReceiveToFile = function (file) {
        var call = {
            method: this.method,
            url: this.url,
            headers: this.headers,
            allowRedirect: this.allowRedirect,
            outputFile: file.fullPath
        };
        var response = options && typeof options.handleHttpClientCall === 'function'
            ? options.handleHttpClientCall(call)
            : {statusCode: 200, statusMessage: 'OK', fileContents: ''};

        httpClientCalls.push(call);
        this.statusCode = response.statusCode;
        this.statusMessage = response.statusMessage || 'OK';
        this.text = response.text || '';
        this.errorText = response.errorText || '';
        this.responseHeaders = response.responseHeaders || {};
        storage[file.fullPath] = response.fileContents || '';
        return this.statusCode >= 200 && this.statusCode < 300;
    };

    global.__purchaseEnrichmentSleep = function (milliseconds) {
        sleepCalls.push(milliseconds);
    };

    var helper = proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/helper/purchaseEnrichmentHelper'), {
        'dw/io/File': fileStubs.File,
        'dw/io/CSVStreamReader': fileStubs.CSVStreamReader,
        'dw/io/FileReader': fileStubs.FileReader,
        'dw/io/FileWriter': fileStubs.FileWriter,
        'dw/system/Logger': {
            getLogger: function () {
                return {
                    info: function () {},
                    error: function () {},
                    warn: function () {}
                };
            }
        },
        'dw/net/HTTPClient': HTTPClient,
        '*/cartridge/scripts/utils/coveoConstant': {
            COVEO_HTTP_METHOD: {
                GET: 'GET',
                POST: 'POST',
                PUT: 'PUT'
            }
        },
        '*/cartridge/scripts/helper/coveoHelper': options && options.coveoHelper ? options.coveoHelper : {
            buildProductQuery: function () {
                return createArrayIterator([]);
            }
        },
        '*/cartridge/scripts/helper/exportTargetHelper': options && options.exportTargetHelper ? options.exportTargetHelper : {
            CATALOG_STRUCTURE_MODE_PRODUCT_ONLY: 'product_only',
            getTargetsForCurrentSite: function () {
                return [{
                    custom: {
                        targetId: 'target-1',
                        coveoTrackingId: 'tracking-1'
                    }
                }];
            },
            normalizeCatalogStructureMode: function (value) {
                return value ? String(value).trim().toLowerCase() : 'product_only';
            }
        },
        '*/cartridge/scripts/helper/purchaseMetricHelper': createPurchaseMetricStub(captured),
        '*/cartridge/scripts/generators/productRequestGenerator': options && options.productRequestGenerator ? options.productRequestGenerator : {
            processProducts: function () {
                return [];
            }
        },
        '*/cartridge/scripts/services/usageAnalyticsService': options && options.usageAnalyticsService ? options.usageAnalyticsService : {
            getUsageAnalyticsAccessToken: function () {
                return 'ua-access-token';
            },
            createUsageAnalyticsRequest: function (method, endpoint, headers) {
                var call = {
                    method: method,
                    endpoint: endpoint,
                    headers: headers
                };

                usageAnalyticsCalls.push(call);

                return {
                    call: function (payload) {
                        call.payload = payload;

                        if (options && typeof options.handleUsageAnalyticsCall === 'function') {
                            return options.handleUsageAnalyticsCall(call);
                        }

                        return {
                            ok: true,
                            object: {}
                        };
                    }
                };
            }
        }
    });

    helper.__getCaptured = function () {
        return captured;
    };

    return helper;
}

describe('purchaseEnrichmentHelper', function () {
    afterEach(function () {
        delete global.__purchaseEnrichmentSleep;
    });

    it('builds the purchase export request with rolling window filters and dimensions', function () {
        var helper = createHelper({
            handleUsageAnalyticsCall: function () {
                return {
                    ok: true,
                    object: {
                        id: 'export-1',
                        status: 'PENDING'
                    }
                };
            }
        });
        var exportContext = {
            coveoOrganizationId: 'my-org',
            coveoTrackingId: 'tracking-1',
            targetId: 'target-1'
        };
        var result = helper.createPurchaseExport(exportContext, {
            windowDays: 90,
            quantityDimension: 'custom_events.pr1qt'
        });
        var request = helper.__getCaptured().usageAnalyticsCalls[0];

        assert.strictEqual(result.id, 'export-1');
        assert.strictEqual(request.method, 'POST');
        assert.strictEqual(request.endpoint, 'v15/exports/create?org=my-org');
        assert.deepEqual(request.payload.dimensions, [
            'custom_events.c_contentidvalue',
            'custom_events.pr1qt'
        ]);
        assert.deepEqual(request.payload.commonFilters, [
            "trackingId=='tracking-1'"
        ]);
    });

    it('aggregates quantities while accepting stripped custom_events CSV headers', function () {
        var helper = createHelper();
        var aggregated = helper.aggregatePurchaseCounts([
            'c_contentidvalue,c_quantity',
            'sku-1,2',
            'sku-1,3',
            'sku-2,1',
            ',4',
            'sku-3,'
        ].join('\n'), 'custom_events.c_quantity');

        assert.strictEqual(aggregated.processedRows, 3);
        assert.strictEqual(aggregated.blankProductRows, 1);
        assert.strictEqual(aggregated.invalidQuantityRows, 1);
        assert.strictEqual(aggregated.counts['sku-1'], 5);
        assert.strictEqual(aggregated.counts['sku-2'], 1);
    });

    it('aggregates large exports without requiring the entire CSV to be buffered as rows', function () {
        var helper = createHelper();
        var lines = ['c_contentidvalue,c_quantity'];
        var index;
        var aggregated;

        for (index = 0; index < 20000; index += 1) {
            lines.push('bulk-' + index + ',1');
        }

        aggregated = helper.aggregatePurchaseCounts(lines.join('\n'), 'custom_events.c_quantity');

        assert.strictEqual(aggregated.processedRows, 20000);
        assert.strictEqual(aggregated.counts['bulk-0'], 1);
        assert.strictEqual(aggregated.counts['bulk-19999'], 1);
    });

    it('streams SFCC Java String[] rows through a large downloaded export and complete synchronization flow', function () {
        var csv = 'custom_events.c_contentidvalue,custom_events.c_quantity\n';
        var index;

        for (index = 0; index < 25000; index += 1) {
            csv += 'simple-1,1\n';
        }

        var helper = createHelper({
            coveoHelper: {
                buildProductQuery: function () {
                    return createArrayIterator(['root-simple']);
                }
            },
            productRequestGenerator: {
                processProducts: function () {
                    return [{
                        objecttype: 'Product',
                        ec_product_id: 'simple-1',
                        documentId: 'https://example.com/product/simple-1'
                    }];
                }
            },
            handleUsageAnalyticsCall: function () {
                return {
                    ok: true,
                    object: {
                        id: 'export-large',
                        status: 'AVAILABLE',
                        downloadLink: 'https://download.example.com/large.csv'
                    }
                };
            },
            handleHttpClientCall: function () {
                return {
                    statusCode: 200,
                    statusMessage: 'OK',
                    fileContents: csv
                };
            }
        });

        var summary = helper.syncPurchaseEnrichment({
            get: function (name) {
                return {
                    windowDays: '90',
                    workingPath: '/working/purchase-enrichment/',
                    statePath: '/state/purchase-enrichment/',
                    quantityDimension: 'custom_events.c_quantity'
                }[name];
            }
        }, {
            legacyMode: false,
            targetId: 'target-1',
            locale: 'en_CA',
            coveoTrackingId: 'tracking-1',
            coveoOrganizationId: 'my-org',
            coveoSourceId: 'source-1'
        });
        var captured = helper.__getCaptured();

        assert.strictEqual(summary.processedRows, 25000);
        assert.strictEqual(summary.mappedProducts, 1);
        assert.strictEqual(captured.sharedSnapshotWrites[0].snapshot.counts['simple-1'], 25000);
        assert.strictEqual(Object.keys(captured.storage).filter(function (filePath) {
            return filePath.indexOf('coveo_purchase_enrichment_download_') !== -1;
        }).length, 0);
    });

    it('builds product document rows only for current Product items', function () {
        var helper = createHelper({
            coveoHelper: {
                buildProductQuery: function () {
                    return createArrayIterator(['root-simple', 'root-grouped']);
                }
            },
            productRequestGenerator: {
                processProducts: function (productId) {
                    if (productId === 'root-simple') {
                        return [{
                            objecttype: 'Product',
                            ec_product_id: 'simple-1',
                            documentId: 'https://example.com/product/simple-1'
                        }];
                    }

                    return [{
                        objecttype: 'Product',
                        ec_product_id: 'master-red',
                        documentId: 'https://example.com/product/master-red'
                    }, {
                        objecttype: 'Variant',
                        ec_product_id: 'master-red',
                        documentId: 'https://example.com/product/sku-red-1'
                    }];
                }
            }
        });
        var counts = {
            'simple-1': 2,
            'master-red': 5,
            'missing-product': 1
        };
        var required = helper.buildRequiredProductIds(counts);
        var rows = helper.buildProductDocumentRows({
            catalogId: 'catalog-1',
            catalogStructureMode: 'product_variant'
        }, required, counts);

        assert.deepEqual(getSortedMapValues(rows.mappedRows), [{
            productId: 'master-red',
            rootProductId: 'root-grouped',
            documentId: 'https://example.com/product/master-red',
            count: 5
        }, {
            productId: 'simple-1',
            rootProductId: 'root-simple',
            documentId: 'https://example.com/product/simple-1',
            count: 2
        }]);
        assert.deepEqual(getSortedMapValues(rows.skippedRows), [{
            productId: 'missing-product',
            count: 1,
            reason: 'missing-product-mapping'
        }]);
    });

    it('does not open a catalog iterator when the export contains no purchased product ids', function () {
        var queryOpened = false;
        var helper = createHelper({
            coveoHelper: {
                buildProductQuery: function () {
                    queryOpened = true;
                    return createArrayIterator([]);
                }
            }
        });
        var counts = {};
        var rows = helper.buildProductDocumentRows({}, helper.buildRequiredProductIds(counts), counts);

        assert.isFalse(queryOpened);
        assert.strictEqual(rows.mappedCount, 0);
        assert.strictEqual(rows.skippedCount, 0);
    });

    it('maps variant ids and product-id suffix aliases back to the parent product document', function () {
        var helper = createHelper({
            coveoHelper: {
                buildProductQuery: function () {
                    return createArrayIterator(['root-grouped', 'root-suffixed']);
                }
            },
            productRequestGenerator: {
                processProducts: function (productId) {
                    if (productId === 'root-grouped') {
                        return [{
                            objecttype: 'Product',
                            ec_product_id: 'master-red',
                            documentId: 'https://example.com/product/master-red'
                        }, {
                            objecttype: 'Variant',
                            ec_product_id: 'master-red',
                            ec_variant_id: '1000879',
                            permanentid: '1000879',
                            documentId: 'https://example.com/product/s1000879'
                        }];
                    }

                    return [{
                        objecttype: 'Product',
                        ec_product_id: 'group-1234-2000999',
                        documentId: 'https://example.com/product/group-1234-2000999'
                    }];
                }
            }
        });
        var counts = {
            '1000879': 7,
            '2000999': 3
        };
        var required = helper.buildRequiredProductIds(counts);
        var rows = helper.buildProductDocumentRows({
            catalogId: 'catalog-1',
            catalogStructureMode: 'product_variant'
        }, required, counts);

        assert.deepEqual(getSortedMapValues(rows.mappedRows), [{
            productId: '1000879',
            rootProductId: 'root-grouped',
            documentId: 'https://example.com/product/master-red',
            count: 7
        }, {
            productId: '2000999',
            rootProductId: 'root-suffixed',
            documentId: 'https://example.com/product/group-1234-2000999',
            count: 3
        }]);
        assert.deepEqual(getSortedMapValues(rows.skippedRows), []);
    });

    it('maps SKU-based product_only rows directly to their own product documents', function () {
        var helper = createHelper({
            coveoHelper: {
                buildProductQuery: function () {
                    return createArrayIterator(['root-product-only']);
                }
            },
            productRequestGenerator: {
                processProducts: function () {
                    return [{
                        objecttype: 'Product',
                        ec_product_id: 'SKU-1',
                        ec_sku: 'SKU-1',
                        ec_item_group_id: 'MASTER-1',
                        documentId: 'https://example.com/product/SKU-1'
                    }, {
                        objecttype: 'Product',
                        ec_product_id: 'SKU-2',
                        ec_sku: 'SKU-2',
                        ec_item_group_id: 'MASTER-1',
                        documentId: 'https://example.com/product/SKU-2'
                    }];
                }
            }
        });
        var counts = {
            'SKU-1': 4,
            'SKU-2': 1
        };
        var required = helper.buildRequiredProductIds(counts);
        var rows = helper.buildProductDocumentRows({
            catalogId: 'catalog-1',
            catalogStructureMode: 'product_only'
        }, required, counts);

        assert.deepEqual(getSortedMapValues(rows.mappedRows), [{
            productId: 'SKU-1',
            rootProductId: 'root-product-only',
            documentId: 'https://example.com/product/SKU-1',
            count: 4
        }, {
            productId: 'SKU-2',
            rootProductId: 'root-product-only',
            documentId: 'https://example.com/product/SKU-2',
            count: 1
        }]);
        assert.deepEqual(getSortedMapValues(rows.skippedRows), []);
    });

    it('creates a shared snapshot and writes target state when no reusable snapshot exists', function () {
        var helper = createHelper({
            coveoHelper: {
                buildProductQuery: function () {
                    return createArrayIterator(['root-simple']);
                }
            },
            productRequestGenerator: {
                processProducts: function () {
                    return [{
                        objecttype: 'Product',
                        ec_product_id: 'simple-1',
                        documentId: 'https://example.com/product/simple-1'
                    }];
                }
            },
            handleUsageAnalyticsCall: function (call) {
                if (call.method === 'POST') {
                    return {
                        ok: true,
                        object: {
                            id: 'export-1',
                            status: 'PENDING'
                        }
                    };
                }

                return {
                    ok: true,
                    object: {
                        id: 'export-1',
                        status: 'AVAILABLE',
                        downloadLink: 'https://download.example.com/export.csv'
                    }
                };
            },
            handleHttpClientCall: function (call) {
                if (call.url === 'https://download.example.com/export.csv') {
                    return {
                        statusCode: 302,
                        statusMessage: 'Found',
                        responseHeaders: {
                            Location: 'https://signed.example.com/export.csv'
                        }
                    };
                }

                return {
                    statusCode: 200,
                    statusMessage: 'OK',
                    fileContents: [
                        'custom_events.c_contentidvalue,custom_events.c_quantity',
                        'simple-1,2',
                        'missing-product,1'
                    ].join('\n')
                };
            }
        });
        var summary = helper.syncPurchaseEnrichment({
            get: function (name) {
                return {
                    windowDays: '90',
                    workingPath: '/working/purchase-enrichment/',
                    statePath: '/state/purchase-enrichment/',
                    quantityDimension: 'custom_events.c_quantity'
                }[name];
            }
        }, {
            legacyMode: false,
            targetId: 'target-1',
            locale: 'en_CA',
            coveoTrackingId: 'tracking-1',
            coveoOrganizationId: 'my-org',
            coveoSourceId: 'source-1'
        });
        var captured = helper.__getCaptured();

        assert.strictEqual(summary.exportId, 'export-1');
        assert.strictEqual(summary.fieldName, 'ec_units_sold_90d');
        assert.strictEqual(summary.mappedProducts, 1);
        assert.strictEqual(summary.skippedProducts, 1);
        assert.isFalse(summary.snapshotReused);
        assert.lengthOf(captured.sharedSnapshotWrites, 1);
        assert.lengthOf(captured.targetStateWrites, 1);
        assert.strictEqual(captured.httpClientCalls[0].headers.Authorization, 'Bearer ua-access-token');
        assert.isUndefined(captured.httpClientCalls[1].headers.Authorization);
    });

    it('removes a partial temporary file when a redirected download fails', function () {
        var helper = createHelper({
            handleHttpClientCall: function (call) {
                if (call.url === 'https://download.example.com/export.csv') {
                    return {
                        statusCode: 302,
                        responseHeaders: {
                            Location: 'https://signed.example.com/export.csv'
                        }
                    };
                }

                return {
                    statusCode: 503,
                    statusMessage: 'Unavailable',
                    fileContents: 'partial'
                };
            }
        });

        assert.throws(function () {
            helper.downloadExportFile('https://download.example.com/export.csv', {
                targetId: 'target-1'
            }, '/working/purchase-enrichment/');
        }, /redirected Usage Analytics export download failed/);
        assert.strictEqual(Object.keys(helper.__getCaptured().storage).filter(function (filePath) {
            return filePath.indexOf('coveo_purchase_enrichment_download_') !== -1;
        }).length, 0);
    });

    it('reuses a recent shared snapshot without creating a new export', function () {
        var helper = createHelper({
            reusableSnapshot: {
                fieldName: 'ec_units_sold_90d',
                exportId: 'export-reused',
                processedRows: 10,
                invalidQuantityRows: 0,
                blankProductRows: 0,
                counts: {
                    'simple-1': 4
                }
            },
            coveoHelper: {
                buildProductQuery: function () {
                    return createArrayIterator(['root-simple']);
                }
            },
            productRequestGenerator: {
                processProducts: function () {
                    return [{
                        objecttype: 'Product',
                        ec_product_id: 'simple-1',
                        documentId: 'https://example.com/product/simple-1'
                    }];
                }
            }
        });
        var summary = helper.syncPurchaseEnrichment({
            get: function (name) {
                return {
                    windowDays: '90',
                    workingPath: '/working/purchase-enrichment/',
                    statePath: '/state/purchase-enrichment/',
                    quantityDimension: 'custom_events.c_quantity'
                }[name];
            }
        }, {
            legacyMode: false,
            targetId: 'target-1',
            locale: 'en_CA',
            coveoTrackingId: 'tracking-1',
            coveoOrganizationId: 'my-org',
            coveoSourceId: 'source-1'
        });

        assert.strictEqual(summary.exportId, 'export-reused');
        assert.isTrue(summary.snapshotReused);
        assert.lengthOf(helper.__getCaptured().usageAnalyticsCalls, 0);
    });
});
