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

export async function refreshAccessToken() {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/api/v1/auth/refresh`,
    {
      method: "POST",
      credentials: "include",
    },
  );
  if (!response.ok) return null;
  const data = (await response.json()) as { accessToken?: string };
  if (!data.accessToken) return null;
  setAccessToken(data.accessToken);
  return data.accessToken;
}
