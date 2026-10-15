const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { createLoopbackRelay } = require('../src/loopbackRelay');

test('relay forwards only to fixed loopback and closes connected clients on shutdown', async () => {
  const fixture = net.createServer((socket) => socket.pipe(socket));
  await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve));
  let relay, client;
  try {
    relay = await createLoopbackRelay({ port: 0, targetPort: fixture.address().port });
    client = net.connect({ host: '127.0.0.1', port: relay.port });
    const reply = new Promise((resolve) => client.once('data', (buffer) => resolve(buffer.toString())));
    client.write('synthetic-loopback-data'); assert.equal(await reply, 'synthetic-loopback-data');
    const disconnected = new Promise((resolve) => client.once('close', resolve));
    await relay.close(); await disconnected; relay = null;
    await assert.rejects(createLoopbackRelay({ port: 0, targetPort: fixture.address().port, bind: '169.254.169.254' }));
    await assert.rejects(createLoopbackRelay({ port: 0, targetPort: 22 }));
  } finally { client?.destroy(); if (relay) await relay.close(); await new Promise((resolve) => fixture.close(resolve)); }
});
