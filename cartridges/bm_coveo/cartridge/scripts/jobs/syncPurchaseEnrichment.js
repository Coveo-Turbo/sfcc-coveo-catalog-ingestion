'use strict';

var Logger = require('dw/system/Logger').getLogger('Coveo');
var Status = require('dw/system/Status');

var exportTargetHelper = require('*/cartridge/scripts/helper/exportTargetHelper');
var purchaseEnrichmentHelper = require('*/cartridge/scripts/helper/purchaseEnrichmentHelper');

/**
 * Executes the rolling purchase enrichment sync for one export target.
 * @param {Object} parameters - Job step parameters.
 * @returns {dw.system.Status} execution status.
 */
exports.execute = function (parameters) {
    var exportContext = null;
    var previousLocale = '';
    var summary = null;

    try {
        exportContext = exportTargetHelper.resolveExportContext(parameters);
        previousLocale = exportTargetHelper.applyRequestLocale(exportContext);

        Logger.info(
            'Resolved Coveo purchase enrichment context - site={0}, targetId={1}, locale={2}, language={3}, source={4}, trackingId={5}, catalog={6}',
            exportContext.siteId,
            exportContext.targetId || '[single target]',
            exportContext.locale,
            exportContext.language,
            exportContext.coveoSourceId,
            exportContext.coveoTrackingId || '[missing]',
            exportContext.catalogId || '[site catalog]'
        );

        summary = purchaseEnrichmentHelper.syncPurchaseEnrichment(parameters, exportContext);

        return new Status(
            Status.OK,
            'OK',
            'Purchase enrichment snapshot synced successfully. exportId='
                + summary.exportId
                + ', field='
                + summary.fieldName
                + ', mappedProducts='
                + summary.mappedProducts
                + '.'
        );
    } catch (error) {
        Logger.error('Coveo purchase enrichment sync failed. {0}', error.message || error);
        return new Status(Status.ERROR, 'ERROR', error.message || String(error));
    } finally {
        exportTargetHelper.restoreRequestLocale(previousLocale);
    }
};
