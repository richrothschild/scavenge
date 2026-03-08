export const parseLimitInput = (value: string, fallback: number, max = 500) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const asInteger = Math.trunc(parsed);
  if (asInteger <= 0) {
    return fallback;
  }

  return Math.min(asInteger, max);
};

export const parseOffsetInput = (value: string, fallback = 0, max = 10000) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const asInteger = Math.trunc(parsed);
  if (asInteger < 0) {
    return fallback;
  }

  return Math.min(asInteger, max);
};

export const derivePaginationState = (offset: number, limit: number, total: number) => {
  if (total <= 0) {
    return {
      currentPage: 0,
      totalPages: 0,
      canPrev: false,
      canNext: false
    };
  }

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const currentPage = Math.floor(offset / limit) + 1;
  const canPrev = offset > 0;
  const canNext = offset + limit < total;

  return {
    currentPage,
    totalPages,
    canPrev,
    canNext
  };
};
