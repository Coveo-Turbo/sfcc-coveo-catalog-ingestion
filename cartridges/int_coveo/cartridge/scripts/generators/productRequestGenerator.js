'use strict';

var CatalogMgr = require('dw/catalog/CatalogMgr');
var Encoding = require('dw/crypto/Encoding');
var MessageDigest = require('dw/crypto/MessageDigest');
var ProductMgr = require('dw/catalog/ProductMgr');
var Bytes = require('dw/util/Bytes');
var coveoConstant = require('*/cartridge/scripts/utils/coveoConstant');
var exportTargetHelper = require('*/cartridge/scripts/helper/exportTargetHelper');
var productEligibilityHelper = require('*/cartridge/scripts/helper/productEligibilityHelper');
var fieldMappingHelper = require('*/cartridge/scripts/helper/fieldMappingHelper');
var Logger = require('dw/system/Logger').getLogger('Coveo');
var purchaseMetricHelper = require('*/cartridge/scripts/helper/purchaseMetricHelper');
var Site = require('dw/system/Site');
var URLUtils = require('dw/web/URLUtils');
var DEFAULT_PRODUCT_IMAGE_VIEW_TYPES = ['large', 'medium'];
var DEFAULT_PRODUCT_THUMBNAIL_VIEW_TYPES = ['medium', 'large'];

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
 * Builds a SHA-256 signature for deterministic descriptor state.
 * @param {Object} value - Canonical state to sign.
 * @returns {string} hexadecimal SHA-256 signature.
 */
function digestDescriptorState(value) {
    var digest = new MessageDigest(MessageDigest.DIGEST_SHA_256);
    return Encoding.toHex(digest.digestBytes(new Bytes(JSON.stringify(value), 'UTF-8')));
}

/**
 * Returns a stable ISO timestamp for an SFCC date value.
 * @param {*} value - Date-like value.
 * @returns {string} normalized timestamp.
 */
function normalizeTimestamp(value) {
    var milliseconds;

    if (empty(value) || typeof value.getTime !== 'function') {
        return '';
    }

    milliseconds = value.getTime();
    if (isNaN(milliseconds)) {
        return '';
    }

    return new Date(milliseconds).toISOString();
}

/**
 * Returns the effective boolean value exposed by an SFCC product.
 * @param {Object} product - Product to inspect.
 * @param {string} propertyName - Product property name.
 * @param {string} methodName - Product getter name.
 * @returns {boolean} effective boolean value.
 */
function getEffectiveProductBoolean(product, propertyName, methodName) {
    if (empty(product)) {
        return false;
    }

    if (typeof product[methodName] === 'function') {
        return product[methodName]() === true;
    }

    return product[propertyName] === true;
}

/**
 * Returns the canonical Product document id used by payload generation.
 * @param {Object} product - Product represented by the document.
 * @returns {string} document id.
 */
function getProductDocumentId(product) {
    return URLUtils.abs('Product-Show', 'pid', product.ID).toString();
}

/**
 * Returns the canonical Variant document id used by payload generation.
 * @param {Object} product - Variant represented by the document.
 * @returns {string} document id.
 */
function getVariantDocumentId(product) {
    return URLUtils.abs('Product-Show', 'pid', 's' + product.ID).toString();
}

/**
 * Returns the lightweight root type.
 * @param {Object} product - Root product.
 * @returns {string} root type.
 */
function getRootType(product) {
    if (product.master) {
        return 'master';
    }

    if (product.variant) {
        return 'variant';
    }

    return 'standalone';
}

/**
 * Returns a lightweight timestamp record for a product.
 * @param {Object} product - Product to inspect.
 * @param {string} role - Relationship role.
 * @returns {Object|null} timestamp record.
 */
function buildModificationRecord(product, role) {
    if (empty(product)) {
        return null;
    }

    return {
        role: role,
        id: String(product.ID),
        masterId: product.variant && !empty(product.masterProduct) ? String(product.masterProduct.ID) : '',
        master: product.master === true,
        variant: product.variant === true,
        creationDate: normalizeTimestamp(product.creationDate),
        lastModified: normalizeTimestamp(product.lastModified)
    };
}

/**
 * Returns a lightweight effective eligibility record for a product.
 * @param {Object} product - Product to inspect.
 * @param {Object} master - Effective master product, when applicable.
 * @param {Object} exportContext - Export context.
 * @returns {Object|null} eligibility record.
 */
function buildEligibilityRecord(product, master, exportContext) {
    if (empty(product)) {
        return null;
    }

    return {
        id: String(product.ID),
        masterId: product.variant && !empty(product.masterProduct) ? String(product.masterProduct.ID) : '',
        online: getEffectiveProductBoolean(product, 'online', 'isOnline'),
        searchable: getEffectiveProductBoolean(product, 'searchable', 'isSearchable'),
        eligible: product.variant
            ? productEligibilityHelper.isVariantEligible(product, master, exportContext)
            : productEligibilityHelper.isProductEligible(product, exportContext)
    };
}

/**
 * Builds the exact lightweight identities emitted for a root.
 * @param {Object} product - Root product.
 * @param {Array} eligibleVariants - Eligible master variants.
 * @param {Object} exportContext - Export context.
 * @param {boolean} rootEligible - Whether the root is eligible.
 * @returns {Array} generated document identities.
 */
function buildRootDocumentIdentities(product, eligibleVariants, exportContext, rootEligible) {
    var identities = [];
    var groupedVariants = {};
    var isProductOnly = isProductOnlyCatalogStructureMode(exportContext);

    function appendProductIdentity(sourceProduct, productId, itemGroupId) {
        identities.push({
            documentId: getProductDocumentId(sourceProduct),
            objecttype: coveoConstant.COVEO_CONSTANTS.OBJECT_TYPE_PRODUCT,
            productId: productId,
            variantId: '',
            itemGroupId: itemGroupId
        });
    }

    function appendVariantIdentity(variant, productId, itemGroupId) {
        identities.push({
            documentId: getVariantDocumentId(variant),
            objecttype: coveoConstant.COVEO_CONSTANTS.OBJECT_TYPE_VARIANT,
            productId: productId,
            variantId: String(variant.ID),
            itemGroupId: itemGroupId
        });
    }

    if (!rootEligible) {
        return identities;
    }

    if (product.master) {
        if (isProductOnly) {
            eligibleVariants.forEach(function (variant) {
                appendProductIdentity(variant, String(variant.ID), String(product.ID));
            });
            return identities;
        }

        eligibleVariants.forEach(function (variant) {
            var colorKey = getColorGroupKey(variant);
            if (!groupedVariants[colorKey]) {
                groupedVariants[colorKey] = [];
            }
            groupedVariants[colorKey].push(variant);
        });

        Object.keys(groupedVariants).forEach(function (colorKey) {
            var currentVariants = groupedVariants[colorKey];
            var representativeVariant = currentVariants[0];
            var productId = getCanonicalProductId(representativeVariant);

            appendProductIdentity(representativeVariant, productId, String(product.ID));
            currentVariants.forEach(function (variant) {
                appendVariantIdentity(variant, productId, String(product.ID));
            });
        });
        return identities;
    }

    if (product.variant && !empty(product.masterProduct)) {
        if (isProductOnly) {
            appendProductIdentity(product, String(product.ID), String(product.masterProduct.ID));
            return identities;
        }

        var groupedProductId = getCanonicalProductId(product);
        appendProductIdentity(product, groupedProductId, String(product.masterProduct.ID));
        appendVariantIdentity(product, groupedProductId, String(product.masterProduct.ID));
        return identities;
    }

    appendProductIdentity(product, String(product.ID), String(product.ID));
    return identities;
}

/**
 * Builds lightweight change, eligibility, and ownership state for an export root.
 * This intentionally avoids all complete payload dependencies.
 * @param {Object} product - Loaded export root product.
 * @param {Object} exportContext - Export context.
 * @returns {Object|null} lightweight root descriptor.
 */
function buildRootDescriptorFromProduct(product, exportContext) {
    var rootType;
    var master;
    var allVariants;
    var eligibleVariants = [];
    var rootEligible;
    var modificationRecords;
    var eligibilityRecords;
    var identities;
    var documentIds;
    var structureMode;
    var eligibilityMode;
    var modifiedAt = '';

    if (empty(product)) {
        return null;
    }

    rootType = getRootType(product);
    master = product.master ? product : (product.variant && !empty(product.masterProduct) ? product.masterProduct : null);
    allVariants = !empty(master) ? toArray(master.variants) : [];
    rootEligible = product.variant && !empty(master)
        ? productEligibilityHelper.isVariantEligible(product, master, exportContext)
        : productEligibilityHelper.isProductEligible(product, exportContext);

    if (product.master && rootEligible) {
        eligibleVariants = productEligibilityHelper.getEligibleVariants(product, exportContext);
    } else if (product.variant && rootEligible) {
        eligibleVariants = [product];
    }

    modificationRecords = [buildModificationRecord(product, 'root')];
    if (!empty(master)) {
        modificationRecords.push(buildModificationRecord(master, 'master'));
    }
    allVariants.forEach(function (variant) {
        modificationRecords.push(buildModificationRecord(variant, 'variant'));
    });
    modificationRecords = modificationRecords.filter(function (record) {
        return record !== null;
    }).sort(function (left, right) {
        var leftKey = left.role + '\u0000' + left.id;
        var rightKey = right.role + '\u0000' + right.id;
        return leftKey < rightKey ? -1 : (leftKey > rightKey ? 1 : 0);
    });
    modificationRecords.forEach(function (record) {
        [record.creationDate, record.lastModified].forEach(function (timestamp) {
            if (timestamp > modifiedAt) {
                modifiedAt = timestamp;
            }
        });
    });

    eligibilityRecords = [buildEligibilityRecord(product, master, exportContext)];
    if (!empty(master)) {
        eligibilityRecords.push(buildEligibilityRecord(master, null, exportContext));
    }
    allVariants.forEach(function (variant) {
        eligibilityRecords.push(buildEligibilityRecord(variant, master, exportContext));
    });
    eligibilityRecords = eligibilityRecords.filter(function (record) {
        return record !== null;
    }).sort(function (left, right) {
        var leftKey = left.id + '\u0000' + left.masterId;
        var rightKey = right.id + '\u0000' + right.masterId;
        return leftKey < rightKey ? -1 : (leftKey > rightKey ? 1 : 0);
    });

    identities = buildRootDocumentIdentities(product, eligibleVariants, exportContext, rootEligible);
    identities.sort(function (left, right) {
        var leftKey = left.documentId + '\u0000' + left.objecttype + '\u0000' + left.productId + '\u0000' + left.variantId;
        var rightKey = right.documentId + '\u0000' + right.objecttype + '\u0000' + right.productId + '\u0000' + right.variantId;
        return leftKey < rightKey ? -1 : (leftKey > rightKey ? 1 : 0);
    });
    documentIds = identities.map(function (identity) {
        return identity.documentId;
    }).sort();
    structureMode = exportTargetHelper.normalizeCatalogStructureMode(exportContext && exportContext.catalogStructureMode);
    eligibilityMode = exportTargetHelper.normalizeProductEligibilityMode(exportContext && exportContext.productEligibilityMode);

    var signatureBase = {
        descriptorSchemaVersion: 1,
        rootId: String(product.ID),
        rootType: rootType
    };
    var eligibleVariantIds = eligibleVariants.map(function (variant) {
        return String(variant.ID);
    }).sort();

    return {
        descriptorSchemaVersion: 1,
        rootId: String(product.ID),
        rootType: rootType,
        modifiedAt: modifiedAt,
        modificationSignature: digestDescriptorState({
            descriptor: signatureBase,
            records: modificationRecords
        }),
        eligibilitySignature: digestDescriptorState({
            descriptor: signatureBase,
            catalogStructureMode: structureMode,
            productEligibilityMode: eligibilityMode,
            rootEligible: rootEligible,
            eligibleVariantIds: eligibleVariantIds,
            records: eligibilityRecords
        }),
        ownershipSignature: digestDescriptorState({
            descriptor: signatureBase,
            catalogStructureMode: structureMode,
            productEligibilityMode: eligibilityMode,
            rootEligible: rootEligible,
            eligibleVariantIds: eligibleVariantIds,
            identities: identities,
            documentIds: documentIds
        }),
        documentIds: documentIds
    };
}

/**
 * Builds lightweight change, eligibility, and ownership state for an export root.
 * @param {string} rootId - Export root product id.
 * @param {Object} exportContext - Export context.
 * @returns {Object|null} lightweight root descriptor.
 */
function buildRootDescriptor(rootId, exportContext) {
    return buildRootDescriptorFromProduct(ProductMgr.getProduct(rootId), exportContext);
}

/**
 * Returns a deduplicated array of metric aliases.
 * @param {Array} aliases - Candidate aliases.
 * @returns {Array} normalized aliases.
 */
function getMetricAliases(aliases) {
    var seen = {};

    return (aliases || []).map(function (alias) {
        return alias === null || alias === undefined ? '' : String(alias).trim();
    }).filter(function (alias) {
        if (alias === '' || seen[alias]) {
            return false;
        }

        seen[alias] = true;
        return true;
    });
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
 * Returns whether the current export target uses product-only catalog rows.
 * @param {Object} exportContext - Export context.
 * @returns {boolean} whether the export is product-only.
 */
function isProductOnlyCatalogStructureMode(exportContext) {
    return exportTargetHelper.normalizeCatalogStructureMode(exportContext && exportContext.catalogStructureMode)
        === exportTargetHelper.CATALOG_STRUCTURE_MODE_PRODUCT_ONLY;
}

/**
 * Returns whether payload-generation errors must abort reconciliation.
 * Legacy exports preserve their historical best-effort behavior.
 * @param {Object} exportContext - Export context.
 * @returns {boolean} whether errors must propagate.
 */
function shouldPropagatePayloadError(exportContext) {
    return exportTargetHelper.normalizeProductEligibilityMode(exportContext && exportContext.productEligibilityMode)
        !== exportTargetHelper.PRODUCT_ELIGIBILITY_MODE_LEGACY;
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
 * Returns the configured fallback image URL for the requested image role.
 * @param {string} imageRole - image role, for example image or thumbnail.
 * @returns {string} fallback image URL.
 */
function getConfiguredImagePlaceholderUrl(imageRole) {
    var placeholderUrl = '';

    if (imageRole === 'thumbnail') {
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
 * Returns the ordered image view types to try for a given export field.
 * @param {string} preferenceId - Site preference id.
 * @param {Array} defaultViewTypes - default ordered view types.
 * @returns {Array} ordered view types.
 */
function getConfiguredImageViewTypes(preferenceId, defaultViewTypes) {
    var rawValue = getSitePreferenceValue(preferenceId);
    var seen = {};
    var configuredViewTypes;

    if (empty(rawValue)) {
        return defaultViewTypes.slice();
    }

    configuredViewTypes = rawValue.split(/[\r\n,;]+/).map(function (viewType) {
        return String(viewType).trim();
    }).filter(function (viewType) {
        if (empty(viewType) || seen[viewType]) {
            return false;
        }

        seen[viewType] = true;
        return true;
    });

    return configuredViewTypes.length ? configuredViewTypes : defaultViewTypes.slice();
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
 * Returns image URLs for a given ordered list of SFCC image view types.
 * @param {Object} product - product
 * @param {Array} viewTypes - ordered image view types to try
 * @param {string} imageRole - image role, for example image or thumbnail
 * @returns {Array} image urls
 */
function getImageUrls(product, viewTypes, imageRole) {
    var imageUrls = [];
    var orderedViewTypes = Array.isArray(viewTypes) ? viewTypes.filter(function (viewType) {
        return !empty(viewType);
    }) : [];

    try {
        orderedViewTypes.some(function (viewType) {
            imageUrls = collectImageUrls(product, viewType);
            return imageUrls.length > 0;
        });

        if (!imageUrls.length) {
            var configuredPlaceholderUrl = getConfiguredImagePlaceholderUrl(imageRole);
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
    return getImageUrls(
        product,
        getConfiguredImageViewTypes('coveoProductThumbnailViewTypes', DEFAULT_PRODUCT_THUMBNAIL_VIEW_TYPES),
        'thumbnail'
    );
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
        var itemGroupId = exportOptions && exportOptions.itemGroupId ? exportOptions.itemGroupId : productId;
        var mappingObjectTypes = exportOptions && exportOptions.mappingObjectTypes
            ? exportOptions.mappingObjectTypes
            : coveoConstant.COVEO_CONSTANTS.OBJECT_TYPE_PRODUCT;
        var categoryExportValues = getCategoryExportValues(product);
        var productImages = getImageUrls(
            product,
            getConfiguredImageViewTypes('coveoProductImageViewTypes', DEFAULT_PRODUCT_IMAGE_VIEW_TYPES),
            'image'
        );
        var productThumbnails = getThumbnailUrls(product);
        var swatchImage = product.getImage('swatch');
        var productRating = getProductRating(product);
        var productColor = getProductColor(product);
        var exportPrices = getExportPrices(product);
        prdObj = {
            documentId: getProductDocumentId(product),
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
        fieldMappingHelper.applyFieldMappings(prdObj, product, mappingObjectTypes, exportContext);
        if (product.variant && 'color' in product.custom && !empty(product.custom.color)) {
            prdObj.ec_color = productColor;
        }
        if (product.variant && 'size' in product.custom && !empty(product.custom.size)) {
            prdObj.ec_size = getProductSize(product);
        }
        if (product.variant && isProductOnlyCatalogStructureMode(exportContext)) {
            prdObj.ec_sku = product.ID;
        }
        prdObj.ec_item_group_id = itemGroupId;

        purchaseMetricHelper.applyPurchaseMetrics(prdObj, {
            objecttype: coveoConstant.COVEO_CONSTANTS.OBJECT_TYPE_PRODUCT,
            documentId: prdObj.documentId,
            aliases: getMetricAliases(exportOptions && exportOptions.metricAliases ? exportOptions.metricAliases : [productId])
        }, exportContext);
    } catch (ex) {
        Logger.error('(productRequestGenerator-getProductsData) -> Error occured while generating products and exception is: {0} in {1} : {2}', ex.toString(), ex.fileName, ex.lineNumber);

        if (shouldPropagatePayloadError(exportContext)) {
            throw ex;
        }
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
            documentId: getVariantDocumentId(product),
            FileExtension: coveoConstant.COVEO_CONSTANTS.EXTENSION,
            language: getExportLanguage(exportContext),
            permanentid: product.ID,
            ec_sku: product.ID,
            ec_size: getProductSize(product),
            objecttype: coveoConstant.COVEO_CONSTANTS.OBJECT_TYPE_VARIANT,
            ec_product_id: productId,
            ec_variant_id: product.ID
        };
        fieldMappingHelper.applyFieldMappings(variantObj, product, coveoConstant.COVEO_CONSTANTS.OBJECT_TYPE_VARIANT, exportContext);
        purchaseMetricHelper.applyPurchaseMetrics(variantObj, {
            objecttype: coveoConstant.COVEO_CONSTANTS.OBJECT_TYPE_VARIANT,
            documentId: variantObj.documentId,
            aliases: getMetricAliases([variantObj.ec_variant_id, variantObj.permanentid])
        }, exportContext);
    } catch (ex) {
        Logger.error('(productRequestGenerator-getVariantsData) -> Error occured while generating Product variants and exception is: {0} in {1} : {2}', ex.toString(), ex.fileName, ex.lineNumber);

        if (shouldPropagatePayloadError(exportContext)) {
            throw ex;
        }
    }
    return variantObj;
}

/**
 * Generates export items from an already loaded product.
 * @param {Object} product - loaded product
 * @param {boolean} isDelta - isDelta
 * @param {Object} exportContext - export context
 * @returns {Object} - product object
 */
function processLoadedProduct(product, isDelta, exportContext) {
    var coveoProducts = [];
    var isProductOnly = isProductOnlyCatalogStructureMode(exportContext);

    try {
        var coveoPrd = product;

        if (empty(coveoPrd)) {
            return coveoProducts;
        }

        if (coveoPrd.master) {
            if (!productEligibilityHelper.isProductEligible(coveoPrd, exportContext)) {
                return coveoProducts;
            }

            var eligibleVariants = productEligibilityHelper.getEligibleVariants(coveoPrd, exportContext);

            if (isProductOnly) {
                eligibleVariants.forEach(function (variant) {
                    coveoProducts.push(getProductsData(variant, {
                        productId: variant.ID,
                        itemGroupId: coveoPrd.ID,
                        metricAliases: [variant.ID],
                        mappingObjectTypes: [
                            coveoConstant.COVEO_CONSTANTS.OBJECT_TYPE_PRODUCT,
                            coveoConstant.COVEO_CONSTANTS.OBJECT_TYPE_VARIANT
                        ]
                    }, exportContext));
                });

                return coveoProducts;
            }

            var variants = eligibleVariants;
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
                var metricAliases = [parentProductId];

                currentProductVariants.forEach(function (variant) {
                    metricAliases.push(variant.ID);
                });

                coveoProducts.push(getProductsData(representativeVariant, {
                    productId: parentProductId,
                    itemGroupId: coveoPrd.ID,
                    metricAliases: metricAliases
                }, exportContext));

                currentProductVariants.forEach(function (element) {
                    coveoProducts.push(getVariantsData(element, parentProductId, exportContext));
                });
            });
        } else if (coveoPrd.variant && !empty(coveoPrd.masterProduct)) {
            if (!productEligibilityHelper.isVariantEligible(coveoPrd, coveoPrd.masterProduct, exportContext)) {
                return coveoProducts;
            }

            if (isProductOnly) {
                coveoProducts.push(getProductsData(coveoPrd, {
                    productId: coveoPrd.ID,
                    itemGroupId: coveoPrd.masterProduct.ID,
                    metricAliases: [coveoPrd.ID],
                    mappingObjectTypes: [
                        coveoConstant.COVEO_CONSTANTS.OBJECT_TYPE_PRODUCT,
                        coveoConstant.COVEO_CONSTANTS.OBJECT_TYPE_VARIANT
                    ]
                }, exportContext));

                return coveoProducts;
            }

            var groupedProductId = getCanonicalProductId(coveoPrd);
            coveoProducts.push(getProductsData(coveoPrd, {
                productId: groupedProductId,
                itemGroupId: coveoPrd.masterProduct.ID,
                metricAliases: [groupedProductId, coveoPrd.ID]
            }, exportContext));
            coveoProducts.push(getVariantsData(coveoPrd, groupedProductId, exportContext));
        } else {
            if (!productEligibilityHelper.isProductEligible(coveoPrd, exportContext)) {
                return coveoProducts;
            }

            coveoProducts.push(getProductsData(coveoPrd, {
                productId: coveoPrd.ID,
                metricAliases: [coveoPrd.ID]
            }, exportContext));
        }
    } catch (ex) {
        Logger.error('(productRequestGenerator-processProducts) -> Error occured while processing products and exception is: {0} in {1} : {2}', ex.toString(), ex.fileName, ex.lineNumber);

        if (shouldPropagatePayloadError(exportContext)) {
            throw ex;
        }
    }
    return coveoProducts;
}

/**
 * Gets and generates the product object to be exported.
 * @function processProducts
 * @param {string} product - product id
 * @param {boolean} isDelta - isDelta
 * @param {Object} exportContext - export context
 * @returns {Object} - product object
 */
function processProducts(product, isDelta, exportContext) {
    var coveoPrd;

    try {
        coveoPrd = ProductMgr.getProduct(product);
    } catch (ex) {
        Logger.error('(productRequestGenerator-processProducts) -> Error occured while processing products and exception is: {0} in {1} : {2}', ex.toString(), ex.fileName, ex.lineNumber);

        if (shouldPropagatePayloadError(exportContext)) {
            throw ex;
        }

        return [];
    }

    return processLoadedProduct(coveoPrd, isDelta, exportContext);
}

/**
 * Returns sorted document ids from generated items.
 * @param {Array} items - Generated export items.
 * @returns {Array} sorted document ids.
 */
function getGeneratedDocumentIds(items) {
    return items.map(function (item) {
        return item && !empty(item.documentId) ? String(item.documentId) : '';
    }).sort();
}

/**
 * Returns whether two arrays contain the same values in the same order.
 * @param {Array} left - First array.
 * @param {Array} right - Second array.
 * @returns {boolean} whether the arrays match.
 */
function arraysEqual(left, right) {
    var index;

    if (left.length !== right.length) {
        return false;
    }

    for (index = 0; index < left.length; index += 1) {
        if (left[index] !== right[index]) {
            return false;
        }
    }

    return true;
}

/**
 * Generates one root from a single loaded product snapshot and rejects unstable state.
 * @param {string} rootId - Export root product id.
 * @param {boolean} isDelta - Whether the generation is for a delta export.
 * @param {Object} exportContext - Export context.
 * @returns {Object} descriptor and generated items.
 */
function generateRoot(rootId, isDelta, exportContext) {
    var product = ProductMgr.getProduct(rootId);
    var descriptor = buildRootDescriptorFromProduct(product, exportContext);
    var items = processLoadedProduct(product, isDelta, exportContext);
    var descriptorAfter = buildRootDescriptorFromProduct(product, exportContext);
    var signatureNames = [
        'modificationSignature',
        'eligibilitySignature',
        'ownershipSignature'
    ];
    var generatedDocumentIds;

    if (descriptor === null || descriptorAfter === null) {
        if (descriptor !== descriptorAfter) {
            throw new Error('Product root "' + rootId + '" changed during generation.');
        }
    } else {
        signatureNames.forEach(function (signatureName) {
            if (descriptor[signatureName] !== descriptorAfter[signatureName]) {
                throw new Error('Product root "' + rootId + '" changed during generation: ' + signatureName + ' differs.');
            }
        });
    }

    generatedDocumentIds = getGeneratedDocumentIds(items);
    if (!arraysEqual(generatedDocumentIds, descriptor ? descriptor.documentIds : [])) {
        throw new Error('Product root "' + rootId + '" generated documentIds that differ from its descriptor.');
    }

    return {
        descriptor: descriptor,
        items: items
    };
}

module.exports = {
    buildRootDescriptor: buildRootDescriptor,
    generateRoot: generateRoot,
    processProducts: processProducts
};
