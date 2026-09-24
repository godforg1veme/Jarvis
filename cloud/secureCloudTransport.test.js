const assert = require('node:assert/strict');
const test = require('node:test');
const { createSecureDnsLookup, isPublicIpv4, parsePublicDnsAnswers } = require('./secureCloudTransport');

test('secure DNS rejects private and loopback addresses', () => {
  assert.equal(isPublicIpv4('188.114.96.1'), true);
  assert.equal(isPublicIpv4('127.93.2.64'), false);
  assert.equal(isPublicIpv4('10.0.0.1'), false);
  assert.equal(isPublicIpv4('192.168.1.1'), false);
});

test('secure DNS keeps only public A records', () => {
  const records = parsePublicDnsAnswers({
    Answer: [
      { type: 1, data: '127.93.2.64', TTL: 300 },
      { type: 1, data: '188.114.97.1', TTL: 300 },
      { type: 28, data: 'fd00::1', TTL: 300 },
    ],
  });
  assert.deepEqual(records.map((record) => record.address), ['188.114.97.1']);
});

test('secure DNS lookup caches a validated answer', async () => {
  let calls = 0;
  const lookup = createSecureDnsLookup({
    request: async () => {
      calls += 1;
      return { Status: 0, Answer: [{ type: 1, data: '188.114.97.1', TTL: 300 }] };
    },
  });
  const resolve = () => new Promise((resolve, reject) => lookup('jarvis.rilora.ru', {}, (error, address, family) => {
    if (error) reject(error);
    else resolve({ address, family });
  }));
  assert.deepEqual(await resolve(), { address: '188.114.97.1', family: 4 });
  assert.deepEqual(await resolve(), { address: '188.114.97.1', family: 4 });
  assert.equal(calls, 1);
});
