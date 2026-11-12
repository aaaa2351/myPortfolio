const path = require('path');

function createConfig(options = {}) {
  const root = options.root || path.resolve(__dirname, '..');
  const requestedPort = Number(options.port ?? process.env.PORT ?? 3000);
  const port = Number.isInteger(requestedPort) && requestedPort >= 0 && requestedPort <= 65535 ? requestedPort : 3000;

  return {
    root,
    host: '127.0.0.1',
    port,
    publicDir: path.join(root, 'public'),
    adminDir: path.join(root, 'admin'),
    dataFile: path.join(root, 'public', 'data', 'portfolio.json'),
    backupDir: path.join(root, 'data', 'backups'),
    imagesDir: path.join(root, 'public', 'images'),
    uploadDir: path.join(root, 'public', 'images', 'uploads'),
    maxUploadBytes: 5 * 1024 * 1024,
    maxBodyBytes: '1mb'
  };
}

module.exports = { createConfig };
