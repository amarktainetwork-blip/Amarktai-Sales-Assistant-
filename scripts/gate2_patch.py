from pathlib import Path


def replace_once(text: str, old: str, new: str, already: str, label: str) -> str:
    if old in text:
        return text.replace(old, new, 1)
    if already in text:
        return text
    raise SystemExit(f"{label} could not be located safely")


crm = Path("client/src/pages/CrmWorkspace.tsx")
text = crm.read_text()
text = replace_once(
    text,
    'import DashboardLayout from "@/components/DashboardLayout";',
    'import DashboardLayout from "@/components/DashboardLayout";\nimport InlineCrmReview from "@/components/InlineCrmReview";',
    'InlineCrmReview from "@/components/InlineCrmReview"',
    "Inline Review import",
)
text = replace_once(
    text,
    '  const [assistantResult, setAssistantResult] = useState<string | null>(null);',
    '  const [assistantResult, setAssistantResult] = useState<string | null>(null);\n  const [assistantWorkflowRunId, setAssistantWorkflowRunId] = useState<number | null>(null);',
    "assistantWorkflowRunId",
    "Assistant workflow state",
)
text = replace_once(
    text,
    '''      const result = await askAssistant.mutateAsync({
        viewerSessionId: session.viewerSessionId,
        command: assistantPrompt.trim(),
      });
      setAssistantResult(result.summary);
      setAssistantPrompt("");
    } catch (error) {
      setAssistantResult(
        friendlyError(error, "Amarktai could not complete that request.")
      );
    }''',
    '''      setAssistantWorkflowRunId(null);
      const result = await askAssistant.mutateAsync({
        viewerSessionId: session.viewerSessionId,
        command: assistantPrompt.trim(),
      });
      setAssistantResult(result.summary);
      setAssistantWorkflowRunId(
        typeof result.workflowRunId === "number" ? result.workflowRunId : null
      );
      setAssistantPrompt("");
    } catch (error) {
      setAssistantWorkflowRunId(null);
      setAssistantResult(
        friendlyError(error, "Amarktai could not complete that request.")
      );
    }''',
    'typeof result.workflowRunId === "number"',
    "Assistant result workflow handoff",
)
text = replace_once(
    text,
    '''              {assistantResult ? (
                <div className="mt-3 rounded-xl border border-[#D7E0EA] bg-white p-3 text-sm leading-6 text-[#33445B]">
                  {assistantResult}
                </div>
              ) : null}

              <details className="mt-4 rounded-xl border border-[#D7E0EA] bg-white">''',
    '''              {assistantResult ? (
                <div className="mt-3 rounded-xl border border-[#D7E0EA] bg-white p-3 text-sm leading-6 text-[#33445B]">
                  {assistantResult}
                </div>
              ) : null}

              <InlineCrmReview workflowRunId={assistantWorkflowRunId} />

              <details className="mt-4 rounded-xl border border-[#D7E0EA] bg-white">''',
    '<InlineCrmReview workflowRunId={assistantWorkflowRunId} />',
    "Inline Review render point",
)
crm.write_text(text)

routers = Path("server/routers.ts")
text = routers.read_text()
text = replace_once(
    text,
    '''        const result = await executeApprovedCrmAction({
          organisationId: organisation.organisationId,
          proposal,
          correlationId,
        });
        await recordActionExecution({
          userId: ctx.user.id,
          organisationId: organisation.organisationId,
          proposalId: proposal.id,
          correlationId,
          success: result.success,
          result,
        });
        if (!result.success)
          throw new Error(`CRM action failed: ${result.detail}`);
        return result;''',
    '''        let result;
        try {
          result = await executeApprovedCrmAction({
            organisationId: organisation.organisationId,
            proposal,
            correlationId,
          });
        } catch (error) {
          const failure = {
            success: false,
            detail:
              error instanceof Error
                ? error.message
                : "The approved CRM action failed before verified readback.",
            correlationId,
            retryable: false,
            unverifiedFailure: true,
          };
          await recordActionExecution({
            userId: ctx.user.id,
            organisationId: organisation.organisationId,
            proposalId: proposal.id,
            correlationId,
            success: false,
            result: failure,
          });
          throw new Error(
            "The approved action could not be verified. It is marked Failed in Review; do not retry it blindly."
          );
        }
        await recordActionExecution({
          userId: ctx.user.id,
          organisationId: organisation.organisationId,
          proposalId: proposal.id,
          correlationId,
          success: result.success,
          result,
        });
        if (!result.success)
          throw new Error(`CRM action failed: ${result.detail}`);
        return result;''',
    "unverifiedFailure: true",
    "Approved CRM execution boundary",
)
routers.write_text(text)
