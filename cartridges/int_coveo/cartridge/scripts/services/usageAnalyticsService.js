'use strict';

var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');
var Logger = require('dw/system/Logger').getLogger('Coveo');

/**
 * Returns the configured service credential password.
 * @param {Object} svc - Service instance.
 * @returns {string|null} password or null.
 */
function getServiceCredentialPassword(svc) {
    var configuration = svc.getConfiguration ? svc.getConfiguration() : svc.configuration;
    var credential = configuration && configuration.getCredential ? configuration.getCredential() : configuration && configuration.credential;

    if (!credential) {
        return null;
    }

    return credential.getPassword ? credential.getPassword() : credential.password;
}

/**
 * Applies request headers to the service.
 * @param {Object} svc - Service instance.
 * @param {Object} httpHeaders - Headers to apply.
 */
function applyHeaders(svc, httpHeaders) {
    var requestHeaders = httpHeaders || {};
    var useCredentialAuth = !!requestHeaders.useCredentialAuth;
    var accessToken = null;

    Object.keys(requestHeaders).forEach(function (key) {
        var value = requestHeaders[key];

        if (key === 'useCredentialAuth') {
            return;
        }

        if (value instanceof Array) {
            value.forEach(function (entry) {
                svc.addHeader(key, entry);
            });
            return;
        }

        svc.addHeader(key, value);
    });

    if (useCredentialAuth) {
        accessToken = getServiceCredentialPassword(svc);

        if (empty(accessToken)) {
            throw new Error('The Coveo Usage Analytics Read API credential password is empty. Set a Usage Analytics Read API key on service credential int.coveo.ua.read.api.cred.');
        }

        svc.addHeader('Authorization', 'Bearer ' + accessToken);
    }
}

/**
 * Safely reads a property from a service result-like object.
 * Native SFCC result objects can throw on unknown properties.
 * @param {Object} value - Source object.
 * @param {string} propertyName - Property to read.
 * @returns {*} property value or undefined.
 */
function getOptionalProperty(value, propertyName) {
    try {
        return value[propertyName];
    } catch (ex) {
        return undefined;
    }
}

/**
 * Creates a Usage Analytics Read API request.
 * @param {string} method - HTTP method.
 * @param {string} endPoint - Endpoint relative to /rest/ua/.
 * @param {Object} httpHeaders - Headers to apply.
 * @param {string} absoluteUrl - Optional absolute URL to call directly.
 * @returns {Object} service request.
 */
function createUsageAnalyticsRequest(method, endPoint, httpHeaders, absoluteUrl) {
    var coveoConstant = require('*/cartridge/scripts/utils/coveoConstant');
    var requestMetadata = {
        method: method,
        url: null
    };
    var usageAnalyticsRequest = LocalServiceRegistry.createService(coveoConstant.SERVICE_ID.COVEO_UA_READ, {
        createRequest: function (svc, args) {
            svc.URL = absoluteUrl ? absoluteUrl : svc.URL + endPoint;
            requestMetadata.url = svc.URL;
            applyHeaders(svc, httpHeaders);
            svc.setRequestMethod(method);

            if (args) {
                return typeof args === 'string' ? args : JSON.stringify(args);
            }

            return null;
        },
        parseResponse: function (svc, client) {
            if (empty(client.text)) {
                return {};
            }

            try {
                return JSON.parse(client.text);
            } catch (ex) {
                return {
                    text: client.text
                };
            }
        },
        getRequestLogMessage: function (serviceRequest) {
            return serviceRequest;
        },
        getResponseLogMessage: function (serviceResponse) {
            if (!empty(serviceResponse) && !empty(serviceResponse.errorText)) {
                Logger.error('(usageAnalyticsService - createUsageAnalyticsRequest) -> Error occurred while calling Usage Analytics Read API {0}: {1} ({2})', serviceResponse.statusCode, serviceResponse.statusMessage, serviceResponse.errorText);
                return serviceResponse.errorText;
            }

            return serviceResponse.text;
        },
        filterLogMessage: function (msg) {
            return msg;
        }
    });

    return {
        call: function (args) {
            var response = usageAnalyticsRequest.call(args);
            var wrappedResponse = {
                requestMethod: requestMetadata.method,
                requestUrl: requestMetadata.url
            };

            if (response && typeof response === 'object') {
                [
                    'ok',
                    'object',
                    'status',
                    'error',
                    'errorMessage',
                    'msg',
                    'unavailableReason',
                    'body',
                    'serviceInstance'
                ].forEach(function (propertyName) {
                    var propertyValue = getOptionalProperty(response, propertyName);

                    if (typeof propertyValue !== 'undefined') {
                        wrappedResponse[propertyName] = propertyValue;
                    }
                });
            } else {
                wrappedResponse.result = response;
            }

            return wrappedResponse;
        }
    };
}

module.exports = {
    createUsageAnalyticsRequest: createUsageAnalyticsRequest,
    getUsageAnalyticsAccessToken: function () {
        var coveoConstant = require('*/cartridge/scripts/utils/coveoConstant');
        var service = LocalServiceRegistry.createService(coveoConstant.SERVICE_ID.COVEO_UA_READ, {
            createRequest: function () {
                return null;
            },
            parseResponse: function () {
                return {};
            },
            filterLogMessage: function (msg) {
                return msg;
            }
        });
        var accessToken = getServiceCredentialPassword(service);

        if (empty(accessToken)) {
            throw new Error('The Coveo Usage Analytics Read API credential password is empty. Set a Usage Analytics Read API key on service credential int.coveo.ua.read.api.cred.');
        }

        return accessToken;
    }
};
