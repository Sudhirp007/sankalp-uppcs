/**
 * Cloudflare Workers Web-Crypto compatible Razorpay Orders & HMAC-SHA256 Verifier.
 * Uses live/test Razorpay REST API when RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET are configured,
 * and cleanly supports deterministic Sandbox checkout verification before live keys are added.
 */

const SANDBOX_FALLBACK_SECRET = "sankalp_local_sandbox_hmac_secret_v1";

export async function computeHmacSha256Hex(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export interface CreateRazorpayOrderResult {
  razorpayOrderId: string;
  amountPaise: number;
  currency: string;
  keyId: string;
  isSandbox: boolean;
  sandboxSignaturePreview?: string;
}

export async function createRazorpayOrder(params: {
  amountPaise: number;
  currency: string;
  receipt: string;
  notes: Record<string, string>;
  keyId?: string;
  keySecret?: string;
}): Promise<CreateRazorpayOrderResult> {
  const keyId = (params.keyId || "").trim();
  const keySecret = (params.keySecret || "").trim();

  if (keyId && keySecret) {
    const basicAuth = btoa(`${keyId}:${keySecret}`);
    const resp = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: params.amountPaise,
        currency: params.currency,
        receipt: params.receipt,
        notes: params.notes,
      }),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      throw new Error(`Razorpay Order API error (${resp.status}): ${errBody}`);
    }

    const orderJson = (await resp.json()) as { id: string; amount: number; currency: string };
    return {
      razorpayOrderId: orderJson.id,
      amountPaise: orderJson.amount,
      currency: orderJson.currency,
      keyId,
      isSandbox: false,
    };
  }

  // Sandbox mode when live/test Razorpay keys haven't been added yet
  const fakeOrderId = `order_sbx_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;
  return {
    razorpayOrderId: fakeOrderId,
    amountPaise: params.amountPaise,
    currency: params.currency,
    keyId: "rzp_sandbox_preview",
    isSandbox: true,
  };
}

export async function verifyRazorpayPaymentSignature(params: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
  keySecret?: string;
  isSandbox: boolean;
}): Promise<boolean> {
  const secret =
    !params.isSandbox && params.keySecret && params.keySecret.trim().length > 0
      ? params.keySecret.trim()
      : SANDBOX_FALLBACK_SECRET;

  const expected = await computeHmacSha256Hex(
    `${params.razorpayOrderId}|${params.razorpayPaymentId}`,
    secret
  );
  return timingSafeEqualHex(expected, params.razorpaySignature.trim().toLowerCase());
}

export async function createSandboxPaymentProof(orderId: string): Promise<{
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}> {
  const razorpayPaymentId = `pay_sbx_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;
  const razorpaySignature = await computeHmacSha256Hex(
    `${orderId}|${razorpayPaymentId}`,
    SANDBOX_FALLBACK_SECRET
  );
  return { razorpayOrderId: orderId, razorpayPaymentId, razorpaySignature };
}
