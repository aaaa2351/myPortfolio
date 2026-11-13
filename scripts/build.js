const fs = require('fs');
const path = require('path');

function copy(source, target) {
  fs.cpSync(source, target, {
    recursive: true,
    filter: (entry) => {
      const name = path.basename(entry);
      return !name.startsWith('.') || name === '.well-known';
    }
  });
}

function build({ root = path.resolve(__dirname, '..'), out = path.join(root, 'dist') } = {}) {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  copy(path.join(root, 'public'), out);
  copy(path.join(root, 'admin'), path.join(out, 'admin'));
  return out;
}

if (require.main === module) {
  const out = build();
  console.log(`Static site written to ${path.relative(process.cwd(), out) || '.'}`);
}

module.exports = { build };
