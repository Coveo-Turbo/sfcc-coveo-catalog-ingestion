# SFCC Sandbox Setup for the Coveo Cartridge

This repo can upload the Coveo cartridges to an SFCC sandbox with `sgmf-scripts`.

The target storefront URL shared for testing is:

`https://bgpn-002.dx.commercecloud.salesforce.com/on/demandware.store/Sites-Site`

For local upload tooling, use the sandbox hostname only:

`bgpn-002.dx.commercecloud.salesforce.com`

## 1. Local prerequisites

- Node.js and npm installed locally.
- Repo dependencies installed with `npm install`.
- A valid `dw.json` at the repo root.
- Business Manager access that can:
  - upload code
  - activate code versions
  - import site metadata
  - edit site preferences
  - configure services
  - run jobs

`dw.json` is intentionally ignored from git in this repo.

Update the placeholders in `dw.json`:

- `username`: your Business Manager username
- `password`: your Business Manager password
- `code-version`: the code version you want to upload and activate

## 2. Upload the cartridges

Before uploading, it is worth running the export-focused unit tests locally:

```sh
./node_modules/.bin/mocha 'test/unit/**/*.js'
```

These tests cover the Stream update flow, JSON validation, Commerce identifiers, and the full-export reconcile behavior.

From the repo root:

```sh
npm run uploadCartridge
```

This uploads:

- `int_coveo`
- `bm_coveo`
- `int_coveo_sfra`
- `int_coveo_sg`
- `int_coveo_sfra_changes`
- `int_coveo_sg_changes`

For an SFRA sandbox, the important ones are:

- `bm_coveo`
- `int_coveo`
- `int_coveo_sfra`
- `int_coveo_sfra_changes`

## 3. Import the Business Manager metadata

In Business Manager, import `metadata/metadata.zip`.

This archive creates:

- custom site preferences for Coveo
- the `int.coveo.http.api` service definition
- the product export jobs

## 4. Assign the cartridge paths

In Business Manager site cartridge path, put these at the beginning:

`bm_coveo:int_coveo`

In the storefront site cartridge path, put these at the beginning for SFRA:

`int_coveo_sfra_changes:int_coveo_sfra:int_coveo`

If your storefront already has custom overlays, keep those in mind and make sure the Coveo cartridges are ordered before the cartridges they need to extend.

## 5. Activate the uploaded code version

After the upload, activate the same code version configured in `dw.json`.

This step is important because the custom job step types are defined in:

- `cartridges/bm_coveo/steptypes.json`

If the code version is not active, the Coveo job steps may not appear in Business Manager.

## 6. Configure the Coveo service credential

The metadata imports this service:

- service ID: `int.coveo.http.api`
- credential ID: `int.coveo.api.cred`

Verify that the service, profile, and credential exist in Business Manager and that the credential points to the correct regional Coveo Push API host for your organization.

The imported default base URL is:

`https://api.cloud.coveo.com/push/v1/organizations/`

Use the credential password to store the Coveo Push API key used for Stream API updates.

The site preference `coveoApiKey` is now deprecated and should not be used for push operations.

## 6a. Allow outbound connections

The Stream file-container flow uses more than one outbound host:

- the Coveo Push API host configured on `int.coveo.api.cred`
- the S3 upload host returned by the file-container `uploadUri`

In Business Manager under `Administration > Operations > Services > Outbound Connections`, allow:

- the regional Coveo Push API host you configured on the service credential
- the S3 upload host used by Coveo file containers, for example `https://coveo-nprod-customerdata.s3.amazonaws.com`

If the `uploadUri` returned by Coveo uses a different S3 host for your environment or region, allow that exact host as well.

Without these outbound-connection entries, the export can fail even when the SFCC service credential and job configuration are otherwise correct.

## 7. Configure the Coveo site preferences

The metadata creates a site preference group named `Coveo Configs`.

Set the following values on the actual storefront site you want to test:

- `coveoEnabled`
- `coveoSearchEnabled`
- `coveoSearchApiKey`
- `coveoOrganizationId`
- `coveoSourceId`
- `coveoAtomicCSSURL`
- `coveoAtomicJSURL`
- `coveoCatalogLastSync`
- `coveoSearchResponseFields`
- `coveoSearchHub`

Leave the imported sample values only as placeholders. Override them with your real Coveo organization, source, and search API key before running an export.

Recommended response fields for the sample storefront setup are:

- `ec_product_id`
- `ec_thumbnails`
- `ec_sfraquickview` or `ec_sgquickview`
- `ec_rating`
- `ec_swatch`
- `ec_color`

These are defined by the imported metadata and read by the cartridge code in:

- `metadata/meta/system-objecttype-extensions.xml` inside `metadata/metadata.zip`
- `cartridges/int_coveo/cartridge/scripts/utils/coveoConstant.js`

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

For a first test, run the full export once. The full job now performs update-based uploads and finishes with `deleteolderthan` to reconcile removed items.

Do not run the delta job before the first successful full sync because the delta export uses `coveoCatalogLastSync` as its baseline.

## Important note about your site ID

The metadata archive includes site preference values and job contexts for these site IDs:

- `RefArch`
- `SiteGenesis`

Your storefront URL suggests the current site ID may be `Site`:

`/on/demandware.store/Sites-Site`

If that is correct, do not rely on the imported sample site preferences alone. Set the Coveo preferences on your actual site in Business Manager, and verify the product export jobs are assigned to that site before running them.

## Recommended first-run sequence

1. Fill in `dw.json`.
2. Run `npm run uploadCartridge`.
3. Import `metadata/metadata.zip`.
4. Update the Business Manager site and storefront site cartridge paths.
5. Activate the uploaded code version.
6. Configure the `int.coveo.api.cred` service credential URL and password.
7. Set the real Coveo org, source, and search API key on the target site.
8. Verify the Commerce catalog mappings use `ec_product_id` and `ec_variant_id`.
9. Run `coveoProductExportFull`.
10. Inspect the exported JSON under IMPEX and confirm the payload uses `addOrUpdate`, `ec_product_id`, and `ec_variant_id`.
11. Inspect the indexed content in the Coveo content browser and catalog inspection views.
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
- `ec_images` is an array of gallery images
- `ec_thumbnails` is populated from `medium` images, while `ec_images` contains the `large` gallery images
- standalone products export only a `Product` item
- grouped product ids use the expected `<masterID>-<colorID>` shape
- grouped products share `ec_item_group_id = <masterID>`
- no item contains `ec_productid`
- the storefront still links product and swatch results correctly
- removed products disappear after a subsequent full reconcile

## References

- `package.json`
- `metadata/metadata.zip`
- `cartridges/bm_coveo/steptypes.json`
- `cartridges/int_coveo/cartridge/scripts/utils/coveoConstant.js`
