'use strict';

var path = require('path');
var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();

function createHelper() {
    return proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/helper/productEligibilityHelper'), {
        '*/cartridge/scripts/helper/exportTargetHelper': {
            PRODUCT_ELIGIBILITY_MODE_ONLINE_AND_SEARCHABLE: 'online_and_searchable',
            normalizeProductEligibilityMode: function (value) {
                return value ? String(value).trim().toLowerCase() : 'legacy';
            }
        }
    });
}

function createVariants(values) {
    return {
        toArray: function () {
            return values;
        }
    };
}

describe('productEligibilityHelper', function () {
    beforeEach(function () {
        global.empty = function (value) {
            return value === null || value === undefined || value === '';
        };
    });

    afterEach(function () {
        delete global.empty;
    });

    it('preserves products in legacy and all modes', function () {
        var helper = createHelper();
        var offlineProduct = {
            online: false,
            searchable: false
        };

        assert.isTrue(helper.isProductEligible(offlineProduct, {
            productEligibilityMode: 'legacy'
        }));
        assert.isTrue(helper.isProductEligible(offlineProduct, {
            productEligibilityMode: 'all'
        }));
    });

    it('requires effective online and searchable status in storefront mode', function () {
        var helper = createHelper();
        var context = {
            productEligibilityMode: 'online_and_searchable'
        };

        assert.isTrue(helper.isProductEligible({
            online: true,
            searchable: true
        }, context));
        assert.isFalse(helper.isProductEligible({
            online: false,
            searchable: true
        }, context));
        assert.isFalse(helper.isProductEligible({
            online: true,
            searchable: false
        }, context));
    });

    it('uses SFCC status methods when the product exposes them', function () {
        var helper = createHelper();
        var context = {
            productEligibilityMode: 'online_and_searchable'
        };

        assert.isTrue(helper.isProductEligible({
            online: false,
            searchable: false,
            isOnline: function () {
                return true;
            },
            isSearchable: function () {
                return true;
            }
        }, context));
    });

    it('requires both the master and variant to be eligible', function () {
        var helper = createHelper();
        var context = {
            productEligibilityMode: 'online_and_searchable'
        };
        var eligibleVariant = {
            ID: 'ELIGIBLE',
            online: true,
            searchable: true
        };
        var offlineVariant = {
            ID: 'OFFLINE',
            online: false,
            searchable: true
        };
        var eligibleMaster = {
            online: true,
            searchable: true,
            variants: createVariants([eligibleVariant, offlineVariant])
        };
        var offlineMaster = {
            online: false,
            searchable: true
        };

        assert.deepEqual(helper.getEligibleVariants(eligibleMaster, context), [eligibleVariant]);
        assert.isFalse(helper.isVariantEligible(eligibleVariant, offlineMaster, context));
    });
});
