import { consumeAiCredits } from "./aiCredits";

const DEFAULT_REST_BASE = "https://query.genx.sh/api/v1";
const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_TRANSPORT_RETRIES = 2;
export const MAX_COMPANY_SEMANTIC_PASSES = 3;

type JsonObject = Record<string, unknown>;

export type CompanyLearningModel = {
  id: string;
  category: string;
  contextWindow: number;
  advertised: JsonObject;
  pricing?: JsonObject;
};

export type CompanyLearningUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  credits?: number;
};

export type CompanyLearningResourceState = {
  fileId?: string;
  sessionIds: string[];
};

export type CompanyLearningClientOptions = {
  apiKey?: string;
  restBaseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
  recordCredits?: typeof consumeAiCredits;
};

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function restBaseFromEnvironment() {
  const explicit = process.env.GENX_COMPANY_LEARNING_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const chat = process.env.GENX_CHAT_COMPLETIONS_URL?.trim();
  if (!chat) return DEFAULT_REST_BASE;
  const url = new URL(chat);
  url.pathname = "/api/v1";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function number(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function responseId(payload: unknown, names: string[]) {
  const root = object(payload);
  const data = object(root.data);
  for (const name of names) {
    const id = text(root[name]) || text(data[name]);
    if (id) return id;
  }
  return "";
}

function responseContent(payload: unknown): string {
  const root = object(payload);
  const data = object(root.data);
  const message = object(root.message);
  const response = object(root.response);
  const candidates = [
    root.content,
    root.output_text,
    root.text,
    data.content,
    data.output_text,
    message.content,
    response.content,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim())
      return candidate.trim();
    if (Array.isArray(candidate)) {
      const joined = candidate
        .map(item => text(object(item).text) || text(object(item).content))
        .filter(Boolean)
        .join("\n");
      if (joined) return joined;
    }
  }
  return "";
}

function responseUsage(payload: unknown): CompanyLearningUsage {
  const root = object(payload);
  const usage = object(root.usage);
  const billing = object(root.billing);
  return {
    promptTokens: number(usage.prompt_tokens ?? usage.input_tokens),
    completionTokens: number(usage.completion_tokens ?? usage.output_tokens),
    totalTokens: number(usage.total_tokens),
    credits: number(
      root.credits_used ??
        root.cost_credits ??
        usage.credits ??
        usage.cost_credits ??
        billing.credits
    ),
  };
}

function retryableStatus(status: number) {
  return (
    status === 408 ||
    status === 409 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  );
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function safeApiError(status: number, body: string) {
  return `Amarktai intelligence request failed with ${status}${body ? `: ${body.replace(/gnxk_[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 240)}` : ""}`;
}

function modelRecords(payload: unknown) {
  const root = object(payload);
  const records = array(payload).length
    ? array(payload)
    : array(root.data).length
      ? array(root.data)
      : array(root.models);
  return records.map(record => {
    const id = text(record);
    return id ? ({ id } as JsonObject) : object(record);
  });
}

function pricingRecords(payload: unknown) {
  const root = object(payload);
  const records = array(root.data).length
    ? array(root.data)
    : array(root.pricing);
  if (records.length) return records.map(object);
  const data = object(root.data);
  const nested = object(data.pricing);
  const keyed = Object.keys(nested).length
    ? nested
    : Object.keys(data).length
      ? data
      : object(root.pricing);
  return Object.entries(object(keyed)).map(
    ([modelId, value]) =>
      ({ model_id: modelId, ...object(value) }) as JsonObject
  );
}

function modelId(record: JsonObject) {
  return text(record.id || record.model_id || record.model || record.slug);
}

function modelContext(record: JsonObject) {
  return (
    number(record.context_window) ??
    number(record.context_length) ??
    number(record.max_input_tokens) ??
    number(object(record.limits).context_window) ??
    0
  );
}

function modelCategory(record: JsonObject) {
  return text(record.category || record.type || record.modality).toLowerCase();
}

function modelScore(model: CompanyLearningModel) {
  const id = model.id.toLowerCase();
  let score = Math.min(400, Math.floor(model.contextWindow / 10_000));
  if (
    /opus|sol|pro|reasoning|gpt-5\.6|gpt-5\.5|gpt-5\.4|sonnet|grok-4/.test(id)
  )
    score += 500;
  if (/flash.lite|haiku|mini|nano|luna|cheap|fast/.test(id)) score -= 300;
  if (model.contextWindow >= 500_000) score += 300;
  if (model.contextWindow >= 150_000) score += 150;
  return score;
}

export function selectCompanyLearningModel(input: {
  modelsPayload: unknown;
  pricingPayload: unknown;
  override?: string;
}) {
  const pricing = new Map(
    pricingRecords(input.pricingPayload).map(item => [modelId(item), item])
  );
  const models = modelRecords(input.modelsPayload)
    .map(record => {
      const id = modelId(record);
      const modelPricing = pricing.get(id);
      return {
        id,
        category: modelCategory(record),
        contextWindow:
          modelContext(record) || modelContext(modelPricing || {}),
        advertised: record,
        pricing: modelPricing,
      };
    })
    .filter(
      model =>
        model.id &&
        (!model.category || /text|chat|language/.test(model.category))
    );
  const override = input.override?.trim();
  if (override) {
    const selected = models.find(model => model.id === override);
    if (selected) return selected;
  }
  const selected = models.sort(
    (left, right) =>
      modelScore(right) - modelScore(left) || left.id.localeCompare(right.id)
  )[0];
  if (!selected)
    throw new Error(
      "No suitable long-context text model is currently advertised for company learning."
    );
  return selected;
}

export class GenxCompanyLearningClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly recordCredits: typeof consumeAiCredits;

  constructor(options: CompanyLearningClientOptions = {}) {
    this.apiKey = options.apiKey || process.env.GENX_API_KEY?.trim() || "";
    this.baseUrl = (options.restBaseUrl || restBaseFromEnvironment()).replace(
      /\/$/,
      ""
    );
    this.fetchImpl = options.fetchImpl || fetch;
    this.timeoutMs = Math.min(
      10 * 60_000,
      Math.max(
        10_000,
        options.timeoutMs ||
          positiveInt(process.env.GENX_COMPANY_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)
      )
    );
    this.retries = Math.min(
      MAX_TRANSPORT_RETRIES,
      Math.max(
        0,
        options.retries ?? positiveInt(process.env.GENX_COMPANY_RETRY_COUNT, 1)
      )
    );
    this.recordCredits = options.recordCredits || consumeAiCredits;
  }

  private async request(path: string, init: RequestInit = {}, retry = true) {
    if (!this.apiKey)
      throw new Error(
        "Amarktai intelligence is not configured for whole-site company learning."
      );
    let lastError: unknown;
    const attempts = retry ? this.retries + 1 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const headers = new Headers(init.headers);
        headers.set("Authorization", `Bearer ${this.apiKey}`);
        headers.set("Accept", "application/json");
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          ...init,
          headers,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (retryableStatus(response.status) && attempt + 1 < attempts) {
          await response.body?.cancel().catch(() => undefined);
          await delay(Math.min(2_000, 250 * 2 ** attempt));
          continue;
        }
        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          throw new Error(safeApiError(response.status, detail));
        }
        if (response.status === 204) return {};
        return (await response.json().catch(() => ({}))) as unknown;
      } catch (error) {
        lastError = error;
        if (
          attempt + 1 >= attempts ||
          (error instanceof Error && /failed with 4\d\d/.test(error.message))
        )
          break;
        await delay(Math.min(2_000, 250 * 2 ** attempt));
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("Amarktai intelligence request could not be completed.");
  }

  private async json(
    path: string,
    method: string,
    body?: JsonObject,
    retry = true
  ) {
    return this.request(
      path,
      {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      },
      retry
    );
  }

  async discoverAccount() {
    const [modelsPayload, pricingPayload, creditsPayload] = await Promise.all([
      this.request("/models?category=text"),
      this.request("/account/pricing?category=text"),
      this.request("/account/credits"),
    ]);
    return { modelsPayload, pricingPayload, creditsPayload };
  }

  async selectModels() {
    const account = await this.discoverAccount();
    return {
      analysis: selectCompanyLearningModel({
        ...account,
        override: process.env.GENX_COMPANY_LEARNING_MODEL,
      }),
      audit: selectCompanyLearningModel({
        ...account,
        override: process.env.GENX_COMPANY_AUDIT_MODEL,
      }),
      accountCredits: account.creditsPayload,
    };
  }

  async uploadCorpus(input: { jsonl: string; corpusHash: string }) {
    const form = new FormData();
    form.set(
      "file",
      new Blob([input.jsonl], { type: "text/plain" }),
      `amarktai-company-corpus-${input.corpusHash.slice(0, 16)}.txt`
    );
    form.set("purpose", "company-learning");
    const payload = await this.request("/files", {
      method: "POST",
      body: form,
    });
    const fileId = responseId(payload, ["file_id", "id"]);
    if (!fileId)
      throw new Error("Company corpus upload returned no file identifier.");
    return fileId;
  }

  async createSession(input: {
    model: string;
    systemPrompt: string;
    title: string;
  }) {
    const payload = await this.json("/sessions", "POST", {
      model: input.model,
      system_prompt: input.systemPrompt,
      title: input.title,
    });
    const sessionId = responseId(payload, ["session_id", "id"]);
    if (!sessionId)
      throw new Error("Company-learning session returned no identifier.");
    return sessionId;
  }

  async sendSessionMessage(input: {
    sessionId: string;
    content: string;
    fileIds: string[];
    idempotencyKey: string;
    billing: {
      userId: number;
      organisationId: number;
      feature: string;
      reference: string;
    };
  }) {
    const payload = await this.json(
      `/sessions/${encodeURIComponent(input.sessionId)}/messages`,
      "POST",
      {
        role: "user",
        content: input.content,
        file_ids: input.fileIds,
        idempotency_key: input.idempotencyKey,
      }
    );
    const content = responseContent(payload);
    if (!content)
      throw new Error(
        "Company-learning session returned no structured content."
      );
    const usage = responseUsage(payload);
    const credits = Math.max(0, Math.ceil(usage.credits || 0));
    if (credits > 0)
      await this.recordCredits({
        userId: input.billing.userId,
        organisationId: input.billing.organisationId,
        credits,
        feature: input.billing.feature,
        providerUsage: usage,
        reference: input.billing.reference,
      });
    return { content, usage };
  }

  async closeSession(sessionId: string) {
    await this.json(
      `/sessions/${encodeURIComponent(sessionId)}/close`,
      "POST",
      undefined,
      false
    );
  }

  async deleteFile(fileId: string) {
    await this.request(
      `/files/${encodeURIComponent(fileId)}`,
      { method: "DELETE" },
      false
    );
  }

  async cleanup(resources: CompanyLearningResourceState) {
    const failures: string[] = [];
    for (const sessionId of Array.from(new Set(resources.sessionIds))) {
      try {
        await this.closeSession(sessionId);
      } catch {
        failures.push(`session:${sessionId}`);
      }
    }
    if (resources.fileId) {
      try {
        await this.deleteFile(resources.fileId);
      } catch {
        failures.push(`file:${resources.fileId}`);
      }
    }
    return failures;
  }
}
