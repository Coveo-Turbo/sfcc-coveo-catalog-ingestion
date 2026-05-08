'use strict';

var path = require('path');
var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();

function createHelper(options) {
    var capturedFields = null;
    var capturedExportContext = null;
    var helper = proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/helper/platformFieldHelper'), {
        'dw/system/Logger': {
            getLogger: function () {
                return {
                    info: function () {}
                };
            }
        },
        'dw/system/Site': {
            current: {
                preferences: {
                    custom: {
                        coveoOrganizationId: options && options.organizationId !== undefined
                            ? options.organizationId
                            : 'my-org'
                    }
                }
            }
        },
        '*/cartridge/scripts/helper/fieldMappingImportHelper': {
            normalizeImportConfig: function (config) {
                return config;
            }
        },
        '*/cartridge/scripts/helper/fieldMappingHelper': {
            validateFieldMappings: function (mappings) {
                return mappings.filter(function (mapping) {
                    return mapping.enabled !== false;
                }).map(function (mapping) {
                    return {
                        mappingId: mapping.mappingId,
                        siteId: mapping.siteId,
                        profileId: mapping.profileId,
                        enabled: mapping.enabled !== false,
                        sortOrder: mapping.sortOrder,
                        appliesTo: mapping.appliesTo,
                        sourceObject: mapping.sourceObject,
                        sourceScope: mapping.sourceScope,
                        sourceAttributeId: mapping.sourceAttributeId,
                        targetField: mapping.targetField,
                        valueMode: mapping.valueMode
                    };
                });
            }
        },
        '*/cartridge/scripts/services/platformFieldService': {
            createFields: function (fields, exportContext) {
                capturedFields = fields;
                capturedExportContext = exportContext;

                return {
                    ok: true,
                    object: {}
                };
            }
        }
    });

    helper.__getCaptured = function () {
        return {
            fields: capturedFields,
            exportContext: capturedExportContext
        };
    };

    return helper;
}

describe('platformFieldHelper', function () {
    it('builds field definitions from enabled mappings and applies sensible defaults', function () {
        var helper = createHelper();
        var result = helper.buildFieldDefinitionsFromConfig({
            profile: {
                profileId: 'mondou-commerce-fields',
                siteId: 'RefArch'
            },
            mappings: [
                {
                    mappingId: 'animal-type',
                    siteId: 'RefArch',
                    profileId: 'mondou-commerce-fields',
                    enabled: true,
                    appliesTo: 'Both',
                    sourceObject: 'product',
                    sourceScope: 'custom',
                    sourceAttributeId: 'AnimalType',
                    targetField: 'ec_animal_type',
                    valueMode: 'displayValue',
                    coveoField: {
                        facet: true
                    }
                },
                {
                    mappingId: 'specific-needs',
                    siteId: 'RefArch',
                    profileId: 'mondou-commerce-fields',
                    enabled: true,
                    appliesTo: 'Both',
                    sourceObject: 'product',
                    sourceScope: 'custom',
                    sourceAttributeId: 'specificNeeds',
                    targetField: 'ec_specific_needs',
                    valueMode: 'displayValueArray'
                },
                {
                    mappingId: 'internal-only',
                    siteId: 'RefArch',
                    profileId: 'mondou-commerce-fields',
                    enabled: true,
                    appliesTo: 'Both',
                    sourceObject: 'product',
                    sourceScope: 'custom',
                    sourceAttributeId: 'internalValue',
                    targetField: 'ec_internal_value',
                    valueMode: 'raw',
                    coveoField: {
                        sync: false
                    }
                }
            ]
        });

        assert.strictEqual(result.profile.profileId, 'mondou-commerce-fields');
        assert.strictEqual(result.fields.length, 2);
        assert.deepEqual(result.fields[0], {
            name: 'ec_animal_type',
            description: 'Generated from SFCC mapping profile mondou-commerce-fields: product.custom.AnimalType -> ec_animal_type',
            type: 'STRING',
            facet: true
        });
        assert.deepEqual(result.fields[1], {
            name: 'ec_specific_needs',
            description: 'Generated from SFCC mapping profile mondou-commerce-fields: product.custom.specificNeeds -> ec_specific_needs',
            type: 'STRING',
            multiValueFacet: true,
            multiValueFacetTokenizers: ';'
        });
    });

    it('preserves explicit multi-value facet tokenizers when provided', function () {
        var helper = createHelper();
        var result = helper.buildFieldDefinitionsFromConfig({
            profile: {
                profileId: 'mondou-commerce-fields',
                siteId: 'RefArch'
            },
            mappings: [
                {
                    mappingId: 'specific-needs',
                    siteId: 'RefArch',
                    profileId: 'mondou-commerce-fields',
                    enabled: true,
                    appliesTo: 'Both',
                    sourceObject: 'product',
                    sourceScope: 'custom',
                    sourceAttributeId: 'specificNeeds',
                    targetField: 'ec_specific_needs',
                    valueMode: 'displayValueArray',
                    coveoField: {
                        multiValueFacetTokenizers: ';,'
                    }
                }
            ]
        });

        assert.deepEqual(result.fields[0], {
            name: 'ec_specific_needs',
            description: 'Generated from SFCC mapping profile mondou-commerce-fields: product.custom.specificNeeds -> ec_specific_needs',
            type: 'STRING',
            multiValueFacet: true,
            multiValueFacetTokenizers: ';,'
        });
    });

    it('creates fields through the Platform API using the site organization id', function () {
        var helper = createHelper();
        var summary = helper.createFieldsFromConfig({
            profile: {
                profileId: 'mondou-commerce-fields',
                siteId: 'RefArch'
            },
            mappings: [
                {
                    mappingId: 'pickup',
                    siteId: 'RefArch',
                    profileId: 'mondou-commerce-fields',
                    enabled: true,
                    appliesTo: 'Both',
                    sourceObject: 'product',
                    sourceScope: 'custom',
                    sourceAttributeId: 'availableForInStorePickup',
                    targetField: 'ec_in_store_pickup',
                    valueMode: 'raw'
                }
            ]
        });
        var captured = helper.__getCaptured();

        assert.strictEqual(summary.organizationId, 'my-org');
        assert.strictEqual(summary.fieldsRequested, 1);
        assert.deepEqual(summary.fieldNames, ['ec_in_store_pickup']);
        assert.strictEqual(captured.exportContext.coveoOrganizationId, 'my-org');
        assert.strictEqual(captured.fields[0].name, 'ec_in_store_pickup');
    });

    it('falls back to individual field creation when a batch request fails', function () {
        var batchCallCount = 0;
        var helper = proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/helper/platformFieldHelper'), {
            'dw/system/Logger': {
                getLogger: function () {
                    return {
                        info: function () {}
                    };
                }
            },
            'dw/system/Site': {
                current: {
                    preferences: {
                        custom: {
                            coveoOrganizationId: 'my-org'
                        }
                    }
                }
            },
            '*/cartridge/scripts/helper/fieldMappingImportHelper': {
                normalizeImportConfig: function (config) {
                    return config;
                }
            },
            '*/cartridge/scripts/helper/fieldMappingHelper': {
                validateFieldMappings: function (mappings) {
                    return mappings;
                }
            },
            '*/cartridge/scripts/services/platformFieldService': {
                createFields: function (fields) {
                    batchCallCount += 1;

                    if (batchCallCount === 1) {
                        return {
                            ok: false,
                            status: 'ERROR',
                            error: 400,
                            errorMessage: 'INVALID_JSON'
                        };
                    }

                    return {
                        ok: true,
                        object: {}
                    };
                }
            }
        });
        var summary = helper.createFieldsFromConfig({
            profile: {
                profileId: 'mondou-commerce-fields',
                siteId: 'RefArch'
            },
            mappings: [
                {
                    mappingId: 'animal-type',
                    siteId: 'RefArch',
                    profileId: 'mondou-commerce-fields',
                    enabled: true,
                    appliesTo: 'Both',
                    sourceObject: 'product',
                    sourceScope: 'custom',
                    sourceAttributeId: 'AnimalType',
                    targetField: 'ec_animal_type',
                    valueMode: 'displayValue'
                },
                {
                    mappingId: 'bird-type',
                    siteId: 'RefArch',
                    profileId: 'mondou-commerce-fields',
                    enabled: true,
                    appliesTo: 'Both',
                    sourceObject: 'product',
                    sourceScope: 'custom',
                    sourceAttributeId: 'BirdsCategories',
                    targetField: 'ec_bird_type',
                    valueMode: 'displayValue'
                }
            ]
        });

        assert.strictEqual(summary.response.ok, true);
        assert.strictEqual(summary.fallbackMode, 'single');
        assert.deepEqual(summary.individualResults.succeeded, ['ec_animal_type', 'ec_bird_type']);
        assert.deepEqual(summary.individualResults.failed, []);
    });

    it('returns failed field details when individual fallback still fails', function () {
        var helper = proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/helper/platformFieldHelper'), {
            'dw/system/Logger': {
                getLogger: function () {
                    return {
                        info: function () {}
                    };
                }
            },
            'dw/system/Site': {
                current: {
                    preferences: {
                        custom: {
                            coveoOrganizationId: 'my-org'
                        }
                    }
                }
            },
            '*/cartridge/scripts/helper/fieldMappingImportHelper': {
                normalizeImportConfig: function (config) {
                    return config;
                }
            },
            '*/cartridge/scripts/helper/fieldMappingHelper': {
                validateFieldMappings: function (mappings) {
                    return mappings;
                }
            },
            '*/cartridge/scripts/services/platformFieldService': {
                createFields: function (fields) {
                    if (fields.length > 1) {
                        return {
                            ok: false,
                            status: 'ERROR',
                            error: 400,
                            errorMessage: 'INVALID_JSON'
                        };
                    }

                    if (fields[0].name === 'ec_bird_type') {
                        return {
                            ok: false,
                            status: 'ERROR',
                            error: 400,
                            errorMessage: 'INVALID_JSON'
                        };
                    }

                    return {
                        ok: true,
                        object: {}
                    };
                }
            }
        });
        var summary = helper.createFieldsFromConfig({
            profile: {
                profileId: 'mondou-commerce-fields',
                siteId: 'RefArch'
            },
            mappings: [
                {
                    mappingId: 'animal-type',
                    siteId: 'RefArch',
                    profileId: 'mondou-commerce-fields',
                    enabled: true,
                    appliesTo: 'Both',
                    sourceObject: 'product',
                    sourceScope: 'custom',
                    sourceAttributeId: 'AnimalType',
                    targetField: 'ec_animal_type',
                    valueMode: 'displayValue'
                },
                {
                    mappingId: 'bird-type',
                    siteId: 'RefArch',
                    profileId: 'mondou-commerce-fields',
                    enabled: true,
                    appliesTo: 'Both',
                    sourceObject: 'product',
                    sourceScope: 'custom',
                    sourceAttributeId: 'BirdsCategories',
                    targetField: 'ec_bird_type',
                    valueMode: 'displayValue'
                }
            ]
        });

        assert.strictEqual(summary.response.ok, false);
        assert.strictEqual(summary.fallbackMode, 'single');
        assert.deepEqual(summary.individualResults.succeeded, ['ec_animal_type']);
        assert.strictEqual(summary.individualResults.failed[0].name, 'ec_bird_type');
    });

    it('treats existing fields as a successful no-op', function () {
        var helper = proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/helper/platformFieldHelper'), {
            'dw/system/Logger': {
                getLogger: function () {
                    return {
                        info: function () {}
                    };
                }
            },
            'dw/system/Site': {
                current: {
                    preferences: {
                        custom: {
                            coveoOrganizationId: 'my-org'
                        }
                    }
                }
            },
            '*/cartridge/scripts/helper/fieldMappingImportHelper': {
                normalizeImportConfig: function (config) {
                    return config;
                }
            },
            '*/cartridge/scripts/helper/fieldMappingHelper': {
                validateFieldMappings: function (mappings) {
                    return mappings;
                }
            },
            '*/cartridge/scripts/services/platformFieldService': {
                createFields: function () {
                    return {
                        ok: false,
                        status: 'ERROR',
                        error: 412,
                        errorMessage: '{"message":"Fields [ec_animal_type] already exist.","errorCode":"FIELD_ALREADY_EXISTS"}'
                    };
                }
            }
        });
        var summary = helper.createFieldsFromConfig({
            profile: {
                profileId: 'mondou-commerce-fields',
                siteId: 'RefArch'
            },
            mappings: [
                {
                    mappingId: 'animal-type',
                    siteId: 'RefArch',
                    profileId: 'mondou-commerce-fields',
                    enabled: true,
                    appliesTo: 'Both',
                    sourceObject: 'product',
                    sourceScope: 'custom',
                    sourceAttributeId: 'AnimalType',
                    targetField: 'ec_animal_type',
                    valueMode: 'displayValue'
                }
            ]
        });

        assert.strictEqual(summary.response.ok, true);
    });

    it('rejects mappings whose target field is not a valid Coveo field name', function () {
        var helper = createHelper();

        assert.throws(function () {
            helper.buildFieldDefinitionsFromConfig({
                profile: {
                    profileId: 'mondou-commerce-fields',
                    siteId: 'RefArch'
                },
                mappings: [
                    {
                        mappingId: 'bad-field',
                        siteId: 'RefArch',
                        profileId: 'mondou-commerce-fields',
                        enabled: true,
                        appliesTo: 'Both',
                        sourceObject: 'product',
                        sourceScope: 'custom',
                        sourceAttributeId: 'AnimalType',
                        targetField: 'ec-bad-field',
                        valueMode: 'displayValue'
                    }
                ]
            });
        }, /not a valid Coveo field name/);
    });

    it('requires a configured Coveo organization id before calling the Platform API', function () {
        var helper = createHelper({
            organizationId: ''
        });

        assert.throws(function () {
            helper.createFieldsFromConfig({
                profile: {
                    profileId: 'mondou-commerce-fields',
                    siteId: 'RefArch'
                },
                mappings: [
                    {
                        mappingId: 'pickup',
                        siteId: 'RefArch',
                        profileId: 'mondou-commerce-fields',
                        enabled: true,
                        appliesTo: 'Both',
                        sourceObject: 'product',
                        sourceScope: 'custom',
                        sourceAttributeId: 'availableForInStorePickup',
                        targetField: 'ec_in_store_pickup',
                        valueMode: 'raw'
                    }
                ]
            });
        }, /requires the site preference coveoOrganizationId/);
    });
});
