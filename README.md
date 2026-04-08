# SFCC Cartridge

This repository contains the SFCC cartridges used to export catalog data to Coveo and wire Coveo storefront search into the sample SFRA and SiteGenesis integrations.

## Maintenance

The original public upstream `coveo/SFCC-Cartridge` is archived. Ongoing maintenance for this modernization effort should live in `coveops/SFCC-Cartridge`.

## What Changed

This refactor updates both the ingestion flow and the catalog payload to match current Coveo Commerce expectations.

- Full exports now upload validated Stream `addOrUpdate` batches through file containers and finish with `deleteolderthan`.
- Delta exports now use `coveoCatalogLastSync` as a real baseline and only export changed root products.
- The payload now uses modern Commerce identifiers:
  - `ec_product_id` on all `Product` and `Variant` items
  - `ec_variant_id` on all `Variant` items
  - `ec_item_group_id` for grouped master products
  - `permanentid` aligned with the item identifier:
    - `ec_product_id` for `Product` items
    - `ec_variant_id` for `Variant` items
  - `language` on every item
- Legacy `ec_productid` is no longer emitted.
- Exported JSON is validated before upload so malformed product/variant relationships fail early.
- Push API credentials now come from the SFCC service credential instead of the site preference.

## Export Model

The current export behavior is:

- Standalone products export as one `Product` item with `ec_product_id = product.ID`.
- Master products export one displayable `Product` per distinct color group.
- Grouped product ids use the shape `<masterID>-<colorID>`.
- Variant items point back to their parent grouped product through `ec_product_id` and carry their own `ec_variant_id = variant.ID`.
- Product items set `permanentid = ec_product_id`, while Variant items set `permanentid = ec_variant_id`.
- Every exported item includes the site language derived from the default locale.
- Grouped product families share `ec_item_group_id = master.ID`.

## Key Files

- [exportProducts.js](/Users/jfallaire/Sources/PSInternal/sfcc-cartridge/cartridges/bm_coveo/cartridge/scripts/jobs/exportProducts.js)
- [exportProductsDelta.js](/Users/jfallaire/Sources/PSInternal/sfcc-cartridge/cartridges/bm_coveo/cartridge/scripts/jobs/exportProductsDelta.js)
- [productRequestGenerator.js](/Users/jfallaire/Sources/PSInternal/sfcc-cartridge/cartridges/int_coveo/cartridge/scripts/generators/productRequestGenerator.js)
- [catalogExportValidator.js](/Users/jfallaire/Sources/PSInternal/sfcc-cartridge/cartridges/int_coveo/cartridge/scripts/helper/catalogExportValidator.js)
- [sandbox-setup.md](/Users/jfallaire/Sources/PSInternal/sfcc-cartridge/documentation/sandbox-setup.md)

## Local Verification

Run the targeted unit tests for the export and validation logic:

```sh
./node_modules/.bin/mocha 'test/unit/**/*.js'
```

These tests cover:

- grouped product and variant identifier generation
- absence of legacy `ec_productid`
- JSON validation rules
- delta baseline behavior
- full export ordering id and `deleteolderthan` flow

## Deployment Notes

- Import [metadata/metadata.zip](/Users/jfallaire/Sources/PSInternal/sfcc-cartridge/metadata/metadata.zip) after uploading the cartridges.
- Configure `int.coveo.api.cred` with the real Push API URL and secret.
- Allow outbound connections for both the configured Coveo Push API host and the S3 host returned by file-container `uploadUri` values, such as `https://coveo-nprod-customerdata.s3.amazonaws.com`.
- Verify the Coveo catalog mappings use `ec_product_id`, `ec_variant_id`, `ec_item_group_id`, and `objecttype`.
- Verify the source mappings also map `permanentid` and `language`.
- Run a full export before trusting any delta export.

See [sandbox-setup.md](/Users/jfallaire/Sources/PSInternal/sfcc-cartridge/documentation/sandbox-setup.md) for the full deployment and validation sequence.
