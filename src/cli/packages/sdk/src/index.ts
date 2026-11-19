export type OrderStatus = "pending" | "paid" | "failed" | "expired" | "amount_mismatch";
export type VerificationMode = "sandbox" | "manual" | "psp";

export interface CreatedOrder {
  orderRef: string; amountInr: number; expiresAt: string;
  upiIntent: string; qrDataUrl: string; verification: VerificationMode;
}
export type StatusResponse =
  | { status: Exclude<OrderStatus, "paid"> }
  | { status: "paid"; paidAt: string; txnRef: string; amountInr: number; licenseToken: string };

export class GatewayError extends Error {
  constructor(public code: string, public http: number) { super(code); }
}

export class UpiGatewayClient {
  private csrf?: string;
  constructor(private baseUrl: string) {}

  private async req<T>(path: string, init: RequestInit & { idem?: string } = {}): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.csrf) headers["x-csrf-token"] = this.csrf;
    if (init.idem) headers["idempotency-key"] = init.idem;
    const res = await fetch(this.baseUrl + path, { ...init, headers, credentials: "include" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new GatewayError(body?.error ?? "request_failed", res.status);
    return body as T;
  }

  async init() {
    const r = await this.req<{ csrfToken: string }>("/v1/session", { method: "POST" });
    this.csrf = r.csrfToken;
  }
  async createOrder(idem: string = crypto.randomUUID()) {
    if (!this.csrf) await this.init();
    return this.req<CreatedOrder>("/v1/orders", { method: "POST", idem, body: "{}" });
  }
  getStatus(ref: string) {
    return this.req<StatusResponse>(`/v1/orders/${encodeURIComponent(ref)}/status`);
  }
  validateLicense(token: string) {
    return this.req<{ valid: boolean }>("/v1/licenses/validate", {
      method: "POST", body: JSON.stringify({ token }),
    });
  }
}
