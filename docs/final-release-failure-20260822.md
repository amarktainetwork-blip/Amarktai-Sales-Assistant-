# Final Amarktai Sales Assistant Release Validation — 2026-08-22

- Release parent: `984a2ff51e848142d03996d8febaf42768707852`
- Main parent: `20522bc1be5b90edc79892ed5ad2c192e769ea1f`
- Repository: `amarktainetwork-blip/Amarktai-Sales-Assistant-`

- frozen_install: PASS
- unit_tests: PASS
- typescript: FAIL

```text

> amarktai-sales-assistant@1.0.0 check /home/runner/work/Amarktai-Sales-Assistant-/Amarktai-Sales-Assistant-
> tsc --noEmit

client/src/pages/Connections.tsx(47,37): error TS2322: Type 'Provider' is not assignable to type '"genie" | "hubspot" | "salesforce" | "pipedrive" | "custom_browser" | "zoho"'.
  Type '"custom_api"' is not assignable to type '"genie" | "hubspot" | "salesforce" | "pipedrive" | "custom_browser" | "zoho"'.
client/src/pages/Connections.tsx(47,125): error TS2322: Type 'Method' is not assignable to type '"oauth" | "browser" | "sidecar"'.
  Type '"custom_adapter"' is not assignable to type '"oauth" | "browser" | "sidecar"'.
 ELIFECYCLE  Command failed with exit code 2.

```
- drizzle_check: PASS
- drizzle_generate: PASS
- migration_generation_clean: PASS
- production_build: PASS
- production_audit: FAIL

```text
┌─────────────────────┬────────────────────────────────────────────────────────┐
│ high                │ path-to-regexp vulnerable to Regular Expression Denial │
│                     │ of Service via multiple route parameters               │
├─────────────────────┼────────────────────────────────────────────────────────┤
│ Package             │ path-to-regexp                                         │
├─────────────────────┼────────────────────────────────────────────────────────┤
│ Vulnerable versions │ <0.1.13                                                │
├─────────────────────┼────────────────────────────────────────────────────────┤
│ Patched versions    │ >=0.1.13                                               │
├─────────────────────┼────────────────────────────────────────────────────────┤
│ Paths               │ . > express@4.22.2 > path-to-regexp@0.1.12             │
├─────────────────────┼────────────────────────────────────────────────────────┤
│ More info           │ https://github.com/advisories/GHSA-37ch-88jc-xwx2      │
└─────────────────────┴────────────────────────────────────────────────────────┘
30 vulnerabilities found
Severity: 5 low | 24 moderate | 1 high

```
- shell_syntax: PASS
- hosted_runtime_scan: PASS
- canonical_repo_docs: PASS
- generic_product_scan: FAIL

```text
deploy/webdock/genie-scripts.template.json:43:          "selector": "REPLACE_SMS_SENDER_447428000560_SELECTOR"

```
- user_facing_connector_truth: PASS
- connector_api_allowlist: PASS
- public_connection_copy: PASS
- compose_full: PASS
- compose_pilot: PASS
- docker_build: PASS
- runtime_contents: PASS
- diff_check: PASS

FAILURES=3
