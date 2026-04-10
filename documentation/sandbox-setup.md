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

`dw.json` is intentionally ignored from git in this repo. Start from the checked-in template:

```sh
cp dw.example.json dw.json
```

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
- the custom object types used for export targets and field mappings
- the `int.coveo.http.api` service definition
- the product export jobs

The tracked `metadata/metadata` folder is the source used to build `metadata/metadata.zip`, so it stays in source control on purpose.

## 4. Assign the cartridge path

You need cartridge-path updates in two places:

- on the Business Manager site, so the custom job step types are available
- on each export site, so wildcard script resolution like `require('*/cartridge/...')` can find `int_coveo` when the job runs in that site context

Recommended setup:

`bm_coveo:int_coveo`

Apply it like this:

1. On the Business Manager site cartridge path, put `bm_coveo:int_coveo` at the beginning.
2. On each export site cartridge path, put at least `int_coveo` at the beginning.

Using `bm_coveo:int_coveo` on both the Business Manager site and the export site is acceptable and is the simplest option.

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
- optional `mappingProfileId`
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
- `mappingProfileId`: leave empty to keep the built-in mapped fields only; set it when this target should add a configurable mapping profile
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

## 7B. Create configurable field mappings in Business Manager

Use this step only when you need extra exported fields beyond the built-in payload.

The export always keeps the built-in item schema and built-in mapped fields:

- built-in payload fields like `documentId`, `permanentid`, `ec_product_id`, `ec_variant_id`, `language`, and `objecttype`
- built-in mapped field `ec_name`

Configurable mappings are additive only. They can add fields such as `ec_material`, `ec_collection`, or `ec_department`, but they cannot override reserved export fields.

Use this Business Manager flow:

1. Confirm the custom object types `CoveoCatalogFieldMappingProfile` and `CoveoCatalogFieldMapping` exist under `Administration > Site Development > Custom Object Types`.
2. Switch the site selector to the site you want to export.
3. Open the custom object editor.
4. Create a new object of type `CoveoCatalogFieldMappingProfile`.
5. Set the unique ID to the profile key you want to use, for example `default-commerce-fields`.
6. Fill the profile attributes:
   - `profileId`: the same unique ID, for example `default-commerce-fields`
   - `siteId`: exact SFCC site ID, for example `RefArch`
   - `enabled`: set to `true`
   - `label`: optional display label
   - `notes`: optional operator notes
7. Create one `CoveoCatalogFieldMapping` object per mapping row that belongs to that profile.

Each mapping row should define:

- `mappingId`: unique key for the row, for example `material`
- `siteId`: exact SFCC site ID
- `profileId`: the owning profile ID, for example `default-commerce-fields`
- `enabled`: set to `true`
- `sortOrder`: optional numeric-like string such as `10`, `20`, `30`
- `appliesTo`: one of `Product`, `Variant`, or `Both`
- `sourceObject`: one of `product`, `masterProduct`, or `primaryCategory`
- `sourceScope`: `system` or `custom`
- `sourceAttributeId`: the attribute ID to read from that source
- `targetField`: the Coveo field to emit when a value resolves
- `valueMode`: one of `raw`, `displayValue`, or `displayValueArray`

Supported source patterns in this phase:

- `product`
  - current exported product or variant object
- `masterProduct`
  - current variant's master product when present
- `primaryCategory`
  - the effective primary category for the exported item

Typical examples:

- product custom material:
  - `appliesTo=Both`
  - `sourceObject=product`
  - `sourceScope=custom`
  - `sourceAttributeId=material`
  - `targetField=ec_material`
  - `valueMode=raw`
- master-product collection:
  - `appliesTo=Variant`
  - `sourceObject=masterProduct`
  - `sourceScope=custom`
  - `sourceAttributeId=collection`
  - `targetField=ec_collection`
  - `valueMode=raw`
- category department code:
  - `appliesTo=Both`
  - `sourceObject=primaryCategory`
  - `sourceScope=custom`
  - `sourceAttributeId=departmentCode`
  - `targetField=ec_department`
  - `valueMode=raw`

After the profile and mapping rows exist:

1. Open the `CoveoCatalogExportTarget` object that should use them.
2. Set `mappingProfileId` to the profile key, for example `default-commerce-fields`.
3. Save the target.
4. Run `coveoProductExportFull` for that target and inspect the output JSON.

Recommended starter profile:

- profile:
  - `profileId=default-commerce-fields`
  - `siteId=<your site ID>`
  - `enabled=true`
- optional starter mappings:
  - `mappingId=gender`
  - `profileId=default-commerce-fields`
  - `siteId=<your site ID>`
  - `appliesTo=Both`
  - `sourceObject=primaryCategory`
  - `sourceScope=custom`
  - `sourceAttributeId=sizeChartID`
  - `targetField=gender`
  - `valueMode=raw`
  - `enabled=true`
  - `sortOrder=10`
  - `mappingId=material`
  - `profileId=default-commerce-fields`
  - `siteId=<your site ID>`
  - `appliesTo=Both`
  - `sourceObject=product`
  - `sourceScope=custom`
  - `sourceAttributeId=material`
  - `targetField=ec_material`
  - `valueMode=raw`
  - `enabled=true`
  - `sortOrder=20`
  - `mappingId=collection`
  - `profileId=default-commerce-fields`
  - `siteId=<your site ID>`
  - `appliesTo=Variant`
  - `sourceObject=masterProduct`
  - `sourceScope=custom`
  - `sourceAttributeId=collection`
  - `targetField=ec_collection`
  - `valueMode=raw`
  - `enabled=true`
  - `sortOrder=30`

Use this starter profile only as a template. Do not create these rows unless the referenced attributes actually exist in your SFCC catalog model.

Important behavior:

- leaving `mappingProfileId` empty keeps the built-in export behavior only
- if `mappingProfileId` points to a missing or disabled profile, the job fails before export starts
- only enabled mapping rows for the current site and selected profile are applied
- duplicate `targetField` values in one profile are rejected
- reserved export fields cannot be overridden from configuration

## 8. Configure the Commerce catalog mappings

After the first successful import, verify the catalog configuration or source mappings in Coveo:

- Product identifier maps to `ec_product_id`
- Variant identifier maps to `ec_variant_id`
- Grouping maps to `ec_item_group_id`
- Item type maps to `objecttype`
- `permanentid` maps to the `permanentid` metadata key emitted by the export
- `language` maps to the `language` metadata key emitted by the export
- Base price maps to `ec_price`
- Promotional price maps to `ec_promo_price` if you want Coveo to recognize promotional pricing

Remove any mapping that still uses the legacy `ec_productid` field.

If automatic catalog mappings do not resolve the standard field names correctly, add explicit mappings for:

- `ec_product_id`
- `ec_variant_id`
- `ec_item_group_id`
- `objecttype`
- `permanentid`
- `language`
- `ec_price`
- `ec_promo_price`

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

## Important note about the imported job site context

The metadata archive no longer imports placeholder site preference values, so configure all ingestion preferences on your actual target site.

The job metadata still ships with `RefArch` as the example site context. If your sandbox does not have `RefArch`, update the imported jobs in Business Manager to use your real site ID before running them.

## Recommended first-run sequence

1. Copy `dw.example.json` to `dw.json` and fill in the real values.
2. Run `npm run uploadCartridge`.
3. Import `metadata/metadata.zip`.
4. Update the Business Manager site cartridge paths for both the Business Manager site and the export site.
5. Activate the uploaded code version.
6. Configure the `int.coveo.api.cred` service credential URL and password.
7. Set the real Coveo org on the target site.
8. If you need multi-locale or market-specific exports, create the `CoveoCatalogExportTarget` objects and note their `targetId` values.
9. If you need extra mapped fields, create `CoveoCatalogFieldMappingProfile` and `CoveoCatalogFieldMapping` objects, then assign `mappingProfileId` on the target.
10. Verify the Commerce catalog mappings use `ec_product_id` and `ec_variant_id`.
11. Run `coveoProductExportFull`, adding `targetId` when you are exporting a specific target.
12. Inspect the exported JSON under IMPEX and confirm the payload uses `addOrUpdate`, `ec_product_id`, `ec_variant_id`, the expected `language`, and any configured extra fields.
13. Inspect the indexed content in the Coveo Content Browser and catalog inspection views.
14. Only after the full sync validates, run `coveoProductExportDelta` for the same resolved target.

## Validation checklist

After the full catalog update, inspect at least:

- one standalone product
- one master product with multiple colors
- one variant under that grouped product

Confirm that:

- `Product` items contain `ec_product_id`
- `Variant` items contain both `ec_product_id` and `ec_variant_id`
- `Product` items set `permanentid = ec_product_id`
- `Variant` items set `permanentid = ec_product_id`
- every item contains `language`
- `language` matches the configured export target
- `ec_price` contains the base or list price
- `ec_promo_price` is present only when the current sell price is lower than the base price
- `ec_images` is an array of `large` gallery images
- `ec_thumbnails` is an array of `medium` images
- standalone products export only a `Product` item
- grouped products share `ec_item_group_id = <masterID>`
- when a target uses `catalogId`, only that catalog subset reaches the configured source
- when a target uses `mappingProfileId`, only that target receives the configured extra mapped fields
