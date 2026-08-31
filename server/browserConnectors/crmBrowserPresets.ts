import type { CrmProvider } from "../crm/types";

export type CrmBrowserPreset = {
  provider: Extract<
    CrmProvider,
    "genie" | "hubspot" | "salesforce" | "pipedrive" | "zoho" | "custom_browser"
  >;
  label: string;
  defaultStartUrl?: string;
  knownHostnames: string[];
  loginHints: string[];
  mfaHints: string[];
  authenticatedHints: string[];
  navigationHints: string[];
};

const LOGIN = [
  'input[type="password"]',
  'form[action*="login" i]',
  'form[action*="signin" i]',
  '[data-testid*="login" i]',
];
const MFA = [
  'input[autocomplete="one-time-code" i]',
  'input[name*="otp" i]',
  'input[name*="verification" i]',
  'input[name*="mfa" i]',
];

export const CRM_BROWSER_PRESETS: Record<
  CrmBrowserPreset["provider"],
  CrmBrowserPreset
> = {
  genie: {
    provider: "genie",
    label: "Genie",
    defaultStartUrl: "https://genie.entrepreneurscircle.org/",
    knownHostnames: ["genie.entrepreneurscircle.org"],
    loginHints: LOGIN,
    mfaHints: MFA,
    authenticatedHints: [
      '[data-testid*="dashboard" i]',
      '[aria-label*="dashboard" i]',
      'nav a[href*="contact" i]',
      'a[href*="candidate" i]',
    ],
    navigationHints: ["contacts", "candidates", "tasks", "opportunities"],
  },
  hubspot: {
    provider: "hubspot",
    label: "HubSpot",
    defaultStartUrl: "https://app.hubspot.com/",
    knownHostnames: ["app.hubspot.com", "login.hubspot.com"],
    loginHints: LOGIN,
    mfaHints: MFA,
    authenticatedHints: [
      '[data-selenium-test*="nav" i]',
      'a[href*="contacts" i]',
    ],
    navigationHints: ["contacts", "companies", "deals", "tasks"],
  },
  salesforce: {
    provider: "salesforce",
    label: "Salesforce",
    defaultStartUrl: "https://login.salesforce.com/",
    knownHostnames: ["login.salesforce.com"],
    loginHints: LOGIN,
    mfaHints: MFA,
    authenticatedHints: [
      '[class*="oneAppNavContainer" i]',
      'a[href*="lightning" i]',
    ],
    navigationHints: ["contacts", "accounts", "opportunities", "tasks"],
  },
  pipedrive: {
    provider: "pipedrive",
    label: "Pipedrive",
    defaultStartUrl: "https://app.pipedrive.com/",
    knownHostnames: ["app.pipedrive.com"],
    loginHints: LOGIN,
    mfaHints: MFA,
    authenticatedHints: ['[data-test*="navigation" i]', 'a[href*="deals" i]'],
    navigationHints: ["contacts", "organizations", "deals", "activities"],
  },
  zoho: {
    provider: "zoho",
    label: "Zoho CRM",
    defaultStartUrl: "https://crm.zoho.com/",
    knownHostnames: ["crm.zoho.com", "accounts.zoho.com"],
    loginHints: LOGIN,
    mfaHints: MFA,
    authenticatedHints: [
      '[id*="crm" i] [role="navigation"]',
      'a[href*="tab/Leads" i]',
    ],
    navigationHints: ["leads", "contacts", "accounts", "deals", "activities"],
  },
  custom_browser: {
    provider: "custom_browser",
    label: "Other CRM",
    knownHostnames: [],
    loginHints: LOGIN,
    mfaHints: MFA,
    authenticatedHints: [],
    navigationHints: [
      "contacts",
      "companies",
      "opportunities",
      "tasks",
      "activities",
    ],
  },
};

export function crmBrowserPreset(provider: CrmProvider): CrmBrowserPreset {
  const key =
    provider in CRM_BROWSER_PRESETS
      ? (provider as CrmBrowserPreset["provider"])
      : "custom_browser";
  return CRM_BROWSER_PRESETS[key];
}
