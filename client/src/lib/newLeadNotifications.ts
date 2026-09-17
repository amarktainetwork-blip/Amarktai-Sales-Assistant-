export type NewLeadNotificationKey = { sourceKey: string };

export function unseenNewLeadNotifications<T extends NewLeadNotificationKey>(
  alerts: T[],
  notifiedKeys: readonly string[]
) {
  const notified = new Set(notifiedKeys);
  return alerts.filter(alert => !notified.has(alert.sourceKey));
}

export function rememberNewLeadNotifications(
  notifiedKeys: readonly string[],
  alerts: readonly NewLeadNotificationKey[],
  maximum = 250
) {
  const keys = Array.from(
    new Set([
      ...notifiedKeys,
      ...alerts.map(alert => alert.sourceKey).filter(Boolean),
    ])
  );
  return keys.slice(-Math.max(1, maximum));
}
