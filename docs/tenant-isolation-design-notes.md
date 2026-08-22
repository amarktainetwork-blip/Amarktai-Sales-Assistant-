# Tenant isolation design notes

The local session currently contains only the authenticated user identifier. `ensureDefaultOrganisation()` silently returns the first active membership, which is acceptable only for one-time bootstrap provisioning and is not safe as the access context for a user who belongs to more than one organisation.

The active-organisation implementation will use a signed JWT claim, established at local sign-in and replaced only after the server verifies an active membership. It will add current, list, and switch APIs, preserve lazy creation only for a user with no membership, and route tenant-sensitive REST and tRPC operations through the explicit signed membership resolver.
