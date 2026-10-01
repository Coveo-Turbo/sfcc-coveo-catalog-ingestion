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

function createTargetHelper(targetCustom, fieldMappings) {
    return proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/helper/exportTargetHelper'), {
        '*/cartridge/scripts/helper/fieldMappingHelper': {
            buildFieldMappingContext: function () {
                return {
                    mappingProfileId: targetCustom.mappingProfileId || '',
                    mappingProfile: null,
                    fieldMappings: fieldMappings || []
                };
            }
        },
        'dw/object/CustomObjectMgr': {
            getCustomObject: function () {
                return {
                    custom: targetCustom
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
                        coveoOrganizationId: 'orgid',
                        coveoSourceId: 'legacy-source'
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
        delete global.request;
    });

    it('normalizes configured alternate locales and derives generated field names', function () {
        var helper = createTargetHelper({
            siteId: 'RefArch',
            locale: 'en_CA',
            language: 'en',
            alternateLocales: ' fr_CA; de_DE\nfr_ca ',
            coveoSourceId: 'source-en',
            enabled: true
        });
        var context = helper.resolveExportContext({
            get: function (name) {
                return name === 'targetId' ? 'en-ca' : '';
            }
        });

        assert.deepEqual(context.alternateLocales, ['fr_CA', 'de_DE']);
        assert.deepEqual(context.alternateLocalizations, [{
            locale: 'fr_CA',
            language: 'fr',
            nameField: 'ec_name_fr',
            descriptionField: 'ec_description_fr',
            shortDescriptionField: 'ec_shortdesc_fr'
        }, {
            locale: 'de_DE',
            language: 'de',
            nameField: 'ec_name_de',
            descriptionField: 'ec_description_de',
            shortDescriptionField: 'ec_shortdesc_de'
        }]);
    });

    it('rejects alternate locales that reuse a language suffix or a mapped field', function () {
        var duplicateHelper = createTargetHelper({
            siteId: 'RefArch',
            locale: 'en_CA',
            language: 'en',
            alternateLocales: 'fr_CA,fr_FR',
            coveoSourceId: 'source-en',
            enabled: true
        });
        var collisionHelper = createTargetHelper({
            siteId: 'RefArch',
            locale: 'en_CA',
            language: 'en',
            alternateLocales: 'fr_CA',
            coveoSourceId: 'source-en',
            mappingProfileId: 'profile',
            enabled: true
        }, [{
            mappingId: 'localized-name',
            targetField: 'EC_NAME_FR'
        }]);
        var parameters = {
            get: function (name) {
                return name === 'targetId' ? 'en-ca' : '';
            }
        };

        assert.throws(function () {
            duplicateHelper.resolveExportContext(parameters);
        }, /multiple alternate locales.*fr/i);
        assert.throws(function () {
            collisionHelper.resolveExportContext(parameters);
        }, /conflicts with generated alternate-language field ec_name_fr/);
    });

    it('restores the request locale after alternate localized work succeeds or fails', function () {
        var helper = createTargetHelper({});

        global.request = {
            locale: 'en_CA',
            setLocale: function (locale) {
                this.locale = locale;
                return true;
            }
        };

        assert.strictEqual(helper.withRequestLocale('fr_CA', function () {
            assert.strictEqual(global.request.locale, 'fr_CA');
            return 'localized';
        }), 'localized');
        assert.strictEqual(global.request.locale, 'en_CA');

        assert.throws(function () {
            helper.withRequestLocale('fr_CA', function () {
                throw new Error('localized failure');
            });
        }, /localized failure/);
        assert.strictEqual(global.request.locale, 'en_CA');
    });

    it('restores the primary locale when applying an alternate locale fails', function () {
        var helper = createTargetHelper({});

        global.request = {
            locale: 'en_CA',
            setLocale: function (locale) {
                this.locale = locale;
                return locale !== 'fr_CA';
            }
        };

        assert.throws(function () {
            helper.withRequestLocale('fr_CA', function () {
                throw new Error('should not execute');
            });
        }, /Unable to apply configured alternate locale fr_CA/);
        assert.strictEqual(global.request.locale, 'en_CA');
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
        assert.strictEqual(context.catalogStructureMode, 'product_only');
        assert.strictEqual(context.productEligibilityMode, 'legacy');
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
                catalogStructureMode: 'product_only',
                productEligibilityMode: 'online_and_searchable',
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
        assert.strictEqual(context.catalogStructureMode, 'product_only');
        assert.strictEqual(context.productEligibilityMode, 'online_and_searchable');
        assert.strictEqual(context.mappingProfileId, 'fr-profile');
        assert.lengthOf(context.fieldMappings, 1);
        assert.strictEqual(requestedTarget.custom.lastSync, lastSync);
    });

    it('defaults blank target catalogStructureMode values to product_only', function () {
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
                            catalogStructureMode: '',
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
                return name === 'targetId' ? 'en-ca' : '';
            }
        });

        assert.strictEqual(context.catalogStructureMode, 'product_only');
        assert.strictEqual(context.productEligibilityMode, 'legacy');
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
        assert.lengthOf(groups[0].existingListingReadContexts, 2);
        assert.deepEqual(groups[0].exportContexts.map(function (context) {
            return context.locale;
        }), ['en_CA', 'fr_CA']);
        assert.deepEqual(groups[0].existingListingReadContexts.map(function (context) {
            return context.coveoTrackingId;
        }), ['mondou', 'mondou']);
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

    it('rejects unsupported catalogStructureMode values', function () {
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
                            catalogStructureMode: 'variants_only',
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
                get: function (name) {
                    return name === 'targetId' ? 'en-ca' : '';
                }
            });
        }, /unsupported catalogStructureMode value "variants_only"/);
    });

    it('rejects unsupported productEligibilityMode values', function () {
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
                            productEligibilityMode: 'orderable',
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
                get: function (name) {
                    return name === 'targetId' ? 'en-ca' : '';
                }
            });
        }, /unsupported productEligibilityMode value "orderable"/);
    });
});
