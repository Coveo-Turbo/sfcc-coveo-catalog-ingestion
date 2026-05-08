'use strict';

var fs = require('fs');
var https = require('https');
var path = require('path');

var DEFAULT_REMOTE_DIR = 'src/coveo/config/field-mappings';
var WEBDAV_IMPEX_PREFIX = '/on/demandware.servlet/webdav/Sites/Impex';

/**
 * Returns a normalized string value.
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
 * Encodes a WebDAV path segment-by-segment.
 * @param {string} remotePath - Remote path relative to IMPEX.
 * @returns {string} encoded path.
 */
function encodeRemotePath(remotePath) {
    return normalizeString(remotePath)
        .split('/')
        .filter(function (segment) {
            return segment !== '';
        })
        .map(function (segment) {
            return encodeURIComponent(segment);
        })
        .join('/');
}

/**
 * Normalizes the IMPEX-relative remote directory path.
 * @param {string} remoteDir - Remote directory.
 * @returns {string} normalized path.
 */
function normalizeRemoteDir(remoteDir) {
    return normalizeString(remoteDir)
        .replace(/^\/+/, '')
        .replace(/\/+$/, '');
}

/**
 * Reads and validates the dw.json file.
 * @param {string} dwConfigPath - dw.json path.
 * @returns {Object} validated config.
 */
function loadDwConfig(dwConfigPath) {
    var config = JSON.parse(fs.readFileSync(dwConfigPath, 'utf8'));

    if (!normalizeString(config.hostname)) {
        throw new Error('dw.json is missing hostname.');
    }

    if (!normalizeString(config.username)) {
        throw new Error('dw.json is missing username.');
    }

    if (!normalizeString(config.password)) {
        throw new Error('dw.json is missing password.');
    }

    return config;
}

/**
 * Parses CLI arguments.
 * @param {Array} argv - CLI args excluding node and script path.
 * @returns {Object} parsed args.
 */
function parseArgs(argv) {
    var parsed = {
        localFile: '',
        remoteDir: DEFAULT_REMOTE_DIR,
        remoteName: ''
    };
    var index = 0;

    while (index < argv.length) {
        var arg = argv[index];

        if (arg === '--remote-dir') {
            index += 1;
            parsed.remoteDir = normalizeString(argv[index]);
        } else if (arg === '--remote-name') {
            index += 1;
            parsed.remoteName = normalizeString(argv[index]);
        } else if (arg.indexOf('--') === 0) {
            throw new Error('Unknown argument ' + arg + '.');
        } else if (!parsed.localFile) {
            parsed.localFile = normalizeString(arg);
        } else {
            throw new Error('Unexpected extra argument ' + arg + '.');
        }

        if (arg.indexOf('--') === 0 && !argv[index]) {
            throw new Error('Missing value for ' + arg + '.');
        }

        index += 1;
    }

    if (!parsed.localFile) {
        throw new Error('Usage: npm run uploadFieldMappingsJson -- <local-json-file> [--remote-name file.json] [--remote-dir src/coveo/config/field-mappings]');
    }

    parsed.remoteDir = normalizeRemoteDir(parsed.remoteDir) || DEFAULT_REMOTE_DIR;
    parsed.remoteName = parsed.remoteName || path.basename(parsed.localFile);

    return parsed;
}

/**
 * Builds the WebDAV request path.
 * @param {string} remotePath - Path relative to IMPEX.
 * @returns {string} request path.
 */
function buildWebdavPath(remotePath) {
    var encodedPath = encodeRemotePath(remotePath);

    if (!encodedPath) {
        return WEBDAV_IMPEX_PREFIX;
    }

    return WEBDAV_IMPEX_PREFIX + '/' + encodedPath;
}

/**
 * Sends an HTTPS request and resolves when the response is complete.
 * @param {Object} options - HTTPS request options.
 * @param {Buffer|string|null} body - Optional request body.
 * @returns {Promise<Object>} response details.
 */
function sendRequest(options, body) {
    return new Promise(function (resolve, reject) {
        var request = https.request(options, function (response) {
            var chunks = [];

            response.on('data', function (chunk) {
                chunks.push(chunk);
            });

            response.on('end', function () {
                resolve({
                    statusCode: response.statusCode,
                    statusMessage: response.statusMessage,
                    body: Buffer.concat(chunks).toString('utf8')
                });
            });
        });

        request.on('error', reject);

        if (body) {
            request.write(body);
        }

        request.end();
    });
}

/**
 * Creates a remote directory when needed.
 * @param {Object} connection - Connection settings.
 * @param {string} remoteDir - Directory relative to IMPEX.
 * @returns {Promise<void>} completion promise.
 */
function createRemoteDirectory(connection, remoteDir) {
    return sendRequest({
        hostname: connection.hostname,
        method: 'MKCOL',
        path: buildWebdavPath(remoteDir),
        headers: {
            Authorization: connection.authorization
        }
    }).then(function (response) {
        if (response.statusCode === 201 || response.statusCode === 405) {
            return;
        }

        throw new Error(
            'Unable to create IMPEX directory '
            + remoteDir
            + '. HTTP '
            + response.statusCode
            + ' '
            + response.statusMessage
            + (response.body ? ' - ' + response.body : '')
        );
    });
}

/**
 * Creates each segment in the configured remote directory.
 * @param {Object} connection - Connection settings.
 * @param {string} remoteDir - Directory relative to IMPEX.
 * @returns {Promise<void>} completion promise.
 */
function ensureRemoteDirectory(connection, remoteDir) {
    var segments = normalizeRemoteDir(remoteDir).split('/').filter(function (segment) {
        return segment !== '';
    });
    var chain = Promise.resolve();
    var currentPath = [];

    segments.forEach(function (segment) {
        currentPath.push(segment);
        var nextPath = currentPath.join('/');
        chain = chain.then(function () {
            return createRemoteDirectory(connection, nextPath);
        });
    });

    return chain;
}

/**
 * Uploads the local file to IMPEX.
 * @param {Object} connection - Connection settings.
 * @param {string} localFilePath - Local absolute file path.
 * @param {string} remoteDir - Remote directory relative to IMPEX.
 * @param {string} remoteName - Remote filename.
 * @returns {Promise<void>} completion promise.
 */
function uploadRemoteFile(connection, localFilePath, remoteDir, remoteName) {
    var fileBuffer = fs.readFileSync(localFilePath);

    return sendRequest({
        hostname: connection.hostname,
        method: 'PUT',
        path: buildWebdavPath(normalizeRemoteDir(remoteDir) + '/' + remoteName),
        headers: {
            Authorization: connection.authorization,
            'Content-Type': 'application/json',
            'Content-Length': fileBuffer.length
        }
    }, fileBuffer).then(function (response) {
        if (response.statusCode === 200 || response.statusCode === 201 || response.statusCode === 204) {
            return;
        }

        throw new Error(
            'Unable to upload '
            + remoteName
            + '. HTTP '
            + response.statusCode
            + ' '
            + response.statusMessage
            + (response.body ? ' - ' + response.body : '')
        );
    });
}

/**
 * Uploads a field mapping JSON file using credentials from dw.json.
 * @param {Object} options - Upload options.
 * @returns {Promise<Object>} upload summary.
 */
function uploadFieldMappingsJson(options) {
    var dwConfigPath = path.resolve(__dirname, '..', 'dw.json');
    var dwConfig = loadDwConfig(dwConfigPath);
    var localFilePath = path.resolve(process.cwd(), options.localFile);
    var remoteDir = normalizeRemoteDir(options.remoteDir);
    var remoteName = normalizeString(options.remoteName) || path.basename(localFilePath);
    var sourceFile = '/' + remoteDir + '/' + remoteName;

    if (!fs.existsSync(localFilePath)) {
        throw new Error('Local file does not exist: ' + localFilePath);
    }

    return ensureRemoteDirectory({
        hostname: dwConfig.hostname,
        authorization: 'Basic ' + Buffer.from(dwConfig.username + ':' + dwConfig.password).toString('base64')
    }, remoteDir).then(function () {
        return uploadRemoteFile({
            hostname: dwConfig.hostname,
            authorization: 'Basic ' + Buffer.from(dwConfig.username + ':' + dwConfig.password).toString('base64')
        }, localFilePath, remoteDir, remoteName);
    }).then(function () {
        return {
            hostname: dwConfig.hostname,
            localFilePath: localFilePath,
            remoteDir: remoteDir,
            remoteName: remoteName,
            sourceFile: sourceFile
        };
    });
}

/**
 * CLI entry point.
 * @returns {Promise<void>} completion promise.
 */
function main() {
    var args;

    try {
        args = parseArgs(process.argv.slice(2));
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
        return Promise.resolve();
    }

    return uploadFieldMappingsJson(args).then(function (summary) {
        console.log('Uploaded ' + summary.localFilePath + ' to IMPEX on ' + summary.hostname + '.');
        console.log('Use this job parameter value:');
        console.log('sourceFile=' + summary.sourceFile);
    }).catch(function (error) {
        console.error(error.message || error);
        process.exitCode = 1;
    });
}

if (require.main === module) {
    main();
}

module.exports = {
    DEFAULT_REMOTE_DIR: DEFAULT_REMOTE_DIR,
    buildWebdavPath: buildWebdavPath,
    encodeRemotePath: encodeRemotePath,
    main: main,
    parseArgs: parseArgs,
    uploadFieldMappingsJson: uploadFieldMappingsJson
};
