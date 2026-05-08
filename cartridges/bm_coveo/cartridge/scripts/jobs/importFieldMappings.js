'use strict';

var File = require('dw/io/File');
var FileReader = require('dw/io/FileReader');
var Logger = require('dw/system/Logger').getLogger('Coveo');
var Status = require('dw/system/Status');
var fieldMappingImportHelper = require('*/cartridge/scripts/helper/fieldMappingImportHelper');

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
 * Converts supported truthy values to boolean.
 * @param {*} value - Value to normalize.
 * @returns {boolean} normalized boolean.
 */
function toBoolean(value) {
    if (value === true || value === false) {
        return value;
    }

    return normalizeString(value).toLowerCase() === 'true';
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
        throw new Error('The Coveo field mapping import requires a sourceFile parameter.');
    }

    file = new File([File.IMPEX, sourceFile].join(File.SEPARATOR));

    if (!file.exists()) {
        throw new Error('The Coveo field mapping import file ' + sourceFile + ' does not exist under IMPEX.');
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
        throw new Error('Unable to parse the Coveo field mapping import file ' + file.fullPath + '. ' + (error.message || error));
    } finally {
        reader.close();
    }
}

/**
 * Imports field mappings from a JSON file in IMPEX.
 * @param {Object} parameters - Job step parameters.
 * @returns {dw.system.Status} step status.
 */
exports.execute = function (parameters) {
    try {
        var sourceFile = resolveSourceFile(parameters);
        var config = readImportConfig(sourceFile);
        var summary = fieldMappingImportHelper.importFromConfig(config, {
            replaceExistingMappings: toBoolean(parameters.get('replaceExistingMappings'))
        });

        Logger.info(
            'Coveo field mapping import completed for file {0}. profileId={1}, siteId={2}, mappingsImported={3}',
            sourceFile.fullPath,
            summary.profileId,
            summary.siteId,
            summary.mappingsImported
        );

        return new Status(Status.OK, 'OK', 'Imported Coveo field mappings successfully.');
    } catch (error) {
        Logger.error('Coveo field mapping import failed. {0}', error.message || error);
        return new Status(Status.ERROR, 'ERROR', error.message || String(error));
    }
};
