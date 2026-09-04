'use strict';

var File = require('dw/io/File');
var FileReader = require('dw/io/FileReader');
var FileWriter = require('dw/io/FileWriter');
var CSVStreamReader = require('dw/io/CSVStreamReader');
var HashMap = require('dw/util/HashMap');
var UUIDUtils = require('dw/util/UUIDUtils');
var Logger = require('dw/system/Logger').getLogger('Coveo');

var platformFieldService = require('*/cartridge/scripts/services/platformFieldService');

var DEFAULT_STATE_PATH = '/src/coveo/state/purchase-enrichment/';
var SNAPSHOT_REUSE_MAX_AGE_MINUTES = 60;
var FIELD_PREFIX = 'ec_units_sold_';
var MAP_SHARD_COUNT = 64;
var SHARDED_MAP_MARKER = '__coveoPurchaseShardedMap';
var SNAPSHOT_SCHEMA_VERSION = 2;
var activeStateLocks = {};

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

function getSharedSnapshotGenerationCountsFileName(trackingId, windowDays, generation) {
    return 'coveo_purchase_snapshot_'
        + sanitizeFileSegment(trackingId)
        + '_'
        + parseInt(windowDays, 10)
        + 'd_'
        + sanitizeFileSegment(generation)
        + '.csv';
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

function getStateLockFileName(trackingId) {
    return 'coveo_purchase_state_' + sanitizeFileSegment(trackingId) + '.lock';
}

function closeQuietly(closeable) {
    if (closeable && typeof closeable.close === 'function') {
        try {
            closeable.close();
        } catch (error) {
            // Preserve the primary operation result.
        }
    }
}

function withPurchaseStateLock(directoryPath, trackingId, callback) {
    var lockKey = normalizeString(directoryPath) + '\u0000' + normalizeString(trackingId);
    var activeLock = activeStateLocks[lockKey];
    var lockFile;
    var lockToken;
    var writer;
    var lockWriteError = null;

    if (activeLock) {
        activeLock.depth += 1;

        try {
            return callback();
        } finally {
            activeLock.depth -= 1;
        }
    }

    lockFile = getFile(directoryPath, getStateLockFileName(trackingId));
    getDirectoryFile(directoryPath).mkdirs();

    if (lockFile.exists()
        || (typeof lockFile.createNewFile === 'function' && !lockFile.createNewFile())) {
        throw new Error('A Coveo purchase enrichment state operation is already running for trackingId ' + trackingId + '.');
    }

    try {
        lockToken = UUIDUtils.createUUID().toString();
        writer = new FileWriter(lockFile, 'UTF-8');
        writer.write(lockToken + '\n');
        writer.flush();
    } catch (error) {
        lockWriteError = error;
    } finally {
        closeQuietly(writer);
    }

    if (lockWriteError) {
        if (lockFile.exists() && !lockFile.remove()) {
            throw new Error('Unable to remove the incomplete Coveo purchase enrichment state lock for trackingId ' + trackingId + '. ' + lockWriteError.message);
        }

        throw lockWriteError;
    }

    activeStateLocks[lockKey] = {
        depth: 1,
        token: lockToken
    };

    try {
        return callback();
    } finally {
        delete activeStateLocks[lockKey];

        if (lockFile.exists()
            && normalizeString(readImpexTextFile(directoryPath, getStateLockFileName(trackingId))) === lockToken
            && !lockFile.remove()) {
            throw new Error('Unable to release the Coveo purchase enrichment state lock for trackingId ' + trackingId + '.');
        }
    }
}

function writeFileAtomically(directoryPath, fileName, writeCallback) {
    var directory = getDirectoryFile(directoryPath);
    var file = getFile(directoryPath, fileName);
    var temporaryFile = getFile(directoryPath, fileName + '.tmp');
    var backupFile = getFile(directoryPath, fileName + '.bak');
    var writer = null;
    var writeError = null;

    directory.mkdirs();

    if (temporaryFile.exists()) {
        if (!temporaryFile.remove()) {
            throw new Error('Unable to remove stale purchase enrichment temporary file ' + temporaryFile.fullPath + '.');
        }
    }

    try {
        writer = new FileWriter(temporaryFile, 'UTF-8');
        writeCallback(writer);
        writer.flush();
    } catch (error) {
        writeError = error;
    } finally {
        closeQuietly(writer);
    }

    if (writeError) {
        if (temporaryFile.exists() && !temporaryFile.remove()) {
            throw new Error('Unable to remove failed purchase enrichment temporary file ' + temporaryFile.fullPath + '. ' + writeError.message);
        }

        throw writeError;
    }

    if (backupFile.exists()) {
        if (!backupFile.remove()) {
            temporaryFile.remove();
            throw new Error('Unable to remove stale purchase enrichment backup file ' + backupFile.fullPath + '.');
        }
    }

    if (file.exists() && !file.renameTo(backupFile)) {
        temporaryFile.remove();
        throw new Error('Unable to preserve the previous purchase enrichment state file ' + file.fullPath + '.');
    }

    if (!temporaryFile.renameTo(file)) {
        temporaryFile.remove();

        if (backupFile.exists() && !backupFile.renameTo(file)) {
            throw new Error('Unable to promote or restore purchase enrichment state file ' + file.fullPath + '.');
        }

        throw new Error('Unable to promote purchase enrichment state file ' + file.fullPath + '.');
    }

    if (backupFile.exists()) {
        if (!backupFile.remove()) {
            Logger.warn('Unable to remove purchase enrichment backup file {0} after successful state promotion.', backupFile.fullPath);
        }
    }

    return file;
}

function writeImpexFile(directoryPath, fileName, contents) {
    return writeFileAtomically(directoryPath, fileName, function (writer) {
        writer.write(String(contents || ''));
    });
}

function readImpexTextFile(directoryPath, fileName) {
    var file = getFile(directoryPath, fileName);
    var reader = null;

    if (!file.exists()) {
        return '';
    }

    try {
        reader = new FileReader(file);
        return reader.getString();
    } finally {
        closeQuietly(reader);
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
    return {
        __coveoPurchaseShardedMap: true,
        shards: {},
        size: 0
    };
}

function isShardedMap(map) {
    return !!(map && map[SHARDED_MAP_MARKER] === true);
}

function hashString(value) {
    var text = normalizeString(value);
    var hash = 0;
    var index;

    for (index = 0; index < text.length; index += 1) {
        hash = ((hash << 5) - hash) + text.charCodeAt(index);
        hash |= 0;
    }

    return hash;
}

function getMapShardIndex(key) {
    return Math.abs(hashString(key)) % MAP_SHARD_COUNT;
}

function getMapShard(map, key, createIfMissing) {
    var shardIndex = getMapShardIndex(key);
    var shard = map.shards[shardIndex];

    if (!shard && createIfMissing) {
        shard = new HashMap();
        map.shards[shardIndex] = shard;
    }

    return shard;
}

function nativeMapContains(map, key) {
    if (!map) {
        return false;
    }

    if (typeof map.containsKey === 'function') {
        return map.containsKey(key);
    }

    return Object.prototype.hasOwnProperty.call(map, key);
}

function nativeMapGet(map, key) {
    if (!map) {
        return null;
    }

    if (typeof map.get === 'function') {
        return map.get(key);
    }

    return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
}

function putMapValue(map, key, value) {
    if (isShardedMap(map)) {
        var shard = getMapShard(map, key, true);

        if (!nativeMapContains(shard, key)) {
            map.size += 1;
        }

        if (typeof shard.put === 'function') {
            shard.put(key, value);
        } else {
            shard[key] = value;
        }
        return;
    }

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

    if (isShardedMap(map)) {
        return nativeMapGet(getMapShard(map, key, false), key);
    }

    return nativeMapGet(map, key);
}

function containsMapKey(map, key) {
    if (!map) {
        return false;
    }

    if (isShardedMap(map)) {
        return nativeMapContains(getMapShard(map, key, false), key);
    }

    return nativeMapContains(map, key);
}

function removeMapKey(map, key) {
    if (!map) {
        return;
    }

    if (isShardedMap(map)) {
        var shard = getMapShard(map, key, false);

        if (!nativeMapContains(shard, key)) {
            return;
        }

        if (typeof shard.remove === 'function') {
            shard.remove(key);
        } else {
            delete shard[key];
        }
        map.size -= 1;
        return;
    }

    if (typeof map.remove === 'function') {
        map.remove(key);
        return;
    }

    delete map[key];
}

function iterateNativeMap(map, iteratorCallback) {
    var keys = [];
    var entryIterator = null;
    var keyIterator = null;
    var index;

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

function iterateMap(map, iteratorCallback) {
    var shardIndex;

    if (!map) {
        return;
    }

    if (isShardedMap(map)) {
        for (shardIndex = 0; shardIndex < MAP_SHARD_COUNT; shardIndex += 1) {
            if (map.shards[shardIndex]) {
                iterateNativeMap(map.shards[shardIndex], iteratorCallback);
            }
        }
        return;
    }

    iterateNativeMap(map, iteratorCallback);
}

function getMapSize(map) {
    var size = 0;

    if (!map) {
        return 0;
    }

    if (isShardedMap(map)) {
        return map.size;
    }

    if (typeof map.size === 'function') {
        return map.size();
    }

    iterateMap(map, function () {
        size += 1;
    });
    return size;
}

function iterateMapSorted(map, iteratorCallback) {
    var shardIndex;

    if (!isShardedMap(map)) {
        var entries = [];
        iterateMap(map, function (key, value) {
            entries.push([key, value]);
        });
        entries.sort(function (left, right) {
            return left[0] < right[0] ? -1 : (left[0] > right[0] ? 1 : 0);
        });
        entries.forEach(function (entry) {
            iteratorCallback(entry[0], entry[1]);
        });
        return;
    }

    for (shardIndex = 0; shardIndex < MAP_SHARD_COUNT; shardIndex += 1) {
        var shardEntries = [];

        if (!map.shards[shardIndex]) {
            continue;
        }

        iterateNativeMap(map.shards[shardIndex], function (key, value) {
            shardEntries.push([key, value]);
        });
        shardEntries.sort(function (left, right) {
            return left[0] < right[0] ? -1 : (left[0] > right[0] ? 1 : 0);
        });
        shardEntries.forEach(function (entry) {
            iteratorCallback(entry[0], entry[1]);
        });
    }
}

function createMapKeyIterator(map) {
    var shardIndex = 0;
    var currentIterator = null;
    var nextValue = null;
    var hasBufferedValue = false;

    function getShardIterator(shard) {
        if (typeof shard.entrySet === 'function') {
            var entryIterator = shard.entrySet().iterator();
            return {
                hasNext: function () {
                    return entryIterator.hasNext();
                },
                next: function () {
                    var entry = entryIterator.next();
                    return entry.getKey ? entry.getKey() : entry.key;
                }
            };
        }

        var keys = Object.keys(shard);
        var index = 0;
        return {
            hasNext: function () {
                return index < keys.length;
            },
            next: function () {
                return keys[index++];
            }
        };
    }

    function bufferNextValue() {
        if (hasBufferedValue) {
            return true;
        }

        while (isShardedMap(map) && shardIndex < MAP_SHARD_COUNT) {
            if (!currentIterator) {
                if (!map.shards[shardIndex]) {
                    shardIndex += 1;
                    continue;
                }

                currentIterator = getShardIterator(map.shards[shardIndex]);
            }

            if (currentIterator.hasNext()) {
                nextValue = currentIterator.next();
                hasBufferedValue = true;
                return true;
            }

            currentIterator = null;
            shardIndex += 1;
        }

        if (!isShardedMap(map) && !currentIterator) {
            currentIterator = getShardIterator(map || {});
        }

        if (!isShardedMap(map) && currentIterator.hasNext()) {
            nextValue = currentIterator.next();
            hasBufferedValue = true;
            return true;
        }

        return false;
    }

    return {
        hasNext: function () {
            return bufferNextValue();
        },
        next: function () {
            if (!bufferNextValue()) {
                return null;
            }

            var value = nextValue;
            nextValue = null;
            hasBufferedValue = false;
            return value;
        },
        close: function () {}
    };
}

function escapeCsvValue(value) {
    var text = String(value === null || value === undefined ? '' : value);

    if (/[",\r\n]/.test(text)) {
        return '"' + text.replace(/"/g, '""') + '"';
    }

    return text;
}

function writeCsvMapFile(directoryPath, fileName, header, map, rowBuilder) {
    return writeFileAtomically(directoryPath, fileName, function (writer) {
        if (Array.isArray(header) && header.length) {
            writer.write(header.map(escapeCsvValue).join(',') + '\n');
        }

        iterateMapSorted(map, function (key, value) {
            writer.write(rowBuilder(key, value).map(escapeCsvValue).join(',') + '\n');
        });
    });
}

function normalizeCsvRow(row) {
    var normalizedRow = [];
    var rowLength;
    var index;

    if (Array.isArray(row)) {
        return row;
    }

    if (!row) {
        return normalizedRow;
    }

    rowLength = Number(row.length);

    if (!isFinite(rowLength) || rowLength < 0) {
        return normalizedRow;
    }

    for (index = 0; index < rowLength; index += 1) {
        normalizedRow.push(row[index]);
    }

    return normalizedRow;
}

function forEachCsvFileRow(file, rowCallback) {
    var fileReader;
    var csvReader;
    var row;

    if (!file.exists()) {
        return false;
    }

    fileReader = new FileReader(file, 'UTF-8');
    csvReader = null;

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

    return true;
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

function readSnapshotCounts(directoryPath, trackingId, windowDays, countFileName) {
    var fileName = normalizeString(countFileName) || getSharedSnapshotCountsFileName(trackingId, windowDays);
    var file = getFile(directoryPath, fileName);
    var counts = createHashMap();
    var isHeaderRow = true;

    if (!file.exists()) {
        throw new Error('The purchase enrichment snapshot count file ' + file.fullPath + ' is missing. Run the purchase enrichment sync again.');
    }

    forEachCsvFileRow(file, function (row) {
        var productId = normalizeString(row[0]);
        var count = parseInt(normalizeString(row[1]), 10);

        if (isHeaderRow) {
            isHeaderRow = false;
            return;
        }

        if (productId === '' || isNaN(count)) {
            return;
        }

        putMapValue(counts, productId, count);
    });

    return counts;
}

function readSharedSnapshotUnlocked(directoryPath, trackingId, windowDays) {
    var metadata = parseSnapshotMetadata(directoryPath, getSharedSnapshotMetadataFileName(trackingId, windowDays));

    if (!metadata) {
        return null;
    }

    metadata.counts = readSnapshotCounts(directoryPath, trackingId, windowDays, metadata.countFile);
    return metadata;
}

function readSharedSnapshot(directoryPath, trackingId, windowDays) {
    return withPurchaseStateLock(directoryPath, trackingId, function () {
        return readSharedSnapshotUnlocked(directoryPath, trackingId, windowDays);
    });
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
    var snapshot = null;

    try {
        snapshot = readSharedSnapshot(directoryPath, trackingId, windowDays);
    } catch (error) {
        Logger.warn(
            'Ignoring incomplete purchase enrichment snapshot for trackingId={0}, windowDays={1}. {2}',
            trackingId,
            windowDays,
            error.message || error
        );
        return null;
    }

    if (!snapshot || !isSnapshotFresh(snapshot, maxAgeMinutes || SNAPSHOT_REUSE_MAX_AGE_MINUTES)) {
        return null;
    }

    return snapshot;
}

function writeSharedSnapshotUnlocked(directoryPath, trackingId, windowDays, snapshot, options) {
    var fieldName = buildUnitsSoldFieldName(windowDays);
    var generatedAt = snapshot.generatedAt || new Date().toISOString();
    var previousMetadata = parseSnapshotMetadata(directoryPath, getSharedSnapshotMetadataFileName(trackingId, windowDays));
    var countFileName = getSharedSnapshotGenerationCountsFileName(
        trackingId,
        windowDays,
        buildTimestampSegment() + '_' + normalizeString(snapshot.exportId)
    );
    var metadata = {
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        trackingId: trackingId,
        windowDays: parseInt(windowDays, 10),
        fieldName: fieldName,
        quantityDimension: snapshot.quantityDimension,
        exportId: snapshot.exportId,
        generatedAt: generatedAt,
        processedRows: snapshot.processedRows || 0,
        invalidQuantityRows: snapshot.invalidQuantityRows || 0,
        blankProductRows: snapshot.blankProductRows || 0,
        countFile: countFileName
    };

    writeCsvMapFile(
        directoryPath,
        countFileName,
        ['productId', 'unitsSold'],
        snapshot.counts,
        function (productId, count) {
            return [productId, count];
        }
    );

    try {
        writeImpexFile(
            directoryPath,
            getSharedSnapshotMetadataFileName(trackingId, windowDays),
            JSON.stringify(metadata, null, 2) + '\n'
        );
    } catch (error) {
        var failedCountFile = getFile(directoryPath, countFileName);

        if (failedCountFile.exists()) {
            failedCountFile.remove();
        }

        throw error;
    }

    if (!(options && options.preservePreviousCount)
        && previousMetadata
        && normalizeString(previousMetadata.countFile) !== ''
        && previousMetadata.countFile !== countFileName) {
        var previousCountFile = getFile(directoryPath, previousMetadata.countFile);

        if (previousCountFile.exists()) {
            previousCountFile.remove();
        }
    }

    metadata.counts = snapshot.counts;
    return metadata;
}

function writeSharedSnapshot(directoryPath, trackingId, windowDays, snapshot) {
    return withPurchaseStateLock(directoryPath, trackingId, function () {
        return writeSharedSnapshotUnlocked(directoryPath, trackingId, windowDays, snapshot);
    });
}

function loadSnapshotsForTrackingIdUnlocked(exportContext, directoryPath) {
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

        metadata.counts = readSnapshotCounts(
            directoryPath || DEFAULT_STATE_PATH,
            trackingId,
            metadata.windowDays,
            metadata.countFile
        );
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
    var resolvedDirectoryPath = directoryPath || DEFAULT_STATE_PATH;

    return withPurchaseStateLock(resolvedDirectoryPath, exportContext.coveoTrackingId, function () {
        exportContext.purchaseMetrics = loadSnapshotsForTrackingIdUnlocked(exportContext, resolvedDirectoryPath).map(function (snapshot) {
            snapshot.currentRows = readCurrentTargetRows(resolvedDirectoryPath, exportContext, snapshot);
            snapshot.appliedRows = readAppliedTargetRows(resolvedDirectoryPath, exportContext, snapshot);
            snapshot.documentCounts = buildDocumentCounts(snapshot.currentRows);
            return snapshot;
        });

        return exportContext.purchaseMetrics;
    });
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

    iterateMap(rows, function (productId, row) { // eslint-disable-line no-unused-vars
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

function writeTargetSnapshotStateUnlocked(directoryPath, exportContext, snapshot, mappedRows, skippedRows) {
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
        mappedProducts: getMapSize(mappedRows),
        skippedProducts: getMapSize(skippedRows)
    };

    writeCsvMapFile(
        directoryPath,
        getTargetMappedReportFileName(targetId, windowDays),
        ['productId', 'rootProductId', 'documentId', 'unitsSold'],
        mappedRows,
        function (productId, row) {
            return [productId, row.rootProductId, row.documentId, row.count];
        }
    );
    writeCsvMapFile(
        directoryPath,
        getTargetSkippedReportFileName(targetId, windowDays),
        ['productId', 'unitsSold', 'reason'],
        skippedRows,
        function (productId, row) {
            return [productId, row.count, row.reason || 'missing-product-mapping'];
        }
    );
    writeImpexFile(
        directoryPath,
        getTargetSummaryFileName(targetId, windowDays),
        JSON.stringify(summary, null, 2) + '\n'
    );
    writeCsvMapFile(
        directoryPath,
        getTargetCurrentStateFileName(targetId, windowDays),
        ['productId', 'rootProductId', 'documentId', 'unitsSold'],
        mappedRows,
        function (productId, row) {
            return [productId, row.rootProductId, row.documentId, row.count];
        }
    );
}

function writeTargetSnapshotState(directoryPath, exportContext, snapshot, mappedRows, skippedRows) {
    return withPurchaseStateLock(directoryPath, exportContext.coveoTrackingId, function () {
        return writeTargetSnapshotStateUnlocked(directoryPath, exportContext, snapshot, mappedRows, skippedRows);
    });
}

function publishSharedSnapshotAndTargetState(directoryPath, exportContext, windowDays, snapshot, mappedRows, skippedRows) {
    return withPurchaseStateLock(directoryPath, exportContext.coveoTrackingId, function () {
        var metadataFileName = getSharedSnapshotMetadataFileName(exportContext.coveoTrackingId, windowDays);
        var metadataFile = getFile(directoryPath, metadataFileName);
        var previousMetadataText = metadataFile.exists() ? readImpexTextFile(directoryPath, metadataFileName) : null;
        var previousMetadata = previousMetadataText === null ? null : parseSnapshotMetadata(directoryPath, metadataFileName);
        var publishedSnapshot = writeSharedSnapshotUnlocked(
            directoryPath,
            exportContext.coveoTrackingId,
            windowDays,
            snapshot,
            {
                preservePreviousCount: true
            }
        );

        try {
            writeTargetSnapshotStateUnlocked(directoryPath, exportContext, publishedSnapshot, mappedRows, skippedRows);
        } catch (error) {
            if (previousMetadataText === null) {
                if (metadataFile.exists() && !metadataFile.remove()) {
                    throw new Error('Unable to roll back the new purchase enrichment snapshot metadata after target-state publication failed. ' + error.message);
                }
            } else {
                writeImpexFile(directoryPath, metadataFileName, previousMetadataText);
            }

            var failedCountFile = getFile(directoryPath, publishedSnapshot.countFile);

            if (failedCountFile.exists() && !failedCountFile.remove()) {
                throw new Error('Unable to remove the rolled-back purchase enrichment snapshot count file. ' + error.message);
            }

            throw error;
        }

        if (previousMetadata
            && normalizeString(previousMetadata.countFile) !== ''
            && previousMetadata.countFile !== publishedSnapshot.countFile) {
            var previousCountFile = getFile(directoryPath, previousMetadata.countFile);

            if (previousCountFile.exists() && !previousCountFile.remove()) {
                Logger.warn('Unable to remove replaced purchase enrichment count file {0}.', previousCountFile.fullPath);
            }
        }

        return publishedSnapshot;
    });
}

function readTargetStateRows(directoryPath, fileName) {
    var file = getFile(directoryPath, fileName);
    var rows = createHashMap();
    var isHeaderRow = true;

    if (!file.exists()) {
        return rows;
    }

    forEachCsvFileRow(file, function (row) {
        if (isHeaderRow) {
            isHeaderRow = false;
            return;
        }

        if (normalizeString(row[0]) === '') {
            return;
        }

        var productId = normalizeString(row[0]);

        putMapValue(rows, productId, {
            productId: productId,
            rootProductId: normalizeString(row[1]),
            documentId: normalizeString(row[2]),
            count: parseInt(normalizeString(row[3]), 10) || 0
        });
    });

    return rows;
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
    writeCsvMapFile(
        directoryPath,
        getTargetAppliedStateFileName(exportContext.targetId || exportContext.locale || exportContext.coveoTrackingId, snapshot.windowDays),
        ['productId', 'rootProductId', 'documentId', 'unitsSold'],
        rows,
        function (productId, row) {
            return [productId, row.rootProductId, row.documentId, row.count];
        }
    );
}

function buildLookupSet(values) {
    if (values && values[SHARDED_MAP_MARKER]) {
        return values;
    }

    var map = createHashMap();
    var iterator;

    if (values && typeof values.hasNext === 'function' && typeof values.next === 'function') {
        iterator = values;

        try {
            while (iterator.hasNext()) {
                putMapValue(map, iterator.next(), true);
            }
        } finally {
            closeQuietly(iterator);
        }
    } else {
        (values || []).forEach(function (value) {
            putMapValue(map, value, true);
        });
    }

    return map;
}

function forEachSnapshotDrivenRootId(exportContext, snapshots, directoryPath, callback) {
    var resolvedDirectoryPath = directoryPath || DEFAULT_STATE_PATH;

    return withPurchaseStateLock(resolvedDirectoryPath, exportContext.coveoTrackingId, function () {
        (snapshots || []).forEach(function (snapshot) {
            var currentRows = snapshot.currentRows || readCurrentTargetRows(resolvedDirectoryPath, exportContext, snapshot);
            var appliedRows = snapshot.appliedRows || readAppliedTargetRows(resolvedDirectoryPath, exportContext, snapshot);

            iterateMap(currentRows, function (productId, row) {
                var previousRow = getMapValue(appliedRows, productId);

                if (!previousRow
                    || previousRow.count !== row.count
                    || previousRow.rootProductId !== row.rootProductId
                    || previousRow.documentId !== row.documentId) {
                    callback(row.rootProductId);
                }
            });

            iterateMap(appliedRows, function (productId, row) {
                if (!containsMapKey(currentRows, productId)) {
                    callback(row.rootProductId);
                }
            });
        });
    });
}

function getSnapshotDrivenRootIds(exportContext, snapshots, directoryPath) {
    var changedRootIds = createHashMap();

    forEachSnapshotDrivenRootId(exportContext, snapshots, directoryPath, function (rootId) {
        putMapValue(changedRootIds, rootId, true);
    });

    return createMapKeyIterator(changedRootIds);
}

function markFullExportApplied(exportContext, snapshots, directoryPath) {
    var resolvedDirectoryPath = directoryPath || DEFAULT_STATE_PATH;

    return withPurchaseStateLock(resolvedDirectoryPath, exportContext.coveoTrackingId, function () {
        (snapshots || []).forEach(function (snapshot) {
            writeAppliedTargetRows(
                resolvedDirectoryPath,
                exportContext,
                snapshot,
                snapshot.currentRows || readCurrentTargetRows(resolvedDirectoryPath, exportContext, snapshot)
            );
        });
    });
}

function markDeltaExportApplied(exportContext, snapshots, directoryPath, exportedRootIds) {
    var exportedRootLookup = buildLookupSet(exportedRootIds || []);
    var resolvedDirectoryPath = directoryPath || DEFAULT_STATE_PATH;

    return withPurchaseStateLock(resolvedDirectoryPath, exportContext.coveoTrackingId, function () {
        (snapshots || []).forEach(function (snapshot) {
            var currentRows = snapshot.currentRows || readCurrentTargetRows(resolvedDirectoryPath, exportContext, snapshot);
            var appliedRows = readAppliedTargetRows(resolvedDirectoryPath, exportContext, snapshot);
            var nextAppliedMap = createHashMap();

            iterateMap(appliedRows, function (productId, row) {
                putMapValue(nextAppliedMap, productId, row);
            });

            iterateMap(currentRows, function (productId, row) {
                if (containsMapKey(exportedRootLookup, row.rootProductId)) {
                    putMapValue(nextAppliedMap, productId, row);
                }
            });

            iterateMap(appliedRows, function (productId, row) {
                if (containsMapKey(exportedRootLookup, row.rootProductId) && !containsMapKey(currentRows, productId)) {
                    removeMapKey(nextAppliedMap, productId);
                }
            });

            writeAppliedTargetRows(
                resolvedDirectoryPath,
                exportContext,
                snapshot,
                nextAppliedMap
            );
        });
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
    forEachSnapshotDrivenRootId: forEachSnapshotDrivenRootId,
    getMapValue: getMapValue,
    getMapSize: getMapSize,
    getSnapshotDrivenRootIds: getSnapshotDrivenRootIds,
    iterateMap: iterateMap,
    markDeltaExportApplied: markDeltaExportApplied,
    markFullExportApplied: markFullExportApplied,
    normalizeString: normalizeString,
    parsePositiveInteger: parsePositiveInteger,
    publishSharedSnapshotAndTargetState: publishSharedSnapshotAndTargetState,
    putMapValue: putMapValue,
    readSharedSnapshot: readSharedSnapshot,
    sumCountsForAliases: sumCountsForAliases,
    withPurchaseStateLock: withPurchaseStateLock,
    writeSharedSnapshot: writeSharedSnapshot,
    writeTargetSnapshotState: writeTargetSnapshotState,
    ensureMetricFields: ensureMetricFields
};
