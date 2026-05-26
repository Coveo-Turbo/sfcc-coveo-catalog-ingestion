'use strict';

var path = require('path');
var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();

describe('listingPageService', function () {
    it('builds Public Listing Page API endpoints with tracking ID query parameters', function () {
        var calls = [];
        var service = proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/helper/listingPageService'), {
            '*/cartridge/scripts/utils/coveoConstant': {
                COVEO_HTTP_METHOD: {
                    GET: 'GET',
                    POST: 'POST',
                    PUT: 'PUT'
                }
            },
            '*/cartridge/scripts/services/platformService': {
                resolvePlatformRequestUrl: function (endpoint) {
                    return 'https://platform-ca.cloud.coveo.com/rest/organizations/' + endpoint;
                },
                createPlatformRequest: function (method, endpoint, headers) {
                    calls.push({
                        method: method,
                        endpoint: endpoint,
                        headers: headers
                    });

                    return {
                        call: function (payload) {
                            calls[calls.length - 1].payload = payload;
                            return {
                                ok: true,
                                object: {}
                            };
                        }
                    };
                }
            }
        });
        var exportContext = {
            coveoOrganizationId: 'mondouorg',
            coveoTrackingId: 'mondou ca'
        };

        service.getListingPagesPage(exportContext, 2);
        service.bulkCreateListingPages(exportContext, [{
            name: 'Cat'
        }]);
        service.bulkUpdateListingPages(exportContext, [{
            id: 'page-id',
            name: 'Dog'
        }]);

        assert.strictEqual(calls[0].method, 'GET');
        assert.strictEqual(calls[0].endpoint, 'mondouorg/commerce/v2/listings/pages?trackingId=mondou%20ca&perPage=1000&page=2');
        assert.isTrue(calls[0].headers.useCredentialAuth);
        assert.strictEqual(calls[1].method, 'POST');
        assert.strictEqual(calls[1].endpoint, 'mondouorg/commerce/v2/listings/pages/bulk-create');
        assert.strictEqual(calls[1].payload, '[{"name":"Cat"}]');
        assert.strictEqual(calls[2].method, 'PUT');
        assert.strictEqual(calls[2].endpoint, 'mondouorg/commerce/v2/listings/pages/bulk-update');
        assert.strictEqual(calls[2].payload, '[{"id":"page-id","name":"Dog"}]');
        assert.strictEqual(
            service.buildListingPagesRequestUrl(exportContext, '/bulk-create'),
            'https://platform-ca.cloud.coveo.com/rest/organizations/mondouorg/commerce/v2/listings/pages/bulk-create'
        );
        assert.strictEqual(
            service.serializeListingPagePayload([{
                name: 'Cat'
            }, {
                name: 'Dog'
            }]),
            '[{"name":"Cat"},{"name":"Dog"}]'
        );
    });
});
