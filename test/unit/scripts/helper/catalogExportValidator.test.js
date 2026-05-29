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
        ]);

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
            ]);
        }, /references missing parent ec_product_id/);
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
            ]);
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
});
