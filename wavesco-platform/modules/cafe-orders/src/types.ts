export interface WebhookContext {
  request: Request;
  tenantId: string;
}

export type WebhookHandler = (ctx: WebhookContext) => Promise<Response>;

export type WebhookRegistry = Record<string, WebhookHandler>;
