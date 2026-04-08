# SFCC Cartridge

This repository contains the SFCC cartridges used to export catalog data to Coveo and wire Coveo storefront search into the sample SFRA and SiteGenesis integrations.

## Maintenance

The original public upstream `coveo/SFCC-Cartridge` is archived. Ongoing maintenance for this modernization effort should live in `coveops/SFCC-Cartridge`.

## Focus of this refactor

- move full catalog syncs to Stream update operations with `deleteolderthan`
- make delta exports truly incremental
- align export payloads to the modern Coveo Commerce catalog schema
- validate exported JSON before upload
- refresh metadata and setup documentation to match the new mapping and credential model

See [sandbox-setup.md](/Users/jfallaire/Sources/PSInternal/sfcc-cartridge/documentation/sandbox-setup.md) for deployment and validation steps.
