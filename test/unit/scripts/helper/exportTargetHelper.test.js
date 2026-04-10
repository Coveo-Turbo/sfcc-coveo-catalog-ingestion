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
                            coveoOrganizationId: 'org-id',
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
        assert.strictEqual(context.coveoOrganizationId, 'org-id');
        assert.strictEqual(context.coveoSourceId, 'source-id');
    });

    it('throws when multiple targets exist and no targetId was provided', function () {
        var helper = proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/helper/exportTargetHelper'), {
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
                            coveoOrganizationId: 'org-id',
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

    it('resolves a specific target id and updates its last sync independently', function () {
        var requestedTarget = {
            custom: {
                siteId: 'RefArch',
                locale: 'fr_CA',
                language: 'fr',
                coveoSourceId: 'source-fr',
                catalogId: 'fr-catalog',
                enabled: true,
                lastSync: null,
                label: 'French Canada'
            }
        };
        var helper = proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/helper/exportTargetHelper'), {
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
                            coveoOrganizationId: 'org-id',
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
        assert.strictEqual(context.catalogId, 'fr-catalog');
        assert.strictEqual(requestedTarget.custom.lastSync, lastSync);
    });
});
