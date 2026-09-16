# Phase 1 customer and work data contract

Canonical client facts live in organisation settings and companyProfiles. `config/client-packs/course2career.json` is the reviewed initial client pack, applied through `applyClientConfiguration` with an organisation manager. It contains no executable templates, workflows or sender identities. Existing approved knowledge is preserved. Generic services never branch on client names or IDs.

## API

- `sales.workspaceContext`: organisation name/timezone/locale/currency, customer model, product priorities, business facts, mapped customer fields, backlog policy and actual normalized record availability. Counts are organisation-wide capability context, not personal queue counts.
- `sales.configureWorkspace`: manager-authorized model, regional settings and mappings; preserves unrelated organisation settings.
- `sales.customerDirectory`: server-side owner-scoped search, stable name/updated sort, page/pageSize (maximum 100), exact filtered total and owner-scoped totalAll. No giant nested browser payload.
- `sales.customerDetail`: exact internal contact ID, organisation, connected system and active mapped owner; independent task/history/activity/opportunity/company/inbound queries scoped to that contact. Relations have explicit page limits and totals where stored. A person without a company or opportunity is valid.
- `sales.refreshCustomerHistory`: optional explicit read-through refresh for a selected customer. Revalidates source ownership; reads notes/conversation messages without changing read state; stores only the internal normalized activity cache. Coverage declares complete versus recent-page communications. Unsupported adapters fail closed.
- Legacy `sales.customers` returns a bounded compatibility view through the same directory/detail services. New callers must use the page envelope.
- Today returns `workspace` and `taskData`: full scoped incomplete/overdue/dueToday/unknown/backlog counts and bounded queues. Local calendar boundaries include DST. Unknown task state is not actionable; completed source flags override stale open labels. Default backlog policy includes all incomplete work; an explicit manager cutoff reports historical backlog separately.
- Draft-only communications create Review proposals with draftOnly/reviewRequired true and executionReady false even without a mailbox. Unrouted drafts cannot execute. A routed draft rechecks its current route and sender before existing execution permission, suppression, duplicate and source checks. Drafting never authorizes a send.

## Tenant read evidence, 16 September 2026

Full exact-owner task drain: 30,926 tasks, 30,714 completed, 212 open, 0 unknown; 30,691 completed past due and 3 open past due at audit time. 310 pages. Counts can change as the salesperson works.

Full exact-owner opportunity drain: 5,605 opportunities, 57 pages. Source pipelines: 3. The previous normalized zero was a skipped browser source-scoping/mapping gap, not proof of absence. The structured reader validates owner and location on every page and uses exclusive cursor pagination. Stages and terminal status are preserved independently.

Contacts search total: 23,957. First 100 all have source and custom fields; 98 have tags. Metadata returned 36 custom fields. The pack maps only observed IDs and labels; values remain source data, never inferred business claims.

Selected-contact discovery over 15 exact-owner contacts found 2 notes, 14 conversation records and email/SMS/call/source-event message types. Notes and conversations are mapped through the explicit selected-contact history read. Email unread/inbound synchronization continues through the existing mailbox reader. No mutation request is used.

Appointments endpoint returned zero for sampled contacts; calendars metadata returned five. This proves endpoint access, not absence of appointments across the tenant, and does not enable a scheduling module. Payments returned no records for the sampled contact; no payment fact is inferred. Forms/submissions returned HTTP 401 with the session. Document lookup returned 422 and remains unproven. Companies remain optional with zero normalized rows; no company is manufactured from a person.

Platform references are conceptual only; tenant availability comes from authenticated reads:

- https://marketplace.gohighlevel.com/docs/ghl/opportunities/search-opportunity/
- https://marketplace.gohighlevel.com/docs/ghl/contacts/notes/
- https://marketplace.gohighlevel.com/docs/ghl/conversations/get-messages/index.html

External write capabilities remain empty. All Phase 1 source operations are GET or authenticated POST searches. No task completion, callback, note, stage, message or other source mutation is commissioned by this change.
