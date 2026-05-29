'use strict';

var path = require('path');
var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();

describe('usageAnalyticsService', function () {
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
                    URL: 'https://platform.cloud.coveo.com/rest/ua/',
                    configuration: {
                        credential: {
                            password: password
                        }
                    },
                    getConfiguration: function () {
                        return this.configuration;
                    },
                    call: function (args) {
                        var serviceInstance = {
                            URL: 'https://platform.cloud.coveo.com/rest/ua/',
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

    function createUsageAnalyticsService(password) {
        return proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/services/usageAnalyticsService'), {
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
                    COVEO_UA_READ: 'int.coveo.ua.read.api'
                }
            }
        });
    }

    it('builds authenticated Usage Analytics requests relative to /rest/ua/', function () {
        var usageAnalyticsService = createUsageAnalyticsService('ua-key');
        var request = usageAnalyticsService.createUsageAnalyticsRequest('POST', 'v15/exports/create?org=my-org', {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            useCredentialAuth: true
        });
        var result = request.call({
            from: '2026-03-01T00:00:00.000Z'
        });

        assert.strictEqual(capturedServiceId, 'int.coveo.ua.read.api');
        assert.strictEqual(result.serviceInstance.URL, 'https://platform.cloud.coveo.com/rest/ua/v15/exports/create?org=my-org');
        assert.strictEqual(result.serviceInstance.method, 'POST');
        assert.strictEqual(result.serviceInstance.headers.Authorization, 'Bearer ua-key');
        assert.strictEqual(result.body, '{"from":"2026-03-01T00:00:00.000Z"}');
        assert.strictEqual(result.requestMethod, 'POST');
        assert.strictEqual(result.requestUrl, 'https://platform.cloud.coveo.com/rest/ua/v15/exports/create?org=my-org');
    });

    it('supports direct download URLs when provided', function () {
        var usageAnalyticsService = createUsageAnalyticsService('ua-key');
        var request = usageAnalyticsService.createUsageAnalyticsRequest('GET', '', {
            Accept: 'text/csv',
            useCredentialAuth: true
        }, 'https://platform-ca.cloud.coveo.com/rest/ua/download/export.csv');
        var result = request.call();

        assert.strictEqual(result.serviceInstance.URL, 'https://platform-ca.cloud.coveo.com/rest/ua/download/export.csv');
        assert.strictEqual(result.serviceInstance.method, 'GET');
    });

    it('parses JSON responses and preserves raw CSV text', function () {
        var usageAnalyticsService = createUsageAnalyticsService('ua-key');

        usageAnalyticsService.createUsageAnalyticsRequest('GET', 'v15/exports?org=my-org', {});

        assert.deepEqual(capturedConfig.parseResponse({}, {
            text: '{"id":"export-1","status":"AVAILABLE"}'
        }), {
            id: 'export-1',
            status: 'AVAILABLE'
        });
        assert.deepEqual(capturedConfig.parseResponse({}, {
            text: 'product,qty\nsku-1,2\n'
        }), {
            text: 'product,qty\nsku-1,2\n'
        });
    });

    it('fails fast when the Usage Analytics credential password is empty', function () {
        var usageAnalyticsService = createUsageAnalyticsService('');
        var request = usageAnalyticsService.createUsageAnalyticsRequest('GET', 'v15/exports?org=my-org', {
            useCredentialAuth: true
        });

        assert.throws(function () {
            request.call();
        }, /Usage Analytics Read API credential password is empty/);
    });

    it('can read the Usage Analytics access token from the configured service credential', function () {
        var usageAnalyticsService = createUsageAnalyticsService('ua-key');

        assert.strictEqual(usageAnalyticsService.getUsageAnalyticsAccessToken(), 'ua-key');
    });
});
