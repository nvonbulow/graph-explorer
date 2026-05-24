import type {
  Criterion,
  ErrorResponse,
  NeighborsRequest,
  NeighborsResponse,
} from "@/connector/useGEFetchTypes";

import isErrorResponse from "@/connector/utils/isErrorResponse";
import { createEdge, createVertex, type VertexId } from "@/core";

import type { OCEdge, OCVertex, OpenCypherFetch } from "../../types";
import type { LadybugSchemaCache } from "./schemaCache";

import mapApiEdge from "../../mappers/mapApiEdge";
import mapApiVertex from "../../mappers/mapApiVertex";
import {
  decodeVertexIdParam,
  formatLadybugLabel,
  formatLadybugPrimaryKeyValue,
} from "./idParam";

const DEFAULT_LIMIT = 0;

const fetchNeighbors = async (
  openCypherFetch: OpenCypherFetch,
  schemaCache: LadybugSchemaCache,
  request: NeighborsRequest,
): Promise<NeighborsResponse> => {
  const decoded = decodeVertexIdParam(request.vertexId);
  await schemaCache.schema();
  const primaryKey = await requiredPrimaryKeyInfo(schemaCache, decoded.label);
  const template = await neighborsQuery(
    schemaCache,
    request,
    decoded.label,
    primaryKey,
  );
  const data = await openCypherFetch<NeighborsResult>(template);

  if (isErrorResponse(data)) {
    throw new Error(data.detailedMessage);
  }

  const row = data.results[0];
  return {
    vertices: (row?.vObjects ?? []).map(vertex =>
      createVertex(mapApiVertex(vertex)),
    ),
    edges: (row?.eObjects ?? []).map(edge => createEdge(mapApiEdge(edge))),
  };
};

export default fetchNeighbors;

export { fetchNeighbors };

type NeighborsResult =
  | {
      results: Array<{
        vObjects?: OCVertex[];
        eObjects?: OCEdge[];
        sourceObjects?: OCVertex[];
      }>;
    }
  | ErrorResponse;

async function neighborsQuery(
  schemaCache: LadybugSchemaCache,
  request: NeighborsRequest,
  sourceLabel: string,
  sourcePrimaryKey: PrimaryKeyInfo,
): Promise<string> {
  const targetMatch =
    request.filterByVertexTypes?.length === 1
      ? `neighbor:${formatLadybugLabel(request.filterByVertexTypes[0])}`
      : "neighbor";
  const whereConditions = [
    `source.${formatLadybugLabel(sourcePrimaryKey.name)} = ${formatLadybugPrimaryKeyValue(decodeVertexIdParam(request.vertexId).value, sourcePrimaryKey)}`,
    multipleTargetTypePredicate(request.filterByVertexTypes),
    await excludedVerticesPredicate(schemaCache, request.excludedVertices),
    ...(request.filterCriteria ?? []).map(criterionPredicate),
  ].filter(
    (condition): condition is string =>
      condition != null && condition.length > 0,
  );
  const whereClause =
    whereConditions.length > 0 ? ` WHERE ${whereConditions.join(" AND ")}` : "";
  const limit = normalizeLimit(request.limit);

  if (limit > 0) {
    return `MATCH (source:${formatLadybugLabel(sourceLabel)})-[edge]-(${targetMatch})${whereClause} WITH DISTINCT source, neighbor LIMIT ${limit} MATCH (source)-[edge]-(neighbor) RETURN collect(DISTINCT source) AS sourceObjects, collect(DISTINCT neighbor) AS vObjects, collect(edge) AS eObjects`;
  }

  return `MATCH (source:${formatLadybugLabel(sourceLabel)})-[edge]-(${targetMatch})${whereClause} RETURN collect(DISTINCT source) AS sourceObjects, collect(DISTINCT neighbor) AS vObjects, collect(edge) AS eObjects`;
}

function multipleTargetTypePredicate(
  vertexTypes: readonly string[] | undefined,
): string {
  if (vertexTypes == null || vertexTypes.length <= 1) {
    return "";
  }

  return `label(neighbor) IN [${vertexTypes
    .map(type => formatLadybugPrimaryKeyValue(type))
    .join(", ")}]`;
}

async function excludedVerticesPredicate(
  schemaCache: LadybugSchemaCache,
  excludedVertices: ReadonlySet<VertexId> | undefined,
): Promise<string> {
  if (excludedVertices == null || excludedVertices.size === 0) {
    return "";
  }

  const predicates: string[] = [];
  for (const vertexId of excludedVertices) {
    const decoded = decodeVertexIdParam(vertexId);
    const primaryKey = await requiredPrimaryKeyInfo(schemaCache, decoded.label);
    const labelPredicate = `label(neighbor) = ${formatLadybugPrimaryKeyValue(
      decoded.label,
    )}`;
    const primaryKeyPredicate = `neighbor.${formatLadybugLabel(
      primaryKey.name,
    )} = ${formatLadybugPrimaryKeyValue(decoded.value, primaryKey)}`;
    predicates.push(`(${labelPredicate} AND ${primaryKeyPredicate})`);
  }

  return predicates.length > 0 ? `NOT (${predicates.join(" OR ")})` : "";
}

function criterionPredicate(criterion: Criterion): string {
  const field = `neighbor.${formatLadybugLabel(criterion.name)}`;
  const value = criterionValue(criterion);

  switch (criterion.operator.toLowerCase()) {
    case "gt":
    case ">":
      return `${field} > ${value}`;
    case "gte":
    case ">=":
      return `${field} >= ${value}`;
    case "lt":
    case "<":
      return `${field} < ${value}`;
    case "lte":
    case "<=":
      return `${field} <= ${value}`;
    case "neq":
    case "!=":
      return `${field} <> ${value}`;
    case "like":
      return `${field} CONTAINS ${value}`;
    case "eq":
    case "==":
    default:
      return `${field} = ${value}`;
  }
}

function criterionValue(criterion: Criterion): string {
  if (criterion.dataType === "Number") {
    const value = Number(criterion.value);
    if (!Number.isFinite(value)) {
      throw new Error(
        `Invalid Ladybug numeric filter value for ${criterion.name}`,
      );
    }

    return String(value);
  }

  if (criterion.dataType === "Date") {
    return `DateTime(${formatLadybugPrimaryKeyValue(String(criterion.value))})`;
  }

  return formatLadybugPrimaryKeyValue(String(criterion.value));
}

function normalizeLimit(limit: number | undefined): number {
  return limit == null || limit < 0 ? DEFAULT_LIMIT : limit;
}

type PrimaryKeyInfo = NonNullable<
  Awaited<ReturnType<LadybugSchemaCache["primaryKeyInfo"]>>
>;

async function requiredPrimaryKeyInfo(
  schemaCache: LadybugSchemaCache,
  label: string,
): Promise<PrimaryKeyInfo> {
  const primaryKey = await schemaCache.primaryKeyInfo(label);
  if (primaryKey == null || primaryKey.name.length === 0) {
    throw new Error(`Missing Ladybug primary key for vertex label ${label}`);
  }

  return primaryKey;
}
