export const parseLimit = (value: unknown, defaultValue = 100, maxValue = 500) => {
  if (typeof value !== "string") {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }

  const asInteger = Math.trunc(parsed);
  if (asInteger <= 0) {
    return defaultValue;
  }

  return Math.min(asInteger, maxValue);
};
