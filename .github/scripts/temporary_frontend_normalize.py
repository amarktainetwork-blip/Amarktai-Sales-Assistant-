from pathlib import Path

# One-shot client handover wording normalizer. Removed after this run.
replacements = {
    "client/src/pages/Today.tsx": [
        ("Amarktai", "AmarktAI"),
        ("No CRM tasks due today.", "No tasks due today."),
    ],
    "client/src/pages/LiveCalls.tsx": [
        ("Amarktai", "AmarktAI"),
        ('[\n                  "CRM",', '[\n                  "Opportunity",'),
        ('aria-label="Customer or CRM record"', 'aria-label="Customer"'),
        ('contact.email || contact.phone || "CRM customer"', 'contact.email || contact.phone || "Customer"'),
        ("before preparing CRM changes", "before preparing customer updates"),
    ],
    "client/src/pages/Reviews.tsx": [
        ("Back to Assistant", "Back to AmarktAI"),
    ],
    "client/src/pages/Settings.tsx": [
        ("Amarktai", "AmarktAI"),
    ],
    "client/src/pages/CompanySetup.tsx": [
        ("Amarktai", "AmarktAI"),
    ],
    "client/src/pages/Knowledge.tsx": [
        ("Amarktai", "AmarktAI"),
    ],
    "client/src/pages/CrmWorkspace.tsx": [
        ("Amarktai", "AmarktAI"),
    ],
    "client/src/pages/TeamIntelligence.tsx": [
        ("Amarktai", "AmarktAI"),
    ],
    "client/src/pages/TeamManagement.tsx": [
        ("Amarktai", "AmarktAI"),
    ],
}

changed = []
for filename, pairs in replacements.items():
    path = Path(filename)
    text = path.read_text(encoding="utf-8")
    original = text
    for old, new in pairs:
        text = text.replace(old, new)
    if text != original:
        path.write_text(text, encoding="utf-8")
        changed.append(filename)

print("Normalized:")
for filename in changed:
    print(f"- {filename}")
