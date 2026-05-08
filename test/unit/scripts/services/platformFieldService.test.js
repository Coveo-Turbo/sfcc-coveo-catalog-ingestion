'use strict';

var path = require('path');
var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();

describe('platformFieldService', function () {
    it('serializes field definitions as a JSON array string before calling the service', function () {
        var capturedServiceId = null;
        var capturedMethod = null;
        var capturedEndpoint = null;
        var capturedHeaders = null;
        var capturedPayload = null;
        var service = proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/services/platformFieldService'), {
            '*/cartridge/scripts/services/streamService': {
                createServiceRequest: function (serviceId, method, endPoint, headers) {
                    capturedServiceId = serviceId;
                    capturedMethod = method;
                    capturedEndpoint = endPoint;
                    capturedHeaders = headers;

                    return {
                        call: function (payload) {
                            capturedPayload = payload;
                            return {
                                ok: true,
                                object: {}
                            };
                        }
                    };
                }
            },
            '*/cartridge/scripts/utils/coveoConstant': {
                SERVICE_ID: {
                    COVEO_PLATFORM: 'int.coveo.platform.http.api'
                },
                COVEO_HTTP_METHOD: {
                    POST: 'POST'
                },
                getPlatformApiEndpoints: function () {
                    return {
                        FIELDS_BATCH_CREATE: 'my-org/indexes/fields/batch/create'
                    };
                }
            }
        });

        var response = service.createFields([
            {
                name: 'ec_animal_type',
                type: 'STRING',
                facet: true
            }
        ], {
            coveoOrganizationId: 'my-org'
        });

        assert.strictEqual(capturedServiceId, 'int.coveo.platform.http.api');
        assert.strictEqual(capturedMethod, 'POST');
        assert.strictEqual(capturedEndpoint, 'my-org/indexes/fields/batch/create');
        assert.strictEqual(capturedHeaders.Accept, 'application/json');
        assert.strictEqual(capturedHeaders['Content-Type'], 'application/json');
        assert.strictEqual(capturedHeaders.useCredentialAuth, true);
        assert.strictEqual(capturedPayload, '[{"name":"ec_animal_type","type":"STRING","facet":true}]');
        assert.strictEqual(response.ok, true);
    });
});
