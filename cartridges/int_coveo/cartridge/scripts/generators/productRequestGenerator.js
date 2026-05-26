'use strict';

var CatalogMgr = require('dw/catalog/CatalogMgr');
var ProductMgr = require('dw/catalog/ProductMgr');
var coveoConstant = require('*/cartridge/scripts/utils/coveoConstant');
var exportTargetHelper = require('*/cartridge/scripts/helper/exportTargetHelper');
var fieldMappingHelper = require('*/cartridge/scripts/helper/fieldMappingHelper');
var Logger = require('dw/system/Logger').getLogger('Coveo');
var Site = require('dw/system/Site');
var URLUtils = require('dw/web/URLUtils');

/**
 * Converts a collection, iterator, or array-like value to an array.
 * @param {*} value - Value to convert.
 * @returns {Array} array value.
 */
function toArray(value) {
    var values = [];
    var index = 0;

    if (empty(value)) {
        return values;
    }

    if (Array.isArray(value)) {
        return value;
    }

    if (typeof value.toArray === 'function') {
        return value.toArray();
    }

    if (typeof value.hasNext === 'function' && typeof value.next === 'function') {
        while (value.hasNext()) {
            values.push(value.next());
        }

        return values;
    }

    if (typeof value.length === 'number' && typeof value !== 'string') {
        for (index = 0; index < value.length; index += 1) {
            values.push(value[index]);
        }
    }

    return values;
}

/**
 * Returns whether a category should be exported.
 * @param {Object} category - Category to inspect.
 * @returns {boolean} whether the category is online.
 */
function isOnlineCategory(category) {
    if (empty(category)) {
        return false;
    }

    if (typeof category.isOnline === 'function') {
        return category.isOnline();
    }

    if (Object.prototype.hasOwnProperty.call(category, 'online')) {
        return category.online !== false;
    }

    return true;
}

/**
 * Returns the display name used in category hierarchy exports.
 * @param {Object} category - Category to inspect.
 * @returns {string} category name.
 */
function getCategoryName(category) {
    if (empty(category)) {
        return '';
    }

    return category.displayName || category.name || category.ID || '';
}

/**
 * Returns the effective primary category for a product.
 * @param {Object} product - Product to inspect.
 * @returns {Object|null} primary category.
 */
function getPrimaryCategory(product) {
    if (empty(product)) {
        return null;
    }

    if (product.variant && !empty(product.masterProduct) && !empty(product.masterProduct.primaryCategory)) {
        return product.masterProduct.primaryCategory;
    }

    return product.primaryCategory || null;
}

/**
 * Returns the assigned categories for a product when available.
 * @param {Object} product - Product to inspect.
 * @returns {Array} assigned categories.
 */
function getAssignedCategories(product) {
    if (empty(product)) {
        return [];
    }

    if (typeof product.getOnlineCategories === 'function') {
        return toArray(product.getOnlineCategories());
    }

    if (!empty(product.onlineCategories)) {
        return toArray(product.onlineCategories);
    }

    if (typeof product.getCategories === 'function') {
        return toArray(product.getCategories());
    }

    if (!empty(product.categories)) {
        return toArray(product.categories);
    }

    if (!empty(product.allCategories)) {
        return toArray(product.allCategories);
    }

    return [];
}

/**
 * Returns a category's hierarchy names when it is valid for export.
 * @param {Object} category - Category to inspect.
 * @returns {Array} hierarchy path names.
 */
function getCategoryPathNames(category) {
    var currentCategory = category;
    var currentCategoryName = '';
    var currentCategoryKey = '';
    var pathNames = [];
    var seenCategoryKeys = {};

    while (!empty(currentCategory)) {
        currentCategoryName = getCategoryName(currentCategory);
        currentCategoryKey = currentCategory.ID || currentCategoryName;

        if (empty(currentCategoryName) || empty(currentCategoryKey) || seenCategoryKeys[currentCategoryKey] || !isOnlineCategory(currentCategory)) {
            return [];
        }

        seenCategoryKeys[currentCategoryKey] = true;
        pathNames.unshift(currentCategoryName);

        if (empty(currentCategory.parent) || currentCategory.parent.ID === 'root') {
            break;
        }

        currentCategory = currentCategory.parent;

        if (!empty(currentCategory) && empty(getCategoryName(currentCategory)) && !empty(currentCategory.ID)) {
            currentCategory = CatalogMgr.getCategory(currentCategory.ID);
        }
    }

    return pathNames;
}

/**
 * Converts a category path into Coveo hierarchical field values.
 * @param {Array} pathNames - category path names.
 * @returns {Array} hierarchical field values.
 */
function buildCategoryPathValues(pathNames) {
    var categoryValues = [];
    var index;

    for (index = 0; index < pathNames.length; index += 1) {
        categoryValues.push(pathNames.slice(0, index + 1).join('|'));
    }

    return categoryValues;
}

/**
 * Adds category path values to an export array while preserving insertion order.
 * @param {Array} categoryValues - accumulated export values.
 * @param {Object} seenValues - seen-value map.
 * @param {Array} pathNames - category path names.
 */
function appendCategoryPathValues(categoryValues, seenValues, pathNames) {
    buildCategoryPathValues(pathNames).forEach(function (categoryValue) {
        if (!seenValues[categoryValue]) {
            seenValues[categoryValue] = true;
            categoryValues.push(categoryValue);
        }
    });
}

/**
 * Returns exported category values for a product.
 * @param {Object} product - Product to inspect.
 * @returns {Object} exported category values.
 */
function getCategoryExportValues(product) {
    var primaryCategory = getPrimaryCategory(product);
    var assignedCategories = [];
    var categoryValues = [];
    var seenCategoryPaths = {};
    var seenCategoryValues = {};
    var primaryCategoryPathNames = [];

    function appendCategory(category) {
        var pathNames = getCategoryPathNames(category);
        var pathKey = pathNames.join('|');

        if (empty(pathKey) || seenCategoryPaths[pathKey]) {
            return;
        }

        seenCategoryPaths[pathKey] = true;
        appendCategoryPathValues(categoryValues, seenCategoryValues, pathNames);
    }

    try {
        primaryCategoryPathNames = getCategoryPathNames(primaryCategory);

        if (product && product.variant && !empty(product.masterProduct)) {
            assignedCategories = assignedCategories.concat(getAssignedCategories(product.masterProduct));
        }

        assignedCategories = assignedCategories.concat(getAssignedCategories(product));

        if (!empty(primaryCategory)) {
            assignedCategories.unshift(primaryCategory);
        }

        assignedCategories.forEach(appendCategory);
    } catch (ex) {
        Logger.error('(productRequestGenerator-getCategoryExportValues) -> Error occured while generating product categories and exception is: {0} in {1} : {2}', ex.toString(), ex.fileName, ex.lineNumber);
    }

    return {
        ecCategory: categoryValues.join(';'),
        ecPrimaryCategory: buildCategoryPathValues(primaryCategoryPathNames).join(';')
    };
}

/**
 * Get product rating
 * @function getProductRating
 * @param {Object} product - product
 * @returns {string} - string
 */
function getProductRating(product) {
    var rateVal = null;
    var sum = null;
    try {
        var id = product.ID;
        sum = id.split('').reduce(function (total, letter) {
            return total + letter.charCodeAt(0);
        }, 0);

        rateVal = (Math.ceil(((sum % 3) + 2) + (((sum % 10) / 10) + 0.1)));
    } catch (ex) {
        Logger.error('(productRequestGenerator-getProductRating) -> Error occured while getting product rating and exception is: {0} in {1} : {2}', ex.toString(), ex.fileName, ex.lineNumber);
    }
    return (rateVal < 5 ? rateVal + (((sum % 10) * 0.1) + 0.1) : rateVal);
}

/**
 * Get product color
 * @function getProductColor
 * @param {Object} product - product
 * @returns {string} - string
 */
function getProductColor(product) {
    var productColor = null;
    try {
        if (product.variant) {
            var productAttribute = product.variationModel.getProductVariationAttribute('color');
            if (!empty(productAttribute)) {
                productColor = product.variationModel.getAllValues(productAttribute).toArray().find(function (color) {
                    return color.ID === product.custom.color;
                });
            }
        }
    } catch (ex) {
        Logger.error('(productRequestGenerator-getProductColor) -> Error occured while getting product color and exception is: {0} in {1} : {2}', ex.toString(), ex.fileName, ex.lineNumber);
    }
    return productColor ? productColor.displayValue : '';
}

/**
 * Returns the color-group key used to build display-product identifiers.
 * @param {Object} product - product
 * @returns {string} color group key
 */
function getColorGroupKey(product) {
    if (!empty(product) && product.variant && 'color' in product.custom && !empty(product.custom.color)) {
        return product.custom.color;
    }

    return !empty(product) ? product.ID : '';
}

/**
 * Builds the canonical product identifier used by Commerce mappings.
 * @param {Object} product - product
 * @returns {string} product identifier
 */
function getCanonicalProductId(product) {
    if (!empty(product) && product.variant && !empty(product.masterProduct)) {
        return product.masterProduct.ID + '-' + getColorGroupKey(product);
    }

    return !empty(product) ? product.ID : '';
}

/**
 * Returns the language code used for catalog exports.
 * @param {Object} exportContext - Export context.
 * @returns {string} language code.
 */
function getExportLanguage(exportContext) {
    if (exportContext && !empty(exportContext.language)) {
        return String(exportContext.language).toLowerCase();
    }

    var defaultLocale = Site.current && Site.current.defaultLocale ? String(Site.current.defaultLocale) : '';

    if (empty(defaultLocale)) {
        return '';
    }

    return exportTargetHelper.getLanguageFromLocale(defaultLocale);
}

/**
 * Returns the source text from an SFCC markup-like value when available.
 * @param {*} markupValue - Markup or string value.
 * @returns {string} source text.
 */
function getMarkupSource(markupValue) {
    if (empty(markupValue)) {
        return '';
    }

    try {
        if (!empty(markupValue.source)) {
            return String(markupValue.source);
        }
    } catch (error) {
        // Fall back below when platform-backed values do not expose source directly.
    }

    return typeof markupValue === 'string' ? markupValue : '';
}

/**
 * Returns a normalized site preference string when configured.
 * @param {string} preferenceId - Site preference id.
 * @returns {string} preference value.
 */
function getSitePreferenceValue(preferenceId) {
    var customPreferences = Site.current
        && Site.current.preferences
        && Site.current.preferences.custom
        ? Site.current.preferences.custom
        : null;

    if (!customPreferences || empty(customPreferences[preferenceId])) {
        return '';
    }

    return String(customPreferences[preferenceId]).trim();
}

/**
 * Returns the configured fallback image URL for the requested view type.
 * @param {string} viewType - image view type.
 * @returns {string} fallback image URL.
 */
function getConfiguredImagePlaceholderUrl(viewType) {
    var placeholderUrl = '';

    if (viewType === 'medium') {
        placeholderUrl = getSitePreferenceValue('coveoProductThumbnailPlaceholderUrl');
    }

    if (empty(placeholderUrl)) {
        placeholderUrl = getSitePreferenceValue('coveoProductImagePlaceholderUrl');
    }

    if (!/^https?:\/\//i.test(placeholderUrl)) {
        return '';
    }

    return placeholderUrl;
}

/**
 * Collects image URLs for a given SFCC image view type.
 * @param {Object} product - product
 * @param {string} viewType - image view type
 * @returns {Array} image urls
 */
function collectImageUrls(product, viewType) {
    var imageUrls = [];

    var images = product.getImages && product.getImages(viewType);
    if (!empty(images) && typeof images.toArray === 'function') {
        imageUrls = images.toArray().map(function (image) {
            return image && image.httpsURL ? image.httpsURL.toString() : '';
        }).filter(function (url) {
            return !empty(url);
        });
    }

    if (!imageUrls.length) {
        var singleImage = product.getImage && product.getImage(viewType);
        if (singleImage && singleImage.httpsURL) {
            imageUrls.push(singleImage.httpsURL.toString());
        }
    }

    return imageUrls.filter(function (url, index, urls) {
        return urls.indexOf(url) === index;
    });
}

/**
 * Returns HTML content wrapped in a minimal document so Coveo can detect it as HTML.
 * @param {*} markupValue - Markup or string value.
 * @returns {string} HTML document string.
 */
function getHtmlDocument(markupValue) {
    var markupSource = getMarkupSource(markupValue);

    if (empty(markupSource)) {
        return '';
    }

    if (/<html[\s>]/i.test(markupSource)) {
        return markupSource;
    }

    return '<html><body>' + markupSource + '</body></html>';
}

/**
 * Get product size
 * @function getProductSize
 * @param {Object} product - product
 * @returns {string} - string
 */
function getProductSize(product) {
    var productSize = null;
    try {
        if (product.variant) {
            var productAttribute = product.variationModel.getProductVariationAttribute('size') || product.variationModel.getProductVariationAttribute('accessorySize');
            if (!empty(productAttribute)) {
                productSize = product.variationModel.getAllValues(productAttribute).toArray().find(function (size) {
                    return size.ID === product.custom.size;
                });
            }
        }
    } catch (ex) {
        Logger.error('(productRequestGenerator-getProductSize) -> Error occured while getting product size and exception is: {0} in {1} : {2}', ex.toString(), ex.fileName, ex.lineNumber);
    }
    return productSize ? productSize.displayValue : '';
}

/**
 * Returns image URLs for a given SFCC image view type.
 * @param {Object} product - product
 * @param {string} viewType - image view type
 * @param {Array} fallbackViewTypes - alternate view types to use when none exist for the requested one
 * @returns {Array} image urls
 */
function getImageUrls(product, viewType, fallbackViewTypes) {
    var imageUrls = [];

    try {
        imageUrls = collectImageUrls(product, viewType);

        if (!imageUrls.length && Array.isArray(fallbackViewTypes)) {
            fallbackViewTypes.some(function (fallbackViewType) {
                imageUrls = collectImageUrls(product, fallbackViewType);
                return imageUrls.length > 0;
            });
        }

        if (!imageUrls.length) {
            var configuredPlaceholderUrl = getConfiguredImagePlaceholderUrl(viewType);
            if (!empty(configuredPlaceholderUrl)) {
                imageUrls.push(configuredPlaceholderUrl);
            }
        }
    } catch (ex) {
        Logger.error('(productRequestGenerator-getImageUrls) -> Error occured while collecting product images and exception is: {0} in {1} : {2}', ex.toString(), ex.fileName, ex.lineNumber);
    }

    return imageUrls.filter(function (url, index, urls) {
        return urls.indexOf(url) === index;
    });
}

/**
 * Returns thumbnails from the medium image view.
 * @param {Object} product - product
 * @returns {Array} thumbnail urls
 */
function getThumbnailUrls(product) {
    return getImageUrls(product, 'medium', ['large']);
}

/**
 * Returns the numeric value of a money object when available.
 * @param {Object} money - SFCC money object.
 * @returns {number|null} numeric value.
 */
function getMoneyValue(money) {
    if (empty(money)) {
        return null;
    }

    if (Object.prototype.hasOwnProperty.call(money, 'available') && money.available === false) {
        return null;
    }

    if (Object.prototype.hasOwnProperty.call(money, 'valueOrNull') && money.valueOrNull === null) {
        return null;
    }

    if (Object.prototype.hasOwnProperty.call(money, 'value') && money.value !== null && money.value !== undefined) {
        return money.value;
    }

    return null;
}

/**
 * Returns the root price book for the provided price book chain.
 * @param {Object} priceBook - Current price book.
 * @returns {Object|null} root price book.
 */
function getRootPriceBook(priceBook) {
    var currentPriceBook = priceBook || null;

    while (!empty(currentPriceBook) && !empty(currentPriceBook.parentPriceBook)) {
        currentPriceBook = currentPriceBook.parentPriceBook;
    }

    return currentPriceBook;
}

/**
 * Returns the current effective sales price.
 * @param {Object} priceModel - Product price model.
 * @returns {number|null} effective sales price.
 */
function getCurrentSalesPrice(priceModel) {
    var salesPrice = null;

    if (empty(priceModel)) {
        return null;
    }

    salesPrice = getMoneyValue(priceModel.price);

    if (salesPrice === null) {
        salesPrice = getMoneyValue(priceModel.minPrice);
    }

    if (salesPrice === null) {
        salesPrice = getMoneyValue(priceModel.maxPrice);
    }

    return salesPrice;
}

/**
 * Returns the root price-book price when available.
 * @param {Object} priceModel - Product price model.
 * @returns {number|null} root price-book price.
 */
function getBasePrice(priceModel) {
    if (empty(priceModel)) {
        return null;
    }

    var priceInfo = priceModel.priceInfo;
    var currentPriceBook = priceInfo && priceInfo.priceBook ? priceInfo.priceBook : null;
    var rootPriceBook = getRootPriceBook(currentPriceBook);

    if (!empty(rootPriceBook) && typeof priceModel.getPriceBookPrice === 'function') {
        var rootPrice = getMoneyValue(priceModel.getPriceBookPrice(rootPriceBook.ID));
        if (rootPrice !== null) {
            return rootPrice;
        }
    }

    return getMoneyValue(priceModel.maxPrice);
}

/**
 * Returns the exported base and promotional pricing values for a product.
 * @param {Object} product - Product to inspect.
 * @returns {Object} price data.
 */
function getExportPrices(product) {
    var priceModel = product && product.priceModel ? product.priceModel : null;
    var basePrice = getBasePrice(priceModel);
    var salesPrice = getCurrentSalesPrice(priceModel);

    if (basePrice === null && salesPrice === null) {
        return {
            price: null,
            promoPrice: null
        };
    }

    if (basePrice === null) {
        basePrice = salesPrice;
    }

    if (salesPrice !== null && basePrice !== null && salesPrice < basePrice) {
        return {
            price: basePrice,
            promoPrice: salesPrice
        };
    }

    return {
        price: basePrice,
        promoPrice: null
    };
}

/**
 * Get Product Data
 * @function getProductsData
 * @param {Object} product - product
 * @param {Object} exportOptions - export options
 * @param {Object} exportContext - export context
 * @returns {Object} - Object
 */
function getProductsData(product, exportOptions, exportContext) {
    var prdObj = null;
    try {
        var productId = exportOptions && exportOptions.productId ? exportOptions.productId : getCanonicalProductId(product);
        var itemGroupId = exportOptions && exportOptions.itemGroupId ? exportOptions.itemGroupId : null;
        var categoryExportValues = getCategoryExportValues(product);
        var productImages = getImageUrls(product, 'large', ['medium']);
        var productThumbnails = getThumbnailUrls(product);
        var swatchImage = product.getImage('swatch');
        var productRating = getProductRating(product);
        var productColor = getProductColor(product);
        var exportPrices = getExportPrices(product);
        prdObj = {
            documentId: URLUtils.abs('Product-Show', 'pid', product.ID).toString(),
            FileExtension: coveoConstant.COVEO_CONSTANTS.EXTENSION,
            model: coveoConstant.COVEO_CONSTANTS.MODEL,
            language: getExportLanguage(exportContext),
            permanentid: productId,
            ec_product_id: productId,
            ec_images: productImages,
            ec_thumbnails: productThumbnails,
            ec_swatch: swatchImage && swatchImage.httpsURL ? swatchImage.httpsURL.toString() : '',
            ec_price: exportPrices.price,
            ec_category: categoryExportValues.ecCategory,
            ec_primary_category: categoryExportValues.ecPrimaryCategory,
            objecttype: coveoConstant.COVEO_CONSTANTS.OBJECT_TYPE_PRODUCT,
            ec_rating: productRating,
            ec_brand: product.brand,
            ec_description: getHtmlDocument(product.longDescription) || getHtmlDocument(product.shortDescription),
            ec_shortdesc: getMarkupSource(product.shortDescription)
        };
        if (exportPrices.promoPrice !== null) {
            prdObj.ec_promo_price = exportPrices.promoPrice;
        }
        fieldMappingHelper.applyFieldMappings(prdObj, product, coveoConstant.COVEO_CONSTANTS.OBJECT_TYPE_PRODUCT, exportContext);
        if (product.variant && 'color' in product.custom && !empty(product.custom.color)) {
            prdObj.ec_color = productColor;
        }
        if (product.variant && 'size' in product.custom && !empty(product.custom.size)) {
            prdObj.ec_size = getProductSize(product);
        }
        if (!empty(itemGroupId)) {
            prdObj.ec_item_group_id = itemGroupId;
        }
    } catch (ex) {
        Logger.error('(productRequestGenerator-getProductsData) -> Error occured while generating products and exception is: {0} in {1} : {2}', ex.toString(), ex.fileName, ex.lineNumber);
    }
    return prdObj;
}

/**
 * Get Variants Data
 * @function getVariantsData
 * @param {Object} product - product
 * @param {string} productId - productId
 * @param {Object} exportContext - export context
 * @returns {Object} - Object
 */
function getVariantsData(product, productId, exportContext) {
    var variantObj = null;
    try {
        variantObj = {
            documentId: URLUtils.abs('Product-Show', 'pid', 's' + product.ID).toString(),
            FileExtension: coveoConstant.COVEO_CONSTANTS.EXTENSION,
            language: getExportLanguage(exportContext),
            permanentid: productId,
            ec_sku: product.ID,
            ec_size: getProductSize(product),
            objecttype: coveoConstant.COVEO_CONSTANTS.OBJECT_TYPE_VARIANT,
            ec_product_id: productId,
            ec_variant_id: product.ID
        };
        fieldMappingHelper.applyFieldMappings(variantObj, product, coveoConstant.COVEO_CONSTANTS.OBJECT_TYPE_VARIANT, exportContext);
    } catch (ex) {
        Logger.error('(productRequestGenerator-getVariantsData) -> Error occured while generating Product variants and exception is: {0} in {1} : {2}', ex.toString(), ex.fileName, ex.lineNumber);
    }
    return variantObj;
}

/**
 * get product object to be exported
 * @function processProducts
 * @param {Object} product - product
 * @param {boolean} isDelta - isDelta
 * @param {Object} exportContext - export context
 * @returns {Object} - product object
 */
function processProducts(product, isDelta, exportContext) {
    var coveoProducts = [];

    try {
        var coveoPrd = ProductMgr.getProduct(product);

        if (coveoPrd.master) {
            var variants = coveoPrd.variants.toArray();
            var groupedVariants = {};

            variants.forEach(function (variant) {
                var colorKey = getColorGroupKey(variant);
                if (!groupedVariants[colorKey]) {
                    groupedVariants[colorKey] = [];
                }

                groupedVariants[colorKey].push(variant);
            });

            Object.keys(groupedVariants).forEach(function (colorKey) {
                var currentProductVariants = groupedVariants[colorKey];
                var representativeVariant = currentProductVariants[0];
                var parentProductId = getCanonicalProductId(representativeVariant);

                coveoProducts.push(getProductsData(representativeVariant, {
                    productId: parentProductId,
                    itemGroupId: coveoPrd.ID
                }, exportContext));

                currentProductVariants.forEach(function (element) {
                    coveoProducts.push(getVariantsData(element, parentProductId, exportContext));
                });
            });
        } else if (coveoPrd.variant && !empty(coveoPrd.masterProduct)) {
            var groupedProductId = getCanonicalProductId(coveoPrd);
            coveoProducts.push(getProductsData(coveoPrd, {
                productId: groupedProductId,
                itemGroupId: coveoPrd.masterProduct.ID
            }, exportContext));
            coveoProducts.push(getVariantsData(coveoPrd, groupedProductId, exportContext));
        } else {
            coveoProducts.push(getProductsData(coveoPrd, {
                productId: coveoPrd.ID
            }, exportContext));
        }
    } catch (ex) {
        Logger.error('(productRequestGenerator-processProducts) -> Error occured while processing products and exception is: {0} in {1} : {2}', ex.toString(), ex.fileName, ex.lineNumber);
    }
    return coveoProducts;
}

module.exports = {
    processProducts: processProducts
};
