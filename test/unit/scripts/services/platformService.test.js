'use strict';

var path = require('path');
var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();

describe('platformService', function () {
    var capturedServiceId;
    var capturedConfig;

    beforeEach(function () {
        global.empty = function (value) {
            return value === null
                || value === undefined
                || value === ''
                || (Array.isArray(value) && value.length === 0);
        };
        capturedServiceId = null;
        capturedConfig = null;
    });

    afterEach(function () {
        delete global.empty;
    });

    function createServiceStub(password) {
        return {
            createService: function (serviceId, config) {
                capturedServiceId = serviceId;
                capturedConfig = config;

                return {
                    call: function (args) {
                        var serviceInstance = {
                            URL: 'https://platform.cloud.coveo.com/rest/organizations/',
                            headers: {},
                            method: '',
                            configuration: {
                                credential: {
                                    password: password
                                }
                            },
                            addHeader: function (name, value) {
                                this.headers[name] = value;
                            },
                            setRequestMethod: function (method) {
                                this.method = method;
                            }
                        };
                        var body = config.createRequest(serviceInstance, args);

                        return {
                            body: body,
                            serviceInstance: serviceInstance
                        };
                    }
                };
            }
        };
    }

    function createPlatformService(password) {
        return proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/services/platformService'), {
            'dw/svc/LocalServiceRegistry': createServiceStub(password),
            'dw/system/Logger': {
                getLogger: function () {
                    return {
                        error: function () {}
                    };
                }
            },
            '*/cartridge/scripts/utils/coveoConstant': {
                SERVICE_ID: {
                    COVEO_PLATFORM: 'int.coveo.platform.api'
                }
            }
        });
    }

    it('builds authenticated Platform API requests relative to /rest/organizations/', function () {
        var platformService = createPlatformService('api-key');
        var request = platformService.createPlatformRequest('POST', 'org-id/commerce/v2/listings/pages/bulk-create', {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            useCredentialAuth: true
        });

        var result = request.call([{
            name: 'Cat'
        }]);

        assert.strictEqual(capturedServiceId, 'int.coveo.platform.api');
        assert.strictEqual(result.serviceInstance.URL, 'https://platform.cloud.coveo.com/rest/organizations/org-id/commerce/v2/listings/pages/bulk-create');
        assert.strictEqual(result.serviceInstance.method, 'POST');
        assert.strictEqual(result.serviceInstance.headers.Authorization, 'Bearer api-key');
        assert.strictEqual(result.serviceInstance.headers.Accept, 'application/json');
        assert.strictEqual(result.body, '[{"name":"Cat"}]');
    });

    it('parses JSON responses and preserves non-JSON response text', function () {
        var platformService = createPlatformService('api-key');

        platformService.createPlatformRequest('GET', 'org-id/commerce/v2/listings/pages', {});

        assert.deepEqual(capturedConfig.parseResponse({}, {
            text: '{"items":[{"name":"Cat"}]}'
        }), {
            items: [{
                name: 'Cat'
            }]
        });
        assert.deepEqual(capturedConfig.parseResponse({}, {
            text: 'not-json'
        }), {
            text: 'not-json'
        });
    });

    it('fails fast when the Platform API credential password is empty', function () {
        var platformService = createPlatformService('');
        var request = platformService.createPlatformRequest('GET', 'org-id/commerce/v2/listings/pages', {
            useCredentialAuth: true
        });

        assert.throws(function () {
            request.call();
        }, /Platform API credential password is empty/);
    });
});
