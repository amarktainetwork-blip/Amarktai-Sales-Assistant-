# Migration 0007 review

`0007_worthless_microchip.sql` is additive-only. It adds nullable `organisationId` columns, foreign keys, and tenant lookup indexes to `integrationProfiles`, `companyProfiles`, `websiteDiscoveries`, `crmConnections`, and `automationPlaybooks`. It contains no drop, truncate, type narrowing, or non-null enforcement.

The migration deliberately leaves existing rows nullable. A separate reconciliation command will backfill only rows whose user has exactly one active organisation membership, while zero- and multi-membership rows remain explicit exceptions. This avoids both an unsafe arbitrary assignment and a failed first-install migration when legacy data is incomplete.
