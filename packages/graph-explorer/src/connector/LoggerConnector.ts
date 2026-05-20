import { logger } from "@/utils";

import { apiUrl } from "./utils/apiUrl";

export type LogLevel = "error" | "warn" | "info" | "debug" | "trace";

export interface LoggerConnector {
  error(message: unknown): void;
  warn(message: unknown): void;
  info(message: unknown): void;
  debug(message: unknown): void;
  trace(message: unknown): void;
}

/** Sends log messages to the server via relative URL. */
export class ServerLoggerConnector implements LoggerConnector {
  private readonly _baseURI: string | undefined;
  private readonly _clientLogger: ClientLoggerConnector;

  constructor(baseURI?: string) {
    this._baseURI = baseURI;
    this._clientLogger = new ClientLoggerConnector();
  }

  public error(message: unknown) {
    this._clientLogger.error(message);
    return this._sendLog("error", message);
  }

  public warn(message: unknown) {
    this._clientLogger.warn(message);
    return this._sendLog("warn", message);
  }

  public info(message: unknown) {
    this._clientLogger.info(message);
    return this._sendLog("info", message);
  }

  public debug(message: unknown) {
    this._clientLogger.info(message);
    return this._sendLog("debug", message);
  }

  public trace(message: unknown) {
    this._clientLogger.trace(message);
    return this._sendLog("trace", message);
  }

  private _sendLog(level: LogLevel, message: unknown) {
    return fetch(apiUrl("logger", this._baseURI), {
      method: "POST",
      headers: {
        level,
        message: JSON.stringify(message),
      },
    }).catch(err => logger.error("Failed to send log to server", err));
  }
}

/** Sends logs to the browser's console. */
export class ClientLoggerConnector implements LoggerConnector {
  error(message: unknown): void {
    logger.error(message);
  }
  warn(message: unknown): void {
    logger.warn(message);
  }
  info(message: unknown): void {
    logger.log(message);
  }
  debug(message: unknown): void {
    logger.debug(message);
  }
  trace(message: unknown): void {
    logger.log(message);
  }
}
