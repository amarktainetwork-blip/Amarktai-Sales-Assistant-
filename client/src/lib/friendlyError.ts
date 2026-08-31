const technicalError =
  /zod|invalid_(?:type|format)|json schema|schema error|trpc|stack trace|sql|database|prisma|drizzle|redis|mariadb|mysql|postgres|playwright|cdp|websocket|selector|operation[_ ]key|commission|live_proven|pre[_ -]?otp|challengeid|pendinginteractiveauth|livechallenges|session replay|genie_session|genx|correlation id|internal server|backend enum|unexpected end of json|request failed \(\d+\)/i;

const backendEnum = /\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/;

export function friendlyError(
  error: unknown,
  fallback = "That didn't work just now. Nothing was changed, so you can safely try again."
) {
  const raw = error instanceof Error ? error.message : String(error || "");
  if (
    !raw ||
    technicalError.test(raw) ||
    backendEnum.test(raw) ||
    /^[A-Z0-9_:\- ]{5,}$/.test(raw)
  )
    return fallback;
  if (/full crm address|invalid.*url|url.*invalid|https required/i.test(raw))
    return "Enter the full CRM address, including https://";
  if (/management password|elevation/i.test(raw))
    return "Confirm your management password, then try again.";
  if (/sign.?in|authentication|session.*expired|verification/i.test(raw))
    return "Your session needs attention. Sign in again and continue.";
  if (/network|fetch|connection|timeout|socket|closed/i.test(raw))
    return "The connection was interrupted. Nothing was changed, so you can safely try again.";
  if (/permission|forbidden|manager|required role|not permitted/i.test(raw))
    return "You don't have permission to make that change.";
  return raw.length <= 160 ? raw : fallback;
}
