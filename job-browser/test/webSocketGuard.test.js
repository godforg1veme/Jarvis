const test = require('node:test');
const assert = require('node:assert/strict');
const { newGuardedPage } = require('../src/webSocketGuard');

test('page guard completes before a managed page is returned', async () => {
  let guarded = false, socketClosed = false;
  const page = { async routeWebSocket(pattern, handler) {
    assert.equal(pattern, '**/*'); await handler({close:async()=>{socketClosed=true;}});guarded=true;
  } };
  assert.equal(await newGuardedPage({newPage:async()=>page}),page);
  assert.equal(guarded,true);assert.equal(socketClosed,true);
});

test('missing or failed WebSocket guard closes the page instead of returning it', async () => {
  for(const failure of [undefined,async()=>{throw Error('fixture');}]) {
    let closed=false;
    await assert.rejects(newGuardedPage({newPage:async()=>({routeWebSocket:failure,close:async()=>{closed=true;}})}));
    assert.equal(closed,true);
  }
});
