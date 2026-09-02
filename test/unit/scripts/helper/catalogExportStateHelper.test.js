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
            assert.notMatch(filePath, /_(documents|deletes)_\d\d\.jsonl$/);
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
            payloadChecksum: 'checksum',
            items: [{ documentId: 'doc-current' }]
        });
        helper.closeRun(run);
        helper.writeDeleteCandidate(run, 'doc-current');
        helper.writeDeleteCandidate(run, 'doc-deleted');
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

        assert.throws(function () {
            helper.beginRun(createContext({
                targetId: 'mondou-fr',
                locale: 'fr_CA',
                language: 'fr'
            }), new Date('2026-09-02T20:00:00Z'));
        }, /already owned by another catalog export target/);
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
