# Legacy tenant migration inventory

The advanced CRM data model is already organisation-scoped through `connectedSystems` and normalized CRM tables. The legacy user-owned tables that need an additive transition are `integrationProfiles`, `companyProfiles`, `websiteDiscoveries`, `crmConnections`, `automationPlaybooks`, `workflowRuns`, `actionProposals`, `callbackTasks`, `callSessions`, `knowledgeSources`, `auditEntries`, and `dailyReports`.

The safe migration sequence is to add nullable organisation references and indexes, backfill each row through the sole active membership or explicit owner workspace, retain user ownership for backwards compatibility, update read/write paths to require the signed active organisation, then only enforce non-null constraints after a verifier confirms no orphaned data. Reports require special care because the background worker must fail closed for ambiguous memberships until the report has an explicit organisation owner.
