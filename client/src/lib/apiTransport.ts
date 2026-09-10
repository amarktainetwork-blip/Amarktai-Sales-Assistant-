/** Validate the existing JSON API boundary before a proxy error reaches tRPC. */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit) {
  const timeout = AbortSignal.timeout(30_000);
  let response: Response;
  try {
    response = await globalThis.fetch(input, {
      ...init,
      credentials: "include",
      signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
    });
  } catch {
    throw new Error("The connection was interrupted. Please try again.");
  }
  try {
    await response.clone().json();
  } catch {
    throw new Error(
      "The service is temporarily unavailable. Please try again."
    );
  }
  return response;
}
