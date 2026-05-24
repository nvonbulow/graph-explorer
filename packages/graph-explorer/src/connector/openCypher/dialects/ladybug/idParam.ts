import {
  decodeLadybugEdgeId as decodeSharedLadybugEdgeId,
  decodeLadybugVertexId as decodeSharedLadybugVertexId,
  type DecodedLadybugEdgeId as SharedDecodedLadybugEdgeId,
  type DecodedLadybugVertexId as SharedDecodedLadybugVertexId,
} from "@graph-explorer/shared/ladybug";

import { type EdgeId, getRawId, type VertexId } from "@/core";

import type { LadybugPrimaryKeyInfo } from "./schemaReaders";

export {
  decodeBase64Url,
  decodeLadybugEdgeId,
  decodeLadybugVertexId,
  decodeVersionedLadybugId,
  encodeBase64Url,
  encodeLadybugEdgeId,
  encodeLadybugVertexId,
  encodeVersionedLadybugId,
  hashLadybugIdPayload,
  LADYBUG_EDGE_ID_VERSION,
  LADYBUG_VERTEX_ID_VERSION,
  stringifyLadybugPrimaryKeyValue,
  type DecodedLadybugEdgeId,
  type DecodedLadybugVertexId,
  type VersionedLadybugIdPayload,
} from "@graph-explorer/shared/ladybug";

export type LadybugPrimaryKeyQueryValue = string | number | boolean;

export type LadybugVertexIdParam = {
  readonly label: string;
  readonly primaryKeyValue: string;
  readonly primaryKeyPredicateValue: string;
};

export type LadybugEdgeIdParam = {
  readonly type: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly source: LadybugVertexIdParam;
  readonly target: LadybugVertexIdParam;
};

export function vertexIdParam(id: VertexId | string): LadybugVertexIdParam {
  const decoded = decodeVertexIdParam(id);
  return toVertexIdParam(decoded);
}

export function edgeIdParam(id: EdgeId | string): LadybugEdgeIdParam {
  const rawId = rawGraphExplorerId(id);
  const decoded = decodeSharedLadybugEdgeId(rawId);
  if (decoded == null) {
    throw new Error("Malformed Ladybug edge ID");
  }

  return toEdgeIdParam(decoded);
}

export function decodeVertexIdParam(
  id: VertexId | string,
): SharedDecodedLadybugVertexId {
  const rawId = rawGraphExplorerId(id);
  const decoded = decodeSharedLadybugVertexId(rawId);
  if (decoded == null) {
    throw new Error("Malformed Ladybug vertex ID");
  }

  return decoded;
}

export function decodeEdgeIdParam(
  id: EdgeId | string,
): SharedDecodedLadybugEdgeId {
  const rawId = rawGraphExplorerId(id);
  const decoded = decodeSharedLadybugEdgeId(rawId);
  if (decoded == null) {
    throw new Error("Malformed Ladybug edge ID");
  }

  return decoded;
}

export function formatLadybugPrimaryKeyValue(
  value: LadybugPrimaryKeyQueryValue,
  primaryKeyInfo?: Pick<LadybugPrimaryKeyInfo, "dataType" | "type"> | string,
): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Ladybug numeric primary-key value must be finite");
    }

    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  const dataType =
    typeof primaryKeyInfo === "string"
      ? primaryKeyInfo
      : (primaryKeyInfo?.dataType ?? primaryKeyInfo?.type);
  if (isNumericLadybugType(dataType)) {
    const numericValue = value.trim();
    if (!isSafeNumericLiteral(numericValue)) {
      throw new Error(
        "Ladybug numeric primary-key value must be a valid numeric literal",
      );
    }

    return numericValue;
  }

  if (isBooleanLadybugType(dataType)) {
    const booleanValue = value.trim().toLowerCase();
    if (booleanValue === "true" || booleanValue === "false") {
      return booleanValue;
    }

    throw new Error("Ladybug boolean primary-key value must be true or false");
  }

  return JSON.stringify(value);
}

function isNumericLadybugType(dataType: string | undefined): boolean {
  if (dataType == null) {
    return false;
  }

  return /^(?:u?int(?:eger)?\d*|bigint|smallint|tinyint|long|short|byte|float(?:32|64)?|double|decimal|number|numeric|real)$/iu.test(
    dataType.trim(),
  );
}

function isBooleanLadybugType(dataType: string | undefined): boolean {
  if (dataType == null) {
    return false;
  }

  return /^(?:bool|boolean)$/iu.test(dataType.trim());
}

function isSafeNumericLiteral(value: string): boolean {
  return /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/u.test(value);
}

export function formatLadybugLabel(label: string): string {
  return `\`${label.replace(/`/gu, "``")}\``;
}

function toEdgeIdParam(
  decoded: SharedDecodedLadybugEdgeId,
): LadybugEdgeIdParam {
  return {
    type: decoded.type,
    sourceId: decoded.sourceId,
    targetId: decoded.targetId,
    source: toVertexIdParam(decoded.source),
    target: toVertexIdParam(decoded.target),
  };
}

function toVertexIdParam(
  decoded: SharedDecodedLadybugVertexId,
): LadybugVertexIdParam {
  return {
    label: decoded.label,
    primaryKeyValue: decoded.value,
    primaryKeyPredicateValue: formatLadybugPrimaryKeyValue(decoded.value),
  };
}

function rawGraphExplorerId(id: VertexId | EdgeId | string): string {
  const rawId = typeof id === "string" ? id : getRawId(id);
  if (typeof rawId !== "string") {
    throw new Error("Ladybug Graph Explorer ID must be a string");
  }

  return rawId;
}
