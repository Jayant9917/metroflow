const api = process.env.API_URL ?? "http://localhost:3001";
const email = process.env.METROFLOW_ADMIN_EMAIL ?? "admin@metroflow.dev";
const password = process.env.METROFLOW_ADMIN_PASSWORD ?? "MetroFlow-Admin-123!";

async function json(path, options = {}) {
  const response = await fetch(`${api}${path}`, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

(async () => {
const login = await json("/api/v1/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, password }),
});
if (!login.response.ok || !login.body.accessToken) throw new Error(`Admin login failed: ${login.response.status}`);
const authorization = { authorization: `Bearer ${login.body.accessToken}` };
const cases = [
  ["/api/v1/tickets/operations?page=0", "ticket pagination"],
  ["/api/v1/tickets/operations?sortBy=invalid", "ticket sorting"],
  ["/api/v1/journeys/operations?pageSize=101", "journey page size"],
  ["/api/v1/journeys/operations?sortDirection=invalid", "journey direction"],
  ["/api/v1/purchases/operations?status=invalid", "payment status"],
  ["/api/v1/purchases/operations?sortBy=invalid", "payment sorting"],
  ["/api/v1/admin/audit?page=-1", "audit pagination"],
  ["/api/v1/admin/audit?sortBy=invalid", "audit sorting"],
];
for (const [path, label] of cases) {
  const { response } = await json(path, { headers: authorization });
  if (response.status !== 400) throw new Error(`${label} expected HTTP 400, received ${response.status}`);
}
const validSorts = [
  ["/api/v1/journeys/operations?sortBy=enteredAt&sortDirection=asc", "journey sorting"],
  ["/api/v1/purchases/operations?sortBy=amount&sortDirection=desc", "payment sorting"],
  ["/api/v1/admin/audit?sortBy=action&sortDirection=asc", "audit sorting"],
];
for (const [path, label] of validSorts) {
  const { response } = await json(path, { headers: authorization });
  if (!response.ok) throw new Error(`${label} expected a successful response, received ${response.status}`);
}
console.log(`Admin query validation passed: ${cases.length} invalid-query cases and ${validSorts.length} valid sorting cases.`);
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
