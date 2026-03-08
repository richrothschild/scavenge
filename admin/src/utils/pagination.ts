export const parseLimitInput = (raw: string, fallback: number, max = 500) => {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const value = Math.trunc(parsed);
  if (value <= 0) {
    return fallback;
  }

  return Math.min(value, max);
};

export const parseOffsetInput = (raw: string, fallback = 0, max = 10000) => {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const value = Math.trunc(parsed);
  if (value < 0) {
    return fallback;
  }

  return Math.min(value, max);
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

  return {
    currentPage,
    totalPages,
    canPrev: offset > 0,
    canNext: offset + limit < total
  };
};
