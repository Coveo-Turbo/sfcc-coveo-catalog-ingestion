# SFCC Sandbox Setup for Coveo Catalog Ingestion

This repo uploads the ingestion-only Coveo cartridges to an SFCC sandbox with `sgmf-scripts`.

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

Set the following values on the actual site you want to export:

- `coveoOrganizationId`
- `coveoSourceId`
- `coveoCatalogLastSync`

Leave the imported sample values only as placeholders. Override them with your real Coveo organization and source values before running an export.

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

For a first test, run the full export once. The full job performs update-based uploads and finishes with `deleteolderthan` to reconcile removed items.

Do not run the delta job before the first successful full sync because the delta export uses `coveoCatalogLastSync` as its baseline.

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
7. Set the real Coveo org and source on the target site.
8. Verify the Commerce catalog mappings use `ec_product_id` and `ec_variant_id`.
9. Run `coveoProductExportFull`.
10. Inspect the exported JSON under IMPEX and confirm the payload uses `addOrUpdate`, `ec_product_id`, and `ec_variant_id`.
11. Inspect the indexed content in the Coveo Content Browser and catalog inspection views.
12. Only after the full sync validates, run `coveoProductExportDelta`.

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
- `ec_images` is an array of `large` gallery images
- `ec_thumbnails` is an array of `medium` images
- standalone products export only a `Product` item
- grouped products share `ec_item_group_id = <masterID>`
