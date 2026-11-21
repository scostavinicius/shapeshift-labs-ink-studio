const path = require('node:path');
const { gzipSync } = require('node:zlib');
const { write } = require('../cli/asset-files.js');
const studio = require('..');

const targets = {
  development: ['ink-studio.browser.js', { profile: 'development', format: 'script' }],
  node: ['ink-studio.node.cjs', { profile: 'development', format: 'commonjs' }],
  playback: ['ink-studio.player.mjs', { profile: 'playback', format: 'module' }]
};
const dist = path.join(__dirname, '../dist');

function build(profile = 'all', directory = dist) {
  if (profile !== 'all' && !Object.hasOwn(targets, profile))
    throw new TypeError('Build profile must be all, development, node or playback');
  const pairs = profile === 'all' ? Object.values(targets) : [targets[profile]];
  return pairs.map(([name, options]) => {
    const file = path.join(directory, name);
    const bytes = Buffer.from(studio.bundle(options));
    write(file, bytes);
    return { file, rawBytes: bytes.length, gzipBytes: gzipSync(bytes, { level: 9 }).length };
  });
}

if (require.main === module) {
  try {
    if (process.argv.length > 3) throw new TypeError('Use npm run build -- [all|development|node|playback]');
    const quiet = process.argv[2] === '--quiet';
    const files = build(quiet ? 'all' : process.argv[2]);
    if (!quiet) for (const { file, rawBytes, gzipBytes } of files)
      console.log(path.relative(process.cwd(), file), rawBytes, 'bytes raw,', gzipBytes, 'bytes gzip');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { build };
