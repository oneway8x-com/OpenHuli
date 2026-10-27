/** Adapters must settle startup promptly on abort and release timers/connections in stop. */
export interface RuntimeDependency {
  readonly name: "mqtt" | "ai";
  start(signal: AbortSignal): Promise<void>;
  isReady(): boolean;
  stop(): Promise<void>;
}

/** Probe connection hooks. These supply no Tenant authority and never dispatch application work. */
export interface RuntimeConnectionHooks {
  opened(context: { connectionId: string; signal: AbortSignal }): {
    close(): Promise<void>;
  };
}
