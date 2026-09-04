'use strict';

var File = require('dw/io/File');
var FileReader = require('dw/io/FileReader');
var FileWriter = require('dw/io/FileWriter');
var CSVStreamReader = require('dw/io/CSVStreamReader');
var HTTPClient = require('dw/net/HTTPClient');
var Logger = require('dw/system/Logger').getLogger('Coveo');

var coveoConstant = require('*/cartridge/scripts/utils/coveoConstant');
var coveoHelper = require('*/cartridge/scripts/helper/coveoHelper');
var exportTargetHelper = require('*/cartridge/scripts/helper/exportTargetHelper');
var productRequestGenerator = require('*/cartridge/scripts/generators/productRequestGenerator');
var purchaseMetricHelper = require('*/cartridge/scripts/helper/purchaseMetricHelper');
var usageAnalyticsService = require('*/cartridge/scripts/services/usageAnalyticsService');

var EXPORT_POLL_WAIT_MS = 5000;
var MAX_EXPORT_POLL_ATTEMPTS = 60;
var PRODUCT_ID_DIMENSION = 'custom_events.c_contentidvalue';

function isEmptyValue(value) {
    return value === null
        || value === undefined
        || value === ''
        || (Array.isArray(value) && value.length === 0);
}

function normalizeString(value) {
    if (value === null || value === undefined) {
        return '';
    }

    return String(value).trim();
}

function sleepForExportPoll(milliseconds) {
    if (typeof global !== 'undefined' && typeof global.__purchaseEnrichmentSleep === 'function') {
        global.__purchaseEnrichmentSleep(milliseconds);
        return;
    }

    if (typeof Packages !== 'undefined'
        && Packages.java
        && Packages.java.lang
        && Packages.java.lang.Thread
        && typeof Packages.java.lang.Thread.sleep === 'function') {
        Packages.java.lang.Thread.sleep(milliseconds);
        return;
    }

    if (typeof java !== 'undefined'
        && java.lang
        && java.lang.Thread
        && typeof java.lang.Thread.sleep === 'function') {
        java.lang.Thread.sleep(milliseconds);
        return;
    }

    var startTime = new Date().getTime();

    while ((new Date().getTime() - startTime) < milliseconds) {
        // Intentional no-op fallback.
    }
}

function closeIterator(iterator) {
    if (!isEmptyValue(iterator) && typeof iterator.close === 'function') {
        iterator.close();
    }
}

function closeQuietly(closeable) {
    if (!isEmptyValue(closeable) && typeof closeable.close === 'function') {
        try {
            closeable.close();
        } catch (error) {
            // Preserve the primary operation result.
        }
    }
}

function formatFailureDetails(response) {
    var details = [];
    var responseObject = response && response.object;

    if (!isEmptyValue(response) && !isEmptyValue(response.requestMethod) && !isEmptyValue(response.requestUrl)) {
        details.push('request=' + response.requestMethod + ' ' + response.requestUrl);
    } else if (!isEmptyValue(response) && !isEmptyValue(response.requestUrl)) {
        details.push('requestUrl=' + response.requestUrl);
    }

    if (!isEmptyValue(response) && !isEmptyValue(response.status)) {
        details.push('status=' + response.status);
    }

    if (!isEmptyValue(response) && !isEmptyValue(response.error)) {
        details.push('error=' + response.error);
    }

    if (!isEmptyValue(response) && !isEmptyValue(response.errorMessage)) {
        details.push('errorMessage=' + response.errorMessage);
    }

    if (!isEmptyValue(response) && !isEmptyValue(response.msg)) {
        details.push('message=' + response.msg);
    }

    if (!isEmptyValue(responseObject) && !isEmptyValue(responseObject.message)) {
        details.push('responseMessage=' + responseObject.message);
    } else if (!isEmptyValue(responseObject) && !isEmptyValue(responseObject.text)) {
        details.push('responseBody=' + responseObject.text);
    }

    return details.join(', ');
}

function ensureSuccessfulResponse(response, operation) {
    if (isEmptyValue(response) || !response.ok) {
        var detail = formatFailureDetails(response);

        if (!isEmptyValue(detail)) {
            Logger.error('Coveo purchase enrichment {0} request failed. {1}', operation, detail);
            throw new Error('Coveo purchase enrichment ' + operation + ' request failed. ' + detail);
        }

        throw new Error('Coveo purchase enrichment ' + operation + ' request failed.');
    }

    return response;
}

function getUsageAnalyticsHeaders() {
    return {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        useCredentialAuth: true
    };
}

function getUsageAnalyticsDownloadHeaders() {
    return {
        Accept: 'text/csv,application/json'
    };
}

function isRedirectStatusCode(statusCode) {
    return statusCode >= 300 && statusCode < 400;
}

function sanitizeFileSegment(value) {
    var normalizedValue = normalizeString(value).replace(/[^A-Za-z0-9_-]+/g, '_');

    return normalizedValue || 'default';
}

function pad2(value) {
    return value < 10 ? '0' + value : String(value);
}

function pad3(value) {
    if (value < 10) {
        return '00' + value;
    }

    if (value < 100) {
        return '0' + value;
    }

    return String(value);
}

function buildTimestampSegment() {
    var now = new Date();

    return now.getFullYear()
        + pad2(now.getMonth() + 1)
        + pad2(now.getDate())
        + 'T'
        + pad2(now.getHours())
        + pad2(now.getMinutes())
        + pad2(now.getSeconds())
        + pad3(now.getMilliseconds());
}

function createTemporaryDownloadFile(workingPath, exportContext) {
    var fileName = 'coveo_purchase_enrichment_download_' + sanitizeFileSegment(exportContext.targetId || exportContext.locale || exportContext.coveoTrackingId) + '_' + buildTimestampSegment() + '.bin';
    var directory = new File([File.IMPEX, workingPath].join(File.SEPARATOR));

    directory.mkdirs();

    return new File([File.IMPEX, workingPath, fileName].join(File.SEPARATOR));
}

function sendHttpClientGet(url, headers, allowRedirect, outputFile) {
    var client = new HTTPClient();

    client.setTimeout(30000);
    client.setAllowRedirect(allowRedirect === true);
    client.open('GET', url);

    Object.keys(headers || {}).forEach(function (name) {
        client.setRequestHeader(name, headers[name]);
    });

    if (outputFile) {
        client.sendAndReceiveToFile(outputFile);
    } else {
        client.send();
    }

    return {
        ok: client.statusCode >= 200 && client.statusCode < 300,
        redirect: isRedirectStatusCode(client.statusCode),
        statusCode: client.statusCode,
        statusMessage: client.statusMessage,
        text: outputFile ? '' : client.text,
        errorText: client.errorText,
        location: client.getResponseHeader('Location'),
        contentType: normalizeString(client.getResponseHeader('Content-Type')),
        contentDisposition: normalizeString(client.getResponseHeader('Content-Disposition'))
    };
}

function isZipDownloadResponse(response, location) {
    var contentType = normalizeString(response && response.contentType).toLowerCase();
    var contentDisposition = normalizeString(response && response.contentDisposition).toLowerCase();
    var normalizedLocation = normalizeString(location).toLowerCase();

    return contentType.indexOf('application/zip') !== -1
        || contentType.indexOf('application/octet-stream') !== -1
        || /\.zip(?:$|\?)/.test(normalizedLocation)
        || contentDisposition.indexOf('.zip') !== -1;
}

function findFirstCsvFile(root) {
    var children = root && typeof root.listFiles === 'function' ? root.listFiles() : null;
    var index;
    var match = null;

    if (!children || !children.length) {
        return null;
    }

    for (index = 0; index < children.length; index += 1) {
        var child = children[index];

        if (child.isFile && child.isFile() && /\.csv$/i.test(normalizeString(child.getName ? child.getName() : child.name))) {
            return child;
        }
    }

    for (index = 0; index < children.length; index += 1) {
        child = children[index];

        if (child.isDirectory && child.isDirectory()) {
            match = findFirstCsvFile(child);

            if (match) {
                return match;
            }
        }
    }

    return null;
}

function removeDirectoryTree(root) {
    var children = null;
    var index;

    if (isEmptyValue(root) || !root.exists || !root.exists()) {
        return;
    }

    if (root.isDirectory && root.isDirectory()) {
        children = root.listFiles ? root.listFiles() : null;

        if (children && children.length) {
            for (index = 0; index < children.length; index += 1) {
                removeDirectoryTree(children[index]);
            }
        }
    }

    if (typeof root.remove === 'function') {
        root.remove();
    }
}

function prepareDownloadedExport(file, response, location, workingPath) {
    var unzipRoot = new File([File.IMPEX, workingPath, 'unzip-' + buildTimestampSegment()].join(File.SEPARATOR));
    var csvFile = null;

    if (!isZipDownloadResponse(response, location)) {
        return {
            csvFile: file,
            downloadFile: file,
            unzipRoot: null
        };
    }

    unzipRoot.mkdirs();

    try {
        file.unzip(unzipRoot);
        csvFile = findFirstCsvFile(unzipRoot);

        if (!csvFile) {
            throw new Error('The downloaded Usage Analytics export archive does not contain a CSV entry.');
        }
    } catch (error) {
        removeDirectoryTree(unzipRoot);
        throw error;
    }

    return {
        csvFile: csvFile,
        downloadFile: file,
        unzipRoot: unzipRoot
    };
}

function addQuery(endpoint, query) {
    var queryParts = [];
    var queryParameters = query || {};

    Object.keys(queryParameters).forEach(function (key) {
        var value = queryParameters[key];

        if (value === null || value === undefined || value === '') {
            return;
        }

        queryParts.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
    });

    if (!queryParts.length) {
        return endpoint;
    }

    return endpoint + '?' + queryParts.join('&');
}

function buildUsageAnalyticsEndpoint(exportContext, suffix, extraQuery) {
    var query = extraQuery || {};

    query.org = exportContext.coveoOrganizationId;

    return addQuery('v15/exports' + (suffix || ''), {
        org: query.org,
        redirect: query.redirect
    });
}

function writeImpexFile(directoryPath, fileName, contents) {
    var directory = new File([File.IMPEX, directoryPath].join(File.SEPARATOR));
    var file = new File([File.IMPEX, directoryPath, fileName].join(File.SEPARATOR));
    var writer = null;

    directory.mkdirs();
    writer = new FileWriter(file);

    try {
        writer.write(String(contents || ''));
        writer.flush();
    } finally {
        writer.close();
    }

    return file;
}

function removeFileQuietly(file) {
    try {
        if (!isEmptyValue(file) && typeof file.remove === 'function') {
            file.remove();
        }
    } catch (ex) {
        Logger.warn('Unable to remove temporary purchase enrichment file {0}. {1}', file && file.fullPath ? file.fullPath : '[unknown]', ex.message || ex);
    }
}

function validatePurchaseEnrichmentContext(exportContext) {
    var matchingTargetIds = [];
    var trackingId = normalizeString(exportContext && exportContext.coveoTrackingId);

    if (isEmptyValue(exportContext) || exportContext.legacyMode) {
        throw new Error('The Coveo purchase enrichment job requires a target-based export configuration with a CoveoCatalogExportTarget.');
    }

    if (isEmptyValue(trackingId)) {
        throw new Error('The Coveo purchase enrichment target ' + (exportContext.targetId || exportContext.label || exportContext.locale || '[unknown]') + ' is missing required value coveoTrackingId.');
    }

    exportTargetHelper.getTargetsForCurrentSite().forEach(function (targetObject) {
        var custom = targetObject.custom || {};

        if (normalizeString(custom.coveoTrackingId) === trackingId) {
            matchingTargetIds.push(normalizeString(custom.targetId));
        }
    });

    if (matchingTargetIds.length > 1) {
        Logger.warn(
            'The Coveo purchase enrichment target {0} shares trackingId {1} with other export targets ({2}). The job will continue and only update the currently resolved target/source.',
            exportContext.targetId || exportContext.label || exportContext.locale || '[unknown]',
            trackingId,
            matchingTargetIds.join(', ')
        );
    }
}

function createPurchaseExport(exportContext, options) {
    var now = new Date();
    var from = new Date(now.getTime() - (options.windowDays * 24 * 60 * 60 * 1000));
    var request = usageAnalyticsService.createUsageAnalyticsRequest(
        coveoConstant.COVEO_HTTP_METHOD.POST,
        buildUsageAnalyticsEndpoint(exportContext, '/create'),
        getUsageAnalyticsHeaders()
    );
    var response = ensureSuccessfulResponse(request.call({
        from: from.toISOString(),
        to: now.toISOString(),
        description: 'Rolling ' + options.windowDays + '-day purchase enrichment export for target ' + (exportContext.targetId || exportContext.locale || exportContext.coveoTrackingId),
        dimensions: [
            PRODUCT_ID_DIMENSION,
            options.quantityDimension
        ],
        tables: [
            'CUSTOM_EVENTS'
        ],
        commonFilters: [
            "trackingId=='" + exportContext.coveoTrackingId + "'"
        ],
        customEventsFilters: [
            "customEventType=='purchase'"
        ],
        exportFormat: 'EXCEL',
        useDisplayNames: false
    }), 'Usage Analytics export creation');

    return response.object || {};
}

function getPurchaseExport(exportContext, exportId) {
    var request = usageAnalyticsService.createUsageAnalyticsRequest(
        coveoConstant.COVEO_HTTP_METHOD.GET,
        buildUsageAnalyticsEndpoint(exportContext, '/' + encodeURIComponent(exportId), {
            redirect: false
        }),
        getUsageAnalyticsHeaders()
    );
    var response = ensureSuccessfulResponse(request.call(), 'Usage Analytics export status');

    return response.object || {};
}

function waitForAvailableExport(exportContext, createdExport) {
    var exportInfo = createdExport || {};
    var attempt;

    if (normalizeString(exportInfo.status) === 'AVAILABLE') {
        return exportInfo;
    }

    for (attempt = 1; attempt <= MAX_EXPORT_POLL_ATTEMPTS; attempt += 1) {
        sleepForExportPoll(EXPORT_POLL_WAIT_MS);
        exportInfo = getPurchaseExport(exportContext, exportInfo.id);

        if (normalizeString(exportInfo.status) === 'AVAILABLE') {
            return exportInfo;
        }

        if (normalizeString(exportInfo.status) === 'FAILED' || normalizeString(exportInfo.status) === 'EXPIRED') {
            throw new Error('The Usage Analytics export ' + exportInfo.id + ' finished with status ' + exportInfo.status + '.');
        }
    }

    throw new Error('The Usage Analytics export ' + normalizeString(exportInfo.id) + ' did not become AVAILABLE after ' + MAX_EXPORT_POLL_ATTEMPTS + ' polling attempts.');
}

function resolveExportDownloadLink(exportContext, exportInfo) {
    var downloadLink = normalizeString(exportInfo && exportInfo.downloadLink);

    if (!isEmptyValue(downloadLink)) {
        return downloadLink;
    }

    var request = usageAnalyticsService.createUsageAnalyticsRequest(
        coveoConstant.COVEO_HTTP_METHOD.GET,
        buildUsageAnalyticsEndpoint(exportContext, '/' + encodeURIComponent(exportInfo.id) + '/downloadlink'),
        getUsageAnalyticsHeaders()
    );
    var response = ensureSuccessfulResponse(request.call(), 'Usage Analytics export download link');

    downloadLink = normalizeString(response && response.object && response.object.downloadLink);

    if (isEmptyValue(downloadLink)) {
        throw new Error('The Usage Analytics export ' + exportInfo.id + ' does not expose a download link.');
    }

    return downloadLink;
}

function cleanupDownloadedExport(downloadedExport) {
    if (!downloadedExport) {
        return;
    }

    if (downloadedExport.unzipRoot) {
        removeDirectoryTree(downloadedExport.unzipRoot);
    }

    removeFileQuietly(downloadedExport.downloadFile);
}

function downloadExportFile(downloadLink, exportContext, workingPath) {
    var accessToken = usageAnalyticsService.getUsageAnalyticsAccessToken();
    var downloadFile = createTemporaryDownloadFile(workingPath, exportContext);
    var redirectResponse = null;
    var downloadResponse = null;

    try {
        redirectResponse = sendHttpClientGet(downloadLink, {
            Accept: getUsageAnalyticsDownloadHeaders().Accept,
            Authorization: 'Bearer ' + accessToken
        }, false, downloadFile);

        if (redirectResponse.redirect) {
            if (isEmptyValue(redirectResponse.location)) {
                throw new Error('The Usage Analytics export download redirect did not return a Location header.');
            }

            removeFileQuietly(downloadFile);
            downloadResponse = sendHttpClientGet(redirectResponse.location, {
                Accept: getUsageAnalyticsDownloadHeaders().Accept
            }, true, downloadFile);

            if (!downloadResponse.ok) {
                throw new Error(
                    'The redirected Usage Analytics export download failed. url='
                    + redirectResponse.location
                    + ', status='
                    + downloadResponse.statusCode
                    + ', message='
                    + normalizeString(downloadResponse.errorText || downloadResponse.statusMessage)
                    + '.'
                );
            }

            return prepareDownloadedExport(downloadFile, downloadResponse, redirectResponse.location, workingPath);
        }

        if (!redirectResponse.ok) {
            throw new Error(
                'The Usage Analytics export download failed. url='
                + downloadLink
                + ', status='
                + redirectResponse.statusCode
                + ', message='
                + normalizeString(redirectResponse.errorText || redirectResponse.statusMessage)
                + '.'
            );
        }

        return prepareDownloadedExport(downloadFile, redirectResponse, downloadLink, workingPath);
    } catch (error) {
        removeFileQuietly(downloadFile);
        throw error;
    }
}

function forEachCsvRow(csvText, rowCallback) {
    var row = [];
    var cell = '';
    var inQuotes = false;
    var index;

    for (index = 0; index < csvText.length; index += 1) {
        var currentChar = csvText.charAt(index);
        var nextChar = csvText.charAt(index + 1);

        if (currentChar === '"') {
            if (inQuotes && nextChar === '"') {
                cell += '"';
                index += 1;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (currentChar === ',' && !inQuotes) {
            row.push(cell);
            cell = '';
        } else if ((currentChar === '\n' || currentChar === '\r') && !inQuotes) {
            if (currentChar === '\r' && nextChar === '\n') {
                index += 1;
            }

            row.push(cell);
            rowCallback(row);
            row = [];
            cell = '';
        } else {
            cell += currentChar;
        }
    }

    if (cell !== '' || row.length > 0) {
        row.push(cell);
        rowCallback(row);
    }
}

function normalizeCsvRow(row) {
    if (Array.isArray(row)) {
        return row;
    }

    if (row && typeof row.toArray === 'function') {
        return row.toArray();
    }

    return [];
}

function forEachCsvFileRow(file, rowCallback) {
    var fileReader = new FileReader(file, 'UTF-8');
    var csvReader = null;
    var row;

    try {
        csvReader = new CSVStreamReader(fileReader);
        row = csvReader.readNext();

        while (row !== null) {
            rowCallback(normalizeCsvRow(row));
            row = csvReader.readNext();
        }
    } finally {
        closeQuietly(csvReader);
        closeQuietly(fileReader);
    }
}

function parseQuantityValue(value) {
    var normalizedValue = normalizeString(value);
    var quantity = 0;

    if (normalizedValue === '') {
        return null;
    }

    quantity = Number(normalizedValue);

    if (!isFinite(quantity) || quantity <= 0) {
        return null;
    }

    return Math.round(quantity);
}

function getDimensionHeaderCandidates(dimensionName) {
    var normalizedName = normalizeString(dimensionName);
    var candidates = [];

    if (normalizedName === '') {
        return candidates;
    }

    candidates.push(normalizedName);

    if (normalizedName.indexOf('.') !== -1) {
        candidates.push(normalizedName.split('.').pop());
    }

    return candidates.filter(function (candidate, index) {
        return candidates.indexOf(candidate) === index;
    });
}

function findHeaderIndex(header, dimensionName) {
    var candidates = getDimensionHeaderCandidates(dimensionName);
    var candidateIndex = -1;
    var index;

    for (candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
        index = header.indexOf(candidates[candidateIndex]);

        if (index !== -1) {
            return index;
        }
    }

    return -1;
}

function aggregatePurchaseRows(forEachRow, quantityDimension) {
    var header = [];
    var productIndex = -1;
    var quantityIndex = -1;
    var counts = purchaseMetricHelper.createHashMap();
    var processedRows = 0;
    var invalidQuantityRows = 0;
    var blankProductRows = 0;
    var isHeaderRow = true;

    forEachRow(function (row) {
        var productId;
        var quantity;

        if (isHeaderRow) {
            header = row.map(function (cell, index) {
                var value = String(cell || '');

                if (index === 0) {
                    value = value.replace(/^\uFEFF/, '');
                }

                return normalizeString(value);
            });

            productIndex = findHeaderIndex(header, PRODUCT_ID_DIMENSION);
            quantityIndex = findHeaderIndex(header, quantityDimension);
            isHeaderRow = false;

            if (productIndex === -1) {
                throw new Error('The Usage Analytics export is missing required dimension ' + PRODUCT_ID_DIMENSION + '.');
            }

            if (quantityIndex === -1) {
                throw new Error('The Usage Analytics export is missing configured quantity dimension ' + quantityDimension + '.');
            }

            return;
        }

        if (!row.length || (row.length === 1 && normalizeString(row[0]) === '')) {
            return;
        }

        productId = normalizeString(row[productIndex]);

        if (isEmptyValue(productId)) {
            blankProductRows += 1;
            return;
        }

        quantity = parseQuantityValue(row[quantityIndex]);

        if (quantity === null) {
            invalidQuantityRows += 1;
            return;
        }

        purchaseMetricHelper.putMapValue(
            counts,
            productId,
            Number(purchaseMetricHelper.getMapValue(counts, productId) || 0) + quantity
        );
        processedRows += 1;
    });

    if (!header.length) {
        throw new Error('The Usage Analytics export is empty.');
    }

    return {
        header: header,
        counts: counts,
        processedRows: processedRows,
        invalidQuantityRows: invalidQuantityRows,
        blankProductRows: blankProductRows
    };
}

function aggregatePurchaseCounts(csvText, quantityDimension) {
    return aggregatePurchaseRows(function (rowCallback) {
        forEachCsvRow(csvText, rowCallback);
    }, quantityDimension);
}

function aggregatePurchaseCountFile(file, quantityDimension) {
    return aggregatePurchaseRows(function (rowCallback) {
        forEachCsvFileRow(file, rowCallback);
    }, quantityDimension);
}

function buildRequiredProductIds(counts) {
    return {
        contains: function (productId) {
            return purchaseMetricHelper.containsMapKey(counts, productId);
        },
        size: function () {
            return purchaseMetricHelper.getMapSize(counts);
        }
    };
}

function buildProductDocumentRows(exportContext, requiredProductIds, counts) {
    var mapping = purchaseMetricHelper.createHashMap();
    var mappedRows = purchaseMetricHelper.createHashMap();
    var skippedRows = purchaseMetricHelper.createHashMap();
    var products = null;
    var requiredCount = requiredProductIds && typeof requiredProductIds.size === 'function' ? requiredProductIds.size() : 0;
    var resolvedCount = 0;
    var isProductOnly = exportTargetHelper.normalizeCatalogStructureMode(exportContext && exportContext.catalogStructureMode)
        === exportTargetHelper.CATALOG_STRUCTURE_MODE_PRODUCT_ONLY;

    if (requiredCount === 0) {
        return {
            mappedRows: mappedRows,
            skippedRows: skippedRows,
            mappedCount: 0,
            skippedCount: 0
        };
    }

    products = coveoHelper.buildProductQuery(false, exportContext);

    function mapAlias(alias, parentRow, rootProductId) {
        var normalizedAlias = normalizeString(alias);

        if (normalizedAlias === '' || !requiredProductIds.contains(normalizedAlias)) {
            return;
        }

        if (purchaseMetricHelper.containsMapKey(mapping, normalizedAlias)
            && purchaseMetricHelper.getMapValue(mapping, normalizedAlias).documentId !== parentRow.documentId) {
            throw new Error('The purchase enrichment product mapping resolved multiple documentIds for alias ' + normalizedAlias + '.');
        }

        if (!purchaseMetricHelper.containsMapKey(mapping, normalizedAlias)) {
            purchaseMetricHelper.putMapValue(mapping, normalizedAlias, {
                productId: normalizedAlias,
                rootProductId: rootProductId,
                documentId: parentRow.documentId,
                count: Number(purchaseMetricHelper.getMapValue(counts, normalizedAlias) || 0)
            });
            resolvedCount += 1;
        }
    }

    try {
        while (products.hasNext() && resolvedCount < requiredCount) {
            var rootProductId = products.next();
            var exportItems = productRequestGenerator.processProducts(rootProductId, false, exportContext);
            var productRowsByProductId = purchaseMetricHelper.createHashMap();

            exportItems.forEach(function (item) {
                if (!item
                    || item.objecttype !== 'Product'
                    || isEmptyValue(item.ec_product_id)
                    || isEmptyValue(item.documentId)) {
                    return;
                }

                purchaseMetricHelper.putMapValue(productRowsByProductId, item.ec_product_id, {
                    ec_product_id: item.ec_product_id,
                    documentId: item.documentId
                });
                mapAlias(item.ec_product_id, item, rootProductId);
                mapAlias(item.ec_sku, item, rootProductId);

                var lastDashIndex = item.ec_product_id.lastIndexOf('-');

                if (lastDashIndex > 0) {
                    mapAlias(item.ec_product_id.substring(lastDashIndex + 1), item, rootProductId);
                }
            });

            if (isProductOnly) {
                continue;
            }

            exportItems.forEach(function (item) {
                var parentRow = null;

                if (!item
                    || item.objecttype !== 'Variant'
                    || isEmptyValue(item.ec_product_id)
                    || isEmptyValue(item.ec_variant_id)) {
                    return;
                }

                parentRow = purchaseMetricHelper.getMapValue(productRowsByProductId, item.ec_product_id);

                if (!parentRow) {
                    return;
                }

                mapAlias(item.ec_variant_id, parentRow, rootProductId);

                if (!isEmptyValue(item.permanentid)) {
                    mapAlias(item.permanentid, parentRow, rootProductId);
                }
            });
        }
    } finally {
        closeIterator(products);
    }

    purchaseMetricHelper.iterateMap(counts, function (productId, count) {
        if (!purchaseMetricHelper.containsMapKey(mapping, productId)) {
            purchaseMetricHelper.putMapValue(skippedRows, productId, {
                productId: productId,
                count: Number(count || 0),
                reason: 'missing-product-mapping'
            });
            return;
        }

        purchaseMetricHelper.putMapValue(mappedRows, productId, purchaseMetricHelper.getMapValue(mapping, productId));
    });

    return {
        mappedRows: mappedRows,
        skippedRows: skippedRows,
        mappedCount: purchaseMetricHelper.getMapSize(mappedRows),
        skippedCount: purchaseMetricHelper.getMapSize(skippedRows)
    };
}

function syncPurchaseEnrichment(parameters, exportContext) {
    var options = {
        windowDays: purchaseMetricHelper.parsePositiveInteger(parameters.get('windowDays'), 'windowDays', 90),
        workingPath: normalizeString(parameters.get('workingPath')),
        statePath: normalizeString(parameters.get('statePath')),
        quantityDimension: normalizeString(parameters.get('quantityDimension')) || 'custom_events.c_quantity'
    };
    var reusableSnapshot = null;
    var createdExport = null;
    var availableExport = null;
    var downloadedExport = null;
    var aggregated = null;
    var requiredProductIds = null;
    var mappedState = null;
    var snapshot = null;

    if (options.workingPath === '') {
        throw new Error('The Coveo purchase enrichment parameter workingPath is required.');
    }

    if (options.statePath === '') {
        throw new Error('The Coveo purchase enrichment parameter statePath is required.');
    }

    validatePurchaseEnrichmentContext(exportContext);

    reusableSnapshot = purchaseMetricHelper.findReusableSharedSnapshot(
        options.statePath,
        exportContext.coveoTrackingId,
        options.windowDays
    );

    if (!reusableSnapshot) {
        createdExport = createPurchaseExport(exportContext, options);
        availableExport = waitForAvailableExport(exportContext, createdExport);
        downloadedExport = downloadExportFile(resolveExportDownloadLink(exportContext, availableExport), exportContext, options.workingPath);

        try {
            aggregated = aggregatePurchaseCountFile(downloadedExport.csvFile, options.quantityDimension);
        } finally {
            cleanupDownloadedExport(downloadedExport);
            downloadedExport = null;
        }

    }

    purchaseMetricHelper.withPurchaseStateLock(options.statePath, exportContext.coveoTrackingId, function () {
        if (reusableSnapshot) {
            snapshot = purchaseMetricHelper.readSharedSnapshot(options.statePath, exportContext.coveoTrackingId, options.windowDays);
            aggregated = {
                counts: snapshot.counts,
                processedRows: snapshot.processedRows || 0,
                invalidQuantityRows: snapshot.invalidQuantityRows || 0,
                blankProductRows: snapshot.blankProductRows || 0
            };
            availableExport = {
                id: snapshot.exportId || '[reused-snapshot]'
            };
            Logger.info(
                'Reusing recent shared purchase snapshot for trackingId={0}, windowDays={1}, field={2}.',
                exportContext.coveoTrackingId,
                options.windowDays,
                snapshot.fieldName
            );
        } else {
            snapshot = {
                counts: aggregated.counts,
                windowDays: options.windowDays,
                fieldName: purchaseMetricHelper.buildUnitsSoldFieldName(options.windowDays),
                quantityDimension: options.quantityDimension,
                exportId: availableExport.id,
                generatedAt: new Date().toISOString(),
                processedRows: aggregated.processedRows,
                invalidQuantityRows: aggregated.invalidQuantityRows,
                blankProductRows: aggregated.blankProductRows
            };
        }

        requiredProductIds = buildRequiredProductIds(aggregated.counts);
        mappedState = buildProductDocumentRows(exportContext, requiredProductIds, aggregated.counts);

        if (reusableSnapshot) {
            purchaseMetricHelper.writeTargetSnapshotState(options.statePath, exportContext, snapshot, mappedState.mappedRows, mappedState.skippedRows);
        } else {
            snapshot = purchaseMetricHelper.publishSharedSnapshotAndTargetState(
                options.statePath,
                exportContext,
                options.windowDays,
                snapshot,
                mappedState.mappedRows,
                mappedState.skippedRows
            );
            Logger.info(
                'Created shared purchase snapshot for trackingId={0}, windowDays={1}, field={2}, exportId={3}.',
                exportContext.coveoTrackingId,
                options.windowDays,
                snapshot.fieldName,
                availableExport.id
            );
        }
    });

    Logger.info(
        'Coveo purchase enrichment snapshot completed for targetId={0}, trackingId={1}, exportId={2}, field={3}, processedRows={4}, mappedProducts={5}, skippedProducts={6}',
        exportContext.targetId || '[single target]',
        exportContext.coveoTrackingId,
        availableExport.id,
        snapshot.fieldName,
        aggregated.processedRows,
        mappedState.mappedCount,
        mappedState.skippedCount
    );

    return {
        exportId: availableExport.id,
        fieldName: snapshot.fieldName,
        processedRows: aggregated.processedRows,
        invalidQuantityRows: aggregated.invalidQuantityRows,
        blankProductRows: aggregated.blankProductRows,
        mappedProducts: mappedState.mappedCount,
        skippedProducts: mappedState.skippedCount,
        snapshotReused: !!reusableSnapshot
    };
}

module.exports = {
    PRODUCT_ID_DIMENSION: PRODUCT_ID_DIMENSION,
    aggregatePurchaseCounts: aggregatePurchaseCounts,
    aggregatePurchaseCountFile: aggregatePurchaseCountFile,
    buildProductDocumentRows: buildProductDocumentRows,
    buildRequiredProductIds: buildRequiredProductIds,
    createPurchaseExport: createPurchaseExport,
    downloadExportFile: downloadExportFile,
    resolveExportDownloadLink: resolveExportDownloadLink,
    syncPurchaseEnrichment: syncPurchaseEnrichment,
    validatePurchaseEnrichmentContext: validatePurchaseEnrichmentContext,
    waitForAvailableExport: waitForAvailableExport
};
