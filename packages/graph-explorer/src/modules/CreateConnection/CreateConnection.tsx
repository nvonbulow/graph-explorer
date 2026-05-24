import type {
  ConnectionConfig,
  NeptuneServiceType,
  QueryEngine,
} from "@shared/types";

import { useQueryClient } from "@tanstack/react-query";
import { useAtomCallback } from "jotai/utils";
import { useCallback, useState } from "react";

import {
  Button,
  Checkbox,
  FormItem,
  InfoTooltip,
  InputField,
  Label,
  SelectField,
  TextAreaField,
} from "@/components";
import {
  activeConfigurationAtom,
  allGraphSessionsAtom,
  configurationAtom,
  type ConfigurationContextProps,
  createNewConfigurationId,
  type RawConfiguration,
  schemaAtom,
} from "@/core";
import useResetState from "@/core/StateProvider/useResetState";
import { formatDate, logger } from "@/utils";
import {
  DEFAULT_FETCH_TIMEOUT,
  DEFAULT_NODE_EXPAND_LIMIT,
} from "@/utils/constants";

type LadybugConnectionBackend =
  | "remote"
  | "ladybug-wasm-local-file"
  | "ladybug-remote";

type LadybugConnectionMetadata = {
  runtimeId?: string;
  fileName?: string;
  fileSize?: number;
  lastModified?: number;
  databaseName?: string;
};

type ConnectionForm = {
  name?: string;
  backend?: LadybugConnectionBackend;
  url?: string;
  queryEngine?: QueryEngine;
  proxyConnection?: boolean;
  graphDbUrl?: string;
  awsAuthEnabled?: boolean;
  serviceType?: NeptuneServiceType;
  awsRegion?: string;
  fetchTimeoutEnabled: boolean;
  fetchTimeoutMs?: number;
  nodeExpansionLimitEnabled: boolean;
  nodeExpansionLimit?: number;
  ladybug?: LadybugConnectionMetadata;
};

const CONNECTIONS_OP: {
  label: string;
  value: QueryEngine;
}[] = [
  { label: "Gremlin - PG (Property Graph)", value: "gremlin" },
  { label: "OpenCypher - PG (Property Graph)", value: "openCypher" },
  { label: "SPARQL - RDF (Resource Description Framework)", value: "sparql" },
];

const CONNECTION_BACKENDS_OP: {
  label: string;
  value: LadybugConnectionBackend;
}[] = [
  { label: "Remote graph database", value: "remote" },
  { label: "Ladybug remote proxy database", value: "ladybug-remote" },
  { label: "Ladybug local file", value: "ladybug-wasm-local-file" },
];

function normalizeLadybugDatabaseName(databaseName: string | undefined) {
  return databaseName?.trim().replace(/^\/+|\/+$/g, "") ?? "";
}

function getLadybugProxyUrl(databaseName: string) {
  return `/ladybug/${encodeURIComponent(databaseName)}`;
}

export type CreateConnectionProps = {
  existingConfig?: ConfigurationContextProps;
  onClose(): void;
};

type ExtendedConnectionConfig = ConnectionConfig & {
  backend?: LadybugConnectionBackend;
  ladybug?: LadybugConnectionMetadata;
};

function mapToConnection(data: Required<ConnectionForm>): ConnectionConfig {
  const isLadybugRemote = data.backend === "ladybug-remote";
  const ladybugDatabaseName = normalizeLadybugDatabaseName(
    data.ladybug?.databaseName,
  );
  const connection: ExtendedConnectionConfig = {
    url: isLadybugRemote ? getLadybugProxyUrl(ladybugDatabaseName) : data.url,
    queryEngine: isLadybugRemote ? "openCypher" : data.queryEngine,
    proxyConnection: isLadybugRemote ? false : data.proxyConnection,
    graphDbUrl: isLadybugRemote ? undefined : data.graphDbUrl,
    awsAuthEnabled: isLadybugRemote ? false : data.awsAuthEnabled,
    serviceType: isLadybugRemote ? undefined : data.serviceType,
    awsRegion: isLadybugRemote ? undefined : data.awsRegion,
    fetchTimeoutMs: data.fetchTimeoutEnabled ? data.fetchTimeoutMs : undefined,
    nodeExpansionLimit: data.nodeExpansionLimitEnabled
      ? data.nodeExpansionLimit
      : undefined,
    backend: data.backend,
    ladybug: isLadybugRemote
      ? { databaseName: ladybugDatabaseName }
      : data.ladybug,
  };

  return connection;
}

type ComparableConnection = {
  backend?: LadybugConnectionBackend;
  databaseName?: string;
  graphDbUrl?: string;
  queryEngine?: QueryEngine;
  url?: string;
};

function mapToComparableConnection(
  data: ConnectionForm | undefined,
): ComparableConnection | undefined {
  if (!data) {
    return undefined;
  }

  const connection = mapToConnection(
    data as Required<ConnectionForm>,
  ) as ExtendedConnectionConfig;

  return {
    backend: connection.backend,
    databaseName: connection.ladybug?.databaseName,
    graphDbUrl: connection.graphDbUrl,
    queryEngine: connection.queryEngine,
    url: connection.url,
  };
}

function hasMeaningfulConnectionChange(
  original: ConnectionForm | undefined,
  updated: Required<ConnectionForm>,
) {
  const originalConnection = mapToComparableConnection(original);
  const updatedConnection = mapToComparableConnection(updated);

  return (
    originalConnection?.url !== updatedConnection?.url ||
    originalConnection?.graphDbUrl !== updatedConnection?.graphDbUrl ||
    originalConnection?.queryEngine !== updatedConnection?.queryEngine ||
    originalConnection?.backend !== updatedConnection?.backend ||
    originalConnection?.databaseName !== updatedConnection?.databaseName
  );
}

function mapToConnectionForm(
  existingConfig: ConfigurationContextProps | undefined,
) {
  if (!existingConfig) {
    return;
  }

  const connection = (existingConfig.connection ??
    {}) as ExtendedConnectionConfig;
  const result: ConnectionForm = {
    ...connection,
    backend: connection.backend ?? "remote",
    ladybug: connection.ladybug,
    name: existingConfig.displayLabel ?? existingConfig.id,
    fetchTimeoutEnabled: Boolean(connection.fetchTimeoutMs),
    nodeExpansionLimitEnabled: Boolean(connection.nodeExpansionLimit),
  };
  return result;
}

const CreateConnection = ({
  existingConfig,
  onClose,
}: CreateConnectionProps) => {
  const queryClient = useQueryClient();

  const configId = existingConfig?.id;
  const initialData = mapToConnectionForm(existingConfig);

  const onSave = useAtomCallback(
    useCallback(
      (_get, set, data: Required<ConnectionForm>) => {
        if (!configId) {
          const newConfigId = createNewConfigurationId();
          const newConfig: RawConfiguration = {
            id: newConfigId,
            displayLabel: data.name,
            connection: mapToConnection(data),
          };
          logger.log("Saving new connection", { newConfigId, newConfig });
          set(configurationAtom, prevConfigMap => {
            const updatedConfig = new Map(prevConfigMap);
            updatedConfig.set(newConfigId, newConfig);
            return updatedConfig;
          });
          set(activeConfigurationAtom, newConfigId);
          return;
        }

        set(configurationAtom, prev => {
          const updated = new Map(prev);
          const currentConfig = updated.get(configId);
          const updatedConfig: RawConfiguration = {
            ...currentConfig,
            id: configId,
            displayLabel: data.name,
            connection: mapToConnection(data),
          };
          logger.log("Updating existing connection", {
            configId,
            currentConfig,
            updatedConfig,
          });
          updated.set(configId, updatedConfig);
          return updated;
        });

        const meaningfulConnectionChange = hasMeaningfulConnectionChange(
          initialData,
          data,
        );

        if (meaningfulConnectionChange) {
          logger.log(
            "Clearing cached schema and previous graph session because connection to database meaningfully changed",
            { original: initialData, updated: data },
          );

          // Force a sync of the schema by deleting the existing schema cache, which is now invalid
          set(schemaAtom, prevSchemaMap => {
            const updatedSchema = new Map(prevSchemaMap);
            updatedSchema.delete(configId);
            return updatedSchema;
          });

          // Delete previous session data
          set(allGraphSessionsAtom, prev => {
            const updatedGraphs = new Map(prev);
            logger.log("Deleting previous graph session");
            updatedGraphs.delete(configId);
            return updatedGraphs;
          });

          // Reseting all query state. Using `removeQueries()` to ensure initial data is recalculated.
          // This ensures dependent queries execute in the right order
          queryClient.removeQueries();
        }
      },
      [configId, initialData, queryClient],
    ),
  );

  const initialBackend = initialData?.backend ?? "remote";
  const [form, setForm] = useState<ConnectionForm>({
    backend: initialBackend,
    queryEngine:
      initialBackend === "ladybug-remote"
        ? "openCypher"
        : initialData?.queryEngine || "gremlin",
    name:
      initialData?.name ||
      `Connection (${formatDate(new Date(), "yyyy-MM-dd HH:mm")})`,
    url: initialData?.url || "",
    proxyConnection: initialData?.proxyConnection || false,
    graphDbUrl: initialData?.graphDbUrl || "",
    awsAuthEnabled: initialData?.awsAuthEnabled || false,
    serviceType: initialData?.serviceType || "neptune-db",
    awsRegion: initialData?.awsRegion || "",
    fetchTimeoutEnabled: initialData?.fetchTimeoutEnabled || false,
    fetchTimeoutMs: initialData?.fetchTimeoutMs,
    nodeExpansionLimitEnabled: initialData?.nodeExpansionLimitEnabled || false,
    nodeExpansionLimit: initialData?.nodeExpansionLimit,
    ladybug: initialData?.ladybug,
  });

  const isLadybugRemote = form.backend === "ladybug-remote";
  const isLadybugLocal = form.backend === "ladybug-wasm-local-file";
  const ladybugDatabaseName = normalizeLadybugDatabaseName(
    form.ladybug?.databaseName,
  );
  const ladybugProxyUrl = ladybugDatabaseName
    ? getLadybugProxyUrl(ladybugDatabaseName)
    : "/ladybug/<databaseName>";
  const backendOptions =
    initialData?.backend === "ladybug-wasm-local-file"
      ? CONNECTION_BACKENDS_OP
      : CONNECTION_BACKENDS_OP.filter(
          option => option.value !== "ladybug-wasm-local-file",
        );

  const [hasError, setError] = useState(false);
  const onFormChange =
    (attribute: keyof ConnectionForm) =>
    (value: number | string | string[] | boolean) => {
      if (attribute === "backend" && value === "ladybug-remote") {
        setForm(prev => ({
          ...prev,
          backend: "ladybug-remote",
          queryEngine: "openCypher",
          proxyConnection: false,
          graphDbUrl: "",
          awsAuthEnabled: false,
          serviceType: "neptune-db",
          awsRegion: "",
        }));
      } else if (attribute === "backend" && value === "remote") {
        setForm(prev => {
          const previousUrl = prev.url;
          return {
            ...prev,
            backend: "remote",
            url:
              previousUrl?.startsWith("/ladybug/") &&
              previousUrl === ladybugProxyUrl
                ? ""
                : previousUrl,
          };
        });
      } else if (attribute === "serviceType" && value === "neptune-graph") {
        setForm(prev => ({
          ...prev,
          [attribute]: value,
          ["queryEngine"]: "openCypher",
        }));
      } else if (
        attribute === "fetchTimeoutEnabled" &&
        typeof value === "boolean"
      ) {
        setForm(prev => ({
          ...prev,
          [attribute]: value,
          ["fetchTimeoutMs"]: value ? DEFAULT_FETCH_TIMEOUT : undefined,
        }));
      } else if (
        attribute === "nodeExpansionLimitEnabled" &&
        typeof value === "boolean"
      ) {
        setForm(prev => ({
          ...prev,
          [attribute]: value,
          ["nodeExpansionLimit"]: value ? DEFAULT_NODE_EXPAND_LIMIT : undefined,
        }));
      } else {
        setForm(prev => ({
          ...prev,
          [attribute]: value,
        }));
      }
    };

  const onLadybugDatabaseNameChange = (value: string) => {
    setForm(prev => ({
      ...prev,
      ladybug: {
        ...prev.ladybug,
        databaseName: value,
      },
    }));
  };

  const reset = useResetState();
  const onSubmit = () => {
    if (!form.name || !form.queryEngine) {
      setError(true);
      return;
    }

    if (isLadybugRemote && !ladybugDatabaseName) {
      setError(true);
      return;
    }

    if (!isLadybugRemote && !isLadybugLocal && !form.url) {
      setError(true);
      return;
    }

    if (
      !isLadybugRemote &&
      !isLadybugLocal &&
      form.proxyConnection &&
      !form.graphDbUrl
    ) {
      setError(true);
      return;
    }

    if (
      !isLadybugRemote &&
      !isLadybugLocal &&
      form.awsAuthEnabled &&
      (!form.awsRegion || !form.serviceType)
    ) {
      setError(true);
      return;
    }

    onSave(form as Required<ConnectionForm>);
    reset();
    onClose();
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-6">
        <FormItem>
          <Label>Name</Label>
          <InputField
            aria-label="Name"
            value={form.name}
            onChange={onFormChange("name")}
            errorMessage="Name is required"
            validationState={hasError && !form.name ? "invalid" : "valid"}
          />
        </FormItem>
        <FormItem>
          <Label>Backend</Label>
          <SelectField
            options={backendOptions}
            value={form.backend}
            onValueChange={onFormChange("backend")}
            disabled={isLadybugLocal}
          />
        </FormItem>
        {isLadybugLocal ? (
          <div className="space-y-2 rounded-md border p-3 text-sm">
            <div className="font-medium">Ladybug local file</div>
            <div>File: {form.ladybug?.fileName || "Unknown file"}</div>
            <div>
              Runtime ID: {form.ladybug?.runtimeId || "Unknown runtime"}
            </div>
            <div className="text-text-secondary">
              Local Ladybug files are stored in browser OPFS. HTTP endpoint
              fields are not used for this connection.
            </div>
          </div>
        ) : isLadybugRemote ? (
          <>
            <FormItem>
              <Label>Ladybug Database Name</Label>
              <InputField
                aria-label="Ladybug Database Name"
                value={form.ladybug?.databaseName || ""}
                onChange={onLadybugDatabaseNameChange}
                errorMessage="Database name is required"
                placeholder="air-routes"
                validationState={
                  hasError && !ladybugDatabaseName ? "invalid" : "valid"
                }
              />
            </FormItem>
            <FormItem>
              <Label>Proxy Route</Label>
              <InputField
                aria-label="Proxy Route"
                value={ladybugProxyUrl}
                isReadOnly
              />
            </FormItem>
          </>
        ) : (
          <>
            <FormItem>
              <Label>Query Language</Label>
              <SelectField
                options={CONNECTIONS_OP}
                value={form.queryEngine}
                onValueChange={onFormChange("queryEngine")}
                disabled={form.serviceType === "neptune-graph"}
              />
            </FormItem>
            <FormItem>
              <Label>
                Public or Proxy Endpoint
                <InfoTooltip>
                  Provide the endpoint URL for an open graph database, e.g.,
                  Gremlin Server. If connecting to Amazon Neptune, then provide
                  a proxy endpoint URL that is accessible from outside the VPC,
                  e.g., EC2.
                </InfoTooltip>
              </Label>
              <TextAreaField
                aria-label="Public or Proxy Endpoint"
                data-autofocus={true}
                value={form.url}
                onChange={onFormChange("url")}
                errorMessage="URL is required"
                placeholder="https://example.com"
                validationState={hasError && !form.url ? "invalid" : "valid"}
              />
            </FormItem>

            <Label className="cursor-pointer">
              <Checkbox
                value="proxyConnection"
                checked={form.proxyConnection}
                onCheckedChange={checked => {
                  onFormChange("proxyConnection")(checked);
                }}
              />
              Using Proxy-Server
            </Label>
          </>
        )}
        {!isLadybugRemote && !isLadybugLocal && form.proxyConnection && (
          <FormItem>
            <Label>Graph Connection URL</Label>
            <TextAreaField
              aria-label="Graph Connection URL"
              data-autofocus={true}
              value={form.graphDbUrl}
              onChange={onFormChange("graphDbUrl")}
              errorMessage="URL is required"
              placeholder="https://neptune-cluster.amazonaws.com"
              validationState={
                hasError && !form.graphDbUrl ? "invalid" : "valid"
              }
            />
          </FormItem>
        )}
        {!isLadybugRemote && !isLadybugLocal && form.proxyConnection && (
          <Label className="cursor-pointer">
            <Checkbox
              value="awsAuthEnabled"
              checked={form.awsAuthEnabled}
              onCheckedChange={checked => {
                onFormChange("awsAuthEnabled")(checked);
              }}
            />
            AWS IAM Auth Enabled
          </Label>
        )}
        {!isLadybugRemote &&
          !isLadybugLocal &&
          form.proxyConnection &&
          form.awsAuthEnabled && (
            <>
              <FormItem>
                <Label>AWS Region</Label>
                <InputField
                  aria-label="AWS Region"
                  data-autofocus={true}
                  value={form.awsRegion}
                  onChange={onFormChange("awsRegion")}
                  errorMessage="Region is required"
                  placeholder="us-east-1"
                  validationState={
                    hasError && !form.awsRegion ? "invalid" : "valid"
                  }
                />
              </FormItem>
              <FormItem>
                <Label>Service Type</Label>
                <SelectField
                  options={[
                    { label: "Neptune DB", value: "neptune-db" },
                    { label: "Neptune Analytics", value: "neptune-graph" },
                  ]}
                  value={form.serviceType}
                  onValueChange={onFormChange("serviceType")}
                />
              </FormItem>
            </>
          )}
        <FormItem>
          <Label className="cursor-pointer">
            <Checkbox
              value="fetchTimeoutEnabled"
              checked={form.fetchTimeoutEnabled}
              onCheckedChange={checked => {
                onFormChange("fetchTimeoutEnabled")(checked);
              }}
            />
            <span className="flex items-center gap-2">
              Enable Fetch Timeout
              <InfoTooltip>
                Large datasets may require a large amount of time to fetch. If
                the timeout is exceeded, the request will be cancelled.
              </InfoTooltip>
            </span>
          </Label>
        </FormItem>
        {form.fetchTimeoutEnabled && (
          <FormItem>
            <Label>Fetch Timeout (ms)</Label>
            <InputField
              aria-label="Fetch Timeout (ms)"
              type="number"
              value={form.fetchTimeoutMs}
              onChange={onFormChange("fetchTimeoutMs")}
              min={0}
            />
          </FormItem>
        )}
        <FormItem>
          <Label className="cursor-pointer">
            <Checkbox
              value="nodeExpansionLimitEnabled"
              checked={form.nodeExpansionLimitEnabled}
              onCheckedChange={checked => {
                onFormChange("nodeExpansionLimitEnabled")(checked);
              }}
            />
            <span className="flex items-center gap-2">
              Override Default Neighbor Expansion Limit
              <InfoTooltip>
                Large datasets may require a default limit to the amount of
                neighbors that are returned during any single expansion.
              </InfoTooltip>
            </span>
          </Label>
        </FormItem>
        {form.nodeExpansionLimitEnabled && (
          <FormItem>
            <Label>Node Expansion Limit</Label>
            <InputField
              aria-label="Node Expansion Limit"
              type="number"
              value={form.nodeExpansionLimit}
              onChange={onFormChange("nodeExpansionLimit")}
              min={0}
            />
          </FormItem>
        )}
      </div>
      <div className="flex justify-between border-t pt-4">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={onSubmit}>
          {!configId ? "Add Connection" : "Update Connection"}
        </Button>
      </div>
    </div>
  );
};

export default CreateConnection;
