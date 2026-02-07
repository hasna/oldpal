type DrizzleMockOverrides = Record<string, unknown>;

const baseDrizzleOrmMock = {
  and: (...args: unknown[]) => ({ and: args }),
  or: (...args: unknown[]) => ({ or: args }),
  eq: (field: unknown, value: unknown) => ({ field, value }),
  gt: (field: unknown, value: unknown) => ({ gt: [field, value] }),
  gte: (field: unknown, value: unknown) => ({ gte: [field, value] }),
  lte: (field: unknown, value: unknown) => ({ lte: [field, value] }),
  desc: (field: unknown) => ({ desc: field }),
  asc: (field: unknown) => ({ asc: field }),
  ilike: (field: unknown, value: unknown) => ({ ilike: [field, value] }),
  inArray: (field: unknown, value: unknown) => ({ inArray: [field, value] }),
  isNull: (field: unknown) => ({ isNull: field }),
  count: (field?: unknown) => ({ count: field ?? 'count' }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => {
    const payload = { sql: strings, values };
    return { ...payload, mapWith: () => payload };
  },
  relations: (_table: unknown, cb?: (helpers: { one: () => object; many: () => object }) => object) =>
    typeof cb === 'function' ? cb({ one: () => ({}), many: () => ({}) }) : {},
};

export function createDrizzleOrmMock(overrides: DrizzleMockOverrides = {}) {
  return { ...baseDrizzleOrmMock, ...overrides };
}
