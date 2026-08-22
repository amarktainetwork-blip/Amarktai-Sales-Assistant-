# Migration 0009 review

`0009_happy_lord_tyger.sql` is additive-only. It adds nullable `organisationId` columns, foreign keys, and tenant lookup indexes to `workflowRuns` and `actionProposals`. It contains no drop, truncate, type narrowing, automatic backfill, or non-null enforcement.

All new workflow runs, reviewable action proposals, manual claims, policy-driven claims, execution finalization, workspace reports, and proposal audit access now use the signed active organisation in the server path. Newly created records therefore receive the selected organisation ID at write time and are read only from that organisation thereafter.

Existing legacy rows remain nullable by design. During target commissioning, reconcile only rows whose owner has exactly one active organisation membership. Leave zero-membership and multiple-membership rows unassigned for administrator review; never infer an organisation from a first membership or a client-supplied value. Verify the migration with `pnpm drizzle-kit check` and the Webdock deployment verifier before considering any later non-null constraint.
