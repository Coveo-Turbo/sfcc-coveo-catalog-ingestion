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

describe('auditCatalogAttributes job', function () {
    it('audits a catalog and writes JSON and CSV reports', function () {
        var writes = {};
        var job = proxyquire(path.resolve(__dirname, '../../../../cartridges/bm_coveo/cartridge/scripts/jobs/auditCatalogAttributes'), {
            'dw/catalog/CatalogMgr': {
                getCatalog: function (catalogId) {
                    return {
                        ID: catalogId
                    };
                }
            },
            'dw/catalog/ProductMgr': {
                queryProductsInCatalog: function () {
                    return createIterator([{
                        ID: 'MASTER-1'
                    }]);
                }
            },
            'dw/io/File': (function () {
                function File(filePath) {
                    this.fullPath = filePath;
                    this.path = filePath;
                }

                File.IMPEX = '/IMPEX';
                File.SEPARATOR = '/';
                File.prototype.mkdirs = function () {};

                return File;
            }()),
            'dw/io/FileWriter': function FileWriter(file) {
                return {
                    write: function (content) {
                        writes[file.fullPath] = content;
                    },
                    flush: function () {},
                    close: function () {}
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
                    ID: 'RefArch',
                    defaultLocale: 'en_CA'
                }
            },
            'dw/system/Status': (function () {
                function Status(status, code, message) {
                    this.status = status;
                    this.code = code;
                    this.message = message;
                }

                Status.OK = 'OK';
                Status.ERROR = 'ERROR';

                return Status;
            }()),
            '*/cartridge/scripts/helper/catalogAttributeAuditHelper': {
                buildCatalogAttributeAudit: function (iterator, options) {
                    assert.strictEqual(options.catalogId, 'mondou_CA-storefront');
                    assert.strictEqual(options.locale, 'fr_CA');
                    assert.isTrue(iterator.hasNext());

                    return {
                        scanSummary: {
                            productsScanned: 1
                        },
                        productAttributes: [],
                        primaryCategoryAttributes: []
                    };
                },
                buildAuditCsv: function () {
                    return 'sourceObject,attributeId\n';
                }
            }
        });
        var status = job.execute({
            get: function (name) {
                var values = {
                    catalogId: 'mondou_CA-storefront',
                    locale: 'fr_CA',
                    outputPath: '/src/coveo/reports/catalog-attributes/',
                    sampleLimit: '5',
                    maxProducts: '0'
                };

                return values[name];
            }
        });
        var outputFiles = Object.keys(writes);

        assert.strictEqual(status.status, 'OK');
        assert.lengthOf(outputFiles, 2);
        assert.match(outputFiles[0] + outputFiles[1], /catalog_attribute_audit_mondou_CA-storefront_fr_CA/);
    });

    it('returns an error status when the catalog does not exist', function () {
        var job = proxyquire(path.resolve(__dirname, '../../../../cartridges/bm_coveo/cartridge/scripts/jobs/auditCatalogAttributes'), {
            'dw/catalog/CatalogMgr': {
                getCatalog: function () {
                    return null;
                }
            },
            'dw/catalog/ProductMgr': {
                queryProductsInCatalog: function () {
                    throw new Error('Should not query products when catalog is missing.');
                }
            },
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
            'dw/system/Site': {
                current: {
                    ID: 'RefArch',
                    defaultLocale: 'en_CA'
                }
            },
            'dw/system/Status': (function () {
                function Status(status, code, message) {
                    this.status = status;
                    this.code = code;
                    this.message = message;
                }

                Status.OK = 'OK';
                Status.ERROR = 'ERROR';

                return Status;
            }()),
            '*/cartridge/scripts/helper/catalogAttributeAuditHelper': {
                buildCatalogAttributeAudit: function () {
                    throw new Error('Should not build an audit when catalog is missing.');
                },
                buildAuditCsv: function () {
                    return '';
                }
            }
        });
        var status = job.execute({
            get: function (name) {
                var values = {
                    catalogId: 'missing-catalog',
                    locale: '',
                    outputPath: '/src/coveo/reports/catalog-attributes/',
                    sampleLimit: '5',
                    maxProducts: '0'
                };

                return values[name];
            }
        });

        assert.strictEqual(status.status, 'ERROR');
        assert.match(status.message, /No catalog with id missing-catalog exists/);
    });
});
