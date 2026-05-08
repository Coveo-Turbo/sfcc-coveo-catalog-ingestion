'use strict';

var coveoHttpService = require('*/cartridge/scripts/services/streamService');
var coveoConstant = require('*/cartridge/scripts/utils/coveoConstant');

/**
 * Returns the common HTTP headers for Platform Field API calls.
 * @returns {Object} request headers.
 */
function getPlatformHeaders() {
    return {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        useCredentialAuth: true
    };
}

/**
 * Serializes field definitions to a stable JSON array string.
 * This avoids relying on platform-specific array serialization behavior.
 * @param {Array} fields - Field definitions to serialize.
 * @returns {string} serialized JSON payload.
 */
function serializeFieldPayload(fields) {
    var definitions = Array.isArray(fields) ? fields : [];

    return '[' + definitions.map(function (fieldDefinition) {
        return JSON.stringify(fieldDefinition);
    }).join(',') + ']';
}

/**
 * Creates missing platform fields in batch for the current organization.
 * The Coveo API handles already existing fields idempotently.
 * @param {Array} fields - Field definitions to create.
 * @param {Object} exportContext - Optional export context containing organization id.
 * @returns {Object} service response.
 */
function createFields(fields, exportContext) {
    var endPoint = typeof coveoConstant.getPlatformApiEndpoints === 'function'
        ? coveoConstant.getPlatformApiEndpoints(exportContext).FIELDS_BATCH_CREATE
        : coveoConstant.COVEO_PLATFORM_API_ENDPOINT.FIELDS_BATCH_CREATE;
    var request = coveoHttpService.createServiceRequest(
        coveoConstant.SERVICE_ID.COVEO_PLATFORM,
        coveoConstant.COVEO_HTTP_METHOD.POST,
        endPoint,
        getPlatformHeaders()
    );

    return request.call(serializeFieldPayload(fields));
}

module.exports = {
    createFields: createFields
};
