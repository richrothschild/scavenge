export const parseOffset = (value: unknown, defaultValue = 0, maxValue = 10000) => {
  if (typeof value !== "string") {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }

  const asInteger = Math.trunc(parsed);
  if (asInteger < 0) {
    return defaultValue;
  }

  return Math.min(asInteger, maxValue);
};
