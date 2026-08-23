# Tenant migration format notes

The repository uses sequential Drizzle MySQL migration files with explicit `--> statement-breakpoint` separators and a version-7 journal. The next tenant-scoping migration must be appended after `0006_sidecar_sessions`, must only add nullable columns, indexes, and foreign keys initially, and must backfill deterministically before any later non-null enforcement. Existing migration files will not be rewritten.
