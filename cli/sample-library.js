/* Content-addressed PCM and independently published catalog entries. */
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {isDeepStrictEqual} = require('node:util');
const WAV = require('./wav.js');
const {write,publishJson} = require('./asset-files.js');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function openSampleLibrary(directory, {kit = require('../index.js').load()} = {}) {
  const root = path.resolve(directory), manifest = path.join(root,'entries');
  const {sampleCatalog} = kit.KIT.procedural.mediaGraph, validId = kit.KIT.procedural.musicInstruments.id;
  const audioPath = asset => path.join(root,'audio',asset+'.wav');
  function result(entry) {
    if (!entry.asset) throw new TypeError('Stored sample entry needs an audio hash');
    return {entry, file:audioPath(entry.asset)};
  }
  function get(id) {
    if (!validId(id)) throw new TypeError('Invalid sample ID');
    const file = path.join(manifest,id+'.json');
    if (!fs.existsSync(file)) throw new RangeError('Unknown sample '+id);
    const entry = sampleCatalog.entry(read(file));
    if (entry.id!==id) throw new RangeError('Stored sample ID disagrees with its filename');
    return result(entry);
  }
  function prepare({value,entry:raw}) {
    const {asset,...metadata} = sampleCatalog.entry(raw);
    const {sampleRate,channels,samples} = value;
    if (sampleRate!==metadata.sampleRate || channels!==metadata.channels ||
        samples.length!==metadata.frames*channels)
      throw new RangeError('Sample PCM does not match its catalog entry');
    const bytes = WAV.encode(value,{encoding:'float64'}), hash = sha(bytes);
    if (asset!==undefined && asset!==hash) throw new RangeError('Sample PCM disagrees with its supplied hash');
    return {entry:{...metadata,asset:hash},file:audioPath(hash),bytes};
  }
  function persist({entry,file,bytes}) {
    if (!fs.existsSync(file)) write(file,bytes);
    publishJson(path.join(manifest,entry.id+'.json'),entry,'Sample ID already exists with different content or metadata');
    return result(entry);
  }
  return Object.freeze({
    add(sample) { return persist(prepare(sample)); },
    addBatch(samples) {
      if (!Array.isArray(samples) || !samples.length || samples.length>2)
        throw new RangeError('Publish one or two print samples together');
      const pending=samples.map(prepare);
      if (new Set(pending.map(row=>row.entry.id.toLowerCase())).size!==pending.length)
        throw new RangeError('Printed sample IDs must be distinct');
      for (const {entry} of pending) {
        const target=path.join(manifest,entry.id+'.json');
        if (fs.existsSync(target) && !isDeepStrictEqual(read(target),entry))
          throw new RangeError('Sample ID already exists with different content or metadata');
      }
      return pending.map(persist);
    },
    get,
    load(id) {
      const found = get(id);
      if (fs.statSync(found.file).size>WAV.maxBytes) throw new RangeError('Stored sample exceeds the WAV budget');
      const bytes = fs.readFileSync(found.file);
      if (sha(bytes)!==found.entry.asset) throw new RangeError('Stored sample has a different audio hash');
      const value = WAV.decode(bytes);
      if (value.sampleRate!==found.entry.sampleRate || value.channels!==found.entry.channels ||
          value.samples.length!==found.entry.frames*value.channels)
        throw new RangeError('Stored PCM does not match its catalog entry');
      return {...found,value};
    },
    search(options) {
      const rows = fs.existsSync(manifest) ? fs.readdirSync(manifest,{withFileTypes:true})
        .filter(row => row.isFile() && row.name.endsWith('.json')).map(row => row.name.slice(0,-5)) : [];
      if (rows.length>16384) throw new RangeError('Audio sample catalog exceeds its entry budget');
      return sampleCatalog.create(rows.map(id=>get(id).entry)).search(options);
    }
  });
}

module.exports = {openSampleLibrary};
