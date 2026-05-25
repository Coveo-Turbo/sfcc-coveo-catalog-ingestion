'use strict';

var path = require('path');
var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();

var currentLocale = 'en_CA';

function createHashSet() {
    function HashSet() {
        this.values = [];
    }

    HashSet.prototype.add = function (value) {
        if (!this.contains(value)) {
            this.values.push(value);
        }
    };

    HashSet.prototype.contains = function (value) {
        return this.values.indexOf(value) !== -1;
    };

    return HashSet;
}

function createHashMap() {
    function HashMap() {
        this.store = {};
    }

    HashMap.prototype.containsKey = function (key) {
        return Object.prototype.hasOwnProperty.call(this.store, key);
    };

    HashMap.prototype.get = function (key) {
        return this.store[key];
    };

    HashMap.prototype.put = function (key, value) {
        this.store[key] = value;
    };

    return HashMap;
}

function createIterator(values, onClose) {
    var index = 0;

    return {
        hasNext: function () {
            return index < values.length;
        },
        next: function () {
            var value = values[index];
            index += 1;
            return value;
        },
        close: function () {
            if (onClose) {
                onClose();
            }
        }
    };
}

function createCollection(values) {
    return {
        toArray: function () {
            return values;
        }
    };
}

function createCategory(id, displayName, children, online) {
    var localizedDisplayName = displayName;

    if (displayName && typeof displayName === 'object') {
        localizedDisplayName = displayName;
    }

    return {
        ID: id,
        get displayName() {
            if (localizedDisplayName && typeof localizedDisplayName === 'object') {
                return localizedDisplayName[currentLocale] || localizedDisplayName['x-default'] || localizedDisplayName.default || '';
            }

            return localizedDisplayName;
        },
        name: id,
        online: online !== false,
        onlineSubCategories: createCollection(children || [])
    };
}

function createHelper(catalog, products) {
    return proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/helper/listingPageHelper'), {
        'dw/catalog/CatalogMgr': {
            getCatalog: function (catalogId) {
                assert.strictEqual(catalogId, 'mondou-ca');
                return catalog;
            },
            getSiteCatalog: function () {
                return catalog;
            }
        },
        'dw/catalog/ProductMgr': {
            queryProductsInCatalog: function (requestedCatalog) {
                assert.strictEqual(requestedCatalog, catalog);
                return createIterator(products || []);
            }
        },
        'dw/system/Logger': {
            getLogger: function () {
                return {
                    warn: function () {},
                    error: function () {}
                };
            }
        },
        'dw/util/HashMap': createHashMap(),
        'dw/util/HashSet': createHashSet(),
        '*/cartridge/scripts/helper/exportTargetHelper': {
            applyRequestLocale: function (exportContext) {
                var previousLocale = currentLocale;
                currentLocale = exportContext.locale;
                return previousLocale;
            },
            restoreRequestLocale: function (previousLocale) {
                currentLocale = previousLocale || 'en_CA';
            }
        },
        '*/cartridge/scripts/helper/listingPageService': {
            LISTING_PAGE_BULK_LIMIT: 100
        }
    });
}

function createExportContext(overrides) {
    var context = {
        catalogId: 'mondou-ca',
        locale: 'en_CA',
        language: 'en',
        coveoCountry: 'CA',
        coveoCurrency: 'CAD',
        coveoTrackingId: 'mondou_ca',
        storefrontBaseUrl: 'https://www.mondou.com',
        listingCategoryUrlTemplate: '/{categorySlugPath}',
        listingBrandUrlTemplate: '/brands/{brandSlug}',
        listingSlugAmpersandToken: 'and'
    };

    Object.keys(overrides || {}).forEach(function (key) {
        context[key] = overrides[key];
    });

    return context;
}

describe('listingPageHelper', function () {
    it('generates category listing pages with pipe-delimited ec_category filters and localized slugs', function () {
        var food = createCategory('cat-food', 'Food & Treats', []);
        var cat = createCategory('cat', 'Cat', [food]);
        var catalog = {
            root: createCategory('root', 'Root', [cat])
        };
        var helper = createHelper(catalog, []);

        var listingPages = helper.buildDesiredListingPages(createExportContext());

        assert.lengthOf(listingPages, 2);
        assert.strictEqual(listingPages[0].name, 'Cat');
        assert.sameMembers(listingPages[0].patterns.map(function (pattern) {
            return pattern.url;
        }), [
            'https://www.mondou.com/cat',
            '/cat'
        ]);
        assert.deepEqual(listingPages[0].pageRules[0].filters[0], {
            fieldName: 'ec_category',
            operator: 'contains',
            value: {
                type: 'array',
                values: ['Cat']
            }
        });
        assert.deepEqual(listingPages[0].pageRules[0].locales, [{
            language: 'en',
            country: 'CA',
            currency: 'CAD'
        }]);

        assert.strictEqual(listingPages[1].name, 'Cat|Food & Treats');
        assert.sameMembers(listingPages[1].patterns.map(function (pattern) {
            return pattern.url;
        }), [
            'https://www.mondou.com/cat/food-and-treats',
            '/cat/food-and-treats'
        ]);
        assert.deepEqual(listingPages[1].pageRules[0].filters[0].value.values, ['Cat|Food & Treats']);
    });

    it('merges locale-specific category and brand pages into a single CMH page per logical listing', function () {
        var food = createCategory('cat-food', {
            'en_CA': 'Food & Treats',
            'fr_CA': 'Nourriture et friandises'
        }, []);
        var cat = createCategory('cat', {
            'en_CA': 'Cat',
            'fr_CA': 'Chat'
        }, [food]);
        var catalog = {
            root: createCategory('root', 'Root', [cat])
        };
        var helper = createHelper(catalog, [
            {
                ID: 'SKU-1',
                brand: 'vetdiet',
                online: true
            }
        ]);
        var listingPages = helper.buildDesiredListingPages([
            createExportContext({
                locale: 'en_CA',
                language: 'en',
                coveoTrackingId: 'mondou',
                coveoCountry: 'CA',
                coveoCurrency: 'CAD',
                listingCategoryUrlTemplate: '/en-CA/{categorySlugPath}',
                listingBrandUrlTemplate: '/en-CA/brands/{brandSlug}'
            }),
            createExportContext({
                locale: 'fr_CA',
                language: 'fr',
                coveoTrackingId: 'mondou',
                coveoCountry: 'CA',
                coveoCurrency: 'CAD',
                listingCategoryUrlTemplate: '/fr-CA/{categorySlugPath}',
                listingBrandUrlTemplate: '/fr-CA/marques/{brandSlug}',
                listingSlugAmpersandToken: 'et'
            })
        ]);

        assert.lengthOf(listingPages, 3);

        var catPage = listingPages.filter(function (listingPage) {
            return listingPage.name === 'Cat';
        })[0];
        var foodPage = listingPages.filter(function (listingPage) {
            return listingPage.name === 'Cat|Food & Treats';
        })[0];
        var brandPage = listingPages.filter(function (listingPage) {
            return listingPage.name === 'vetdiet';
        })[0];

        assert.isOk(catPage);
        assert.isOk(foodPage);
        assert.isOk(brandPage);

        assert.sameMembers(catPage.patterns.map(function (pattern) {
            return pattern.url;
        }), [
            'https://www.mondou.com/en-CA/cat',
            '/en-CA/cat',
            'https://www.mondou.com/fr-CA/chat',
            '/fr-CA/chat'
        ]);
        assert.lengthOf(catPage.pageRules, 2);
        assert.sameMembers(catPage.pageRules[0].locales.concat(catPage.pageRules[1].locales).map(function (locale) {
            return locale.language + '_' + locale.country;
        }), ['en_CA', 'fr_CA']);
        assert.sameMembers(catPage.pageRules.map(function (rule) {
            return rule.filters[0].value.values[0];
        }), ['Cat', 'Chat']);

        assert.sameMembers(foodPage.patterns.map(function (pattern) {
            return pattern.url;
        }), [
            'https://www.mondou.com/en-CA/cat/food-and-treats',
            '/en-CA/cat/food-and-treats',
            'https://www.mondou.com/fr-CA/chat/nourriture-et-friandises',
            '/fr-CA/chat/nourriture-et-friandises'
        ]);
        assert.lengthOf(foodPage.pageRules, 2);
        assert.sameMembers(foodPage.pageRules.map(function (rule) {
            return rule.filters[0].value.values[0];
        }), [
            'Cat|Food & Treats',
            'Chat|Nourriture et friandises'
        ]);

        assert.sameMembers(brandPage.patterns.map(function (pattern) {
            return pattern.url;
        }), [
            'https://www.mondou.com/en-CA/brands/vetdiet',
            '/en-CA/brands/vetdiet',
            'https://www.mondou.com/fr-CA/marques/vetdiet',
            '/fr-CA/marques/vetdiet'
        ]);
        assert.lengthOf(brandPage.pageRules, 1);
        assert.lengthOf(brandPage.pageRules[0].locales, 2);
        assert.sameMembers(brandPage.pageRules[0].locales.map(function (locale) {
            return locale.language + '_' + locale.country;
        }), ['en_CA', 'fr_CA']);
        assert.deepEqual(brandPage.pageRules[0].filters[0], {
            fieldName: 'ec_brand',
            operator: 'isExactly',
            value: {
                type: 'array',
                values: ['vetdiet']
            }
        });
    });

    it('generates brand listing pages from distinct online product brands', function () {
        var catalog = {
            root: createCategory('root', 'Root', [])
        };
        var helper = createHelper(catalog, [
            {
                ID: 'SKU-1',
                brand: 'vetdiet',
                online: true
            },
            {
                ID: 'SKU-2',
                brand: ' Vetdiet ',
                online: true
            },
            {
                ID: 'SKU-3',
                brand: "Ren's Pets",
                online: true
            },
            {
                ID: 'SKU-4',
                brand: 'Offline Brand',
                online: false
            },
            {
                ID: 'SKU-5',
                brand: '',
                online: true
            }
        ]);

        var listingPages = helper.buildDesiredListingPages(createExportContext());

        assert.lengthOf(listingPages, 2);
        assert.sameMembers(listingPages.map(function (listingPage) {
            return listingPage.name;
        }), ['vetdiet', "Ren's Pets"]);

        var rensPetsPage = listingPages.filter(function (listingPage) {
            return listingPage.name === "Ren's Pets";
        })[0];
        assert.sameMembers(rensPetsPage.patterns.map(function (pattern) {
            return pattern.url;
        }), [
            'https://www.mondou.com/brands/rens-pets',
            '/brands/rens-pets'
        ]);
        assert.deepEqual(rensPetsPage.pageRules[0].filters[0], {
            fieldName: 'ec_brand',
            operator: 'isExactly',
            value: {
                type: 'array',
                values: ["Ren's Pets"]
            }
        });
    });

    it('splits desired listing pages into creates and updates by URL first, then name', function () {
        var helper = createHelper({
            root: createCategory('root', 'Root', [])
        }, []);
        var categoryPage = helper.buildCategoryListingPage(['Cat'], createExportContext());
        var brandPage = helper.buildBrandListingPage('vetdiet', createExportContext());

        var syncPlan = helper.planListingPageChanges([categoryPage, brandPage], [
            {
                id: 'category-id',
                name: 'Old Cat Name',
                patterns: [{
                    url: 'https://www.mondou.com/cat'
                }]
            },
            {
                id: 'brand-id',
                name: 'vetdiet',
                patterns: [{
                    url: 'https://www.mondou.com/legacy-vetdiet'
                }]
            }
        ]);

        assert.lengthOf(syncPlan.creates, 0);
        assert.lengthOf(syncPlan.updates, 2);
        assert.strictEqual(syncPlan.updates[0].id, 'category-id');
        assert.strictEqual(syncPlan.updates[0].name, 'Cat');
        assert.strictEqual(syncPlan.updates[1].id, 'brand-id');
        assert.strictEqual(syncPlan.updates[1].patterns[0].url, 'https://www.mondou.com/brands/vetdiet');
        assert.notProperty(syncPlan.updates[0], 'generatedType');
    });

    it('skips duplicate generated listing pages but still fails on duplicate existing pages', function () {
        var helper = createHelper({
            root: createCategory('root', 'Root', [])
        }, []);
        var categoryPage = helper.buildCategoryListingPage(['Cat'], createExportContext());
        var duplicatedCategoryPage = helper.buildCategoryListingPage(['Dog'], createExportContext({
            listingCategoryUrlTemplate: '/cat'
        }));
        var syncPlan = helper.planListingPageChanges([categoryPage, duplicatedCategoryPage], []);

        assert.lengthOf(syncPlan.creates, 1);
        assert.strictEqual(syncPlan.creates[0].name, 'Cat');

        assert.throws(function () {
            helper.planListingPageChanges([categoryPage], [
                {
                    id: 'first',
                    name: 'First',
                    patterns: [{
                        url: 'https://www.mondou.com/cat'
                    }]
                },
                {
                    id: 'second',
                    name: 'Second',
                    patterns: [{
                        url: 'https://www.mondou.com/cat'
                    }]
                }
            ]);
        }, /Duplicate CMH listing page URL/);
    });

    it('chunks listing page requests using the CMH bulk limit', function () {
        var helper = createHelper({
            root: createCategory('root', 'Root', [])
        }, []);
        var values = [];
        var index = 0;

        for (index = 0; index < 205; index += 1) {
            values.push({
                name: 'Page ' + index
            });
        }

        var chunks = helper.chunk(values, 100);

        assert.lengthOf(chunks, 3);
        assert.lengthOf(chunks[0], 100);
        assert.lengthOf(chunks[1], 100);
        assert.lengthOf(chunks[2], 5);
    });

    it('reads CMH listing page responses that use nested pagination metadata', function () {
        var calls = [];
        var exportContext = createExportContext();
        var helper;
        var pages;

        helper = proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/helper/listingPageHelper'), {
            'dw/catalog/CatalogMgr': {
                getCatalog: function () {
                    return {
                        root: createCategory('root', 'Root', [])
                    };
                },
                getSiteCatalog: function () {
                    return {
                        root: createCategory('root', 'Root', [])
                    };
                }
            },
            'dw/catalog/ProductMgr': {
                queryProductsInCatalog: function () {
                    return createIterator([]);
                }
            },
            'dw/system/Logger': {
                getLogger: function () {
                    return {
                        warn: function () {},
                        error: function () {}
                    };
                }
            },
            'dw/util/HashMap': createHashMap(),
            'dw/util/HashSet': createHashSet(),
            '*/cartridge/scripts/helper/exportTargetHelper': {
                applyRequestLocale: function (context) {
                    var previousLocale = currentLocale;
                    currentLocale = context.locale;
                    return previousLocale;
                },
                restoreRequestLocale: function (previousLocale) {
                    currentLocale = previousLocale || 'en_CA';
                }
            },
            '*/cartridge/scripts/helper/listingPageService': {
                LISTING_PAGE_BULK_LIMIT: 100,
                getListingPagesPage: function (context, page) {
                    calls.push({
                        context: context,
                        page: page
                    });

                    if (page === 0) {
                        return {
                            ok: true,
                            object: {
                                pagination: {
                                    page: 0,
                                    totalPages: 2
                                },
                                items: [{
                                    id: 'page-1'
                                }]
                            }
                        };
                    }

                    return {
                        ok: true,
                        object: {
                            pagination: {
                                page: 1,
                                totalPages: 2
                            },
                            items: [{
                                id: 'page-2'
                            }]
                        }
                    };
                }
            }
        });

        pages = helper.readExistingListingPages(exportContext, function (response) {
            return response;
        });

        assert.lengthOf(pages, 2);
        assert.deepEqual(calls.map(function (call) {
            return call.page;
        }), [0, 1]);
    });

    it('reads CMH listing page responses that use results arrays', function () {
        var helper = proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/helper/listingPageHelper'), {
            'dw/catalog/CatalogMgr': {
                getCatalog: function () {
                    return {
                        root: createCategory('root', 'Root', [])
                    };
                },
                getSiteCatalog: function () {
                    return {
                        root: createCategory('root', 'Root', [])
                    };
                }
            },
            'dw/catalog/ProductMgr': {
                queryProductsInCatalog: function () {
                    return createIterator([]);
                }
            },
            'dw/system/Logger': {
                getLogger: function () {
                    return {
                        warn: function () {},
                        error: function () {}
                    };
                }
            },
            'dw/util/HashMap': createHashMap(),
            'dw/util/HashSet': createHashSet(),
            '*/cartridge/scripts/helper/exportTargetHelper': {
                applyRequestLocale: function (context) {
                    var previousLocale = currentLocale;
                    currentLocale = context.locale;
                    return previousLocale;
                },
                restoreRequestLocale: function (previousLocale) {
                    currentLocale = previousLocale || 'en_CA';
                }
            },
            '*/cartridge/scripts/helper/listingPageService': {
                LISTING_PAGE_BULK_LIMIT: 100,
                getListingPagesPage: function () {
                    return {
                        ok: true,
                        object: {
                            results: [{
                                id: 'page-1'
                            }]
                        }
                    };
                }
            }
        });

        var pages = helper.readExistingListingPages(createExportContext(), function (response) {
            return response;
        });

        assert.lengthOf(pages, 1);
        assert.strictEqual(pages[0].id, 'page-1');
    });

    it('reads CMH listing page responses that return dw.util.List-like objects', function () {
        var helper = proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/helper/listingPageHelper'), {
            'dw/catalog/CatalogMgr': {
                getCatalog: function () {
                    return {
                        root: createCategory('root', 'Root', [])
                    };
                },
                getSiteCatalog: function () {
                    return {
                        root: createCategory('root', 'Root', [])
                    };
                }
            },
            'dw/catalog/ProductMgr': {
                queryProductsInCatalog: function () {
                    return createIterator([]);
                }
            },
            'dw/system/Logger': {
                getLogger: function () {
                    return {
                        warn: function () {},
                        error: function () {}
                    };
                }
            },
            'dw/util/HashMap': createHashMap(),
            'dw/util/HashSet': createHashSet(),
            '*/cartridge/scripts/helper/exportTargetHelper': {
                applyRequestLocale: function (context) {
                    var previousLocale = currentLocale;
                    currentLocale = context.locale;
                    return previousLocale;
                },
                restoreRequestLocale: function (previousLocale) {
                    currentLocale = previousLocale || 'en_CA';
                }
            },
            '*/cartridge/scripts/helper/listingPageService': {
                LISTING_PAGE_BULK_LIMIT: 100,
                getListingPagesPage: function () {
                    return {
                        ok: true,
                        object: {
                            toArray: function () {
                                return [{
                                    id: 'page-1'
                                }];
                            }
                        }
                    };
                }
            }
        });

        var pages = helper.readExistingListingPages(createExportContext(), function (response) {
            return response;
        });

        assert.lengthOf(pages, 1);
        assert.strictEqual(pages[0].id, 'page-1');
    });

    it('verifies written listing pages using the refreshed listing page indexes', function () {
        var helper = createHelper({
            root: createCategory('root', 'Root', [])
        }, []);
        var categoryPage = helper.buildCategoryListingPage(['Cat'], createExportContext());
        var brandPage = helper.buildBrandListingPage('vetdiet', createExportContext());

        assert.doesNotThrow(function () {
            helper.verifyWrittenListingPages([categoryPage, brandPage], [
                {
                    id: 'category-id',
                    name: 'Cat',
                    patterns: [{
                        url: 'https://www.mondou.com/cat'
                    }]
                },
                {
                    id: 'brand-id',
                    name: 'vetdiet',
                    patterns: [{
                        url: 'https://www.mondou.com/brands/vetdiet'
                    }]
                }
            ]);
        });
    });
});
