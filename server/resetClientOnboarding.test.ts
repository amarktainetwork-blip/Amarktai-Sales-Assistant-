import { describe, expect, it } from "vitest";
import {
  assertApplyConfirmation,
  assertResetIdentity,
  companyMatchesExpected,
  confirmationToken,
  normalizeExpectedDomain,
  parseResetArgs,
  websiteMatchesDomain,
} from "./resetClientOnboarding";

describe("guarded local client-onboarding reset", () => {
  it("normalizes an expected domain without weakening exact host matching", () => {
    expect(
      normalizeExpectedDomain(" HTTPS://WWW.Course2Career.com/path ")
    ).toBe("course2career.com");
    expect(
      websiteMatchesDomain(
        "https://www.course2career.com/about",
        "course2career.com"
      )
    ).toBe(true);
    expect(
      websiteMatchesDomain(
        "https://portal.course2career.com",
        "course2career.com"
      )
    ).toBe(false);
    expect(
      websiteMatchesDomain(
        "https://course2career.com.example.test",
        "course2career.com"
      )
    ).toBe(false);
  });

  it("matches the expected company exactly apart from case and edge whitespace", () => {
    expect(companyMatchesExpected(" Course2Career ", "course2career")).toBe(
      true
    );
    expect(companyMatchesExpected("Course2Career Ltd", "Course2Career")).toBe(
      false
    );
  });

  it.each(["0", "-1", "1.5", "1e3", "not-a-number"])(
    "rejects invalid organisation id %s",
    organisationId => {
      expect(() =>
        parseResetArgs([`--organisation-id=${organisationId}`])
      ).toThrow("RESET_ORGANISATION_ID_INVALID");
    }
  );

  it("defaults to dry-run and requires an explicit apply flag", () => {
    const common = [
      "--organisation-id=1",
      "--expected-company=Course2Career",
      "--expected-domain=course2career.com",
    ];
    expect(parseResetArgs(common)).toMatchObject({
      organisationId: 1,
      apply: false,
    });
    expect(parseResetArgs([...common, "--apply"]).apply).toBe(true);
  });

  it("generates a deterministic organisation-and-slug confirmation token", () => {
    expect(
      confirmationToken({ organisationId: 1, slug: "course2career" })
    ).toBe("DELETE_LOCAL_CLIENT_ONBOARDING:1:course2career");
  });

  it("requires the exact confirmation token only when applying", () => {
    const expectedConfirm = confirmationToken({
      organisationId: 1,
      slug: "course2career",
    });
    expect(() =>
      assertApplyConfirmation({ apply: false, expectedConfirm })
    ).not.toThrow();
    expect(() =>
      assertApplyConfirmation({
        apply: true,
        confirm: "DELETE_LOCAL_CLIENT_ONBOARDING:2:course2career",
        expectedConfirm,
      })
    ).toThrow("RESET_CONFIRMATION_MISMATCH");
    expect(() =>
      assertApplyConfirmation({
        apply: true,
        confirm: expectedConfirm,
        expectedConfirm,
      })
    ).not.toThrow();
  });

  it("refuses a company identity mismatch", () => {
    expect(() =>
      assertResetIdentity({
        profiles: [
          {
            companyName: "Different Company",
            websiteUrl: "https://course2career.com",
          },
        ],
        expectedCompany: "Course2Career",
        expectedDomain: "course2career.com",
      })
    ).toThrow("RESET_EXPECTED_COMPANY_MISMATCH");
  });

  it("refuses a domain identity mismatch", () => {
    expect(() =>
      assertResetIdentity({
        profiles: [
          {
            companyName: "Course2Career",
            websiteUrl: "https://example.test",
          },
        ],
        expectedCompany: "Course2Career",
        expectedDomain: "course2career.com",
      })
    ).toThrow("RESET_EXPECTED_DOMAIN_MISMATCH");
  });

  it("requires the company and domain to belong to the same profile", () => {
    expect(() =>
      assertResetIdentity({
        profiles: [
          {
            companyName: "Course2Career",
            websiteUrl: "https://example.test",
          },
          {
            companyName: "Different Company",
            websiteUrl: "https://course2career.com",
          },
        ],
        expectedCompany: "Course2Career",
        expectedDomain: "course2career.com",
      })
    ).toThrow("RESET_TARGET_IDENTITY_MISMATCH");
  });
});
