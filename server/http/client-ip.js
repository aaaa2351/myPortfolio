const net = require('net');

function clientIp(req, trustProxy) {
  if (trustProxy) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (net.isIP(forwarded)) return forwarded;
    const real = String(req.headers['x-real-ip'] || '').trim();
    if (net.isIP(real)) return real;
  }
  const remote = String((req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:/, '');
  return net.isIP(remote) ? remote : 'unknown';
}

module.exports = { clientIp };
