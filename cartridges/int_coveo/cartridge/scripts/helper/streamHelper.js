'use strict';

var coveoStreamService = require('*/cartridge/scripts/services/streamService');
var coveoConstant = require('*/cartridge/scripts/utils/coveoConstant');
var coveoHelper = require('*/cartridge/scripts/helper/coveoHelper');

/**
 * Get Upload Stream Service
 * @function uploadStreamService
 * @param {string} productFile - productFile
 * @param {string} uploadUri - uploadUri
 * @param {Object} requiredHeaders - Headers required by the file container upload URI.
 * @returns {Object}-uploadStreamResponse
 */
function uploadStreamService(productFile, uploadUri, requiredHeaders) {
    var httpHeader = requiredHeaders || {};
    var uploadStream = coveoStreamService.createStreamRequest(coveoConstant.COVEO_HTTP_METHOD.PUT, '', httpHeader, uploadUri);
    var uploadStreamResponse = uploadStream.call(productFile);
    return uploadStreamResponse;
}

/**
 * Get Open File Container
 * @function createFileContainer
 * @param {Object} exportContext - Export context.
 * @returns {Object}-fileContainer
 */
function createFileContainer(exportContext) {
    var endPoint = typeof coveoConstant.getApiEndpoints === 'function'
        ? coveoConstant.getApiEndpoints(exportContext).FILECONTAINER
        : coveoConstant.COVEO_API_ENDPOINT.FILECONTAINER;
    var httpHeaders = coveoHelper.getStreamAPIHeaders();
    var coveoOpenFileContainer = coveoStreamService.createStreamRequest(coveoConstant.COVEO_HTTP_METHOD.POST, endPoint, httpHeaders);
    var fileContainer = coveoOpenFileContainer.call({});
    return fileContainer;
}

/**
 * Get Send File Container
 * @function sendFileContainer
 * @param {string} fileId - fileId
 * @param {Object} exportContext - Export context.
 * @returns {Object}-fileContainer
 */
function sendFileContainer(fileId, exportContext) {
    var endPoint = typeof coveoConstant.getApiEndpoints === 'function'
        ? coveoConstant.getApiEndpoints(exportContext).UPDATEFILE
        : coveoConstant.COVEO_API_ENDPOINT.UPDATEFILE;
    endPoint = endPoint.replace('<fileId>', fileId);
    var httpHeaders = coveoHelper.getStreamAPIHeaders();
    var coveSendFileContainer = coveoStreamService.createStreamRequest(coveoConstant.COVEO_HTTP_METHOD.PUT, endPoint, httpHeaders);
    var fileContainer = coveSendFileContainer.call();
    return fileContainer;
}

/**
 * Deletes items that are older than the first full-update ordering id.
 * @param {string|number} orderingId - Ordering id returned by the first full update request.
 * @param {Object} exportContext - Export context.
 * @returns {Object} delete older than response.
 */
function deleteOlderThan(orderingId, exportContext) {
    var endPoint = typeof coveoConstant.getApiEndpoints === 'function'
        ? coveoConstant.getApiEndpoints(exportContext).DELETEOLDERTHAN
        : coveoConstant.COVEO_API_ENDPOINT.DELETEOLDERTHAN;
    endPoint = endPoint.replace('<orderingId>', orderingId);
    var httpHeaders = coveoHelper.getStreamAPIHeaders();
    var deleteOlderThanRequest = coveoStreamService.createStreamRequest(coveoConstant.COVEO_HTTP_METHOD.POST, endPoint, httpHeaders);
    return deleteOlderThanRequest.call();
}

module.exports = {
    uploadStreamService: uploadStreamService,
    createFileContainer: createFileContainer,
    sendFileContainer: sendFileContainer,
    deleteOlderThan: deleteOlderThan
};
