'use strict';

var path = require('path');
var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();

function createHashSet() {
    function HashSet() {
        this.values = {};
    }

    HashSet.prototype.add = function (value) {
        this.values[value] = true;
    };

    HashSet.prototype.contains = function (value) {
        return !!this.values[value];
    };

    return HashSet;
}

function createFailingHashSet(message) {
    function HashSet() {}

    HashSet.prototype.add = function () {
        throw new Error(message);
    };

    HashSet.prototype.contains = function () {
        throw new Error(message);
    };

    return HashSet;
}

function createIterator(values) {
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
        close: function () {}
    };
}

describe('coveoHelper', function () {
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

    it('returns deduplicated root product ids for delta exports', function () {
        var helper = proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/helper/coveoHelper'), {
            'dw/catalog/CatalogMgr': {
                getCatalog: function () {
                    return null;
                }
            },
            'dw/util/Calendar': function Calendar() {},
            'dw/io/File': function File() {},
            'dw/io/FileWriter': function FileWriter() {},
            'dw/system/Logger': {
                getLogger: function () {
                    return {
                        info: function () {},
                        error: function () {}
                    };
                }
            },
            'dw/util/StringUtils': {
                formatCalendar: function () {
                    return '2026-01-01t000000.000';
                }
            },
            'dw/util/HashSet': createHashSet(),
            'dw/catalog/ProductMgr': {
                queryAllSiteProducts: function () {
                    return createIterator([
                        {
                            ID: 'MASTER-1',
                            master: true,
                            lastModified: new Date('2026-01-02T00:00:00Z')
                        },
                        {
                            ID: 'MASTER-1-RED-S',
                            variant: true,
                            masterProduct: {
                                ID: 'MASTER-1'
                            },
                            lastModified: new Date('2026-01-03T00:00:00Z')
                        },
                        {
                            ID: 'STANDALONE-1',
                            lastModified: new Date('2026-01-04T00:00:00Z')
                        },
                        {
                            ID: 'OLD-1',
                            lastModified: new Date('2025-12-31T00:00:00Z')
                        }
                    ]);
                },
                queryProductsInCatalog: function () {
                    return createIterator([]);
                }
            },
            'dw/catalog/ProductSearchModel': function ProductSearchModel() {},
            '*/cartridge/scripts/utils/coveoConstant': {
                getCoveoConstants: function () {
                    return {
                        CATALOG_LAST_SYNC: new Date('2026-01-01T00:00:00Z'),
                        COVEO_FILE_FORMAT: '.json'
                    };
                },
                COVEO_CONSTANTS: {
                    CATALOG_LAST_SYNC: new Date('2026-01-01T00:00:00Z'),
                    COVEO_FILE_FORMAT: '.json'
                },
                CoveoFeedType: {
                    PRODUCT_FEED: 'PRODUCT_FEED'
                }
            },
            '*/cartridge/scripts/helper/catalogExportValidator': {
                buildAddOrUpdatePayload: function (items) {
                    return {
                        addOrUpdate: items
                    };
                }
            }
        });

        var iterator = helper.buildProductQuery(true);
        var values = [];

        while (iterator.hasNext()) {
            values.push(iterator.next());
        }

        assert.deepEqual(values, ['MASTER-1', 'STANDALONE-1']);
    });

    it('requires a successful full sync before delta exports can run', function () {
        var helper = proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/helper/coveoHelper'), {
            'dw/catalog/CatalogMgr': {
                getCatalog: function () {
                    return null;
                }
            },
            'dw/util/Calendar': function Calendar() {},
            'dw/io/File': function File() {},
            'dw/io/FileWriter': function FileWriter() {},
            'dw/system/Logger': {
                getLogger: function () {
                    return {
                        info: function () {},
                        error: function () {}
                    };
                }
            },
            'dw/util/StringUtils': {
                formatCalendar: function () {
                    return '2026-01-01t000000.000';
                }
            },
            'dw/util/HashSet': createHashSet(),
            'dw/catalog/ProductMgr': {
                queryAllSiteProducts: function () {
                    return createIterator([]);
                },
                queryProductsInCatalog: function () {
                    return createIterator([]);
                }
            },
            'dw/catalog/ProductSearchModel': function ProductSearchModel() {},
            '*/cartridge/scripts/utils/coveoConstant': {
                getCoveoConstants: function () {
                    return {
                        CATALOG_LAST_SYNC: null,
                        COVEO_FILE_FORMAT: '.json'
                    };
                },
                COVEO_CONSTANTS: {
                    CATALOG_LAST_SYNC: null,
                    COVEO_FILE_FORMAT: '.json'
                },
                CoveoFeedType: {
                    PRODUCT_FEED: 'PRODUCT_FEED'
                }
            },
            '*/cartridge/scripts/helper/catalogExportValidator': {
                buildAddOrUpdatePayload: function (items) {
                    return {
                        addOrUpdate: items
                    };
                }
            }
        });

        assert.throws(function () {
            helper.buildProductQuery(true);
        }, /requires a successful full catalog sync/);
    });

    it('returns deduplicated root product ids for full exports when search hits include variants', function () {
        var helper = proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/helper/coveoHelper'), {
            'dw/catalog/CatalogMgr': {
                getCatalog: function () {
                    return null;
                }
            },
            'dw/util/Calendar': function Calendar() {},
            'dw/io/File': function File() {},
            'dw/io/FileWriter': function FileWriter() {},
            'dw/system/Logger': {
                getLogger: function () {
                    return {
                        info: function () {},
                        error: function () {}
                    };
                }
            },
            'dw/util/StringUtils': {
                formatCalendar: function () {
                    return '2026-01-01t000000.000';
                }
            },
            'dw/util/HashSet': createHashSet(),
            'dw/catalog/ProductMgr': {
                getProduct: function (productId) {
                    var products = {
                        'MASTER-1': {
                            ID: 'MASTER-1',
                            master: true
                        },
                        'MASTER-1-RED-S': {
                            ID: 'MASTER-1-RED-S',
                            variant: true,
                            masterProduct: {
                                ID: 'MASTER-1'
                            }
                        },
                        'MASTER-1-RED-M': {
                            ID: 'MASTER-1-RED-M',
                            variant: true,
                            masterProduct: {
                                ID: 'MASTER-1'
                            }
                        },
                        'STANDALONE-1': {
                            ID: 'STANDALONE-1'
                        }
                    };

                    return products[productId];
                },
                queryProductsInCatalog: function () {
                    return createIterator([]);
                }
            },
            'dw/catalog/ProductSearchModel': function ProductSearchModel() {
                this.setCategoryID = function () {};
                this.setRecursiveCategorySearch = function () {};
                this.search = function () {};
                this.getProductSearchHits = function () {
                    return createIterator([
                        {
                            productID: 'MASTER-1'
                        },
                        {
                            productID: 'MASTER-1-RED-S'
                        },
                        {
                            productID: 'MASTER-1-RED-M'
                        },
                        {
                            productID: 'STANDALONE-1'
                        }
                    ]);
                };
            },
            '*/cartridge/scripts/utils/coveoConstant': {
                getCoveoConstants: function () {
                    return {
                        CATALOG_LAST_SYNC: new Date('2026-01-01T00:00:00Z'),
                        COVEO_FILE_FORMAT: '.json'
                    };
                },
                COVEO_CONSTANTS: {
                    CATALOG_LAST_SYNC: new Date('2026-01-01T00:00:00Z'),
                    COVEO_FILE_FORMAT: '.json'
                },
                CoveoFeedType: {
                    PRODUCT_FEED: 'PRODUCT_FEED'
                }
            },
            '*/cartridge/scripts/helper/catalogExportValidator': {
                buildAddOrUpdatePayload: function (items) {
                    return {
                        addOrUpdate: items
                    };
                }
            }
        });

        var iterator = helper.buildProductQuery(false);
        var values = [];

        while (iterator.hasNext()) {
            values.push(iterator.next());
        }

        assert.deepEqual(values, ['MASTER-1', 'STANDALONE-1']);
    });

    it('uses the configured target catalog when a catalog-scoped export target is provided', function () {
        var helper = proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/helper/coveoHelper'), {
            'dw/catalog/CatalogMgr': {
                getCatalog: function (catalogId) {
                    assert.strictEqual(catalogId, 'fr-catalog');
                    return {
                        ID: catalogId
                    };
                }
            },
            'dw/util/Calendar': function Calendar() {},
            'dw/io/File': function File() {},
            'dw/io/FileWriter': function FileWriter() {},
            'dw/system/Logger': {
                getLogger: function () {
                    return {
                        info: function () {},
                        error: function () {}
                    };
                }
            },
            'dw/util/StringUtils': {
                formatCalendar: function () {
                    return '2026-01-01t000000.000';
                }
            },
            'dw/util/HashSet': createHashSet(),
            'dw/catalog/ProductMgr': {
                queryProductsInCatalog: function (catalog) {
                    assert.strictEqual(catalog.ID, 'fr-catalog');
                    return createIterator([
                        {
                            ID: 'MASTER-1',
                            master: true
                        },
                        {
                            ID: 'MASTER-1-RED-S',
                            variant: true,
                            masterProduct: {
                                ID: 'MASTER-1'
                            }
                        },
                        {
                            ID: 'FR-STANDALONE-1'
                        }
                    ]);
                }
            },
            'dw/catalog/ProductSearchModel': function ProductSearchModel() {
                this.setCategoryID = function () {
                    throw new Error('Should not use site-wide product search for a catalog-scoped export.');
                };
            },
            '*/cartridge/scripts/utils/coveoConstant': {
                getCoveoConstants: function () {
                    return {
                        CATALOG_LAST_SYNC: new Date('2026-01-01T00:00:00Z'),
                        COVEO_FILE_FORMAT: '.json'
                    };
                },
                COVEO_CONSTANTS: {
                    CATALOG_LAST_SYNC: new Date('2026-01-01T00:00:00Z'),
                    COVEO_FILE_FORMAT: '.json'
                },
                CoveoFeedType: {
                    PRODUCT_FEED: 'PRODUCT_FEED'
                }
            },
            '*/cartridge/scripts/helper/catalogExportValidator': {
                buildAddOrUpdatePayload: function (items) {
                    return {
                        addOrUpdate: items
                    };
                }
            }
        });

        var iterator = helper.buildProductQuery(false, {
            catalogId: 'fr-catalog'
        });
        var values = [];

        while (iterator.hasNext()) {
            values.push(iterator.next());
        }

        assert.deepEqual(values, ['MASTER-1', 'FR-STANDALONE-1']);
    });

    it('streams catalog-scoped full exports without a quota-limited root id set', function () {
        var products = [];
        var index;

        for (index = 0; index < 20050; index += 1) {
            products.push({
                ID: 'STANDALONE-' + index
            });
        }

        products.push({
            ID: 'MASTER-1-RED-S',
            variant: true,
            masterProduct: {
                ID: 'MASTER-1'
            }
        });

        var helper = proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/helper/coveoHelper'), {
            'dw/catalog/CatalogMgr': {
                getCatalog: function (catalogId) {
                    assert.strictEqual(catalogId, 'large-catalog');
                    return {
                        ID: catalogId
                    };
                }
            },
            'dw/util/Calendar': function Calendar() {},
            'dw/io/File': function File() {},
            'dw/io/FileWriter': function FileWriter() {},
            'dw/system/Logger': {
                getLogger: function () {
                    return {
                        info: function () {},
                        error: function () {}
                    };
                }
            },
            'dw/util/StringUtils': {
                formatCalendar: function () {
                    return '2026-01-01t000000.000';
                }
            },
            'dw/util/HashSet': createFailingHashSet('Full catalog exports should not build a quota-limited HashSet.'),
            'dw/catalog/ProductMgr': {
                queryProductsInCatalog: function (catalog) {
                    assert.strictEqual(catalog.ID, 'large-catalog');
                    return createIterator(products);
                }
            },
            'dw/catalog/ProductSearchModel': function ProductSearchModel() {
                this.setCategoryID = function () {
                    throw new Error('Should not use site-wide product search for a catalog-scoped export.');
                };
            },
            '*/cartridge/scripts/utils/coveoConstant': {
                getCoveoConstants: function () {
                    return {
                        CATALOG_LAST_SYNC: new Date('2026-01-01T00:00:00Z'),
                        COVEO_FILE_FORMAT: '.json'
                    };
                },
                COVEO_CONSTANTS: {
                    CATALOG_LAST_SYNC: new Date('2026-01-01T00:00:00Z'),
                    COVEO_FILE_FORMAT: '.json'
                },
                CoveoFeedType: {
                    PRODUCT_FEED: 'PRODUCT_FEED'
                }
            },
            '*/cartridge/scripts/helper/catalogExportValidator': {
                buildAddOrUpdatePayload: function (items) {
                    return {
                        addOrUpdate: items
                    };
                }
            }
        });

        var iterator = helper.buildProductQuery(false, {
            catalogId: 'large-catalog'
        });
        var count = 0;
        var firstValue = null;
        var lastValue = null;

        while (iterator.hasNext()) {
            var productId = iterator.next();

            if (count === 0) {
                firstValue = productId;
            }

            lastValue = productId;
            count += 1;
        }

        assert.strictEqual(count, 20050);
        assert.strictEqual(firstValue, 'STANDALONE-0');
        assert.strictEqual(lastValue, 'STANDALONE-20049');
    });

    it('uses assigned site products for explicit full-export eligibility modes', function () {
        var queriedAssignedProducts = false;
        var helper = proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/helper/coveoHelper'), {
            'dw/catalog/CatalogMgr': {
                getCatalog: function () {
                    return null;
                }
            },
            'dw/util/Calendar': function Calendar() {},
            'dw/io/File': function File() {},
            'dw/io/FileWriter': function FileWriter() {},
            'dw/system/Logger': {
                getLogger: function () {
                    return {
                        info: function () {},
                        error: function () {}
                    };
                }
            },
            'dw/util/StringUtils': {
                formatCalendar: function () {
                    return '2026-01-01t000000.000';
                }
            },
            'dw/util/HashSet': createHashSet(),
            'dw/catalog/ProductMgr': {
                queryAllSiteProducts: function () {
                    queriedAssignedProducts = true;
                    return createIterator([
                        {
                            ID: 'MASTER-1',
                            master: true
                        },
                        {
                            ID: 'MASTER-1-RED-S',
                            variant: true,
                            masterProduct: {
                                ID: 'MASTER-1'
                            }
                        },
                        {
                            ID: 'OFFLINE-STANDALONE',
                            online: false
                        }
                    ]);
                },
                queryProductsInCatalog: function () {
                    return createIterator([]);
                }
            },
            'dw/catalog/ProductSearchModel': function ProductSearchModel() {
                this.setCategoryID = function () {
                    throw new Error('Explicit eligibility must not depend on the SFCC search index.');
                };
            },
            '*/cartridge/scripts/utils/coveoConstant': {
                COVEO_CONSTANTS: {
                    COVEO_FILE_FORMAT: '.json'
                },
                CoveoFeedType: {
                    PRODUCT_FEED: 'PRODUCT_FEED'
                }
            },
            '*/cartridge/scripts/helper/catalogExportValidator': {
                buildAddOrUpdatePayload: function (items) {
                    return {
                        addOrUpdate: items
                    };
                }
            }
        });
        var iterator = helper.buildProductQuery(false, {
            productEligibilityMode: 'online_and_searchable'
        });
        var values = [];

        while (iterator.hasNext()) {
            values.push(iterator.next());
        }

        assert.isTrue(queriedAssignedProducts);
        assert.deepEqual(values, ['MASTER-1', 'OFFLINE-STANDALONE']);
    });
});
