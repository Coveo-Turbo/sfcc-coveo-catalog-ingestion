'use strict';

var Calendar = require('dw/util/Calendar');
var File = require('dw/io/File');
var FileWriter = require('dw/io/FileWriter');
var Logger = require('dw/system/Logger').getLogger('Coveo');
var StringUtils = require('dw/util/StringUtils');
var ProductMgr = require('dw/catalog/ProductMgr');
var ProductSearchModel = require('dw/catalog/ProductSearchModel');

var coveoConstant = require('*/cartridge/scripts/utils/coveoConstant');
var catalogExportValidator = require('*/cartridge/scripts/helper/catalogExportValidator');

/**
 * Get Stream api headers
 * @function getStreamAPIHeaders
 * @returns {string}-headers
 */
function getStreamAPIHeaders() {
    var headers = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        useCredentialAuth: true
    };
    return headers;
}

/**
 * Wraps an array in an iterator-like interface.
 * @param {Array} values - values.
 * @returns {Object} iterator.
 */
function createArrayIterator(values) {
    var index = 0;
    var items = values || [];

    return {
        hasNext: function () {
            return index < items.length;
        },
        next: function () {
            var value = items[index];
            index += 1;
            return value;
        },
        close: function () {}
    };
}

/**
 * Ensures iterators returned by SFCC APIs can be safely closed.
 * @param {Object} iterator - iterator to close.
 */
function closeIterator(iterator) {
    if (!empty(iterator) && typeof iterator.close === 'function') {
        iterator.close();
    }
}

/**
 * Returns the export root product id for delta processing.
 * @param {Object} product - Product to inspect.
 * @returns {string|null} root product id.
 */
function getExportRootProductId(product) {
    if (empty(product)) {
        return null;
    }

    if (product.variant && !empty(product.masterProduct)) {
        return product.masterProduct.ID;
    }

    return product.ID;
}

/**
 * Determines whether a product changed since the last successful sync.
 * @param {Object} product - Product to inspect.
 * @param {Date} lastSync - Baseline date.
 * @returns {boolean} whether the product changed.
 */
function isModifiedSince(product, lastSync) {
    var timestamps = [];

    if (!empty(product) && !empty(product.lastModified)) {
        timestamps.push(product.lastModified);
    }

    if (!empty(product) && !empty(product.creationDate)) {
        timestamps.push(product.creationDate);
    }

    if (!empty(product) && !empty(product.masterProduct) && !empty(product.masterProduct.lastModified)) {
        timestamps.push(product.masterProduct.lastModified);
    }

    return timestamps.some(function (timestamp) {
        return !empty(timestamp) && timestamp.getTime() >= lastSync.getTime();
    });
}

/**
 * Builds the delta export root ids from all site products.
 * @returns {Object} iterator of root product ids.
 */
function buildDeltaProductQuery() {
    var lastSync = coveoConstant.COVEO_CONSTANTS.CATALOG_LAST_SYNC;
    var products = ProductMgr.queryAllSiteProducts();
    var rootIds = [];
    var seen = {};

    if (empty(lastSync)) {
        throw new Error('The Coveo delta export requires a successful full catalog sync before it can run.');
    }

    try {
        while (products.hasNext()) {
            var product = products.next();
            var rootId = getExportRootProductId(product);

            if (!empty(rootId) && !seen[rootId] && isModifiedSince(product, lastSync)) {
                seen[rootId] = true;
                rootIds.push(rootId);
            }
        }
    } finally {
        closeIterator(products);
    }

    return createArrayIterator(rootIds);
}

/**
 * This function is used for delta products
 * @param {boolean} isDelta - isDelta
 * @returns {Object} productSearch - productSearch
 */
function buildProductQuery(isDelta) {
    var productSearchHitsItr;
    try {
        Logger.info('Starting product search...');

        if (isDelta) {
            return buildDeltaProductQuery();
        }

        var productSearchModel = new ProductSearchModel();
        productSearchModel.setCategoryID('root');
        productSearchModel.setRecursiveCategorySearch(true);
        productSearchModel.search();
        productSearchHitsItr = productSearchModel.getProductSearchHits();
    } catch (ex) {
        Logger.error('(coveoHelper-buildProductQuery) -> Error occured while bulding the product query and exception is: {0} in {1} : {2}', ex.toString(), ex.fileName, ex.lineNumber);
        throw ex;
    }

    return {
        hasNext: function () {
            return productSearchHitsItr.hasNext();
        },
        next: function () {
            return productSearchHitsItr.next().productID;
        },
        close: function () {
            closeIterator(productSearchHitsItr);
        }
    };
}

/**
 * For getting current date for filename
 *
 * @returns {string} current date - current date
 */
function getFormattedDate() {
    var calendar = new Calendar();
    var currentDate = StringUtils.formatCalendar(calendar, "yyyy-MM-dd't'HHmmss.SSS");
    return currentDate;
}

/**
 * Computes Shopping gives feedfile name
 *
 * @param {string} feedType - feedType
 * @returns {string} filename - feed file name
 */
function getFeedFileName(feedType) {
    return 'coveo_catalog_export_' + getFormattedDate() + coveoConstant.COVEO_CONSTANTS.COVEO_FILE_FORMAT;
}

/**
 * Creates Feed File in a IMPEX directory and returns a FileWriter.
 * @param {string} feedType - feedType
 * @param {string} sourcePath - sourcePath
 * @returns {FileWriter} filewriter - filewriter
 */
function createFeedFile(feedType, sourcePath) {
    var workingPath = File.IMPEX + sourcePath;
    var fileName = getFeedFileName(feedType);
    var fileDirectory = new File(workingPath);
    var file = new File(workingPath + fileName);
    if (!file.exists()) {
        fileDirectory.mkdirs();
        return new File(workingPath + fileName);
    }
    return file;
}

/**
 * Creates Feed File in a IMPEX directory.
 * @param {string} sourcePath - sourcePath
 * @returns {FileWriter} filewriter - filewriter
 */
function createProductFeedFile(sourcePath) {
    return createFeedFile(coveoConstant.CoveoFeedType.PRODUCT_FEED, sourcePath);
}

/**
 * Writes Product File in impex
 * @function writeProductFile
 * @param {string} source - source
 * @param {Object} products - products
 * @returns {file} - productFile
 */
function writeProductFile(source, products) {
    var payload = catalogExportValidator.buildAddOrUpdatePayload(products);
    var productFile = createProductFeedFile(source);
    var productFileWriter = new FileWriter(productFile);
    productFileWriter.writeLine(JSON.stringify(payload));
    productFileWriter.flush();
    productFileWriter.close();
    return productFile;
}

/**
 * Archives Feed File in impex
 * @function archiveFeedFile
 * @param {string} parameters - source
 * @param {Object} productFile - products
 */
function archiveFeedFile(parameters, productFile) {
    new File([File.IMPEX, parameters.get('archivePath')].join(File.SEPARATOR)).mkdirs();
    var fileToMoveTo = new File([File.IMPEX, parameters.get('archivePath'), productFile.name].join(File.SEPARATOR));
    productFile.renameTo(fileToMoveTo);
    Logger.info('File uploaded successfully and archived - ' + fileToMoveTo.getName() + '');
}

module.exports = {
    getStreamAPIHeaders: getStreamAPIHeaders,
    createProductFeedFile: createProductFeedFile,
    buildProductQuery: buildProductQuery,
    writeProductFile: writeProductFile,
    archiveFeedFile: archiveFeedFile,
    getExportRootProductId: getExportRootProductId,
    isModifiedSince: isModifiedSince
};
