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

describe('exportTargetHelper', function () {
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

    it('falls back to the legacy site-level export context when no targets are configured', function () {
        var helper = proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/helper/exportTargetHelper'), {
            '*/cartridge/scripts/helper/fieldMappingHelper': {
                buildFieldMappingContext: function () {
                    return {
                        mappingProfileId: '',
                        mappingProfile: null,
                        fieldMappings: []
                    };
                }
            },
            'dw/object/CustomObjectMgr': {
                queryCustomObjects: function () {
                    return createIterator([]);
                }
            },
            'dw/system/Logger': {
                getLogger: function () {
                    return {
                        warn: function () {}
                    };
                }
            },
            'dw/system/Site': {
                current: {
                    ID: 'RefArch',
                    defaultLocale: 'en_CA',
                    preferences: {
                        custom: {
                            coveoOrganizationId: 'orgid',
                            coveoSourceId: 'source-id',
                            coveoCatalogLastSync: new Date('2026-01-01T00:00:00Z')
                        }
                    }
                }
            },
            'dw/system/Transaction': {
                wrap: function (callback) {
                    callback();
                }
            }
        });

        var context = helper.resolveExportContext({
            get: function () {
                return '';
            }
        });

        assert.isTrue(context.legacyMode);
        assert.strictEqual(context.siteId, 'RefArch');
        assert.strictEqual(context.locale, 'en_CA');
        assert.strictEqual(context.language, 'en');
        assert.strictEqual(context.coveoOrganizationId, 'orgid');
        assert.strictEqual(context.coveoSourceId, 'source-id');
        assert.strictEqual(context.mappingProfileId, '');
        assert.deepEqual(context.fieldMappings, []);
    });

    it('throws when multiple targets exist and no targetId was provided', function () {
        var helper = proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/helper/exportTargetHelper'), {
            '*/cartridge/scripts/helper/fieldMappingHelper': {
                buildFieldMappingContext: function () {
                    return {
                        mappingProfileId: '',
                        mappingProfile: null,
                        fieldMappings: []
                    };
                }
            },
            'dw/object/CustomObjectMgr': {
                queryCustomObjects: function () {
                    return createIterator([
                        {
                            custom: {
                                siteId: 'RefArch',
                                locale: 'en_CA',
                                language: 'en',
                                coveoSourceId: 'source-en',
                                enabled: true
                            }
                        },
                        {
                            custom: {
                                siteId: 'RefArch',
                                locale: 'fr_CA',
                                language: 'fr',
                                coveoSourceId: 'source-fr',
                                enabled: true
                            }
                        }
                    ]);
                }
            },
            'dw/system/Logger': {
                getLogger: function () {
                    return {
                        warn: function () {}
                    };
                }
            },
            'dw/system/Site': {
                current: {
                    ID: 'RefArch',
                    defaultLocale: 'en_CA',
                    preferences: {
                        custom: {
                            coveoOrganizationId: 'orgid',
                            coveoSourceId: 'legacy-source',
                            coveoCatalogLastSync: null
                        }
                    }
                }
            },
            'dw/system/Transaction': {
                wrap: function (callback) {
                    callback();
                }
            }
        });

        assert.throws(function () {
            helper.resolveExportContext({
                get: function () {
                    return '';
                }
            });
        }, /Multiple Coveo export targets/);
    });

    it('resolves a specific target id, includes its mapping profile, and updates last sync independently', function () {
        var requestedTarget = {
            custom: {
                siteId: 'RefArch',
                locale: 'fr_CA',
                language: 'fr',
                coveoSourceId: 'source-fr',
                coveoTrackingId: 'mondou_fr_ca',
                coveoCountry: 'ca',
                coveoCurrency: 'cad',
                storefrontBaseUrl: 'https://www.mondou.com',
                listingCategoryUrlTemplate: '/{categorySlugPath}',
                listingBrandUrlTemplate: '/marques/{brandSlug}',
                listingSlugAmpersandToken: 'et',
                catalogId: 'fr-catalog',
                mappingProfileId: 'fr-profile',
                enabled: true,
                lastSync: null,
                label: 'French Canada'
            }
        };
        var helper = proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/helper/exportTargetHelper'), {
            '*/cartridge/scripts/helper/fieldMappingHelper': {
                buildFieldMappingContext: function (exportContext) {
                    assert.strictEqual(exportContext.mappingProfileId, 'fr-profile');
                    return {
                        mappingProfileId: 'fr-profile',
                        mappingProfile: {
                            custom: {
                                profileId: 'fr-profile'
                            }
                        },
                        fieldMappings: [{
                            mappingId: 'material'
                        }]
                    };
                }
            },
            'dw/object/CustomObjectMgr': {
                getCustomObject: function (typeId, targetId) {
                    assert.strictEqual(typeId, 'CoveoCatalogExportTarget');
                    assert.strictEqual(targetId, 'fr-ca');
                    return requestedTarget;
                }
            },
            'dw/system/Logger': {
                getLogger: function () {
                    return {
                        warn: function () {}
                    };
                }
            },
            'dw/system/Site': {
                current: {
                    ID: 'RefArch',
                    defaultLocale: 'en_CA',
                    preferences: {
                        custom: {
                            coveoOrganizationId: 'orgid',
                            coveoSourceId: 'legacy-source',
                            coveoCatalogLastSync: null
                        }
                    }
                }
            },
            'dw/system/Transaction': {
                wrap: function (callback) {
                    callback();
                }
            }
        });

        var context = helper.resolveExportContext({
            get: function (name) {
                return name === 'targetId' ? 'fr-ca' : '';
            }
        });
        var lastSync = new Date('2026-02-01T00:00:00Z');

        helper.updateLastSync(context, lastSync);

        assert.isFalse(context.legacyMode);
        assert.strictEqual(context.targetId, 'fr-ca');
        assert.strictEqual(context.language, 'fr');
        assert.strictEqual(context.coveoTrackingId, 'mondou_fr_ca');
        assert.strictEqual(context.coveoCountry, 'CA');
        assert.strictEqual(context.coveoCurrency, 'CAD');
        assert.strictEqual(context.storefrontBaseUrl, 'https://www.mondou.com');
        assert.strictEqual(context.listingCategoryUrlTemplate, '/{categorySlugPath}');
        assert.strictEqual(context.listingBrandUrlTemplate, '/marques/{brandSlug}');
        assert.strictEqual(context.listingSlugAmpersandToken, 'et');
        assert.strictEqual(context.catalogId, 'fr-catalog');
        assert.strictEqual(context.mappingProfileId, 'fr-profile');
        assert.lengthOf(context.fieldMappings, 1);
        assert.strictEqual(requestedTarget.custom.lastSync, lastSync);
    });

    it('groups locale-specific targets by tracking id for listing sync', function () {
        var helper = proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/helper/exportTargetHelper'), {
            '*/cartridge/scripts/helper/fieldMappingHelper': {
                buildFieldMappingContext: function () {
                    return {
                        mappingProfileId: '',
                        mappingProfile: null,
                        fieldMappings: []
                    };
                }
            },
            'dw/object/CustomObjectMgr': {
                queryCustomObjects: function () {
                    return createIterator([
                        {
                            custom: {
                                targetId: 'en-ca',
                                siteId: 'RefArch',
                                locale: 'en_CA',
                                language: 'en',
                                coveoSourceId: 'source-en',
                                coveoTrackingId: 'mondou',
                                coveoCountry: 'ca',
                                coveoCurrency: 'cad',
                                storefrontBaseUrl: 'https://www.mondou.com',
                                listingCategoryUrlTemplate: '/en-CA/{categorySlugPath}',
                                listingBrandUrlTemplate: '/en-CA/brands/{brandSlug}',
                                enabled: true
                            }
                        },
                        {
                            custom: {
                                targetId: 'fr-ca',
                                siteId: 'RefArch',
                                locale: 'fr_CA',
                                language: 'fr',
                                coveoSourceId: 'source-fr',
                                coveoTrackingId: 'mondou',
                                coveoCountry: 'ca',
                                coveoCurrency: 'cad',
                                storefrontBaseUrl: 'https://www.mondou.com',
                                listingCategoryUrlTemplate: '/fr-CA/{categorySlugPath}',
                                listingBrandUrlTemplate: '/fr-CA/marques/{brandSlug}',
                                enabled: true
                            }
                        }
                    ]);
                }
            },
            'dw/system/Logger': {
                getLogger: function () {
                    return {
                        warn: function () {}
                    };
                }
            },
            'dw/system/Site': {
                current: {
                    ID: 'RefArch',
                    defaultLocale: 'en_CA',
                    preferences: {
                        custom: {
                            coveoOrganizationId: 'orgid',
                            coveoSourceId: 'legacy-source',
                            coveoCatalogLastSync: null
                        }
                    }
                }
            },
            'dw/system/Transaction': {
                wrap: function (callback) {
                    callback();
                }
            }
        });

        var groups = helper.resolveListingSyncGroups({
            get: function () {
                return '';
            }
        });

        assert.lengthOf(groups, 1);
        assert.strictEqual(groups[0].trackingId, 'mondou');
        assert.lengthOf(groups[0].exportContexts, 2);
        assert.deepEqual(groups[0].exportContexts.map(function (context) {
            return context.locale;
        }), ['en_CA', 'fr_CA']);
        assert.strictEqual(groups[0].primaryContext.locale, 'en_CA');
    });

    it('fails fast when the site-level Coveo organization id is still a placeholder', function () {
        var helper = proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/helper/exportTargetHelper'), {
            '*/cartridge/scripts/helper/fieldMappingHelper': {
                buildFieldMappingContext: function () {
                    return {
                        mappingProfileId: '',
                        mappingProfile: null,
                        fieldMappings: []
                    };
                }
            },
            'dw/object/CustomObjectMgr': {
                getCustomObject: function () {
                    return {
                        custom: {
                            siteId: 'RefArch',
                            locale: 'en_CA',
                            language: 'en',
                            coveoSourceId: 'source-en',
                            enabled: true
                        }
                    };
                }
            },
            'dw/system/Logger': {
                getLogger: function () {
                    return {
                        warn: function () {}
                    };
                }
            },
            'dw/system/Site': {
                current: {
                    ID: 'RefArch',
                    defaultLocale: 'en_CA',
                    preferences: {
                        custom: {
                            coveoOrganizationId: 'SET_REAL_ORGANIZATION_ID',
                            coveoSourceId: 'legacy-source',
                            coveoCatalogLastSync: null
                        }
                    }
                }
            },
            'dw/system/Transaction': {
                wrap: function (callback) {
                    callback();
                }
            }
        });

        assert.throws(function () {
            helper.resolveExportContext({
                get: function (name) {
                    return name === 'targetId' ? 'en-ca' : '';
                }
            });
        }, /invalid coveoOrganizationId value "SET_REAL_ORGANIZATION_ID"/);
    });
});
