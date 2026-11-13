const { createConfig, missingSettings } = require('./config');

try {
  process.loadEnvFile('.env');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const { createApp } = require('./app');

function start() {
  const config = createConfig();
  const { app } = createApp(config);
  const problems = missingSettings(config);
  const server = app.listen(config.port, config.host, () => {
    config.port = server.address().port;
    const base = `http://localhost:${config.port}`;
    console.log('');
    console.log('  Portfolio CMS (development server)');
    console.log(`  Admin     ${base}/admin/`);
    console.log(`  Portfolio ${base}/`);
    const missing = [...new Set([...problems.auth, ...problems.data])];
    if (missing.length) console.log(`  Not configured: ${missing.join(', ')} (see .env.example)`);
    console.log('');
  });
  server.on('error', (error) => {
    console.error(error.code === 'EADDRINUSE' ? `Port ${config.port} is in use. Try: PORT=3100 npm start` : error);
    process.exit(1);
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) start();

module.exports = { start };
