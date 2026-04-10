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

function createCategory(id, displayName) {
    return {
        ID: id,
        displayName: displayName,
        parent: {
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

function createProduct(options) {
    var imageSets = options.images || {};

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
        master: !!options.master,
        variant: !!options.variant,
        masterProduct: options.masterProduct || null,
        primaryCategory: options.primaryCategory || createCategory('mens-shoes', 'Mens Shoes'),
        priceModel: {
            maxPrice: {
                value: options.price || 99
            }
        },
        brand: options.brand || 'Coveo',
        shortDescription: {
            source: options.description || 'Description'
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
                },
                COVEO_FIELD_MAPPER: {}
            },
            '*/cartridge/scripts/helper/exportTargetHelper': {
                getLanguageFromLocale: function (locale) {
                    return locale.split(/[-_]/)[0].toLowerCase();
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
        assert.deepEqual(exports[0].ec_images, [
            'https://example.com/images/SKU-1/large-1.jpg',
            'https://example.com/images/SKU-1/large-2.jpg'
        ]);
        assert.deepEqual(exports[0].ec_thumbnails, []);
        assert.notProperty(exports[0], 'ec_sfraquickview');
        assert.notProperty(exports[0], 'ec_sgquickview');
        assert.notProperty(exports[0], 'ec_variant_id');
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
                },
                COVEO_FIELD_MAPPER: {}
            },
            '*/cartridge/scripts/helper/exportTargetHelper': {
                getLanguageFromLocale: function (locale) {
                    return locale.split(/[-_]/)[0].toLowerCase();
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

        var exports = generator.processProducts('MASTER-1');
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
                && item.ec_sku === 'MASTER-1-RED-S';
        }));
        assert.isDefined(variants.find(function (item) {
            return item.objecttype === 'Variant'
                && item.ec_product_id === 'MASTER-1-blue'
                && item.ec_variant_id === 'MASTER-1-BLUE-S'
                && item.permanentid === 'MASTER-1-BLUE-S'
                && item.language === 'en'
                && item.ec_sku === 'MASTER-1-BLUE-S';
        }));
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
                },
                COVEO_FIELD_MAPPER: {}
            },
            '*/cartridge/scripts/helper/exportTargetHelper': {
                getLanguageFromLocale: function (locale) {
                    return locale.split(/[-_]/)[0].toLowerCase();
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
    });
});
