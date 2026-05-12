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

function createFieldMappingValidator() {
    return proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/helper/fieldMappingHelper'), {
        'dw/util/ArrayList': function ArrayList(values) {
            return {
                toArray: function () {
                    return Array.isArray(values) ? values : [values];
                }
            };
        },
        'dw/object/CustomObjectMgr': {},
        'dw/system/Logger': {
            getLogger: function () {
                return {
                    warn: function () {},
                    error: function () {}
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

function createStore(seed) {
    var objectsByType = {
        CoveoCatalogFieldMappingProfile: {},
        CoveoCatalogFieldMapping: {}
    };

    function add(type, key, custom) {
        objectsByType[type][key] = {
            type: type,
            __key: key,
            custom: custom || {}
        };
    }

    (seed && seed.profiles ? seed.profiles : []).forEach(function (profile) {
        add('CoveoCatalogFieldMappingProfile', profile.profileId, profile);
    });

    (seed && seed.mappings ? seed.mappings : []).forEach(function (mapping) {
        add('CoveoCatalogFieldMapping', mapping.mappingId, mapping);
    });

    return {
        dump: objectsByType,
        stub: {
            getCustomObject: function (type, key) {
                return objectsByType[type][key] || null;
            },
            createCustomObject: function (type, key) {
                var object = {
                    type: type,
                    __key: key,
                    custom: {}
                };

                objectsByType[type][key] = object;
                return object;
            },
            queryCustomObjects: function (type, query, sort) { // eslint-disable-line no-unused-vars
                var values = Object.keys(objectsByType[type]).map(function (key) {
                    return objectsByType[type][key];
                });

                if (query === 'custom.siteId = {0} AND custom.profileId = {1}') {
                    var siteId = arguments[3];
                    var profileId = arguments[4];

                    values = values.filter(function (object) {
                        return object.custom.siteId === siteId && object.custom.profileId === profileId;
                    });
                }

                return createIterator(values);
            },
            remove: function (object) {
                delete objectsByType[object.type][object.__key];
            }
        }
    };
}

function createHelper(store) {
    return proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/helper/fieldMappingImportHelper'), {
        'dw/object/CustomObjectMgr': store.stub,
        'dw/system/Logger': {
            getLogger: function () {
                return {
                    info: function () {}
                };
            }
        },
        'dw/system/Site': {
            current: {
                ID: 'RefArch'
            }
        },
        'dw/system/Transaction': {
            wrap: function (callback) {
                callback();
            }
        },
        '*/cartridge/scripts/helper/fieldMappingHelper': createFieldMappingValidator()
    });
}

describe('fieldMappingImportHelper', function () {
    it('preserves optional Coveo platform field settings while normalizing the import config', function () {
        var store = createStore();
        var helper = createHelper(store);
        var normalized = helper.normalizeImportConfig({
            profile: {
                profileId: 'default-profile',
                siteId: 'RefArch',
                enabled: true
            },
            mappings: [
                {
                    mappingId: 'material',
                    appliesTo: 'Both',
                    sourceObject: 'product',
                    sourceScope: 'custom',
                    sourceAttributeId: 'material',
                    targetField: 'ec_material',
                    valueMode: 'displayValueArray',
                    coveoField: {
                        sync: false,
                        type: 'STRING',
                        facet: true,
                        multiValueFacet: true,
                        multiValueFacetTokenizers: ';',
                        useCacheForNestedQuery: true,
                        description: 'Material facet field'
                    }
                }
            ]
        });

        assert.strictEqual(normalized.profile.profileId, 'default-profile');
        assert.strictEqual(normalized.mappings[0].coveoField.type, 'STRING');
        assert.isFalse(normalized.mappings[0].coveoField.sync);
        assert.isTrue(normalized.mappings[0].coveoField.facet);
        assert.isTrue(normalized.mappings[0].coveoField.multiValueFacet);
        assert.strictEqual(normalized.mappings[0].coveoField.multiValueFacetTokenizers, ';');
        assert.isTrue(normalized.mappings[0].coveoField.useCacheForNestedQuery);
        assert.strictEqual(normalized.mappings[0].coveoField.description, 'Material facet field');
    });

    it('imports a new profile and defaults mapping siteId and profileId from the profile', function () {
        var store = createStore();
        var helper = createHelper(store);
        var summary = helper.importFromConfig({
            profile: {
                profileId: 'default-profile',
                siteId: 'RefArch',
                enabled: true,
                label: 'Default profile'
            },
            mappings: [
                {
                    mappingId: 'material',
                    appliesTo: 'Both',
                    sourceObject: 'product',
                    sourceScope: 'custom',
                    sourceAttributeId: 'material',
                    targetField: 'ec_material',
                    valueMode: 'raw'
                },
                {
                    mappingId: 'collection',
                    appliesTo: 'Variant',
                    sourceObject: 'masterProduct',
                    sourceScope: 'custom',
                    sourceAttributeId: 'collection',
                    targetField: 'ec_collection',
                    valueMode: 'raw',
                    enabled: false
                }
            ]
        }, {
            replaceExistingMappings: false
        });

        assert.isTrue(summary.profileCreated);
        assert.strictEqual(summary.mappingsImported, 2);
        assert.strictEqual(summary.mappingsCreated, 2);
        assert.strictEqual(summary.mappingsUpdated, 0);
        assert.strictEqual(summary.mappingsDeleted, 0);
        assert.strictEqual(store.dump.CoveoCatalogFieldMappingProfile['default-profile'].custom.siteId, 'RefArch');
        assert.strictEqual(store.dump.CoveoCatalogFieldMapping['material'].custom.profileId, 'default-profile');
        assert.strictEqual(store.dump.CoveoCatalogFieldMapping['material'].custom.siteId, 'RefArch');
        assert.isFalse(store.dump.CoveoCatalogFieldMapping['collection'].custom.enabled);
    });

    it('updates existing mappings and removes stale rows when replace mode is enabled', function () {
        var store = createStore({
            profiles: [{
                profileId: 'default-profile',
                siteId: 'RefArch',
                enabled: true
            }],
            mappings: [
                {
                    mappingId: 'material',
                    siteId: 'RefArch',
                    profileId: 'default-profile',
                    enabled: true,
                    sortOrder: '10',
                    appliesTo: 'Both',
                    sourceObject: 'product',
                    sourceScope: 'custom',
                    sourceAttributeId: 'legacyMaterial',
                    targetField: 'ec_material',
                    valueMode: 'raw'
                },
                {
                    mappingId: 'legacy',
                    siteId: 'RefArch',
                    profileId: 'default-profile',
                    enabled: true,
                    sortOrder: '20',
                    appliesTo: 'Both',
                    sourceObject: 'product',
                    sourceScope: 'custom',
                    sourceAttributeId: 'legacyValue',
                    targetField: 'ec_legacy',
                    valueMode: 'raw'
                }
            ]
        });
        var helper = createHelper(store);
        var summary = helper.importFromConfig({
            profile: {
                profileId: 'default-profile',
                siteId: 'RefArch',
                enabled: true
            },
            mappings: [
                {
                    mappingId: 'material',
                    appliesTo: 'Both',
                    sourceObject: 'product',
                    sourceScope: 'custom',
                    sourceAttributeId: 'material',
                    targetField: 'ec_material',
                    valueMode: 'raw'
                },
                {
                    mappingId: 'collection',
                    appliesTo: 'Variant',
                    sourceObject: 'masterProduct',
                    sourceScope: 'custom',
                    sourceAttributeId: 'collection',
                    targetField: 'ec_collection',
                    valueMode: 'raw'
                }
            ]
        }, {
            replaceExistingMappings: true
        });

        assert.isFalse(summary.profileCreated);
        assert.strictEqual(summary.mappingsCreated, 1);
        assert.strictEqual(summary.mappingsUpdated, 1);
        assert.strictEqual(summary.mappingsDeleted, 1);
        assert.strictEqual(store.dump.CoveoCatalogFieldMapping.material.custom.sourceAttributeId, 'material');
        assert.isOk(store.dump.CoveoCatalogFieldMapping.collection);
        assert.isUndefined(store.dump.CoveoCatalogFieldMapping.legacy);
    });

    it('rejects imports that target a different site than the current job context', function () {
        var store = createStore();
        var helper = createHelper(store);

        assert.throws(function () {
            helper.importFromConfig({
                profile: {
                    profileId: 'default-profile',
                    siteId: 'OtherSite',
                    enabled: true
                },
                mappings: []
            }, {
                replaceExistingMappings: false
            });
        }, /targets site OtherSite, but the current job context is site RefArch/);
    });
});
