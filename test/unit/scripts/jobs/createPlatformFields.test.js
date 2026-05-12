'use strict';

var path = require('path');
var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();

describe('createPlatformFields job', function () {
    it('reads a JSON file from IMPEX and creates platform fields through the helper', function () {
        var capturedConfig = null;
        var job = proxyquire(path.resolve(__dirname, '../../../../cartridges/bm_coveo/cartridge/scripts/jobs/createPlatformFields'), {
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
                                profileId: 'mondou-commerce-fields',
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
            '*/cartridge/scripts/helper/platformFieldHelper': {
                createFieldsFromConfig: function (config) {
                    capturedConfig = config;

                    return {
                        profileId: 'mondou-commerce-fields',
                        siteId: 'RefArch',
                        organizationId: 'my-org',
                        fieldsRequested: 2,
                        response: {
                            ok: true,
                            object: {}
                        }
                    };
                }
            }
        });
        var status = job.execute({
            get: function () {
                return '/src/coveo/config/field-mappings/mondou-commerce-fields.json';
            }
        });

        assert.strictEqual(status.status, 'OK');
        assert.strictEqual(capturedConfig.profile.profileId, 'mondou-commerce-fields');
    });

    it('returns an error status when the platform field creation API call fails', function () {
        var job = proxyquire(path.resolve(__dirname, '../../../../cartridges/bm_coveo/cartridge/scripts/jobs/createPlatformFields'), {
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
                                profileId: 'mondou-commerce-fields',
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
            '*/cartridge/scripts/helper/platformFieldHelper': {
                createFieldsFromConfig: function () {
                    return {
                        profileId: 'mondou-commerce-fields',
                        siteId: 'RefArch',
                        organizationId: 'my-org',
                        fieldsRequested: 1,
                        response: {
                            ok: false,
                            status: 'ERROR',
                            errorMessage: 'Unauthorized'
                        }
                    };
                }
            }
        });
        var status = job.execute({
            get: function () {
                return '/src/coveo/config/field-mappings/mondou-commerce-fields.json';
            }
        });

        assert.strictEqual(status.status, 'ERROR');
        assert.match(status.message, /Unauthorized/);
    });

    it('includes failed field names when per-field fallback still fails', function () {
        var job = proxyquire(path.resolve(__dirname, '../../../../cartridges/bm_coveo/cartridge/scripts/jobs/createPlatformFields'), {
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
                                profileId: 'mondou-commerce-fields',
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
            '*/cartridge/scripts/helper/platformFieldHelper': {
                createFieldsFromConfig: function () {
                    return {
                        profileId: 'mondou-commerce-fields',
                        siteId: 'RefArch',
                        organizationId: 'my-org',
                        fieldsRequested: 2,
                        response: {
                            ok: false,
                            status: 'ERROR',
                            error: 400,
                            errorMessage: 'INVALID_JSON'
                        },
                        individualResults: {
                            failed: [{
                                name: 'ec_bird_type',
                                response: {
                                    ok: false,
                                    status: 'ERROR',
                                    error: 400,
                                    errorMessage: 'INVALID_JSON'
                                }
                            }]
                        }
                    };
                }
            }
        });
        var status = job.execute({
            get: function () {
                return '/src/coveo/config/field-mappings/mondou-commerce-fields.json';
            }
        });

        assert.strictEqual(status.status, 'ERROR');
        assert.match(status.message, /ec_bird_type/);
    });
});
