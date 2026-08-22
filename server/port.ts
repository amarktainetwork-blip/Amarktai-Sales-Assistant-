export function getConfiguredPort(portValue = process.env.PORT) {
  const port = Number(portValue ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid TCP port.");
  return port;
}
