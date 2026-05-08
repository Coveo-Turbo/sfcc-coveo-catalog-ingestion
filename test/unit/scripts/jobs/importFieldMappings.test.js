'use strict';

var path = require('path');
var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();

describe('importFieldMappings job', function () {
    it('reads a JSON file from IMPEX and imports it through the helper', function () {
        var capturedConfig = null;
        var capturedOptions = null;
        var job = proxyquire(path.resolve(__dirname, '../../../../cartridges/bm_coveo/cartridge/scripts/jobs/importFieldMappings'), {
            'dw/io/File': (function () {
                function File(fullPath) {
                    this.fullPath = fullPath;
                }

                File.IMPEX = '/impex';
                File.SEPARATOR = '/';
                File.prototype.exists = function () {
                    return true;
                };

                return File;
            }()),
            'dw/io/FileReader': function FileReader() {
                return {
                    getString: function () {
                        return JSON.stringify({
                            profile: {
                                profileId: 'default-profile',
                                siteId: 'RefArch'
                            },
                            mappings: []
                        });
                    },
                    close: function () {}
                };
            },
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
            '*/cartridge/scripts/helper/fieldMappingImportHelper': {
                importFromConfig: function (config, options) {
                    capturedConfig = config;
                    capturedOptions = options;

                    return {
                        profileId: 'default-profile',
                        siteId: 'RefArch',
                        mappingsImported: 0
                    };
                }
            }
        });
        var status = job.execute({
            get: function (name) {
                var values = {
                    sourceFile: '/src/coveo/config/field-mappings/default-profile.json',
                    replaceExistingMappings: true
                };

                return values[name];
            }
        });

        assert.strictEqual(status.status, 'OK');
        assert.strictEqual(capturedConfig.profile.profileId, 'default-profile');
        assert.isTrue(capturedOptions.replaceExistingMappings);
    });

    it('returns an error status when the input file does not exist', function () {
        var helperCalled = false;
        var job = proxyquire(path.resolve(__dirname, '../../../../cartridges/bm_coveo/cartridge/scripts/jobs/importFieldMappings'), {
            'dw/io/File': (function () {
                function File(fullPath) {
                    this.fullPath = fullPath;
                }

                File.IMPEX = '/impex';
                File.SEPARATOR = '/';
                File.prototype.exists = function () {
                    return false;
                };

                return File;
            }()),
            'dw/io/FileReader': function FileReader() {
                throw new Error('Should not read a missing file.');
            },
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
            '*/cartridge/scripts/helper/fieldMappingImportHelper': {
                importFromConfig: function () {
                    helperCalled = true;
                }
            }
        });
        var status = job.execute({
            get: function (name) {
                var values = {
                    sourceFile: '/src/coveo/config/field-mappings/missing.json',
                    replaceExistingMappings: false
                };

                return values[name];
            }
        });

        assert.strictEqual(status.status, 'ERROR');
        assert.isFalse(helperCalled);
        assert.match(status.message, /does not exist under IMPEX/);
    });
});
