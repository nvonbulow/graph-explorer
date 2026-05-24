import type {
  LadybugRecord,
  LadybugValue,
  NeptunePropertyValue,
  NeptuneValue,
} from "./types.ts";

export function isLadybugRecord(value: LadybugValue): value is LadybugRecord {
  return isPlainRecord(value);
}

export function normalizeLadybugScalar(value: LadybugValue): NeptuneValue {
  if (value == null) {
    return null;
  }

  const integerWrapper = normalizeIntegerWrapper(value);
  if (integerWrapper !== undefined) {
    return integerWrapper;
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return normalizeNumber(value);
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof String) {
    return value.valueOf();
  }

  if (value instanceof Boolean) {
    return value.valueOf();
  }

  if (value instanceof Number) {
    const numberValue = value.valueOf();
    return normalizeNumber(numberValue);
  }

  if (Array.isArray(value)) {
    return value.map(item => normalizeLadybugScalar(item));
  }

  if (isPlainRecord(value)) {
    return normalizeLadybugRecord(value);
  }

  return "[Unsupported Ladybug value]";
}

export function normalizeLadybugPropertyValue(
  value: LadybugValue,
): NeptunePropertyValue {
  if (Array.isArray(value)) {
    return value.map(item => normalizeLadybugPropertyValue(item));
  }

  const normalized = normalizeLadybugScalar(value);
  if (
    normalized == null ||
    typeof normalized === "string" ||
    typeof normalized === "number" ||
    typeof normalized === "boolean" ||
    Array.isArray(normalized)
  ) {
    return normalized as NeptunePropertyValue;
  }

  return stringifyDeterministically(normalized);
}

function stringifyDeterministically(value: NeptuneValue): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: NeptuneValue): unknown {
  if (Array.isArray(value)) {
    return value.map(item => sortJsonValue(item));
  }

  if (value != null && typeof value === "object") {
    const record = value as Record<string, NeptuneValue>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortJsonValue(record[key]);
    }
    return sorted;
  }

  return value;
}

export function normalizeIntegerWrapper(
  value: LadybugValue,
): number | string | undefined {
  if (!isPlainRecord(value)) {
    return undefined;
  }

  const typed = hasIntegerTypeMarker(value);
  const entries = Object.entries(value);
  if (Object.hasOwn(value, "@value")) {
    return typed || entries.length === 1
      ? normalizeIntegerPayload(value["@value"], typed)
      : undefined;
  }
  if (Object.hasOwn(value, "value")) {
    return typed || entries.length === 1
      ? normalizeIntegerPayload(value.value, typed)
      : undefined;
  }

  if (!typed && entries.length === 1 && isIntegerPayloadField(entries[0][0])) {
    return normalizeIntegerPayload(entries[0][1], false);
  }

  if (typed) {
    const payload = entries.filter(
      ([key]) =>
        key !== "@type" &&
        key !== "type" &&
        key !== "dataType" &&
        key !== "columnType",
    );
    if (payload.length === 1 && isIntegerPayloadField(payload[0][0])) {
      return normalizeIntegerPayload(payload[0][1], true);
    }
  }

  return undefined;
}

function normalizeLadybugRecord(
  record: LadybugRecord,
): Record<string, NeptuneValue> {
  const normalized: Record<string, NeptuneValue> = {};
  for (const [key, value] of Object.entries(record)) {
    normalized[key] = normalizeLadybugScalar(value);
  }
  return normalized;
}

function normalizeNumber(value: number): number | string {
  if (Number.isFinite(value) && Number.isSafeInteger(value)) {
    return value;
  }
  if (Number.isFinite(value) && !Number.isInteger(value)) {
    return value;
  }
  return value.toString();
}

function isPlainRecord(value: unknown): value is LadybugRecord {
  if (
    value == null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value instanceof Date ||
    value instanceof String ||
    value instanceof Number ||
    value instanceof Boolean
  ) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isIntegerPayloadField(field: string): boolean {
  return (
    field === "@value" ||
    field === "value" ||
    field === "low" ||
    field === "high"
  );
}

function hasIntegerTypeMarker(record: LadybugRecord): boolean {
  return ["@type", "type", "dataType", "columnType"].some(field => {
    const value = record[field];
    return typeof value === "string" && /\b(?:U?INT64|BIGINT)\b/iu.test(value);
  });
}

function normalizeIntegerPayload(
  value: LadybugValue,
  typed: boolean,
): number | string | undefined {
  if (value instanceof Number) {
    const numberValue = value.valueOf() as number;
    return normalizeNumber(numberValue);
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return undefined;
    }
    return Number.isInteger(value) && !Number.isSafeInteger(value)
      ? value.toString()
      : value;
  }
  if (typeof value === "string") {
    return typed || /^[-+]?\d+$/u.test(value) ? value : undefined;
  }
  return undefined;
}
