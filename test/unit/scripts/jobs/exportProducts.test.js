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
});
