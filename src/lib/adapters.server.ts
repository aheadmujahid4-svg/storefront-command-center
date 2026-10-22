/**
 * Store platform adapters — server only.
 *
 * Rule: no invented API endpoints. A platform adapter is only "connected"
 * after its real backend and API capabilities have been identified and
 * verified. Until then verification fails with an explicit message.
 */

export interface StoreRecord {
  id: string;
  name: string;
  url: string;
  platform: string;
  status: string;
}

export interface StoreCredentials {
  api_token: string | null;
  api_secret: string | null;
}

export interface VerifyResult {
  ok: boolean;
  error?: string;
  note?: string;
}

export async function verifyConnection(store: StoreRecord, credentials: StoreCredentials | null): Promise<VerifyResult> {
  if (store.platform === "demo") {
    return { ok: true, note: "Demo adapter verified (simulated store, labeled DEMO)." };
  }

  if (!credentials?.api_token) {
    return {
      ok: false,
      error: `Missing API credentials for ${store.platform}. Add the store's API token in store settings, then verify again.`,
    };
  }

  return {
    ok: false,
    error: `The ${store.platform} adapter is not implemented yet. Its real API capabilities must be confirmed against the live store before connecting — no endpoints are assumed.`,
  };
}

export async function syncStore(store: StoreRecord): Promise<VerifyResult> {
  if (store.platform === "demo") {
    return { ok: true, note: "Demo sync complete (simulated)." };
  }
  return {
    ok: false,
    error: "Sync is not available until this store's integration has been verified.",
  };
}
