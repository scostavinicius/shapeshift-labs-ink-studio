const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const PNG = require('./png.js');

function write(file, bytes) {
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true });
  const temp = fs.mkdtempSync(path.join(directory, '.ink-asset-'));
  try {
    const staged = path.join(temp, 'asset');
    fs.writeFileSync(staged, bytes);
    fs.renameSync(staged, file);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function json(file, document) {
  write(file, JSON.stringify(document, null, 2) + '\n');
}

function publishJson(file, entry, conflict) {
  const folder = path.dirname(file);
  fs.mkdirSync(folder,{recursive:true});
  const scratch = fs.mkdtempSync(path.join(folder,'.ink-entry-'));
  const staged = path.join(scratch,'entry');
  try {
    fs.writeFileSync(staged,JSON.stringify(entry,null,2)+'\n');
    try { fs.linkSync(staged,file); }
    catch (error) {
      if (error.code!=='EEXIST') throw error;
      if (!isDeepStrictEqual(JSON.parse(fs.readFileSync(file,'utf8')),entry)) throw new RangeError(conflict);
    }
  } finally {
    fs.rmSync(scratch,{recursive:true,force:true});
  }
}

function image(directory, width, height, rgba) {
  const bytes = PNG.encode(width, height, rgba, 4);
  const name = createHash('sha256').update(bytes).digest('hex') + '.png';
  const relative = 'images/' + name, file = path.join(directory, relative);
  if (!fs.existsSync(file)) write(file, bytes);
  return relative;
}

module.exports = { write, json, image, publishJson };
