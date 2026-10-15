const net = require('node:net');

async function createLoopbackRelay({ port, targetPort, bind = '127.0.0.1' }) {
  if (!Number.isInteger(port) || port < 0 || port > 65535 || !Number.isInteger(targetPort)
    || targetPort < 1024 || targetPort > 65535 || !['127.0.0.1', '0.0.0.0'].includes(bind)) {
    throw new Error('JOB_BROWSER_INVALID_RELAY');
  }
  const sockets = new Set();
  const server = net.createServer((incoming) => {
    const outgoing = net.connect({ host: '127.0.0.1', port: targetPort });
    for (const socket of [incoming, outgoing]) {
      sockets.add(socket); socket.on('close', () => sockets.delete(socket));
      socket.on('error', () => { incoming.destroy(); outgoing.destroy(); });
      socket.setTimeout(600000, () => { incoming.destroy(); outgoing.destroy(); });
    }
    incoming.on('close', () => outgoing.destroy()); outgoing.on('close', () => incoming.destroy());
    incoming.pipe(outgoing); outgoing.pipe(incoming);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(port, bind, resolve);
  });
  return { port: server.address().port, close: () => new Promise((resolve) => {
    for (const socket of sockets) socket.destroy(); server.close(resolve);
  }) };
}
module.exports = { createLoopbackRelay };
