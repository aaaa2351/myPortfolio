const NAME_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
const VALUE_RE = /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*$/;

function parse(header) {
  const result = Object.create(null);
  if (typeof header !== 'string' || !header) return result;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    if (!NAME_RE.test(name) || name in result) continue;
    let value = part.slice(index + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1);
    result[name] = value;
  }
  return result;
}

function serialize(name, value, options = {}) {
  if (!NAME_RE.test(name)) throw new Error('Invalid cookie name.');
  if (!VALUE_RE.test(value)) throw new Error('Invalid cookie value.');
  const { maxAge, path = '/', httpOnly = true, secure = true, sameSite = 'Lax' } = options;
  const parts = [`${name}=${value}`, `Path=${path}`];
  if (Number.isInteger(maxAge)) {
    parts.push(`Max-Age=${Math.max(0, maxAge)}`);
    if (maxAge <= 0) parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  }
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  parts.push(`SameSite=${sameSite}`);
  return parts.join('; ');
}

function append(res, cookie) {
  const existing = res.getHeader('Set-Cookie');
  if (!existing) res.setHeader('Set-Cookie', [cookie]);
  else res.setHeader('Set-Cookie', [...(Array.isArray(existing) ? existing : [existing]), cookie]);
}

module.exports = { parse, serialize, append };
