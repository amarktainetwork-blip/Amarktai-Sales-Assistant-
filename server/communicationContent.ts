import {
  prepareCustomCommunication,
  resolveApprovedCommunicationTemplate,
} from "./approvedTemplates";
import type { SalesChannel } from "./communications";
import type {
  ClientActionConfiguration,
  ConfiguredTemplate,
} from "./clientActionConfiguration";

export function findConfiguredTemplate(input: {
  configuration: ClientActionConfiguration;
  channel: SalesChannel;
  request?: string;
  templateKey?: string;
}) {
  if (input.templateKey) {
    const exact = input.configuration.templates[input.templateKey];
    if (exact && exact.channel === input.channel) return exact;
  }
  if (!input.request) return undefined;
  const normalized = input.request.toLowerCase();
  return Object.values(input.configuration.templates).find(
    template =>
      template.channel === input.channel &&
      [template.key, template.templateName].some(
        value => value.length >= 3 && normalized.includes(value.toLowerCase())
      )
  );
}

/**
 * Resolves exact approved/template content independently from the transport
 * that will eventually execute it. A CRM-saved template is usable outside the
 * CRM (for example through Microsoft delegated email) only after its exact
 * subject/body have been commissioned into client configuration.
 */
export async function materializeConfiguredCommunication(input: {
  organisationId: number;
  channel: SalesChannel;
  to: string;
  template: ConfiguredTemplate;
}) {
  if (input.template.channel !== input.channel)
    throw new Error(
      `TEMPLATE_CHANNEL_MISMATCH: '${input.template.templateName}' is not approved for ${input.channel}.`
    );

  if (input.template.source === "organisation_approved") {
    const resolved = await resolveApprovedCommunicationTemplate({
      organisationId: input.organisationId,
      channel: input.channel,
      templateName: input.template.templateName,
      to: input.to,
    });
    const subject =
      input.channel === "email"
        ? input.template.requiredSubject || resolved.subject
        : undefined;
    const validated = prepareCustomCommunication({
      channel: input.channel,
      to: input.to,
      subject,
      body: resolved.body,
    });
    return {
      ...validated,
      templateName: resolved.templateName || input.template.templateName,
      contentSource: {
        kind: "organisation_approved_template" as const,
        templateKey: input.template.key,
        templateName: input.template.templateName,
        approvalTemplateId: resolved.approvalTemplateId,
        approvalTemplateVersion: resolved.approvalTemplateVersion,
      },
    };
  }

  if (!input.template.body)
    throw new Error(
      input.template.source === "crm_saved"
        ? `TEMPLATE_SOURCE_NOT_COMMISSIONED: '${input.template.templateName}' is a CRM-saved template, but its exact content has not been commissioned into the client configuration. Nothing was prepared.`
        : `TEMPLATE_CONTENT_REQUIRED: '${input.template.templateName}' has no configured exact content.`
    );
  if (input.channel === "email" && !input.template.requiredSubject)
    throw new Error(
      `TEMPLATE_SUBJECT_REQUIRED: '${input.template.templateName}' needs its exact approved subject before it can be used.`
    );

  const validated = prepareCustomCommunication({
    channel: input.channel,
    to: input.to,
    subject:
      input.channel === "email" ? input.template.requiredSubject : undefined,
    body: input.template.body,
  });
  return {
    ...validated,
    templateName: input.template.templateName,
    contentSource: {
      kind:
        input.template.source === "crm_saved"
          ? ("commissioned_crm_saved_template" as const)
          : ("client_configuration_template" as const),
      templateKey: input.template.key,
      templateName: input.template.templateName,
    },
  };
}

export function resolveConfiguredSender(input: {
  configuration: ClientActionConfiguration;
  channel: SalesChannel;
  template?: ConfiguredTemplate;
}) {
  if (input.channel === "email") return undefined;
  const approved = input.configuration.approvedSenders[input.channel] || [];
  const requested = input.template?.senderIdentity;
  if (requested) {
    if (approved.length && !approved.includes(requested))
      throw new Error(
        `SENDER_NOT_APPROVED: configured sender '${requested}' is not in the organisation's approved ${input.channel.toUpperCase()} sender list.`
      );
    return requested;
  }
  if (approved.length === 1) return approved[0];
  if (approved.length > 1)
    throw new Error(
      `SENDER_REQUIRED: choose or configure the approved ${input.channel.toUpperCase()} sender identity for this action.`
    );
  throw new Error(
    `SENDER_NOT_COMMISSIONED: configure an approved ${input.channel.toUpperCase()} sender identity before this channel can be treated as executable.`
  );
}
