# SFCC Catalog Ingestion

This repository contains the SFCC cartridges used to export catalog data to Coveo through the Stream API. The maintained upstream for this ingestion-only package is intended to live in `Coveo-Turbo/SFCC-Catalog-Ingestion`.

## What This Repo Contains

- `bm_coveo` for Business Manager job step definitions
- `int_coveo` for server-side catalog selection, payload generation, validation, and Stream API submission

The storefront sample integration that existed in the archived `coveo/SFCC-Cartridge` repository is intentionally removed from this maintained version.

## Export Behavior

- Full exports upload validated `addOrUpdate` batches through file containers and finish with `deleteolderthan`.
- Delta exports use `coveoCatalogLastSync` as a real baseline and only export changed root products.
- Product and variant identifiers follow the modern Coveo Commerce schema:
  - `ec_product_id` on `Product` and `Variant`
  - `ec_variant_id` on `Variant`
  - `permanentid = ec_product_id` for `Product`
  - `permanentid = ec_variant_id` for `Variant`
  - `language` on every item
- `ec_images` contains the `large` gallery image array.
- `ec_thumbnails` contains the `medium` image array.

## Local Verification

Run the targeted unit tests for the export and validation logic:

```sh
./node_modules/.bin/mocha 'test/unit/**/*.js'
```

These tests cover:

- grouped product and variant identifier generation
- absence of legacy `ec_productid`
- required `permanentid` and `language` behavior
- image gallery and thumbnail arrays
- delta baseline behavior
- full export ordering id and `deleteolderthan` flow

## Deployment Notes

- Upload only `bm_coveo` and `int_coveo`.
- Import [metadata/metadata.zip](/Users/jfallaire/Sources/PSInternal/sfcc-cartridge/metadata/metadata.zip).
- Configure `int.coveo.api.cred` with the real Push API URL and secret.
- Allow outbound connections for both the configured Coveo Push API host and the S3 host returned by file-container `uploadUri` values, such as `https://coveo-nprod-customerdata.s3.amazonaws.com`.
- Set the site-level `coveoOrganizationId` and `coveoSourceId`.
- Run a full export before trusting any delta export.

See [sandbox-setup.md](/Users/jfallaire/Sources/PSInternal/sfcc-cartridge/documentation/sandbox-setup.md) for the full ingestion setup and validation flow.
