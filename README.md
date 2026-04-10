# SFCC Coveo Catalog Ingestion

This repository contains the SFCC cartridges used to export catalog data to Coveo through the Stream API. The maintained upstream for this ingestion-only package is intended to live in `Coveo-Turbo/sfcc-coveo-catalog-ingestion`.

## What This Repo Contains

- `bm_coveo` for Business Manager job step definitions
- `int_coveo` for server-side catalog selection, payload generation, validation, and Stream API submission

The storefront sample integration that existed in the archived `coveo/SFCC-Cartridge` repository is intentionally removed from this maintained version.

## Export Behavior

- Full exports upload validated `addOrUpdate` batches through file containers and finish with `deleteolderthan`.
- Delta exports use the resolved export target baseline and only export changed root products.
- Product and variant identifiers follow the modern Coveo Commerce schema:
  - `ec_product_id` on `Product` and `Variant`
  - `ec_variant_id` on `Variant`
  - `permanentid = ec_product_id` for `Product`
  - `permanentid = ec_product_id` for `Variant`
- `language` on every item
- `ec_price` stores the base/list price.
- `ec_promo_price` stores the effective promotional price when a discounted price is active.
- `ec_images` contains the `large` gallery image array.
- `ec_thumbnails` contains the `medium` image array.
- Export scope is target-aware:
  - legacy mode uses site preferences when no export targets exist
  - target mode uses `CoveoCatalogExportTarget` custom objects for `locale`, `language`, `coveoSourceId`, optional `catalogId`, optional `mappingProfileId`, and per-target `lastSync`
  - jobs accept an optional `targetId`; if multiple targets exist and no `targetId` is provided, the job fails fast
- Extra mapped fields can be configured in Business Manager:
  - built-in mappings still emit `ec_name`
  - optional mapping profiles add extra fields without code changes
  - configured mappings are additive only and cannot override reserved export fields

## Local Verification

Run the targeted unit tests for the export and validation logic:

```sh
./node_modules/.bin/mocha 'test/unit/**/*.js'
```

These tests cover:

- target resolution and legacy fallback behavior
- grouped product and variant identifier generation
- absence of legacy `ec_productid`
- required `permanentid` and `language` behavior
- image gallery and thumbnail arrays
- delta baseline behavior
- catalog-scoped target selection
- full export ordering id and `deleteolderthan` flow

## Deployment Notes

- Upload only `bm_coveo` and `int_coveo`.
- Import [`metadata/metadata.zip`](metadata/metadata.zip).
- Configure `int.coveo.api.cred` with the real Push API URL and secret.
- Allow outbound connections for both the configured Coveo Push API host and the S3 host returned by file-container `uploadUri` values, such as `https://coveo-nprod-customerdata.s3.amazonaws.com`.
- Set the site-level `coveoOrganizationId`.
- Keep using site-level `coveoSourceId` and `coveoCatalogLastSync` only for the legacy single-target fallback.
- For multi-locale or market-specific exports, create one `CoveoCatalogExportTarget` custom object per target and run the jobs with the matching `targetId`. The exact Business Manager steps are documented in [`documentation/sandbox-setup.md`](documentation/sandbox-setup.md).
- If you need extra catalog fields beyond the built-in export payload, create a `CoveoCatalogFieldMappingProfile`, add `CoveoCatalogFieldMapping` rows under that profile, and assign the profile on the target `mappingProfileId`.
- Run a full export before trusting any delta export.

See [`documentation/sandbox-setup.md`](documentation/sandbox-setup.md) for the full ingestion setup and validation flow.
