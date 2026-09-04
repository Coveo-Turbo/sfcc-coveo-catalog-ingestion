'use strict';

var path = require('path');
var crypto = require('crypto');
var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();

function createFileSystemStubs() {
    var files = {};

    function File(filePath) {
        this.fullPath = filePath.replace(/\/{2,}/g, '/');
        this.path = this.fullPath;
        this.name = this.fullPath.split('/').pop();
    }

    File.IMPEX = '/IMPEX';
    File.SEPARATOR = '/';
    File.prototype.exists = function () {
        return Object.prototype.hasOwnProperty.call(files, this.fullPath);
    };
    File.prototype.createNewFile = function () {
        if (this.exists()) {
            return false;
        }

        files[this.fullPath] = '';
        return true;
    };
    File.prototype.mkdirs = function () {
        return true;
    };
    File.prototype.remove = function () {
        if (!this.exists()) {
            return false;
        }

        delete files[this.fullPath];
        return true;
    };
    File.prototype.renameTo = function (target) {
        if (!this.exists() || target.exists()) {
            return false;
        }

        files[target.fullPath] = files[this.fullPath];
        delete files[this.fullPath];
        return true;
    };

    function FileWriter(file) {
        this.file = file;
        files[file.fullPath] = '';
    }

    FileWriter.prototype.write = function (value) {
        files[this.file.fullPath] += String(value);
    };
    FileWriter.prototype.flush = function () {};
    FileWriter.prototype.close = function () {};

    function FileReader(file) {
        this.contents = files[file.fullPath] || '';
        this.lines = this.contents.split(/\r?\n/);
        this.index = 0;
    }

    FileReader.prototype.getString = function () {
        return this.contents;
    };
    FileReader.prototype.readLine = function () {
        if (this.index >= this.lines.length) {
            return null;
        }

        var line = this.lines[this.index];
        this.index += 1;
        return line;
    };
    FileReader.prototype.close = function () {};

    return {
        File: File,
        FileReader: FileReader,
        FileWriter: FileWriter,
        files: files
    };
}

function createContext(overrides) {
    var context = {
        siteId: 'RefArch',
        targetId: 'mondou-en',
        coveoOrganizationId: 'organization-id',
        coveoSourceId: 'source-id',
        catalogId: 'storefront-catalog',
        locale: 'en_CA',
        language: 'en',
        catalogStructureMode: 'product_only',
        productEligibilityMode: 'online_and_searchable',
        mappingProfileId: 'commerce'
    };

    Object.keys(overrides || {}).forEach(function (key) {
        context[key] = overrides[key];
    });

    return context;
}

function createHelper() {
    var fileSystem = createFileSystemStubs();
    var uuidCounter = 0;
    function Bytes(value) {
        this.value = value;
    }
    function MessageDigest() {}

    MessageDigest.DIGEST_SHA_256 = 'SHA-256';
    MessageDigest.prototype.digestBytes = function (bytes) {
        return bytes;
    };

    var helper = proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/helper/catalogExportStateHelper'), {
        'dw/crypto/Encoding': {
            toHex: function (bytes) {
                return crypto.createHash('sha256').update(bytes.value, 'utf8').digest('hex');
            }
        },
        'dw/crypto/MessageDigest': MessageDigest,
        'dw/io/File': fileSystem.File,
        'dw/io/FileReader': fileSystem.FileReader,
        'dw/io/FileWriter': fileSystem.FileWriter,
        'dw/util/Bytes': Bytes,
        'dw/util/UUIDUtils': {
            createUUID: function () {
                uuidCounter += 1;
                return {
                    toString: function () {
                        return 'uuid-' + uuidCounter;
                    }
                };
            }
        }
    });

    return {
        fileSystem: fileSystem,
        helper: helper
    };
}

describe('catalogExportStateHelper', function () {
    it('writes and promotes a sharded manifest without retaining every root in memory', function () {
        var fixture = createHelper();
        var helper = fixture.helper;
        var context = createContext();
        var run = helper.beginRun(context, new Date('2026-09-02T18:00:00Z'));
        var records = [];

        helper.writeRootDescriptor(run, {
            rootId: 'MASTER-1',
            modificationSignature: 'modified-1',
            eligibilitySignature: 'eligible-1',
            ownershipSignature: 'owned-1'
        });
        helper.closeRootDescriptors(run);

        helper.writeRootRecord(run, 'MASTER-1', ['https://example.com/sku-1', 'https://example.com/sku-2'], {
            modifiedAt: '2026-09-01T00:00:00.000Z',
            eligibilitySignature: 'sku-1|sku-2',
            payloadChecksum: '123',
            items: [{ documentId: 'https://example.com/sku-1' }]
        });
        helper.writeRootRecord(run, 'STANDALONE-1', [], {
            modifiedAt: '2026-08-01T00:00:00.000Z',
            eligibilitySignature: 'ineligible'
        });

        var promoted = helper.promoteRun(run);
        var loaded = helper.loadActiveManifest(context);

        assert.strictEqual(promoted.rootCount, 2);
        assert.strictEqual(promoted.documentCount, 2);
        assert.strictEqual(loaded.generation, '1788372000000');
        assert.strictEqual(loaded.fingerprint, helper.buildFingerprint(context));
        assert.strictEqual(loaded.descriptorSchemaVersion, helper.DESCRIPTOR_SCHEMA_VERSION);
        assert.strictEqual(loaded.reconciliationMode, 'deep');
        assert.strictEqual(loaded.lastDeepReconciledAt, loaded.completedAt);

        Object.keys(loaded.shardFiles).forEach(function (shardIndex) {
            helper.forEachShardRecord(loaded, shardIndex, function (record) {
                records.push(record);
            });
        });

        assert.sameMembers(records.map(function (record) {
            return record.rootId;
        }), ['MASTER-1', 'STANDALONE-1']);
        assert.deepEqual(records.filter(function (record) {
            return record.rootId === 'MASTER-1';
        })[0].documentIds, ['https://example.com/sku-1', 'https://example.com/sku-2']);
        assert.notProperty(records.filter(function (record) {
            return record.rootId === 'MASTER-1';
        })[0], 'items');
        assert.notStrictEqual(helper.getPayloadChecksum([{ value: 'Aa' }]), helper.getPayloadChecksum([{ value: 'BB' }]));
        Object.keys(fixture.fileSystem.files).forEach(function (filePath) {
            assert.notMatch(filePath, /_(documents|descriptors|deletes)_\d\d\.jsonl$/);
        });
    });

    it('selects fast only from a usable current deep baseline', function () {
        var helper = createHelper().helper;
        var now = new Date('2026-09-04T12:00:00.000Z');
        var manifest = {
            descriptorSchemaVersion: helper.DESCRIPTOR_SCHEMA_VERSION,
            lastDeepReconciledAt: '2026-09-04T00:00:00.000Z'
        };
        var selection = helper.selectReconciliationMode(manifest, {
            requestedMode: 'auto',
            maxAgeHours: 24
        }, now);

        assert.deepEqual(selection, {
            mode: 'fast',
            reason: 'usable-deep-baseline',
            baselineAgeHours: 12
        });
        assert.deepEqual(helper.selectReconciliationMode(null, {
            requestedMode: 'auto'
        }, now), {
            mode: 'deep',
            reason: 'missing-deep-baseline',
            baselineAgeHours: null
        });
        assert.strictEqual(helper.selectReconciliationMode({}, {
            requestedMode: 'auto'
        }, now).reason, 'unsupported-descriptor-schema');
        assert.strictEqual(helper.selectReconciliationMode(manifest, {
            requestedMode: 'deep'
        }, now).reason, 'explicit-deep');
    });

    it('escalates auto and rejects explicit fast when deep reconciliation is required', function () {
        var helper = createHelper().helper;
        var now = new Date('2026-09-04T12:00:00.000Z');
        var expiredManifest = {
            descriptorSchemaVersion: helper.DESCRIPTOR_SCHEMA_VERSION,
            lastDeepReconciledAt: '2026-09-03T12:00:00.000Z'
        };
        var forced = helper.selectReconciliationMode(expiredManifest, {
            requestedMode: 'auto',
            forceDeep: true
        }, now);
        var pending = helper.selectReconciliationMode(expiredManifest, {
            requestedMode: 'auto',
            pendingDeepRequest: 'price-import'
        }, now);
        var expired = helper.selectReconciliationMode(expiredManifest, {
            requestedMode: 'auto',
            maxAgeHours: 24
        }, now);

        assert.strictEqual(forced.reason, 'force-deep');
        assert.strictEqual(pending.reason, 'pending-deep-request');
        assert.strictEqual(expired.reason, 'maximum-deep-age-exceeded');
        assert.strictEqual(expired.baselineAgeHours, 24);
        assert.strictEqual(helper.selectReconciliationMode(expiredManifest, {
            requestedMode: 'fast',
            forceDeep: true
        }, now).reason, 'force-deep');

        [
            { manifest: null, options: { requestedMode: 'fast' }, reason: 'missing-deep-baseline' },
            { manifest: {}, options: { requestedMode: 'fast' }, reason: 'unsupported-descriptor-schema' },
            { manifest: expiredManifest, options: { requestedMode: 'fast', maxAgeHours: 24 }, reason: 'maximum-deep-age-exceeded' },
            { manifest: expiredManifest, options: { requestedMode: 'fast', pendingDeepRequest: true }, reason: 'pending-deep-request' }
        ].forEach(function (testCase) {
            var thrownError = null;

            try {
                helper.selectReconciliationMode(testCase.manifest, testCase.options, now);
            } catch (error) {
                thrownError = error;
            }

            assert.instanceOf(thrownError, Error);
            assert.strictEqual(thrownError.reason, testCase.reason);
            assert.match(thrownError.message, /cannot run/);
        });
    });

    it('writes root-sharded descriptors and removes them when a run is aborted', function () {
        var fixture = createHelper();
        var helper = fixture.helper;
        var run = helper.beginRun(createContext(), new Date('2026-09-02T18:00:00Z'));
        var descriptors = [];
        var purchaseRootIds = [];
        var shardIndex;

        helper.writeRootDescriptor(run, 'ROOT-1', {
            rootType: 'master',
            modifiedAt: '2026-09-02T17:00:00.000Z',
            modificationSignature: 'modified',
            eligibilitySignature: 'eligible',
            ownershipSignature: 'owned',
            documentIds: ['doc-2', 'doc-1', 'doc-1']
        });
        helper.closeRootDescriptors(run);
        helper.writePurchaseRootId(run, 'ROOT-1');
        helper.closePurchaseRootIds(run);

        for (shardIndex = 0; shardIndex < helper.MANIFEST_SHARD_COUNT; shardIndex += 1) {
            helper.forEachRootDescriptor(run, shardIndex, function (descriptor) {
                descriptors.push(descriptor);
            });
            helper.forEachPurchaseRootId(run, shardIndex, function (rootId) {
                purchaseRootIds.push(rootId);
            });
        }

        assert.lengthOf(descriptors, 1);
        assert.include(descriptors[0], {
            rootId: 'ROOT-1',
            rootType: 'master',
            descriptorVersion: helper.DESCRIPTOR_SCHEMA_VERSION,
            modificationSignature: 'modified',
            eligibilitySignature: 'eligible',
            ownershipSignature: 'owned'
        });
        assert.deepEqual(descriptors[0].documentIds, ['doc-1', 'doc-2']);
        assert.deepEqual(purchaseRootIds, ['ROOT-1']);

        helper.abortRun(run);
        Object.keys(fixture.fileSystem.files).forEach(function (filePath) {
            assert.notMatch(filePath, /_descriptors_\d\d\.jsonl$/);
            assert.notMatch(filePath, /_purchase_\d\d\.jsonl$/);
        });
    });

    it('rejects delta use when target settings differ from the active manifest', function () {
        var fixture = createHelper();
        var helper = fixture.helper;
        var context = createContext();
        var run = helper.beginRun(context, new Date('2026-09-02T18:00:00Z'));

        helper.promoteRun(run);

        assert.throws(function () {
            helper.assertCompatibleManifest(createContext({
                productEligibilityMode: 'all'
            }), helper.loadActiveManifest(context));
        }, /configuration changed/);
    });

    it('shards current document ids and delete candidates for bounded reconciliation', function () {
        var fixture = createHelper();
        var helper = fixture.helper;
        var run = helper.beginRun(createContext(), new Date('2026-09-02T18:00:00Z'));
        var currentDocumentIds = [];
        var deleteCandidates = [];
        var shardIndex;

        helper.writeRootRecord(run, 'ROOT-1', ['doc-current'], {
            modifiedAt: '2026-09-02T17:00:00.000Z',
            modificationSignature: 'modified',
            eligibilitySignature: 'eligible',
            ownershipSignature: 'owned',
            payloadChecksum: 'checksum'
        });
        helper.writeDeleteCandidate(run, 'doc-current');
        helper.writeDeleteCandidate(run, 'doc-deleted');
        helper.closeRun(run);
        helper.closeDeleteCandidates(run);

        for (shardIndex = 0; shardIndex < helper.MANIFEST_SHARD_COUNT; shardIndex += 1) {
            helper.forEachCurrentDocumentId(run, shardIndex, function (documentId) {
                currentDocumentIds.push(documentId);
            });
            helper.forEachDeleteCandidate(run, shardIndex, function (documentId) {
                deleteCandidates.push(documentId);
            });
        }

        assert.deepEqual(currentDocumentIds, ['doc-current']);
        assert.sameMembers(deleteCandidates, ['doc-current', 'doc-deleted']);

        var records = [];
        helper.forEachShardRecord(run, helper.getShardIndex('ROOT-1'), function (record) {
            records.push(record);
        });
        assert.include(records[0], {
            descriptorVersion: helper.DESCRIPTOR_SCHEMA_VERSION,
            modifiedAt: '2026-09-02T17:00:00.000Z',
            modificationSignature: 'modified',
            eligibilitySignature: 'eligible',
            ownershipSignature: 'owned',
            payloadChecksum: 'checksum'
        });

        helper.abortRun(run);
        Object.keys(fixture.fileSystem.files).forEach(function (filePath) {
            assert.notMatch(filePath, /_(documents|deletes)_\d\d\.jsonl$/);
        });
    });

    it('keeps the active generation when a later run is aborted', function () {
        var fixture = createHelper();
        var helper = fixture.helper;
        var context = createContext();
        var firstRun = helper.beginRun(context, new Date('2026-09-02T18:00:00Z'));

        helper.writeRootRecord(firstRun, 'ROOT-1', ['doc-1']);
        helper.promoteRun(firstRun);

        var secondRun = helper.beginRun(context, new Date('2026-09-02T19:00:00Z'));
        helper.writeRootRecord(secondRun, 'ROOT-2', ['doc-2']);
        helper.abortRun(secondRun);

        assert.strictEqual(helper.loadActiveManifest(context).generation, firstRun.generation);
        assert.doesNotThrow(function () {
            helper.abortRun(helper.beginRun(context, new Date('2026-09-02T20:00:00Z')));
        });
    });

    it('inherits the deep timestamp on fast promotion and protects a promoted run from abort', function () {
        var fixture = createHelper();
        var helper = fixture.helper;
        var context = createContext();
        var deepRun = helper.beginRun(context, new Date('2026-09-02T18:00:00Z'), {
            reconciliationMode: 'deep'
        });

        helper.writeRootRecord(deepRun, 'ROOT-1', ['doc-1'], {
            modificationSignature: 'modified',
            eligibilitySignature: 'eligible',
            ownershipSignature: 'owned',
            payloadChecksum: 'checksum'
        });
        var deepManifest = helper.promoteRun(deepRun);
        var deepTimestamp = deepManifest.lastDeepReconciledAt;
        var fastRun = helper.beginRun(context, new Date('2026-09-02T19:00:00Z'), null, {
            reconciliationMode: 'fast',
            activeManifest: deepManifest
        });

        helper.writeRootRecord(fastRun, 'ROOT-1', ['doc-1'], {
            modificationSignature: 'modified',
            eligibilitySignature: 'eligible',
            ownershipSignature: 'owned',
            payloadChecksum: 'checksum'
        });
        var fastManifest = helper.promoteRun(fastRun);

        assert.strictEqual(fastManifest.reconciliationMode, 'fast');
        assert.strictEqual(fastManifest.lastDeepReconciledAt, deepTimestamp);
        assert.notStrictEqual(fastManifest.completedAt, null);

        helper.abortRun(fastRun);
        assert.strictEqual(helper.loadActiveManifest(context).generation, fastRun.generation);
        Object.keys(fixture.fileSystem.files).forEach(function (filePath) {
            assert.notMatch(filePath, /_(documents|descriptors|deletes)_\d\d\.jsonl$/);
        });
    });

    it('prevents overlapping runs for the same target', function () {
        var fixture = createHelper();
        var helper = fixture.helper;
        var context = createContext();
        var run = helper.beginRun(context, new Date('2026-09-02T18:00:00Z'));

        assert.throws(function () {
            helper.beginRun(context, new Date('2026-09-02T19:00:00Z'));
        }, /already running/);

        helper.abortRun(run);
    });

    it('prevents overlapping runs for different targets that share a Coveo source', function () {
        var fixture = createHelper();
        var helper = fixture.helper;
        var run = helper.beginRun(createContext(), new Date('2026-09-02T18:00:00Z'));

        assert.throws(function () {
            helper.beginRun(createContext({
                targetId: 'mondou-fr',
                locale: 'fr_CA',
                language: 'fr'
            }), new Date('2026-09-02T19:00:00Z'));
        }, /already running/);

        helper.abortRun(run);

        var ownershipError = assert.throws(function () {
            helper.beginRun(createContext({
                targetId: 'mondou-fr',
                locale: 'fr_CA',
                language: 'fr'
            }), new Date('2026-09-02T20:00:00Z'));
        }, /already owned by another catalog export target/);
        assert.include(ownershipError.message, 'mondou-en');
        assert.include(ownershipError.message, 'mondou-fr');
        assert.include(ownershipError.message, 'coveo_catalog_source_');
    });

    it('does not steal an old source lock automatically', function () {
        var fixture = createHelper();
        var helper = fixture.helper;
        var context = createContext();
        var firstRun = helper.beginRun(context, new Date('2026-09-02T18:00:00Z'));

        fixture.fileSystem.files[firstRun.lockFile.fullPath] = JSON.stringify({
            token: firstRun.lockToken,
            acquiredAt: '2000-01-01T00:00:00.000Z'
        }) + '\n';

        assert.throws(function () {
            helper.beginRun(context, new Date('2026-09-02T19:00:00Z'));
        }, /already running/);

        helper.abortRun(firstRun);
    });

    it('releases only the lock owned by the current run', function () {
        var fixture = createHelper();
        var helper = fixture.helper;
        var run = helper.beginRun(createContext(), new Date('2026-09-02T18:00:00Z'));

        fixture.fileSystem.files[run.lockFile.fullPath] = JSON.stringify({
            token: 'replacement-run',
            acquiredAt: '2026-09-02T18:01:00.000Z'
        }) + '\n';
        helper.abortRun(run);

        assert.isTrue(run.lockFile.exists());
        run.lockFile.remove();
    });

    it('invalidates the manifest when the Coveo organization changes', function () {
        var fixture = createHelper();
        var helper = fixture.helper;
        var context = createContext();
        var run = helper.beginRun(context, new Date('2026-09-02T18:00:00Z'));

        helper.promoteRun(run);

        assert.throws(function () {
            helper.assertCompatibleManifest(createContext({
                coveoOrganizationId: 'different-organization'
            }), helper.loadActiveManifest(context));
        }, /configuration changed/);
    });

    it('recovers the previous manifest pointer when promotion was interrupted', function () {
        var fixture = createHelper();
        var helper = fixture.helper;
        var context = createContext();
        var run = helper.beginRun(context, new Date('2026-09-02T18:00:00Z'));

        helper.writeRootRecord(run, 'ROOT-1', ['doc-1']);
        helper.promoteRun(run);

        var pointerPath = Object.keys(fixture.fileSystem.files).filter(function (filePath) {
            return /coveo_catalog_manifest_.*\.json$/.test(filePath);
        })[0];
        var pointerFile = new fixture.fileSystem.File(pointerPath);
        var backupFile = new fixture.fileSystem.File(pointerPath + '.bak');

        assert.isTrue(pointerFile.renameTo(backupFile));
        assert.isFalse(pointerFile.exists());
        assert.strictEqual(helper.loadActiveManifest(context).generation, run.generation);
        assert.isTrue(pointerFile.exists());
    });

    it('removes shards from the replaced generation after pointer promotion', function () {
        var fixture = createHelper();
        var helper = fixture.helper;
        var context = createContext();
        var firstRun = helper.beginRun(context, new Date('2026-09-02T18:00:00Z'));

        helper.writeRootRecord(firstRun, 'ROOT-1', ['doc-1']);
        var firstManifest = helper.promoteRun(firstRun);
        var firstShardPath = '/IMPEX' + helper.DEFAULT_STATE_PATH + firstManifest.shardFiles[Object.keys(firstManifest.shardFiles)[0]];

        assert.isTrue(Object.prototype.hasOwnProperty.call(fixture.fileSystem.files, firstShardPath));

        var secondRun = helper.beginRun(context, new Date('2026-09-02T19:00:00Z'));
        helper.writeRootRecord(secondRun, 'ROOT-2', ['doc-2']);
        helper.promoteRun(secondRun);

        assert.isFalse(Object.prototype.hasOwnProperty.call(fixture.fileSystem.files, firstShardPath));
    });
});
