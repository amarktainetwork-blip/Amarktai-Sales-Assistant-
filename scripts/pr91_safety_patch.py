from pathlib import Path

path = Path("server/routers.ts")
text = path.read_text()

old = '''        await recordActionExecution({
          userId: ctx.user.id,
          organisationId: organisation.organisationId,
          proposalId: proposal.id,
          correlationId,
          success: result.success,
          result,
        });
        if (!result.success)
          throw new Error(
            "The email was not sent. Check your mailbox connection and try again."
          );
        return result;'''
new = '''        await recordActionExecution({
          userId: ctx.user.id,
          organisationId: organisation.organisationId,
          proposalId: proposal.id,
          correlationId,
          success: result.success,
          result,
        });
        if (!result.success) {
          const executionEvidence = result as {
            acceptedByProvider?: boolean;
            retryable?: boolean;
          };
          if (
            executionEvidence.acceptedByProvider ||
            executionEvidence.retryable === false
          )
            throw new Error(
              "Microsoft accepted this approved email, but delivery readback could not be verified. Review now marks it Failed. Do not resend it until the stable action reference is reconciled."
            );
          throw new Error(
            "The email was not sent. Check your mailbox connection and try again."
          );
        }
        return result;'''

if new not in text:
    if old not in text:
        raise SystemExit("Reviewed-email result boundary could not be located safely")
    text = text.replace(old, new, 1)

# Canonical customer-facing product spelling in this public/router boundary.
text = text.replace("Amarktai", "AmarktAI")
path.write_text(text)
