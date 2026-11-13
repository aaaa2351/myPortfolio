const crypto = require('crypto');

const encode = (buffer) => Buffer.from(buffer).toString('base64url');
const derive = (secret, info) => Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret), Buffer.from('portfolio-cms'), Buffer.from(info), 32));

function createSessionCodec(secret) {
  const sealKey = derive(secret, 'seal');
  const csrfKey = derive(secret, 'csrf');

  function seal(value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', sealKey, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return `v1.${encode(iv)}.${encode(cipher.getAuthTag())}.${encode(data)}`;
  }

  function unseal(token) {
    try {
      const [version, iv, tag, data] = String(token || '').split('.');
      if (version !== 'v1' || !iv || !tag || !data) return null;
      const decipher = crypto.createDecipheriv('aes-256-gcm', sealKey, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      const plain = Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]);
      const parsed = JSON.parse(plain.toString('utf8'));
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  function csrf(sid) {
    return crypto.createHmac('sha256', csrfKey).update(`csrf:${sid}`).digest('hex');
  }

  function verifyCsrf(sid, supplied) {
    const expected = Buffer.from(csrf(sid));
    const actual = Buffer.from(String(supplied || ''));
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  }

  return { seal, unseal, csrf, verifyCsrf };
}

module.exports = { createSessionCodec };
