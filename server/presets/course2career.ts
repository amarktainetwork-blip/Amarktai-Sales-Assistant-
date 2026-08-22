/**
 * Optional migration package for an organisation that explicitly confirms it
 * owns these templates, contact details, stages, and sales rules. It is never
 * imported by the generic runtime and is inactive by default.
 */
export const COURSE2CAREER_PRESET = {
  key: "course2career",
  displayName: "Course2Career migration preset",
  status: "inactive_by_default" as const,
  requiresExplicitOrganisationActivation: true,
  senderIdentity: { name: "Amelia", phone: "+447428000560" },
  officeHours: "Monday–Friday, 9am–6pm",
  templates: {
    initialFirstContactSms: "INITIAL FIRST CONTACT SMS",
    permissionToCloseEmail: "Permission to Close Your File",
    closeFileSms: "close file cyber",
    followUpEmail: "Follow-up Email Cyber",
    failedFollowUpSms: "Failed Follow-up Cyber",
    failedFollowUpWhatsapp: "tried_to_email",
  },
  stages: {
    uncontacted: "New Lead – Uncontacted",
    attemptingContact: "Attempting Contact",
    consideringOptions: "Discovery Call Completed – Considering Options",
    lostNoShow: "Lost – No Show",
    rejected: "Not a Fit / Rejected",
  },
  guardrails: ["Review every proposal before external action.", "Never reopen historical tasks or opportunities.", "Use only approved templates and the organisation-owned sender identity."],
} as const;
