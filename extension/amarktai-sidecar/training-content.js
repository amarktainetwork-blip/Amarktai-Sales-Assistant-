(() => {
  if (globalThis.__amarktaiTrainingInstalled) return;
  globalThis.__amarktaiTrainingInstalled = true;
  let capturing = false;
  let events = [];
  const secret =
    /password|passcode|secret|token|cookie|authorization|bearer|csrf|credit.?card|security/i;
  const text = value =>
    typeof value === "string"
      ? value.trim().replace(/\s+/g, " ").slice(0, 500)
      : "";
  function labelFor(element) {
    if (!(element instanceof HTMLElement)) return "";
    const explicit = element.getAttribute("aria-label");
    if (explicit) return text(explicit);
    const id = element.id;
    const label = id
      ? document.querySelector(`label[for="${CSS.escape(id)}"]`)
      : element.closest("label");
    return text(label?.textContent || "");
  }
  function selectorFor(element) {
    if (!(element instanceof HTMLElement)) return "";
    for (const attr of ["data-testid", "data-test", "data-qa"]) {
      const value = element.getAttribute(attr);
      if (value) return `[${attr}="${CSS.escape(value)}"]`;
    }
    if (element.id) return `#${CSS.escape(element.id)}`;
    const name = element.getAttribute("name");
    if (name)
      return `${element.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
    const role = element.getAttribute("role");
    const label = element.getAttribute("aria-label");
    if (role && label)
      return `[role="${CSS.escape(role)}"][aria-label="${CSS.escape(label)}"]`;
    return element.tagName.toLowerCase();
  }
  function capture(action, target) {
    if (!capturing || !(target instanceof HTMLElement)) return;
    const inputType = target instanceof HTMLInputElement ? target.type : "";
    const name = target.getAttribute("name") || "";
    const label = labelFor(target);
    const sensitive =
      inputType === "password" ||
      inputType === "hidden" ||
      secret.test(`${name} ${label}`);
    events.push({
      action,
      url: location.href,
      role: target.getAttribute("role") || undefined,
      name: text(
        target.getAttribute("aria-label") ||
          (target instanceof HTMLButtonElement ? target.textContent : "") ||
          name
      ),
      label,
      selector: selectorFor(target),
      inputName: name,
      inputType,
      redacted: sensitive,
      attributes: Object.fromEntries(
        [
          "id",
          "name",
          "type",
          "role",
          "aria-label",
          "aria-labelledby",
          "data-testid",
          "data-test",
          "data-qa",
          "title",
        ]
          .map(key => [key, target.getAttribute(key)])
          .filter(([, value]) => value && !secret.test(String(value)))
      ),
    });
  }
  document.addEventListener(
    "click",
    event => capture("click", event.target),
    true
  );
  document.addEventListener(
    "change",
    event =>
      capture(
        event.target instanceof HTMLSelectElement ? "select" : "fill",
        event.target
      ),
    true
  );
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type === "amarktai-training-start") {
      events = [];
      capturing = true;
      respond({ ok: true });
    }
    if (message?.type === "amarktai-training-stop") {
      capturing = false;
      respond({
        ok: true,
        events: [
          ...events,
          { action: "navigation_result", url: location.href },
        ],
      });
      events = [];
    }
    return true;
  });
})();
