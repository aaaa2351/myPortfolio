const express = require('express');
const { createConfig } = require('./config');
const { createSecurity } = require('./security');
const { createStorage } = require('./storage');
const { createImages } = require('./images');
const { createApiRouter } = require('./api');

function createApp(config) {
  const security = createSecurity(config);
  const storage = createStorage(config);
  const images = createImages(config);
  const app = express();

  app.disable('x-powered-by');
  app.set('etag', false);
  app.use(security.hostGuard);
  app.use(security.securityHeaders);
  app.use('/api', createApiRouter({ config, storage, images, security }));

  const staticOptions = {
    dotfiles: 'ignore',
    index: 'index.html',
    setHeaders(res) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  };

  app.use('/admin', express.static(config.adminDir, staticOptions));
  app.use(express.static(config.publicDir, staticOptions));

  app.use((req, res) => {
    res.status(404).type('text/plain').send('Not found');
  });

  return { app, storage, security };
}

function start() {
  const config = createConfig();
  const { app } = createApp(config);
  const server = app.listen(config.port, config.host, () => {
    const base = `http://${config.host}:${server.address().port}`;
    config.port = server.address().port;
    console.log('');
    console.log('  Portfolio CMS is running (local only)');
    console.log(`  Admin     ${base}/admin/`);
    console.log(`  Portfolio ${base}/`);
    console.log('');
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${config.port} is already in use. Start with another port, for example: PORT=3100 npm start`);
    } else {
      console.error(error);
    }
    process.exit(1);
  });

  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) start();

module.exports = { createApp };
