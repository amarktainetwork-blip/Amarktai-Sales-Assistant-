# Tenant isolation test scope

The existing local-auth suite covers only `AUTH_MODE` activation. The signed active-organisation implementation requires focused tests for the session claim, a single organisation being automatically selected only when unambiguous, an active organisation needing server membership verification, and a multi-membership user receiving an explicit selection-required state.
