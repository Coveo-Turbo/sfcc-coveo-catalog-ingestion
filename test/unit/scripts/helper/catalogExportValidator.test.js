'use strict';

var path = require('path');
var assert = require('chai').assert;

var validator = require(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/helper/catalogExportValidator'));

describe('catalogExportValidator', function () {
    it('builds an addOrUpdate payload for valid product and variant items', function () {
        var payload = validator.buildAddOrUpdatePayload([
            {
                documentId: 'https://example.com/product/red',
                objecttype: 'Product',
                ec_product_id: 'MASTER-red'
            },
            {
                documentId: 'https://example.com/product/red?pid=sSKU-1',
                objecttype: 'Variant',
                ec_product_id: 'MASTER-red',
                ec_variant_id: 'SKU-1'
            }
        ]);

        assert.deepEqual(payload, {
            addOrUpdate: [
                {
                    documentId: 'https://example.com/product/red',
                    objecttype: 'Product',
                    ec_product_id: 'MASTER-red'
                },
                {
                    documentId: 'https://example.com/product/red?pid=sSKU-1',
                    objecttype: 'Variant',
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
                    ec_product_id: 'MASTER-red',
                    ec_variant_id: 'SKU-1'
                }
            ]);
        }, /references missing parent ec_product_id/);
    });
});
