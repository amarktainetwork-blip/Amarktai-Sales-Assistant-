import type { SkillDefinition, SkillStep } from "../../shared/skillBuilder";

type OrganisationSkillSeed = {
  key: string;
  title: string;
  definition: SkillDefinition;
};

const readContext: SkillStep[] = [
  {
    id: "read-customer",
    action: "read_customer",
    label: "Read the exact current customer",
  },
  {
    id: "read-tasks",
    action: "read_tasks",
    label: "Read current and completed tasks",
  },
  {
    id: "read-history",
    action: "read_history",
    label: "Read personal inbound and CRM activity",
  },
  {
    id: "read-opportunity",
    action: "read_opportunity",
    label: "Read the single current opportunity",
  },
];

function writeCapabilitiesForSteps(steps: SkillStep[]) {
  const capabilities = new Set<string>();
  for (const step of steps) {
    if (step.action === "prepare_note") capabilities.add("notes.write");
    if (step.action === "prepare_email") capabilities.add("email.send");
    if (step.action === "prepare_sms") capabilities.add("sms.send");
    if (step.action === "prepare_whatsapp") capabilities.add("whatsapp.send");
    if (
      step.action === "prepare_task" ||
      step.action === "complete_task_after_review"
    )
      capabilities.add("tasks.write");
    if (step.action === "prepare_contact_update")
      capabilities.add("contacts.write");
    if (step.action === "prepare_opportunity_update")
      capabilities.add("opportunities.write");
  }
  return Array.from(capabilities);
}

function definition(
  summary: string,
  trigger: string,
  steps: SkillStep[],
  input?: Partial<SkillDefinition>
): SkillDefinition {
  const requiredWriteCapabilities =
    input?.requiredWriteCapabilities || writeCapabilitiesForSteps(steps);
  return {
    schemaVersion: 1,
    kind: input?.kind || "workflow",
    source: "seed",
    summary,
    trigger,
    match: input?.match || { all: [], any: [], stopIf: [] },
    eligibility: input?.eligibility || [
      "The contact belongs to the signed-in salesperson",
      "Fresh CRM reads identify one exact customer",
    ],
    stopConditions: input?.stopConditions || [
      "The customer has replied or the live record no longer matches",
      "More than one possible target exists",
    ],
    decisionRules: input?.decisionRules || [],
    requiredReadCapabilities: input?.requiredReadCapabilities || [
      "contacts.read",
      "tasks.read",
      "activities.read",
      "opportunities.read",
    ],
    requiredWriteCapabilities,
    requiredOperations: input?.requiredOperations || [],
    requiredMappings: input?.requiredMappings || [],
    writeApproval: input?.writeApproval || {
      status: requiredWriteCapabilities.length
        ? "approval_required"
        : "not_required",
      approvedCapabilities: [],
      approvedOperations: [],
    },
    steps,
    assertions: input?.assertions || [
      "No duplicate open task is prepared",
      "No communication is sent before review",
      "Genie remains read-only until each write is separately commissioned",
    ],
    parameters: input?.parameters || {},
    demoReserved: input?.demoReserved,
  };
}

export const COURSE2CAREER_SKILL_PACK: readonly OrganisationSkillSeed[] = [
  {
    key: "four-day-new-lead-contact",
    title: "Four-day new lead contact",
    definition: definition(
      "Prepare the First Call through Call 4 sequence at different approved times, using the initial SMS only on the first attempt.",
      "A genuinely new or attempting-contact lead has one due outreach task.",
      [
        ...readContext,
        {
          id: "prepare-initial-sms",
          action: "prepare_sms",
          label: "On First Call only, prepare the approved Career Programme SMS",
          templateKey: "initial-first-contact-sms",
        },
        {
          id: "prepare-attempt-note",
          action: "prepare_note",
          label: "Prepare a factual attempted-contact note from the real call outcome",
        },
        {
          id: "prepare-next-call",
          action: "prepare_task",
          label: "Prepare only the next Call 2, Call 3 or Call 4 task",
          timingRule: "P1D within Europe/London office hours",
        },
      ],
      {
        eligibility: [
          "Status is New Lead / Uncontacted or Attempting Contact",
          "Exactly one of First Call, Call 2, Call 3 or Call 4 is open",
        ],
        stopConditions: [
          "The customer has been reached",
          "The customer has replied",
          "The lead is pitched, closed, rejected, not interested or not a fit",
        ],
      }
    ),
  },
  {
    key: "last-try-no-response-closure",
    title: "Last Try / no-response closure",
    definition: definition(
      "After the completed contact cadence and a fresh no-response check, prepare permission-to-close communications before the Lost transition.",
      "Call 4 or the configured Last Try task is complete and no response exists.",
      [
        ...readContext,
        {
          id: "prepare-permission-email",
          action: "prepare_email",
          label: "Prepare Consultant Contact Email / Permission to Close Your File",
          templateKey: "consultant-contact-email-permission-to-close",
        },
        {
          id: "prepare-close-file-message",
          action: "prepare_sms",
          label: "Prepare the programme-mapped Close File communication",
          templateKey: "close-file-by-programme",
        },
        {
          id: "prepare-lost-opportunity",
          action: "prepare_opportunity_update",
          label: "Prepare the current opportunity as Lost – No Show/No Response/Rejected with Status Lost",
        },
        {
          id: "prepare-closed-lost-programme",
          action: "prepare_contact_update",
          label: "Prepare the Closed Lost field using the original programme so the configured follow-up sequence starts",
        },
        {
          id: "complete-current-task",
          action: "complete_task_after_review",
          label: "Complete the exact current final task only after reviewed communications",
          requiredEvidence: [
            "activity_readback",
            "opportunity_readback",
            "task_readback",
          ],
        },
      ],
      {
        decisionRules: [
          "Days 1–3: no answer keeps the enquiry and opportunity open and prepares the next daily attempt",
          "Day 4 / Last Try: refresh contact, task, opportunity and reply truth before any closure",
          "Only a final unanswered attempt may enter the close-file path",
          "Required close-file communications must succeed before the final task can be completed",
        ],
        requiredMappings: [
          "Closed Lost programme field values for Cyber Security, IT Support, Project Management and Data Analytics",
          "Programme-specific close-file text templates",
        ],
        parameters: {
          lostStage: "Lost – No Show/No Response/Rejected",
          lostStatus: "Lost",
          closureReason: "No response after completed contact cadence",
          closedLostBehaviour: "Select the original programme so the configured Closed Lost sequence starts",
        },
      }
    ),
  },
  {
    key: "renewal-sequence",
    title: "Renewal sequence",
    definition: definition(
      "Run the four-stage Course2Career renewal cadence from the original enrolment date, stopping immediately when the learner has renewed.",
      "A renewal task is due for a learner approaching the 12-month access expiry date.",
      [
        ...readContext,
        {
          id: "prepare-renewal-email",
          action: "prepare_email",
          label: "Prepare the programme-specific renewal email for the current renewal stage",
          templateKey: "renewal-email-by-stage-and-programme",
        },
        {
          id: "prepare-renewal-text",
          action: "prepare_sms",
          label: "Prepare the programme-specific renewal text for the current renewal stage",
          templateKey: "renewal-text-by-stage-and-programme",
        },
        {
          id: "prepare-renewal-task-update",
          action: "prepare_task",
          label: "Keep the same renewal task open and prepare its next due date and factual description",
        },
      ],
      {
        stopConditions: [
          "The learner has already renewed",
          "The original enrolment or purchase date cannot be proven",
          "The programme cannot be identified",
          "The customer has opted out",
        ],
        decisionRules: [
          "Expiry is exactly 12 months after the original purchase or enrolment date",
          "Before every renewal communication, refresh the source truth and stop if the learner has renewed",
          "Stage 1 sends Renewal 1 email and text, keeps the same task open, and schedules the next check in 3–4 days",
          "Stage 2 sends Renewal 2 email and text only when still not renewed, then moves the same task to two days before expiry",
          "Stage 3 runs two days before expiry, sends Renewal 3 email and text only when still not renewed, then moves the same task to the actual expiry date",
          "Stage 4 runs on the actual expiry date and prepares the approved expired-access email and text only when still not renewed",
          "Discounted renewal must never be offered after its configured eligibility period",
        ],
        requiredMappings: [
          "Renewal email templates for each programme and stages 1–3",
          "Renewal text templates for each programme and stages 1–3",
          "Exact expired-access email and text templates for each programme",
          "Original Course Enrolment Date / purchase-date source",
        ],
        parameters: {
          expiryRule: "exactly 12 months after original purchase or enrolment date",
          stage1NextDue: "3–4 days after Renewal 1",
          stage2NextDue: "2 days before expiry",
          stage3NextDue: "actual expiry date",
          cyberRenewal1Email: "Renewal/Cyber Renewal 1",
          cyberRenewal1Text: "Consultant Contact Text Cyber Renewal 1",
          cyberRenewal2Email: "Renewal/Cyber Renewal 2",
          cyberRenewal2Text: "Consultant Contact Text Cyber Renewal 2",
          cyberRenewal3Email: "Renewal/Cyber Renewal 3",
          cyberRenewal3Text: "Consultant Contact Text Cyber Renewal 3",
        },
      }
    ),
  },
  {
    key: "invalid-contact-stage-1",
    title: "Invalid Contact — Stage 1 confirmed",
    definition: definition(
      "Handle only the confirmed first stage of an invalid-number lead: preserve the lead, record the failed contact attempt for review, and prepare the approved Invalid Phone Number email. The downstream process remains unconfigured until it is proven from authorised Course2Career source data.",
      "A real same-day call proves the current phone number is invalid or belongs to the wrong person.",
      [
        ...readContext,
        {
          id: "prepare-invalid-contact-attempt",
          action: "prepare_note",
          label: "Prepare a factual unsuccessful-call record for review; do not invent wording",
        },
        {
          id: "prepare-invalid-phone-email",
          action: "prepare_email",
          label: "Prepare Consultant Contact Emails / Invalid Phone Number",
          templateKey: "consultant-contact-email-invalid-phone-number",
        },
      ],
      {
        stopConditions: [
          "A corrected number is received; return to the normal First Call skill",
          "Any genuine customer response exists",
          "The live customer or opportunity cannot be identified exactly",
        ],
        decisionRules: [
          "Do not close the enquiry, task, contact or opportunity from this Stage 1 skill",
          "Do not schedule or infer a later invalid-contact step until the remaining process is confirmed from authorised tenant data",
          "Do not prepare Permission to Close, Close File, Closed Lost or Lost opportunity actions from this skill",
        ],
        requiredMappings: [
          "Consultant Contact Emails / Invalid Phone Number",
        ],
        assertions: [
          "No duplicate open task is prepared",
          "No communication is sent before review",
          "Genie remains read-only until each write is separately commissioned",
          "The downstream invalid-contact workflow is marked NEEDS_RULE_COMPLETION and is not inferred from test fixtures",
        ],
        parameters: {
          ruleCompletionStatus: "NEEDS_RULE_COMPLETION",
          confirmedScope: "Same-day invalid-number call attempt plus Invalid Phone Number email only",
          downstreamSourceRequirement: "Authorised Course2Career process evidence or live manager teaching",
        },
      }
    ),
  },
  {
    key: "answered-first-call-consultation",
    title: "Answered First Call / initial consultation",
    definition: definition(
      "Prepare the complete answered First Call workflow: understand the enquiry, use submitted answers, move the current opportunity through the correct stages, send programme information, record the consultation and create the agreed follow-up.",
      "The exact due First Call is answered and the salesperson completes the initial consultation.",
      [
        ...readContext,
        {
          id: "prepare-attempting-contact-stage",
          action: "prepare_opportunity_update",
          label: "Before the call, prepare the current opportunity transition from New Lead – Uncontacted to Attempting Contact",
        },
        {
          id: "prepare-programme-information-email",
          action: "prepare_email",
          label: "After the consultation, prepare the programme-information email that matches the proven enquiry",
          templateKey: "programme-information-email-by-programme",
        },
        {
          id: "prepare-after-call-text",
          action: "prepare_sms",
          label: "Prepare the after-call text with the actual consultant sender email and agreed follow-up day/date",
          templateKey: "after-call-text-by-programme",
        },
        {
          id: "prepare-consultation-note",
          action: "prepare_note",
          label: "Prepare factual consultation notes for the contact Notes section and follow-up task description",
        },
        {
          id: "prepare-agreed-follow-up",
          action: "prepare_task",
          label: "Prepare the correct programme-specific follow-up task using the agreed date and no invented time",
        },
        {
          id: "prepare-discovery-completed-stage",
          action: "prepare_opportunity_update",
          label: "After the completed consultation, prepare the current opportunity transition to Discovery Completed – Considering Options",
        },
        {
          id: "complete-first-call",
          action: "complete_task_after_review",
          label: "Complete the exact First Call only after the reviewed notes, follow-up and required communications are present",
          requiredEvidence: [
            "activity_readback",
            "opportunity_readback",
            "task_readback",
          ],
        },
      ],
      {
        stopConditions: [
          "The call is unanswered; branch to the Four-day new lead contact skill",
          "The number is invalid; branch to the Invalid Contact skill",
          "The customer opts out or is no longer interested; use the appropriate commissioned organisation process",
          "Programme evidence conflicts across authoritative sources; require review instead of guessing",
        ],
        decisionRules: [
          "Consult any active organisation First Call priority skill before queue ordering; this pack does not preinstall a priority rule",
          "Identify the programme from contact tags, Form 10, Form 9 or the relevant Facebook advert form",
          "Review submitted answers before the call so the salesperson does not unnecessarily repeat questions already answered",
          "Current opportunity must be New Lead – Uncontacted before preparing the pre-call Attempting Contact transition",
          "The programme-information email must match the proven programme",
          "The after-call text must acknowledge the conversation, confirm the programme email, state the actual approved consultant sender email, mention spam/junk, invite questions and include the agreed follow-up day/date",
          "Do not invent a specific follow-up time when none was agreed",
          "Call notes must remain factual and include the candidate's situation, experience, motivation, programme, funding, questions, information sent and agreed next step",
          "After the completed consultation, prepare Discovery Completed – Considering Options for the current open opportunity only",
        ],
        requiredMappings: [
          "Cyber Security programme information email: Cybersecurity Career Program Finance",
          "IT Support programme information email",
          "Project Management programme information email",
          "Data Analytics programme information email",
          "Cyber Security follow-up task: Yes No Cyber",
          "IT Support programme-specific follow-up task",
          "Project Management programme-specific follow-up task",
          "Data Analytics programme-specific follow-up task",
          "Approved after-call text/template purpose by programme",
        ],
        parameters: {
          preCallStageFrom: "New Lead – Uncontacted",
          preCallStageTo: "Attempting Contact",
          postCallStageTo: "Discovery Completed – Considering Options",
          programmeSources: "contact tags; All Fields Form 10; All Fields Form 9; relevant Facebook advert form",
          cyberProgrammeInformationEmail: "Cybersecurity Career Program Finance",
          cyberFollowUpTask: "Yes No Cyber",
        },
      }
    ),
  },
  {
    key: "same-day-evening-first-call-reattempt",
    title: "Same-day evening First Call reattempt",
    definition: definition(
      "When a morning First Call is unanswered, prepare a second attempt for the same day between 17:00 and 18:00 Europe/London, while preserving the normal four-day sequence.",
      "A First Call was attempted during the morning and the candidate did not answer.",
      [
        ...readContext,
        {
          id: "rank-funded-evening-reattempt",
          action: "set_internal_priority",
          label: "Give additional internal priority when the candidate confirmed they can fund the training",
          inputs: { priorityWhenFundingReady: "very_high" },
        },
        {
          id: "prepare-morning-no-answer-note",
          action: "prepare_note",
          label: "Prepare the factual unsuccessful morning call note",
          requiresInput: ["morningCallOutcome"],
        },
        {
          id: "prepare-evening-reattempt",
          action: "prepare_task",
          label: "Prepare rescheduling of the existing First Call for the same day between 17:00 and 18:00",
          timingRule: "same day; target 17:00 Europe/London; never later than 18:00",
          inputs: {
            operationKey: "custom.write.task_reschedule",
            preserveExistingTask: true,
          },
        },
      ],
      {
        match: {
          all: [
            {
              source: "task",
              field: "title",
              operator: "equals",
              value: "First Call",
            },
            {
              source: "history",
              field: "lastCallOutcome",
              operator: "equals",
              value: "no_answer",
            },
          ],
          any: [],
          stopIf: [
            {
              source: "history",
              field: "customerResponded",
              operator: "equals",
              value: true,
            },
          ],
        },
        decisionRules: [
          "The same-day evening reattempt is additional and never replaces the following day's attempt in the four-consecutive-day sequence",
          "Funding-ready candidates receive additional queue priority for the evening reattempt",
          "Keep the opportunity at Attempting Contact while the candidate remains unanswered",
          "If the evening call is answered, branch to the normal answered First Call consultation skill",
          "If the evening call is unanswered, continue the normal four-day contact sequence and do not close early",
        ],
        requiredWriteCapabilities: ["notes.write"],
        requiredOperations: ["custom.write.task_reschedule"],
        requiredMappings: [
          "Genie operation that reschedules the existing task without completing or duplicating it",
        ],
        parameters: {
          timezone: "Europe/London",
          eveningWindowStart: "17:00",
          eveningWindowEnd: "18:00",
          opportunityStageWhileUnanswered: "Attempting Contact",
          suggestedFundingReadyNote:
            "First Call attempted this morning. Candidate did not answer. Same-day reattempt required between 5:00 p.m. and 6:00 p.m. Candidate confirmed that they are able to fund their training.",
        },
        assertions: [
          "The existing First Call remains open",
          "The evening reattempt is scheduled for the same local day and not after 18:00",
          "A second unanswered call still leaves the lead in the normal four-day sequence",
        ],
      }
    ),
  },
  {
    key: "opportunity-ownership-guard",
    title: "Opportunity ownership guard",
    definition: definition(
      "Before any Course2Career opportunity create or update is saved, ensure Amelia is the Opportunity Owner and not merely a follower.",
      "Any governed action is about to create or update an opportunity.",
      [
        {
          id: "read-opportunity-owner",
          action: "read_opportunity",
          label: "Read the exact current opportunity and owner before the write",
        },
        {
          id: "prepare-required-owner",
          action: "prepare_opportunity_update",
          label: "Prepare owner assignment to Amelia before the opportunity change is saved",
          inputs: {
            ownerDisplayName: "Amelia",
            followerDoesNotSatisfy: true,
          },
        },
      ],
      {
        kind: "guard",
        match: {
          all: [
            {
              source: "opportunity",
              field: "pendingWrite",
              operator: "exists",
            },
          ],
          any: [],
          stopIf: [],
        },
        decisionRules: [
          "This guard applies to every opportunity create/update and every stage, including New Lead – Uncontacted, Attempting Contact, Discovery Completed – Considering Options, Lost stages and renewal/enrolment stages",
          "Being listed under Followers never satisfies the Owner requirement",
          "The owner check must happen before the opportunity write is saved",
        ],
        requiredReadCapabilities: ["opportunities.read", "owners.read"],
        requiredWriteCapabilities: ["opportunities.write", "owners.write"],
        requiredMappings: [
          "Exact Genie owner identity / external owner ID for Amelia",
        ],
        parameters: {
          requiredOwnerDisplayName: "Amelia",
          ownerField: "Owner",
          followersAreNotOwners: "true",
        },
        assertions: [
          "No opportunity-changing workflow may pass this guard unless Amelia is the exact Owner",
          "Owner assignment is verified by readback before the governed opportunity workflow is considered complete",
        ],
      }
    ),
  },
  {
    key: "it-support-failed-contact-communications",
    title: "IT Support failed-contact communications",
    definition: definition(
      "For IT Support Technician failed-contact communications, use the approved general templates but tailor and validate them so no other programme is mentioned.",
      "A failed-contact email or text is required for an IT Support enquiry.",
      [
        {
          id: "read-it-support-contact",
          action: "read_customer",
          label: "Verify that the current enquiry is IT Support",
        },
        {
          id: "prepare-it-failed-contact-email",
          action: "prepare_email",
          label: "Prepare Failed Contact General with the required IT Support opening line",
          templateKey: "Failed Contact General",
          inputs: {
            openingLineOverride:
              "I hope this message finds you well. I recently tried reaching out about your IT Support inquiry with us and didn’t want you to miss out on this exciting opportunity.",
            requiredPhrase: "IT Support inquiry",
            forbiddenProgrammeReferences:
              "Cyber Security|Project Management|Data Analytics",
          },
        },
        {
          id: "prepare-it-failed-contact-text",
          action: "prepare_sms",
          label: "Prepare the approved general failed-contact text tailored to the IT Support inquiry",
          templateKey: "it-support-general-failed-contact-text",
          inputs: {
            requiredPhrase: "IT Support inquiry",
            forbiddenProgrammeReferences:
              "Cyber Security|Project Management|Data Analytics",
          },
        },
      ],
      {
        match: {
          all: [
            {
              source: "customer",
              field: "courseInterest",
              operator: "equals",
              value: "IT Support",
            },
          ],
          any: [],
          stopIf: [],
        },
        decisionRules: [
          "The base email is Failed Contact General",
          "Replace the opening line with the exact Amy-supplied IT Support wording",
          "Review the entire email and text before sending and block the action if Cyber Security, Project Management, Data Analytics or another programme remains",
          "The text must clearly say that the contact relates to the person's IT Support inquiry",
        ],
        requiredMappings: [
          "Exact current Genie general failed-contact text template to use for IT Support",
        ],
        assertions: [
          "Prepared email contains the exact required IT Support opening line",
          "Prepared email and text contain IT Support inquiry",
          "Prepared email and text contain no other programme reference",
        ],
      }
    ),
  },
  {
    key: "it-support-whatsapp-template",
    title: "IT Support WhatsApp template",
    definition: definition(
      "Use the approved Missed Call WhatsApp template for IT Support enquiries, tailor it specifically to the IT Support inquiry and validate that no other programme remains.",
      "A WhatsApp message is required for an IT Support enquiry.",
      [
        {
          id: "read-it-support-whatsapp-contact",
          action: "read_customer",
          label: "Verify that the current enquiry is IT Support",
        },
        {
          id: "prepare-it-support-whatsapp",
          action: "prepare_whatsapp",
          label: "Prepare Missed Call WhatsApp tailored to the IT Support inquiry",
          templateKey: "Missed Call WhatsApp",
          inputs: {
            requiredPhrase: "IT Support inquiry",
            forbiddenProgrammeReferences:
              "Cyber Security|Project Management|Data Analytics",
          },
        },
      ],
      {
        match: {
          all: [
            {
              source: "customer",
              field: "courseInterest",
              operator: "equals",
              value: "IT Support",
            },
          ],
          any: [],
          stopIf: [],
        },
        decisionRules: [
          "Use Missed Call WhatsApp because Course2Career currently has no dedicated IT Support WhatsApp template",
          "Tailor the message so it clearly refers to the recipient's IT Support inquiry",
          "Block the prepared message if Cyber Security, Project Management, Data Analytics or another programme remains",
        ],
        assertions: [
          "The prepared WhatsApp originates from the approved Missed Call WhatsApp template",
          "The final prepared text says IT Support inquiry",
          "No other programme reference remains",
        ],
      }
    ),
  },
  {
    key: "post-consultation-follow-up",
    title: "Existing post-consultation follow-up",
    definition: definition(
      "Prepare the answered or no-answer post-consultation path using Failed Follow-Up templates, never first-contact content.",
      "An existing post-consultation follow-up task is due.",
      [
        ...readContext,
        {
          id: "prepare-follow-up-note",
          action: "prepare_note",
          label: "Prepare the factual follow-up outcome",
        },
        {
          id: "prepare-follow-up-email",
          action: "prepare_email",
          label: "For no answer, prepare the programme-specific Failed Follow-Up email",
          templateKey: "failed-follow-up-email-by-programme",
        },
        {
          id: "prepare-follow-up-message",
          action: "prepare_whatsapp",
          label: "For no answer, prepare the approved programme-specific follow-up message",
          templateKey: "failed-follow-up-message-by-programme",
        },
        {
          id: "prepare-agreed-next-step",
          action: "prepare_task",
          label: "Preserve the exact agreed follow-up date and time",
        },
      ]
    ),
  },
  {
    key: "due-call-task-awareness",
    title: "Due call and task awareness",
    definition: definition(
      "Surface overdue and due-today First Call, Call 2, Call 3, Call 4, consultation, callback, post-pitch and final-attempt work without inventing completion.",
      "The signed-in salesperson opens Today or asks what is due.",
      [
        ...readContext,
        {
          id: "rank-due-work",
          action: "set_internal_priority",
          label: "Rank due work internally from due time, response and opportunity evidence without changing Genie",
        },
      ],
      {
        assertions: [
          "A future callback never proves a current task complete",
          "Overdue work remains visible until a real outcome exists",
          "Only salesperson-owned records are included",
        ],
      }
    ),
  },
] as const;

export const COURSE2CAREER_LIVE_DEMO_RESERVATION = {
  key: "elcas-ppc-live-teaching-demonstration",
  title: "ELCAS / PPC production skill",
  definition: definition(
    "Reserved for Amelia to teach live: due First Call leads tagged ELCAS or PPC become very-high-priority in AmarktAI's internal queue, while the salesperson remains free to choose another lead.",
    "A due First Call task has an ELCAS or PPC tag.",
    [
      {
        id: "read-live-lead",
        action: "read_customer",
        label: "Read the exact authorised demonstration lead and tags",
      },
      {
        id: "read-live-task",
        action: "read_tasks",
        label: "Verify the exact due First Call task",
      },
      {
        id: "apply-live-priority",
        action: "set_internal_priority",
        label: "Set AmarktAI internal queue priority to very high without changing Genie",
        inputs: { priority: "very_high" },
      },
    ],
    {
      kind: "priority",
      match: {
        all: [
          {
            source: "task",
            field: "title",
            operator: "equals",
            value: "First Call",
          },
          {
            source: "task",
            field: "dueState",
            operator: "equals",
            value: "due",
          },
        ],
        any: [
          {
            source: "customer",
            field: "tags",
            operator: "contains",
            value: "ELCAS",
          },
          {
            source: "customer",
            field: "tags",
            operator: "contains",
            value: "PPC",
          },
        ],
        stopIf: [],
      },
      decisionRules: [
        "Matching leads are recommended above ordinary due First Calls",
        "After prioritisation, the normal contact, qualification and four-day call-attempt process applies",
        "The user remains in control and may choose another lead",
      ],
      assertions: [
        "ELCAS and PPC each result in very-high internal priority",
        "Unrelated tags do not match",
        "Non-First-Call work does not match",
        "No production skill is preinstalled or activated before the live teaching demonstration",
      ],
      demoReserved: true,
    }
  ),
} as const;
