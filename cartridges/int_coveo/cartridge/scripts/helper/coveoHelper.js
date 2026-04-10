'use strict';

var CatalogMgr = require('dw/catalog/CatalogMgr');
var Calendar = require('dw/util/Calendar');
var File = require('dw/io/File');
var FileWriter = require('dw/io/FileWriter');
var Logger = require('dw/system/Logger').getLogger('Coveo');
var StringUtils = require('dw/util/StringUtils');
var HashSet = require('dw/util/HashSet');
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
 * @param {Object} exportContext - Export context.
 * @returns {Object} iterator of root product ids.
 */
function buildDeltaProductQuery(exportContext) {
    var constants = typeof coveoConstant.getCoveoConstants === 'function'
        ? coveoConstant.getCoveoConstants(exportContext)
        : coveoConstant.COVEO_CONSTANTS;
    var lastSync = constants.CATALOG_LAST_SYNC;
    var products = null;
    var rootIds = [];
    var seen = new HashSet();

    if (empty(lastSync)) {
        throw new Error('The Coveo delta export requires a successful full catalog sync before it can run.');
    }

    products = getScopedProductsIterator(exportContext) || ProductMgr.queryAllSiteProducts();

    try {
        while (products.hasNext()) {
            var product = products.next();
            var rootId = getExportRootProductId(product);

            if (!empty(rootId) && !seen.contains(rootId) && isModifiedSince(product, lastSync)) {
                seen.add(rootId);
                rootIds.push(rootId);
            }
        }
    } finally {
        closeIterator(products);
    }

    return createArrayIterator(rootIds);
}

/**
 * Builds the full export root ids from product search hits.
 * @param {Object} exportContext - Export context.
 * @returns {Object} iterator of root product ids.
 */
function buildFullProductQuery(exportContext) {
    var productSearchModel = new ProductSearchModel();
    var productSearchHitsItr = null;
    var scopedProducts = null;
    var rootIds = [];
    var seen = new HashSet();

    scopedProducts = getScopedProductsIterator(exportContext);
    if (scopedProducts) {
        try {
            while (scopedProducts.hasNext()) {
                var scopedProduct = scopedProducts.next();
                var scopedRootId = getExportRootProductId(scopedProduct);

                if (!empty(scopedRootId) && !seen.contains(scopedRootId)) {
                    seen.add(scopedRootId);
                    rootIds.push(scopedRootId);
                }
            }
        } finally {
            closeIterator(scopedProducts);
        }

        return createArrayIterator(rootIds);
    }

    productSearchModel.setCategoryID('root');
    productSearchModel.setRecursiveCategorySearch(true);
    productSearchModel.search();
    productSearchHitsItr = productSearchModel.getProductSearchHits();

    try {
        while (productSearchHitsItr.hasNext()) {
            var productSearchHit = productSearchHitsItr.next();
            var product = ProductMgr.getProduct(productSearchHit.productID);
            var rootId = getExportRootProductId(product);

            if (!empty(rootId) && !seen.contains(rootId)) {
                seen.add(rootId);
                rootIds.push(rootId);
            }
        }
    } finally {
        closeIterator(productSearchHitsItr);
    }

    return createArrayIterator(rootIds);
}

/**
 * Returns a catalog-scoped product iterator when a target catalog is configured.
 * @param {Object} exportContext - Export context.
 * @returns {Object|null} scoped product iterator.
 */
function getScopedProductsIterator(exportContext) {
    if (empty(exportContext) || empty(exportContext.catalogId)) {
        return null;
    }

    var catalog = CatalogMgr.getCatalog(exportContext.catalogId);

    if (empty(catalog)) {
        throw new Error('The Coveo export target references catalog ' + exportContext.catalogId + ', but that catalog does not exist.');
    }

    return ProductMgr.queryProductsInCatalog(catalog);
}

/**
 * This function is used for delta products
 * @param {boolean} isDelta - isDelta
 * @param {Object} exportContext - Export context.
 * @returns {Object} productSearch - productSearch
 */
function buildProductQuery(isDelta, exportContext) {
    try {
        Logger.info('Starting product search...');

        if (isDelta) {
            return buildDeltaProductQuery(exportContext);
        }

        return buildFullProductQuery(exportContext);
    } catch (ex) {
        Logger.error('(coveoHelper-buildProductQuery) -> Error occured while bulding the product query and exception is: {0} in {1} : {2}', ex.toString(), ex.fileName, ex.lineNumber);
        throw ex;
    }
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
    var constants = typeof coveoConstant.getCoveoConstants === 'function'
        ? coveoConstant.getCoveoConstants()
        : coveoConstant.COVEO_CONSTANTS;

    return 'coveo_catalog_export_' + getFormattedDate() + constants.COVEO_FILE_FORMAT;
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
 * @param {Object} exportContext - export context
 * @returns {file} - productFile
 */
function writeProductFile(source, products, exportContext) {
    var payload = catalogExportValidator.buildAddOrUpdatePayload(products, {
        expectedLanguage: exportContext && exportContext.language ? exportContext.language : ''
    });
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
