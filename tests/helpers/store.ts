/** Store methods are non-enumerable, as on engine objects, so cargo copies contain resources only. */
export function createStore(
  resources: Record<string, number>,
  capacity: number | Record<string, number>,
) {
  const getCapacity = (resource?: string): number | null =>
    typeof capacity === "number" ? capacity : resource ? (capacity[resource] ?? null) : null;
  const getUsedCapacity = (resource?: string): number | null => {
    if (resource) return getCapacity(resource) === null ? null : resources[resource] || 0;
    return typeof capacity === "number"
      ? Object.values(resources).reduce((total, amount) => total + amount, 0)
      : null;
  };
  const getFreeCapacity = (resource?: string) => {
    const limit = getCapacity(resource);
    const used = typeof capacity === "number" ? getUsedCapacity() : getUsedCapacity(resource);
    return limit === null || used === null ? null : limit - used;
  };
  const methods = { getCapacity, getUsedCapacity, getFreeCapacity };
  Object.defineProperties(resources, {
    getCapacity: { value: getCapacity },
    getUsedCapacity: { value: getUsedCapacity },
    getFreeCapacity: { value: getFreeCapacity },
  });
  return resources as Record<string, number> & typeof methods;
}
