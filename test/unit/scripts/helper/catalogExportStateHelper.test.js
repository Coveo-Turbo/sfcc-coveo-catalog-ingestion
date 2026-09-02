'use strict';

var path = require('path');
var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();

function createFileSystemStubs() {
    var files = {};

    function File(filePath) {
        this.fullPath = filePath;
        this.path = filePath;
        this.name = filePath.split('/').pop();
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
    var helper = proxyquire(path.resolve(__dirname, '../../../../cartridges/int_coveo/cartridge/scripts/helper/catalogExportStateHelper'), {
        'dw/io/File': fileSystem.File,
        'dw/io/FileReader': fileSystem.FileReader,
        'dw/io/FileWriter': fileSystem.FileWriter
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
            payloadChecksum: '123'
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

    it('removes shards from the replaced generation after pointer promotion', function () {
        var fixture = createHelper();
        var helper = fixture.helper;
        var context = createContext();
        var firstRun = helper.beginRun(context, new Date('2026-09-02T18:00:00Z'));

        helper.writeRootRecord(firstRun, 'ROOT-1', ['doc-1']);
        var firstManifest = helper.promoteRun(firstRun);
        var firstShardPath = '/IMPEX' + helper.DEFAULT_STATE_PATH + firstManifest.shardFiles[Object.keys(firstManifest.shardFiles)[0]];

        var secondRun = helper.beginRun(context, new Date('2026-09-02T19:00:00Z'));
        helper.writeRootRecord(secondRun, 'ROOT-2', ['doc-2']);
        helper.promoteRun(secondRun);

        assert.isFalse(Object.prototype.hasOwnProperty.call(fixture.fileSystem.files, firstShardPath));
    });
});
