import { useAtomCallback } from "jotai/utils";
import { DatabaseIcon } from "lucide-react";
import { useCallback } from "react";

import { ListRowContent, ListRowSubtitle, ListRowTitle } from "@/components";
import {
  activeConfigurationAtom,
  type ConfigurationId,
  type RawConfiguration,
} from "@/core";
import useResetState from "@/core/StateProvider/useResetState";
import { useTranslations } from "@/hooks";
import { logger } from "@/utils";

type LadybugLocalConnection = NonNullable<RawConfiguration["connection"]> & {
  backend?: string;
  ladybug?: {
    fileName?: unknown;
  };
};

function ConnectionRow({
  connection,
  isSelected,
  isDisabled,
}: {
  connection: RawConfiguration;
  isSelected: boolean;
  isDisabled: boolean;
}) {
  const t = useTranslations();
  const setActiveConfig = useSetActiveConfigCallback(connection.id);

  const subtitleDetails = getConnectionSubtitleDetails(connection);

  const graphType = t(
    "query-language",
    connection.connection?.queryEngine || "gremlin",
  );

  return (
    <div
      onClick={setActiveConfig}
      className="@container flex flex-row items-center gap-4 px-6 py-4 hover:cursor-pointer"
    >
      <DatabaseIcon className="text-primary-main hidden size-8 shrink-0 @md:block" />
      <ListRowContent>
        <ListRowTitle className="inline-flex items-center gap-1">
          {connection.displayLabel || connection.id}
        </ListRowTitle>
        <ListRowSubtitle>
          <span className="">{graphType}</span>
          {subtitleDetails.map((detail, index) => (
            <span key={`${index}:${detail}`}> &bull; {detail}</span>
          ))}
        </ListRowSubtitle>
      </ListRowContent>
      <input
        type="radio"
        checked={isSelected}
        onChange={setActiveConfig}
        disabled={isDisabled}
        className="hidden"
      />
    </div>
  );
}

function getConnectionSubtitleDetails(connection: RawConfiguration): string[] {
  const connectionConfig = connection.connection;
  if (!connectionConfig) {
    return [];
  }

  const ladybug = connectionConfig as LadybugLocalConnection;
  if (ladybug.backend === "ladybug-wasm-local-file") {
    const details = ["Ladybug local file"];
    if (typeof ladybug.ladybug?.fileName === "string") {
      details.push(ladybug.ladybug.fileName);
    }
    return details;
  }

  const dbUrl = connectionConfig.proxyConnection
    ? connectionConfig.graphDbUrl
    : connectionConfig.url;
  return dbUrl ? [dbUrl] : [];
}

function useSetActiveConfigCallback(configId: ConfigurationId) {
  const resetState = useResetState();
  return useAtomCallback(
    useCallback(
      (_get, set) => {
        logger.debug("Setting active connection to", configId);
        set(activeConfigurationAtom, configId);
        resetState();
      },
      [configId, resetState],
    ),
  );
}

export { ConnectionRow };
