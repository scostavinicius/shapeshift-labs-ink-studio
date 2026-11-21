const fs = require('node:fs');
const path = require('node:path');
const assets = require('./asset-files.js');
const PNG = require('./png.js');

const shell = text => "'" + String(text).replaceAll("'", "'\\''") + "'";
const canonical = file => fs.existsSync(file) ? fs.realpathSync(file) : file;

function write({ report, evidence }, { file, source, options, cwd, entry }) {
  const stem = file.slice(0, -5);
  const label = '-frame-' + String(evidence.frame).padStart(4, '0');
  const images = [
    ['image', label + '.png'],
    ['previous', label + '-previous.png'],
    ['marked', label + '-subjects.png']
  ].filter(([key]) => evidence[key]).map(([key, suffix]) => [key, stem + suffix]);
  const inputs = [source, options.plan].filter(Boolean).map(input => canonical(path.resolve(cwd, input)));
  if ([file, ...images.map(([, image]) => image)].some(output => inputs.includes(canonical(output))))
    throw new RangeError('Use output paths separate from the scene and the shot approval plan');
  const view = Object.entries(options).filter(([key]) => !['out', 'plan', 'frame'].includes(key))
    .flatMap(([key, value]) => value === true ? ['--' + key] : ['--' + key, value]);
  function reproduce(frame) {
    const output = stem + '-repro-' + frame + '.json';
    const args = [process.execPath, entry, 'shot', 'approve', source, ...view,
      '--plan', file, '--frame', String(frame), '--out', output];
    return { cwd, args, command: 'cd ' + shell(cwd) + ' && ' + args.map(shell).join(' ') };
  }
  const reproductions = new Map();
  for (const finding of report.findings) {
    if (!reproductions.has(finding.frame)) reproductions.set(finding.frame, reproduce(finding.frame));
    finding.reproduce = reproductions.get(finding.frame);
  }
  report.evidence = { frame: evidence.frame, ...Object.fromEntries(images.map(([key, image]) => [key, path.basename(image)])) };
  for (const [key, image] of images) {
    assets.write(image, PNG.encodeFrame(PNG.packFrame(evidence[key])));
  }
  assets.json(file, report);
  return report.firstFailure;
}

module.exports = { write };
