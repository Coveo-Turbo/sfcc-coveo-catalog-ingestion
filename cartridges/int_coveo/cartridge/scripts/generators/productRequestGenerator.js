'use strict';

var ArrayList = require('dw/util/ArrayList');
var CatalogMgr = require('dw/catalog/CatalogMgr');
var ProductMgr = require('dw/catalog/ProductMgr');
var coveoConstant = require('*/cartridge/scripts/utils/coveoConstant');
var Logger = require('dw/system/Logger').getLogger('Coveo');
var Site = require('dw/system/Site');
var ObjectAttributeDefinition = require('dw/object/ObjectAttributeDefinition');
var URLUtils = require('dw/web/URLUtils');

var attribute = null;
var coveoField = null;
var coveoFieldKey = null;
var coveoFieldValue = null;

/**
 * Get Additional Attribute
 * @function getAdditionalAttribute
 * @param {Object} object - product
 * @param {Object} coveoFieldMapper - product
 * @param {string} key - product
 * @returns {Object} - Object
 */
function getAdditionalAttribute(object, coveoFieldMapper, key) {
    try {
        if (!empty(object) && !coveoFieldMapper[key].hasOwnProperty('fieldName')) { // eslint-disable-line
            var nextKey = Object.keys(coveoFieldMapper[key]);
            getAdditionalAttribute(object[key], coveoFieldMapper[key], nextKey);
        } else if (!empty(object)) {
            coveoFieldKey = coveoFieldMapper[key];
            coveoFieldValue = object[key];
            attribute = {
                key: coveoFieldKey.fieldName,
                value: coveoFieldValue || ''
            };
        }
    } catch (ex) {
        Logger.error('(productRequestGenerator-getAdditionalAttribute) -> Error occured while processing attributes and exception is: {0} in {1} : {2}', ex.toString(), ex.fileName, ex.lineNumber);
    }
    return attribute;
}

/**
 * Get Coveo Field
 * @function getCoveoField
 * @param {Object} object - product
 * @param {Object} coveoFieldMapper - product
 * @param {string} key - product
 * @returns {Array} - array
 */
function getCoveoField(object, coveoFieldMapper, key) {
    var attributes = [];
    try {
        coveoField = coveoFieldMapper[key];
        if (!empty(object) && coveoFieldMapper[key].hasOwnProperty('fieldName')) { // eslint-disable-line
            coveoFieldKey = coveoFieldMapper[key];
            coveoFieldValue = object[key];
            attribute = {
                key: coveoFieldKey.fieldName,
                value: coveoFieldValue || ''
            };
            attributes.push(attribute);
        } else {
            Object.keys(coveoField).forEach(function (Akey) {
                attributes.push(getAdditionalAttribute(object[key], coveoField, Akey));
            });
        }
    } catch (ex) {
        Logger.error('(productRequestGenerator-getCoveoField) -> Error occured while getting product fields and exception is: {0} in {1} : {2}', ex.toString(), ex.fileName, ex.lineNumber);
    }
    return attributes;
}

/**
 * Get Attribute Value
 * @function getAttributeValue
 * @param {Object} product - product
 * @returns {Array} - array
 */
function getAttributeValue(product) {
    try {
        var additionalFields = [];
        var coveoFieldMapper = coveoConstant.COVEO_FIELD_MAPPER;
        Object.keys(coveoFieldMapper).forEach(function (key) {
            var coveoAttribute = coveoFieldMapper[key];
            var attributeModel = product.getAttributeModel();
            var attributeDefinition = attributeModel.getAttributeDefinition(key);
            var attributeTypeCode = attributeDefinition ? attributeDefinition.valueTypeCode : '';
            var attributeValue = null;
            if (attributeTypeCode) {
                if (attributeDefinition.system) {
                    attributeValue = product[key];
                } else {
                    attributeValue = product.custom[key];
                }
            } else if (empty(attributeDefinition)) {
                coveoAttribute = getCoveoField(product, coveoFieldMapper, key);
                additionalFields = additionalFields.concat(coveoAttribute);
            } else {
                Logger.error('(productRequestGenerator-getAttributeValue) -> Attribute Type Code does not match');
            }
            if (!empty(attributeTypeCode)) {
                var coveoValue = [];
                switch (attributeTypeCode) {
                    case ObjectAttributeDefinition.VALUE_TYPE_ENUM_OF_STRING:
                    case ObjectAttributeDefinition.VALUE_TYPE_ENUM_OF_INT:
                    case ObjectAttributeDefinition.VALUE_TYPE_SET_OF_NUMBER:
                    case ObjectAttributeDefinition.VALUE_TYPE_SET_OF_STRING:
                    case ObjectAttributeDefinition.VALUE_TYPE_SET_OF_INT:
                        var attributes = new ArrayList(attributeValue).toArray();
                        attributes.forEach(element => {
                            coveoValue.push(element.displayValue);
                        });
                        additionalFields.push({
                            key: coveoAttribute.fieldName,
                            value: coveoValue
                        });
                        break;
                    default:
                        additionalFields.push({
                            key: coveoAttribute.fieldName,
                            value: attributeValue
                        });
                        break;
                }
            }
        });
        return additionalFields;
    } catch (ex) {
        Logger.error('(productRequestGenerator-getAttributeValue) -> AttributeId is not system or custom Product Attribute and exception is: {0} in {1} : {2}', ex.toString(), ex.fileName, ex.lineNumber);
        return [];
    }
}

/**
 * Get Product Catagegories
 * @param {Object} product - product
 * @param {string} categoryid - categoryid
 * @param {Array} breadcrumbs - array of breadcrumbs object
 * @returns {string} - string
 */
function getAllCategories(product, categoryid, breadcrumbs) {
    var categories = '';
    try {
        var category;
        if (!empty(product) && empty(categoryid)) {
            category = product.variant
                ? product.masterProduct.primaryCategory
                : product.primaryCategory;
        } else if (!empty(categoryid)) {
            category = CatalogMgr.getCategory(categoryid);
        }

        if (category) {
            breadcrumbs.push(category.displayName);

            if (category.parent && category.parent.ID !== 'root') {
                return getAllCategories(null, category.parent.ID, breadcrumbs);
            }
        }
        var coveoCategory = breadcrumbs.reverse();

        for (let i = 0; i < coveoCategory.length; i++) {
            categories += coveoCategory.slice(0, i + 1).join('|');
            categories += ';';
        }

        categories = categories.slice(0, -1);
    } catch (ex) {
        Logger.error('(productRequestGenerator-getAllCategories) -> Error occured while generating product categories and exception is: {0} in {1} : {2}', ex.toString(), ex.fileName, ex.lineNumber);
    }
    return categories;
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
 * @returns {string} language code.
 */
function getExportLanguage() {
    var defaultLocale = Site.current && Site.current.defaultLocale ? String(Site.current.defaultLocale) : '';

    if (empty(defaultLocale)) {
        return '';
    }

    return defaultLocale.split(/[-_]/)[0].toLowerCase();
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
 * @returns {Array} image urls
 */
function getImageUrls(product, viewType) {
    var imageUrls = [];

    try {
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
    return getImageUrls(product, 'medium');
}

/**
 * Get Product Data
 * @function getProductsData
 * @param {Object} product - product
 * @param {Object} exportOptions - export options
 * @returns {Object} - Object
 */
function getProductsData(product, exportOptions) {
    var prdObj = null;
    try {
        var productId = exportOptions && exportOptions.productId ? exportOptions.productId : getCanonicalProductId(product);
        var itemGroupId = exportOptions && exportOptions.itemGroupId ? exportOptions.itemGroupId : null;
        var coveoProductAttribute = getAttributeValue(product);
        var coveoProductCategory = getAllCategories(product, null, []);
        var productImages = getImageUrls(product, 'large');
        var productThumbnails = getThumbnailUrls(product);
        var swatchImage = product.getImage('swatch');
        var productRating = getProductRating(product);
        var productColor = getProductColor(product);
        prdObj = {
            documentId: URLUtils.abs('Product-Show', 'pid', product.ID).toString(),
            FileExtension: coveoConstant.COVEO_CONSTANTS.EXTENSION,
            model: coveoConstant.COVEO_CONSTANTS.MODEL,
            language: getExportLanguage(),
            permanentid: productId,
            ec_product_id: productId,
            ec_images: productImages,
            ec_thumbnails: productThumbnails,
            ec_swatch: swatchImage && swatchImage.httpsURL ? swatchImage.httpsURL.toString() : '',
            ec_price: product.priceModel.maxPrice.value,
            ec_category: coveoProductCategory,
            objecttype: coveoConstant.COVEO_CONSTANTS.OBJECT_TYPE_PRODUCT,
            ec_rating: productRating,
            ec_brand: product.brand,
            ec_description: product.shortDescription ? product.shortDescription.source : ''
        };
        coveoProductAttribute.forEach(field => {
            if (!empty(field) && field.key !== "ec_color") {
                prdObj[field.key] = field.value;
            }
        });
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
 * @returns {Object} - Object
 */
function getVariantsData(product, productId) {
    var variantObj = null;
    try {
        var coveoProductAttribute = getAttributeValue(product);
        variantObj = {
            documentId: URLUtils.abs('Product-Show', 'pid', 's' + product.ID).toString(),
            FileExtension: coveoConstant.COVEO_CONSTANTS.EXTENSION,
            language: getExportLanguage(),
            permanentid: product.ID,
            ec_sku: product.ID,
            ec_size: getProductSize(product),
            objecttype: coveoConstant.COVEO_CONSTANTS.OBJECT_TYPE_VARIANT,
            ec_product_id: productId,
            ec_variant_id: product.ID
        };
        coveoProductAttribute.forEach(field => {
            if (!empty(field) && field.key !== "ec_color") {
                variantObj[field.key] = field.value;
            }
        });
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
 * @returns {Object} - product object
 */
function processProducts(product, isDelta) {
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
                }));

                currentProductVariants.forEach(function (element) {
                    coveoProducts.push(getVariantsData(element, parentProductId));
                });
            });
        } else if (coveoPrd.variant && !empty(coveoPrd.masterProduct)) {
            var groupedProductId = getCanonicalProductId(coveoPrd);
            coveoProducts.push(getProductsData(coveoPrd, {
                productId: groupedProductId,
                itemGroupId: coveoPrd.masterProduct.ID
            }));
            coveoProducts.push(getVariantsData(coveoPrd, groupedProductId));
        } else {
            coveoProducts.push(getProductsData(coveoPrd, {
                productId: coveoPrd.ID
            }));
        }
    } catch (ex) {
        Logger.error('(productRequestGenerator-processProducts) -> Error occured while processing products and exception is: {0} in {1} : {2}', ex.toString(), ex.fileName, ex.lineNumber);
    }
    return coveoProducts;
}

module.exports = {
    processProducts: processProducts
};
