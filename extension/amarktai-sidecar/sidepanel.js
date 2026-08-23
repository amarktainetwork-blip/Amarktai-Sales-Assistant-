const byId = id => document.getElementById(id);
const setup = byId("setup");
const context = byId("context");
const appUrl = byId("app-url");
const sessionToken = byId("session-token");
const domain = byId("domain");
const status = byId("status");
const priority = byId("priority");
const notice = byId("notice");
const trainingStatus = byId("training-status");
let trainingTabId;

async function settings() {
  return chrome.storage.local.get(["appUrl", "sessionToken"]);
}
function renderStatus(message, problem = false) {
  status.textContent = message;
  status.style.color = problem ? "#fecaca" : "#b7cfff";
}
function clearPriority() {
  priority.innerHTML = "";
}

async function refresh() {
  const { appUrl: savedUrl, sessionToken: token } = await settings();
  if (!savedUrl || !token) {
    setup.classList.remove("hidden");
    context.classList.add("hidden");
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https?:\/\//i.test(tab.url)) {
    setup.classList.add("hidden");
    context.classList.remove("hidden");
    domain.textContent = "No company web page is active.";
    renderStatus(
      "Open an authorised CRM or business-system tab, then refresh.",
      true
    );
    clearPriority();
    return;
  }
  setup.classList.add("hidden");
  context.classList.remove("hidden");
  const page = new URL(tab.url);
  domain.textContent = `${page.hostname}${page.pathname}`;
  renderStatus("Checking authorised domain…");
  clearPriority();
  notice.textContent = "";
  try {
    const response = await fetch(
      `${savedUrl.replace(/\/$/, "")}/api/sidecar/context?url=${encodeURIComponent(tab.url)}`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
    );
    const payload = await response.json();
    if (!response.ok)
      throw new Error(
        payload.error || "The sidecar could not get page context."
      );
    renderStatus(
      `Authorised page. ${payload.today.metrics.overdue} overdue and ${payload.today.metrics.staleOpportunities} stale opportunity item(s) are currently in your queue.`
    );
    payload.today.priority.forEach(item => {
      const card = document.createElement("article");
      card.className = "priority";
      const title = document.createElement("strong");
      title.textContent = item.name;
      const copy = document.createElement("p");
      copy.textContent = `${item.stage || "Unstaged"} · ${item.reasons.join(" · ")}`;
      card.append(title, copy);
      priority.append(card);
    });
    notice.textContent = payload.calibrationNotice;
  } catch (error) {
    renderStatus(
      error instanceof Error
        ? error.message
        : "The sidecar could not get page context.",
      true
    );
    notice.textContent =
      "No CRM data is collected from this page unless its domain is authorised and its connector has been calibrated.";
  }
}

byId("save").addEventListener("click", async () => {
  const endpoint = appUrl.value.trim().replace(/\/$/, "");
  const token = sessionToken.value.trim();
  if (!/^https:\/\//i.test(endpoint) || token.length < 20) {
    renderStatus(
      "Enter an HTTPS Amarktai URL and a valid short-lived sidecar session.",
      true
    );
    return;
  }
  await chrome.storage.local.set({ appUrl: endpoint, sessionToken: token });
  sessionToken.value = "";
  await refresh();
});
byId("refresh").addEventListener("click", refresh);
byId("training-start").addEventListener("click", async () => {
  const systemId = Number(byId("training-system-id").value);
  const trainingSessionId = Number(byId("training-session-id").value);
  if (
    !Number.isInteger(systemId) ||
    systemId <= 0 ||
    !Number.isInteger(trainingSessionId) ||
    trainingSessionId <= 0
  ) {
    trainingStatus.textContent =
      "Enter the Connected System and Training Session IDs shown by Amarktai.";
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:\/\//i.test(tab.url || "")) {
    trainingStatus.textContent = "Open the authorised CRM tab first.";
    return;
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["training-content.js"],
    });
    await chrome.tabs.sendMessage(tab.id, { type: "amarktai-training-start" });
    trainingTabId = tab.id;
    byId("training-start").disabled = true;
    byId("training-stop").disabled = false;
    trainingStatus.textContent =
      "Training mode is active. Demonstrate only the selected operation; sensitive inputs are redacted.";
  } catch {
    trainingStatus.textContent =
      "Training could not start. Confirm this site permission for the Sidecar.";
  }
});
byId("training-stop").addEventListener("click", async () => {
  try {
    const { appUrl: savedUrl, sessionToken: token } = await settings();
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    const response = await chrome.tabs.sendMessage(trainingTabId, {
      type: "amarktai-training-stop",
    });
    const systemId = Number(byId("training-system-id").value);
    const trainingSessionId = Number(byId("training-session-id").value);
    const submitted = await fetch(
      `${savedUrl.replace(/\/$/, "")}/api/sidecar/training/${trainingSessionId}/capture`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          connectedSystemId: systemId,
          pageUrl: tab.url,
          events: response.events,
        }),
        cache: "no-store",
      }
    );
    const payload = await submitted.json();
    if (!submitted.ok)
      throw new Error(payload.error || "Training capture was rejected.");
    trainingStatus.textContent = `${payload.capture.length} masked semantic steps submitted for manager review.`;
  } catch (error) {
    trainingStatus.textContent =
      error instanceof Error
        ? error.message
        : "Training capture could not be submitted.";
  } finally {
    trainingTabId = undefined;
    byId("training-start").disabled = false;
    byId("training-stop").disabled = true;
  }
});
byId("disconnect").addEventListener("click", async () => {
  await chrome.storage.local.remove(["appUrl", "sessionToken"]);
  appUrl.value = "";
  sessionToken.value = "";
  setup.classList.remove("hidden");
  context.classList.add("hidden");
});

settings().then(({ appUrl: savedUrl }) => {
  if (savedUrl) appUrl.value = savedUrl;
  refresh();
});
