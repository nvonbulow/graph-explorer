import type { LadybugValue } from "./types.ts";
export const LADYBUG_VERTEX_ID_VERSION = "1";
export const LADYBUG_EDGE_ID_VERSION = "1";

const FNV_1A_32_OFFSET_BASIS = 0x811c9dc5;
const FNV_1A_32_PRIME = 0x01000193;

type Base64Globals = typeof globalThis & {
  Buffer?: {
    from(
      input: string | Uint8Array,
      encoding?: string,
    ): { toString(encoding: string): string };
  };
};

export type DecodedLadybugVertexId = {
  readonly label: string;
  readonly value: string;
};

export type DecodedLadybugEdgeId = {
  readonly type: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly source: DecodedLadybugVertexId;
  readonly target: DecodedLadybugVertexId;
};

export type VersionedLadybugIdPayload = {
  readonly version: string;
  readonly payload: string;
};

export function encodeLadybugVertexId(options: {
  readonly label: string;
  readonly value: LadybugValue;
}): string {
  return encodeVersionedLadybugId(
    LADYBUG_VERTEX_ID_VERSION,
    JSON.stringify([
      options.label,
      stringifyLadybugPrimaryKeyValue(options.value),
    ]),
  );
}

export function decodeLadybugVertexId(
  id: string,
): DecodedLadybugVertexId | undefined {
  const decoded = decodeVersionedLadybugId(id);
  if (decoded?.version !== LADYBUG_VERTEX_ID_VERSION) {
    return undefined;
  }

  const parsed = parsePayload(decoded.payload);
  if (
    Array.isArray(parsed) &&
    parsed.length === 2 &&
    typeof parsed[0] === "string" &&
    parsed[0].length > 0 &&
    typeof parsed[1] === "string" &&
    parsed[1].length > 0
  ) {
    return { label: parsed[0], value: parsed[1] };
  }

  return undefined;
}

export function encodeLadybugEdgeId(options: {
  readonly type: string;
  readonly sourceId: string;
  readonly targetId: string;
}): string {
  return encodeVersionedLadybugId(
    LADYBUG_EDGE_ID_VERSION,
    JSON.stringify([options.type, options.sourceId, options.targetId]),
  );
}

export function decodeLadybugEdgeId(
  id: string,
): DecodedLadybugEdgeId | undefined {
  const decoded = decodeVersionedLadybugId(id);
  if (decoded?.version !== LADYBUG_EDGE_ID_VERSION) {
    return undefined;
  }

  const parsed = parsePayload(decoded.payload);
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 3 ||
    typeof parsed[0] !== "string" ||
    parsed[0].length === 0 ||
    typeof parsed[1] !== "string" ||
    parsed[1].length === 0 ||
    typeof parsed[2] !== "string" ||
    parsed[2].length === 0
  ) {
    return undefined;
  }

  const source = decodeLadybugVertexId(parsed[1]);
  const target = decodeLadybugVertexId(parsed[2]);
  if (source == null || target == null) {
    return undefined;
  }

  return {
    type: parsed[0],
    sourceId: parsed[1],
    targetId: parsed[2],
    source,
    target,
  };
}

export function encodeVersionedLadybugId(
  version: string,
  payload: string,
): string {
  const encodedPayload = encodeBase64Url(payload);
  return [
    hashLadybugIdPayload(encodedPayload),
    encodeBase64Url(version),
    encodedPayload,
  ].join(".");
}

export function decodeVersionedLadybugId(
  id: string,
): VersionedLadybugIdPayload | undefined {
  const components = id.split(".");
  if (components.length !== 3) {
    return undefined;
  }

  const [hash, encodedVersion, encodedPayload] = components;
  if (hash !== hashLadybugIdPayload(encodedPayload)) {
    return undefined;
  }

  const version = decodeBase64Url(encodedVersion);
  const payload = decodeBase64Url(encodedPayload);
  if (version == null || payload == null) {
    return undefined;
  }

  return { version, payload };
}

export function stringifyLadybugPrimaryKeyValue(value: LadybugValue): string {
  if (value === null) {
    return "null";
  }

  switch (typeof value) {
    case "undefined":
      return "undefined";
    case "string":
      return value;
    case "number":
    case "boolean":
    case "bigint":
      return String(value);
    case "function":
      return "[Function]";
    case "symbol":
      return "[Symbol]";
    case "object":
      return JSON.stringify(value) ?? "";
  }
}

export function encodeBase64Url(value: string): string {
  const buffer = (globalThis as Base64Globals).Buffer;
  if (buffer != null) {
    return buffer
      .from(value, "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/u, "");
  }

  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

export function decodeBase64Url(value: string): string | undefined {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    return undefined;
  }

  const padded = `${value}${"=".repeat((4 - (value.length % 4)) % 4)}`;
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  const buffer = (globalThis as Base64Globals).Buffer;
  if (buffer != null) {
    try {
      return buffer.from(base64, "base64").toString("utf8");
    } catch {
      return undefined;
    }
  }

  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return undefined;
  }
}

export function hashLadybugIdPayload(encodedPayload: string): string {
  let hash = FNV_1A_32_OFFSET_BASIS;
  for (let index = 0; index < encodedPayload.length; index += 1) {
    hash ^= encodedPayload.charCodeAt(index);
    hash = Math.imul(hash, FNV_1A_32_PRIME) >>> 0;
  }

  return encodeHashPrefix(hash);
}

function encodeHashPrefix(hash: number): string {
  const bytes = new Uint8Array(4);
  bytes[0] = (hash >>> 24) & 0xff;
  bytes[1] = (hash >>> 16) & 0xff;
  bytes[2] = (hash >>> 8) & 0xff;
  bytes[3] = hash & 0xff;

  const buffer = (globalThis as Base64Globals).Buffer;
  if (buffer != null) {
    return buffer
      .from(bytes)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/u, "");
  }

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

function parsePayload(payload: string): unknown {
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return undefined;
  }
}
