const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { KIT:{world:W} } = require('../..').load();

const out = path.resolve(process.argv[2]??'breakwater-staging');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const worldFile = path.join(__dirname,'world.json'), planFile = path.join(__dirname,'plan.json');
const run = spawnSync(process.execPath,[cli,'sim','search-staging',worldFile,planFile,'--out',out,'--json'],
  {encoding:'utf8'});
if (run.error) throw run.error;
if (run.status!==0) throw Error(run.stderr);
const report = JSON.parse(run.stdout);
assert.equal(report.stop,'all-found');
const routes = report.checks.map(check=>{
  const recording = JSON.parse(fs.readFileSync(path.join(out,check.replay),'utf8'));
  assert.equal(W.runtime.verify(recording).status,'verified');
  const replay = W.runtime.openRecording(recording), frames = [];
  let speaking = false, revealed = false, touched = false, armed = false;
  for (let tick=recording.origin.tick; tick<=recording.end.tick; tick++) {
    if (tick>recording.origin.tick) replay.step();
    const query = replay.query();
    for (const row of replay.committedEvents()) {
      if (row.kind==='dialogue-start') speaking = true;
      if (row.kind==='dialogue-end') speaking = false;
      if (row.kind!=='gameplay-state-changed') continue;
      if (row.system==='shutter'&&row.payload.to==='revealed') revealed = true;
      if (row.system==='latch-use'&&row.payload.to==='contact') touched = true;
      if (row.system==='warning'&&row.payload.to==='queued') armed = true;
    }
    const {watcher,keeper,camera,latch,beacon,bell} = Object.fromEntries(
      ['watcher','keeper','camera','latch','beacon','bell'].map(entity=>[entity,query.frame({entity}).point]));
    frames.push({tick,speaking,revealed,touched,armed,watcher,keeper,camera,latch,beacon,bell});
  }
  return {check,frames,recording};
});
const world = JSON.parse(fs.readFileSync(worldFile,'utf8'));
const data = JSON.stringify({report,routes,divider:world.systems.walls.config.bodies.divider})
  .replace(/</g,'\\u003c');
const page = fs.readFileSync(path.join(__dirname,'replay.html.template'),'utf8').replace('__DEMO_DATA__',()=>data);
fs.writeFileSync(path.join(out,'breakwater-watch.html'),page);
console.log(path.join(out,'breakwater-watch.html'));
