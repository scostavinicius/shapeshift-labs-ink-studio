const fs = require('node:fs');
const path = require('node:path');
const { write, json } = require('./asset-files.js');
const PNG = require('./png.js');

const png = image => PNG.encode(image.w, image.h, image.rgb);
const url = bytes => 'data:image/png;base64,' + bytes.toString('base64');
const template = () => fs.readFileSync(path.join(__dirname, 'shot-light-workshop.html'), 'utf8');
function page(data) {
  const colorSpace = data.candidates ? fs.readFileSync(path.join(__dirname, '../src/color-space.js'), 'utf8') : '';
  return template().replace('/*COLOR_SPACE*/', () => colorSpace)
    .replace('/*WORKSHOP_DATA*/', () => JSON.stringify(data).replaceAll('<', '\\u003c'));
}

function previewBank() {
  const rows = [];
  return { rows, add: (rig, image) => rows.push({ rig, image: url(png(image)) }) };
}

function writePainter(file, { image, plan }) {
  write(file, page({ plan, before: url(png(image)) }));
}

function writeFit(folder, plan, { rig, before, after, report }, candidates) {
  const start = png(before), fitted = png(after);
  json(path.join(folder, 'rig.json'), rig);
  write(path.join(folder, 'before.png'), start);
  write(path.join(folder, 'fitted.png'), fitted);
  json(path.join(folder, 'fit.json'), report);
  const boundPlan = { ...plan, sourceSha256: report.sourceSha256 };
  write(path.join(folder, 'index.html'), page({ plan: boundPlan, rig, before: url(start), after: url(fitted),
    regions: report.regions, evaluations: report.work.evaluations, candidates }));
}

module.exports = { writePainter, writeFit, previewBank };
