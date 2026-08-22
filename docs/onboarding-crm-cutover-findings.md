# Onboarding CRM cutover findings

The legacy onboarding page uses `companySetup.get`, `saveProfile`, `discoverWebsite`, `confirmDiscovery`, `registerCrm`, and `savePlaybook`. Its CRM step lets the client describe capabilities and stores an older `crmConnections` record, which is not the canonical readiness model.

The canonical `connectedSystems` service is organisation-scoped, encrypts secrets server-side, requires management membership for changes, records verification evidence, and is the only backend component permitted to transition a connection to `ready`. The onboarding replacement must therefore drive connection creation, credential configuration, verification, sync, and readiness from this model and must never accept a client-provided ready status.
