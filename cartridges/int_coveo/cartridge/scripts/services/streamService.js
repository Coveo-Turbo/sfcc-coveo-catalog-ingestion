'use strict';

var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');
var Logger = require('dw/system/Logger').getLogger('Coveo');
var FileReader = require('dw/io/FileReader');

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
            throw new Error('The Coveo Push API credential password is empty. Set the Push API key on service credential int.coveo.api.cred.');
        }

        svc.addHeader('Authorization', 'Bearer ' + accessToken);
    }
}

/**
 * This function is used to create stream service request
 * @function createStreamRequest
 * @param {string} method - method
 * @param {string} endPoint - endPoint
 * @param {Object} httpHeaders - httpHeaders
 * @param {string} uploadURL - uploadURL
 * @returns {Object}-httpRequest
 */
function createStreamRequest(method, endPoint, httpHeaders, uploadURL) {
    var coveoConstant = require('*/cartridge/scripts/utils/coveoConstant');
    var httpRequest = LocalServiceRegistry.createService(coveoConstant.SERVICE_ID.COVEO_STREAM, {
        createRequest: function (svc, args) {
            if (empty(uploadURL)) {
                svc.URL = svc.URL + endPoint;
            } else {
                svc.URL = uploadURL;
            }
            var fileContent = null;
            applyHeaders(svc, httpHeaders);
            svc.setRequestMethod(method);
            if (args) {
                if (typeof args === 'string') {
                    fileContent = args;
                } else if (typeof args === 'object' && args.path) {
                    var fileReaders = new FileReader(args);
                    fileContent = fileReaders.getString();
                    fileReaders.close();
                } else {
                    fileContent = JSON.stringify(args);
                }
            }
            return fileContent;
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
                Logger.error('(streamService - createStreamRequest) -> Error occurred while calling Stream API {0}: {1} ({2})', serviceResponse.statusCode, serviceResponse.statusMessage, serviceResponse.errorText);
                return serviceResponse.errorText;
            }
            return serviceResponse.text;
        },
        filterLogMessage: function (msg) {
            return msg;
        }
    });
    return httpRequest;
}

module.exports = {
    createStreamRequest: createStreamRequest
};
