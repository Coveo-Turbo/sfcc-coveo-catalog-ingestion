# SFCC Sandbox Setup for Coveo Catalog Ingestion

This repo documents how to upload and configure the ingestion-only cartridges from `sfcc-coveo-catalog-ingestion` in an SFCC sandbox with `sgmf-scripts`.

## 1. Local prerequisites

- Node.js and npm installed locally
- repo dependencies installed with `npm install`
- a valid `dw.json` at the repo root
- Business Manager access that can:
  - upload code
  - activate code versions
  - import site metadata
  - edit site preferences
  - configure services
  - run jobs

`dw.json` is intentionally ignored from git in this repo.

## 2. Upload the cartridges

Before uploading, run the export-focused unit tests locally:

```sh
./node_modules/.bin/mocha 'test/unit/**/*.js'
```

From the repo root:

```sh
npm run uploadCartridge
```

This uploads:

- `int_coveo`
- `bm_coveo`

## 3. Import the Business Manager metadata

In Business Manager, import `metadata/metadata.zip`.

This archive creates:

- custom site preferences for ingestion
- the `int.coveo.http.api` service definition
- the product export jobs

## 4. Assign the cartridge path

In the Business Manager site cartridge path, put these at the beginning:

`bm_coveo:int_coveo`

## 5. Activate the uploaded code version

After the upload, activate the same code version configured in `dw.json`.

This step is important because the custom job step types are defined in:

- `cartridges/bm_coveo/steptypes.json`

## 6. Configure the Coveo service credential

The metadata imports this service:

- service ID: `int.coveo.http.api`
- credential ID: `int.coveo.api.cred`

Verify that the service, profile, and credential exist in Business Manager and that the credential points to the correct regional Coveo Push API host for your organization.

The imported default base URL is:

`https://api.cloud.coveo.com/push/v1/organizations/`

Use the credential password to store the Coveo Push API key used for Stream API updates.

## 6a. Allow outbound connections

The Stream file-container flow uses more than one outbound host:

- the Coveo Push API host configured on `int.coveo.api.cred`
- the S3 upload host returned by the file-container `uploadUri`

In Business Manager under `Administration > Operations > Services > Outbound Connections`, allow:

- the regional Coveo Push API host you configured on the service credential
- the S3 upload host used by Coveo file containers, for example `https://coveo-nprod-customerdata.s3.amazonaws.com`

If the `uploadUri` returned by Coveo uses a different S3 host for your environment or region, allow that exact host as well.

## 7. Configure the Coveo site preferences

The metadata creates a site preference group named `Coveo Catalog Ingestion`.

Always set the following value on the actual site you want to export:

- `coveoOrganizationId`

If you are staying on the legacy single-target model, also set:

- `coveoSourceId`
- `coveoCatalogLastSync`

If you are using multi-target exports, create one `CoveoCatalogExportTarget` custom object per locale or market instead of relying on the site-level `coveoSourceId` and `coveoCatalogLastSync`.

Leave the imported sample values only as placeholders. Override them with your real Coveo organization and source values before running an export.

Each `CoveoCatalogExportTarget` should define:

- `targetId`
- `siteId`
- `locale`
- `language`
- `coveoSourceId`
- optional `catalogId`
- `enabled`
- per-target `lastSync`
- optional `label` or `notes`

## 7A. Create export targets in Business Manager

Multi-target export setup involves three things:

1. Import the latest metadata so the `CoveoCatalogExportTarget` custom object type exists.
2. Create one custom object instance per export target for the current site.
3. Run the full or delta job with the matching `targetId` when you want a specific target.

In practice, an export target is just a Business Manager custom object record that tells the job:

- which site it belongs to
- which SFCC locale to use
- which Coveo `language` value to emit
- which Coveo source to push to
- optionally which catalog to scope to

Use this Business Manager flow:

1. Import [`metadata/metadata.zip`](../metadata/metadata.zip) from `Administration > Site Development > Site Import & Export`.
2. Confirm the custom object type exists under `Administration > Site Development > Custom Object Types`.
3. Look for `CoveoCatalogExportTarget`. If it is missing, re-import the metadata or create the type manually from [`metadata/metadata/meta/custom-objecttype-definitions.xml`](../metadata/metadata/meta/custom-objecttype-definitions.xml).
4. Switch the Business Manager site selector to the site you want to export.
5. Open the custom object editor. In most Business Manager setups this is under `Merchant Tools > Site Preferences > Custom Objects` or `Merchant Tools > Site Development > Custom Object Editor`.
6. Create a new object of type `CoveoCatalogExportTarget`.
7. Set the object key to the value you want to use as `targetId`, for example `refarch-en-ca`.
8. Fill the remaining attributes on the object.

Use these values when creating the object:

- `targetId`: unique key for the target, shown in Business Manager as the required unique ID, and the value you will pass to the job
- `siteId`: exact SFCC site ID, for example `RefArch`
- `locale`: exact SFCC locale ID, for example `en_CA` or `fr_CA`
- `language`: language sent to Coveo, for example `en` or `fr`
- `coveoSourceId`: destination Coveo source for this locale or market
- `catalogId`: leave empty for shared-catalog mode; set it only when this target must export a specific catalog
- `enabled`: set to `true`
- `lastSync`: leave empty before the first successful full export
- `label`: optional human-friendly display name
- `notes`: optional operator notes

Create one object per target. Typical examples:

- shared catalog with two locales:
  - `refarch-en-ca` with `locale=en_CA`, `language=en`, source A
  - `refarch-fr-ca` with `locale=fr_CA`, `language=fr`, source B
- different catalogs per market:
  - `refarch-en-us` with `locale=en_US`, `language=en`, `catalogId=us-catalog`, source A
  - `refarch-fr-ca` with `locale=fr_CA`, `language=fr`, `catalogId=ca-fr-catalog`, source B

After the objects exist, run the jobs like this:

1. Open `Administration > Operations > Jobs`.
2. Open `coveoProductExportFull` for the first sync or `coveoProductExportDelta` for later syncs.
3. Set the step parameter `targetId` to the object key you created, for example `refarch-fr-ca`.
4. Run the job.

Important behavior:

- if no export targets exist, the jobs use the legacy site-level `coveoSourceId` and `coveoCatalogLastSync`
- if one target exists for the site, the jobs can resolve it automatically
- if multiple targets exist for the site, pass `targetId` explicitly or the job fails with a configuration error
- each target maintains its own `lastSync`, so delta runs stay isolated per locale or market

## 8. Configure the Commerce catalog mappings

After the first successful import, verify the catalog configuration or source mappings in Coveo:

- Product identifier maps to `ec_product_id`
- Variant identifier maps to `ec_variant_id`
- Grouping maps to `ec_item_group_id`
- Item type maps to `objecttype`
- `permanentid` maps to the `permanentid` metadata key emitted by the export
- `language` maps to the `language` metadata key emitted by the export

Remove any mapping that still uses the legacy `ec_productid` field.

If automatic catalog mappings do not resolve the standard field names correctly, add explicit mappings for:

- `ec_product_id`
- `ec_variant_id`
- `ec_item_group_id`
- `objecttype`
- `permanentid`
- `language`

## 9. Run the first product export

The metadata imports two jobs:

- `coveoProductExportFull`
- `coveoProductExportDelta`

Both jobs now accept an optional `targetId` parameter:

- when no targets exist, the jobs use the legacy site-level source and sync state
- when one target exists, the jobs automatically use that target
- when multiple targets exist, pass `targetId` explicitly or the job fails fast

For a first test, run the full export once. The full job performs update-based uploads and finishes with `deleteolderthan` to reconcile removed items for the resolved target source only.

Do not run the delta job before the first successful full sync because the delta export uses the resolved target `lastSync` baseline.

## Important note about sample site IDs

The metadata archive includes placeholder site preference values for:

- `RefArch`
- `SiteGenesis`

These are examples only. Configure the ingestion preferences on your actual target site before running exports.

## Recommended first-run sequence

1. Fill in `dw.json`.
2. Run `npm run uploadCartridge`.
3. Import `metadata/metadata.zip`.
4. Update the Business Manager site cartridge path.
5. Activate the uploaded code version.
6. Configure the `int.coveo.api.cred` service credential URL and password.
7. Set the real Coveo org on the target site.
8. If you need multi-locale or market-specific exports, create the `CoveoCatalogExportTarget` objects and note their `targetId` values.
9. Verify the Commerce catalog mappings use `ec_product_id` and `ec_variant_id`.
10. Run `coveoProductExportFull`, adding `targetId` when you are exporting a specific target.
11. Inspect the exported JSON under IMPEX and confirm the payload uses `addOrUpdate`, `ec_product_id`, `ec_variant_id`, and the expected `language`.
12. Inspect the indexed content in the Coveo Content Browser and catalog inspection views.
13. Only after the full sync validates, run `coveoProductExportDelta` for the same resolved target.

## Validation checklist

After the full catalog update, inspect at least:

- one standalone product
- one master product with multiple colors
- one variant under that grouped product

Confirm that:

- `Product` items contain `ec_product_id`
- `Variant` items contain both `ec_product_id` and `ec_variant_id`
- `Product` items set `permanentid = ec_product_id`
- `Variant` items set `permanentid = ec_variant_id`
- every item contains `language`
- `language` matches the configured export target
- `ec_images` is an array of `large` gallery images
- `ec_thumbnails` is an array of `medium` images
- standalone products export only a `Product` item
- grouped products share `ec_item_group_id = <masterID>`
- when a target uses `catalogId`, only that catalog subset reaches the configured source
