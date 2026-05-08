'use strict';

var File = require('dw/io/File');
var FileReader = require('dw/io/FileReader');
var Logger = require('dw/system/Logger').getLogger('Coveo');
var Status = require('dw/system/Status');
var platformFieldHelper = require('*/cartridge/scripts/helper/platformFieldHelper');

/**
 * Returns a normalized string value.
 * @param {*} value - Value to normalize.
 * @returns {string} normalized value.
 */
function normalizeString(value) {
    if (value === null || value === undefined) {
        return '';
    }

    return String(value).trim();
}

/**
 * Returns whether the value should be treated as empty.
 * @param {*} value - Value to inspect.
 * @returns {boolean} whether the value is empty.
 */
function isEmptyValue(value) {
    return value === null || value === undefined || value === '';
}

/**
 * Resolves the configured input file in IMPEX.
 * @param {Object} parameters - Job step parameters.
 * @returns {dw.io.File} resolved file.
 */
function resolveSourceFile(parameters) {
    var sourceFile = normalizeString(parameters && typeof parameters.get === 'function' ? parameters.get('sourceFile') : '');
    var file = null;

    if (sourceFile === '') {
        throw new Error('The Coveo platform field creation requires a sourceFile parameter.');
    }

    file = new File([File.IMPEX, sourceFile].join(File.SEPARATOR));

    if (!file.exists()) {
        throw new Error('The Coveo platform field creation file ' + sourceFile + ' does not exist under IMPEX.');
    }

    return file;
}

/**
 * Reads and parses the import JSON file.
 * @param {dw.io.File} file - File to read.
 * @returns {Object} parsed JSON configuration.
 */
function readImportConfig(file) {
    var reader = new FileReader(file);

    try {
        return JSON.parse(reader.getString());
    } catch (error) {
        throw new Error('Unable to parse the Coveo platform field creation file ' + file.fullPath + '. ' + (error.message || error));
    } finally {
        reader.close();
    }
}

/**
 * Formats service failure details for logs and thrown errors.
 * @param {Object} response - Service response.
 * @returns {string} formatted detail string.
 */
function formatFailureDetails(response) {
    var details = [];
    var responseObject = response && response.object;

    if (!isEmptyValue(response) && !isEmptyValue(response.status)) {
        details.push('status=' + response.status);
    }

    if (!isEmptyValue(response) && !isEmptyValue(response.error)) {
        details.push('error=' + response.error);
    }

    if (!isEmptyValue(response) && !isEmptyValue(response.errorMessage)) {
        details.push('errorMessage=' + response.errorMessage);
    }

    if (!isEmptyValue(response) && !isEmptyValue(response.msg)) {
        details.push('message=' + response.msg);
    }

    if (!isEmptyValue(responseObject) && !isEmptyValue(responseObject.message)) {
        details.push('responseMessage=' + responseObject.message);
    } else if (!isEmptyValue(responseObject) && !isEmptyValue(responseObject.text)) {
        details.push('responseBody=' + responseObject.text);
    }

    return details.join(', ');
}

/**
 * Formats per-field fallback failures for logs and thrown errors.
 * @param {Array} failures - Failed field results.
 * @returns {string} formatted failure string.
 */
function formatFieldFailures(failures) {
    return (failures || []).map(function (failure) {
        return failure.name + ' [' + formatFailureDetails(failure.response) + ']';
    }).join('; ');
}

/**
 * Throws when a service call failed.
 * @param {Object} response - Service response.
 * @returns {Object} validated service response.
 */
function ensureSuccessfulResponse(response) {
    if (isEmptyValue(response) || !response.ok) {
        var detail = formatFailureDetails(response);

        if (!isEmptyValue(detail)) {
            throw new Error('Coveo platform field creation request failed. ' + detail);
        }

        throw new Error('Coveo platform field creation request failed.');
    }

    return response;
}

/**
 * Creates missing platform fields from a JSON file in IMPEX.
 * @param {Object} parameters - Job step parameters.
 * @returns {dw.system.Status} step status.
 */
exports.execute = function (parameters) {
    try {
        var sourceFile = resolveSourceFile(parameters);
        var config = readImportConfig(sourceFile);
        var summary = platformFieldHelper.createFieldsFromConfig(config);

        if (summary.fieldsRequested > 0) {
            if (
                summary.response
                && !summary.response.ok
                && summary.individualResults
                && summary.individualResults.failed
                && summary.individualResults.failed.length
            ) {
                throw new Error(
                    'Coveo platform field creation request failed. '
                    + formatFailureDetails(summary.response)
                    + '. Failed field definitions: '
                    + formatFieldFailures(summary.individualResults.failed)
                );
            }

            ensureSuccessfulResponse(summary.response);
        }

        Logger.info(
            'Coveo platform field creation completed for file {0}. profileId={1}, siteId={2}, organizationId={3}, fieldsRequested={4}',
            sourceFile.fullPath,
            summary.profileId,
            summary.siteId,
            summary.organizationId,
            summary.fieldsRequested
        );

        return new Status(Status.OK, 'OK', 'Created missing Coveo platform fields successfully.');
    } catch (error) {
        Logger.error('Coveo platform field creation failed. {0}', error.message || error);
        return new Status(Status.ERROR, 'ERROR', error.message || String(error));
    }
};
