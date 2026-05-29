'use strict';

var File = require('dw/io/File');
var FileReader = require('dw/io/FileReader');
var FileWriter = require('dw/io/FileWriter');
var HashMap = require('dw/util/HashMap');
var Logger = require('dw/system/Logger').getLogger('Coveo');

var platformFieldService = require('*/cartridge/scripts/services/platformFieldService');

var DEFAULT_STATE_PATH = '/src/coveo/state/purchase-enrichment/';
var SNAPSHOT_REUSE_MAX_AGE_MINUTES = 60;
var FIELD_PREFIX = 'ec_units_sold_';

function normalizeString(value) {
    if (value === null || value === undefined) {
        return '';
    }

    return String(value).trim();
}

function isEmptyValue(value) {
    return value === null
        || value === undefined
        || value === ''
        || (Array.isArray(value) && value.length === 0);
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

function buildUnitsSoldFieldName(windowDays) {
    return FIELD_PREFIX + parseInt(windowDays, 10) + 'd';
}

function getSharedSnapshotMetadataFileName(trackingId, windowDays) {
    return 'coveo_purchase_snapshot_' + sanitizeFileSegment(trackingId) + '_' + parseInt(windowDays, 10) + 'd.json';
}

function getSharedSnapshotCountsFileName(trackingId, windowDays) {
    return 'coveo_purchase_snapshot_' + sanitizeFileSegment(trackingId) + '_' + parseInt(windowDays, 10) + 'd.csv';
}

function getTargetCurrentStateFileName(targetId, windowDays) {
    return 'coveo_purchase_target_current_' + sanitizeFileSegment(targetId) + '_' + parseInt(windowDays, 10) + 'd.csv';
}

function getTargetAppliedStateFileName(targetId, windowDays) {
    return 'coveo_purchase_target_applied_' + sanitizeFileSegment(targetId) + '_' + parseInt(windowDays, 10) + 'd.csv';
}

function getTargetMappedReportFileName(targetId, windowDays) {
    return 'coveo_purchase_target_mapped_' + sanitizeFileSegment(targetId) + '_' + parseInt(windowDays, 10) + 'd.csv';
}

function getTargetSkippedReportFileName(targetId, windowDays) {
    return 'coveo_purchase_target_skipped_' + sanitizeFileSegment(targetId) + '_' + parseInt(windowDays, 10) + 'd.csv';
}

function getTargetSummaryFileName(targetId, windowDays) {
    return 'coveo_purchase_target_summary_' + sanitizeFileSegment(targetId) + '_' + parseInt(windowDays, 10) + 'd.json';
}

function getDirectoryFile(directoryPath) {
    return new File([File.IMPEX, directoryPath].join(File.SEPARATOR));
}

function getFile(directoryPath, fileName) {
    return new File([File.IMPEX, directoryPath, fileName].join(File.SEPARATOR));
}

function writeImpexFile(directoryPath, fileName, contents) {
    var directory = getDirectoryFile(directoryPath);
    var file = getFile(directoryPath, fileName);
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

function readImpexTextFile(directoryPath, fileName) {
    var file = getFile(directoryPath, fileName);
    var reader = null;

    if (!file.exists()) {
        return '';
    }

    reader = new FileReader(file);

    try {
        return reader.getString();
    } finally {
        reader.close();
    }
}

function readImpexJsonFile(directoryPath, fileName) {
    var text = readImpexTextFile(directoryPath, fileName);

    if (text === '') {
        return null;
    }

    return JSON.parse(text);
}

function listDirectoryFiles(directoryPath) {
    var directory = getDirectoryFile(directoryPath);
    var files = directory.listFiles ? directory.listFiles() : null;
    var values = [];
    var index;

    if (!files || !files.length) {
        return values;
    }

    for (index = 0; index < files.length; index += 1) {
        values.push(files[index]);
    }

    return values;
}

function createHashMap() {
    return new HashMap();
}

function putMapValue(map, key, value) {
    if (map && typeof map.put === 'function') {
        map.put(key, value);
        return;
    }

    map[key] = value;
}

function getMapValue(map, key) {
    if (!map) {
        return null;
    }

    if (typeof map.get === 'function') {
        return map.get(key);
    }

    return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
}

function containsMapKey(map, key) {
    if (!map) {
        return false;
    }

    if (typeof map.containsKey === 'function') {
        return map.containsKey(key);
    }

    return Object.prototype.hasOwnProperty.call(map, key);
}

function removeMapKey(map, key) {
    if (!map) {
        return;
    }

    if (typeof map.remove === 'function') {
        map.remove(key);
        return;
    }

    delete map[key];
}

function iterateMap(map, iteratorCallback) {
    var keys = [];
    var entryIterator = null;
    var keyIterator = null;
    var index;

    if (!map) {
        return;
    }

    if (typeof map.entrySet === 'function') {
        entryIterator = map.entrySet().iterator();

        while (entryIterator.hasNext()) {
            var entry = entryIterator.next();
            iteratorCallback(
                entry.getKey ? entry.getKey() : entry.key,
                entry.getValue ? entry.getValue() : entry.value
            );
        }

        return;
    }

    if (typeof map.keySet === 'function') {
        keyIterator = map.keySet().iterator();

        while (keyIterator.hasNext()) {
            var key = keyIterator.next();
            iteratorCallback(key, getMapValue(map, key));
        }

        return;
    }

    keys = Object.keys(map);

    for (index = 0; index < keys.length; index += 1) {
        iteratorCallback(keys[index], map[keys[index]]);
    }
}

function escapeCsvValue(value) {
    var text = String(value === null || value === undefined ? '' : value);

    if (/[",\r\n]/.test(text)) {
        return '"' + text.replace(/"/g, '""') + '"';
    }

    return text;
}

function writeCsvFile(directoryPath, fileName, header, rows) {
    var lines = [];

    if (Array.isArray(header) && header.length) {
        lines.push(header.map(escapeCsvValue).join(','));
    }

    (rows || []).forEach(function (row) {
        lines.push((row || []).map(escapeCsvValue).join(','));
    });

    writeImpexFile(directoryPath, fileName, lines.join('\n') + '\n');
}

function parseCsvRows(csvText) {
    var rows = [];
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
            rows.push(row);
            row = [];
            cell = '';
        } else {
            cell += currentChar;
        }
    }

    if (cell !== '' || row.length > 0) {
        row.push(cell);
        rows.push(row);
    }

    return rows;
}

function mapToSortedRows(map, rowBuilder) {
    var rows = [];

    iterateMap(map, function (key, value) {
        rows.push(rowBuilder(key, value));
    });

    rows.sort(function (left, right) {
        if (left[0] === right[0]) {
            return 0;
        }

        return left[0] < right[0] ? -1 : 1;
    });

    return rows;
}

function parsePositiveInteger(value, label, defaultValue) {
    var normalizedValue = normalizeString(value);
    var parsedValue = defaultValue;

    if (normalizedValue !== '') {
        parsedValue = parseInt(normalizedValue, 10);
    }

    if (isNaN(parsedValue) || parsedValue <= 0) {
        throw new Error('The Coveo purchase enrichment parameter ' + label + ' must be a positive integer.');
    }

    return parsedValue;
}

function parseSnapshotMetadata(directoryPath, fileName) {
    var metadata = readImpexJsonFile(directoryPath, fileName);

    if (!metadata || typeof metadata !== 'object') {
        return null;
    }

    metadata.fileName = fileName;
    return metadata;
}

function readSnapshotCounts(directoryPath, trackingId, windowDays) {
    var fileName = getSharedSnapshotCountsFileName(trackingId, windowDays);
    var csvText = readImpexTextFile(directoryPath, fileName);
    var rows = [];
    var counts = createHashMap();

    if (csvText === '') {
        return counts;
    }

    rows = parseCsvRows(csvText);
    rows.shift();

    rows.forEach(function (row) {
        var productId = normalizeString(row[0]);
        var count = parseInt(normalizeString(row[1]), 10);

        if (productId === '' || isNaN(count)) {
            return;
        }

        putMapValue(counts, productId, count);
    });

    return counts;
}

function readSharedSnapshot(directoryPath, trackingId, windowDays) {
    var metadata = parseSnapshotMetadata(directoryPath, getSharedSnapshotMetadataFileName(trackingId, windowDays));

    if (!metadata) {
        return null;
    }

    metadata.counts = readSnapshotCounts(directoryPath, trackingId, windowDays);
    return metadata;
}

function isSnapshotFresh(snapshot, maxAgeMinutes) {
    var generatedAt = normalizeString(snapshot && snapshot.generatedAt);
    var maxAgeMs = parsePositiveInteger(maxAgeMinutes, 'snapshotMaxAgeMinutes', SNAPSHOT_REUSE_MAX_AGE_MINUTES) * 60 * 1000;

    if (generatedAt === '') {
        return false;
    }

    return (new Date().getTime() - new Date(generatedAt).getTime()) <= maxAgeMs;
}

function findReusableSharedSnapshot(directoryPath, trackingId, windowDays, maxAgeMinutes) {
    var snapshot = readSharedSnapshot(directoryPath, trackingId, windowDays);

    if (!snapshot || !isSnapshotFresh(snapshot, maxAgeMinutes || SNAPSHOT_REUSE_MAX_AGE_MINUTES)) {
        return null;
    }

    return snapshot;
}

function writeSharedSnapshot(directoryPath, trackingId, windowDays, snapshot) {
    var fieldName = buildUnitsSoldFieldName(windowDays);
    var metadata = {
        trackingId: trackingId,
        windowDays: parseInt(windowDays, 10),
        fieldName: fieldName,
        quantityDimension: snapshot.quantityDimension,
        exportId: snapshot.exportId,
        generatedAt: snapshot.generatedAt || new Date().toISOString(),
        processedRows: snapshot.processedRows || 0,
        invalidQuantityRows: snapshot.invalidQuantityRows || 0,
        blankProductRows: snapshot.blankProductRows || 0,
        countFile: getSharedSnapshotCountsFileName(trackingId, windowDays)
    };

    writeImpexFile(
        directoryPath,
        getSharedSnapshotMetadataFileName(trackingId, windowDays),
        JSON.stringify(metadata, null, 2) + '\n'
    );
    writeCsvFile(
        directoryPath,
        getSharedSnapshotCountsFileName(trackingId, windowDays),
        ['productId', 'unitsSold'],
        mapToSortedRows(snapshot.counts, function (productId, count) {
            return [productId, count];
        })
    );

    metadata.counts = snapshot.counts;
    return metadata;
}

function loadSnapshotsForTrackingId(exportContext, directoryPath) {
    var trackingId = normalizeString(exportContext && exportContext.coveoTrackingId);
    var snapshots = [];

    listDirectoryFiles(directoryPath || DEFAULT_STATE_PATH).forEach(function (file) {
        var name = normalizeString(file && (file.getName ? file.getName() : file.name));
        var metadata = null;

        if (!/\.json$/i.test(name) || name.indexOf('coveo_purchase_snapshot_') !== 0) {
            return;
        }

        metadata = parseSnapshotMetadata(directoryPath || DEFAULT_STATE_PATH, name);

        if (!metadata || normalizeString(metadata.trackingId) !== trackingId) {
            return;
        }

        metadata.counts = readSnapshotCounts(directoryPath || DEFAULT_STATE_PATH, trackingId, metadata.windowDays);
        snapshots.push(metadata);
    });

    snapshots.sort(function (left, right) {
        return Number(left.windowDays) - Number(right.windowDays);
    });

    return snapshots;
}

function ensureMetricFields(exportContext, snapshots) {
    var fields = [];

    (snapshots || []).forEach(function (snapshot) {
        var fieldName = normalizeString(snapshot && snapshot.fieldName);

        if (fieldName === '') {
            return;
        }

        fields.push({
            name: fieldName,
            description: 'Units sold over the last ' + snapshot.windowDays + ' days.',
            type: 'LONG_64',
            includeInQuery: true,
            includeInResults: true,
            sort: true,
            useCacheForSort: true
        });
    });

    if (!fields.length) {
        return;
    }

    platformFieldService.createFields(fields, exportContext);
}

function attachSnapshotsToExportContext(exportContext, directoryPath) {
    exportContext.purchaseMetrics = loadSnapshotsForTrackingId(exportContext, directoryPath || DEFAULT_STATE_PATH).map(function (snapshot) {
        snapshot.currentRows = readCurrentTargetRows(directoryPath || DEFAULT_STATE_PATH, exportContext, snapshot);
        snapshot.documentCounts = buildDocumentCounts(snapshot.currentRows);
        return snapshot;
    });

    return exportContext.purchaseMetrics;
}

function sumCountsForAliases(snapshot, aliases) {
    var uniqueAliases = {};
    var total = 0;

    (aliases || []).forEach(function (alias) {
        var normalizedAlias = normalizeString(alias);

        if (normalizedAlias === '' || uniqueAliases[normalizedAlias]) {
            return;
        }

        uniqueAliases[normalizedAlias] = true;

        if (containsMapKey(snapshot.counts, normalizedAlias)) {
            total += Number(getMapValue(snapshot.counts, normalizedAlias) || 0);
        }
    });

    return total;
}

function buildDocumentCounts(rows) {
    var documentCounts = createHashMap();

    (rows || []).forEach(function (row) {
        var documentId = normalizeString(row && row.documentId);

        if (documentId === '') {
            return;
        }

        putMapValue(
            documentCounts,
            documentId,
            Number(getMapValue(documentCounts, documentId) || 0) + Number(row.count || 0)
        );
    });

    return documentCounts;
}

function applyPurchaseMetrics(document, metricContext, exportContext) {
    var snapshots = exportContext && exportContext.purchaseMetrics ? exportContext.purchaseMetrics : [];
    var context = typeof metricContext === 'string'
        ? {
            aliases: [metricContext]
        }
        : (metricContext || {});
    var aliases = Array.isArray(context.aliases) ? context.aliases : [];
    var documentId = normalizeString(context.documentId);
    var objecttype = normalizeString(context.objecttype);

    snapshots.forEach(function (snapshot) {
        if (objecttype === 'Product' && documentId !== '' && containsMapKey(snapshot.documentCounts, documentId)) {
            document[snapshot.fieldName] = Number(getMapValue(snapshot.documentCounts, documentId) || 0);
            return;
        }

        document[snapshot.fieldName] = sumCountsForAliases(snapshot, aliases);
    });
}

function buildCurrentStateRows(mappedRows) {
    return (mappedRows || []).map(function (row) {
        return [row.productId, row.rootProductId, row.documentId, row.count];
    }).sort(function (left, right) {
        return left[0] < right[0] ? -1 : (left[0] > right[0] ? 1 : 0);
    });
}

function writeTargetSnapshotState(directoryPath, exportContext, snapshot, mappedRows, skippedRows) {
    var targetId = exportContext.targetId || exportContext.locale || exportContext.coveoTrackingId;
    var windowDays = snapshot.windowDays;
    var summary = {
        targetId: targetId,
        trackingId: exportContext.coveoTrackingId,
        locale: exportContext.locale,
        windowDays: windowDays,
        fieldName: snapshot.fieldName,
        exportId: snapshot.exportId,
        generatedAt: snapshot.generatedAt,
        mappedProducts: (mappedRows || []).length,
        skippedProducts: (skippedRows || []).length
    };

    writeCsvFile(
        directoryPath,
        getTargetCurrentStateFileName(targetId, windowDays),
        ['productId', 'rootProductId', 'documentId', 'unitsSold'],
        buildCurrentStateRows(mappedRows)
    );
    writeCsvFile(
        directoryPath,
        getTargetMappedReportFileName(targetId, windowDays),
        ['productId', 'rootProductId', 'documentId', 'unitsSold'],
        buildCurrentStateRows(mappedRows)
    );
    writeCsvFile(
        directoryPath,
        getTargetSkippedReportFileName(targetId, windowDays),
        ['productId', 'unitsSold', 'reason'],
        (skippedRows || []).map(function (row) {
            return [row.productId, row.count, row.reason || 'missing-product-mapping'];
        }).sort(function (left, right) {
            return left[0] < right[0] ? -1 : (left[0] > right[0] ? 1 : 0);
        })
    );
    writeImpexFile(
        directoryPath,
        getTargetSummaryFileName(targetId, windowDays),
        JSON.stringify(summary, null, 2) + '\n'
    );
}

function readTargetStateRows(directoryPath, fileName) {
    var csvText = readImpexTextFile(directoryPath, fileName);
    var rows = [];

    if (csvText === '') {
        return rows;
    }

    rows = parseCsvRows(csvText);
    rows.shift();

    return rows.filter(function (row) {
        return normalizeString(row[0]) !== '';
    }).map(function (row) {
        return {
            productId: normalizeString(row[0]),
            rootProductId: normalizeString(row[1]),
            documentId: normalizeString(row[2]),
            count: parseInt(normalizeString(row[3]), 10) || 0
        };
    });
}

function readCurrentTargetRows(directoryPath, exportContext, snapshot) {
    return readTargetStateRows(
        directoryPath,
        getTargetCurrentStateFileName(exportContext.targetId || exportContext.locale || exportContext.coveoTrackingId, snapshot.windowDays)
    );
}

function readAppliedTargetRows(directoryPath, exportContext, snapshot) {
    return readTargetStateRows(
        directoryPath,
        getTargetAppliedStateFileName(exportContext.targetId || exportContext.locale || exportContext.coveoTrackingId, snapshot.windowDays)
    );
}

function writeAppliedTargetRows(directoryPath, exportContext, snapshot, rows) {
    writeCsvFile(
        directoryPath,
        getTargetAppliedStateFileName(exportContext.targetId || exportContext.locale || exportContext.coveoTrackingId, snapshot.windowDays),
        ['productId', 'rootProductId', 'documentId', 'unitsSold'],
        buildCurrentStateRows((rows || []).map(function (row) {
            return {
                productId: row.productId,
                rootProductId: row.rootProductId,
                documentId: row.documentId,
                count: row.count
            };
        }))
    );
}

function buildRowMap(rows) {
    var map = createHashMap();

    (rows || []).forEach(function (row) {
        putMapValue(map, row.productId, row);
    });

    return map;
}

function buildLookupSet(values) {
    var map = createHashMap();

    (values || []).forEach(function (value) {
        putMapValue(map, value, true);
    });

    return map;
}

function getSnapshotDrivenRootIds(exportContext, snapshots, directoryPath) {
    var changedRootIds = createHashMap();

    (snapshots || []).forEach(function (snapshot) {
        var currentRows = readCurrentTargetRows(directoryPath || DEFAULT_STATE_PATH, exportContext, snapshot);
        var currentMap = buildRowMap(currentRows);
        var appliedRows = readAppliedTargetRows(directoryPath || DEFAULT_STATE_PATH, exportContext, snapshot);
        var appliedMap = buildRowMap(appliedRows);

        currentRows.forEach(function (row) {
            var previousRow = getMapValue(appliedMap, row.productId);

            if (!previousRow
                || previousRow.count !== row.count
                || previousRow.rootProductId !== row.rootProductId
                || previousRow.documentId !== row.documentId) {
                putMapValue(changedRootIds, row.rootProductId, true);
            }
        });

        appliedRows.forEach(function (row) {
            if (!containsMapKey(currentMap, row.productId)) {
                putMapValue(changedRootIds, row.rootProductId, true);
            }
        });
    });

    return mapToSortedRows(changedRootIds, function (key) {
        return [key];
    }).map(function (row) {
        return row[0];
    });
}

function markFullExportApplied(exportContext, snapshots, directoryPath) {
    (snapshots || []).forEach(function (snapshot) {
        writeAppliedTargetRows(
            directoryPath || DEFAULT_STATE_PATH,
            exportContext,
            snapshot,
            readCurrentTargetRows(directoryPath || DEFAULT_STATE_PATH, exportContext, snapshot)
        );
    });
}

function markDeltaExportApplied(exportContext, snapshots, directoryPath, exportedRootIds) {
    var exportedRootLookup = buildLookupSet(exportedRootIds || []);

    (snapshots || []).forEach(function (snapshot) {
        var currentRows = readCurrentTargetRows(directoryPath || DEFAULT_STATE_PATH, exportContext, snapshot);
        var currentMap = buildRowMap(currentRows);
        var appliedRows = readAppliedTargetRows(directoryPath || DEFAULT_STATE_PATH, exportContext, snapshot);
        var nextAppliedMap = buildRowMap(appliedRows);

        currentRows.forEach(function (row) {
            if (containsMapKey(exportedRootLookup, row.rootProductId)) {
                putMapValue(nextAppliedMap, row.productId, row);
            }
        });

        appliedRows.forEach(function (row) {
            if (containsMapKey(exportedRootLookup, row.rootProductId) && !containsMapKey(currentMap, row.productId)) {
                removeMapKey(nextAppliedMap, row.productId);
            }
        });

        writeAppliedTargetRows(
            directoryPath || DEFAULT_STATE_PATH,
            exportContext,
            snapshot,
            mapToSortedRows(nextAppliedMap, function (productId, row) {
                return [productId, row.rootProductId, row.documentId, row.count];
            }).map(function (row) {
                return {
                    productId: row[0],
                    rootProductId: row[1],
                    documentId: row[2],
                    count: row[3]
                };
            })
        );
    });
}

module.exports = {
    DEFAULT_STATE_PATH: DEFAULT_STATE_PATH,
    SNAPSHOT_REUSE_MAX_AGE_MINUTES: SNAPSHOT_REUSE_MAX_AGE_MINUTES,
    applyPurchaseMetrics: applyPurchaseMetrics,
    attachSnapshotsToExportContext: attachSnapshotsToExportContext,
    buildUnitsSoldFieldName: buildUnitsSoldFieldName,
    createHashMap: createHashMap,
    containsMapKey: containsMapKey,
    findReusableSharedSnapshot: findReusableSharedSnapshot,
    getMapValue: getMapValue,
    getSnapshotDrivenRootIds: getSnapshotDrivenRootIds,
    iterateMap: iterateMap,
    markDeltaExportApplied: markDeltaExportApplied,
    markFullExportApplied: markFullExportApplied,
    normalizeString: normalizeString,
    parsePositiveInteger: parsePositiveInteger,
    putMapValue: putMapValue,
    readSharedSnapshot: readSharedSnapshot,
    sumCountsForAliases: sumCountsForAliases,
    writeSharedSnapshot: writeSharedSnapshot,
    writeTargetSnapshotState: writeTargetSnapshotState,
    ensureMetricFields: ensureMetricFields
};
