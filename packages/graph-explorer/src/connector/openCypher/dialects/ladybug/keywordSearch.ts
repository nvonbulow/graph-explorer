import type { LadybugValue } from "@graph-explorer/shared/ladybug";

import type {
  ErrorResponse,
  KeywordSearchRequest,
  KeywordSearchResponse,
  SchemaResponse,
} from "@/connector/useGEFetchTypes";

import isErrorResponse from "@/connector/utils/isErrorResponse";
import { createVertex, type Vertex } from "@/core";
import { LABELS, query, SEARCH_TOKENS } from "@/utils";

import type { OCVertex, OpenCypherFetch } from "../../types";
import type { LadybugSchemaCache } from "./schemaCache";

import mapApiVertex from "../../mappers/mapApiVertex";
import {
  encodeLadybugVertexId,
  formatLadybugLabel,
  formatLadybugPrimaryKeyValue,
} from "./idParam";

type RawKeywordSearchRow = {
  object: OCVertex;
  label: string;
  primaryKeyValue?: LadybugValue;
};

type RawKeywordSearchResponse = {
  results: RawKeywordSearchRow[];
};

type PrimaryKeyInfo = NonNullable<
  Awaited<ReturnType<LadybugSchemaCache["primaryKeyInfo"]>>
>;

type LabelSearch = {
  label: string;
  primaryKey: PrimaryKeyInfo;
  attributes: readonly string[];
};

export async function keywordSearch(
  openCypherFetch: OpenCypherFetch,
  schemaCache: LadybugSchemaCache,
  req: KeywordSearchRequest,
): Promise<KeywordSearchResponse> {
  const vertices = await vertexKeywordSearch(openCypherFetch, schemaCache, req);
  return { vertices };
}

async function vertexKeywordSearch(
  openCypherFetch: OpenCypherFetch,
  schemaCache: LadybugSchemaCache,
  req: KeywordSearchRequest,
): Promise<Vertex[]> {
  const schema = await schemaCache.schema();
  const searches = await buildLabelSearches(
    schemaCache,
    schema,
    req.vertexTypes,
  );
  if (searches.length === 0) {
    return [];
  }

  const data = await openCypherFetch<RawKeywordSearchResponse | ErrorResponse>(
    keywordSearchTemplate(req, searches),
  );

  if (isErrorResponse(data)) {
    throw new Error(data.detailedMessage);
  }

  return data.results.flatMap(row => {
    if (row.primaryKeyValue === undefined) {
      return [];
    }

    return [
      createVertex(
        mapApiVertex({
          ...row.object,
          "~id": encodeLadybugVertexId({
            label: row.label,
            value: row.primaryKeyValue,
          }),
          "~labels": row.object["~labels"]?.length
            ? row.object["~labels"]
            : [row.label],
        }),
      ),
    ];
  });
}

async function buildLabelSearches(
  schemaCache: LadybugSchemaCache,
  schema: SchemaResponse,
  vertexTypes: readonly string[] = [],
): Promise<LabelSearch[]> {
  const requestedLabels = new Set(
    vertexTypes.length > 0
      ? vertexTypes.filter(type => type !== LABELS.MISSING_TYPE)
      : schema.vertices.map(vertex => vertex.type),
  );
  const matchingVertices = schema.vertices.filter(vertex =>
    requestedLabels.has(vertex.type),
  );

  const primaryKeys = await Promise.all(
    matchingVertices.map(vertex => schemaCache.primaryKeyInfo(vertex.type)),
  );

  return matchingVertices.flatMap((vertex, index) => {
    const primaryKey = primaryKeys[index];
    if (primaryKey == null || primaryKey.name.length === 0) {
      return [];
    }

    return [
      {
        label: vertex.type,
        primaryKey,
        attributes: vertex.attributes.map(attribute => attribute.name),
      },
    ];
  });
}

function keywordSearchTemplate(
  req: KeywordSearchRequest,
  searches: readonly LabelSearch[],
): string {
  const matches = searches.map(search => labelSearchTemplate(req, search));
  const limit = limitTemplate(req);

  if (matches.length === 1) {
    return query`
      ${matches[0]}
      ${limit}
    `;
  }

  return query`
    CALL {
      ${matches.join("\nUNION\n")}
    }
    RETURN object, label, primaryKeyValue
    ${limit}
  `;
}

function labelSearchTemplate(
  req: KeywordSearchRequest,
  search: LabelSearch,
): string {
  const where = whereTemplate(req, search);
  const primaryKey = propertyAccess(search.primaryKey.name);

  return query`
    MATCH (v:${formatLadybugLabel(search.label)})
    ${where}
    RETURN v AS object,
           ${formatLadybugPrimaryKeyValue(search.label)} AS label,
           v.${primaryKey} AS primaryKeyValue
  `;
}

function whereTemplate(req: KeywordSearchRequest, search: LabelSearch): string {
  const searchTermWhereClause = searchTermWhereTemplate(req, search);
  return searchTermWhereClause ? `WHERE (${searchTermWhereClause})` : "";
}

function searchTermWhereTemplate(
  { searchTerm, searchByAttributes = [], exactMatch }: KeywordSearchRequest,
  search: LabelSearch,
): string {
  if (!searchTerm) {
    return "";
  }

  const searchValue = formatLadybugPrimaryKeyValue(searchTerm);
  const attributes = searchAttributes(searchByAttributes, search);

  return attributes
    .map(attribute => {
      const isPrimaryKey = attribute === SEARCH_TOKENS.NODE_ID;
      const expression = isPrimaryKey
        ? `v.${propertyAccess(search.primaryKey.name)}`
        : `v.${propertyAccess(attribute)}`;

      if (exactMatch === true && isPrimaryKey) {
        return `${expression} = ${formatLadybugPrimaryKeyValue(searchTerm, search.primaryKey)}`;
      }

      return exactMatch === true
        ? `toString(${expression}) = ${searchValue}`
        : `toString(${expression}) CONTAINS ${searchValue}`;
    })
    .join(" OR ");
}

function searchAttributes(
  searchByAttributes: readonly string[],
  search: LabelSearch,
): string[] {
  const attributes = searchByAttributes.includes(SEARCH_TOKENS.ALL_ATTRIBUTES)
    ? [SEARCH_TOKENS.NODE_ID, ...search.attributes]
    : searchByAttributes;

  return Array.from(
    new Set(attributes.filter(attr => attr !== SEARCH_TOKENS.ALL_ATTRIBUTES)),
  );
}

function limitTemplate({ limit, offset }: KeywordSearchRequest): string {
  if (limit && offset) {
    return `SKIP ${offset} LIMIT ${limit}`;
  }
  if (limit) {
    return `LIMIT ${limit}`;
  }
  return "";
}

function propertyAccess(property: string): string {
  return formatLadybugLabel(property);
}
