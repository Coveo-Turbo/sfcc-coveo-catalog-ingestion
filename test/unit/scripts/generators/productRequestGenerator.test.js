'use strict';

var path = require('path');
var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();

function buildUrl(route, pid) {
    return {
        toString: function () {
            return 'https://example.com/' + route + '?pid=' + pid;
        }
    };
}

function createArrayWrapper(values) {
    return {
        toArray: function () {
            return values;
        }
    };
}

function createCategory(id, displayName, options) {
    var categoryOptions = options || {};

    return {
        ID: id,
        name: categoryOptions.name || displayName || id,
        displayName: displayName,
        online: categoryOptions.online !== false,
        parent: categoryOptions.parent || {
            ID: 'root'
        }
    };
}

function createVariationModel(colorId, sizeId) {
    return {
        getProductVariationAttribute: function (name) {
            if (name === 'color' && colorId) {
                return {
                    ID: 'color'
                };
            }

            if ((name === 'size' || name === 'accessorySize') && sizeId) {
                return {
                    ID: name
                };
            }

            return null;
        },
        getAllValues: function (attribute) {
            if (attribute.ID === 'color') {
                return createArrayWrapper([{
                    ID: colorId,
                    displayValue: colorId.toUpperCase()
                }]);
            }

            return createArrayWrapper([{
                ID: sizeId,
                displayValue: sizeId.toUpperCase()
            }]);
        }
    };
}

function createSiteCurrent(customPreferences) {
    return {
        defaultLocale: 'en_CA',
        preferences: {
            custom: customPreferences || {}
        }
    };
}

function createExportTargetHelperStub() {
    return {
        CATALOG_STRUCTURE_MODE_PRODUCT_ONLY: 'product_only',
        normalizeCatalogStructureMode: function (value) {
            return value ? String(value).trim().toLowerCase() : 'product_only';
        },
        getLanguageFromLocale: function (locale) {
            return locale.split(/[-_]/)[0].toLowerCase();
        }
    };
}

function createProduct(options) {
    var imageSets = options.images || {};
    var categoryAssignments = [];
    var listPrice = 99;
    var primaryCategory = Object.prototype.hasOwnProperty.call(options, 'primaryCategory')
        ? options.primaryCategory
        : createCategory('mens-shoes', 'Mens Shoes');
    var salesPrice;
    var activePriceBook;

    if (Object.prototype.hasOwnProperty.call(options, 'categories')) {
        categoryAssignments = options.categories;
    } else if (primaryCategory) {
        categoryAssignments = [primaryCategory];
    }

    if (Object.prototype.hasOwnProperty.call(options, 'listPrice')) {
        listPrice = options.listPrice;
    } else if (Object.prototype.hasOwnProperty.call(options, 'price')) {
        listPrice = options.price;
    }

    salesPrice = Object.prototype.hasOwnProperty.call(options, 'salesPrice')
        ? options.salesPrice
        : listPrice;
    activePriceBook = options.activePriceBook || {
        ID: salesPrice < listPrice ? 'sale-book' : 'list-book',
        parentPriceBook: salesPrice < listPrice ? {
            ID: 'list-book',
            parentPriceBook: null
        } : null
    };

    function createImage(url) {
        return {
            httpsURL: {
                toString: function () {
                    return url;
                }
            }
        };
    }

    return {
        ID: options.ID,
        name: options.name || ('Name ' + options.ID),
        master: !!options.master,
        variant: !!options.variant,
        masterProduct: options.masterProduct || null,
        primaryCategory: primaryCategory,
        categories: createArrayWrapper(categoryAssignments),
        priceModel: {
            price: {
                value: salesPrice
            },
            minPrice: {
                value: salesPrice
            },
            maxPrice: {
                value: listPrice
            },
            priceInfo: {
                priceBook: activePriceBook
            },
            getPriceBookPrice: function (priceBookId) {
                if (priceBookId === 'list-book') {
                    return {
                        value: listPrice
                    };
                }

                if (priceBookId === 'sale-book') {
                    return {
                        value: salesPrice
                    };
                }

                return {
                    value: listPrice
                };
            }
        },
        brand: options.brand || 'Coveo',
        shortDescription: {
            source: Object.prototype.hasOwnProperty.call(options, 'shortDescription') ? options.shortDescription : 'Short Description'
        },
        longDescription: {
            source: Object.prototype.hasOwnProperty.call(options, 'longDescription') ? options.longDescription : 'Long Description'
        },
        custom: options.custom || {},
        variationModel: createVariationModel(options.custom && options.custom.color, options.custom && options.custom.size),
        getImages: function (imageType) {
            var imageUrls = imageSets[imageType];

            if (!imageUrls) {
                return createArrayWrapper([]);
            }

            return createArrayWrapper(imageUrls.map(function (url) {
                return createImage(url);
            }));
        },
        getImage: function (imageType) {
            var imageUrls = imageSets[imageType];
            var imageUrl = imageUrls && imageUrls.length
                ? imageUrls[0]
                : null;

            return imageUrl ? createImage(imageUrl) : null;
        },
        getAttributeModel: function () {
            return {
                getAttributeDefinition: function () {
                    return null;
                }
            };
        },
        getCategories: function () {
            return createArrayWrapper(categoryAssignments);
        },
        getOnlineCategories: function () {
            return createArrayWrapper(categoryAssignments.filter(function (category) {
                return category.online !== false;
            }));
        }
    };
}

describe('productRequestGenerator', function () {
    beforeEach(function () {
        global.empty = function (value) {
            return value === null
                || value === undefined
                || value === ''
                || (Array.isArray(value) && value.length === 0);
        };
    });

    afterEach(function () {
        delete global.empty;
    });

    it('exports a standalone product without creating a synthetic variant item', function () {
        var standaloneProduct = createProduct({
            ID: 'SKU-1',
            images: {
                large: [
                    'https://example.com/images/SKU-1/large-1.jpg',
                    'https://example.com/images/SKU-1/large-2.jpg'
                ]
            }
        });

        var generator = proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/generators/productRequestGenerator'), {
            'dw/util/ArrayList': function ArrayList(values) {
                return {
                    toArray: function () {
                        return values;
                    }
                };
            },
            'dw/catalog/CatalogMgr': {
                getCategory: function () {
                    return null;
                }
            },
            'dw/catalog/ProductMgr': {
                getProduct: function () {
                    return standaloneProduct;
                }
            },
            '*/cartridge/scripts/utils/coveoConstant': {
                COVEO_CONSTANTS: {
                    EXTENSION: '.html',
                    MODEL: 'Authentic',
                    OBJECT_TYPE_PRODUCT: 'Product',
                    OBJECT_TYPE_VARIANT: 'Variant'
                }
            },
            '*/cartridge/scripts/helper/exportTargetHelper': createExportTargetHelperStub(),
            '*/cartridge/scripts/helper/fieldMappingHelper': {
                applyFieldMappings: function (payload, product) {
                    payload.ec_name = product.name;
                    return payload;
                }
            },
            '*/cartridge/scripts/helper/purchaseMetricHelper': {
                applyPurchaseMetrics: function () {}
            },
            'dw/system/Logger': {
                getLogger: function () {
                    return {
                        error: function () {}
                    };
                }
            },
            'dw/system/Site': {
                current: {
                    defaultLocale: 'en_CA'
                }
            },
            'dw/object/ObjectAttributeDefinition': {},
            'dw/web/URLUtils': {
                abs: function (route, key, pid) { // eslint-disable-line no-unused-vars
                    return buildUrl(route, pid);
                },
                url: function (route, key, pid) { // eslint-disable-line no-unused-vars
                    return buildUrl(route, pid);
                }
            }
        });

        var exports = generator.processProducts('SKU-1');
        assert.lengthOf(exports, 1);
        assert.strictEqual(exports[0].objecttype, 'Product');
        assert.strictEqual(exports[0].ec_product_id, 'SKU-1');
        assert.strictEqual(exports[0].permanentid, 'SKU-1');
        assert.strictEqual(exports[0].language, 'en');
        assert.strictEqual(exports[0].ec_name, 'Name SKU-1');
        assert.strictEqual(exports[0].ec_price, 99);
        assert.strictEqual(exports[0].ec_item_group_id, 'SKU-1');
        assert.strictEqual(exports[0].ec_description, '<html><body>Long Description</body></html>');
        assert.strictEqual(exports[0].ec_shortdesc, 'Short Description');
        assert.notProperty(exports[0], 'ec_promo_price');
        assert.deepEqual(exports[0].ec_images, [
            'https://example.com/images/SKU-1/large-1.jpg',
            'https://example.com/images/SKU-1/large-2.jpg'
        ]);
        assert.deepEqual(exports[0].ec_thumbnails, [
            'https://example.com/images/SKU-1/large-1.jpg',
            'https://example.com/images/SKU-1/large-2.jpg'
        ]);
        assert.notProperty(exports[0], 'ec_sfraquickview');
        assert.notProperty(exports[0], 'ec_sgquickview');
        assert.notProperty(exports[0], 'ec_variant_id');
    });

    it('uses configured placeholder URLs when the catalog has no product media', function () {
        var placeholderProduct = createProduct({
            ID: 'SKU-NO-IMAGE'
        });

        var generator = proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/generators/productRequestGenerator'), {
            'dw/catalog/CatalogMgr': {
                getCategory: function () {
                    return null;
                }
            },
            'dw/catalog/ProductMgr': {
                getProduct: function () {
                    return placeholderProduct;
                }
            },
            '*/cartridge/scripts/utils/coveoConstant': {
                COVEO_CONSTANTS: {
                    EXTENSION: '.html',
                    MODEL: 'Authentic',
                    OBJECT_TYPE_PRODUCT: 'Product',
                    OBJECT_TYPE_VARIANT: 'Variant'
                }
            },
            '*/cartridge/scripts/helper/exportTargetHelper': createExportTargetHelperStub(),
            '*/cartridge/scripts/helper/fieldMappingHelper': {
                applyFieldMappings: function (payload, product) {
                    payload.ec_name = product.name;
                    return payload;
                }
            },
            '*/cartridge/scripts/helper/purchaseMetricHelper': {
                applyPurchaseMetrics: function () {}
            },
            'dw/system/Logger': {
                getLogger: function () {
                    return {
                        error: function () {}
                    };
                }
            },
            'dw/system/Site': {
                current: createSiteCurrent({
                    coveoProductImagePlaceholderUrl: 'https://example.com/images/placeholder-product.jpg',
                    coveoProductThumbnailPlaceholderUrl: 'https://example.com/images/placeholder-thumb.jpg'
                })
            },
            'dw/web/URLUtils': {
                abs: function (route, key, pid) { // eslint-disable-line no-unused-vars
                    return buildUrl(route, pid);
                },
                url: function (route, key, pid) { // eslint-disable-line no-unused-vars
                    return buildUrl(route, pid);
                }
            }
        });

        var exports = generator.processProducts('SKU-NO-IMAGE');

        assert.lengthOf(exports, 1);
        assert.deepEqual(exports[0].ec_images, [
            'https://example.com/images/placeholder-product.jpg'
        ]);
        assert.deepEqual(exports[0].ec_thumbnails, [
            'https://example.com/images/placeholder-thumb.jpg'
        ]);
    });

    it('uses configured image view type order when the catalog does not use large and medium', function () {
        var originalOnlyProduct = createProduct({
            ID: 'SKU-ORIGINAL',
            images: {
                original: [
                    'https://example.com/images/SKU-ORIGINAL/original-1.jpg',
                    'https://example.com/images/SKU-ORIGINAL/original-2.jpg'
                ]
            }
        });

        var generator = proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/generators/productRequestGenerator'), {
            'dw/catalog/CatalogMgr': {
                getCategory: function () {
                    return null;
                }
            },
            'dw/catalog/ProductMgr': {
                getProduct: function () {
                    return originalOnlyProduct;
                }
            },
            '*/cartridge/scripts/utils/coveoConstant': {
                COVEO_CONSTANTS: {
                    EXTENSION: '.html',
                    MODEL: 'Authentic',
                    OBJECT_TYPE_PRODUCT: 'Product',
                    OBJECT_TYPE_VARIANT: 'Variant'
                }
            },
            '*/cartridge/scripts/helper/exportTargetHelper': createExportTargetHelperStub(),
            '*/cartridge/scripts/helper/fieldMappingHelper': {
                applyFieldMappings: function (payload, product) {
                    payload.ec_name = product.name;
                    return payload;
                }
            },
            '*/cartridge/scripts/helper/purchaseMetricHelper': {
                applyPurchaseMetrics: function () {}
            },
            'dw/system/Logger': {
                getLogger: function () {
                    return {
                        error: function () {}
                    };
                }
            },
            'dw/system/Site': {
                current: createSiteCurrent({
                    coveoProductImageViewTypes: 'large, medium, original',
                    coveoProductThumbnailViewTypes: 'medium; large; original'
                })
            },
            'dw/web/URLUtils': {
                abs: function (route, key, pid) { // eslint-disable-line no-unused-vars
                    return buildUrl(route, pid);
                },
                url: function (route, key, pid) { // eslint-disable-line no-unused-vars
                    return buildUrl(route, pid);
                }
            }
        });

        var exports = generator.processProducts('SKU-ORIGINAL');

        assert.lengthOf(exports, 1);
        assert.deepEqual(exports[0].ec_images, [
            'https://example.com/images/SKU-ORIGINAL/original-1.jpg',
            'https://example.com/images/SKU-ORIGINAL/original-2.jpg'
        ]);
        assert.deepEqual(exports[0].ec_thumbnails, [
            'https://example.com/images/SKU-ORIGINAL/original-1.jpg',
            'https://example.com/images/SKU-ORIGINAL/original-2.jpg'
        ]);
    });

    it('exports grouped products and variants with modern commerce identifiers', function () {
        var masterProduct = createProduct({
            ID: 'MASTER-1',
            master: true
        });
        var redVariantSmall = createProduct({
            ID: 'MASTER-1-RED-S',
            variant: true,
            masterProduct: masterProduct,
            custom: {
                color: 'red',
                size: 'small'
            },
            images: {
                large: [
                    'https://example.com/images/MASTER-1-RED-S/large-1.jpg',
                    'https://example.com/images/MASTER-1-RED-S/large-2.jpg'
                ],
                medium: [
                    'https://example.com/images/MASTER-1-RED-S/medium-1.jpg'
                ]
            }
        });
        var redVariantMedium = createProduct({
            ID: 'MASTER-1-RED-M',
            variant: true,
            masterProduct: masterProduct,
            custom: {
                color: 'red',
                size: 'medium'
            }
        });
        var blueVariantSmall = createProduct({
            ID: 'MASTER-1-BLUE-S',
            variant: true,
            masterProduct: masterProduct,
            custom: {
                color: 'blue',
                size: 'small'
            }
        });

        masterProduct.variants = createArrayWrapper([
            redVariantSmall,
            redVariantMedium,
            blueVariantSmall
        ]);

        var generator = proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/generators/productRequestGenerator'), {
            'dw/util/ArrayList': function ArrayList(values) {
                return {
                    toArray: function () {
                        return values;
                    }
                };
            },
            'dw/catalog/CatalogMgr': {
                getCategory: function () {
                    return null;
                }
            },
            'dw/catalog/ProductMgr': {
                getProduct: function () {
                    return masterProduct;
                }
            },
            '*/cartridge/scripts/utils/coveoConstant': {
                COVEO_CONSTANTS: {
                    EXTENSION: '.html',
                    MODEL: 'Authentic',
                    OBJECT_TYPE_PRODUCT: 'Product',
                    OBJECT_TYPE_VARIANT: 'Variant'
                }
            },
            '*/cartridge/scripts/helper/exportTargetHelper': createExportTargetHelperStub(),
            '*/cartridge/scripts/helper/fieldMappingHelper': {
                applyFieldMappings: function (payload, product) {
                    payload.ec_name = product.name;
                    return payload;
                }
            },
            '*/cartridge/scripts/helper/purchaseMetricHelper': {
                applyPurchaseMetrics: function () {}
            },
            'dw/system/Logger': {
                getLogger: function () {
                    return {
                        error: function () {}
                    };
                }
            },
            'dw/system/Site': {
                current: {
                    defaultLocale: 'en_CA'
                }
            },
            'dw/object/ObjectAttributeDefinition': {},
            'dw/web/URLUtils': {
                abs: function (route, key, pid) { // eslint-disable-line no-unused-vars
                    return buildUrl(route, pid);
                },
                url: function (route, key, pid) { // eslint-disable-line no-unused-vars
                    return buildUrl(route, pid);
                }
            }
        });

        var exports = generator.processProducts('MASTER-1', false, {
            catalogStructureMode: 'product_variant'
        });
        var products = exports.filter(function (item) {
            return item.objecttype === 'Product';
        });
        var variants = exports.filter(function (item) {
            return item.objecttype === 'Variant';
        });

        assert.lengthOf(products, 2);
        assert.lengthOf(variants, 3);
        assert.sameMembers(products.map(function (item) {
            return item.ec_product_id;
        }), ['MASTER-1-red', 'MASTER-1-blue']);
        assert.isDefined(products.find(function (item) {
            return item.objecttype === 'Product'
                && item.ec_product_id === 'MASTER-1-red'
                && item.permanentid === 'MASTER-1-red'
                && item.language === 'en'
                && item.ec_name === 'Name MASTER-1-RED-S'
                && item.ec_description === '<html><body>Long Description</body></html>'
                && item.ec_shortdesc === 'Short Description'
                && item.ec_price === 99
                && item.ec_thumbnails[0] === 'https://example.com/images/MASTER-1-RED-S/medium-1.jpg'
                && !('ec_sfraquickview' in item)
                && !('ec_sgquickview' in item)
                && item.ec_item_group_id === 'MASTER-1';
        }));
        assert.isDefined(variants.find(function (item) {
            return item.objecttype === 'Variant'
                && item.ec_product_id === 'MASTER-1-red'
                && item.ec_variant_id === 'MASTER-1-RED-S'
                && item.permanentid === 'MASTER-1-RED-S'
                && item.language === 'en'
                && item.ec_name === 'Name MASTER-1-RED-S'
                && item.ec_sku === 'MASTER-1-RED-S';
        }));
        assert.isDefined(variants.find(function (item) {
            return item.objecttype === 'Variant'
                && item.ec_product_id === 'MASTER-1-blue'
                && item.ec_variant_id === 'MASTER-1-BLUE-S'
                && item.permanentid === 'MASTER-1-BLUE-S'
                && item.language === 'en'
                && item.ec_name === 'Name MASTER-1-BLUE-S'
                && item.ec_sku === 'MASTER-1-BLUE-S';
        }));
    });

    it('exports a direct variant as one consolidated Product row in product_only mode', function () {
        var masterProduct = createProduct({
            ID: 'MASTER-1',
            master: true
        });
        var variantProduct = createProduct({
            ID: 'MASTER-1-RED-S',
            variant: true,
            masterProduct: masterProduct,
            custom: {
                color: 'red',
                size: 'small'
            }
        });

        var generator = proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/generators/productRequestGenerator'), {
            'dw/catalog/CatalogMgr': {
                getCategory: function () {
                    return null;
                }
            },
            'dw/catalog/ProductMgr': {
                getProduct: function () {
                    return variantProduct;
                }
            },
            '*/cartridge/scripts/utils/coveoConstant': {
                COVEO_CONSTANTS: {
                    EXTENSION: '.html',
                    MODEL: 'Authentic',
                    OBJECT_TYPE_PRODUCT: 'Product',
                    OBJECT_TYPE_VARIANT: 'Variant'
                }
            },
            '*/cartridge/scripts/helper/exportTargetHelper': createExportTargetHelperStub(),
            '*/cartridge/scripts/helper/fieldMappingHelper': {
                applyFieldMappings: function (payload, product) {
                    payload.ec_name = product.name;
                    return payload;
                }
            },
            '*/cartridge/scripts/helper/purchaseMetricHelper': {
                applyPurchaseMetrics: function () {}
            },
            'dw/system/Logger': {
                getLogger: function () {
                    return {
                        error: function () {}
                    };
                }
            },
            'dw/system/Site': {
                current: {
                    defaultLocale: 'en_CA'
                }
            },
            'dw/object/ObjectAttributeDefinition': {},
            'dw/web/URLUtils': {
                abs: function (route, key, pid) { // eslint-disable-line no-unused-vars
                    return buildUrl(route, pid);
                },
                url: function (route, key, pid) { // eslint-disable-line no-unused-vars
                    return buildUrl(route, pid);
                }
            }
        });

        var exports = generator.processProducts('MASTER-1-RED-S', false, {
            catalogStructureMode: 'product_only'
        });

        assert.lengthOf(exports, 1);
        assert.strictEqual(exports[0].objecttype, 'Product');
        assert.strictEqual(exports[0].ec_product_id, 'MASTER-1-RED-S');
        assert.strictEqual(exports[0].permanentid, 'MASTER-1-RED-S');
        assert.strictEqual(exports[0].ec_sku, 'MASTER-1-RED-S');
        assert.strictEqual(exports[0].ec_item_group_id, 'MASTER-1');
        assert.strictEqual(exports[0].documentId, 'https://example.com/Product-Show?pid=MASTER-1-RED-S');
        assert.strictEqual(exports[0].ec_color, 'RED');
        assert.strictEqual(exports[0].ec_size, 'SMALL');
        assert.notProperty(exports[0], 'ec_variant_id');
    });

    it('exports one Product row per variant SKU for masters in product_only mode', function () {
        var masterProduct = createProduct({
            ID: 'MASTER-1',
            master: true
        });
        var redVariantSmall = createProduct({
            ID: 'MASTER-1-RED-S',
            variant: true,
            masterProduct: masterProduct,
            custom: {
                color: 'red',
                size: 'small'
            }
        });
        var redVariantMedium = createProduct({
            ID: 'MASTER-1-RED-M',
            variant: true,
            masterProduct: masterProduct,
            custom: {
                color: 'red',
                size: 'medium'
            }
        });
        var blueVariantSmall = createProduct({
            ID: 'MASTER-1-BLUE-S',
            variant: true,
            masterProduct: masterProduct,
            custom: {
                color: 'blue',
                size: 'small'
            }
        });

        masterProduct.variants = createArrayWrapper([
            redVariantSmall,
            redVariantMedium,
            blueVariantSmall
        ]);

        var generator = proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/generators/productRequestGenerator'), {
            'dw/catalog/CatalogMgr': {
                getCategory: function () {
                    return null;
                }
            },
            'dw/catalog/ProductMgr': {
                getProduct: function () {
                    return masterProduct;
                }
            },
            '*/cartridge/scripts/utils/coveoConstant': {
                COVEO_CONSTANTS: {
                    EXTENSION: '.html',
                    MODEL: 'Authentic',
                    OBJECT_TYPE_PRODUCT: 'Product',
                    OBJECT_TYPE_VARIANT: 'Variant'
                }
            },
            '*/cartridge/scripts/helper/exportTargetHelper': createExportTargetHelperStub(),
            '*/cartridge/scripts/helper/fieldMappingHelper': {
                applyFieldMappings: function (payload, product) {
                    payload.ec_name = product.name;
                    return payload;
                }
            },
            '*/cartridge/scripts/helper/purchaseMetricHelper': {
                applyPurchaseMetrics: function () {}
            },
            'dw/system/Logger': {
                getLogger: function () {
                    return {
                        error: function () {}
                    };
                }
            },
            'dw/system/Site': {
                current: {
                    defaultLocale: 'en_CA'
                }
            },
            'dw/object/ObjectAttributeDefinition': {},
            'dw/web/URLUtils': {
                abs: function (route, key, pid) { // eslint-disable-line no-unused-vars
                    return buildUrl(route, pid);
                },
                url: function (route, key, pid) { // eslint-disable-line no-unused-vars
                    return buildUrl(route, pid);
                }
            }
        });

        var exports = generator.processProducts('MASTER-1', false, {
            catalogStructureMode: 'product_only'
        });

        assert.lengthOf(exports, 3);
        assert.sameMembers(exports.map(function (item) {
            return item.objecttype;
        }), ['Product', 'Product', 'Product']);
        assert.sameMembers(exports.map(function (item) {
            return item.ec_product_id;
        }), ['MASTER-1-RED-S', 'MASTER-1-RED-M', 'MASTER-1-BLUE-S']);
        exports.forEach(function (item) {
            assert.strictEqual(item.permanentid, item.ec_product_id);
            assert.strictEqual(item.ec_sku, item.ec_product_id);
            assert.strictEqual(item.ec_item_group_id, 'MASTER-1');
            assert.notProperty(item, 'ec_variant_id');
        });
    });

    it('applies units-sold metrics to grouped products and exact matching variants', function () {
        var capturedMetricCalls = [];
        var masterProduct = createProduct({
            ID: 'MASTER-2',
            master: true
        });
        var redVariantSmall = createProduct({
            ID: '1000879',
            variant: true,
            masterProduct: masterProduct,
            custom: {
                color: 'red',
                size: 'small'
            }
        });
        var redVariantMedium = createProduct({
            ID: '1000880',
            variant: true,
            masterProduct: masterProduct,
            custom: {
                color: 'red',
                size: 'medium'
            }
        });

        masterProduct.variants = createArrayWrapper([
            redVariantSmall,
            redVariantMedium
        ]);

        var generator = proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/generators/productRequestGenerator'), {
            'dw/catalog/CatalogMgr': {
                getCategory: function () {
                    return null;
                }
            },
            'dw/catalog/ProductMgr': {
                getProduct: function () {
                    return masterProduct;
                }
            },
            '*/cartridge/scripts/utils/coveoConstant': {
                COVEO_CONSTANTS: {
                    EXTENSION: '.html',
                    MODEL: 'Authentic',
                    OBJECT_TYPE_PRODUCT: 'Product',
                    OBJECT_TYPE_VARIANT: 'Variant'
                }
            },
            '*/cartridge/scripts/helper/exportTargetHelper': createExportTargetHelperStub(),
            '*/cartridge/scripts/helper/fieldMappingHelper': {
                applyFieldMappings: function (payload, product) {
                    payload.ec_name = product.name;
                    return payload;
                }
            },
            '*/cartridge/scripts/helper/purchaseMetricHelper': {
                applyPurchaseMetrics: function (payload, metricContext) {
                    capturedMetricCalls.push({
                        documentId: payload.documentId,
                        objecttype: payload.objecttype,
                        aliases: metricContext.aliases
                    });

                    if (payload.objecttype === 'Product') {
                        payload.ec_units_sold_90d = 5;
                    }

                    if (payload.objecttype === 'Variant' && payload.ec_variant_id === '1000879') {
                        payload.ec_units_sold_90d = 2;
                    }
                }
            },
            'dw/system/Logger': {
                getLogger: function () {
                    return {
                        error: function () {}
                    };
                }
            },
            'dw/system/Site': {
                current: {
                    defaultLocale: 'en_CA'
                }
            },
            'dw/web/URLUtils': {
                abs: function (route, key, pid) { // eslint-disable-line no-unused-vars
                    return buildUrl(route, pid);
                },
                url: function (route, key, pid) { // eslint-disable-line no-unused-vars
                    return buildUrl(route, pid);
                }
            }
        });

        var exports = generator.processProducts('MASTER-2', false, {
            catalogStructureMode: 'product_variant'
        });
        var productExport = exports.find(function (item) {
            return item.objecttype === 'Product';
        });
        var matchingVariant = exports.find(function (item) {
            return item.objecttype === 'Variant' && item.ec_variant_id === '1000879';
        });
        var otherVariant = exports.find(function (item) {
            return item.objecttype === 'Variant' && item.ec_variant_id === '1000880';
        });

        assert.strictEqual(productExport.ec_units_sold_90d, 5);
        assert.strictEqual(matchingVariant.ec_units_sold_90d, 2);
        assert.notProperty(otherVariant, 'ec_units_sold_90d');
        assert.deepEqual(capturedMetricCalls[0].aliases, ['MASTER-2-red', '1000879', '1000880']);
        assert.deepEqual(capturedMetricCalls[1].aliases, ['1000879']);
    });

    it('exports all valid category hierarchies while preserving the primary hierarchy separately', function () {
        var menCategory = createCategory('men', 'Men');
        var shoesCategory = createCategory('men-shoes', 'Shoes', {
            parent: menCategory
        });
        var saleCategory = createCategory('sale', 'Sale');
        var clearanceCategory = createCategory('sale-clearance', 'Clearance', {
            parent: saleCategory
        });
        var offlineCategory = createCategory('offline', 'Offline', {
            online: false
        });
        var standaloneProduct = createProduct({
            ID: 'SKU-CAT',
            primaryCategory: shoesCategory,
            categories: [
                clearanceCategory,
                shoesCategory,
                clearanceCategory,
                offlineCategory
            ]
        });

        var generator = proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/generators/productRequestGenerator'), {
            'dw/util/ArrayList': function ArrayList(values) {
                return {
                    toArray: function () {
                        return values;
                    }
                };
            },
            'dw/catalog/CatalogMgr': {
                getCategory: function () {
                    return null;
                }
            },
            'dw/catalog/ProductMgr': {
                getProduct: function () {
                    return standaloneProduct;
                }
            },
            '*/cartridge/scripts/utils/coveoConstant': {
                COVEO_CONSTANTS: {
                    EXTENSION: '.html',
                    MODEL: 'Authentic',
                    OBJECT_TYPE_PRODUCT: 'Product',
                    OBJECT_TYPE_VARIANT: 'Variant'
                }
            },
            '*/cartridge/scripts/helper/exportTargetHelper': createExportTargetHelperStub(),
            '*/cartridge/scripts/helper/fieldMappingHelper': {
                applyFieldMappings: function (payload, product) {
                    payload.ec_name = product.name;
                    return payload;
                }
            },
            '*/cartridge/scripts/helper/purchaseMetricHelper': {
                applyPurchaseMetrics: function () {}
            },
            'dw/system/Logger': {
                getLogger: function () {
                    return {
                        error: function () {}
                    };
                }
            },
            'dw/system/Site': {
                current: {
                    defaultLocale: 'en_CA'
                }
            },
            'dw/object/ObjectAttributeDefinition': {},
            'dw/web/URLUtils': {
                abs: function (route, key, pid) { // eslint-disable-line no-unused-vars
                    return buildUrl(route, pid);
                },
                url: function (route, key, pid) { // eslint-disable-line no-unused-vars
                    return buildUrl(route, pid);
                }
            }
        });

        var exports = generator.processProducts('SKU-CAT');

        assert.lengthOf(exports, 1);
        assert.strictEqual(exports[0].ec_category, 'Men;Men|Shoes;Sale;Sale|Clearance');
        assert.strictEqual(exports[0].ec_primary_category, 'Men;Men|Shoes');
    });

    it('uses the union of variant and master category assignments for grouped product exports', function () {
        var apparelCategory = createCategory('apparel', 'Apparel');
        var menCategory = createCategory('apparel-men', 'Men', {
            parent: apparelCategory
        });
        var jacketsCategory = createCategory('apparel-men-jackets', 'Jackets', {
            parent: menCategory
        });
        var newArrivalsCategory = createCategory('new-arrivals', 'New Arrivals');
        var rainwearCategory = createCategory('new-arrivals-rainwear', 'Rainwear', {
            parent: newArrivalsCategory
        });
        var masterProduct = createProduct({
            ID: 'MASTER-CAT',
            master: true,
            primaryCategory: jacketsCategory,
            categories: [jacketsCategory]
        });
        var variantProduct = createProduct({
            ID: 'MASTER-CAT-BLUE-S',
            variant: true,
            masterProduct: masterProduct,
            primaryCategory: rainwearCategory,
            categories: [rainwearCategory],
            custom: {
                color: 'blue',
                size: 'small'
            }
        });

        masterProduct.variants = createArrayWrapper([variantProduct]);

        var generator = proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/generators/productRequestGenerator'), {
            'dw/util/ArrayList': function ArrayList(values) {
                return {
                    toArray: function () {
                        return values;
                    }
                };
            },
            'dw/catalog/CatalogMgr': {
                getCategory: function () {
                    return null;
                }
            },
            'dw/catalog/ProductMgr': {
                getProduct: function () {
                    return masterProduct;
                }
            },
            '*/cartridge/scripts/utils/coveoConstant': {
                COVEO_CONSTANTS: {
                    EXTENSION: '.html',
                    MODEL: 'Authentic',
                    OBJECT_TYPE_PRODUCT: 'Product',
                    OBJECT_TYPE_VARIANT: 'Variant'
                }
            },
            '*/cartridge/scripts/helper/exportTargetHelper': createExportTargetHelperStub(),
            '*/cartridge/scripts/helper/fieldMappingHelper': {
                applyFieldMappings: function (payload, product) {
                    payload.ec_name = product.name;
                    return payload;
                }
            },
            '*/cartridge/scripts/helper/purchaseMetricHelper': {
                applyPurchaseMetrics: function () {}
            },
            'dw/system/Logger': {
                getLogger: function () {
                    return {
                        error: function () {}
                    };
                }
            },
            'dw/system/Site': {
                current: {
                    defaultLocale: 'en_CA'
                }
            },
            'dw/object/ObjectAttributeDefinition': {},
            'dw/web/URLUtils': {
                abs: function (route, key, pid) { // eslint-disable-line no-unused-vars
                    return buildUrl(route, pid);
                },
                url: function (route, key, pid) { // eslint-disable-line no-unused-vars
                    return buildUrl(route, pid);
                }
            }
        });

        var exports = generator.processProducts('MASTER-CAT', false, {
            catalogStructureMode: 'product_variant'
        });
        var productExport = exports.filter(function (item) {
            return item.objecttype === 'Product';
        })[0];

        assert.strictEqual(productExport.ec_category, 'Apparel;Apparel|Men;Apparel|Men|Jackets;New Arrivals;New Arrivals|Rainwear');
        assert.strictEqual(productExport.ec_primary_category, 'Apparel;Apparel|Men;Apparel|Men|Jackets');
    });

    it('uses the explicit target language when a multi-target export context is provided', function () {
        var standaloneProduct = createProduct({
            ID: 'SKU-1'
        });

        var generator = proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/generators/productRequestGenerator'), {
            'dw/util/ArrayList': function ArrayList(values) {
                return {
                    toArray: function () {
                        return values;
                    }
                };
            },
            'dw/catalog/CatalogMgr': {
                getCategory: function () {
                    return null;
                }
            },
            'dw/catalog/ProductMgr': {
                getProduct: function () {
                    return standaloneProduct;
                }
            },
            '*/cartridge/scripts/utils/coveoConstant': {
                COVEO_CONSTANTS: {
                    EXTENSION: '.html',
                    MODEL: 'Authentic',
                    OBJECT_TYPE_PRODUCT: 'Product',
                    OBJECT_TYPE_VARIANT: 'Variant'
                }
            },
            '*/cartridge/scripts/helper/exportTargetHelper': createExportTargetHelperStub(),
            '*/cartridge/scripts/helper/fieldMappingHelper': {
                applyFieldMappings: function (payload, product) {
                    payload.ec_name = product.name;
                    return payload;
                }
            },
            '*/cartridge/scripts/helper/purchaseMetricHelper': {
                applyPurchaseMetrics: function () {}
            },
            'dw/system/Logger': {
                getLogger: function () {
                    return {
                        error: function () {}
                    };
                }
            },
            'dw/system/Site': {
                current: {
                    defaultLocale: 'en_CA'
                }
            },
            'dw/object/ObjectAttributeDefinition': {},
            'dw/web/URLUtils': {
                abs: function (route, key, pid) { // eslint-disable-line no-unused-vars
                    return buildUrl(route, pid);
                },
                url: function (route, key, pid) { // eslint-disable-line no-unused-vars
                    return buildUrl(route, pid);
                }
            }
        });

        var exports = generator.processProducts('SKU-1', false, {
            locale: 'fr_CA',
            language: 'fr'
        });

        assert.lengthOf(exports, 1);
        assert.strictEqual(exports[0].language, 'fr');
        assert.strictEqual(exports[0].ec_name, 'Name SKU-1');
    });

    it('preserves full HTML documents in longDescription without double wrapping', function () {
        var standaloneProduct = createProduct({
            ID: 'SKU-HTML',
            longDescription: '<html><body><p>HTML Description</p></body></html>'
        });

        var generator = proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/generators/productRequestGenerator'), {
            'dw/catalog/CatalogMgr': {
                getCategory: function () {
                    return null;
                }
            },
            'dw/catalog/ProductMgr': {
                getProduct: function () {
                    return standaloneProduct;
                }
            },
            '*/cartridge/scripts/utils/coveoConstant': {
                COVEO_CONSTANTS: {
                    EXTENSION: '.html',
                    MODEL: 'Authentic',
                    OBJECT_TYPE_PRODUCT: 'Product',
                    OBJECT_TYPE_VARIANT: 'Variant'
                }
            },
            '*/cartridge/scripts/helper/exportTargetHelper': createExportTargetHelperStub(),
            '*/cartridge/scripts/helper/fieldMappingHelper': {
                applyFieldMappings: function (payload, product) {
                    payload.ec_name = product.name;
                    return payload;
                }
            },
            '*/cartridge/scripts/helper/purchaseMetricHelper': {
                applyPurchaseMetrics: function () {}
            },
            'dw/system/Logger': {
                getLogger: function () {
                    return {
                        error: function () {}
                    };
                }
            },
            'dw/system/Site': {
                current: {
                    defaultLocale: 'en_CA'
                }
            },
            'dw/object/ObjectAttributeDefinition': {},
            'dw/web/URLUtils': {
                abs: function (route, key, pid) { // eslint-disable-line no-unused-vars
                    return buildUrl(route, pid);
                },
                url: function (route, key, pid) { // eslint-disable-line no-unused-vars
                    return buildUrl(route, pid);
                }
            }
        });

        var exports = generator.processProducts('SKU-HTML');

        assert.lengthOf(exports, 1);
        assert.strictEqual(exports[0].ec_description, '<html><body><p>HTML Description</p></body></html>');
    });

    it('uses shortDescription as the HTML body when longDescription is empty', function () {
        var standaloneProduct = createProduct({
            ID: 'SKU-SHORT-BODY',
            longDescription: '',
            shortDescription: 'Short Description Body'
        });

        var generator = proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/generators/productRequestGenerator'), {
            'dw/catalog/CatalogMgr': {
                getCategory: function () {
                    return null;
                }
            },
            'dw/catalog/ProductMgr': {
                getProduct: function () {
                    return standaloneProduct;
                }
            },
            '*/cartridge/scripts/utils/coveoConstant': {
                COVEO_CONSTANTS: {
                    EXTENSION: '.html',
                    MODEL: 'Authentic',
                    OBJECT_TYPE_PRODUCT: 'Product',
                    OBJECT_TYPE_VARIANT: 'Variant'
                }
            },
            '*/cartridge/scripts/helper/exportTargetHelper': createExportTargetHelperStub(),
            '*/cartridge/scripts/helper/fieldMappingHelper': {
                applyFieldMappings: function (payload, product) {
                    payload.ec_name = product.name;
                    return payload;
                }
            },
            '*/cartridge/scripts/helper/purchaseMetricHelper': {
                applyPurchaseMetrics: function () {}
            },
            'dw/system/Logger': {
                getLogger: function () {
                    return {
                        error: function () {}
                    };
                }
            },
            'dw/system/Site': {
                current: {
                    defaultLocale: 'en_CA'
                }
            },
            'dw/object/ObjectAttributeDefinition': {},
            'dw/web/URLUtils': {
                abs: function (route, key, pid) { // eslint-disable-line no-unused-vars
                    return buildUrl(route, pid);
                },
                url: function (route, key, pid) { // eslint-disable-line no-unused-vars
                    return buildUrl(route, pid);
                }
            }
        });

        var exports = generator.processProducts('SKU-SHORT-BODY');

        assert.lengthOf(exports, 1);
        assert.strictEqual(exports[0].ec_description, '<html><body>Short Description Body</body></html>');
        assert.strictEqual(exports[0].ec_shortdesc, 'Short Description Body');
    });

    it('exports base and promotional prices separately when a discounted sales price is active', function () {
        var discountedProduct = createProduct({
            ID: 'SKU-PROMO',
            listPrice: 120,
            salesPrice: 89
        });

        var generator = proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/generators/productRequestGenerator'), {
            'dw/catalog/CatalogMgr': {
                getCategory: function () {
                    return null;
                }
            },
            'dw/catalog/ProductMgr': {
                getProduct: function () {
                    return discountedProduct;
                }
            },
            '*/cartridge/scripts/utils/coveoConstant': {
                COVEO_CONSTANTS: {
                    EXTENSION: '.html',
                    MODEL: 'Authentic',
                    OBJECT_TYPE_PRODUCT: 'Product',
                    OBJECT_TYPE_VARIANT: 'Variant'
                }
            },
            '*/cartridge/scripts/helper/exportTargetHelper': createExportTargetHelperStub(),
            '*/cartridge/scripts/helper/fieldMappingHelper': {
                applyFieldMappings: function (payload, product) {
                    payload.ec_name = product.name;
                    return payload;
                }
            },
            '*/cartridge/scripts/helper/purchaseMetricHelper': {
                applyPurchaseMetrics: function () {}
            },
            'dw/system/Logger': {
                getLogger: function () {
                    return {
                        error: function () {}
                    };
                }
            },
            'dw/system/Site': {
                current: {
                    defaultLocale: 'en_CA'
                }
            },
            'dw/web/URLUtils': {
                abs: function (route, key, pid) { // eslint-disable-line no-unused-vars
                    return buildUrl(route, pid);
                },
                url: function (route, key, pid) { // eslint-disable-line no-unused-vars
                    return buildUrl(route, pid);
                }
            }
        });

        var exports = generator.processProducts('SKU-PROMO');

        assert.lengthOf(exports, 1);
        assert.strictEqual(exports[0].ec_price, 120);
        assert.strictEqual(exports[0].ec_promo_price, 89);
    });
});
