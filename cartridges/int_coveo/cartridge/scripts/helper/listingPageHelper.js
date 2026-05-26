'use strict';

var CatalogMgr = require('dw/catalog/CatalogMgr');
var Logger = require('dw/system/Logger').getLogger('Coveo');
var HashSet = require('dw/util/HashSet');

var exportTargetHelper = require('*/cartridge/scripts/helper/exportTargetHelper');
var listingPageService = require('*/cartridge/scripts/helper/listingPageService');

var PAGE_TYPE_CATEGORY = 'category';

/**
 * Returns whether a value is empty.
 * @param {*} value - Value to inspect.
 * @returns {boolean} whether value is empty.
 */
function isEmptyValue(value) {
    return value === null
        || value === undefined
        || value === ''
        || (Array.isArray(value) && value.length === 0);
}

/**
 * Returns a trimmed string value.
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
 * Converts a collection, iterator, or array-like value to an array.
 * @param {*} value - Value to convert.
 * @returns {Array} array value.
 */
function toArray(value) {
    var values = [];
    var index = 0;

    if (isEmptyValue(value)) {
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
 * Safely reads an object property in Rhino/SFCC contexts where unsupported property access can throw.
 * @param {Object} value - Source object.
 * @param {string} propertyName - Property name to read.
 * @returns {*} property value.
 */
function getObjectProperty(value, propertyName) {
    if (isEmptyValue(value) || typeof value !== 'object') {
        return undefined;
    }

    try {
        return value[propertyName];
    } catch (ex) {
        return undefined;
    }
}

/**
 * Closes iterators when supported.
 * @param {Object} iterator - Iterator to close.
 */
function closeIterator(iterator) {
    if (!isEmptyValue(iterator) && typeof iterator.close === 'function') {
        iterator.close();
    }
}

/**
 * Returns whether a catalog category should be exposed as a listing page.
 * @param {Object} category - Category to inspect.
 * @returns {boolean} whether the category is online.
 */
function isOnlineCategory(category) {
    if (isEmptyValue(category)) {
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
 * Returns display text for a category.
 * @param {Object} category - Category to inspect.
 * @returns {string} category name.
 */
function getCategoryName(category) {
    return normalizeString(category.displayName) || normalizeString(category.name) || normalizeString(category.ID);
}

/**
 * Reads a category's child categories.
 * @param {Object} category - Category to inspect.
 * @returns {Array} child categories.
 */
function getSubCategories(category) {
    if (isEmptyValue(category)) {
        return [];
    }

    if (typeof category.getOnlineSubCategories === 'function') {
        return toArray(category.getOnlineSubCategories());
    }

    if (!isEmptyValue(category.onlineSubCategories)) {
        return toArray(category.onlineSubCategories);
    }

    if (typeof category.getSubCategories === 'function') {
        return toArray(category.getSubCategories());
    }

    return toArray(category.subCategories);
}

/**
 * Returns the category roots for a catalog.
 * @param {Object} catalog - Catalog to inspect.
 * @returns {Array} root categories.
 */
function getCatalogRootCategories(catalog) {
    var rootCategory = null;

    if (isEmptyValue(catalog)) {
        return [];
    }

    rootCategory = catalog.root || catalog.rootCategory || (typeof catalog.getRoot === 'function' ? catalog.getRoot() : null);
    if (!isEmptyValue(rootCategory)) {
        return getSubCategories(rootCategory);
    }

    if (typeof catalog.getRootCategories === 'function') {
        return toArray(catalog.getRootCategories());
    }

    if (!isEmptyValue(catalog.onlineRootCategories)) {
        return toArray(catalog.onlineRootCategories);
    }

    return toArray(catalog.rootCategories);
}

/**
 * Returns the target catalog for category and brand discovery.
 * @param {Object} exportContext - Export context.
 * @returns {Object} catalog.
 */
function getTargetCatalog(exportContext) {
    var catalog = null;

    if (!isEmptyValue(exportContext) && !isEmptyValue(exportContext.catalogId)) {
        catalog = CatalogMgr.getCatalog(exportContext.catalogId);
        if (isEmptyValue(catalog)) {
            throw new Error('The Coveo export target references catalog ' + exportContext.catalogId + ', but that catalog does not exist.');
        }

        return catalog;
    }

    if (typeof CatalogMgr.getSiteCatalog === 'function') {
        catalog = CatalogMgr.getSiteCatalog();
    }

    if (isEmptyValue(catalog)) {
        throw new Error('The Coveo listing page sync requires a target catalogId or an assigned site catalog.');
    }

    return catalog;
}

/**
 * Removes common French and Latin accents before slug generation.
 * @param {string} value - Value to transliterate.
 * @returns {string} transliterated value.
 */
function transliterate(value) {
    return normalizeString(value)
        .replace(/[àáâãäå]/g, 'a')
        .replace(/[ç]/g, 'c')
        .replace(/[èéêë]/g, 'e')
        .replace(/[ìíîï]/g, 'i')
        .replace(/[ñ]/g, 'n')
        .replace(/[òóôõö]/g, 'o')
        .replace(/[ùúûü]/g, 'u')
        .replace(/[ýÿ]/g, 'y')
        .replace(/[æ]/g, 'ae')
        .replace(/[œ]/g, 'oe');
}

/**
 * Builds a URL slug.
 * @param {string} value - Value to slugify.
 * @param {string} ampersandToken - Token used for ampersands.
 * @returns {string} slug.
 */
function slugify(value, ampersandToken) {
    var token = normalizeString(ampersandToken) || 'and';
    var slug = transliterate(normalizeString(value).toLowerCase());

    slug = slug.replace(/&/g, ' ' + token.toLowerCase() + ' ');
    slug = slug.replace(/['’]/g, '');
    slug = slug.replace(/[^a-z0-9]+/g, '-');
    slug = slug.replace(/^-+|-+$/g, '');
    slug = slug.replace(/-+/g, '-');

    return slug;
}

/**
 * Builds an absolute URL from a base and path.
 * @param {string} baseUrl - Storefront base URL.
 * @param {string} path - Relative path.
 * @returns {string} absolute URL.
 */
function buildAbsoluteUrl(baseUrl, path) {
    var normalizedBase = normalizeString(baseUrl).replace(/\/+$/g, '');
    var normalizedPath = normalizeString(path);

    if (/^https?:\/\//i.test(normalizedPath)) {
        return normalizedPath;
    }

    normalizedPath = normalizedPath.replace(/^\/+/g, '');

    return normalizedBase + '/' + normalizedPath;
}

/**
 * Builds a relative URL pattern from a rendered path or absolute URL.
 * @param {string} path - Relative path or absolute URL.
 * @returns {string} relative URL pattern.
 */
function buildRelativeUrl(path) {
    var normalizedPath = normalizeString(path);
    var absoluteMatch = null;

    if (isEmptyValue(normalizedPath)) {
        return '';
    }

    if (/^https?:\/\//i.test(normalizedPath)) {
        absoluteMatch = normalizedPath.match(/^https?:\/\/[^/]+(\/.*)?$/i);
        return absoluteMatch && !isEmptyValue(absoluteMatch[1]) ? absoluteMatch[1] : '/';
    }

    if (normalizedPath.charAt(0) !== '/') {
        normalizedPath = '/' + normalizedPath;
    }

    return normalizedPath;
}

/**
 * Builds deduplicated listing page URL patterns.
 * @param {string} baseUrl - Storefront base URL.
 * @param {string} path - Relative path or absolute URL.
 * @returns {Array} URL patterns.
 */
function buildListingPatterns(baseUrl, path) {
    var seenUrls = {};
    var urls = [
        buildAbsoluteUrl(baseUrl, path),
        buildRelativeUrl(path)
    ];

    return urls.filter(function (url) {
        var normalizedUrl = normalizeString(url);

        if (isEmptyValue(normalizedUrl) || seenUrls[normalizedUrl]) {
            return false;
        }

        seenUrls[normalizedUrl] = true;
        return true;
    }).map(function (url) {
        return {
            url: url
        };
    });
}

/**
 * Compares two normalized string values.
 * @param {string} left - Left-hand value.
 * @param {string} right - Right-hand value.
 * @returns {number} comparison result.
 */
function compareStrings(left, right) {
    var leftValue = normalizeString(left);
    var rightValue = normalizeString(right);

    if (leftValue === rightValue) {
        return 0;
    }

    return leftValue < rightValue ? -1 : 1;
}

/**
 * Builds a normalized set of excluded root category IDs.
 * @param {Array} excludedRootCategoryIds - Category roots to exclude.
 * @returns {Object} lookup map by lowercase category ID.
 */
function buildExcludedRootCategoryIdMap(excludedRootCategoryIds) {
    var excludedRootCategoryIdMap = {};

    toArray(excludedRootCategoryIds).forEach(function (categoryId) {
        var normalizedCategoryId = normalizeString(categoryId).toLowerCase();

        if (!isEmptyValue(normalizedCategoryId)) {
            excludedRootCategoryIdMap[normalizedCategoryId] = true;
        }
    });

    return excludedRootCategoryIdMap;
}

/**
 * Renders a listing URL template.
 * @param {string} template - URL template.
 * @param {Object} values - Placeholder values.
 * @returns {string} rendered template.
 */
function renderTemplate(template, values) {
    var rendered = normalizeString(template);

    Object.keys(values || {}).forEach(function (key) {
        rendered = rendered.split('{' + key + '}').join(values[key]);
    });

    return rendered;
}

/**
 * Builds the locale model expected by Public Listing Page API page rules.
 * @param {Object} exportContext - Export context.
 * @returns {Object} locale model.
 */
function buildRuleLocale(exportContext) {
    return {
        language: normalizeString(exportContext.language).toLowerCase(),
        country: normalizeString(exportContext.coveoCountry).toUpperCase(),
        currency: normalizeString(exportContext.coveoCurrency).toUpperCase()
    };
}

/**
 * Creates a category listing payload.
 * @param {Object} categoryEntry - Category entry.
 * @param {Object} exportContext - Export context.
 * @returns {Object} listing page payload.
 */
function buildCategoryListingPage(categoryEntry, exportContext) {
    var normalizedCategoryEntry = Array.isArray(categoryEntry)
        ? {
            pathNames: categoryEntry,
            keyParts: []
        }
        : (categoryEntry || {});
    var pathNames = normalizedCategoryEntry.pathNames || [];
    var categoryValue = pathNames.join('|');
    var patterns = [];
    var patternUrls = {};
    var categorySlugPath = pathNames.map(function (pathName) {
        return slugify(pathName, exportContext.listingSlugAmpersandToken);
    }).join('/');
    var renderedPath = renderTemplate(exportContext.listingCategoryUrlTemplate, {
        categorySlug: categorySlugPath,
        categorySlugPath: categorySlugPath,
        nameSlug: categorySlugPath
    });
    var brandName = pathNames[pathNames.length - 1];
    var legacyBrandPath = isLegacyBrandCategoryEntry(normalizedCategoryEntry)
        ? renderTemplate(exportContext.listingBrandUrlTemplate, {
            brand: brandName,
            brandSlug: slugify(brandName, exportContext.listingSlugAmpersandToken),
            nameSlug: slugify(brandName, exportContext.listingSlugAmpersandToken)
        })
        : '';

    function appendPatterns(path) {
        buildListingPatterns(exportContext.storefrontBaseUrl, path).forEach(function (pattern) {
            if (!patternUrls[pattern.url]) {
                patternUrls[pattern.url] = true;
                patterns.push(pattern);
            }
        });
    }

    appendPatterns(renderedPath);
    if (!isEmptyValue(legacyBrandPath)) {
        appendPatterns(legacyBrandPath);
    }

    return {
        name: categoryValue,
        patterns: patterns,
        pageRules: [{
            name: 'Include ec_category contains ' + categoryValue,
            locales: [buildRuleLocale(exportContext)],
            filters: [{
                fieldName: 'ec_category',
                operator: 'contains',
                value: {
                    type: 'array',
                    values: [categoryValue]
                }
            }]
        }],
        trackingId: exportContext.coveoTrackingId,
        generatedType: PAGE_TYPE_CATEGORY
    };
}

/**
 * Returns whether a category entry maps a former brand landing page.
 * @param {Object} categoryEntry - Category entry.
 * @returns {boolean} whether legacy brand URLs should be added.
 */
function isLegacyBrandCategoryEntry(categoryEntry) {
    var keyParts = categoryEntry && categoryEntry.keyParts ? categoryEntry.keyParts : [];
    var pathNames = categoryEntry && categoryEntry.pathNames ? categoryEntry.pathNames : [];

    return pathNames.length === 2
        && (
            normalizeString(keyParts[0]).toLowerCase() === 'brands'
            || normalizeString(pathNames[0]).toLowerCase() === 'brands'
        );
}

/**
 * Builds a contribution for a category listing page in a specific locale.
 * @param {Object} categoryEntry - Category entry.
 * @param {Object} exportContext - Export context.
 * @returns {Object} locale contribution.
 */
function buildCategoryListingPageContribution(categoryEntry, exportContext) {
    var page = buildCategoryListingPage(categoryEntry, exportContext);

    return {
        key: 'category|' + categoryEntry.key,
        name: page.name,
        patternUrls: (page.patterns || []).map(function (pattern) {
            return normalizeString(pattern.url);
        }),
        pageRule: page.pageRules[0],
        trackingId: page.trackingId,
        generatedType: page.generatedType
    };
}

/**
 * Traverses all online categories.
 * @param {Object} catalog - Catalog to inspect.
 * @param {Array} excludedRootCategoryIds - Category roots to exclude.
 * @returns {Array} category name paths.
 */
function collectCategoryEntries(catalog, excludedRootCategoryIds) {
    var categoryEntries = [];
    var excludedRootCategoryIdMap = buildExcludedRootCategoryIdMap(excludedRootCategoryIds);

    function visitCategory(category, parentPath) {
        var categoryName = getCategoryName(category);
        var categoryKey = normalizeString(category.ID) || normalizeString(category.name) || categoryName;
        var currentPath;

        if (!isOnlineCategory(category) || isEmptyValue(categoryName)) {
            return;
        }

        if (parentPath.key.length === 0 && (
            excludedRootCategoryIdMap[normalizeString(categoryKey).toLowerCase()]
            || excludedRootCategoryIdMap[normalizeString(categoryName).toLowerCase()]
        )) {
            return;
        }

        currentPath = {
            key: parentPath.key.concat([categoryKey]),
            pathNames: parentPath.pathNames.concat([categoryName])
        };
        categoryEntries.push({
            key: currentPath.key.join('|'),
            keyParts: currentPath.key,
            pathNames: currentPath.pathNames,
            name: currentPath.pathNames.join('|')
        });

        getSubCategories(category).forEach(function (childCategory) {
            visitCategory(childCategory, currentPath);
        });
    }

    getCatalogRootCategories(catalog).forEach(function (rootCategory) {
        visitCategory(rootCategory, {
            key: [],
            pathNames: []
        });
    });

    return categoryEntries;
}

/**
 * Returns category path names for a catalog.
 * @param {Object} catalog - Catalog to inspect.
 * @returns {Array} category name paths.
 */
function collectCategoryPaths(catalog) {
    return collectCategoryEntries(catalog).map(function (categoryEntry) {
        return categoryEntry.pathNames;
    });
}

/**
 * Builds listing page contributions for the current request locale.
 * @param {Object} exportContext - Export context.
 * @param {Object} options - Build options.
 * @returns {Array} locale contributions.
 */
function buildLocaleListingPageContributions(exportContext, options) {
    var catalog = getTargetCatalog(exportContext);
    return collectCategoryEntries(catalog, options && options.excludedCategoryRoots).map(function (categoryEntry) {
        return buildCategoryListingPageContribution(categoryEntry, exportContext);
    });
}

/**
 * Returns a normalized list of export contexts.
 * @param {Object|Array} exportContexts - Export context or contexts.
 * @returns {Array} export contexts.
 */
function normalizeExportContexts(exportContexts) {
    if (Array.isArray(exportContexts)) {
        return exportContexts.filter(function (exportContext) {
            return !isEmptyValue(exportContext);
        });
    }

    return isEmptyValue(exportContexts) ? [] : [exportContexts];
}

/**
 * Merges locale contributions into a unique listing page payload.
 * @param {Object} contribution - Locale contribution.
 * @param {Object} page - Aggregated page.
 */
function mergeContributionIntoPage(contribution, page) {
    var patternUrls = (contribution.patternUrls || []).map(function (patternUrl) {
        return normalizeString(patternUrl);
    }).filter(function (patternUrl) {
        return !isEmptyValue(patternUrl);
    });
    var rule = contribution.pageRule;
    var ruleKey = [
        normalizeString(rule.name),
        JSON.stringify(rule.filters || [])
    ].join('|');

    patternUrls.forEach(function (patternUrl) {
        if (!page.patternByUrl[patternUrl]) {
            page.patternByUrl[patternUrl] = true;
            page.patterns.push({
                url: patternUrl
            });
        }
    });

    if (!page.pageRulesByKey[ruleKey]) {
        page.pageRulesByKey[ruleKey] = {
            name: rule.name,
            locales: [],
            filters: rule.filters
        };
        page.pageRules.push(page.pageRulesByKey[ruleKey]);
    }

    (rule.locales || []).forEach(function (locale) {
        var localeKey = [
            normalizeString(locale.language).toLowerCase(),
            normalizeString(locale.country).toUpperCase(),
            normalizeString(locale.currency).toUpperCase()
        ].join('|');

        if (!page.localeByKey[localeKey]) {
            page.localeByKey[localeKey] = true;
            page.pageRulesByKey[ruleKey].locales.push(locale);
        }
    });
}

/**
 * Merges locale contributions into public listing page payloads.
 * @param {Array} contributions - Locale contributions.
 * @returns {Array} listing page payloads.
 */
function mergeListingPageContributions(contributions) {
    var pagesByKey = {};
    var listingPages = [];

    contributions.forEach(function (contribution) {
        var page = pagesByKey[contribution.key];

        if (isEmptyValue(page)) {
            page = {
                name: contribution.name,
                patterns: [],
                pageRules: [],
                trackingId: contribution.trackingId,
                generatedType: contribution.generatedType,
                patternByUrl: {},
                pageRulesByKey: {},
                localeByKey: {}
            };
            pagesByKey[contribution.key] = page;
            listingPages.push(page);
        }

        if (page.generatedType !== contribution.generatedType) {
            throw new Error('Conflicting CMH listing page types detected for ' + contribution.key + '.');
        }

        mergeContributionIntoPage(contribution, page);
    });

    listingPages.forEach(function (page) {
        delete page.patternByUrl;
        delete page.pageRulesByKey;
        delete page.localeByKey;
    });

    return listingPages;
}

/**
 * Builds all desired listing page payloads.
 * @param {Object|Array} exportContexts - Export context or contexts.
 * @param {Object} options - Build options.
 * @returns {Array} listing page payloads.
 */
function buildDesiredListingPages(exportContexts, options) {
    var contexts = normalizeExportContexts(exportContexts);
    var contributions = [];

    contexts.sort(function (left, right) {
        var localeComparison = compareStrings(left.locale, right.locale);

        if (localeComparison !== 0) {
            return localeComparison;
        }

        return compareStrings(left.targetId, right.targetId);
    });

    contexts.forEach(function (exportContext) {
        var previousLocale = exportTargetHelper.applyRequestLocale(exportContext);

        try {
            contributions = contributions.concat(buildLocaleListingPageContributions(exportContext, options));
        } finally {
            exportTargetHelper.restoreRequestLocale(previousLocale);
        }
    });

    return mergeListingPageContributions(contributions);
}

/**
 * Removes internal generation metadata before sending the request.
 * @param {Object} listingPage - Listing page payload.
 * @returns {Object} API payload.
 */
function toApiPayload(listingPage) {
    var payload = {};

    Object.keys(listingPage).forEach(function (key) {
        if (key !== 'generatedType') {
            payload[key] = listingPage[key];
        }
    });

    return payload;
}

/**
 * Returns the first URL configured on a listing page.
 * @param {Object} listingPage - Listing page payload.
 * @returns {string} URL.
 */
function getPrimaryUrl(listingPage) {
    return listingPage && listingPage.patterns && listingPage.patterns.length
        ? normalizeString(listingPage.patterns[0].url)
        : '';
}

/**
 * Stores existing listing pages for matching.
 * @param {Array} listingPages - Existing listing pages.
 * @returns {Object} indexes.
 */
function indexExistingListingPages(listingPages) {
    return {
        listingPages: listingPages || []
    };
}

/**
 * Removes duplicate generated listing pages while keeping the first occurrence.
 * @param {Array} desiredListingPages - Desired listing pages.
 * @returns {Array} normalized listing pages.
 */
function dedupeDesiredListingPages(desiredListingPages) {
    var seenUrls = new HashSet();
    var seenNames = new HashSet();
    var normalizedListingPages = [];

    desiredListingPages.forEach(function (listingPage) {
        var url = getPrimaryUrl(listingPage);
        var name = normalizeString(listingPage.name);
        var duplicateUrl = '';
        var duplicateName = '';
        var urls = (listingPage.patterns || []).map(function (pattern) {
            return normalizeString(pattern.url);
        }).filter(function (patternUrl) {
            return !isEmptyValue(patternUrl);
        });

        urls.some(function (patternUrl) {
            if (seenUrls.contains(patternUrl)) {
                duplicateUrl = patternUrl;
                return true;
            }

            return false;
        });

        if (!isEmptyValue(duplicateUrl)) {
            Logger.warn('Skipping duplicate generated CMH listing page URL {0} for {1}.', duplicateUrl, name);
            return;
        }

        if (seenNames.contains(name)) {
            duplicateName = name;
        }

        if (!isEmptyValue(duplicateName)) {
            Logger.warn('Skipping duplicate generated CMH listing page name {0} for {1}.', duplicateName, url);
            return;
        }

        urls.forEach(function (patternUrl) {
            seenUrls.add(patternUrl);
        });
        seenNames.add(name);
        normalizedListingPages.push(listingPage);
    });

    return normalizedListingPages;
}

/**
 * Finds an existing listing page by desired URL first, then by name.
 * @param {Object} desiredListingPage - Desired listing page.
 * @param {Object} indexes - Existing listing page indexes.
 * @returns {Object|null} existing listing page.
 */
function findExistingListingPage(desiredListingPage, indexes) {
    var url = getPrimaryUrl(desiredListingPage);
    var name = normalizeString(desiredListingPage.name);
    var listingPages = indexes && indexes.listingPages ? indexes.listingPages : [];
    var urlMatches = [];
    var nameMatches = [];

    listingPages.forEach(function (listingPage) {
        var listingPageName = normalizeString(listingPage.name);
        var hasUrlMatch = (listingPage.patterns || []).some(function (pattern) {
            return normalizeString(pattern.url) === url;
        });

        if (hasUrlMatch) {
            urlMatches.push(listingPage);
        }

        if (listingPageName === name) {
            nameMatches.push(listingPage);
        }
    });

    if (urlMatches.length > 1) {
        throw new Error('Duplicate CMH listing page URL detected for ' + url + '. Resolve the duplicate before syncing listing pages.');
    }

    if (urlMatches.length === 1) {
        return urlMatches[0];
    }

    if (nameMatches.length > 1) {
        throw new Error('Duplicate CMH listing page name detected for ' + name + '. Resolve the duplicate before syncing listing pages.');
    }

    return nameMatches.length ? nameMatches[0] : null;
}

/**
 * Splits desired listing pages into create and update requests.
 * @param {Array} desiredListingPages - Desired listing pages.
 * @param {Array} existingListingPages - Existing listing pages.
 * @returns {Object} sync plan.
 */
function planListingPageChanges(desiredListingPages, existingListingPages) {
    var indexes = indexExistingListingPages(existingListingPages);
    var creates = [];
    var updates = [];
    var normalizedDesiredListingPages = dedupeDesiredListingPages(desiredListingPages);

    normalizedDesiredListingPages.forEach(function (desiredListingPage) {
        var existingListingPage = findExistingListingPage(desiredListingPage, indexes);
        var payload = toApiPayload(desiredListingPage);

        if (!isEmptyValue(existingListingPage)) {
            payload.id = existingListingPage.id;
            updates.push(payload);
            return;
        }

        creates.push(payload);
    });

    return {
        creates: creates,
        updates: updates
    };
}

/**
 * Splits an array into API-safe chunks.
 * @param {Array} values - Values to chunk.
 * @param {number} size - Chunk size.
 * @returns {Array} chunks.
 */
function chunk(values, size) {
    var chunks = [];
    var index = 0;

    for (index = 0; index < values.length; index += size) {
        chunks.push(values.slice(index, index + size));
    }

    return chunks;
}

/**
 * Extracts listing page items from a CMH list response.
 * @param {Object|Array} responseObject - Parsed response payload.
 * @returns {Array} listing page items.
 */
function extractListingPageItems(responseObject) {
    var items = null;

    if (Array.isArray(responseObject)) {
        return responseObject;
    }

    if (isEmptyValue(responseObject) || typeof responseObject !== 'object') {
        return [];
    }

    if (typeof responseObject.toArray === 'function') {
        return responseObject.toArray();
    }

    items = getObjectProperty(responseObject, 'items');
    if (Array.isArray(items)) {
        return items;
    }

    items = getObjectProperty(responseObject, 'results');
    if (Array.isArray(items)) {
        return items;
    }

    items = getObjectProperty(responseObject, 'listingPages');
    if (Array.isArray(items)) {
        return items;
    }

    return [];
}

/**
 * Extracts the total page count from a CMH list response.
 * @param {Object|Array} responseObject - Parsed response payload.
 * @returns {number} total page count.
 */
function extractTotalPages(responseObject) {
    var pagination = getObjectProperty(responseObject, 'pagination');
    var totalPages = getObjectProperty(responseObject, 'totalPages');

    if (Array.isArray(responseObject)) {
        return 1;
    }

    if (!isEmptyValue(pagination) && !isEmptyValue(getObjectProperty(pagination, 'totalPages'))) {
        return Number(getObjectProperty(pagination, 'totalPages')) || 1;
    }

    if (!isEmptyValue(totalPages)) {
        return Number(totalPages) || 1;
    }

    return 1;
}

/**
 * Reads all existing listing pages for the target tracking ID.
 * @param {Object} exportContext - Export context.
 * @param {Function} ensureSuccessfulResponse - Service response validator.
 * @returns {Array} existing listing pages.
 */
function readExistingListingPages(exportContext, ensureSuccessfulResponse) {
    var existingListingPages = [];
    var page = 0;
    var totalPages = 1;

    while (page < totalPages) {
        var response = ensureSuccessfulResponse(listingPageService.getListingPagesPage(exportContext, page), 'listing pages read');
        var responseObject = response.object || {};
        var items = extractListingPageItems(responseObject);

        existingListingPages = existingListingPages.concat(items);
        totalPages = extractTotalPages(responseObject);
        page += 1;
    }

    return existingListingPages;
}

/**
 * Verifies that written listing pages can be found after sync.
 * @param {Array} writtenListingPages - Written listing pages.
 * @param {Array} refreshedListingPages - Refreshed listing pages.
 */
function verifyWrittenListingPages(writtenListingPages, refreshedListingPages) {
    var refreshedIndexes = indexExistingListingPages(refreshedListingPages);

    writtenListingPages.forEach(function (listingPage) {
        if (isEmptyValue(findExistingListingPage(listingPage, refreshedIndexes))) {
            throw new Error('Unable to verify CMH listing page sync for ' + listingPage.name + '.');
        }
    });
}

module.exports = {
    PAGE_TYPE_CATEGORY: PAGE_TYPE_CATEGORY,
    buildAbsoluteUrl: buildAbsoluteUrl,
    buildCategoryListingPage: buildCategoryListingPage,
    buildCategoryListingPageContribution: buildCategoryListingPageContribution,
    buildDesiredListingPages: buildDesiredListingPages,
    chunk: chunk,
    collectCategoryEntries: collectCategoryEntries,
    collectCategoryPaths: collectCategoryPaths,
    dedupeDesiredListingPages: dedupeDesiredListingPages,
    extractListingPageItems: extractListingPageItems,
    extractTotalPages: extractTotalPages,
    getPrimaryUrl: getPrimaryUrl,
    mergeListingPageContributions: mergeListingPageContributions,
    planListingPageChanges: planListingPageChanges,
    readExistingListingPages: readExistingListingPages,
    renderTemplate: renderTemplate,
    slugify: slugify,
    toApiPayload: toApiPayload,
    verifyWrittenListingPages: verifyWrittenListingPages
};
