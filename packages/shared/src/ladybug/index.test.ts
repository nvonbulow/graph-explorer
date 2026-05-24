import type {
  LadybugEndpointResolverContext,
  LadybugQueryResult,
  LadybugRuntime,
  LadybugValue,
  NeptuneNode,
  NeptuneRelationship,
} from "./index.ts";

import {
  decodeBase64Url,
  decodeLadybugEdgeId,
  decodeLadybugVertexId,
  decodeVersionedLadybugId,
  hashLadybugIdPayload,
  queryLadybugResultSets,
} from "./index.ts";

type FakeResult = LadybugQueryResult & {
  readonly closeCalls: () => number;
};

function resultSet(
  options: Omit<LadybugQueryResult, "close">,
  onClose?: () => void,
): FakeResult {
  let closeCount = 0;
  return {
    ...options,
    close: () => {
      closeCount += 1;
      onClose?.();
    },
    closeCalls: () => closeCount,
  };
}

function runtimeFor(
  result: LadybugQueryResult | readonly LadybugQueryResult[],
): LadybugRuntime {
  return {
    query: () => result,
    close: () => undefined,
  };
}

function idComponents(id: string): readonly [string, string, string] {
  const components = id.split(".");
  expect(components).toHaveLength(3);
  return components as [string, string, string];
}

describe("queryLadybugResultSets", () => {
  it("reads chained result sets before closing their parents", async () => {
    let parentClosed = false;
    const second = resultSet({
      getAllRows: () => {
        if (parentClosed) {
          return Promise.reject(new Error("parent closed before child read"));
        }
        return Promise.resolve([["second"]]);
      },
      columnNames: ["name"],
    });
    const first = resultSet(
      {
        rows: [["first"]],
        columnNames: ["name"],
        nextQueryResult: second,
      },
      () => {
        parentClosed = true;
      },
    );

    const response = await queryLadybugResultSets(
      runtimeFor(first),
      "MATCH n RETURN n",
    );

    expect(response.results).toEqual([{ name: "first" }, { name: "second" }]);
    expect(first.closeCalls()).toBe(1);
    expect(second.closeCalls()).toBe(1);
  });

  it("closes opened chained result sets on read failure", async () => {
    const second = resultSet({
      getAllRows: () => Promise.reject(new Error("read failed")),
      columnNames: ["value"],
    });
    const first = resultSet({
      rows: [["first"]],
      columnNames: ["value"],
      nextQueryResult: second,
    });

    await expect(
      queryLadybugResultSets(runtimeFor(first), "RETURN 1"),
    ).rejects.toThrow("read failed");
    expect(first.closeCalls()).toBe(1);
    expect(second.closeCalls()).toBe(1);
  });

  it("waits for started result reads to settle before closing after read failure", async () => {
    let settleSlowRead!: () => void;
    let slowReadStarted = false;
    let slowReadSettled = false;
    let closedBeforeSlowReadSettled = false;
    const slowRead = new Promise<void>(resolve => {
      settleSlowRead = () => {
        slowReadSettled = true;
        resolve();
      };
    });

    const result = resultSet(
      {
        getColumnNames: async () => {
          slowReadStarted = true;
          await slowRead;
          return ["value"];
        },
        getAllRows: () => Promise.reject(new Error("read failed")),
      },
      () => {
        closedBeforeSlowReadSettled = !slowReadSettled;
      },
    );

    const query = queryLadybugResultSets(runtimeFor(result), "RETURN 1");
    await Promise.resolve();
    expect(slowReadStarted).toBe(true);

    settleSlowRead();

    await expect(query).rejects.toThrow("read failed");
    expect(result.closeCalls()).toBe(1);
    expect(closedBeforeSlowReadSettled).toBe(false);
  });

  it("closes opened chained result sets on conversion failure", async () => {
    const second = resultSet({ rows: [["second"]], columnNames: ["value"] });
    const first = resultSet({
      rows: [[{ _label: "Person" }]],
      columnNames: ["person"],
      nextQueryResult: second,
    });

    await expect(
      queryLadybugResultSets(runtimeFor(first), "MATCH (p) RETURN p", {
        primaryKeys: { Person: "id" },
      }),
    ).rejects.toThrow("missing primary-key value id");
    expect(first.closeCalls()).toBe(1);
    expect(second.closeCalls()).toBe(1);
  });

  it("decodes rows by column names", async () => {
    const response = await queryLadybugResultSets(
      runtimeFor(
        resultSet({ rows: [[1, "two"]], columnNames: ["one", "two"] }),
      ),
      "RETURN 1, 'two'",
    );

    expect(response.results).toEqual([{ one: 1, two: "two" }]);
  });

  it("preserves blank column-name positions while decoding rows", async () => {
    const response = await queryLadybugResultSets(
      runtimeFor(
        resultSet({ rows: [["first", "second"]], columnNames: ["", "two"] }),
      ),
      "RETURN 'first', 'second'",
    );

    expect(response.results).toEqual([{ value0: "first", two: "second" }]);
  });

  it("keeps plain records working without primary-key metadata", async () => {
    const response = await queryLadybugResultSets(
      runtimeFor(resultSet({ rows: [{ name: "plain", count: { value: 2 } }] })),
      "RETURN record",
    );

    expect(response.results).toEqual([{ name: "plain", count: 2 }]);
  });

  it("decodes objects only when rows are absent", async () => {
    const response = await queryLadybugResultSets(
      runtimeFor(resultSet({ objects: ["object"], columnNames: ["value"] })),
      "RETURN 'object'",
    );

    expect(response.results).toEqual([{ value: "object" }]);
  });

  it("prefers rows when both rows and objects are present", async () => {
    const response = await queryLadybugResultSets(
      runtimeFor(
        resultSet({
          rows: [["row"]],
          objects: ["object"],
          columnNames: ["value"],
        }),
      ),
      "RETURN 'row'",
    );

    expect(response.results).toEqual([{ value: "row" }]);
  });

  it("does not fall back to objects when rows are explicitly empty", async () => {
    const response = await queryLadybugResultSets(
      runtimeFor(
        resultSet({ rows: [], objects: ["object"], columnNames: ["value"] }),
      ),
      "RETURN empty rows",
    );

    expect(response.results).toEqual([]);
  });

  it("does not fall back to objects when a row getter returns empty rows", async () => {
    const response = await queryLadybugResultSets(
      runtimeFor(
        resultSet({
          getAllRows: () => [],
          objects: ["object"],
          columnNames: ["value"],
        }),
      ),
      "RETURN empty rows",
    );

    expect(response.results).toEqual([]);
  });

  it("normalizes unsafe integers, bigints, and boxed scalars", async () => {
    const unsafeInteger = 9_007_199_254_740_992;
    const response = await queryLadybugResultSets(
      runtimeFor(
        resultSet({
          rows: [
            [
              unsafeInteger,
              12n,
              new Number(7),
              new String("boxed"),
              new Boolean(false),
              { "@type": "g:Int64", "@value": "9007199254740993" },
            ],
          ],
          columnNames: [
            "unsafe",
            "bigint",
            "boxedNumber",
            "boxedString",
            "boxedBoolean",
            "wrapped",
          ],
        }),
      ),
      "RETURN scalars",
    );

    expect(response.results).toEqual([
      {
        unsafe: unsafeInteger.toString(),
        bigint: "12",
        boxedNumber: 7,
        boxedString: "boxed",
        boxedBoolean: false,
        wrapped: "9007199254740993",
      },
    ]);
  });

  it("encodes branch-compatible vertex IDs with hash, version, and payload", async () => {
    const response = await queryLadybugResultSets(
      runtimeFor(
        resultSet({
          rows: [
            [
              {
                _label: "Airport",
                code: "ANC",
                _id: "private",
                city: "Anchorage",
              },
            ],
          ],
          columnNames: ["airport"],
        }),
      ),
      "MATCH (a) RETURN a",
      { primaryKeys: { Airport: "code" } },
    );

    const node = response.results[0].airport as NeptuneNode;
    const [hash, encodedVersion, encodedPayload] = idComponents(node["~id"]);

    expect(hash).toBe(hashLadybugIdPayload(encodedPayload));
    expect(decodeBase64Url(encodedVersion)).toBe("1");
    expect(decodeBase64Url(encodedPayload)).toBe(
      JSON.stringify(["Airport", "ANC"]),
    );
    expect(decodeVersionedLadybugId(node["~id"])).toEqual({
      version: "1",
      payload: JSON.stringify(["Airport", "ANC"]),
    });
    expect(decodeLadybugVertexId(node["~id"])).toEqual({
      label: "Airport",
      value: "ANC",
    });
  });

  it("encodes edge IDs from type and endpoint IDs and decodes endpoint IDs", async () => {
    const response = await queryLadybugResultSets(
      runtimeFor(
        resultSet({
          rows: [
            [
              {
                _label: "route",
                _id: "edge-private-id",
                _src: { _label: "Airport", code: "ANC" },
                _dst: { _label: "Airport", code: "SEA" },
                distance: 1448,
              },
            ],
          ],
          columnNames: ["route"],
        }),
      ),
      "MATCH ()-[r]->() RETURN r",
      { primaryKeys: { Airport: "code" } },
    );

    const relationship = response.results[0].route as NeptuneRelationship;
    const [hash, encodedVersion, encodedPayload] = idComponents(
      relationship["~id"],
    );
    const payload = decodeBase64Url(encodedPayload);

    expect(hash).toBe(hashLadybugIdPayload(encodedPayload));
    expect(decodeBase64Url(encodedVersion)).toBe("1");
    expect(payload).toBe(
      JSON.stringify(["route", relationship["~start"], relationship["~end"]]),
    );
    expect(decodeLadybugEdgeId(relationship["~id"])).toEqual({
      type: "route",
      sourceId: relationship["~start"],
      targetId: relationship["~end"],
      source: { label: "Airport", value: "ANC" },
      target: { label: "Airport", value: "SEA" },
    });
  });

  it("resolves relationship endpoints from sibling nodes in the same row", async () => {
    const response = await queryLadybugResultSets(
      runtimeFor(
        resultSet({
          rows: [
            [
              {
                _label: "Airport",
                _id: { table: "Airport", offset: 1 },
                code: "ANC",
              },
              {
                _label: "route",
                _id: "edge-private-id",
                _src: { table: "Airport", offset: 1 },
                _dst: { offset: 2, table: "Airport" },
                distance: 1448,
              },
              {
                _label: "Airport",
                _id: { table: "Airport", offset: 2 },
                code: "SEA",
              },
            ],
          ],
          columnNames: ["source", "edge", "target"],
        }),
      ),
      "MATCH (source)-[edge]->(target) RETURN source, edge, target",
      { primaryKeys: { Airport: "code" } },
    );

    const relationship = response.results[0].edge as NeptuneRelationship;
    expect(decodeLadybugVertexId(relationship["~start"])).toEqual({
      label: "Airport",
      value: "ANC",
    });
    expect(decodeLadybugVertexId(relationship["~end"])).toEqual({
      label: "Airport",
      value: "SEA",
    });
  });

  it("strips private node fields and uses primary-key metadata", async () => {
    const response = await queryLadybugResultSets(
      runtimeFor(
        resultSet({
          rows: [
            [
              {
                _label: "Person",
                _id: 10,
                id: 42,
                name: "Ada",
                _secret: "hidden",
              },
            ],
          ],
          columnNames: ["person"],
        }),
      ),
      "MATCH (p) RETURN p",
      { primaryKeys: { Person: "id" } },
    );

    const node = response.results[0].person as NeptuneNode;
    expect(decodeLadybugVertexId(node["~id"])).toEqual({
      label: "Person",
      value: "42",
    });
    expect(node["~labels"]).toEqual(["Person"]);
    expect(node["~properties"]).toEqual({ id: 42, name: "Ada" });
  });

  it("stringifies record values inside node and relationship property arrays", async () => {
    const response = await queryLadybugResultSets(
      runtimeFor(
        resultSet({
          rows: [
            [
              {
                _label: "Person",
                id: 1,
                aliases: [
                  { last: "Lovelace", first: "Ada" },
                  ["scalar", { nested: true }],
                ],
              },
              {
                _label: "knows",
                _id: "r1",
                _src: { _label: "Person", id: 1 },
                _dst: { _label: "Person", id: 2 },
                metadata: [{ since: 1843 }, ["trusted", { rank: 1 }]],
              },
            ],
          ],
          columnNames: ["person", "relationship"],
        }),
      ),
      "MATCH (p)-[r]->(q) RETURN p, r",
      { primaryKeys: { Person: "id" } },
    );

    const node = response.results[0].person as NeptuneNode;
    const relationship = response.results[0]
      .relationship as NeptuneRelationship;
    expect(node["~properties"].aliases).toEqual([
      '{"first":"Ada","last":"Lovelace"}',
      ["scalar", '{"nested":true}'],
    ]);
    expect(relationship["~properties"].metadata).toEqual([
      '{"since":1843}',
      ["trusted", '{"rank":1}'],
    ]);
  });

  it("resolves relationship endpoints and encodes start, end, and relationship ID", async () => {
    const cachedEndpoint = { _label: "Airport", code: "ANC" };
    const resolvedEndpoint = { _label: "Airport", code: "SEA" };
    const resolved: LadybugValue[] = [];
    const response = await queryLadybugResultSets(
      runtimeFor(
        resultSet({
          rows: [
            [
              {
                _label: "route",
                _id: "r1",
                _src: "cached-source",
                _dst: "resolved-target",
                distance: 1448,
              },
            ],
          ],
          columnNames: ["route"],
        }),
      ),
      "MATCH ()-[r]->() RETURN r",
      {
        primaryKeys: { Airport: "code" },
        endpointCache: {
          get: (reference: LadybugValue) =>
            reference === "cached-source" ? cachedEndpoint : undefined,
        },
        endpointResolver: (
          reference: LadybugValue,
          context: LadybugEndpointResolverContext,
        ) => {
          expect(context.endpoint).toBe("_dst");
          resolved.push(reference);
          return reference === "resolved-target" ? resolvedEndpoint : undefined;
        },
      },
    );

    const relationship = response.results[0].route as NeptuneRelationship;
    expect(resolved).toEqual(["resolved-target"]);
    expect(decodeLadybugVertexId(relationship["~start"])).toEqual({
      label: "Airport",
      value: "ANC",
    });
    expect(decodeLadybugVertexId(relationship["~end"])).toEqual({
      label: "Airport",
      value: "SEA",
    });
    expect(decodeLadybugEdgeId(relationship["~id"])).toMatchObject({
      type: "route",
      sourceId: relationship["~start"],
      targetId: relationship["~end"],
    });
  });

  it("converts nested arrays and records recursively", async () => {
    const response = await queryLadybugResultSets(
      runtimeFor(
        resultSet({
          rows: [
            [
              [
                {
                  inner: {
                    _label: "City",
                    id: 1,
                    name: "Anchorage",
                    _hidden: "private",
                  },
                  _hidden: "private",
                },
              ],
            ],
          ],
          columnNames: ["items"],
        }),
      ),
      "RETURN nested",
      { primaryKeys: { City: "id" } },
    );

    const items = response.results[0].items as readonly {
      readonly inner: NeptuneNode;
    }[];
    expect(items).toHaveLength(1);
    expect(Object.hasOwn(items[0], "_hidden")).toBe(false);
    expect(items[0].inner["~entityType"]).toBe("node");
    expect(items[0].inner["~properties"]).toEqual({ id: 1, name: "Anchorage" });
  });

  it("returns mixed scalar and entity result rows as Neptune-compatible values", async () => {
    const response = await queryLadybugResultSets(
      runtimeFor(
        resultSet({
          rows: [
            [
              "Ada",
              { _label: "Person", id: 1, name: "Ada" },
              [{ _label: "Person", id: 2, name: "Grace" }],
            ],
          ],
          columnNames: ["name", "person", "others"],
        }),
      ),
      "MATCH (p) RETURN values",
      { primaryKeys: { Person: "id" } },
    );

    expect(response.results[0].name).toBe("Ada");
    expect((response.results[0].person as NeptuneNode)["~entityType"]).toBe(
      "node",
    );
    expect(
      (response.results[0].others as readonly NeptuneNode[])[0]["~labels"],
    ).toEqual(["Person"]);
  });
});
