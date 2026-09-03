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

describe('catalogExportValidator', function () {
    var validator;

    beforeEach(function () {
        validator = proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/helper/catalogExportValidator'), {
            'dw/util/HashSet': createHashSet()
        });
    });

    it('builds an addOrUpdate payload for valid product and variant items', function () {
        var payload = validator.buildAddOrUpdatePayload([
            {
                documentId: 'https://example.com/product/red',
                objecttype: 'Product',
                language: 'en',
                permanentid: 'MASTER-red',
                ec_product_id: 'MASTER-red'
            },
            {
                documentId: 'https://example.com/product/red?pid=sSKU-1',
                objecttype: 'Variant',
                language: 'en',
                permanentid: 'SKU-1',
                ec_product_id: 'MASTER-red',
                ec_variant_id: 'SKU-1'
            }
        ], {
            catalogStructureMode: 'product_variant'
        });

        assert.deepEqual(payload, {
            addOrUpdate: [
                {
                    documentId: 'https://example.com/product/red',
                    objecttype: 'Product',
                    language: 'en',
                    permanentid: 'MASTER-red',
                    ec_product_id: 'MASTER-red'
                },
                {
                    documentId: 'https://example.com/product/red?pid=sSKU-1',
                    objecttype: 'Variant',
                    language: 'en',
                    permanentid: 'SKU-1',
                    ec_product_id: 'MASTER-red',
                    ec_variant_id: 'SKU-1'
                }
            ]
        });
    });

    it('rejects items that still contain the legacy ec_productid field', function () {
        assert.throws(function () {
            validator.buildAddOrUpdatePayload([
                {
                    documentId: 'https://example.com/product/red',
                    objecttype: 'Product',
                    language: 'en',
                    permanentid: 'MASTER-red',
                    ec_product_id: 'MASTER-red',
                    ec_productid: 'legacy-id'
                }
            ]);
        }, /legacy ec_productid/);
    });

    it('rejects variants that reference a missing parent ec_product_id', function () {
        assert.throws(function () {
            validator.buildAddOrUpdatePayload([
                {
                    documentId: 'https://example.com/product/red?pid=sSKU-1',
                    objecttype: 'Variant',
                    language: 'en',
                    permanentid: 'SKU-1',
                    ec_product_id: 'MASTER-red',
                    ec_variant_id: 'SKU-1'
                }
            ], {
                catalogStructureMode: 'product_variant'
            });
        }, /references missing parent ec_product_id/);
    });

    it('builds an addOrUpdate payload for valid product_only items without ec_variant_id', function () {
        var payload = validator.buildAddOrUpdatePayload([
            {
                documentId: 'https://example.com/product/sku-1',
                objecttype: 'Product',
                language: 'en',
                permanentid: 'SKU-1',
                ec_product_id: 'SKU-1',
                ec_sku: 'SKU-1',
                ec_item_group_id: 'MASTER-1'
            }
        ], {
            catalogStructureMode: 'product_only'
        });

        assert.deepEqual(payload, {
            addOrUpdate: [
                {
                    documentId: 'https://example.com/product/sku-1',
                    objecttype: 'Product',
                    language: 'en',
                    permanentid: 'SKU-1',
                    ec_product_id: 'SKU-1',
                    ec_sku: 'SKU-1',
                    ec_item_group_id: 'MASTER-1'
                }
            ]
        });
    });

    it('rejects Variant items in product_only mode', function () {
        assert.throws(function () {
            validator.buildAddOrUpdatePayload([
                {
                    documentId: 'https://example.com/product/red?pid=sSKU-1',
                    objecttype: 'Variant',
                    language: 'en',
                    permanentid: 'SKU-1',
                    ec_product_id: 'MASTER-red',
                    ec_variant_id: 'SKU-1'
                }
            ], {
                catalogStructureMode: 'product_only'
            });
        }, /not allowed in product_only mode/);
    });

    it('rejects items that are missing language or mismatched permanentid values', function () {
        assert.throws(function () {
            validator.buildAddOrUpdatePayload([
                {
                    documentId: 'https://example.com/product/red',
                    objecttype: 'Product',
                    permanentid: 'WRONG',
                    ec_product_id: 'MASTER-red'
                },
                {
                    documentId: 'https://example.com/product/red?pid=sSKU-1',
                    objecttype: 'Variant',
                    language: 'en',
                    permanentid: 'WRONG',
                    ec_product_id: 'MASTER-red',
                    ec_variant_id: 'SKU-1'
                }
            ], {
                catalogStructureMode: 'product_variant'
            });
        }, /missing language|permanentid/);
    });

    it('rejects items whose language does not match the target export language', function () {
        assert.throws(function () {
            validator.buildAddOrUpdatePayload([
                {
                    documentId: 'https://example.com/product/red',
                    objecttype: 'Product',
                    language: 'fr',
                    permanentid: 'MASTER-red',
                    ec_product_id: 'MASTER-red'
                }
            ], {
                expectedLanguage: 'en'
            });
        }, /expects en/);
    });

    it('builds delete-only Stream payloads and deduplicates document ids', function () {
        assert.deepEqual(validator.buildStreamPayload([], [
            'https://example.com/deleted',
            {
                documentId: 'https://example.com/deleted'
            }
        ]), {
            delete: [{
                documentId: 'https://example.com/deleted',
                deleteChildren: false
            }]
        });
    });

    it('builds mixed update and delete Stream payloads', function () {
        var product = {
            documentId: 'https://example.com/current',
            objecttype: 'Product',
            language: 'en',
            permanentid: 'CURRENT',
            ec_product_id: 'CURRENT'
        };

        assert.deepEqual(validator.buildStreamPayload([product], [{
            documentId: 'https://example.com/removed',
            deleteChildren: true
        }]), {
            addOrUpdate: [product],
            delete: [{
                documentId: 'https://example.com/removed',
                deleteChildren: true
            }]
        });
    });

    it('rejects missing delete ids and conflicting operations', function () {
        var product = {
            documentId: 'https://example.com/current',
            objecttype: 'Product',
            language: 'en',
            permanentid: 'CURRENT',
            ec_product_id: 'CURRENT'
        };

        assert.throws(function () {
            validator.buildStreamPayload([], [{}]);
        }, /missing documentId/);
        assert.throws(function () {
            validator.buildStreamPayload([product], [product.documentId]);
        }, /cannot be added and deleted/);
        assert.throws(function () {
            validator.buildStreamPayload([], []);
        }, /does not contain any valid Stream operations/);
    });
});
