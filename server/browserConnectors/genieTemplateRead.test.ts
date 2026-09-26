import { describe, expect, it, vi } from "vitest";
import {
  normalizeGenieSnippets,
  normalizeGenieTemplates,
  readGenieCommunicationTemplates,
} from "./genieTemplateRead";

const template = (id: string, type: "email" | "sms" | "whatsapp" = "email") => ({
  id,
  name: `Template ${id}`,
  type,
  locationId: "loc",
  dateAdded: "2026-09-25T10:00:00.000Z",
  template:
    type === "email"
      ? { subject: `Subject ${id}`, html: `<p>Body ${id}</p>` }
      : { body: `Body ${id}` },
});
const snippet = (id: string, type: "email" | "sms" = "email") => ({
  ...template(id, type),
  _id: id,
  id: undefined,
});

describe("Genie communication template read", () => {
  it("normalizes exact location templates and preserves subject/body", () => {
    const result = normalizeGenieTemplates(
      {
        templates: [template("e1"), template("s1", "sms")],
        totalCount: 2,
      },
      "loc"
    );
    expect(result.totalCount).toBe(2);
    expect(result.records[0]).toMatchObject({
      externalId: "e1",
      name: "Template e1",
      type: "email",
      subject: "Subject e1",
      body: "<p>Body e1</p>",
    });
    expect(result.records[1]).toMatchObject({
      externalId: "s1",
      type: "sms",
      body: "Body s1",
    });
  });

  it("normalizes the live Conversations snippet shape", () => {
    expect(
      normalizeGenieSnippets(
        { snippets: [snippet("e2"), snippet("s2", "sms")] },
        "loc"
      )
    ).toEqual([
      expect.objectContaining({
        externalId: "e2",
        name: "Template e2",
        type: "email",
        subject: "Subject e2",
        body: "<p>Body e2</p>",
      }),
      expect.objectContaining({
        externalId: "s2",
        type: "sms",
        body: "Body s2",
      }),
    ]);
  });

  it("accepts location-scoped snippet records that omit a redundant locationId", () => {
    const row = snippet("scoped");
    delete (row as any).locationId;
    expect(normalizeGenieSnippets({ snippets: [row] }, "loc")[0]).toMatchObject({
      externalId: "scoped",
      locationId: "loc",
    });
  });

  it("ignores snippet folders because they are navigation, not communication templates", () => {
    expect(
      normalizeGenieSnippets(
        {
          snippets: [
            {
              _id: "folder-1",
              name: "Renewals",
              isFolder: true,
              locationId: "loc",
            },
            snippet("message-1", "sms"),
          ],
        },
        "loc"
      )
    ).toEqual([expect.objectContaining({ externalId: "message-1", type: "sms" })]);
  });

  it("rejects a foreign-location template", () => {
    expect(() =>
      normalizeGenieTemplates(
        {
          templates: [{ ...template("x"), locationId: "foreign" }],
          totalCount: 1,
        },
        "loc"
      )
    ).toThrow("GENIE_TEMPLATE_SCOPE_VIOLATION");
  });

  it("fully drains read-only pages with the location origin", async () => {
    const get = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname.startsWith("/snippets/"))
        return {
          ok: () => true,
          status: () => 200,
          json: async () => ({ snippets: [snippet("snippet-1")] }),
        };
      const skip = Number(parsed.searchParams.get("skip") || "0");
      return {
        ok: () => true,
        status: () => 200,
        json: async () => ({
          templates:
            skip === 0
              ? Array.from({ length: 100 }, (_, index) =>
                  template(String(index))
                )
              : [template("100")],
          totalCount: 101,
        }),
      };
    });
    const control = vi.fn();
    const result = await readGenieCommunicationTemplates({
      page: {
        url: () => "https://example.test/v2/location/loc/contacts",
        evaluate: async () => "token",
        context: () => ({ request: { get } }),
      } as any,
      assertControl: control,
    });
    expect(result.data.sourceTotal).toBe("102");
    expect(result.data.snippetTotal).toBe("1");
    expect(result.data.legacyTemplateTotal).toBe("101");
    expect(result.data.pagesRead).toBe("2");
    expect(control).toHaveBeenCalledTimes(3);
    expect(get).toHaveBeenCalledTimes(3);
    const snippetCall = new URL(get.mock.calls[0][0]);
    expect(snippetCall.pathname).toBe("/snippets/loc");
    expect(snippetCall.searchParams.get("all")).toBe("true");
    const firstLegacy = new URL(get.mock.calls[1][0]);
    expect(firstLegacy.pathname).toBe("/locations/loc/templates");
    expect(firstLegacy.searchParams.get("originId")).toBe("loc");
    expect(firstLegacy.searchParams.get("deleted")).toBe("false");
  });

  it("fails closed when source totals cannot be reconciled", async () => {
    const get = vi.fn(async (url: string) => ({
      ok: () => true,
      status: () => 200,
      json: async () =>
        new URL(url).pathname.startsWith("/snippets/")
          ? { snippets: [] }
          : { templates: [template("1")], totalCount: 50 },
    }));
    await expect(
      readGenieCommunicationTemplates({
        page: {
          url: () => "https://example.test/v2/location/loc/contacts",
          evaluate: async () => "token",
          context: () => ({ request: { get } }),
        } as any,
        assertControl: () => {},
      })
    ).rejects.toThrow("GENIE_TEMPLATE_DRAIN_INCOMPLETE");
  });
});
