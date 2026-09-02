import {
  delegatedMicrosoftGraphRequest,
  getDelegatedMailboxAccess,
} from "./delegatedMailbox";

type SentMessage = {
  id?: string;
  subject?: string;
  sentDateTime?: string;
  internetMessageHeaders?: Array<{ name?: string; value?: string }>;
  toRecipients?: Array<{ emailAddress?: { address?: string } }>;
};

type SentPage = {
  value?: SentMessage[];
  "@odata.nextLink"?: string;
};

function matchingReference(message: SentMessage, reference: string) {
  return (message.internetMessageHeaders || []).some(
    header =>
      header.name?.toLowerCase() === "x-amarktai-review-reference" &&
      header.value === reference
  );
}

/**
 * Bounded external reconciliation for delegated email. The stable review
 * reference is written into the message header before send and can therefore
 * prove that a retry has already reached Microsoft Sent Items.
 */
export async function findDelegatedSentMailByReference(input: {
  userId: number;
  organisationId: number;
  reviewReference: string;
}) {
  const reference = input.reviewReference.trim();
  if (!reference) throw new Error("A stable email review reference is required.");
  const mailbox = await getDelegatedMailboxAccess(input);
  const query = new URLSearchParams({
    $top: "50",
    $orderby: "sentDateTime desc",
    $select:
      "id,subject,sentDateTime,toRecipients,internetMessageHeaders",
  });
  let next: string | undefined =
    `/me/mailFolders/sentitems/messages?${query.toString()}`;
  let inspected = 0;
  while (next && inspected < 100) {
    const page = await delegatedMicrosoftGraphRequest<SentPage>(
      mailbox.accessToken,
      next
    );
    const rows = page.value || [];
    for (const message of rows) {
      inspected += 1;
      if (matchingReference(message, reference))
        return {
          found: true as const,
          mailbox: mailbox.email,
          messageId: message.id || null,
          subject: message.subject || null,
          sentDateTime: message.sentDateTime || null,
          recipients: (message.toRecipients || [])
            .map(item => item.emailAddress?.address)
            .filter((value): value is string => Boolean(value)),
        };
      if (inspected >= 100) break;
    }
    next = page["@odata.nextLink"];
  }
  return {
    found: false as const,
    mailbox: mailbox.email,
    inspected,
  };
}

export async function waitForDelegatedSentMailReadback(input: {
  userId: number;
  organisationId: number;
  reviewReference: string;
}) {
  for (const delay of [0, 250, 650]) {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    const result = await findDelegatedSentMailByReference(input);
    if (result.found) return result;
  }
  return findDelegatedSentMailByReference(input);
}
