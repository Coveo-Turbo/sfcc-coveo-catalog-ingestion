'use strict';

var path = require('path');
var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();

function createDefinition(options) {
    var definition = options || {};

    return {
        ID: definition.id,
        displayName: definition.displayName || definition.id,
        system: definition.system === true,
        localizable: definition.localizable === true,
        multiValueType: definition.multiValueType === true,
        valueTypeCode: definition.valueTypeCode,
        attributeGroups: (definition.groupIds || []).map(function (groupId) {
            return {
                ID: groupId
            };
        }),
        values: (definition.values || []).map(function (entry) {
            return {
                value: entry.value,
                displayValue: entry.displayValue
            };
        })
    };
}

function createTypeDefinition(definitions) {
    return {
        attributeDefinitions: definitions
    };
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

function createHelper() {
    return proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/helper/catalogAttributeAuditHelper'), {
        'dw/util/ArrayList': function ArrayList(values) {
            return {
                toArray: function () {
                    return Array.isArray(values) ? values : [values];
                }
            };
        },
        'dw/util/HashMap': function HashMap() {
            var store = {};

            return {
                containsKey: function (key) {
                    return Object.prototype.hasOwnProperty.call(store, key);
                },
                isEmpty: function () {
                    return Object.keys(store).length === 0;
                },
                put: function (key, value) {
                    store[key] = value;
                },
                values: function () {
                    return Object.keys(store).map(function (key) {
                        return store[key];
                    });
                }
            };
        },
        'dw/object/ObjectAttributeDefinition': {
            VALUE_TYPE_BOOLEAN: 8,
            VALUE_TYPE_ENUM_OF_STRING: 33,
            VALUE_TYPE_HTML: 5,
            VALUE_TYPE_SET_OF_STRING: 23,
            VALUE_TYPE_STRING: 3
        }
    });
}

describe('catalogAttributeAuditHelper', function () {
    it('builds populated attribute summaries for products and primary categories', function () {
        var helper = createHelper();
        var productDefinitions = [
            createDefinition({
                id: 'name',
                displayName: 'Name',
                system: true,
                valueTypeCode: 3,
                groupIds: ['Presentation']
            }),
            createDefinition({
                id: 'AnimalType',
                displayName: 'Animal Type',
                system: false,
                localizable: true,
                valueTypeCode: 33,
                groupIds: ['MondouStorefrontAttributes'],
                values: [
                    {value: 'dog', displayValue: 'Dog'},
                    {value: 'cat', displayValue: 'Cat'}
                ]
            }),
            createDefinition({
                id: 'badges',
                displayName: 'Badges',
                system: false,
                multiValueType: true,
                valueTypeCode: 23,
                groupIds: ['MondouStorefrontAttributes']
            })
        ];
        var categoryDefinitions = [
            createDefinition({
                id: 'sizeChartID',
                displayName: 'Size Chart',
                system: false,
                valueTypeCode: 3,
                groupIds: ['Navigation']
            })
        ];
        var primaryCategory = {
            ID: 'DOG-FOOD',
            custom: {
                sizeChartID: 'dog-size-chart'
            },
            describe: function () {
                return createTypeDefinition(categoryDefinitions);
            }
        };
        var products = [
            {
                ID: 'MASTER-1',
                master: true,
                name: 'Kibble',
                custom: {
                    AnimalType: 'dog',
                    badges: ['featured', 'sale']
                },
                primaryCategory: primaryCategory,
                describe: function () {
                    return createTypeDefinition(productDefinitions);
                }
            },
            {
                ID: 'VARIANT-1',
                variant: true,
                name: 'Kibble Large',
                custom: {
                    AnimalType: ''
                },
                masterProduct: {
                    primaryCategory: primaryCategory
                },
                describe: function () {
                    return createTypeDefinition(productDefinitions);
                }
            }
        ];
        var report = helper.buildCatalogAttributeAudit(createIterator(products), {
            siteId: 'RefArch',
            catalogId: 'mondou_CA-storefront',
            locale: 'en_CA',
            sampleLimit: 3
        });
        var productName = report.productAttributes.filter(function (attribute) {
            return attribute.attributeId === 'name';
        })[0];
        var animalType = report.productAttributes.filter(function (attribute) {
            return attribute.attributeId === 'AnimalType';
        })[0];
        var badges = report.productAttributes.filter(function (attribute) {
            return attribute.attributeId === 'badges';
        })[0];
        var sizeChart = report.primaryCategoryAttributes.filter(function (attribute) {
            return attribute.attributeId === 'sizeChartID';
        })[0];

        assert.strictEqual(report.scanSummary.productsScanned, 2);
        assert.strictEqual(report.scanSummary.productsByType.master, 1);
        assert.strictEqual(report.scanSummary.productsByType.variant, 1);

        assert.strictEqual(productName.productCountWithValue, 2);
        assert.strictEqual(productName.populatedByProductType.master, 1);
        assert.strictEqual(productName.populatedByProductType.variant, 1);

        assert.strictEqual(animalType.productCountWithValue, 1);
        assert.strictEqual(animalType.suggestedValueMode, 'displayValue');
        assert.deepEqual(animalType.sampleRawValues, ['dog']);
        assert.deepEqual(animalType.sampleDisplayValues, ['Dog']);

        assert.isTrue(badges.multiValue);
        assert.deepEqual(badges.sampleRawValues, ['featured | sale']);

        assert.strictEqual(sizeChart.productCountWithValue, 2);
        assert.strictEqual(sizeChart.categoryCountWithValue, 1);
        assert.deepEqual(sizeChart.usableSourceObjects, ['primaryCategory']);
    });

    it('builds a CSV summary from the audit report', function () {
        var helper = createHelper();
        var csv = helper.buildAuditCsv({
            productAttributes: [{
                attributeId: 'AnimalType',
                displayName: 'Animal Type',
                system: false,
                localizable: true,
                multiValue: false,
                valueType: 'enum-of-string',
                suggestedValueMode: 'displayValue',
                groupIds: ['MondouStorefrontAttributes'],
                productCountWithValue: 10,
                categoryCountWithValue: 0,
                populatedByProductType: {
                    master: 4,
                    variant: 6,
                    standard: 0,
                    bundle: 0,
                    set: 0
                },
                sampleRawValues: ['dog'],
                sampleDisplayValues: ['Dog']
            }],
            primaryCategoryAttributes: []
        });

        assert.match(csv, /sourceObject,attributeId,displayName/);
        assert.match(csv, /product\/masterProduct,AnimalType,Animal Type/);
        assert.match(csv, /displayValue/);
    });

    it('does not crash when an SFCC product throws on unknown property access', function () {
        var helper = createHelper();
        var productDefinitions = [
            createDefinition({
                id: 'name',
                displayName: 'Name',
                system: true,
                valueTypeCode: 3
            })
        ];
        var product = {
            get master() {
                return false;
            },
            get variant() {
                return false;
            },
            get bundle() {
                return false;
            },
            get productSet() {
                throw new Error("Unknown property 'productSet' for class 'class dw.catalog.Product'.");
            },
            ID: 'STANDARD-1',
            name: 'Leash',
            describe: function () {
                return createTypeDefinition(productDefinitions);
            }
        };
        var report = helper.buildCatalogAttributeAudit(createIterator([product]), {
            siteId: 'RefArch',
            catalogId: 'mondou_CA-storefront',
            locale: 'en_CA',
            sampleLimit: 3
        });

        assert.strictEqual(report.scanSummary.productsScanned, 1);
        assert.strictEqual(report.scanSummary.productsByType.standard, 1);
        assert.strictEqual(report.productAttributes[0].attributeId, 'name');
    });

    it('does not crash when an enum-like product value throws on unknown toArray access', function () {
        var helper = createHelper();
        var productDefinitions = [
            createDefinition({
                id: 'AnimalType',
                displayName: 'Animal Type',
                system: false,
                localizable: true,
                valueTypeCode: 33,
                values: [
                    {value: 'dog', displayValue: 'Dog'}
                ]
            })
        ];
        var enumValue = {
            get displayValue() {
                return 'Dog';
            },
            get value() {
                return 'dog';
            },
            get toArray() {
                throw new Error("Unknown property 'toArray' for class 'class dw.value.EnumValue'.");
            }
        };
        var product = {
            ID: 'STANDARD-2',
            custom: {
                AnimalType: enumValue
            },
            describe: function () {
                return createTypeDefinition(productDefinitions);
            }
        };
        var report = helper.buildCatalogAttributeAudit(createIterator([product]), {
            siteId: 'RefArch',
            catalogId: 'mondou_CA-storefront',
            locale: 'en_CA',
            sampleLimit: 3
        });

        assert.strictEqual(report.scanSummary.productsScanned, 1);
        assert.deepEqual(report.productAttributes[0].sampleRawValues, ['dog']);
        assert.deepEqual(report.productAttributes[0].sampleDisplayValues, ['Dog']);
    });

    it('does not crash when a declared system product attribute is unreadable in script context', function () {
        var helper = createHelper();
        var productDefinitions = [
            createDefinition({
                id: 'localizedTaxClassID',
                displayName: 'Localized Tax Class',
                system: true,
                valueTypeCode: 3
            }),
            createDefinition({
                id: 'name',
                displayName: 'Name',
                system: true,
                valueTypeCode: 3
            })
        ];
        var product = {
            ID: 'STANDARD-3',
            get localizedTaxClassID() {
                throw new Error("Unknown property 'localizedTaxClassID' for class 'class dw.catalog.Product'.");
            },
            name: 'Harness',
            describe: function () {
                return createTypeDefinition(productDefinitions);
            }
        };
        var report = helper.buildCatalogAttributeAudit(createIterator([product]), {
            siteId: 'RefArch',
            catalogId: 'mondou_CA-storefront',
            locale: 'en_CA',
            sampleLimit: 3
        });

        assert.strictEqual(report.scanSummary.productsScanned, 1);
        assert.strictEqual(report.productAttributes.length, 1);
        assert.strictEqual(report.productAttributes[0].attributeId, 'name');
    });
});
