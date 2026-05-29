'use strict';

var path = require('path');
var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();

describe('syncPurchaseEnrichment job', function () {
    it('resolves the target context, runs the helper, and restores the previous locale', function () {
        var restoredLocale = null;
        var helperParameters = null;
        var helperContext = null;
        var job = proxyquire(path.resolve(__dirname, '../../../../cartridges/bm_coveo/cartridge/scripts/jobs/syncPurchaseEnrichment'), {
            'dw/system/Logger': {
                getLogger: function () {
                    return {
                        info: function () {},
                        error: function () {}
                    };
                }
            },
            'dw/system/Status': (function () {
                function Status(status, code, message) {
                    this.status = status;
                    this.code = code;
                    this.message = message;
                }

                Status.OK = 'OK';
                Status.ERROR = 'ERROR';

                return Status;
            }()),
            '*/cartridge/scripts/helper/exportTargetHelper': {
                resolveExportContext: function () {
                    return {
                        legacyMode: false,
                        siteId: 'RefArch',
                        targetId: 'target-1',
                        locale: 'fr_CA',
                        language: 'fr',
                        coveoSourceId: 'source-1',
                        coveoTrackingId: 'tracking-1',
                        catalogId: 'catalog-1'
                    };
                },
                applyRequestLocale: function () {
                    return 'en_CA';
                },
                restoreRequestLocale: function (locale) {
                    restoredLocale = locale;
                }
            },
            '*/cartridge/scripts/helper/purchaseEnrichmentHelper': {
                syncPurchaseEnrichment: function (parameters, exportContext) {
                    helperParameters = parameters;
                    helperContext = exportContext;

                    return {
                        exportId: 'export-1',
                        fieldName: 'ec_units_sold_90d',
                        mappedProducts: 5
                    };
                }
            }
        });
        var parameters = {
            get: function (name) {
                return {
                    targetId: 'target-1'
                }[name];
            }
        };
        var status = job.execute(parameters);

        assert.strictEqual(status.status, 'OK');
        assert.strictEqual(helperParameters, parameters);
        assert.strictEqual(helperContext.targetId, 'target-1');
        assert.strictEqual(restoredLocale, 'en_CA');
        assert.match(status.message, /exportId=export-1/);
        assert.match(status.message, /field=ec_units_sold_90d/);
    });

    it('returns an error status when the helper throws', function () {
        var restoredLocale = null;
        var job = proxyquire(path.resolve(__dirname, '../../../../cartridges/bm_coveo/cartridge/scripts/jobs/syncPurchaseEnrichment'), {
            'dw/system/Logger': {
                getLogger: function () {
                    return {
                        info: function () {},
                        error: function () {}
                    };
                }
            },
            'dw/system/Status': (function () {
                function Status(status, code, message) {
                    this.status = status;
                    this.code = code;
                    this.message = message;
                }

                Status.OK = 'OK';
                Status.ERROR = 'ERROR';

                return Status;
            }()),
            '*/cartridge/scripts/helper/exportTargetHelper': {
                resolveExportContext: function () {
                    return {
                        legacyMode: false,
                        targetId: 'target-1',
                        locale: 'en_CA',
                        language: 'en',
                        coveoSourceId: 'source-1',
                        coveoTrackingId: 'tracking-1'
                    };
                },
                applyRequestLocale: function () {
                    return 'fr_CA';
                },
                restoreRequestLocale: function (locale) {
                    restoredLocale = locale;
                }
            },
            '*/cartridge/scripts/helper/purchaseEnrichmentHelper': {
                syncPurchaseEnrichment: function () {
                    throw new Error('Missing quantity dimension');
                }
            }
        });
        var status = job.execute({
            get: function () {
                return '';
            }
        });

        assert.strictEqual(status.status, 'ERROR');
        assert.match(status.message, /Missing quantity dimension/);
        assert.strictEqual(restoredLocale, 'fr_CA');
    });
});
