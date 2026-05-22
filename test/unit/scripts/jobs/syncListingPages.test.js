'use strict';

var path = require('path');
var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();

function createStatus() {
    function Status(code) {
        this.code = code;
    }

    Status.OK = 'OK';
    Status.ERROR = 'ERROR';

    return Status;
}

function createListingPages(count, prefix) {
    var listingPages = [];
    var index = 0;

    for (index = 0; index < count; index += 1) {
        listingPages.push({
            name: prefix + index,
            patterns: [{
                url: 'https://www.mondou.com/' + prefix + index
            }],
            pageRules: [],
            trackingId: 'mondou_ca'
        });
    }

    return listingPages;
}

function createParameters(values) {
    return {
        get: function (name) {
            return values[name];
        }
    };
}

describe('syncListingPages job', function () {
    var exportContext;

    beforeEach(function () {
        global.empty = function (value) {
            return value === null
                || value === undefined
                || value === ''
                || (Array.isArray(value) && value.length === 0);
        };
        exportContext = {
            targetId: 'en-ca',
            siteId: 'Mondou',
            locale: 'en_CA',
            language: 'en',
            coveoOrganizationId: 'mondouorg',
            coveoTrackingId: 'mondou_ca',
            coveoCountry: 'CA',
            coveoCurrency: 'CAD',
            storefrontBaseUrl: 'https://www.mondou.com',
            listingCategoryUrlTemplate: '/{categorySlugPath}',
            listingBrandUrlTemplate: '/brands/{brandSlug}'
        };
    });

    afterEach(function () {
        delete global.empty;
    });

    it('bulk creates and updates listing pages in 100-item chunks, then re-reads for verification', function () {
        var createChunks = [];
        var updateChunks = [];
        var readCalls = 0;
        var verifyCall = null;
        var creates = createListingPages(205, 'create-');
        var updates = createListingPages(1, 'update-');
        var desired = creates.concat(updates);

        var job = proxyquire(path.resolve(__dirname, '../../../../cartridges/bm_coveo/cartridge/scripts/jobs/syncListingPages'), {
            'dw/system/Logger': {
                getLogger: function () {
                    return {
                        info: function () {},
                        error: function () {}
                    };
                }
            },
            'dw/system/Status': createStatus(),
            '*/cartridge/scripts/helper/exportTargetHelper': {
                resolveListingSyncGroups: function () {
                    return [{
                        trackingId: 'mondou_ca',
                        primaryContext: exportContext,
                        exportContexts: [
                            exportContext,
                            {
                                targetId: 'fr-ca',
                                siteId: 'Mondou',
                                locale: 'fr_CA',
                                language: 'fr',
                                coveoOrganizationId: 'mondouorg',
                                coveoTrackingId: 'mondou_ca',
                                coveoCountry: 'CA',
                                coveoCurrency: 'CAD',
                                storefrontBaseUrl: 'https://www.mondou.com',
                                listingCategoryUrlTemplate: '/fr-CA/{categorySlugPath}',
                                listingBrandUrlTemplate: '/fr-CA/marques/{brandSlug}'
                            }
                        ]
                    }];
                }
            },
            '*/cartridge/scripts/helper/listingPageHelper': {
                PAGE_TYPE_CATEGORY: 'category',
                PAGE_TYPE_BRAND: 'brand',
                buildDesiredListingPages: function (exportContexts) {
                    assert.lengthOf(exportContexts, 2);
                    return desired.map(function (listingPage, index) {
                        listingPage.generatedType = index % 2 ? 'brand' : 'category';
                        return listingPage;
                    });
                },
                readExistingListingPages: function () {
                    assert.strictEqual(arguments[0], exportContext);
                    readCalls += 1;
                    return readCalls === 1 ? [] : desired;
                },
                planListingPageChanges: function () {
                    return {
                        creates: creates,
                        updates: updates
                    };
                },
                chunk: function (values, size) {
                    var chunks = [];
                    var index = 0;

                    for (index = 0; index < values.length; index += size) {
                        chunks.push(values.slice(index, index + size));
                    }

                    return chunks;
                },
                verifyWrittenListingPages: function (written, refreshed) {
                    verifyCall = {
                        written: written,
                        refreshed: refreshed
                    };
                }
            },
            '*/cartridge/scripts/helper/listingPageService': {
                LISTING_PAGE_BULK_LIMIT: 100,
                bulkCreateListingPages: function (context, listingPages) {
                    assert.strictEqual(context, exportContext);
                    createChunks.push(listingPages);
                    return {
                        ok: true,
                        object: {}
                    };
                },
                bulkUpdateListingPages: function (context, listingPages) {
                    assert.strictEqual(context, exportContext);
                    updateChunks.push(listingPages);
                    return {
                        ok: true,
                        object: {}
                    };
                }
            }
        });

        var status = job.execute(createParameters({
            dryRun: false,
            targetId: 'en-ca'
        }));

        assert.strictEqual(status.code, 'OK');
        assert.lengthOf(createChunks, 3);
        assert.lengthOf(createChunks[0], 100);
        assert.lengthOf(createChunks[1], 100);
        assert.lengthOf(createChunks[2], 5);
        assert.lengthOf(updateChunks, 1);
        assert.lengthOf(updateChunks[0], 1);
        assert.strictEqual(readCalls, 2);
        assert.lengthOf(verifyCall.written, 206);
        assert.lengthOf(verifyCall.refreshed, 206);
    });

    it('retries invalid-json bulk requests one listing page at a time', function () {
        var bulkCreateCalls = [];
        var readCalls = 0;
        var createdPages = [];

        var job = proxyquire(path.resolve(__dirname, '../../../../cartridges/bm_coveo/cartridge/scripts/jobs/syncListingPages'), {
            'dw/system/Logger': {
                getLogger: function () {
                    return {
                        info: function () {},
                        error: function () {},
                        warn: function () {}
                    };
                }
            },
            'dw/system/Status': createStatus(),
            '*/cartridge/scripts/helper/exportTargetHelper': {
                resolveListingSyncGroups: function () {
                    return [{
                        trackingId: 'mondou_ca',
                        primaryContext: exportContext,
                        exportContexts: [exportContext]
                    }];
                }
            },
            '*/cartridge/scripts/helper/listingPageHelper': {
                PAGE_TYPE_CATEGORY: 'category',
                PAGE_TYPE_BRAND: 'brand',
                buildDesiredListingPages: function () {
                    return [
                        {
                            name: 'Cat',
                            patterns: [{
                                url: 'https://www.mondou.com/cat'
                            }],
                            pageRules: [{
                                name: 'Include ec_category contains Cat',
                                locales: [{
                                    language: 'en',
                                    country: 'CA',
                                    currency: 'CAD'
                                }],
                                filters: [{
                                    fieldName: 'ec_category',
                                    operator: 'contains',
                                    value: {
                                        type: 'array',
                                        values: ['Cat']
                                    }
                                }]
                            }],
                            trackingId: 'mondou_ca',
                            generatedType: 'category'
                        },
                        {
                            name: 'Dog',
                            patterns: [{
                                url: 'https://www.mondou.com/dog'
                            }],
                            pageRules: [{
                                name: 'Include ec_category contains Dog',
                                locales: [{
                                    language: 'en',
                                    country: 'CA',
                                    currency: 'CAD'
                                }],
                                filters: [{
                                    fieldName: 'ec_category',
                                    operator: 'contains',
                                    value: {
                                        type: 'array',
                                        values: ['Dog']
                                    }
                                }]
                            }],
                            trackingId: 'mondou_ca',
                            generatedType: 'category'
                        }
                    ];
                },
                readExistingListingPages: function () {
                    readCalls += 1;
                    return [];
                },
                planListingPageChanges: function () {
                    return {
                        creates: [
                            {
                                name: 'Cat'
                            },
                            {
                                name: 'Dog'
                            }
                        ],
                        updates: []
                    };
                },
                chunk: function (values) {
                    return [values];
                },
                verifyWrittenListingPages: function () {}
            },
            '*/cartridge/scripts/helper/listingPageService': {
                LISTING_PAGE_BULK_LIMIT: 100,
                bulkCreateListingPages: function (context, listingPages) {
                    bulkCreateCalls.push(listingPages);

                    if (listingPages.length > 1) {
                        return {
                            ok: false,
                            status: 400,
                            errorMessage: '{"message":"The provided JSON has an invalid format","errorCode":"INVALID_JSON"}',
                            msg: 'Bad Request'
                        };
                    }

                    createdPages = createdPages.concat(listingPages);
                    return {
                        ok: true,
                        object: {}
                    };
                },
                bulkUpdateListingPages: function () {
                    return {
                        ok: true,
                        object: {}
                    };
                }
            }
        });

        var status = job.execute(createParameters({
            dryRun: false
        }));

        assert.strictEqual(status.code, 'OK');
        assert.strictEqual(readCalls, 2);
        assert.lengthOf(bulkCreateCalls, 3);
        assert.lengthOf(bulkCreateCalls[0], 2);
        assert.lengthOf(bulkCreateCalls[1], 1);
        assert.lengthOf(bulkCreateCalls[2], 1);
        assert.lengthOf(createdPages, 2);
    });

    it('supports dry run without calling bulk create or update', function () {
        var writes = 0;
        var readCalls = 0;

        var job = proxyquire(path.resolve(__dirname, '../../../../cartridges/bm_coveo/cartridge/scripts/jobs/syncListingPages'), {
            'dw/system/Logger': {
                getLogger: function () {
                    return {
                        info: function () {},
                        error: function () {}
                    };
                }
            },
            'dw/system/Status': createStatus(),
            '*/cartridge/scripts/helper/exportTargetHelper': {
                resolveListingSyncGroups: function () {
                    return [{
                        trackingId: 'mondou_ca',
                        primaryContext: exportContext,
                        exportContexts: [exportContext]
                    }];
                }
            },
            '*/cartridge/scripts/helper/listingPageHelper': {
                PAGE_TYPE_CATEGORY: 'category',
                PAGE_TYPE_BRAND: 'brand',
                buildDesiredListingPages: function (exportContexts) {
                    assert.lengthOf(exportContexts, 1);
                    return [{
                        name: 'Cat',
                        generatedType: 'category'
                    }];
                },
                readExistingListingPages: function () {
                    assert.strictEqual(arguments[0], exportContext);
                    readCalls += 1;
                    return [];
                },
                planListingPageChanges: function () {
                    return {
                        creates: [{
                            name: 'Cat'
                        }],
                        updates: []
                    };
                }
            },
            '*/cartridge/scripts/helper/listingPageService': {
                LISTING_PAGE_BULK_LIMIT: 100,
                bulkCreateListingPages: function () {
                    writes += 1;
                },
                bulkUpdateListingPages: function () {
                    writes += 1;
                }
            }
        });

        var status = job.execute(createParameters({
            dryRun: true
        }));

        assert.strictEqual(status.code, 'OK');
        assert.strictEqual(readCalls, 1);
        assert.strictEqual(writes, 0);
    });

    it('includes CMH service failure details in thrown errors', function () {
        var job = proxyquire(path.resolve(__dirname, '../../../../cartridges/bm_coveo/cartridge/scripts/jobs/syncListingPages'), {
            'dw/system/Logger': {
                getLogger: function () {
                    return {
                        info: function () {},
                        error: function () {}
                    };
                }
            },
            'dw/system/Status': createStatus(),
            '*/cartridge/scripts/helper/exportTargetHelper': {
                resolveListingSyncGroups: function () {
                    return [{
                        trackingId: 'mondou_ca',
                        primaryContext: exportContext,
                        exportContexts: [exportContext]
                    }];
                }
            },
            '*/cartridge/scripts/helper/listingPageHelper': {
                PAGE_TYPE_CATEGORY: 'category',
                PAGE_TYPE_BRAND: 'brand',
                buildDesiredListingPages: function (exportContexts) {
                    assert.lengthOf(exportContexts, 1);
                    return [{
                        name: 'Cat',
                        generatedType: 'category'
                    }];
                },
                readExistingListingPages: function () {
                    assert.strictEqual(arguments[0], exportContext);
                    return [];
                },
                planListingPageChanges: function () {
                    return {
                        creates: [{
                            name: 'Cat'
                        }],
                        updates: []
                    };
                },
                chunk: function (values) {
                    return [values];
                }
            },
            '*/cartridge/scripts/helper/listingPageService': {
                LISTING_PAGE_BULK_LIMIT: 100,
                bulkCreateListingPages: function () {
                    return {
                        ok: false,
                        status: 'ERROR_RESPONSE',
                        errorMessage: '403 Forbidden'
                    };
                }
            }
        });

        assert.throws(function () {
            job.execute(createParameters({
                dryRun: false
            }));
        }, /403 Forbidden/);
    });
});
