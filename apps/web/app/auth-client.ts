let accessToken: string | null = null;
export function setAccessToken(token: string) {
  accessToken = token;
}
export function getAccessToken() {
  return accessToken;
}
export function clearAccessToken() {
  accessToken = null;
}

let refreshInFlight: Promise<string | null> | null = null;
export function refreshAccessToken(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = refresh().finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

async function refresh() {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/api/v1/auth/refresh`,
      { method: "POST", credentials: "include", signal: AbortSignal.timeout(10000) },
    );
    if (!response.ok) return null;
    const data = (await response.json()) as { accessToken?: string };
    if (!data.accessToken) return null;
    setAccessToken(data.accessToken);
    return data.accessToken;
  } catch {
    return null;
  }
}
