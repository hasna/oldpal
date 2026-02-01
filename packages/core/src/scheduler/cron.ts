const MAX_MINUTES_SCAN = 60 * 24 * 366; // ~1 year

interface CronFields {
  minutes: Set<number>;
  hours: Set<number>;
  days: Set<number>;
  months: Set<number>;
  weekdays: Set<number>;
}

function parseField(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>();
  const parts = field.split(',');

  for (const partRaw of parts) {
    const part = partRaw.trim();
    if (part === '*') {
      for (let i = min; i <= max; i += 1) values.add(i);
      continue;
    }

    const stepMatch = part.match(/^(.+)\/(\d+)$/);
    if (stepMatch) {
      const base = stepMatch[1];
      const step = Number(stepMatch[2]);
      if (!Number.isFinite(step) || step <= 0) continue;
      let start = min;
      let end = max;
      if (base !== '*') {
        const range = base.split('-').map((v) => Number(v));
        if (range.length === 2 && Number.isFinite(range[0]) && Number.isFinite(range[1])) {
          start = Math.max(min, range[0]);
          end = Math.min(max, range[1]);
        } else if (Number.isFinite(Number(base))) {
          start = Math.max(min, Number(base));
          end = max;
        }
      }
      for (let i = start; i <= end; i += step) values.add(i);
      continue;
    }

    const range = part.split('-').map((v) => Number(v));
    if (range.length === 2 && Number.isFinite(range[0]) && Number.isFinite(range[1])) {
      const start = Math.max(min, range[0]);
      const end = Math.min(max, range[1]);
      for (let i = start; i <= end; i += 1) values.add(i);
      continue;
    }

    const num = Number(part);
    if (Number.isFinite(num) && num >= min && num <= max) {
      values.add(num);
    }
  }

  return values;
}

export function parseCronExpression(expression: string): CronFields | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    return null;
  }

  const [minField, hourField, dayField, monthField, weekdayField] = fields;
  return {
    minutes: parseField(minField, 0, 59),
    hours: parseField(hourField, 0, 23),
    days: parseField(dayField, 1, 31),
    months: parseField(monthField, 1, 12),
    weekdays: parseField(weekdayField, 0, 6),
  };
}

function matchesCron(date: Date, fields: CronFields): boolean {
  return (
    fields.minutes.has(date.getMinutes()) &&
    fields.hours.has(date.getHours()) &&
    fields.days.has(date.getDate()) &&
    fields.months.has(date.getMonth() + 1) &&
    fields.weekdays.has(date.getDay())
  );
}

export function getNextCronRun(expression: string, fromTime: number): number | undefined {
  const fields = parseCronExpression(expression);
  if (!fields) return undefined;

  const cursor = new Date(fromTime);
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  for (let i = 0; i < MAX_MINUTES_SCAN; i += 1) {
    if (matchesCron(cursor, fields)) {
      return cursor.getTime();
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }

  return undefined;
}
