const fs = require('fs');
const path = require('path');

try {
  process.loadEnvFile('.env');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const { createConfig, missingSettings } = require('../server/config');
const { createSupabaseClients, createSupabaseRepo } = require('../server/repo/supabase');
const { createContentService } = require('../server/storage');
const { createStaticImages } = require('../server/images');
const { validateContent } = require('../server/validate');
const { BACKUP_NAME_RE, backupDateFromName } = require('../server/content-model');

const ACTOR = 'seed-script';

async function main() {
  const config = createConfig();
  const missing = missingSettings(config).data;
  if (missing.length) {
    console.error(`Cannot seed. Set ${missing.join(', ')} first (see .env.example).`);
    process.exit(1);
  }
  const repo = createSupabaseRepo(createSupabaseClients(config));
  const content = createContentService({ repo, config, staticImages: createStaticImages(config) });

  const draft = await content.loadDraft();
  console.log(`Draft ready at revision ${draft.revision}.`);

  let imported = 0;
  let skipped = 0;
  if (fs.existsSync(config.localBackupDir)) {
    for (const name of fs.readdirSync(config.localBackupDir).sort()) {
      const createdAt = BACKUP_NAME_RE.test(name) ? backupDateFromName(name) : null;
      if (!createdAt) continue;
      let parsed;
      try {
        parsed = JSON.parse(fs.readFileSync(path.join(config.localBackupDir, name), 'utf8'));
      } catch {
        skipped += 1;
        continue;
      }
      const result = validateContent(parsed, { keepServerFields: true });
      if (!result.ok) {
        skipped += 1;
        continue;
      }
      if (await repo.importBackup({ name, content: result.value, createdAt, actor: ACTOR })) imported += 1;
    }
  }
  console.log(`Local backups imported: ${imported}${skipped ? `, skipped (invalid or unreadable): ${skipped}` : ''}.`);

  if (process.argv.includes('--no-publish')) return;
  const latest = await repo.getLatestPublication();
  if (latest) {
    console.log('Already published. Nothing to do.');
    return;
  }
  await content.publish(draft.revision, ACTOR, 'Initial publication');
  console.log('Published the initial content.');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
