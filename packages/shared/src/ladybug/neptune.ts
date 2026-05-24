import type {
  Awaitable,
  LadybugRecord,
  LadybugValue,
  NeptuneNode,
  NeptuneOpenCypherResponse,
  NeptuneProperties,
  NeptuneRecord,
  NeptuneRelationship,
  NeptuneResultRow,
  NeptuneValue,
} from "./types.ts";

import { encodeLadybugEdgeId, encodeLadybugVertexId } from "./ids.ts";
import {
  isLadybugRecord,
  normalizeLadybugPropertyValue,
  normalizeLadybugScalar,
} from "./scalars.ts";

export type LadybugPrimaryKeyMap = Readonly<Record<string, string>>;

export type LadybugEndpointName = "_src" | "_dst";

export type LadybugEndpointResolverContext = {
  readonly endpoint: LadybugEndpointName;
  readonly relationship: LadybugRecord;
};

export type LadybugEndpointResolver = (
  reference: LadybugValue,
  context: LadybugEndpointResolverContext,
) => Awaitable<LadybugValue | null | undefined>;

export type LadybugEndpointCache = {
  get(reference: LadybugValue): Awaitable<LadybugValue | null | undefined>;
};

export type LadybugNeptuneAdapterOptions = {
  readonly primaryKeys: LadybugPrimaryKeyMap;
  readonly endpointResolver?: LadybugEndpointResolver | undefined;
  readonly endpointCache?: LadybugEndpointCache | undefined;
};

type EndpointIdentity = {
  readonly label: string;
  readonly value: LadybugValue;
};

type RowEndpointCacheEntry = {
  readonly reference: LadybugValue;
  readonly node: LadybugRecord;
};

export async function adaptLadybugRecordsToNeptuneResponse(
  records: readonly LadybugRecord[],
  options: LadybugNeptuneAdapterOptions,
): Promise<NeptuneOpenCypherResponse> {
  const results: NeptuneResultRow[] = [];
  for (const record of records) {
    results.push(await adaptLadybugRecordToNeptuneResultRow(record, options));
  }
  return { results };
}

export async function adaptLadybugRecordToNeptuneResultRow(
  record: LadybugRecord,
  options: LadybugNeptuneAdapterOptions,
): Promise<NeptuneResultRow> {
  const row: NeptuneResultRow = {};
  const rowEndpointCache = createRowEndpointCache(record);
  for (const [key, value] of Object.entries(record)) {
    row[key] = await adaptLadybugValueToNeptuneValue(
      value,
      options,
      rowEndpointCache,
    );
  }
  return row;
}

export async function adaptLadybugValueToNeptuneValue(
  value: LadybugValue,
  options: LadybugNeptuneAdapterOptions,
  rowEndpointCache?: LadybugEndpointCache,
): Promise<NeptuneValue> {
  if (Array.isArray(value)) {
    return Promise.all(
      value.map(item =>
        adaptLadybugValueToNeptuneValue(item, options, rowEndpointCache),
      ),
    );
  }

  if (!isLadybugRecord(value)) {
    return normalizeLadybugScalar(value);
  }

  if (isLadybugRelationshipRecord(value)) {
    return adaptLadybugRelationshipToNeptuneRelationship(
      value,
      options,
      rowEndpointCache,
    );
  }

  if (isLadybugNodeRecord(value)) {
    return adaptLadybugNodeToNeptuneNode(value, options);
  }

  return adaptPlainLadybugRecordToNeptuneRecord(
    value,
    options,
    rowEndpointCache,
  );
}

export function adaptLadybugNodeToNeptuneNode(
  record: LadybugRecord,
  options: LadybugNeptuneAdapterOptions,
): NeptuneNode {
  const identity = readNodeIdentity(record, options);
  return {
    "~entityType": "node",
    "~id": encodeLadybugVertexId(identity),
    "~labels": [identity.label],
    "~properties": adaptLadybugRecordToNeptuneProperties(record),
  };
}

export async function adaptLadybugRelationshipToNeptuneRelationship(
  record: LadybugRecord,
  options: LadybugNeptuneAdapterOptions,
  rowEndpointCache?: LadybugEndpointCache,
): Promise<NeptuneRelationship> {
  const type = readRequiredString(record, "_label", "relationship type");
  const source = await resolveEndpointIdentity(
    record,
    "_src",
    options,
    rowEndpointCache,
  );
  const target = await resolveEndpointIdentity(
    record,
    "_dst",
    options,
    rowEndpointCache,
  );
  const sourceId = encodeLadybugVertexId(source);
  const targetId = encodeLadybugVertexId(target);

  return {
    "~entityType": "relationship",
    "~id": encodeLadybugEdgeId({ type, sourceId, targetId }),
    "~start": sourceId,
    "~end": targetId,
    "~type": type,
    "~properties": adaptLadybugRecordToNeptuneProperties(record),
  };
}

export function adaptLadybugRecordToNeptuneProperties(
  record: LadybugRecord,
): NeptuneProperties {
  const properties: Record<
    string,
    ReturnType<typeof normalizeLadybugPropertyValue>
  > = {};
  for (const [key, value] of Object.entries(record)) {
    if (!isPrivateLadybugField(key)) {
      properties[key] = normalizeLadybugPropertyValue(value);
    }
  }
  return properties;
}

export async function adaptPlainLadybugRecordToNeptuneRecord(
  record: LadybugRecord,
  options: LadybugNeptuneAdapterOptions,
  rowEndpointCache?: LadybugEndpointCache,
): Promise<NeptuneRecord> {
  const result: Record<string, NeptuneValue> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!isPrivateLadybugField(key)) {
      result[key] = await adaptLadybugValueToNeptuneValue(
        value,
        options,
        rowEndpointCache,
      );
    }
  }
  return result;
}

function isLadybugRelationshipRecord(record: LadybugRecord): boolean {
  return (
    isNonEmptyString(record._label) &&
    Object.hasOwn(record, "_src") &&
    Object.hasOwn(record, "_dst") &&
    Object.hasOwn(record, "_id")
  );
}

function isLadybugNodeRecord(record: LadybugRecord): boolean {
  return isNonEmptyString(record._label);
}

function createRowEndpointCache(
  record: LadybugRecord,
): LadybugEndpointCache | undefined {
  const entries: RowEndpointCacheEntry[] = [];
  for (const value of Object.values(record)) {
    collectRowEndpointCacheEntries(value, entries);
  }

  if (entries.length === 0) {
    return undefined;
  }

  return {
    get: (reference: LadybugValue) => {
      for (const entry of entries) {
        if (sameLadybugEndpointReference(reference, entry.reference)) {
          return entry.node;
        }
      }

      return undefined;
    },
  };
}

function collectRowEndpointCacheEntries(
  value: LadybugValue,
  entries: RowEndpointCacheEntry[],
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectRowEndpointCacheEntries(item, entries);
    }
    return;
  }

  if (!isLadybugRecord(value)) {
    return;
  }

  if (isRowEndpointNodeRecord(value)) {
    entries.push({ reference: value._id, node: value });
  }

  if (!isLadybugRelationshipRecord(value)) {
    for (const nested of Object.values(value)) {
      collectRowEndpointCacheEntries(nested, entries);
    }
  }
}

function isRowEndpointNodeRecord(record: LadybugRecord): boolean {
  return (
    isLadybugNodeRecord(record) &&
    !isLadybugRelationshipRecord(record) &&
    Object.hasOwn(record, "_id") &&
    record._id != null
  );
}

function sameLadybugEndpointReference(
  left: LadybugValue,
  right: LadybugValue,
): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (
      !Array.isArray(left) ||
      !Array.isArray(right) ||
      left.length !== right.length
    ) {
      return false;
    }

    for (let index = 0; index < left.length; index += 1) {
      if (!sameLadybugEndpointReference(left[index], right[index])) {
        return false;
      }
    }

    return true;
  }

  if (!isLadybugRecord(left) || !isLadybugRecord(right)) {
    return false;
  }

  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  for (let index = 0; index < leftKeys.length; index += 1) {
    const key = leftKeys[index];
    if (key !== rightKeys[index]) {
      return false;
    }

    if (!sameLadybugEndpointReference(left[key], right[key])) {
      return false;
    }
  }

  return true;
}

function readNodeIdentity(
  record: LadybugRecord,
  options: LadybugNeptuneAdapterOptions,
): EndpointIdentity {
  const label = readRequiredString(record, "_label", "node label");
  const primaryKey = readPrimaryKeyName(label, options);
  const value = record[primaryKey];
  if (value == null) {
    throw new Error(
      `Ladybug node ${label} is missing primary-key value ${primaryKey}`,
    );
  }
  return { label, value };
}

async function resolveEndpointIdentity(
  relationship: LadybugRecord,
  endpoint: LadybugEndpointName,
  options: LadybugNeptuneAdapterOptions,
  rowEndpointCache?: LadybugEndpointCache,
): Promise<EndpointIdentity> {
  const reference = relationship[endpoint];
  if (reference == null) {
    throw new Error(`Ladybug relationship endpoint ${endpoint} is missing`);
  }

  if (isLadybugRecord(reference) && isLadybugNodeRecord(reference)) {
    return readNodeIdentity(reference, options);
  }

  const resolved = await resolveEndpointReference(
    reference,
    {
      endpoint,
      relationship,
    },
    options,
    rowEndpointCache,
  );
  if (resolved == null) {
    throw new Error(
      `Ladybug relationship endpoint ${endpoint} could not be resolved`,
    );
  }

  if (isLadybugRecord(resolved)) {
    if (isLadybugNodeRecord(resolved)) {
      return readNodeIdentity(resolved, options);
    }

    const label = readEndpointLabel(resolved) ?? readEndpointLabel(reference);
    if (label != null) {
      return readEndpointPrimaryKeyValue(label, resolved, options);
    }
  }

  const label = readEndpointLabel(reference);
  if (label == null) {
    throw new Error(
      `Ladybug relationship endpoint ${endpoint} resolved to a primary-key value without a node label`,
    );
  }
  readPrimaryKeyName(label, options);
  return { label, value: resolved };
}

async function resolveEndpointReference(
  reference: LadybugValue,
  context: LadybugEndpointResolverContext,
  options: LadybugNeptuneAdapterOptions,
  rowEndpointCache?: LadybugEndpointCache,
): Promise<LadybugValue | null | undefined> {
  const cached = await options.endpointCache?.get(reference);
  if (cached != null) {
    return cached;
  }
  const resolved = await options.endpointResolver?.(reference, context);
  if (resolved != null) {
    return resolved;
  }

  return rowEndpointCache?.get(reference);
}

function readEndpointPrimaryKeyValue(
  label: string,
  record: LadybugRecord,
  options: LadybugNeptuneAdapterOptions,
): EndpointIdentity {
  const primaryKey = readPrimaryKeyName(label, options);
  const value = record[primaryKey];
  if (value == null) {
    throw new Error(
      `Ladybug endpoint node ${label} is missing primary-key value ${primaryKey}`,
    );
  }
  return { label, value };
}

function readPrimaryKeyName(
  label: string,
  options: LadybugNeptuneAdapterOptions,
): string {
  const primaryKey = options.primaryKeys[label];
  if (!isNonEmptyString(primaryKey)) {
    throw new Error(`Ladybug node ${label} is missing primary-key metadata`);
  }
  return primaryKey;
}

function readRequiredString(
  record: LadybugRecord,
  key: string,
  description: string,
): string {
  const value = record[key];
  if (!isNonEmptyString(value)) {
    throw new Error(`Ladybug record is missing ${description} field ${key}`);
  }
  return value;
}

function readEndpointLabel(value: LadybugValue): string | undefined {
  if (!isLadybugRecord(value)) {
    return undefined;
  }

  const label = value._label;
  if (isNonEmptyString(label)) {
    return label;
  }

  const table = value.table;
  if (
    isNonEmptyString(table) ||
    typeof table === "number" ||
    typeof table === "bigint"
  ) {
    return String(table);
  }

  const tableName = value.tableName;
  if (isNonEmptyString(tableName)) {
    return tableName;
  }

  return undefined;
}

function isPrivateLadybugField(key: string): boolean {
  return key.startsWith("_");
}

function isNonEmptyString(value: LadybugValue): value is string {
  return typeof value === "string" && value.length > 0;
}
