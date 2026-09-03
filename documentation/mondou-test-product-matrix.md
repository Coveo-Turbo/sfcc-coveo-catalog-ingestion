# Mondou Catalog Reconciliation Test Matrix

This matrix records candidates observed on the `bgpn-002` instance on 2026-09-03. The evidence came from all 34 read-only IMPEX artifacts produced by the completed `coveoMondouProductExportFull` job for target `mondou-en-ca`, including 21,486 English documents; no catalog data was changed while preparing this list.

## Scope and interpretation

- Site context: `Mondou` job context / `Mondou_CA` storefront URL context
- Catalog: `mondou_CA-storefront`
- Locale and language: `en_CA` / `en`
- Catalog structure: `product_only`
- The payload maps raw SFCC `onlineFlag` to `ec_online_flag` and raw `searchable` to `ec_searchable`.
- The current payload does not contain `onlineFrom` or `onlineTo`. Those values must be copied from Business Manager immediately before testing.
- In SFCC, the product ID is the SKU identifier. Variant-backed rows also emit that value explicitly as `ec_sku`; standalone rows in this payload do not emit `ec_sku`.
- Presence in this full payload does not prove effective storefront eligibility. The payload includes offline products, consistent with an `all` eligibility run.

## Candidate matrix

| Test row | SFCC product ID / SKU | Master ID | Starting flags from payload | Catalog/category assignment | Expected Coveo identifiers | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Standard A | `1015841` | — | `onlineFlag=true`; `searchable=true`; dates not exported | `mondou_CA-storefront`; primary `Dog > Accessories > Toys`; also `Dog > Accessories > Play Outside` | `documentId=https://bgpn-002.my.commercecloud.salesforce.com/s/Mondou_CA/en-CA/red-floating-balloon-1015841.html`; `ec_product_id=1015841`; `ec_item_group_id=1015841` | Verified from 2026-09-03 payload |
| Standard B | `1015955` | — | `onlineFlag=false`; `searchable=true`; dates not exported | `mondou_CA-storefront`; primary `Cat > Food & Treats > Treats > Other treats`; also Greenies brand categories | `documentId=https://bgpn-002.my.commercecloud.salesforce.com/s/Mondou_CA/en-CA/hairball-control-formula-treats-1015955.html`; `ec_product_id=1015955`; `ec_item_group_id=1015955` | Verified from 2026-09-03 payload |
| Standard C | No confirmed standard product in the completed export | — | Eight English rows have `onlineFlag=true` and `searchable=false`: master-like `MD1028513` plus seven variants belonging to `MD1037470` | `MD1028513` is assigned to `Dog > Treats > Dehydrated` and related categories; the seven variants are assigned to `products` | Closest candidate: `documentId=https://bgpn-002.my.commercecloud.salesforce.com/s/Mondou_CA/en-CA/jerky-treats-for-dogs-chicken-and-sweet-potato-MD1028513.html`; `ec_product_id=MD1028513`; `ec_item_group_id=MD1028513` | **Unfilled:** `MD1028513` follows the Mondou master-ID convention and has no `ec_sku`; the other seven rows explicitly have variant SKUs and `ec_item_group_id=MD1037470`. Confirm `MD1028513` in Business Manager, but do not treat it as Standard C unless its SFCC type is Standard. |
| Scheduled D | Deferred | — | Not evaluated | — | — | Deferred from the current test matrix |
| Master E | `MD1035226` | — | Master flags and dates are not represented by the variant-backed product rows | `mondou_CA-storefront`; variants are assigned to `Dog > Accessories > Toys` and `CLEARANCE` | The master has no separate Coveo document in `product_only`; it is the shared `ec_item_group_id=MD1035226` | Verify master `onlineFlag=true`, `searchable=true`, dates, and assignment in Business Manager |
| Variant E1 | `1035227` | `MD1035226` | `onlineFlag=true`; `searchable=true`; dates not exported | `mondou_CA-storefront`; primary `Dog > Accessories > Toys`; also `CLEARANCE` | `documentId=https://bgpn-002.my.commercecloud.salesforce.com/s/Mondou_CA/en-CA/swirl-ball-for-dogs-1035227.html`; `ec_product_id=1035227`; `ec_item_group_id=MD1035226`; `ec_sku=1035227` | Verified from 2026-09-03 payload |
| Variant E2 | `1035226` | `MD1035226` | `onlineFlag=false`; `searchable=true`; dates not exported | `mondou_CA-storefront`; primary `Dog > Accessories > Toys`; also `CLEARANCE` | `documentId=https://bgpn-002.my.commercecloud.salesforce.com/s/Mondou_CA/en-CA/swirl-ball-for-dogs-1035226.html`; `ec_product_id=1035226`; `ec_item_group_id=MD1035226`; `ec_sku=1035226` | Verified from 2026-09-03 payload; master eligibility still needs confirmation |
| Disposable F | `000bundle` is a possible unassignment candidate only | — | `onlineFlag=false`; `searchable=true`; dates not exported | `mondou_CA-storefront`; assigned only to `Autoship` in the payload; no primary category | `documentId=https://bgpn-002.my.commercecloud.salesforce.com/s/Mondou_CA/en-CA/test-bundle-og-000bundle.html`; `ec_product_id=000bundle`; `ec_item_group_id=000bundle` | Name is `Test Bundle OG`, but ownership and dependencies are unverified. Obtain Mondou approval before unassigning it. Do not physically delete it. |

## Required pre-test Business Manager checks

Immediately before the test, open each selected product under `mondou_CA-storefront` and record:

1. Product type, especially `MD1028513`, `MD1035226`, and `000bundle`.
2. Raw Online flag, effective online state, Searchable flag, `onlineFrom`, and `onlineTo`.
3. All category assignments and the primary category.
4. For `MD1035226`, confirm that the master is online/searchable and that variants `1035227` and `1035226` remain attached.
5. For `000bundle`, confirm with the Mondou catalog owner that temporary unassignment is safe and inspect bundle/dependency references.

The completed 2026-09-03 English payload does not contain another online/non-searchable standalone candidate. If Business Manager confirms that `MD1028513` is a master, Standard C requires either selecting a standard product outside this export or temporarily changing an owner-approved disposable standard product to non-searchable. Scheduled D is deferred.

## Destructive-test rule

Do not delete a real Mondou product to validate reconciliation. Use an owner-approved existing test product only for a reversible category unassignment. For physical deletion, clone or create a disposable product, record its identifiers, run the test, and delete only that disposable copy.
