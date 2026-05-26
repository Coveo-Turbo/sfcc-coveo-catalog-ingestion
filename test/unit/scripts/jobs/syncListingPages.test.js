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
                getPrimaryUrl: function (listingPage) {
                    return listingPage.patterns[0].url;
                },
                buildDesiredListingPages: function (exportContexts, options) {
                    assert.lengthOf(exportContexts, 2);
                    assert.deepEqual(options, {
                        excludedCategoryRoots: []
                    });
                    return desired.map(function (listingPage) {
                        listingPage.generatedType = 'category';
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
                buildListingPagesRequestUrl: function (context, suffix, query) {
                    var url = 'https://platform-ca.cloud.coveo.com/rest/organizations/' + context.coveoOrganizationId + '/commerce/v2/listings/pages' + (suffix || '');

                    if (query) {
                        url += '?trackingId=' + encodeURIComponent(query.trackingId) + '&perPage=' + query.perPage + '&page=' + query.page;
                    }

                    return url;
                },
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

    it('uses successful bulk response payloads for verification before falling back to a re-read', function () {
        var readCalls = 0;
        var verifyCall = null;
        var creates = createListingPages(2, 'create-');

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
                buildDesiredListingPages: function () {
                    return creates.map(function (listingPage) {
                        listingPage.generatedType = 'category';
                        return listingPage;
                    });
                },
                readExistingListingPages: function () {
                    readCalls += 1;
                    return [];
                },
                planListingPageChanges: function () {
                    return {
                        creates: creates,
                        updates: []
                    };
                },
                chunk: function (values) {
                    return [values];
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
                LISTING_PAGE_LIST_LIMIT: 1000,
                buildListingPagesRequestUrl: function (context, suffix, query) {
                    var url = 'https://platform-ca.cloud.coveo.com/rest/organizations/' + context.coveoOrganizationId + '/commerce/v2/listings/pages' + (suffix || '');

                    if (query) {
                        url += '?trackingId=' + encodeURIComponent(query.trackingId) + '&perPage=' + query.perPage + '&page=' + query.page;
                    }

                    return url;
                },
                bulkCreateListingPages: function () {
                    return {
                        ok: true,
                        object: creates.map(function (listingPage, index) {
                            return Object.assign({
                                id: 'created-' + index
                            }, listingPage);
                        })
                    };
                },
                bulkUpdateListingPages: function () {
                    return {
                        ok: true,
                        object: []
                    };
                }
            }
        });

        var status = job.execute(createParameters({
            dryRun: false
        }));

        assert.strictEqual(status.code, 'OK');
        assert.strictEqual(readCalls, 1);
        assert.lengthOf(verifyCall.written, 2);
        assert.lengthOf(verifyCall.refreshed, 2);
        assert.strictEqual(verifyCall.refreshed[0].id, 'created-0');
    });

    it('uses successful bulk response items arrays for verification before falling back to a re-read', function () {
        var readCalls = 0;
        var verifyCall = null;
        var creates = createListingPages(2, 'create-');

        var job = proxyquire(path.resolve(__dirname, '../../../../cartridges/bm_coveo/cartridge/scripts/jobs/syncListingPages'), {
            'dw/system/Logger': {
                getLogger: function () {
                    return {
                        info: function () {},
                        warn: function () {},
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
                buildDesiredListingPages: function () {
                    return creates.map(function (listingPage) {
                        listingPage.generatedType = 'category';
                        return listingPage;
                    });
                },
                readExistingListingPages: function () {
                    readCalls += 1;
                    return [];
                },
                planListingPageChanges: function () {
                    return {
                        creates: creates,
                        updates: []
                    };
                },
                chunk: function (values) {
                    return [values];
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
                LISTING_PAGE_LIST_LIMIT: 1000,
                buildListingPagesRequestUrl: function (context, suffix, query) {
                    var url = 'https://platform-ca.cloud.coveo.com/rest/organizations/' + context.coveoOrganizationId + '/commerce/v2/listings/pages' + (suffix || '');

                    if (query) {
                        url += '?trackingId=' + encodeURIComponent(query.trackingId) + '&perPage=' + query.perPage + '&page=' + query.page;
                    }

                    return url;
                },
                bulkCreateListingPages: function () {
                    return {
                        ok: true,
                        object: {
                            items: creates.map(function (listingPage, index) {
                                return Object.assign({
                                    id: 'created-' + index
                                }, listingPage);
                            })
                        }
                    };
                },
                bulkUpdateListingPages: function () {
                    return {
                        ok: true,
                        object: []
                    };
                }
            }
        });

        var status = job.execute(createParameters({
            dryRun: false
        }));

        assert.strictEqual(status.code, 'OK');
        assert.strictEqual(readCalls, 1);
        assert.lengthOf(verifyCall.written, 2);
        assert.lengthOf(verifyCall.refreshed, 2);
        assert.strictEqual(verifyCall.refreshed[0].id, 'created-0');
    });

    it('uses successful bulk response dw.util.List-like payloads for verification before falling back to a re-read', function () {
        var readCalls = 0;
        var verifyCall = null;
        var updates = createListingPages(2, 'update-').map(function (listingPage, index) {
            listingPage.id = 'existing-' + index;
            return listingPage;
        });

        var job = proxyquire(path.resolve(__dirname, '../../../../cartridges/bm_coveo/cartridge/scripts/jobs/syncListingPages'), {
            'dw/system/Logger': {
                getLogger: function () {
                    return {
                        info: function () {},
                        warn: function () {},
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
                extractListingPageItems: function (responseObject) {
                    return typeof responseObject.toArray === 'function' ? responseObject.toArray() : [];
                },
                buildDesiredListingPages: function () {
                    return updates.map(function (listingPage) {
                        listingPage.generatedType = 'category';
                        return listingPage;
                    });
                },
                readExistingListingPages: function () {
                    readCalls += 1;
                    return updates;
                },
                planListingPageChanges: function () {
                    return {
                        creates: [],
                        updates: updates
                    };
                },
                chunk: function (values) {
                    return [values];
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
                LISTING_PAGE_LIST_LIMIT: 1000,
                buildListingPagesRequestUrl: function (context, suffix, query) {
                    var url = 'https://platform-ca.cloud.coveo.com/rest/organizations/' + context.coveoOrganizationId + '/commerce/v2/listings/pages' + (suffix || '');

                    if (query) {
                        url += '?trackingId=' + encodeURIComponent(query.trackingId) + '&perPage=' + query.perPage + '&page=' + query.page;
                    }

                    return url;
                },
                bulkCreateListingPages: function () {
                    return {
                        ok: true,
                        object: []
                    };
                },
                bulkUpdateListingPages: function () {
                    return {
                        ok: true,
                        object: {
                            toArray: function () {
                                return updates;
                            }
                        }
                    };
                }
            }
        });

        var status = job.execute(createParameters({
            dryRun: false
        }));

        assert.strictEqual(status.code, 'OK');
        assert.strictEqual(readCalls, 1);
        assert.lengthOf(verifyCall.written, 2);
        assert.lengthOf(verifyCall.refreshed, 2);
        assert.strictEqual(verifyCall.refreshed[0].id, 'existing-0');
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
                buildListingPagesRequestUrl: function () {
                    return 'https://platform-ca.cloud.coveo.com/rest/organizations/mondouorg/commerce/v2/listings/pages/bulk-create';
                },
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

    it('does not require listingBrandUrlTemplate when syncing category-driven listing pages', function () {
        var readCalls = 0;
        var contextWithoutLegacyBrandUrl = Object.assign({}, exportContext, {
            listingBrandUrlTemplate: ''
        });

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
                        primaryContext: contextWithoutLegacyBrandUrl,
                        exportContexts: [contextWithoutLegacyBrandUrl]
                    }];
                }
            },
            '*/cartridge/scripts/helper/listingPageHelper': {
                PAGE_TYPE_CATEGORY: 'category',
                buildDesiredListingPages: function () {
                    return [{
                        name: 'Brands|Acme',
                        generatedType: 'category',
                        patterns: [{
                            url: 'https://www.mondou.com/brands/acme'
                        }],
                        pageRules: []
                    }];
                },
                readExistingListingPages: function () {
                    readCalls += 1;
                    return [];
                },
                planListingPageChanges: function () {
                    return {
                        creates: [],
                        updates: []
                    };
                }
            },
            '*/cartridge/scripts/helper/listingPageService': {
                LISTING_PAGE_BULK_LIMIT: 100,
                LISTING_PAGE_LIST_LIMIT: 1000,
                buildListingPagesRequestUrl: function () {
                    return 'https://platform-ca.cloud.coveo.com/rest/organizations/mondouorg/commerce/v2/listings/pages';
                }
            }
        });

        var status = job.execute(createParameters({
            dryRun: true
        }));

        assert.strictEqual(status.code, 'OK');
        assert.strictEqual(readCalls, 1);
    });

    it('reads existing pages from additional site tracking ids before planning creates and updates', function () {
        var sharedContext = Object.assign({}, exportContext, {
            coveoTrackingId: 'mondou'
        });
        var legacyContext = {
            targetId: 'legacy-en-ca',
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
        var planningInput = null;

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
                        trackingId: 'mondou',
                        primaryContext: sharedContext,
                        exportContexts: [sharedContext],
                        existingListingReadContexts: [sharedContext, legacyContext]
                    }];
                }
            },
            '*/cartridge/scripts/helper/listingPageHelper': {
                PAGE_TYPE_CATEGORY: 'category',
                getPrimaryUrl: function (listingPage) {
                    return listingPage.patterns[0].url;
                },
                buildDesiredListingPages: function (exportContexts, options) {
                    assert.lengthOf(exportContexts, 1);
                    assert.deepEqual(options, {
                        excludedCategoryRoots: []
                    });
                    return [{
                        name: 'Holiday Gift Guide',
                        patterns: [{
                            url: 'https://www.mondou.com/en-CA/holiday-gift-guide'
                        }],
                        pageRules: [],
                        trackingId: 'mondou',
                        generatedType: 'category'
                    }];
                },
                readExistingListingPages: function (context) {
                    if (context === sharedContext) {
                        return [];
                    }

                    return [{
                        id: 'legacy-page-id',
                        name: 'Holiday Gift Guide',
                        patterns: [{
                            url: 'https://www.mondou.com/en-CA/holiday-gift-guide'
                        }],
                        pageRules: [],
                        trackingId: 'mondou_ca'
                    }];
                },
                planListingPageChanges: function (desired, existing) {
                    planningInput = {
                        desired: desired,
                        existing: existing
                    };

                    return {
                        creates: [],
                        updates: [{
                            id: 'legacy-page-id',
                            name: 'Holiday Gift Guide',
                            trackingId: 'mondou'
                        }]
                    };
                },
                chunk: function (values) {
                    return [values];
                },
                verifyWrittenListingPages: function () {}
            },
            '*/cartridge/scripts/helper/listingPageService': {
                LISTING_PAGE_BULK_LIMIT: 100,
                buildListingPagesRequestUrl: function (context, suffix, query) {
                    var url = 'https://platform-ca.cloud.coveo.com/rest/organizations/' + context.coveoOrganizationId + '/commerce/v2/listings/pages' + (suffix || '');

                    if (query) {
                        url += '?trackingId=' + encodeURIComponent(query.trackingId) + '&perPage=' + query.perPage + '&page=' + query.page;
                    }

                    return url;
                },
                bulkCreateListingPages: function () {
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
            dryRun: true,
            targetId: 'en-ca'
        }));

        assert.strictEqual(status.code, 'OK');
        assert.isOk(planningInput);
        assert.lengthOf(planningInput.desired, 1);
        assert.lengthOf(planningInput.existing, 1);
        assert.strictEqual(planningInput.existing[0].id, 'legacy-page-id');
        assert.strictEqual(planningInput.existing[0].trackingId, 'mondou_ca');
    });

    it('reads existing pages from additional tracking ids passed as a job parameter', function () {
        var primaryContext = Object.assign({}, exportContext, {
            coveoTrackingId: 'mondou'
        });
        var readTrackingIds = [];
        var planningInput = null;

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
                        trackingId: 'mondou',
                        primaryContext: primaryContext,
                        exportContexts: [primaryContext],
                        existingListingReadContexts: [primaryContext]
                    }];
                }
            },
            '*/cartridge/scripts/helper/listingPageHelper': {
                PAGE_TYPE_CATEGORY: 'category',
                getPrimaryUrl: function (listingPage) {
                    return listingPage.patterns[0].url;
                },
                buildDesiredListingPages: function (exportContexts, options) {
                    assert.lengthOf(exportContexts, 1);
                    assert.deepEqual(options, {
                        excludedCategoryRoots: ['products', 'seasonal']
                    });
                    return [{
                        name: 'Holiday Gift Guide',
                        patterns: [{
                            url: 'https://www.mondou.com/en-CA/holiday-gift-guide'
                        }],
                        pageRules: [],
                        trackingId: 'mondou',
                        generatedType: 'category'
                    }];
                },
                readExistingListingPages: function (context) {
                    readTrackingIds.push(context.coveoTrackingId);

                    if (context.coveoTrackingId === 'legacy-mondou') {
                        return [{
                            id: 'legacy-page-id',
                            name: 'Holiday Gift Guide',
                            patterns: [{
                                url: 'https://www.mondou.com/en-CA/holiday-gift-guide'
                            }],
                            pageRules: [],
                            trackingId: 'legacy-mondou'
                        }];
                    }

                    return [];
                },
                planListingPageChanges: function (desired, existing) {
                    planningInput = {
                        desired: desired,
                        existing: existing
                    };

                    return {
                        creates: [],
                        updates: [{
                            id: 'legacy-page-id',
                            name: 'Holiday Gift Guide',
                            trackingId: 'mondou'
                        }]
                    };
                },
                chunk: function (values) {
                    return [values];
                },
                verifyWrittenListingPages: function () {}
            },
            '*/cartridge/scripts/helper/listingPageService': {
                LISTING_PAGE_BULK_LIMIT: 100,
                buildListingPagesRequestUrl: function (context, suffix, query) {
                    var url = 'https://platform-ca.cloud.coveo.com/rest/organizations/' + context.coveoOrganizationId + '/commerce/v2/listings/pages' + (suffix || '');

                    if (query) {
                        url += '?trackingId=' + encodeURIComponent(query.trackingId) + '&perPage=' + query.perPage + '&page=' + query.page;
                    }

                    return url;
                },
                bulkCreateListingPages: function () {
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
            dryRun: true,
            existingTrackingIds: 'mondou, legacy-mondou, legacy-mondou',
            excludedCategoryRoots: 'products, seasonal, PRODUCTS'
        }));

        assert.strictEqual(status.code, 'OK');
        assert.deepEqual(readTrackingIds, ['mondou', 'legacy-mondou']);
        assert.isOk(planningInput);
        assert.lengthOf(planningInput.existing, 1);
        assert.strictEqual(planningInput.existing[0].id, 'legacy-page-id');
        assert.strictEqual(planningInput.existing[0].trackingId, 'legacy-mondou');
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
                buildListingPagesRequestUrl: function (context, suffix, query) {
                    var url = 'https://platform-ca.cloud.coveo.com/rest/organizations/' + context.coveoOrganizationId + '/commerce/v2/listings/pages' + (suffix || '');

                    if (query) {
                        url += '?trackingId=' + encodeURIComponent(query.trackingId) + '&perPage=' + query.perPage + '&page=' + query.page;
                    }

                    return url;
                },
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

    it('adds a legacy tracking id hint when bulk create conflicts indicate pages already exist elsewhere', function () {
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
                        trackingId: 'mondou',
                        primaryContext: exportContext,
                        exportContexts: [Object.assign({}, exportContext, {
                            coveoTrackingId: 'mondou'
                        })]
                    }];
                }
            },
            '*/cartridge/scripts/helper/listingPageHelper': {
                PAGE_TYPE_CATEGORY: 'category',
                buildDesiredListingPages: function () {
                    return [{
                        name: 'Cat',
                        generatedType: 'category'
                    }];
                },
                readExistingListingPages: function () {
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
                buildListingPagesRequestUrl: function (context, suffix, query) {
                    var url = 'https://platform-ca.cloud.coveo.com/rest/organizations/' + context.coveoOrganizationId + '/commerce/v2/listings/pages' + (suffix || '');

                    if (query) {
                        url += '?trackingId=' + encodeURIComponent(query.trackingId) + '&perPage=' + query.perPage + '&page=' + query.page;
                    }

                    return url;
                },
                bulkCreateListingPages: function () {
                    return {
                        ok: false,
                        requestMethod: 'POST',
                        requestUrl: 'https://platform-ca.cloud.coveo.com/rest/organizations/mondouorg/commerce/v2/listings/pages/bulk-create',
                        status: 'ERROR',
                        error: 400,
                        errorMessage: JSON.stringify({
                            errorCode: 'BULK_LISTING_PAGE_VALIDATION_FAILED',
                            details: [
                                {
                                    errorCode: 'LISTING_PAGE_NAME_ALREADY_EXISTS',
                                    message: 'Listing page name already exists'
                                },
                                {
                                    errorCode: 'LISTING_PAGE_URL_ALREADY_EXISTS',
                                    message: 'Listing page URL already exists'
                                }
                            ]
                        })
                    };
                }
            }
        });

        assert.throws(function () {
            job.execute(createParameters({
                dryRun: false
            }));
        }, /existingTrackingIds=mondou[\s\S]*existingTrackingIds parameter/);
    });

    it('warns and continues when create-only verification reads lag behind successful CMH writes', function () {
        var readCalls = 0;
        var warnMessages = [];
        var job = proxyquire(path.resolve(__dirname, '../../../../cartridges/bm_coveo/cartridge/scripts/jobs/syncListingPages'), {
            'dw/system/Logger': {
                getLogger: function () {
                    return {
                        info: function () {},
                        warn: function () {
                            warnMessages.push(Array.prototype.slice.call(arguments).join('|'));
                        },
                        error: function () {}
                    };
                }
            },
            'dw/system/Status': createStatus(),
            '*/cartridge/scripts/helper/exportTargetHelper': {
                resolveListingSyncGroups: function () {
                    return [{
                        trackingId: 'mondou',
                        primaryContext: Object.assign({}, exportContext, {
                            coveoTrackingId: 'mondou'
                        }),
                        exportContexts: [Object.assign({}, exportContext, {
                            coveoTrackingId: 'mondou'
                        })]
                    }];
                }
            },
            '*/cartridge/scripts/helper/listingPageHelper': {
                PAGE_TYPE_CATEGORY: 'category',
                buildDesiredListingPages: function () {
                    return [{
                        name: 'Holiday Gift Guide',
                        generatedType: 'category',
                        patterns: [{
                            url: 'https://www.mondou.com/en-CA/holiday-gift-guide'
                        }]
                    }];
                },
                readExistingListingPages: function () {
                    readCalls += 1;
                    return [];
                },
                planListingPageChanges: function () {
                    return {
                        creates: [{
                            name: 'Holiday Gift Guide',
                            patterns: [{
                                url: 'https://www.mondou.com/en-CA/holiday-gift-guide'
                            }]
                        }],
                        updates: []
                    };
                },
                chunk: function (values) {
                    return [values];
                },
                verifyWrittenListingPages: function () {
                    throw new Error('Unable to verify CMH listing page sync for Holiday Gift Guide.');
                }
            },
            '*/cartridge/scripts/helper/listingPageService': {
                LISTING_PAGE_BULK_LIMIT: 100,
                LISTING_PAGE_LIST_LIMIT: 1000,
                buildListingPagesRequestUrl: function (context, suffix, query) {
                    var url = 'https://platform-ca.cloud.coveo.com/rest/organizations/' + context.coveoOrganizationId + '/commerce/v2/listings/pages' + (suffix || '');

                    if (query) {
                        url += '?trackingId=' + encodeURIComponent(query.trackingId) + '&perPage=' + query.perPage + '&page=' + query.page;
                    }

                    return url;
                },
                bulkCreateListingPages: function () {
                    return {
                        ok: true,
                        object: {}
                    };
                },
                bulkUpdateListingPages: function () {
                    return {
                        ok: true,
                        object: []
                    };
                }
            }
        });

        var status = job.execute(createParameters({
            dryRun: false
        }));

        assert.strictEqual(status.code, 'OK');
        assert.strictEqual(readCalls, 4);
        assert.strictEqual(warnMessages.length, 1);
        assert.match(warnMessages[0], /verification could not confirm/);
    });
});
