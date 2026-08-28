import { describe, expect, it } from "vitest";
import {
  isCustomOperationKey,
  isRuntimeConnectionStatus,
  productionOperationAvailable,
  type RuntimeLearnedOperation,
} from "./runtimeCapabilities";

const operation = (status: string): RuntimeLearnedOperation => ({
  operationKey: "custom.write.send.quote",
  label: "Send Quote",
  mode: "write",
  status,
  version: 2,
  lastTestAt: null,
  lastSuccessAt: null,
  lastFailureAt: null,
  productionReady: status === "LIVE_PROVEN",
});

describe("CRM-native runtime capability truth", () => {
  it("treats ready and limited-permissions connections as runtime eligible", () => {
    expect(isRuntimeConnectionStatus("ready")).toBe(true);
    expect(isRuntimeConnectionStatus("limited_permissions")).toBe(true);
    expect(isRuntimeConnectionStatus("needs_attention")).toBe(false);
    expect(isRuntimeConnectionStatus("authentication_expired")).toBe(false);
  });

  it("accepts only namespaced custom read/write operation keys", () => {
    expect(isCustomOperationKey("custom.read.open.orders")).toBe(true);
    expect(isCustomOperationKey("custom.write.send.quote")).toBe(true);
    expect(isCustomOperationKey("send.quote")).toBe(false);
    expect(isCustomOperationKey("custom.execute.javascript")).toBe(false);
  });

  it("keeps TEST_READY out of production and allows exact LIVE_PROVEN only", () => {
    expect(
      productionOperationAvailable(
        [operation("TEST_READY")],
        "custom.write.send.quote"
      )
    ).toBe(false);
    expect(
      productionOperationAvailable(
        [operation("LIVE_PROVEN")],
        "custom.write.send.quote"
      )
    ).toBe(true);
    expect(
      productionOperationAvailable(
        [operation("LIVE_PROVEN")],
        "custom.write.other"
      )
    ).toBe(false);
  });
});
