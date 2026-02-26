export type HealthStatus = "healthy" | "degraded" | "unhealthy" | "unknown";

export interface EndpointHealth {
  subject: string;
  value: unknown;
  healthStatus: HealthStatus;
}

export interface MonitorResult {
  endpoints: EndpointHealth[];
  totalAnnotated: number;
}
