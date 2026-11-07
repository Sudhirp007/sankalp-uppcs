export interface ResolvedIdentity {
  userId: string;
  firebaseUid: string | null;
  email: string | null;
  phoneNumber: string | null;
  displayName: string;
  isVerifiedFirebaseToken: boolean;
}

interface GoogleJwk {
  kid: string;
  kty: string;
  alg: string;
  n: string;
  e: string;
}

let cachedJwks: { keys: GoogleJwk[]; expiresAt: number } | null = null;

function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const padded = base64Url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((base64Url.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function fetchGoogleJwks(): Promise<GoogleJwk[]> {
  if (cachedJwks && Date.now() < cachedJwks.expiresAt) {
    return cachedJwks.keys;
  }
  const resp = await fetch(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
  );
  if (!resp.ok) {
    throw new Error(`Failed to fetch Firebase JWKS: ${resp.status}`);
  }
  const data = (await resp.json()) as { keys: GoogleJwk[] };
  cachedJwks = { keys: data.keys || [], expiresAt: Date.now() + 60 * 60 * 1000 };
  return cachedJwks.keys;
}

export async function verifyFirebaseIdToken(
  token: string,
  expectedProjectId: string
): Promise<{ uid: string; email?: string; phoneNumber?: string; name?: string } | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const header = JSON.parse(new TextDecoder().decode(base64UrlToUint8Array(parts[0])));
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToUint8Array(parts[1])));

    const nowSec = Math.floor(Date.now() / 1000);
    if (!payload.sub || payload.exp < nowSec) return null;
    if (expectedProjectId && payload.aud !== expectedProjectId) return null;
    if (expectedProjectId && payload.iss !== `https://securetoken.google.com/${expectedProjectId}`) return null;

    const keys = await fetchGoogleJwks();
    const jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) return null;

    const cryptoKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const signedData = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const signature = base64UrlToUint8Array(parts[2]);
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      signature.buffer as ArrayBuffer,
      signedData
    );
    if (!valid) return null;

    return {
      uid: String(payload.sub),
      email: payload.email ? String(payload.email) : undefined,
      phoneNumber: payload.phone_number ? String(payload.phone_number) : undefined,
      name: payload.name ? String(payload.name) : undefined,
    };
  } catch {
    return null;
  }
}

export async function resolveRequestIdentity(
  req: Request,
  firebaseProjectId: string
): Promise<ResolvedIdentity> {
  const authHeader = req.headers.get("authorization") || "";
  if (authHeader.startsWith("Bearer ")) {
    const rawToken = authHeader.slice(7).trim();
    const verified = await verifyFirebaseIdToken(rawToken, firebaseProjectId);
    if (verified) {
      return {
        userId: `fb_${verified.uid}`,
        firebaseUid: verified.uid,
        email: verified.email || null,
        phoneNumber: verified.phoneNumber || null,
        displayName:
          verified.name ||
          verified.phoneNumber ||
          verified.email?.split("@")[0] ||
          "Sankalp Aspirant",
        isVerifiedFirebaseToken: true,
      };
    }
  }

  const aspirantHeader = (req.headers.get("x-aspirant-id") || "").trim();
  const safeId =
    aspirantHeader && /^[a-zA-Z0-9_-]{4,64}$/.test(aspirantHeader)
      ? aspirantHeader
      : "demo_aspirant_default";

  return {
    userId: safeId,
    firebaseUid: null,
    email: null,
    phoneNumber: null,
    displayName: "UPPSC Aspirant",
    isVerifiedFirebaseToken: false,
  };
}
