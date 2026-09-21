const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const api = process.env.PERMISSION_TEST_API ?? "http://localhost:3001";
const adminEmail = process.env.METROFLOW_ADMIN_EMAIL ?? "admin@metroflow.dev";
const adminPassword = process.env.METROFLOW_ADMIN_PASSWORD ?? "MetroFlow-Admin-123!";
const operatorEmail = process.env.METROFLOW_OPERATOR_EMAIL ?? "operator@metroflow.dev";
const operatorPassword = process.env.METROFLOW_OPERATOR_PASSWORD ?? "MetroFlow-Operator-123!";
async function request(path, options = {}) { const response = await fetch(`${api}${path}`, { ...options, headers: { "content-type": "application/json", ...(options.headers ?? {}) } }); let body = null; try { body = await response.json(); } catch {} return { response, body }; }
async function login(email, password) { const result = await request("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }); assert.equal(result.response.status, 201, `login failed for ${email}`); return result.body.accessToken; }
async function expectStatus(path, token, status, options = {}) { const result = await request(path, { ...options, headers: { authorization: `Bearer ${token}`, ...(options.headers ?? {}) } }); assert.equal(result.response.status, status, `${path} expected ${status}, got ${result.response.status}`); return result; }
(async () => {
  const admin = await login(adminEmail, adminPassword); const operator = await login(operatorEmail, operatorPassword);
  const passengerEmail = `permission-${randomUUID()}@metroflow.test`; const registered = await request("/api/v1/auth/register", { method: "POST", body: JSON.stringify({ email: passengerEmail, password: "Permission-Test-123!" }) }); assert.equal(registered.response.status, 201, "temporary passenger registration failed"); const passenger = await login(passengerEmail, "Permission-Test-123!");
  const stations = await expectStatus("/api/v1/stations/operations", operator, 200); const station = stations.body.data.stations[0]; assert.ok(station?.id, "operator station data missing");
  await expectStatus("/api/v1/admin/analytics", operator, 403); await expectStatus("/api/v1/admin/audit", operator, 403); await expectStatus("/api/v1/stations/operations", passenger, 403);
  await expectStatus(`/api/v1/stations/${station.id}/status`, operator, 200, { method: "PATCH", body: JSON.stringify({ isActive: station.isActive }) });
  await expectStatus("/api/v1/admin/analytics", admin, 200); await expectStatus("/api/v1/admin/audit", admin, 200);
  console.log("Permission tests passed: operator controls, passenger denial, admin-only endpoint protection.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
