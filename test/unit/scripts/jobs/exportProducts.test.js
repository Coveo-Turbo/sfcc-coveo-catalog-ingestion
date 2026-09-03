'use strict';

var path = require('path');
var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();

describe('exportProducts job', function () {
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

    it('uses the first ordering id for deleteolderthan after uploading multiple batches', function () {
        var archivedFiles = [];
        var uploadCalls = [];
        var deleteOlderThanCalls = [];
        var orderingResponses = [
            {
                ok: true,
                object: {
                    orderingId: 101
                }
            },
            {
                ok: true,
                object: {
                    orderingId: 202
                }
            }
        ];
        var sitePreferences = {
            coveoCatalogLastSync: null
        };
        var iteratorClosed = false;

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
                        info: function () {}
                    };
                }
            },
            'dw/system/Site': {
                current: {
                    preferences: {
                        custom: sitePreferences
                    }
                }
            },
            'dw/system/Transaction': {
                wrap: function (callback) {
                    callback();
                }
            },
            '*/cartridge/scripts/helper/coveoHelper': {
                buildProductQuery: function () {
                    return {
                        hasNext: function () {
                            return false;
                        },
                        close: function () {
                            iteratorClosed = true;
                        }
                    };
                },
                writeProductFile: function (sourceFolder, products) {
                    return {
                        path: sourceFolder + products.length + '.json',
                        remove: function () {},
                        name: 'feed.json'
                    };
                },
                archiveFeedFile: function (parameters, file) { // eslint-disable-line no-unused-vars
                    archivedFiles.push(file.path);
                }
            },
            '*/cartridge/scripts/generators/productRequestGenerator': {
                processProducts: function () {
                    return [];
                }
            },
            '*/cartridge/scripts/helper/purchaseMetricHelper': {
                DEFAULT_STATE_PATH: '/src/coveo/state/purchase-enrichment/',
                attachSnapshotsToExportContext: function () { return []; },
                ensureMetricFields: function () {},
                markFullExportApplied: function () {}
            },
            '*/cartridge/scripts/helper/catalogExportStateHelper': {
                isManifestEnabled: function () { return false; }
            },
            '*/cartridge/scripts/helper/exportTargetHelper': {
                resolveExportContext: function () {
                    return {
                        legacyMode: true,
                        siteId: 'RefArch',
                        locale: 'en_CA',
                        language: 'en',
                        coveoSourceId: 'source-id'
                    };
                },
                applyRequestLocale: function () {
                    return '';
                },
                restoreRequestLocale: function () {},
                updateLastSync: function () {
                    sitePreferences.coveoCatalogLastSync = new Date();
                }
            },
            '*/cartridge/scripts/helper/streamHelper': {
                createFileContainer: function () {
                    return {
                        ok: true,
                        object: {
                            uploadUri: 'https://upload.example.com',
                            requiredHeaders: {
                                'x-amz-meta': 'value'
                            },
                            fileId: 'file-1'
                        }
                    };
                },
                uploadStreamService: function (file, uploadUri, requiredHeaders) {
                    uploadCalls.push({
                        file: file.path,
                        uploadUri: uploadUri,
                        requiredHeaders: requiredHeaders
                    });

                    return {
                        ok: true,
                        object: {}
                    };
                },
                sendFileContainer: function () {
                    return orderingResponses.shift();
                },
                deleteOlderThan: function (orderingId) {
                    deleteOlderThanCalls.push(orderingId);
                    return {
                        ok: true,
                        object: {}
                    };
                }
            }
        });

        var parameters = {
            get: function (name) {
                var values = {
                    srcFolder: '/src/coveo/feeds/products/',
                    archivePath: '/src/coveo/feeds/products/archive',
                    deleteFile: false
                };

                return values[name];
            }
        };

        job.beforeStep(parameters);
        job.write([[{ red: { id: 'red' } }, { blue: { id: 'blue' } }]]);
        job.afterChunk(null, parameters);
        job.write([[{ green: { id: 'green' } }]]);
        job.afterChunk(null, parameters);
        job.afterStep(true, parameters);

        assert.lengthOf(uploadCalls, 2);
        assert.deepEqual(deleteOlderThanCalls, [101]);
        assert.lengthOf(archivedFiles, 2);
        assert.instanceOf(sitePreferences.coveoCatalogLastSync, Date);
        assert.isTrue(iteratorClosed);
    });

    it('includes service failure details when file container creation fails', function () {
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
                        info: function () {},
                        error: function () {}
                    };
                }
            },
            'dw/system/Site': {
                current: {
                    preferences: {
                        custom: {
                            coveoCatalogLastSync: null
                        }
                    }
                }
            },
            'dw/system/Transaction': {
                wrap: function (callback) {
                    callback();
                }
            },
            '*/cartridge/scripts/helper/coveoHelper': {
                buildProductQuery: function () {
                    return {
                        hasNext: function () {
                            return false;
                        },
                        close: function () {}
                    };
                },
                writeProductFile: function () {
                    return {
                        path: '/tmp/feed.json',
                        remove: function () {},
                        name: 'feed.json'
                    };
                },
                archiveFeedFile: function () {}
            },
            '*/cartridge/scripts/generators/productRequestGenerator': {
                processProducts: function () {
                    return [];
                }
            },
            '*/cartridge/scripts/helper/purchaseMetricHelper': {
                DEFAULT_STATE_PATH: '/src/coveo/state/purchase-enrichment/',
                attachSnapshotsToExportContext: function () { return []; },
                ensureMetricFields: function () {},
                markFullExportApplied: function () {}
            },
            '*/cartridge/scripts/helper/catalogExportStateHelper': {
                isManifestEnabled: function () { return false; }
            },
            '*/cartridge/scripts/helper/exportTargetHelper': {
                resolveExportContext: function () {
                    return {
                        legacyMode: true,
                        siteId: 'RefArch',
                        locale: 'en_CA',
                        language: 'en',
                        coveoSourceId: 'source-id'
                    };
                },
                applyRequestLocale: function () {
                    return '';
                },
                restoreRequestLocale: function () {},
                updateLastSync: function () {}
            },
            '*/cartridge/scripts/helper/streamHelper': {
                createFileContainer: function () {
                    return {
                        ok: false,
                        status: 'ERROR_RESPONSE',
                        errorMessage: '401 Unauthorized'
                    };
                }
            }
        });

        var parameters = {
            get: function (name) {
                var values = {
                    srcFolder: '/src/coveo/feeds/products/',
                    archivePath: '/src/coveo/feeds/products/archive',
                    deleteFile: false
                };

                return values[name];
            }
        };

        job.beforeStep(parameters);
        job.write([[{ red: { id: 'red' } }]]);

        assert.throws(function () {
            job.afterChunk(null, parameters);
        }, /401 Unauthorized/);
    });

    it('retries transient file upload failures before failing the chunk', function () {
        var uploadAttempts = 0;
        var deleteOlderThanCalls = [];
        var sitePreferences = {
            coveoCatalogLastSync: null
        };

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
                        info: function () {},
                        error: function () {}
                    };
                }
            },
            'dw/system/Site': {
                current: {
                    preferences: {
                        custom: sitePreferences
                    }
                }
            },
            'dw/system/Transaction': {
                wrap: function (callback) {
                    callback();
                }
            },
            '*/cartridge/scripts/helper/coveoHelper': {
                buildProductQuery: function () {
                    return {
                        hasNext: function () {
                            return false;
                        },
                        close: function () {}
                    };
                },
                writeProductFile: function () {
                    return {
                        path: '/tmp/feed.json',
                        remove: function () {},
                        name: 'feed.json'
                    };
                },
                archiveFeedFile: function () {}
            },
            '*/cartridge/scripts/generators/productRequestGenerator': {
                processProducts: function () {
                    return [];
                }
            },
            '*/cartridge/scripts/helper/purchaseMetricHelper': {
                DEFAULT_STATE_PATH: '/src/coveo/state/purchase-enrichment/',
                attachSnapshotsToExportContext: function () { return []; },
                ensureMetricFields: function () {},
                markFullExportApplied: function () {}
            },
            '*/cartridge/scripts/helper/catalogExportStateHelper': {
                isManifestEnabled: function () { return false; }
            },
            '*/cartridge/scripts/helper/exportTargetHelper': {
                resolveExportContext: function () {
                    return {
                        legacyMode: true,
                        siteId: 'RefArch',
                        locale: 'en_CA',
                        language: 'en',
                        coveoSourceId: 'source-id'
                    };
                },
                applyRequestLocale: function () {
                    return '';
                },
                restoreRequestLocale: function () {},
                updateLastSync: function () {
                    sitePreferences.coveoCatalogLastSync = new Date();
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
                    uploadAttempts += 1;

                    if (uploadAttempts === 1) {
                        return {
                            ok: false,
                            status: 'ERROR',
                            error: 0,
                            errorMessage: 'NoHttpResponseException:s3.ca-central-1.amazonaws.com:443 failed to respond',
                            msg: 's3.ca-central-1.amazonaws.com:443 failed to respond'
                        };
                    }

                    return {
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
                },
                deleteOlderThan: function (orderingId) {
                    deleteOlderThanCalls.push(orderingId);
                    return {
                        ok: true,
                        object: {}
                    };
                }
            }
        });

        var parameters = {
            get: function (name) {
                var values = {
                    srcFolder: '/src/coveo/feeds/products/',
                    archivePath: '',
                    deleteFile: true
                };

                return values[name];
            }
        };

        job.beforeStep(parameters);
        job.write([[{ red: { id: 'red' } }]]);
        job.afterChunk(null, parameters);
        job.afterStep(true, parameters);

        assert.strictEqual(uploadAttempts, 2);
        assert.deepEqual(deleteOlderThanCalls, [101]);
        assert.instanceOf(sitePreferences.coveoCatalogLastSync, Date);
    });

    it('does not retry uploads in afterStep when a previous chunk failed', function () {
        var uploadAttempts = 0;

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
                        info: function () {},
                        error: function () {}
                    };
                }
            },
            'dw/system/Site': {
                current: {
                    preferences: {
                        custom: {
                            coveoCatalogLastSync: null
                        }
                    }
                }
            },
            'dw/system/Transaction': {
                wrap: function (callback) {
                    callback();
                }
            },
            '*/cartridge/scripts/helper/coveoHelper': {
                buildProductQuery: function () {
                    return {
                        hasNext: function () {
                            return false;
                        },
                        close: function () {}
                    };
                },
                writeProductFile: function () {
                    uploadAttempts += 1;
                    return {
                        path: '/tmp/feed.json',
                        remove: function () {},
                        name: 'feed.json'
                    };
                },
                archiveFeedFile: function () {}
            },
            '*/cartridge/scripts/generators/productRequestGenerator': {
                processProducts: function () {
                    return [];
                }
            },
            '*/cartridge/scripts/helper/purchaseMetricHelper': {
                DEFAULT_STATE_PATH: '/src/coveo/state/purchase-enrichment/',
                attachSnapshotsToExportContext: function () { return []; },
                ensureMetricFields: function () {},
                markFullExportApplied: function () {}
            },
            '*/cartridge/scripts/helper/catalogExportStateHelper': {
                isManifestEnabled: function () { return false; }
            },
            '*/cartridge/scripts/helper/exportTargetHelper': {
                resolveExportContext: function () {
                    return {
                        legacyMode: true,
                        siteId: 'RefArch',
                        locale: 'en_CA',
                        language: 'en',
                        coveoSourceId: 'source-id'
                    };
                },
                applyRequestLocale: function () {
                    return '';
                },
                restoreRequestLocale: function () {},
                updateLastSync: function () {}
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
                    return {
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
                },
                deleteOlderThan: function () {
                    return {
                        ok: true,
                        object: {}
                    };
                }
            }
        });

        var parameters = {
            get: function (name) {
                var values = {
                    srcFolder: '/src/coveo/feeds/products/',
                    archivePath: '/src/coveo/feeds/products/archive',
                    deleteFile: false
                };

                return values[name];
            }
        };

        job.beforeStep(parameters);
        job.write([[{ red: { id: 'red' } }]]);
        job.afterStep(false, parameters);

        assert.strictEqual(uploadAttempts, 0);
    });
});
