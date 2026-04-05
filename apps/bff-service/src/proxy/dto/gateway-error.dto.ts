export class GatewayErrorDto {
  code!: "BAD_GATEWAY" | "GATEWAY_TIMEOUT";
  message!: string;
  details?: {
    upstream: "auth" | "task";
    requestId?: string;
  };
}
