# Amarktai Sales Assistant Agent Operating Model

## Purpose and authority boundary

The Sales Assistant uses specialist agents to **prepare, verify, and explain** sales work. It does not allow an agent to silently send a communication, amend a CRM record, create a calendar event, or change an opportunity. Every external action is represented as an idempotent proposal, reviewed by a person, and then attempted only through an authorised connection with retained evidence.

> A high-automation workflow is one where the assistant has already collected the relevant context, found policy conflicts, drafted the communication or CRM changes, checked for duplicate work, and assembled one clear human decision.

## Specialist agents

| Agent | Operating responsibility | Model use | Non-negotiable control |
| --- | --- | --- | --- |
| Supervisor Agent | Routes an instruction to a specialist or approved workflow and identifies missing inputs. | Deterministic | Does not bypass review-first controls. |
| Workflow Guardian | Validates sequence rules and action eligibility. | Deterministic | Blocks duplicate, unclear, or non-reviewable actions. |
| CRM Context Agent | Compacts a verified CRM read into reusable candidate context. | Policy-bound model | Does not turn CRM gaps into facts. |
| Conversation Coach | Provides one concise, factual next move during a call. | Low-context model | Never pressures a prospect or overrides opt-out signals. |
| Programme Knowledge Agent | Answers from approved programme and policy sources. | Grounded model | States when the approved sources do not support a claim. |
| Human Communications Agent | Prepares natural, company-aware email replies and controlled channel proposals. | Controlled drafting model | Drafts are reviewed; they are not sent. |
| Notes & Summary Agent | Produces CRM-ready factual call notes. | Structured model | Uses only supplied transcript or verified notes. |
| QA & Compliance Agent | Checks templates, sender requirements, duplicates, and historical-record protection. | Deterministic | Cannot approve or execute work. |
| Manager Assurance Agent | Flags blocked, overdue, stale, failed, or unreviewed work. | Deterministic | Raises findings; never changes records. |
| Sales Intelligence Agent | Identifies supported operational patterns and priorities. | Evidence-led model | Does not infer unsupported performance causes. |
| Objection Handling Agent | Prepares respectful, source-grounded objection responses. | Controlled model | No manipulation, invented social proof, or false urgency. |
| Course Recommendation Agent | Maps verified needs to approved programme knowledge. | Grounded model | Escalates eligibility and suitability decisions. |
| Multi-CRM Router Agent | Chooses only a ready connector with the required capability. | Deterministic | Blocks an unroutable proposal before review or execution. |
| Pipeline Planner Agent | Produces a prioritised, reviewable work list. | Structured model | Does not create or change CRM work. |

## Human Communications quality model

The Human Communications Agent does not simply rewrite text with a generic tone. It receives verified facts, a purpose, optional thread context, company brand voice, and any template boundary. Its policy prefers short natural language, rejects common generic AI filler, limits excessive punctuation, forbids unsupported commitments, and returns a **subject, body, and review notes**.

The quality gate checks recipient validity, a non-empty subject, body length, factual context, template-boundary compliance, robotic language, and uncontrolled punctuation. A failed check is retained with the draft so an agent can correct it before any Outlook proposal is created. An identical pending draft is also identified from its recipient, verified facts, purpose, thread context, template boundary, and approved company context; the existing review item is reused rather than creating duplicate work.

## Manager Assurance model

The Manager Assurance Agent evaluates durable workspace evidence rather than trusting an agent’s self-description. Its current check identifies blocked proposals, review decisions older than 24 hours, overdue callbacks, failed or blocked workflow runs, and call summaries waiting for review. Findings can be acknowledged or resolved, but the evidence remains in the audit trail.

## CRM workboard model

The CRM Workboard refreshes a candidate through the authorised Genie browser bridge using only read scripts. It saves a compact context snapshot for twenty minutes, then reuses that evidence across workflow preparation, coaching, and communication drafting. This prevents repeat CRM browsing and gives staff one candidate-focused picture of current CRM context, local callbacks, proposals, workflow history, and call work.

If the authorised Genie scripts have not been calibrated, the workboard permits a clearly labelled **manual verified context** entry for controlled testing. It does not present manual input as a live CRM read.

## Token-efficiency controls

| Control | Behaviour |
| --- | --- |
| Deterministic first | Policy, routing, duplicate checks, and manager finding generation run without an LLM. |
| Role-specific policy | Every model-backed agent has a distinct system policy, output contract, temperature, response budget, and model environment override. |
| Prompt compaction | Only the newest useful messages are retained inside each role’s character budget. |
| Knowledge compaction | Approved sources are bounded before being added to an agent prompt. |
| Safe short-lived reuse | Suitable responses are cacheable per workspace, agent, policy version, and compacted request hash. Drafting and live coaching are not reused. |
| Usage ledger | Provider-reported token counts are recorded when supplied; character counts remain visible where the provider omits usage. |
| CRM context reuse | A verified CRM context snapshot is reused for twenty minutes instead of re-running browser reads for each subtask. |

## Workflow coverage in this release

The deterministic library now prepares **First Contact**, **Call 2**, **Call 3**, **Call 4 / Final Attempt**, **Callback Requested**, **Booking Confirmation**, **Reschedule Requested**, **No-Show Follow-Up**, **Information Request**, **Manager Escalation**, **Cyber Post-Consultation**, and **Cyber Final Close**. Every path checks history, protects completed records, includes duplicate protection, requires factual notes where an outcome or request is asserted, and creates review-required actions.

Template names and CRM field selectors remain company configuration. A workflow will correctly block or fail visibly if an authorised Genie script, saved template, connector capability, consent check, or required evidence is not available. That is intentional: the system must not improvise a customer-facing action.
