# SFCC Coveo Catalog Ingestion

This repository contains the SFCC cartridges used to export catalog data to Coveo through the Stream API. The maintained upstream for this ingestion-only package is intended to live in `Coveo-Turbo/sfcc-coveo-catalog-ingestion`.

## What This Repo Contains

- `bm_coveo` for Business Manager job step definitions
- `int_coveo` for server-side catalog selection, payload generation, validation, and Stream API submission
- rolling purchase enrichment support that can generate shared IMPEX snapshots and inject dynamic `ec_units_sold_<window>d` fields into product exports

The storefront sample integration that existed in the archived `coveo/SFCC-Cartridge` repository is intentionally removed from this maintained version.

## Export Behavior

- Full exports upload validated `addOrUpdate` batches through file containers and finish with `deleteolderthan`.
- Manifest-enabled delta exports scan current root products, compare them with sharded target state, and upload only changed `addOrUpdate` and `delete` operations. This detects deleted, unassigned, offline, non-searchable, and scheduled-status transitions.
- Purchase enrichment can generate a rolling Usage Analytics export, aggregate purchased units by `ec_product_id`, store a shared snapshot per `trackingId`, and let full or delta exports emit dynamic `ec_units_sold_<window>d` fields on exported `Product` items.
- Catalog structure is target-aware:
  - `product_only` is the default and emits only `Product` items; variant-backed rows merge the variant attributes into the `Product`, set `ec_product_id = permanentid = ec_sku = <variant SKU>`, omit `ec_variant_id`, and keep grouping through `ec_item_group_id = <master ID>`
  - `product_variant` preserves the current model with `Product` plus `Variant` items
- Product and variant identifiers follow the modern Coveo Commerce schema:
  - `Product` items always use `ec_product_id`
  - `Variant` items use both `ec_product_id` and `ec_variant_id` when the target runs in `product_variant`
  - `permanentid = ec_product_id` for `Product`
  - `permanentid = ec_variant_id` for `Variant`
- `language` on every item
- `ec_price` stores the base/list price.
- `ec_promo_price` stores the effective promotional price when a discounted price is active.
- `ec_category` stores every valid online category hierarchy assigned to the exported product. Variant-backed product exports include the union of the variant and master assignments, deduplicated into a single hierarchical field value.
- `ec_primary_category` stores only the effective primary category hierarchy for the exported product.
- `ec_images` contains the first configured gallery image view type array, defaulting to `large` then `medium`.
- `ec_thumbnails` contains the first configured thumbnail image view type array, defaulting to `medium` then `large`.
- `ec_item_group_id` is populated on every exported `Product`; standalone products use their own `ec_product_id`, while grouped products use their shared parent group identifier.
- Export scope is target-aware:
  - legacy mode uses site preferences when no export targets exist
  - target mode uses `CoveoCatalogExportTarget` custom objects for `locale`, `language`, `coveoSourceId`, optional `catalogId`, optional `catalogStructureMode`, optional `productEligibilityMode`, optional `mappingProfileId`, and per-target `lastSync`
  - jobs accept an optional `targetId`; if multiple targets exist and no `targetId` is provided, the job fails fast
- Product eligibility is target-aware:
  - `legacy` is the compatibility default and preserves the historical full/delta selection behavior
  - `all` consistently exports all assigned standalone products and master variants
  - `online_and_searchable` exports only products that are effectively online and searchable in the target site context; variants also require an eligible master
  - `all` and `online_and_searchable` maintain versioned, SHA-256-checked manifest shards under `IMPEX/src/coveo/state/catalog-export/`
  - a successful full export creates the initial manifest; later deltas remove documents for products that disappear or become ineligible
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
- online/searchable master and variant eligibility
- sharded manifest promotion, locking, and recovery
- delta add/update/delete reconciliation
- catalog-scoped target selection
- full export ordering id and `deleteolderthan` flow

## Deployment Notes

- Upload only `bm_coveo` and `int_coveo`.
- Import [`metadata/metadata.zip`](metadata/metadata.zip).
- Configure `int.coveo.api.cred` with the real Push API URL and secret.
- Configure `int.coveo.platform.api.cred` with a Coveo Platform API key that can support Coveo field creation and Merchandising Hub listing-page updates.
- Configure `int.coveo.ua.read.api.cred` with a Usage Analytics Read API key that can create and download exports.
- Allow outbound connections for both the configured Coveo Push API host and the S3 host returned by file-container `uploadUri` values, such as `https://coveo-nprod-customerdata.s3.amazonaws.com`.
- Allow outbound connections to `https://platform.cloud.coveo.com` if you want to use the platform field creation job.
- Allow outbound connections to the configured Usage Analytics Read API host if you want to use the purchase enrichment job.
- Put `bm_coveo:int_coveo` on the Business Manager site cartridge path.
- Put at least `int_coveo` on each export site cartridge path. Using `bm_coveo:int_coveo` on both the Business Manager site and the export site is the simplest setup.
- Set the site-level `coveoOrganizationId`.
- Keep using site-level `coveoSourceId` and `coveoCatalogLastSync` only for the legacy single-target fallback.
- If a catalog uses non-default SFCC image view types, optionally set `coveoProductImageViewTypes` and `coveoProductThumbnailViewTypes` on the site as ordered comma-separated fallback lists, for example `large,medium,original` and `medium,large,original`.
- For multi-locale or market-specific exports, create one `CoveoCatalogExportTarget` custom object per target, use the default `product_only` mode or switch `catalogStructureMode` to `product_variant`, and select `productEligibilityMode=online_and_searchable` when Coveo must mirror storefront visibility. The exact Business Manager steps are documented in [`documentation/sandbox-setup.md`](documentation/sandbox-setup.md).
- Assign a distinct Coveo source to every export target. Full reconciliation is source-wide, and manifest-enabled runs enforce one target owner per source.
- If you need extra catalog fields beyond the built-in export payload, create a `CoveoCatalogFieldMappingProfile`, add `CoveoCatalogFieldMapping` rows under that profile, and assign the profile on the target `mappingProfileId`. For larger mapping sets, you can also load the profile and rows from JSON with the `coveoFieldMappingImport` job described in [`documentation/sandbox-setup.md`](documentation/sandbox-setup.md).
- If your mapping JSON should also create the matching Coveo fields, run `coveoPlatformFieldCreate` with the same `sourceFile`. The job creates one platform field per enabled mapping `targetField`, and the optional `coveoField` block on each mapping can set the initial field type and options.
- To maintain best-seller sort fields from Coveo Usage Analytics purchase events, run `coveoPurchaseEnrichmentSync` per target. The job creates or reuses a rolling export for one `trackingId`, stores a shared snapshot in IMPEX, and writes target-specific mapped or skipped reports. Subsequent full exports emit `ec_units_sold_<window>d` values for every product, and delta exports also include products whose units-sold values changed in the snapshot state.
- Purchase enrichment downloads and parses Usage Analytics exports as IMPEX-backed streams, writes generation-specific count files, and atomically promotes their metadata. Snapshot and target-state readers/writers are serialized by a `trackingId` lock under `IMPEX/src/coveo/state/purchase-enrichment/`; do not remove an active lock or its referenced count generation. If an interrupted instance leaves a stale lock, remove it only after confirming that no purchase sync or catalog export is using that tracking ID.
- To upload a field-mapping JSON file to IMPEX with the credentials in `dw.json`, run `npm run uploadFieldMappingsJson -- documentation/examples/default-commerce-fields.sample.json`.
- To inspect which catalog attributes are actually populated before you build mappings, run the `coveoCatalogAttributeAudit` job described in [`documentation/sandbox-setup.md`](documentation/sandbox-setup.md).
- To sync CMH listing pages, set the target's `coveoTrackingId`, `coveoCountry`, `coveoCurrency`, `storefrontBaseUrl`, and `listingCategoryUrlTemplate`, then run `coveoListingPagesSync`. If you need existing brand landing page URLs to keep resolving to `Brands|...` category pages, also set `listingBrandUrlTemplate` as an optional legacy URL alias.
- Run a full export after enabling a manifest-backed eligibility mode and after changing target scope, locale, source, structure, eligibility, or mapping profile. Delta fails fast when its active manifest fingerprint is incompatible.
- Keep `IMPEX/src/coveo/state/catalog-export/` available to all job executions. Do not delete active manifest, source-ownership, or lock files while a job is running.
- Stream updates are asynchronous after API acceptance. Validate the first full export and major policy changes in Coveo before relying on subsequent delta schedules.

See [`documentation/sandbox-setup.md`](documentation/sandbox-setup.md) for the full ingestion setup and validation flow.
