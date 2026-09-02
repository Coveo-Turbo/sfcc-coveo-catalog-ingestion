'use strict';

var File = require('dw/io/File');
var FileReader = require('dw/io/FileReader');
var FileWriter = require('dw/io/FileWriter');

var DEFAULT_STATE_PATH = '/src/coveo/state/catalog-export/';
var MANIFEST_SCHEMA_VERSION = 1;
var MANIFEST_SHARD_COUNT = 16;

function normalizeString(value) {
    return value === null || value === undefined ? '' : String(value).trim();
}

function sanitizeFileSegment(value) {
    var normalized = normalizeString(value).replace(/[^A-Za-z0-9_-]+/g, '_');
    return normalized || 'default';
}

function getTargetKey(exportContext) {
    return sanitizeFileSegment(exportContext && exportContext.siteId)
        + '_'
        + sanitizeFileSegment(exportContext && (exportContext.targetId || exportContext.locale || 'legacy'));
}

function getDirectory(directoryPath) {
    return new File([File.IMPEX, directoryPath || DEFAULT_STATE_PATH].join(File.SEPARATOR));
}

function getFile(directoryPath, fileName) {
    return new File([File.IMPEX, directoryPath || DEFAULT_STATE_PATH, fileName].join(File.SEPARATOR));
}

function getPointerFileName(targetKey) {
    return 'coveo_catalog_manifest_' + targetKey + '.json';
}

function getLockFileName(targetKey) {
    return 'coveo_catalog_manifest_' + targetKey + '.lock';
}

function getShardFileName(targetKey, generation, shardIndex) {
    var paddedShard = shardIndex < 10 ? '0' + shardIndex : String(shardIndex);
    return 'coveo_catalog_manifest_' + targetKey + '_' + generation + '_' + paddedShard + '.jsonl';
}

function buildGeneration(startedAt) {
    var value = startedAt instanceof Date ? startedAt : new Date();
    return String(value.getTime());
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

function getShardIndex(rootId) {
    return Math.abs(hashString(rootId)) % MANIFEST_SHARD_COUNT;
}

function isManifestEnabled(exportContext) {
    return normalizeString(exportContext && exportContext.productEligibilityMode) !== ''
        && normalizeString(exportContext && exportContext.productEligibilityMode) !== 'legacy';
}

function getDocumentIds(items) {
    return normalizeDocumentIds((items || []).map(function (item) {
        return item && item.documentId;
    }));
}

function getPayloadChecksum(items) {
    return String(hashString(JSON.stringify((items || []).filter(function (item) {
        return !!item;
    }))));
}

function buildFingerprint(exportContext) {
    return JSON.stringify({
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        siteId: normalizeString(exportContext && exportContext.siteId),
        targetId: normalizeString(exportContext && exportContext.targetId),
        sourceId: normalizeString(exportContext && exportContext.coveoSourceId),
        catalogId: normalizeString(exportContext && exportContext.catalogId),
        locale: normalizeString(exportContext && exportContext.locale),
        language: normalizeString(exportContext && exportContext.language),
        catalogStructureMode: normalizeString(exportContext && exportContext.catalogStructureMode),
        productEligibilityMode: normalizeString(exportContext && exportContext.productEligibilityMode),
        mappingProfileId: normalizeString(exportContext && exportContext.mappingProfileId)
    });
}

function closeQuietly(closeable) {
    if (closeable && typeof closeable.close === 'function') {
        closeable.close();
    }
}

function readTextFile(file) {
    var reader;

    if (!file.exists()) {
        return '';
    }

    reader = new FileReader(file, 'UTF-8');

    try {
        return reader.getString();
    } finally {
        closeQuietly(reader);
    }
}

function writeTextFile(file, contents) {
    var writer = new FileWriter(file, 'UTF-8');

    try {
        writer.write(String(contents || ''));
        writer.flush();
    } finally {
        closeQuietly(writer);
    }
}

function writeJsonFileAtomically(directoryPath, fileName, value) {
    var targetFile = getFile(directoryPath, fileName);
    var temporaryFile = getFile(directoryPath, fileName + '.tmp');

    if (temporaryFile.exists()) {
        temporaryFile.remove();
    }

    writeTextFile(temporaryFile, JSON.stringify(value, null, 2) + '\n');

    if (targetFile.exists() && !targetFile.remove()) {
        temporaryFile.remove();
        throw new Error('Unable to replace catalog export manifest pointer ' + targetFile.fullPath + '.');
    }

    if (!temporaryFile.renameTo(targetFile)) {
        temporaryFile.remove();
        throw new Error('Unable to promote catalog export manifest pointer ' + targetFile.fullPath + '.');
    }
}

function acquireLock(directoryPath, targetKey) {
    var directory = getDirectory(directoryPath);
    var lockFile = getFile(directoryPath, getLockFileName(targetKey));

    directory.mkdirs();

    if (lockFile.exists() || (typeof lockFile.createNewFile === 'function' && !lockFile.createNewFile())) {
        throw new Error('A Coveo catalog export is already running for target ' + targetKey + '. Remove the manifest lock only after confirming that no export job is active.');
    }

    if (typeof lockFile.createNewFile !== 'function') {
        writeTextFile(lockFile, '');
    }

    writeTextFile(lockFile, new Date().toISOString() + '\n');
    return lockFile;
}

function releaseLock(run) {
    if (run && run.lockFile && run.lockFile.exists()) {
        run.lockFile.remove();
    }
}

function loadManifestForTargetKey(targetKey, directoryPath) {
    var pointerFile = getFile(directoryPath, getPointerFileName(targetKey));
    var contents = readTextFile(pointerFile);
    var manifest;

    if (contents === '') {
        return null;
    }

    manifest = JSON.parse(contents);

    if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
        throw new Error('The Coveo catalog export manifest for target ' + targetKey + ' uses an unsupported schema version. Run a full export.');
    }

    manifest.targetKey = targetKey;
    manifest.directoryPath = directoryPath || DEFAULT_STATE_PATH;
    return manifest;
}

function loadActiveManifest(exportContext, directoryPath) {
    return loadManifestForTargetKey(getTargetKey(exportContext), directoryPath);
}

function assertCompatibleManifest(exportContext, manifest) {
    if (!manifest) {
        throw new Error('The Coveo delta export requires a successful manifest-enabled full export before it can run.');
    }

    if (manifest.fingerprint !== buildFingerprint(exportContext)) {
        throw new Error('The Coveo catalog export target configuration changed after the active manifest was created. Run a full export before running another delta.');
    }
}

function beginRun(exportContext, startedAt, directoryPath) {
    var targetKey = getTargetKey(exportContext);
    var resolvedDirectoryPath = directoryPath || DEFAULT_STATE_PATH;

    return {
        directoryPath: resolvedDirectoryPath,
        targetKey: targetKey,
        generation: buildGeneration(startedAt),
        fingerprint: buildFingerprint(exportContext),
        startedAt: (startedAt instanceof Date ? startedAt : new Date()).toISOString(),
        writers: {},
        shardFiles: {},
        rootCount: 0,
        documentCount: 0,
        closed: false,
        lockFile: acquireLock(resolvedDirectoryPath, targetKey)
    };
}

function getRunWriter(run, shardIndex) {
    var writer = run.writers[shardIndex];

    if (writer) {
        return writer;
    }

    var fileName = getShardFileName(run.targetKey, run.generation, shardIndex);
    var file = getFile(run.directoryPath, fileName);

    if (file.exists()) {
        file.remove();
    }

    writer = new FileWriter(file, 'UTF-8');
    run.writers[shardIndex] = writer;
    run.shardFiles[shardIndex] = fileName;
    return writer;
}

function normalizeDocumentIds(documentIds) {
    var seen = {};

    return (documentIds || []).map(normalizeString).filter(function (documentId) {
        var key = '$' + documentId;

        if (documentId === '' || seen[key]) {
            return false;
        }

        seen[key] = true;
        return true;
    }).sort();
}

function writeRootRecord(run, rootId, documentIds, state) {
    if (!run || run.closed) {
        throw new Error('Cannot write to a closed Coveo catalog export manifest run.');
    }

    var normalizedRootId = normalizeString(rootId);
    var normalizedDocumentIds = normalizeDocumentIds(documentIds);
    var shardIndex;
    var writer;
    var record;

    if (normalizedRootId === '') {
        throw new Error('Catalog export manifest records require a root product id.');
    }

    shardIndex = getShardIndex(normalizedRootId);
    writer = getRunWriter(run, shardIndex);
    record = {
        rootId: normalizedRootId,
        documentIds: normalizedDocumentIds,
        modifiedAt: normalizeString(state && state.modifiedAt),
        eligibilitySignature: normalizeString(state && state.eligibilitySignature),
        payloadChecksum: normalizeString(state && state.payloadChecksum)
    };
    writer.write(JSON.stringify(record) + '\n');
    run.rootCount += 1;
    run.documentCount += normalizedDocumentIds.length;
    return record;
}

function closeRun(run) {
    if (!run || run.closed) {
        return;
    }

    Object.keys(run.writers).forEach(function (shardIndex) {
        var writer = run.writers[shardIndex];
        writer.flush();
        closeQuietly(writer);
    });

    run.writers = {};
    run.closed = true;
}

function removeGenerationFiles(manifest) {
    var shardFiles = manifest && manifest.shardFiles ? manifest.shardFiles : {};

    Object.keys(shardFiles).forEach(function (shardIndex) {
        var file = getFile(manifest.directoryPath || DEFAULT_STATE_PATH, shardFiles[shardIndex]);

        if (file.exists()) {
            file.remove();
        }
    });
}

function abortRun(run) {
    closeRun(run);
    removeGenerationFiles(run);
    releaseLock(run);
}

function promoteRun(run) {
    var previousManifest;
    var manifest;

    closeRun(run);
    previousManifest = loadManifestForTargetKey(run.targetKey, run.directoryPath);
    manifest = {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        generation: run.generation,
        fingerprint: run.fingerprint,
        startedAt: run.startedAt,
        completedAt: new Date().toISOString(),
        shardCount: MANIFEST_SHARD_COUNT,
        shardFiles: run.shardFiles,
        rootCount: run.rootCount,
        documentCount: run.documentCount
    };

    writeJsonFileAtomically(run.directoryPath, getPointerFileName(run.targetKey), manifest);

    if (previousManifest && previousManifest.generation !== manifest.generation) {
        removeGenerationFiles(previousManifest);
    }

    releaseLock(run);
    manifest.targetKey = run.targetKey;
    manifest.directoryPath = run.directoryPath;
    return manifest;
}

function forEachShardRecord(manifest, shardIndex, callback) {
    var fileName = manifest && manifest.shardFiles ? manifest.shardFiles[shardIndex] : '';
    var file;
    var reader;
    var line;

    if (!fileName) {
        return;
    }

    file = getFile(manifest.directoryPath || DEFAULT_STATE_PATH, fileName);

    if (!file.exists()) {
        throw new Error('The Coveo catalog export manifest shard ' + fileName + ' is missing. Run a full export.');
    }

    reader = new FileReader(file, 'UTF-8');

    try {
        line = reader.readLine();

        while (line !== null) {
            if (normalizeString(line) !== '') {
                callback(JSON.parse(line));
            }

            line = reader.readLine();
        }
    } finally {
        closeQuietly(reader);
    }
}

module.exports = {
    DEFAULT_STATE_PATH: DEFAULT_STATE_PATH,
    MANIFEST_SCHEMA_VERSION: MANIFEST_SCHEMA_VERSION,
    MANIFEST_SHARD_COUNT: MANIFEST_SHARD_COUNT,
    abortRun: abortRun,
    assertCompatibleManifest: assertCompatibleManifest,
    beginRun: beginRun,
    buildFingerprint: buildFingerprint,
    closeRun: closeRun,
    forEachShardRecord: forEachShardRecord,
    getShardIndex: getShardIndex,
    getDocumentIds: getDocumentIds,
    getPayloadChecksum: getPayloadChecksum,
    isManifestEnabled: isManifestEnabled,
    loadActiveManifest: loadActiveManifest,
    promoteRun: promoteRun,
    writeRootRecord: writeRootRecord
};
