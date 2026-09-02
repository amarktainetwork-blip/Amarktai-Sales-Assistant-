from pathlib import Path


auth_path = Path("client/src/pages/Auth.tsx")
auth = auth_path.read_text()

if 'import { Link, useLocation, useSearch } from "wouter";' not in auth:
    old_import = 'import { Link, useLocation } from "wouter";'
    if old_import not in auth:
        raise SystemExit("Auth wouter import could not be located safely")
    auth = auth.replace(
        old_import,
        'import { Link, useLocation, useSearch } from "wouter";',
        1,
    )

# Remove the first draft of this repair if a previous validator checkout applied it.
auth = auth.replace("  const [location] = useLocation();\n", "", 1)

if "const search = useSearch();" not in auth:
    marker = "export default function Auth() {\n"
    if marker not in auth:
        raise SystemExit("Auth component entry could not be located safely")
    auth = auth.replace(marker, marker + "  const search = useSearch();\n", 1)

old_query = '''  const query =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();'''
location_query = '''  const query = new URLSearchParams(
    location.includes("?") ? location.slice(location.indexOf("?") + 1) : ""
  );'''
new_query = "  const query = new URLSearchParams(search);"
if old_query in auth:
    auth = auth.replace(old_query, new_query, 1)
elif location_query in auth:
    auth = auth.replace(location_query, new_query, 1)
elif new_query not in auth:
    raise SystemExit("Auth query-mode source could not be located safely")

auth = auth.replace("Amarktai", "AmarktAI")
auth = auth.replace(
    '<ShieldCheck size={15} /> AMARKTAI NETWORK · SALES ASSISTANT',
    '<ShieldCheck size={15} /> SECURE PERSONAL SALES WORKSPACE',
)
auth_path.write_text(auth)


test_path = Path("client/src/pages/finalAuthAcceptance.test.ts")
test_path.write_text('''import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("final account presentation", () => {
  const auth = readFileSync(
    path.resolve(process.cwd(), "client/src/pages/Auth.tsx"),
    "utf8"
  );

  it("uses account language and the canonical AmarktAI spelling", () => {
    expect(auth).toContain("CREATE ACCOUNT");
    expect(auth).toContain("Create your AmarktAI account.");
    expect(auth).toContain("Create account");
    expect(auth).not.toContain("Create your Amarktai account.");
    expect(auth).not.toContain("CREATE WORKSPACE");
    expect(auth).not.toContain("Create your Sales Assistant workspace.");
  });

  it("reacts to register, forgot-password and sign-in query links", () => {
    expect(auth).toContain('import { Link, useLocation, useSearch } from "wouter";');
    expect(auth).toContain("const search = useSearch();");
    expect(auth).toContain("const query = new URLSearchParams(search);");
    expect(auth).not.toContain("window.location.search");
    expect(auth).toContain('href="/auth?mode=forgot"');
    expect(auth).toContain('href="/auth?mode=register"');
    expect(auth).toContain('href="/auth"');
  });

  it("gives auth inputs explicit id and name attributes", () => {
    expect(auth).toContain("id={name}");
    expect(auth).toContain("name={name}");
  });

  it("keeps the approved auth photography while public product pages use workflow visuals", () => {
    expect(auth).toContain("images.pexels.com/photos/8485714");
    expect(auth).not.toContain("images.pexels.com/photos/8837770");
  });
});
''')
