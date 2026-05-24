export type Awaitable<T> = T | Promise<T>;

export type LadybugScalar =
  | string
  | number
  | boolean
  | bigint
  | null
  | undefined
  | Date;

export type LadybugValue =
  | LadybugScalar
  | LadybugBoxedScalar
  | LadybugRecord
  | readonly LadybugValue[];

export type LadybugRecord = {
  readonly [key: string]: LadybugValue;
};

export type LadybugBoxedScalar = string | number | boolean;

export type LadybugColumn = {
  readonly name: string;
  readonly type?: string | undefined;
};

export type LadybugRow = LadybugValue | readonly LadybugValue[];

export type LadybugRawResultSet = {
  readonly objects?: readonly LadybugValue[] | undefined;
  readonly rows?: readonly LadybugRow[] | undefined;
  readonly columnNames?: readonly string[] | undefined;
  readonly columnTypes?: readonly string[] | undefined;
  readonly columns?: readonly (LadybugColumn | string)[] | undefined;
  readonly summary?: unknown;
};

export type LadybugResultSetIterable =
  | Iterable<LadybugRow>
  | AsyncIterable<LadybugRow>;
export type LadybugObjectIterable =
  | Iterable<LadybugValue>
  | AsyncIterable<LadybugValue>;

export type LadybugQueryResult = {
  readonly objects?:
    | readonly LadybugValue[]
    | LadybugObjectIterable
    | undefined;
  readonly rows?: readonly LadybugRow[] | LadybugResultSetIterable | undefined;
  readonly columnNames?: readonly string[] | undefined;
  readonly columnTypes?: readonly string[] | undefined;
  readonly columns?: readonly (LadybugColumn | string)[] | undefined;
  readonly summary?: unknown;
  readonly nextQueryResult?: LadybugQueryResult | null | undefined;
  isSuccess?: () => Awaitable<boolean>;
  getAllObjects?: () => Awaitable<readonly LadybugValue[]>;
  getAll?: () => Awaitable<readonly LadybugRow[]>;
  getAllRows?: () => Awaitable<readonly LadybugRow[]>;
  getColumnNames?: () => Awaitable<readonly string[]>;
  getColumnTypes?: () => Awaitable<readonly string[]>;
  getColumns?: () => Awaitable<readonly (LadybugColumn | string)[]>;
  getQuerySummary?: () => Awaitable<unknown>;
  hasNextQueryResult?: () => Awaitable<boolean>;
  getNextQueryResult?: () => Awaitable<LadybugQueryResult | null | undefined>;
  close: () => Awaitable<void>;
};

export type LadybugQueryResultChain =
  | LadybugQueryResult
  | readonly LadybugQueryResult[];

export type LadybugQueryable = {
  query(
    statement: string,
  ): Awaitable<LadybugQueryResultChain | null | undefined>;
};

export type LadybugConnection = LadybugQueryable & {
  close: () => Awaitable<void>;
};

export type LadybugRuntime = LadybugConnection;

export type NeptuneScalar = string | number | boolean | null;

export type NeptunePropertyValue =
  | NeptuneScalar
  | readonly NeptunePropertyValue[];

export type NeptuneProperties = {
  readonly [key: string]: NeptunePropertyValue;
};

export type NeptuneNode = {
  readonly "~entityType": "node";
  readonly "~id": string;
  readonly "~labels": readonly string[];
  readonly "~properties": NeptuneProperties;
};

export type NeptuneRelationship = {
  readonly "~entityType": "relationship";
  readonly "~id": string;
  readonly "~start": string;
  readonly "~end": string;
  readonly "~type": string;
  readonly "~properties": NeptuneProperties;
};

export type NeptuneRecord = {
  readonly [key: string]: NeptuneValue;
};

export type NeptuneValue =
  | NeptuneScalar
  | NeptuneNode
  | NeptuneRelationship
  | readonly NeptuneValue[]
  | NeptuneRecord;

export type NeptuneResultRow = Record<string, NeptuneValue>;

export type NeptuneOpenCypherResponse = {
  readonly results: readonly NeptuneResultRow[];
};
