import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryRecorder } from "./testSupport/queryRecorder";
const m = vi.hoisted(() => ({ db: vi.fn(), member: vi.fn() }));
vi.mock("./db", () => ({ getDb: m.db }));
vi.mock("./organisation", () => ({ requireOrganisationMembership: m.member }));
vi.mock("./organisationWorkspace", () => ({
  getOrganisationWorkspaceContext: vi.fn(async () => ({
    customerModel: "individual_consumer",
    productContext: { companyOptional: true },
    customerFieldMappings: [
      {
        sourceFieldId: "interest",
        label: "Courses of interest",
        kind: "text",
        purpose: "interest",
      },
    ],
  })),
}));
import { listCustomerDirectory, getExactCustomerDetail } from "./customerData";
const contact = {
  id: 301,
  organisationId: 8,
  connectedSystemId: 8,
  externalId: "person-301",
  ownerExternalId: "exact-owner",
  firstName: "Alex",
  lastName: "Outside",
  email: null,
  phone: null,
  companyExternalId: null,
  raw: {
    normalizedCustomerContext: {
      source: "enquiry",
      tags: ["interest"],
      customFields: { interest: "training" },
    },
  },
};
describe("canonical scoped customer data", () => {
  beforeEach(() => vi.clearAllMocks());
  it("searches before pagination and returns a customer beyond the old 250 limit with exact totals", async () => {
    const r = queryRecorder(q =>
      q.selection?.total
        ? [{ total: q.where.params.includes("%Outside%") ? 1 : 24000 }]
        : [contact]
    );
    m.db.mockResolvedValue(r.db);
    const result = await listCustomerDirectory({
      userId: 2,
      organisationId: 8,
      search: "Outside",
      pageSize: 50,
    });
    expect(result).toMatchObject({
      total: 1,
      totalAll: 24000,
      page: 1,
      pageSize: 50,
      search: "Outside",
      items: [{ id: 301 }],
    });
    const query = r.queries.find(q => q.limit);
    expect(query.limit).toBe(50);
    expect(query.offset).toBe(0);
    expect(query.where.sql).toContain("like");
    expect(query.where.sql).toContain("exists (select 1");
    expect(query.where.params).toContain(2);
    expect(query.where.params).toContain(8);
    expect(query.where.params).toContain("%Outside%");
  });
  it("uses server offsets and caps page size", async () => {
    const r = queryRecorder(q =>
      q.selection?.total ? [{ total: 24000 }] : []
    );
    m.db.mockResolvedValue(r.db);
    await listCustomerDirectory({
      userId: 2,
      organisationId: 8,
      page: 7,
      pageSize: 1000,
    });
    expect(r.queries.at(-1)).toMatchObject({ limit: 100, offset: 600 });
  });
  it("opens the exact customer and scopes every relation independently; B2C without company/deal is valid", async () => {
    const r = queryRecorder(q =>
      q.selection?.total
        ? [{ total: 0 }]
        : q.table === "crmContacts"
          ? [contact]
          : q.table === "crmTasks" && q.limit === 100
            ? [{ externalId: "own-task", status: "open" }]
            : []
    );
    m.db.mockResolvedValue(r.db);
    const result = await getExactCustomerDetail({
      userId: 2,
      organisationId: 8,
      contactId: 301,
    });
    expect(result).toMatchObject({
      id: 301,
      company: null,
      openOpportunity: null,
      nextAction: { externalId: "own-task" },
      mappedFields: [{ value: "training" }],
    });
    expect(r.queries[0].where.params).toContain(301);
    for (const q of r.queries.filter(q =>
      ["crmTasks", "crmActivities", "crmOpportunities"].includes(q.table)
    )) {
      expect(q.where.params).toContain(8);
      expect(q.where.params).toContain("person-301");
      expect(q.where.params).toContain("exact-owner");
      expect(q.where.sql).toContain("connectedSystemId");
    }
    expect(r.queries.some(q => q.table === "crmCompanies")).toBe(false);
  });
  it("uses derived course tags to fill an empty mapped course-interest field", async () => {
    const tagged = {
      ...contact,
      raw: {
        normalizedCustomerContext: {
          source: "enquiry",
          tags: ["course — it support technician"],
          customFields: {},
        },
      },
    };
    const r = queryRecorder(q =>
      q.selection?.total
        ? [{ total: 0 }]
        : q.table === "crmContacts"
          ? [tagged]
          : []
    );
    m.db.mockResolvedValue(r.db);
    const result = await getExactCustomerDetail({
      userId: 2,
      organisationId: 8,
      contactId: 301,
    });
    expect(result?.interest.primary).toBe("it support technician");
    expect(result?.mappedFields).toEqual([
      expect.objectContaining({
        label: "Courses of interest",
        value: "it support technician",
      }),
    ]);
  });
  it("does not fetch relations for an unowned selected customer", async () => {
    const r = queryRecorder(() => []);
    m.db.mockResolvedValue(r.db);
    expect(
      await getExactCustomerDetail({
        userId: 2,
        organisationId: 8,
        contactId: 999,
      })
    ).toBeNull();
    expect(r.queries).toHaveLength(1);
    expect(r.queries[0].where.sql).toContain("externalUserId");
  });
  it("requires active organisation membership before reading", async () => {
    m.member.mockRejectedValueOnce(Error("DENIED"));
    await expect(
      listCustomerDirectory({ userId: 2, organisationId: 9 })
    ).rejects.toThrow("DENIED");
    expect(m.db).not.toHaveBeenCalled();
  });
});
