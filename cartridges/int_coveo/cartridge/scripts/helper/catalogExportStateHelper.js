'use strict';

var File = require('dw/io/File');
var FileReader = require('dw/io/FileReader');
var FileWriter = require('dw/io/FileWriter');
var Encoding = require('dw/crypto/Encoding');
var MessageDigest = require('dw/crypto/MessageDigest');
var Bytes = require('dw/util/Bytes');
var UUIDUtils = require('dw/util/UUIDUtils');

var DEFAULT_STATE_PATH = '/src/coveo/state/catalog-export/';
var MANIFEST_SCHEMA_VERSION = 1;
var DESCRIPTOR_SCHEMA_VERSION = 1;
var MANIFEST_SHARD_COUNT = 16;
var DEFAULT_MAX_DEEP_RECONCILIATION_AGE_HOURS = 24;

function normalizeString(value) {
    return value === null || value === undefined ? '' : String(value).trim();
}

function digestText(value) {
    var digest = new MessageDigest(MessageDigest.DIGEST_SHA_256);
    return Encoding.toHex(digest.digestBytes(new Bytes(String(value), 'UTF-8')));
}

function getTargetKey(exportContext) {
    return digestText(
        normalizeString(exportContext && exportContext.siteId)
        + '\u0000'
        + normalizeString(exportContext && (exportContext.targetId || exportContext.locale || 'legacy'))
    );
}

function getSourceKey(exportContext) {
    return digestText(
        normalizeString(exportContext && exportContext.coveoOrganizationId)
        + '\u0000'
        + normalizeString(exportContext && exportContext.coveoSourceId)
    );
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

function getSourceOwnershipFileName(sourceKey) {
    return 'coveo_catalog_source_' + sourceKey + '.json';
}

function getShardFileName(targetKey, generation, shardIndex) {
    var paddedShard = shardIndex < 10 ? '0' + shardIndex : String(shardIndex);
    return 'coveo_catalog_manifest_' + targetKey + '_' + generation + '_' + paddedShard + '.jsonl';
}

function getTransientShardFileName(targetKey, generation, kind, shardIndex) {
    var paddedShard = shardIndex < 10 ? '0' + shardIndex : String(shardIndex);
    return 'coveo_catalog_manifest_' + targetKey + '_' + generation + '_' + kind + '_' + paddedShard + '.jsonl';
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

function buildModeSelection(mode, reason, baselineAgeHours) {
    return {
        mode: mode,
        reason: reason,
        baselineAgeHours: baselineAgeHours === undefined ? null : baselineAgeHours
    };
}

function rejectFastMode(reason, message, baselineAgeHours) {
    var error = new Error('Fast Coveo catalog reconciliation cannot run: ' + message);
    error.reason = reason;
    error.baselineAgeHours = baselineAgeHours === undefined ? null : baselineAgeHours;
    throw error;
}

function selectReconciliationMode(manifest, options, now) {
    var resolvedOptions = options || {};
    var requestedMode = normalizeString(resolvedOptions.requestedMode || 'auto').toLowerCase();
    var maxAgeHours = resolvedOptions.maxAgeHours;
    var resolvedNow = now instanceof Date ? new Date(now.getTime()) : new Date(now);
    var lastDeepReconciledAt;
    var baselineTime;
    var baselineAgeHours;
    var requiredReason = '';
    var requiredMessage = '';

    if (requestedMode !== 'auto' && requestedMode !== 'fast' && requestedMode !== 'deep') {
        throw new Error('Unsupported Coveo catalog reconciliation mode "' + requestedMode + '". Use auto, fast, or deep.');
    }

    if (isNaN(resolvedNow.getTime())) {
        throw new Error('A valid current time is required to select the Coveo catalog reconciliation mode.');
    }

    if (maxAgeHours === null || maxAgeHours === undefined || normalizeString(maxAgeHours) === '') {
        maxAgeHours = DEFAULT_MAX_DEEP_RECONCILIATION_AGE_HOURS;
    } else {
        maxAgeHours = Number(maxAgeHours);
    }

    if (isNaN(maxAgeHours) || !isFinite(maxAgeHours) || maxAgeHours < 0) {
        throw new Error('The maximum Coveo deep reconciliation age must be a non-negative number of hours.');
    }

    if (resolvedOptions.forceDeep === true || normalizeString(resolvedOptions.forceDeep).toLowerCase() === 'true') {
        return buildModeSelection('deep', 'force-deep');
    }

    if (requestedMode === 'deep') {
        return buildModeSelection('deep', 'explicit-deep');
    }

    if (resolvedOptions.pendingDeepRequest) {
        requiredReason = 'pending-deep-request';
        requiredMessage = 'a dependency requested a deep reconciliation.';
    } else if (!manifest) {
        requiredReason = 'missing-deep-baseline';
        requiredMessage = 'there is no active deep baseline.';
    } else if (manifest.descriptorSchemaVersion !== DESCRIPTOR_SCHEMA_VERSION) {
        requiredReason = 'unsupported-descriptor-schema';
        requiredMessage = 'the active baseline does not contain supported root descriptors.';
    } else {
        lastDeepReconciledAt = normalizeString(manifest.lastDeepReconciledAt);
        baselineTime = new Date(lastDeepReconciledAt);

        if (lastDeepReconciledAt === '' || isNaN(baselineTime.getTime())) {
            requiredReason = 'invalid-deep-baseline-timestamp';
            requiredMessage = 'the active baseline has no valid deep reconciliation timestamp.';
        } else {
            baselineAgeHours = Math.max(0, resolvedNow.getTime() - baselineTime.getTime()) / (60 * 60 * 1000);

            if (baselineAgeHours >= maxAgeHours) {
                requiredReason = 'maximum-deep-age-exceeded';
                requiredMessage = 'the active deep baseline is ' + baselineAgeHours + ' hours old, which meets or exceeds the ' + maxAgeHours + '-hour maximum.';
            }
        }
    }

    if (requiredReason !== '') {
        if (requestedMode === 'fast') {
            rejectFastMode(requiredReason, requiredMessage, baselineAgeHours);
        }

        return buildModeSelection('deep', requiredReason, baselineAgeHours);
    }

    return buildModeSelection('fast', 'usable-deep-baseline', baselineAgeHours);
}

function getDocumentIds(items) {
    return normalizeDocumentIds((items || []).map(function (item) {
        return item && item.documentId;
    }));
}

function getPayloadChecksum(items) {
    var serializedPayload = JSON.stringify((items || []).filter(function (item) {
        return !!item;
    }));
    return digestText(serializedPayload);
}

function buildFingerprint(exportContext) {
    return JSON.stringify({
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        siteId: normalizeString(exportContext && exportContext.siteId),
        targetId: normalizeString(exportContext && exportContext.targetId),
        organizationId: normalizeString(exportContext && exportContext.coveoOrganizationId),
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
    var backupFile = getFile(directoryPath, fileName + '.bak');

    if (temporaryFile.exists()) {
        temporaryFile.remove();
    }

    writeTextFile(temporaryFile, JSON.stringify(value, null, 2) + '\n');

    if (backupFile.exists()) {
        backupFile.remove();
    }

    if (targetFile.exists() && !targetFile.renameTo(backupFile)) {
        temporaryFile.remove();
        throw new Error('Unable to preserve the previous catalog export manifest pointer ' + targetFile.fullPath + '.');
    }

    if (!temporaryFile.renameTo(targetFile)) {
        temporaryFile.remove();

        if (backupFile.exists()) {
            backupFile.renameTo(targetFile);
        }

        throw new Error('Unable to promote catalog export manifest pointer ' + targetFile.fullPath + '.');
    }

    if (backupFile.exists()) {
        backupFile.remove();
    }
}

function acquireLock(directoryPath, sourceKey, lockToken) {
    var directory = getDirectory(directoryPath);
    var lockFile = getFile(directoryPath, getLockFileName(sourceKey));

    directory.mkdirs();

    if (lockFile.exists()) {
        throw new Error('A Coveo catalog export is already running for source ' + sourceKey + '. Remove the manifest lock only after confirming that no export job is active.');
    }

    if (typeof lockFile.createNewFile === 'function' && !lockFile.createNewFile()) {
        throw new Error('A Coveo catalog export is already running for source ' + sourceKey + '.');
    }

    if (typeof lockFile.createNewFile !== 'function') {
        writeTextFile(lockFile, '');
    }

    writeTextFile(lockFile, JSON.stringify({
        token: lockToken,
        acquiredAt: new Date().toISOString()
    }) + '\n');
    return lockFile;
}

function releaseLock(run) {
    if (run && run.lockFile && run.lockFile.exists()) {
        var lockContents = readTextFile(run.lockFile);
        var lockState = lockContents === '' ? null : JSON.parse(lockContents);

        if (lockState && lockState.token === run.lockToken) {
            run.lockFile.remove();
        }
    }
}

function ensureSourceOwnership(directoryPath, sourceKey, targetKey, exportContext) {
    var ownershipFileName = getSourceOwnershipFileName(sourceKey);
    var ownershipFile = getFile(directoryPath, ownershipFileName);
    var contents = readTextFile(ownershipFile);
    var ownership;

    if (contents !== '') {
        ownership = JSON.parse(contents);

        if (ownership.targetKey !== targetKey) {
            var ownerDescription = normalizeString(ownership.targetId) || ownership.targetKey;
            var requestedDescription = normalizeString(exportContext && exportContext.targetId) || targetKey;
            var sourceDescription = normalizeString(exportContext && exportContext.coveoSourceId) || sourceKey;

            throw new Error(
                'Coveo source "' + sourceDescription + '" is already owned by another catalog export target "'
                + ownerDescription
                + '" and cannot be claimed by "'
                + requestedDescription
                + '". Configure a distinct coveoSourceId for each target. Ownership file: '
                + ownershipFileName
                + '.'
            );
        }

        return;
    }

    writeJsonFileAtomically(directoryPath, ownershipFileName, {
        targetKey: targetKey,
        siteId: normalizeString(exportContext && exportContext.siteId),
        targetId: normalizeString(exportContext && exportContext.targetId),
        organizationId: normalizeString(exportContext && exportContext.coveoOrganizationId),
        sourceId: normalizeString(exportContext && exportContext.coveoSourceId),
        claimedAt: new Date().toISOString()
    });
}

function loadManifestForTargetKey(targetKey, directoryPath) {
    var pointerFile = getFile(directoryPath, getPointerFileName(targetKey));
    var backupFile = getFile(directoryPath, getPointerFileName(targetKey) + '.bak');

    if (!pointerFile.exists() && backupFile.exists()) {
        backupFile.renameTo(pointerFile);
    }

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

function beginRun(exportContext, startedAt, directoryPath, options) {
    var resolvedOptions = options || {};
    var resolvedDirectoryArgument = directoryPath;

    if (directoryPath && typeof directoryPath === 'object') {
        resolvedOptions = directoryPath;
        resolvedDirectoryArgument = null;
    }

    var targetKey = getTargetKey(exportContext);
    var sourceKey = getSourceKey(exportContext);
    var resolvedDirectoryPath = resolvedDirectoryArgument || DEFAULT_STATE_PATH;
    var generation = buildGeneration(startedAt);
    var lockToken = UUIDUtils.createUUID().toString();
    var lockFile = acquireLock(resolvedDirectoryPath, sourceKey, lockToken);

    try {
        ensureSourceOwnership(resolvedDirectoryPath, sourceKey, targetKey, exportContext);
    } catch (error) {
        if (lockFile.exists()) {
            lockFile.remove();
        }

        throw error;
    }

    return {
        directoryPath: resolvedDirectoryPath,
        targetKey: targetKey,
        generation: generation,
        fingerprint: buildFingerprint(exportContext),
        startedAt: (startedAt instanceof Date ? startedAt : new Date()).toISOString(),
        writers: {},
        shardFiles: {},
        documentIndexWriters: {},
        documentIndexFiles: {},
        rootDescriptorWriters: {},
        rootDescriptorFiles: {},
        rootDescriptorsClosed: false,
        purchaseRootWriters: {},
        purchaseRootFiles: {},
        purchaseRootsClosed: false,
        deleteCandidateWriters: {},
        deleteCandidateFiles: {},
        deleteCandidatesClosed: false,
        rootCount: 0,
        documentCount: 0,
        closed: false,
        promoted: false,
        reconciliationMode: normalizeString(resolvedOptions.reconciliationMode || 'deep').toLowerCase(),
        activeManifest: resolvedOptions.activeManifest || null,
        lockFile: lockFile,
        lockToken: lockToken
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

function getTransientRunWriter(run, kind, shardIndex) {
    var writerCollection;
    var fileCollection;

    if (kind === 'documents') {
        writerCollection = run.documentIndexWriters;
        fileCollection = run.documentIndexFiles;
    } else if (kind === 'descriptors') {
        writerCollection = run.rootDescriptorWriters;
        fileCollection = run.rootDescriptorFiles;
    } else if (kind === 'purchase') {
        writerCollection = run.purchaseRootWriters;
        fileCollection = run.purchaseRootFiles;
    } else {
        writerCollection = run.deleteCandidateWriters;
        fileCollection = run.deleteCandidateFiles;
    }

    var writer = writerCollection[shardIndex];

    if (writer) {
        return writer;
    }

    var fileName = getTransientShardFileName(run.targetKey, run.generation, kind, shardIndex);
    var file = getFile(run.directoryPath, fileName);

    if (file.exists()) {
        file.remove();
    }

    writer = new FileWriter(file, 'UTF-8');
    writerCollection[shardIndex] = writer;
    fileCollection[shardIndex] = fileName;
    return writer;
}

function writeCurrentDocumentIds(run, documentIds) {
    (documentIds || []).forEach(function (documentId) {
        var shardIndex = getShardIndex(documentId);
        var writer = getTransientRunWriter(run, 'documents', shardIndex);
        writer.write(JSON.stringify({
            documentId: documentId
        }) + '\n');
    });
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

function writeRootDescriptor(run, rootId, descriptor) {
    var resolvedDescriptor = descriptor || {};
    var resolvedRootId = rootId;
    var normalizedRootId;
    var shardIndex;
    var writer;
    var record = {};

    if (rootId && typeof rootId === 'object' && descriptor === undefined) {
        resolvedDescriptor = rootId;
        resolvedRootId = resolvedDescriptor.rootId;
    }

    if (!run || run.rootDescriptorsClosed || run.promoted) {
        throw new Error('Cannot write to closed Coveo catalog export root descriptor shards.');
    }

    normalizedRootId = normalizeString(resolvedRootId);

    if (normalizedRootId === '') {
        throw new Error('Catalog export root descriptors require a root product id.');
    }

    Object.keys(resolvedDescriptor).forEach(function (key) {
        record[key] = resolvedDescriptor[key];
    });
    record.rootId = normalizedRootId;
    record.descriptorVersion = DESCRIPTOR_SCHEMA_VERSION;
    record.modifiedAt = normalizeString(resolvedDescriptor.modifiedAt);
    record.modificationSignature = normalizeString(resolvedDescriptor.modificationSignature);
    record.eligibilitySignature = normalizeString(resolvedDescriptor.eligibilitySignature);
    record.ownershipSignature = normalizeString(resolvedDescriptor.ownershipSignature);

    if (Object.prototype.hasOwnProperty.call(resolvedDescriptor, 'documentIds')) {
        record.documentIds = normalizeDocumentIds(resolvedDescriptor.documentIds);
    }

    shardIndex = getShardIndex(normalizedRootId);
    writer = getTransientRunWriter(run, 'descriptors', shardIndex);
    writer.write(JSON.stringify(record) + '\n');
    return record;
}

function closeRootDescriptors(run) {
    if (!run || run.rootDescriptorsClosed) {
        return;
    }

    Object.keys(run.rootDescriptorWriters).forEach(function (shardIndex) {
        var writer = run.rootDescriptorWriters[shardIndex];
        writer.flush();
        closeQuietly(writer);
    });

    run.rootDescriptorWriters = {};
    run.rootDescriptorsClosed = true;
}

function writePurchaseRootId(run, rootId) {
    var normalizedRootId = normalizeString(rootId);

    if (!run || run.purchaseRootsClosed || run.promoted) {
        throw new Error('Cannot write to closed Coveo catalog export purchase-root shards.');
    }

    if (normalizedRootId === '') {
        return;
    }

    var shardIndex = getShardIndex(normalizedRootId);
    var writer = getTransientRunWriter(run, 'purchase', shardIndex);
    writer.write(JSON.stringify({ rootId: normalizedRootId }) + '\n');
}

function closePurchaseRootIds(run) {
    if (!run || run.purchaseRootsClosed) {
        return;
    }

    Object.keys(run.purchaseRootWriters).forEach(function (shardIndex) {
        var writer = run.purchaseRootWriters[shardIndex];
        writer.flush();
        closeQuietly(writer);
    });

    run.purchaseRootWriters = {};
    run.purchaseRootsClosed = true;
}

function writeRootRecord(run, rootId, documentIds, state) {
    if (!run || run.closed || run.promoted) {
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
        descriptorVersion: DESCRIPTOR_SCHEMA_VERSION,
        modifiedAt: normalizeString(state && state.modifiedAt),
        modificationSignature: normalizeString(state && state.modificationSignature),
        eligibilitySignature: normalizeString(state && state.eligibilitySignature),
        ownershipSignature: normalizeString(state && state.ownershipSignature),
        payloadChecksum: normalizeString(state && state.payloadChecksum)
    };

    writeCurrentDocumentIds(run, normalizedDocumentIds);

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

    Object.keys(run.documentIndexWriters).forEach(function (shardIndex) {
        var writer = run.documentIndexWriters[shardIndex];
        writer.flush();
        closeQuietly(writer);
    });

    closeRootDescriptors(run);
    closePurchaseRootIds(run);

    run.writers = {};
    run.documentIndexWriters = {};
    run.closed = true;
}

function writeDeleteCandidate(run, documentId) {
    var normalizedDocumentId = normalizeString(documentId);

    if (!run || run.promoted) {
        throw new Error('Cannot write Coveo catalog export delete candidates without an active manifest run.');
    }

    if (run.deleteCandidatesClosed) {
        throw new Error('Cannot write to closed Coveo catalog export delete candidate shards.');
    }

    if (normalizedDocumentId === '') {
        throw new Error('Catalog export delete candidates require a document id.');
    }

    var shardIndex = getShardIndex(normalizedDocumentId);
    var writer = getTransientRunWriter(run, 'deletes', shardIndex);
    writer.write(JSON.stringify({
        documentId: normalizedDocumentId
    }) + '\n');
}

function closeDeleteCandidates(run) {
    if (!run || run.deleteCandidatesClosed) {
        return;
    }

    Object.keys(run.deleteCandidateWriters).forEach(function (shardIndex) {
        var writer = run.deleteCandidateWriters[shardIndex];
        writer.flush();
        closeQuietly(writer);
    });

    run.deleteCandidateWriters = {};
    run.deleteCandidatesClosed = true;
}

function removeFileCollection(directoryPath, fileCollection) {
    Object.keys(fileCollection || {}).forEach(function (shardIndex) {
        var file = getFile(directoryPath || DEFAULT_STATE_PATH, fileCollection[shardIndex]);

        if (file.exists()) {
            file.remove();
        }
    });
}

function removeTransientFiles(run) {
    if (!run) {
        return;
    }

    removeFileCollection(run.directoryPath, run.documentIndexFiles);
    removeFileCollection(run.directoryPath, run.rootDescriptorFiles);
    removeFileCollection(run.directoryPath, run.purchaseRootFiles);
    removeFileCollection(run.directoryPath, run.deleteCandidateFiles);
}

function removeGenerationFiles(manifest, defaultDirectoryPath) {
    var shardFiles = manifest && manifest.shardFiles ? manifest.shardFiles : {};

    Object.keys(shardFiles).forEach(function (shardIndex) {
        var file = getFile(manifest.directoryPath || defaultDirectoryPath || DEFAULT_STATE_PATH, shardFiles[shardIndex]);

        if (file.exists()) {
            file.remove();
        }
    });
}

function removePreviousGenerationAfterPromotion(run, previousManifest, manifest) {
    if (!previousManifest
        || previousManifest.generation === manifest.generation
        || (previousManifest.targetKey && previousManifest.targetKey !== run.targetKey)
        || (previousManifest.directoryPath && previousManifest.directoryPath !== run.directoryPath)) {
        return;
    }

    try {
        removeGenerationFiles(previousManifest, run.directoryPath);
    } catch (cleanupError) {
        // The new pointer is already durable. Retaining an old generation is safer than failing promotion.
    }
}

function abortRun(run) {
    closeRun(run);
    closeRootDescriptors(run);
    closePurchaseRootIds(run);
    closeDeleteCandidates(run);

    if (!run || !run.promoted) {
        removeGenerationFiles(run);
    }

    removeTransientFiles(run);
    releaseLock(run);
}

function promoteRun(run) {
    var previousManifest;
    var manifest;

    closeRun(run);
    closeRootDescriptors(run);
    closePurchaseRootIds(run);
    closeDeleteCandidates(run);
    removeTransientFiles(run);
    previousManifest = run.activeManifest || loadManifestForTargetKey(run.targetKey, run.directoryPath);
    var completedAt = new Date().toISOString();
    manifest = {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        descriptorSchemaVersion: DESCRIPTOR_SCHEMA_VERSION,
        generation: run.generation,
        fingerprint: run.fingerprint,
        startedAt: run.startedAt,
        completedAt: completedAt,
        reconciliationMode: run.reconciliationMode,
        lastDeepReconciledAt: run.reconciliationMode === 'deep'
            ? completedAt
            : (previousManifest && previousManifest.lastDeepReconciledAt) || null,
        shardCount: MANIFEST_SHARD_COUNT,
        shardFiles: run.shardFiles,
        rootCount: run.rootCount,
        documentCount: run.documentCount
    };

    writeJsonFileAtomically(run.directoryPath, getPointerFileName(run.targetKey), manifest);
    run.promoted = true;

    removePreviousGenerationAfterPromotion(run, previousManifest, manifest);

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

function forEachTransientRecord(run, fileCollection, shardIndex, callback) {
    var fileName = fileCollection ? fileCollection[shardIndex] : '';
    var file;
    var reader;
    var line;

    if (!fileName) {
        return;
    }

    file = getFile(run.directoryPath || DEFAULT_STATE_PATH, fileName);

    if (!file.exists()) {
        throw new Error('The Coveo catalog export transient shard ' + fileName + ' is missing.');
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

function forEachCurrentDocumentId(run, shardIndex, callback) {
    forEachTransientRecord(run, run && run.documentIndexFiles, shardIndex, function (record) {
        callback(record.documentId);
    });
}

function forEachRootDescriptor(run, shardIndex, callback) {
    forEachTransientRecord(run, run && run.rootDescriptorFiles, shardIndex, callback);
}

function forEachPurchaseRootId(run, shardIndex, callback) {
    forEachTransientRecord(run, run && run.purchaseRootFiles, shardIndex, function (record) {
        callback(record.rootId);
    });
}

function forEachDeleteCandidate(run, shardIndex, callback) {
    forEachTransientRecord(run, run && run.deleteCandidateFiles, shardIndex, function (record) {
        callback(record.documentId);
    });
}

module.exports = {
    DEFAULT_STATE_PATH: DEFAULT_STATE_PATH,
    MANIFEST_SCHEMA_VERSION: MANIFEST_SCHEMA_VERSION,
    DESCRIPTOR_SCHEMA_VERSION: DESCRIPTOR_SCHEMA_VERSION,
    MANIFEST_SHARD_COUNT: MANIFEST_SHARD_COUNT,
    DEFAULT_MAX_DEEP_RECONCILIATION_AGE_HOURS: DEFAULT_MAX_DEEP_RECONCILIATION_AGE_HOURS,
    abortRun: abortRun,
    assertCompatibleManifest: assertCompatibleManifest,
    beginRun: beginRun,
    buildFingerprint: buildFingerprint,
    closeDeleteCandidates: closeDeleteCandidates,
    closeRootDescriptors: closeRootDescriptors,
    closePurchaseRootIds: closePurchaseRootIds,
    closeRun: closeRun,
    forEachCurrentDocumentId: forEachCurrentDocumentId,
    forEachDeleteCandidate: forEachDeleteCandidate,
    forEachRootDescriptor: forEachRootDescriptor,
    forEachPurchaseRootId: forEachPurchaseRootId,
    forEachShardRecord: forEachShardRecord,
    getShardIndex: getShardIndex,
    getDocumentIds: getDocumentIds,
    getPayloadChecksum: getPayloadChecksum,
    isManifestEnabled: isManifestEnabled,
    loadActiveManifest: loadActiveManifest,
    promoteRun: promoteRun,
    selectReconciliationMode: selectReconciliationMode,
    writeDeleteCandidate: writeDeleteCandidate,
    writeRootDescriptor: writeRootDescriptor,
    writePurchaseRootId: writePurchaseRootId,
    writeRootRecord: writeRootRecord
};
