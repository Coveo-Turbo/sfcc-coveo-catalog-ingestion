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
            throw new Error('The Coveo Platform API credential password is empty. Set a Merchandising Hub API key on service credential int.coveo.platform.api.cred.');
        }

        svc.addHeader('Authorization', 'Bearer ' + accessToken);
    }
}

/**
 * Creates a Coveo Platform API request.
 * @param {string} method - HTTP method.
 * @param {string} endPoint - Endpoint relative to /rest/organizations/.
 * @param {Object} httpHeaders - Headers to apply.
 * @returns {Object} service request.
 */
function createPlatformRequest(method, endPoint, httpHeaders) {
    var coveoConstant = require('*/cartridge/scripts/utils/coveoConstant');
    var platformRequest = LocalServiceRegistry.createService(coveoConstant.SERVICE_ID.COVEO_PLATFORM, {
        createRequest: function (svc, args) {
            svc.URL += endPoint;
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
                Logger.error('(platformService - createPlatformRequest) -> Error occurred while calling Platform API {0}: {1} ({2})', serviceResponse.statusCode, serviceResponse.statusMessage, serviceResponse.errorText);
                return serviceResponse.errorText;
            }
            return serviceResponse.text;
        },
        filterLogMessage: function (msg) {
            return msg;
        }
    });
    return platformRequest;
}

module.exports = {
    createPlatformRequest: createPlatformRequest
};
