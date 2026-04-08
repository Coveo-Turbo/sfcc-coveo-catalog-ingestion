'use strict';

var path = require('path');
var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();

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
                }
            },
            'dw/catalog/ProductSearchModel': function ProductSearchModel() {},
            '*/cartridge/scripts/utils/coveoConstant': {
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
            'dw/catalog/ProductMgr': {
                queryAllSiteProducts: function () {
                    return createIterator([]);
                }
            },
            'dw/catalog/ProductSearchModel': function ProductSearchModel() {},
            '*/cartridge/scripts/utils/coveoConstant': {
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
});
