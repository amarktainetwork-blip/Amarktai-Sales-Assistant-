export type CrmViewerPhase =
  | "starting"
  | "interactive"
  | "authenticated"
  | "failed";

export function crmViewerPhase(input: {
  socketReady: boolean;
  frameReceived: boolean;
  authenticationState: string;
  failed: boolean;
}): CrmViewerPhase {
  if (input.failed || input.authenticationState === "ERROR") return "failed";
  if (input.authenticationState === "AUTHENTICATED") return "authenticated";
  if (input.socketReady && input.frameReceived) return "interactive";
  return "starting";
}
