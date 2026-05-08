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

function createAttributeModel(definitions) {
    return {
        getAttributeDefinition: function (attributeId) {
            return Object.prototype.hasOwnProperty.call(definitions, attributeId)
                ? definitions[attributeId]
                : null;
        }
    };
}

function createTypeDefinition(customDefinitions) {
    return {
        getCustomAttributeDefinition: function (attributeId) {
            return Object.prototype.hasOwnProperty.call(customDefinitions, attributeId)
                ? customDefinitions[attributeId]
                : null;
        }
    };
}

function createHelper(customObjectMgrStub) {
    return proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/helper/fieldMappingHelper'), {
        'dw/util/ArrayList': function ArrayList(values) {
            return {
                toArray: function () {
                    return Array.isArray(values) ? values : [values];
                }
            };
        },
        'dw/object/CustomObjectMgr': customObjectMgrStub,
        'dw/system/Logger': {
            getLogger: function () {
                return {
                    warn: function () {}
                };
            }
        },
        'dw/object/ObjectAttributeDefinition': {
            VALUE_TYPE_SET_OF_NUMBER: 'set-of-number',
            VALUE_TYPE_SET_OF_STRING: 'set-of-string',
            VALUE_TYPE_SET_OF_INT: 'set-of-int'
        }
    });
}

function createHelperWithLogger(customObjectMgrStub, logger) {
    return proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/helper/fieldMappingHelper'), {
        'dw/util/ArrayList': function ArrayList(values) {
            return {
                toArray: function () {
                    return Array.isArray(values) ? values : [values];
                }
            };
        },
        'dw/object/CustomObjectMgr': customObjectMgrStub,
        'dw/system/Logger': {
            getLogger: function () {
                return logger;
            }
        },
        'dw/object/ObjectAttributeDefinition': {
            VALUE_TYPE_SET_OF_NUMBER: 'set-of-number',
            VALUE_TYPE_SET_OF_STRING: 'set-of-string',
            VALUE_TYPE_SET_OF_INT: 'set-of-int'
        }
    });
}

describe('fieldMappingHelper', function () {
    it('returns an empty mapping context when no mapping profile is configured', function () {
        var helper = createHelper({
            getCustomObject: function () {
                throw new Error('Should not resolve a profile when mappingProfileId is empty.');
            },
            queryCustomObjects: function () {
                throw new Error('Should not query mapping rows when mappingProfileId is empty.');
            }
        });

        var context = helper.buildFieldMappingContext({
            siteId: 'RefArch',
            mappingProfileId: ''
        });

        assert.strictEqual(context.mappingProfileId, '');
        assert.isNull(context.mappingProfile);
        assert.deepEqual(context.fieldMappings, []);
    });

    it('fails fast when a referenced mapping profile does not exist', function () {
        var helper = createHelper({
            getCustomObject: function () {
                return null;
            },
            queryCustomObjects: function () {
                return createIterator([]);
            }
        });

        assert.throws(function () {
            helper.buildFieldMappingContext({
                siteId: 'RefArch',
                mappingProfileId: 'missing-profile'
            });
        }, /No Coveo field mapping profile with profileId missing-profile exists/);
    });

    it('fails fast when a referenced mapping profile is disabled', function () {
        var helper = createHelper({
            getCustomObject: function () {
                return {
                    custom: {
                        siteId: 'RefArch',
                        enabled: false
                    }
                };
            },
            queryCustomObjects: function () {
                return createIterator([]);
            }
        });

        assert.throws(function () {
            helper.buildFieldMappingContext({
                siteId: 'RefArch',
                mappingProfileId: 'disabled-profile'
            });
        }, /mapping profile disabled-profile is disabled/);
    });

    it('rejects duplicate target fields within a profile', function () {
        var helper = createHelper({
            getCustomObject: function () {
                return {
                    custom: {
                        siteId: 'RefArch',
                        enabled: true
                    }
                };
            },
            queryCustomObjects: function () {
                return createIterator([
                    {
                        custom: {
                            mappingId: 'material-1',
                            siteId: 'RefArch',
                            profileId: 'default-profile',
                            enabled: true,
                            sortOrder: '10',
                            appliesTo: 'Both',
                            sourceObject: 'product',
                            sourceScope: 'custom',
                            sourceAttributeId: 'material',
                            targetField: 'ec_material',
                            valueMode: 'raw'
                        }
                    },
                    {
                        custom: {
                            mappingId: 'material-2',
                            siteId: 'RefArch',
                            profileId: 'default-profile',
                            enabled: true,
                            sortOrder: '20',
                            appliesTo: 'Both',
                            sourceObject: 'product',
                            sourceScope: 'custom',
                            sourceAttributeId: 'materialCode',
                            targetField: 'EC_MATERIAL',
                            valueMode: 'raw'
                        }
                    }
                ]);
            }
        });

        assert.throws(function () {
            helper.buildFieldMappingContext({
                siteId: 'RefArch',
                mappingProfileId: 'default-profile'
            });
        }, /duplicate targetField EC_MATERIAL/);
    });

    it('rejects mappings that target protected export fields', function () {
        var helper = createHelper({
            getCustomObject: function () {
                return {
                    custom: {
                        siteId: 'RefArch',
                        enabled: true
                    }
                };
            },
            queryCustomObjects: function () {
                return createIterator([{
                    custom: {
                        mappingId: 'bad-product-id',
                        siteId: 'RefArch',
                        profileId: 'default-profile',
                        enabled: true,
                        sortOrder: '10',
                        appliesTo: 'Both',
                        sourceObject: 'product',
                        sourceScope: 'system',
                        sourceAttributeId: 'ID',
                        targetField: 'ec_product_id',
                        valueMode: 'raw'
                    }
                }]);
            }
        });

        assert.throws(function () {
            helper.buildFieldMappingContext({
                siteId: 'RefArch',
                mappingProfileId: 'default-profile'
            });
        }, /targets protected field ec_product_id/);
    });

    it('applies built-in and configured mappings across supported source objects and value modes', function () {
        var helper = createHelper({
            getCustomObject: function () {
                return {
                    custom: {
                        siteId: 'RefArch',
                        enabled: true
                    }
                };
            },
            queryCustomObjects: function () {
                return createIterator([
                    {
                        custom: {
                            mappingId: 'gender',
                            siteId: 'RefArch',
                            profileId: 'default-profile',
                            enabled: true,
                            sortOrder: '5',
                            appliesTo: 'Both',
                            sourceObject: 'primaryCategory',
                            sourceScope: 'custom',
                            sourceAttributeId: 'sizeChartID',
                            targetField: 'gender',
                            valueMode: 'raw'
                        }
                    },
                    {
                        custom: {
                            mappingId: 'sfcc-id',
                            siteId: 'RefArch',
                            profileId: 'default-profile',
                            enabled: true,
                            sortOrder: '10',
                            appliesTo: 'Both',
                            sourceObject: 'product',
                            sourceScope: 'system',
                            sourceAttributeId: 'ID',
                            targetField: 'sfcc_id',
                            valueMode: 'raw'
                        }
                    },
                    {
                        custom: {
                            mappingId: 'material',
                            siteId: 'RefArch',
                            profileId: 'default-profile',
                            enabled: true,
                            sortOrder: '20',
                            appliesTo: 'Both',
                            sourceObject: 'product',
                            sourceScope: 'custom',
                            sourceAttributeId: 'material',
                            targetField: 'ec_material',
                            valueMode: 'raw'
                        }
                    },
                    {
                        custom: {
                            mappingId: 'finish-label',
                            siteId: 'RefArch',
                            profileId: 'default-profile',
                            enabled: true,
                            sortOrder: '30',
                            appliesTo: 'Product',
                            sourceObject: 'product',
                            sourceScope: 'custom',
                            sourceAttributeId: 'finish',
                            targetField: 'ec_finish_label',
                            valueMode: 'displayValue'
                        }
                    },
                    {
                        custom: {
                            mappingId: 'size-labels',
                            siteId: 'RefArch',
                            profileId: 'default-profile',
                            enabled: true,
                            sortOrder: '40',
                            appliesTo: 'Both',
                            sourceObject: 'product',
                            sourceScope: 'custom',
                            sourceAttributeId: 'availableSizes',
                            targetField: 'ec_size_labels',
                            valueMode: 'displayValueArray'
                        }
                    },
                    {
                        custom: {
                            mappingId: 'collection',
                            siteId: 'RefArch',
                            profileId: 'default-profile',
                            enabled: true,
                            sortOrder: '50',
                            appliesTo: 'Variant',
                            sourceObject: 'masterProduct',
                            sourceScope: 'custom',
                            sourceAttributeId: 'collection',
                            targetField: 'ec_collection',
                            valueMode: 'raw'
                        }
                    },
                    {
                        custom: {
                            mappingId: 'department',
                            siteId: 'RefArch',
                            profileId: 'default-profile',
                            enabled: true,
                            sortOrder: '60',
                            appliesTo: 'Both',
                            sourceObject: 'primaryCategory',
                            sourceScope: 'custom',
                            sourceAttributeId: 'departmentCode',
                            targetField: 'ec_department',
                            valueMode: 'raw'
                        }
                    }
                ]);
            }
        });
        var exportContext = helper.buildFieldMappingContext({
            siteId: 'RefArch',
            mappingProfileId: 'default-profile'
        });
        var category = {
            custom: {
                sizeChartID: 'unisex',
                departmentCode: 'footwear'
            },
            describe: function () {
                return createTypeDefinition({
                    sizeChartID: {},
                    departmentCode: {}
                });
            }
        };
        var masterProduct = {
            custom: {
                collection: 'spring-drop'
            },
            primaryCategory: category,
            getAttributeModel: function () {
                return createAttributeModel({});
            }
        };
        var product = {
            ID: 'SKU-1',
            name: 'Chaussure FR',
            variant: true,
            masterProduct: masterProduct,
            primaryCategory: null,
            custom: {
                material: 'leather',
                finish: {
                    value: 'matte',
                    displayValue: 'Matte'
                },
                availableSizes: [{
                    value: 'small',
                    displayValue: 'Small'
                }, {
                    value: 'medium',
                    displayValue: 'Medium'
                }]
            },
            getAttributeModel: function () {
                return createAttributeModel({
                    availableSizes: {
                        valueTypeCode: 'set-of-string'
                    }
                });
            }
        };
        var productPayload = helper.applyFieldMappings({}, product, 'Product', exportContext);
        var variantPayload = helper.applyFieldMappings({}, product, 'Variant', exportContext);

        assert.strictEqual(productPayload.ec_name, 'Chaussure FR');
        assert.strictEqual(productPayload.gender, 'unisex');
        assert.strictEqual(productPayload.sfcc_id, 'SKU-1');
        assert.strictEqual(productPayload.ec_material, 'leather');
        assert.strictEqual(productPayload.ec_finish_label, 'Matte');
        assert.deepEqual(productPayload.ec_size_labels, ['Small', 'Medium']);
        assert.strictEqual(productPayload.ec_department, 'footwear');
        assert.notProperty(productPayload, 'ec_collection');

        assert.strictEqual(variantPayload.ec_name, 'Chaussure FR');
        assert.strictEqual(variantPayload.gender, 'unisex');
        assert.strictEqual(variantPayload.sfcc_id, 'SKU-1');
        assert.strictEqual(variantPayload.ec_material, 'leather');
        assert.deepEqual(variantPayload.ec_size_labels, ['Small', 'Medium']);
        assert.strictEqual(variantPayload.ec_collection, 'spring-drop');
        assert.strictEqual(variantPayload.ec_department, 'footwear');
        assert.notProperty(variantPayload, 'ec_finish_label');
    });

    it('skips a failing custom mapping without preventing later payload fields', function () {
        var logger = {
            warn: function () {},
            errorCalls: [],
            error: function () {
                this.errorCalls.push(Array.prototype.slice.call(arguments));
            }
        };
        var helper = createHelperWithLogger({
            getCustomObject: function () {
                return {
                    custom: {
                        siteId: 'RefArch',
                        enabled: true
                    }
                };
            },
            queryCustomObjects: function () {
                return createIterator([
                    {
                        custom: {
                            mappingId: 'broken-material',
                            siteId: 'RefArch',
                            profileId: 'default-profile',
                            enabled: true,
                            sortOrder: '10',
                            appliesTo: 'Both',
                            sourceObject: 'product',
                            sourceScope: 'custom',
                            sourceAttributeId: 'materialTest',
                            targetField: 'ec_material',
                            valueMode: 'displayValueArray'
                        }
                    },
                    {
                        custom: {
                            mappingId: 'department',
                            siteId: 'RefArch',
                            profileId: 'default-profile',
                            enabled: true,
                            sortOrder: '20',
                            appliesTo: 'Both',
                            sourceObject: 'primaryCategory',
                            sourceScope: 'custom',
                            sourceAttributeId: 'departmentCode',
                            targetField: 'ec_department',
                            valueMode: 'raw'
                        }
                    }
                ]);
            }
        }, logger);
        var exportContext = helper.buildFieldMappingContext({
            siteId: 'RefArch',
            mappingProfileId: 'default-profile'
        });
        var category = {
            custom: {
                departmentCode: 'footwear'
            },
            describe: function () {
                return createTypeDefinition({
                    departmentCode: {}
                });
            }
        };
        var product = {
            ID: 'SKU-1',
            name: 'Chaussure FR',
            primaryCategory: category,
            custom: {}
        };

        Object.defineProperty(product.custom, 'materialTest', {
            enumerable: true,
            get: function () {
                throw new Error('Broken attribute access');
            }
        });

        product.getAttributeModel = function () {
            return createAttributeModel({});
        };

        var payload = helper.applyFieldMappings({}, product, 'Product', exportContext);

        assert.strictEqual(payload.ec_name, 'Chaussure FR');
        assert.strictEqual(payload.ec_department, 'footwear');
        assert.notProperty(payload, 'ec_material');
        assert.lengthOf(logger.errorCalls, 1);
        assert.match(logger.errorCalls[0][0], /fieldMappingHelper-applyFieldMappings/);
    });

    it('supports array-like enum values for displayValueArray mappings', function () {
        var helper = createHelper({
            getCustomObject: function () {
                return {
                    custom: {
                        siteId: 'RefArch',
                        enabled: true
                    }
                };
            },
            queryCustomObjects: function () {
                return createIterator([
                    {
                        custom: {
                            mappingId: 'material',
                            siteId: 'RefArch',
                            profileId: 'default-profile',
                            enabled: true,
                            sortOrder: '10',
                            appliesTo: 'Both',
                            sourceObject: 'product',
                            sourceScope: 'custom',
                            sourceAttributeId: 'materialTest',
                            targetField: 'ec_material',
                            valueMode: 'displayValueArray'
                        }
                    }
                ]);
            }
        });
        var exportContext = helper.buildFieldMappingContext({
            siteId: 'RefArch',
            mappingProfileId: 'default-profile'
        });
        var materialValues = {
            0: {
                displayValue: 'Leather'
            },
            1: {
                displayValue: 'Canvas'
            },
            length: 2
        };
        var product = {
            ID: 'SKU-1',
            name: 'Chaussure FR',
            custom: {
                materialTest: materialValues
            },
            getAttributeModel: function () {
                return createAttributeModel({
                    materialTest: {
                        valueTypeCode: 'set-of-string'
                    }
                });
            }
        };

        var payload = helper.applyFieldMappings({}, product, 'Product', exportContext);

        assert.deepEqual(payload.ec_material, ['Leather', 'Canvas']);
    });

    it('supports displayValue mappings when enum values throw on unknown ID access', function () {
        var helper = createHelper({
            getCustomObject: function () {
                return {
                    custom: {
                        siteId: 'RefArch',
                        enabled: true
                    }
                };
            },
            queryCustomObjects: function () {
                return createIterator([
                    {
                        custom: {
                            mappingId: 'animal-type',
                            siteId: 'RefArch',
                            profileId: 'default-profile',
                            enabled: true,
                            sortOrder: '10',
                            appliesTo: 'Both',
                            sourceObject: 'product',
                            sourceScope: 'custom',
                            sourceAttributeId: 'animalType',
                            targetField: 'ec_animal_type',
                            valueMode: 'displayValue'
                        }
                    }
                ]);
            }
        });
        var exportContext = helper.buildFieldMappingContext({
            siteId: 'RefArch',
            mappingProfileId: 'default-profile'
        });
        var enumValue = {};
        var product = {
            ID: 'SKU-1',
            name: 'Chaussure FR',
            custom: {
                animalType: enumValue
            },
            getAttributeModel: function () {
                return createAttributeModel({});
            }
        };

        Object.defineProperty(enumValue, 'displayValue', {
            enumerable: true,
            get: function () {
                return 'Bird';
            }
        });
        Object.defineProperty(enumValue, 'ID', {
            enumerable: true,
            get: function () {
                throw new Error("Unknown property 'ID' for class 'class dw.value.EnumValue'.");
            }
        });

        var payload = helper.applyFieldMappings({}, product, 'Product', exportContext);

        assert.strictEqual(payload.ec_animal_type, 'Bird');
    });

    it('supports raw mappings when enum values throw on unknown ID access', function () {
        var helper = createHelper({
            getCustomObject: function () {
                return {
                    custom: {
                        siteId: 'RefArch',
                        enabled: true
                    }
                };
            },
            queryCustomObjects: function () {
                return createIterator([
                    {
                        custom: {
                            mappingId: 'animal-type',
                            siteId: 'RefArch',
                            profileId: 'default-profile',
                            enabled: true,
                            sortOrder: '10',
                            appliesTo: 'Both',
                            sourceObject: 'product',
                            sourceScope: 'custom',
                            sourceAttributeId: 'animalType',
                            targetField: 'ec_animal_type',
                            valueMode: 'raw'
                        }
                    }
                ]);
            }
        });
        var exportContext = helper.buildFieldMappingContext({
            siteId: 'RefArch',
            mappingProfileId: 'default-profile'
        });
        var enumValue = {};
        var product = {
            ID: 'SKU-1',
            name: 'Chaussure FR',
            custom: {
                animalType: enumValue
            },
            getAttributeModel: function () {
                return createAttributeModel({});
            }
        };

        Object.defineProperty(enumValue, 'value', {
            enumerable: true,
            get: function () {
                return 'bird';
            }
        });
        Object.defineProperty(enumValue, 'ID', {
            enumerable: true,
            get: function () {
                throw new Error("Unknown property 'ID' for class 'class dw.value.EnumValue'.");
            }
        });

        var payload = helper.applyFieldMappings({}, product, 'Product', exportContext);

        assert.strictEqual(payload.ec_animal_type, 'bird');
    });
});
