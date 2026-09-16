export function genieTaskCompletion(properties: Record<string, unknown>) {
  const value = properties.completed;
  const completed =
    value === true || value === 1 || value === "1" || value === "true";
  const incomplete =
    value === false || value === 0 || value === "0" || value === "false";
  const explicit =
    typeof properties.status === "string"
      ? properties.status.trim()
      : typeof properties.taskStatus === "string"
        ? properties.taskStatus.trim()
        : "";
  const timestamp = properties.completedAt || properties.closedAt;
  const validTimestamp =
    typeof timestamp === "string" &&
    Number.isFinite(new Date(timestamp).getTime())
      ? timestamp
      : "";
  return {
    status: completed
      ? "completed"
      : explicit
        ? explicit.toLowerCase()
        : incomplete
          ? "open"
          : "unknown",
    completedAt:
      completed || /^(completed|done|closed)$/i.test(explicit)
        ? validTimestamp
        : "",
  };
}
