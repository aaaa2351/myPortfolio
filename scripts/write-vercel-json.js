const fs = require('fs');
const path = require('path');
const { ADMIN_CSP, PUBLIC_CSP, PERMISSIONS_POLICY } = require('../server/security');

const common = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'Permissions-Policy', value: PERMISSIONS_POLICY },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' }
];

const adminHeaders = [
  { key: 'Content-Security-Policy', value: ADMIN_CSP },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
  { key: 'Cache-Control', value: 'no-cache' }
];

const config = {
  $schema: 'https://openapi.vercel.sh/vercel.json',
  framework: null,
  buildCommand: 'node scripts/build.js',
  outputDirectory: 'dist',
  functions: { 'api/index.js': { maxDuration: 30, includeFiles: 'public/**' } },
  rewrites: [
    { source: '/api/(.*)', destination: '/api' },
    { source: '/admin', destination: '/admin/index.html' }
  ],
  headers: [
    { source: '/(.*)', headers: common },
    { source: '/admin', headers: adminHeaders },
    { source: '/admin/(.*)', headers: adminHeaders },
    {
      source: '/((?!admin|api).*)',
      headers: [
        { key: 'Content-Security-Policy', value: PUBLIC_CSP },
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' }
      ]
    }
  ]
};

fs.writeFileSync(path.join(__dirname, '..', 'vercel.json'), `${JSON.stringify(config, null, 2)}\n`);
