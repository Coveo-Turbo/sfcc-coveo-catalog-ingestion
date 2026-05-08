'use strict';

var CatalogMgr = require('dw/catalog/CatalogMgr');
var File = require('dw/io/File');
var FileWriter = require('dw/io/FileWriter');
var Logger = require('dw/system/Logger').getLogger('Coveo');
var ProductMgr = require('dw/catalog/ProductMgr');
var Site = require('dw/system/Site');
var Status = require('dw/system/Status');

var catalogAttributeAuditHelper = require('*/cartridge/scripts/helper/catalogAttributeAuditHelper');

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
 * Returns the numeric value of a parameter or a fallback.
 * @param {*} value - Raw parameter value.
 * @param {number} fallback - Fallback number.
 * @returns {number} normalized number.
 */
function toPositiveInteger(value, fallback) {
    var normalized = parseInt(normalizeString(value), 10);

    if (isNaN(normalized) || normalized < 0) {
        return fallback;
    }

    return normalized;
}

/**
 * Closes iterators returned by SFCC APIs when supported.
 * @param {Object} iterator - Iterator to close.
 */
function closeIterator(iterator) {
    if (iterator && typeof iterator.close === 'function') {
        iterator.close();
    }
}

/**
 * Applies the configured locale to the current request when available.
 * @param {string} locale - Locale to apply.
 * @returns {string} previous locale.
 */
function applyRequestLocale(locale) {
    if (!locale || typeof request === 'undefined' || !request || typeof request.setLocale !== 'function') {
        return '';
    }

    var previousLocale = normalizeString(request.locale);

    if (previousLocale !== locale) {
        request.setLocale(locale);
    }

    return previousLocale;
}

/**
 * Restores the previous request locale when possible.
 * @param {string} previousLocale - Previous locale.
 */
function restoreRequestLocale(previousLocale) {
    var normalizedLocale = normalizeString(previousLocale);

    if (normalizedLocale === '' || typeof request === 'undefined' || !request || typeof request.setLocale !== 'function') {
        return;
    }

    if (normalizeString(request.locale) !== normalizedLocale) {
        request.setLocale(normalizedLocale);
    }
}

/**
 * Returns the configured catalog identifier.
 * @param {Object} parameters - Job parameters.
 * @returns {string} catalog id.
 */
function getCatalogId(parameters) {
    var catalogId = normalizeString(parameters && typeof parameters.get === 'function' ? parameters.get('catalogId') : '');

    if (catalogId === '') {
        throw new Error('The catalog attribute audit requires a catalogId parameter.');
    }

    return catalogId;
}

/**
 * Resolves the requested catalog object.
 * @param {string} catalogId - Catalog identifier.
 * @returns {Object} catalog object.
 */
function resolveCatalog(catalogId) {
    var catalog = CatalogMgr.getCatalog(catalogId);

    if (!catalog) {
        throw new Error('No catalog with id ' + catalogId + ' exists.');
    }

    return catalog;
}

/**
 * Returns the audit locale from parameters or the current site default locale.
 * @param {Object} parameters - Job parameters.
 * @returns {string} locale identifier.
 */
function getAuditLocale(parameters) {
    var locale = normalizeString(parameters && typeof parameters.get === 'function' ? parameters.get('locale') : '');

    if (locale !== '') {
        return locale;
    }

    return normalizeString(Site.current && Site.current.defaultLocale);
}

/**
 * Returns the normalized output path inside IMPEX.
 * @param {Object} parameters - Job parameters.
 * @returns {string} normalized output path.
 */
function getOutputPath(parameters) {
    var outputPath = normalizeString(parameters && typeof parameters.get === 'function' ? parameters.get('outputPath') : '');

    if (outputPath === '') {
        outputPath = '/src/coveo/reports/catalog-attributes/';
    }

    if (outputPath.charAt(0) !== '/') {
        outputPath = '/' + outputPath;
    }

    if (outputPath.charAt(outputPath.length - 1) !== '/') {
        outputPath += '/';
    }

    return outputPath;
}

/**
 * Builds a filesystem-safe report base name.
 * @param {string} catalogId - Catalog identifier.
 * @param {string} locale - Locale identifier.
 * @returns {string} base file name.
 */
function buildReportBaseName(catalogId, locale) {
    return [
        'catalog_attribute_audit',
        normalizeString(catalogId).replace(/[^A-Za-z0-9_-]+/g, '_'),
        normalizeString(locale || 'default').replace(/[^A-Za-z0-9_-]+/g, '_'),
        new Date().toISOString().replace(/[:.]/g, '-')
    ].join('_');
}

/**
 * Writes a report file to IMPEX and returns the resulting file.
 * @param {string} outputPath - IMPEX-relative output path.
 * @param {string} fileName - File name.
 * @param {string} content - File content.
 * @returns {dw.io.File} written file.
 */
function writeReportFile(outputPath, fileName, content) {
    var directory = new File([File.IMPEX, outputPath].join(File.SEPARATOR));
    var file = new File([File.IMPEX, outputPath, fileName].join(File.SEPARATOR));
    var writer = null;

    directory.mkdirs();
    writer = new FileWriter(file);
    writer.write(content);
    writer.flush();
    writer.close();

    return file;
}

/**
 * Runs a catalog attribute audit and writes JSON and CSV reports to IMPEX.
 * @param {Object} parameters - Job parameters.
 * @returns {dw.system.Status} execution status.
 */
exports.execute = function (parameters) {
    var previousLocale = '';
    var productsIterator = null;

    try {
        var catalogId = getCatalogId(parameters);
        var catalog = resolveCatalog(catalogId);
        var locale = getAuditLocale(parameters);
        var outputPath = getOutputPath(parameters);
        var sampleLimit = toPositiveInteger(parameters.get('sampleLimit'), 5);
        var maxProducts = toPositiveInteger(parameters.get('maxProducts'), 0);
        var reportBaseName = buildReportBaseName(catalogId, locale);
        var report;
        var csv;
        var jsonFile;
        var csvFile;

        previousLocale = applyRequestLocale(locale);
        productsIterator = ProductMgr.queryProductsInCatalog(catalog);
        report = catalogAttributeAuditHelper.buildCatalogAttributeAudit(productsIterator, {
            siteId: normalizeString(Site.current && Site.current.ID),
            catalogId: catalogId,
            locale: locale,
            sampleLimit: sampleLimit,
            maxProducts: maxProducts
        });
        csv = catalogAttributeAuditHelper.buildAuditCsv(report);
        jsonFile = writeReportFile(outputPath, reportBaseName + '.json', JSON.stringify(report, null, 2));
        csvFile = writeReportFile(outputPath, reportBaseName + '.csv', csv + '\n');

        Logger.info(
            'Catalog attribute audit completed for catalog={0}, locale={1}, productsScanned={2}, jsonFile={3}, csvFile={4}',
            catalogId,
            locale || '[site default]',
            report.scanSummary.productsScanned,
            jsonFile.fullPath,
            csvFile.fullPath
        );

        return new Status(Status.OK, 'OK', 'Catalog attribute audit completed successfully.');
    } catch (error) {
        Logger.error('Catalog attribute audit failed. {0}', error.message || error);
        return new Status(Status.ERROR, 'ERROR', error.message || String(error));
    } finally {
        closeIterator(productsIterator);
        restoreRequestLocale(previousLocale);
    }
};
