from pathlib import Path

path = Path("server/routers.ts")
text = path.read_text()

old_email = '''        await recordActionExecution({
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
new_email = '''        await recordActionExecution({
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

if new_email not in text:
    if old_email not in text:
        raise SystemExit("Reviewed-email result boundary could not be located safely")
    text = text.replace(old_email, new_email, 1)

old_workflow = '''    prepareWorkflow: secondFactorProcedure
      .input(workflowInput)
      .mutation(async ({ ctx, input }) => {
        const plan = buildWorkflowPlan(input);
        const organisation = ctx.activeOrganisation;
        if (!organisation)
          throw new Error(
            "Choose an organisation before preparing workflow actions."
          );
        const systems = await listConnectedSystemsForUser(
          ctx.user.id,
          organisation.organisationId
        );
        const routedActions = routeConnectedSystemActions(
          plan.actions,
          systems
        );
        const workflowRunId = await createWorkflowRun({
          userId: ctx.user.id,
          organisationId: organisation.organisationId,
          workflowKey: input.workflowKey,
          leadLabel: input.leadLabel,
          payload: input,
          verificationSummary: plan.verificationSummary,
          actions: routedActions,
        });
        return {
          workflowRunId,
          verificationSummary: plan.verificationSummary,
          actionCount: routedActions.length,
          blockedActionCount: routedActions.filter(
            action =>
              (action.payload.crmRoute as { routable?: boolean } | undefined)
                ?.routable === false
          ).length,
        };
      }),'''
new_workflow = '''    prepareWorkflow: secondFactorProcedure
      .input(workflowInput)
      .mutation(() => {
        throw new Error(
          "Legacy workflow preparation is disabled. Use the governed Assistant with an exact CRM customer context."
        );
      }),'''

if new_workflow not in text:
    if old_workflow not in text:
        raise SystemExit("Legacy prepareWorkflow boundary could not be located safely")
    text = text.replace(old_workflow, new_workflow, 1)

text = text.replace('import { buildWorkflowPlan } from "./workflowRules";\n', "")

# Canonical customer-facing product spelling in this public/router boundary.
text = text.replace("Amarktai", "AmarktAI")
path.write_text(text)
