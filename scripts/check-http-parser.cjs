// Run from the repository root: node --test scripts/check-http-parser.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const path = require('node:path');

for (const app of ['api-gateway', 'core-api', 'gate-service']) {
  test(`${app}: actual Express dependency parses JSON and rejects malformed JSON`, async () => {
    const nestPath = require.resolve('@nestjs/platform-express', { paths: [path.resolve('apps', app)] });
    const expressPath = require.resolve('express', { paths: [nestPath] });
    const typePath = require.resolve('type-is', { paths: [expressPath] });
    const typerPath = require.resolve('media-typer', { paths: [typePath] });
    assert.equal(typeof require(typerPath).test, 'function', `Broken media-typer resolution: ${typerPath}`);
    const express = require(expressPath);
    const application = express();
    application.use(express.json());
    application.post('/probe', (req, res) => res.json(req.body));
    application.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.type }));
    const server = application.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const url = `http://127.0.0.1:${server.address().port}/probe`;
      const result = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"probe":true}' });
      assert.equal(result.status, 200);
      assert.deepEqual(await result.json(), { probe: true });
      const invalid = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
      assert.equal(invalid.status, 400);
    } finally { await new Promise((resolve) => server.close(resolve)); }
  });
}
