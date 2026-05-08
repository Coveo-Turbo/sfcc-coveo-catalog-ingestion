'use strict';

var EventEmitter = require('events').EventEmitter;
var path = require('path');
var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();

function createResponse(statusCode, statusMessage, body) {
    var response = new EventEmitter();

    response.statusCode = statusCode;
    response.statusMessage = statusMessage;

    process.nextTick(function () {
        if (body) {
            response.emit('data', Buffer.from(body));
        }

        response.emit('end');
    });

    return response;
}

describe('uploadFieldMappingsJson script', function () {
    it('parses the local file and defaults the remote directory and name', function () {
        var script = require(path.resolve(__dirname, '../../../scripts/uploadFieldMappingsJson'));
        var args = script.parseArgs(['documentation/examples/default-commerce-fields.sample.json']);

        assert.strictEqual(args.localFile, 'documentation/examples/default-commerce-fields.sample.json');
        assert.strictEqual(args.remoteDir, 'src/coveo/config/field-mappings');
        assert.strictEqual(args.remoteName, 'default-commerce-fields.sample.json');
    });

    it('creates the remote IMPEX directories and uploads the provided file', function () {
        var requests = [];
        var script = proxyquire(path.resolve(__dirname, '../../../scripts/uploadFieldMappingsJson'), {
            fs: {
                readFileSync: function (filePath, encoding) {
                    if (filePath.indexOf('dw.json') !== -1) {
                        return JSON.stringify({
                            hostname: 'bgpn-002.dx.commercecloud.salesforce.com',
                            username: 'merchant@example.com',
                            password: 'secret'
                        });
                    }

                    if (encoding === 'utf8') {
                        return '';
                    }

                    return Buffer.from('{"profile":{"profileId":"default-commerce-fields"}}');
                },
                existsSync: function () {
                    return true;
                }
            },
            https: {
                request: function (options, callback) {
                    var request = new EventEmitter();
                    var bodyChunks = [];
                    var statusCode = options.method === 'PUT' ? 201 : 201;

                    requests.push({
                        options: options,
                        bodyChunks: bodyChunks
                    });

                    request.write = function (chunk) {
                        bodyChunks.push(chunk);
                    };
                    request.end = function () {
                        callback(createResponse(statusCode, 'Created', ''));
                    };

                    return request;
                }
            }
        });

        return script.uploadFieldMappingsJson({
            localFile: 'documentation/examples/default-commerce-fields.sample.json',
            remoteDir: 'src/coveo/config/field-mappings',
            remoteName: 'mondou-default.json'
        }).then(function (summary) {
            assert.strictEqual(summary.sourceFile, '/src/coveo/config/field-mappings/mondou-default.json');
            assert.lengthOf(requests, 5);
            assert.strictEqual(requests[0].options.method, 'MKCOL');
            assert.strictEqual(requests[0].options.path, '/on/demandware.servlet/webdav/Sites/Impex/src');
            assert.strictEqual(requests[3].options.path, '/on/demandware.servlet/webdav/Sites/Impex/src/coveo/config/field-mappings');
            assert.strictEqual(requests[4].options.method, 'PUT');
            assert.strictEqual(requests[4].options.path, '/on/demandware.servlet/webdav/Sites/Impex/src/coveo/config/field-mappings/mondou-default.json');
            assert.strictEqual(Buffer.concat(requests[4].bodyChunks).toString('utf8'), '{"profile":{"profileId":"default-commerce-fields"}}');
        });
    });
});
