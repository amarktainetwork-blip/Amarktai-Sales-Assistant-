import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "./apiTransport";

afterEach(() => vi.unstubAllGlobals());
describe("JSON API transport", () => {
  it.each(["", "<html>Bad gateway</html>"])(
    "turns malformed responses into recoverable errors",
    async body => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response(body, { status: 502 }))
      );
      await expect(apiFetch("/api/trpc/companySetup.get")).rejects.toThrow(
        "temporarily unavailable"
      );
    }
  );
  it("preserves valid structured application errors for tRPC", async () => {
    const body = { error: { message: "Website address is invalid" } };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify(body), { status: 400 }))
    );
    const response = await apiFetch("/api/trpc/companySetup.get");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(body);
  });
  it("handles an interrupted connection without a raw browser exception", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))
    );
    await expect(apiFetch("/api/trpc/companySetup.get")).rejects.toThrow(
      "connection was interrupted"
    );
  });
});
