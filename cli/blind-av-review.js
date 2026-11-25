const fs = require('node:fs');
const path = require('node:path');
const { randomInt, randomUUID } = require('node:crypto');
const { print } = require('./blind-av-media.js');

const format = 'ink-studio/blind-av-review';
const modes = ['picture','sound','combined'];
const aspects = ['action','cause','impact'];
const buildUsage = 'take blind-review <brief.json> --out <new-directory> [--ffmpeg executable]';
const scoreUsage = 'take blind-review-score <review-key.json> <ballots-directory> --out <new-directory>';
const keyFormat = format+'-key', ballotFormat = format+'-ballot', reportFormat = format+'-report';
const read = file=>JSON.parse(fs.readFileSync(file,'utf8'));
const write = (file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
const record = value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fields = (value,allowed)=>record(value)&&Object.keys(value).every(key=>allowed.includes(key));
const id = value=>typeof value==='string'&&/^[a-z][a-z0-9-]{0,31}$/.test(value);
const token = value=>typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
const text = (value,max=240)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
const integer = (value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const check = (condition,message)=>{ if (!condition) throw new TypeError(message); };

function questions(queries) {
  check(fields(queries,aspects),'Use action, cause and impact questions');
  for (const aspect of aspects) {
    const question = queries[aspect], impact = aspect==='impact';
    check(fields(question,impact?['prompt','prompts','low','high']:['prompt','prompts','options','correct'])&&
      text(question.prompt)&&(question.prompts===undefined||fields(question.prompts,modes)&&
        Object.values(question.prompts).every(value=>text(value))), 'Invalid '+aspect+' prompt');
    if (impact) {
      check(text(question.low,60)&&text(question.high,60),'Name the low and high ends of the impact scale');
      continue;
    }
    const {options,correct} = question;
    check(Array.isArray(options)&&integer(options.length,2,8)&&options.every(option=>
      fields(option,['id','label'])&&id(option.id)&&text(option.label,100))&&
      new Set(options.map(option=>option.id)).size===options.length&&
      new Set(options.map(option=>option.label)).size===options.length&&
      options.some(option=>option.id===correct), 'Supply distinct options and a correct response for '+aspect);
  }
  return queries;
}

function prepare(raw) {
  check(fields(raw,['format','version','id','title','picture','audio','window','seats','questions'])&&
    raw.format===format&&raw.version===1&&id(raw.id)&&text(raw.title,100)&&
    (text(raw.picture,4096)||record(raw.picture))&&
    (raw.window===undefined||fields(raw.window,['from','to'])&&Number.isSafeInteger(raw.window.from)&&
      Number.isSafeInteger(raw.window.to))&&
    (raw.audio===undefined||fields(raw.audio,['file','startSample'])&&text(raw.audio.file,4096)&&
      (raw.audio.startSample===undefined||integer(raw.audio.startSample,0,Number.MAX_SAFE_INTEGER))),
  'Expected a version 1 blind audiovisual review brief');
  const {seats=9} = raw;
  check(integer(seats,3,30)&&seats%3===0,'Choose 3 to 30 review seats in groups of three');
  return {...raw,seats,questions:questions(raw.questions)};
}

function shuffled(list) {
  const result = [...list];
  for (let index=result.length-1;index>0;index--) {
    const other = randomInt(index+1);
    [result[index],result[other]] = [result[other],result[index]];
  }
  return result;
}

const safeJson = value=>JSON.stringify(value).replace(/</g,'\\u003c');
function page(name, model) {
  return fs.readFileSync(path.join(__dirname,'blind-av-'+name+'.html'),'utf8')
    .replace('/* MODEL */ {}',()=>safeJson(model));
}

function newDirectory(output, build) {
  const root = path.resolve(output), parent = path.dirname(root);
  check(!fs.lstatSync(root,{throwIfNoEntry:false}),'Choose a new directory for the blind review output');
  fs.mkdirSync(parent,{recursive:true});
  const stage = fs.mkdtempSync(path.join(parent,'.ink-blind-av-'));
  try {
    const result = build(stage);
    fs.renameSync(stage,root);
    return result;
  } finally {
    fs.rmSync(stage,{recursive:true,force:true});
  }
}

function build(file, out, kit, ffmpeg) {
  const owner = path.resolve(file), brief = prepare(read(owner));
  return newDirectory(out,stage=>{
    const {media,window} = print(brief,owner,kit,stage,ffmpeg);
    const session = randomUUID(), seats = [];
    const publicDir = path.join(stage,'reviewers');
    fs.mkdirSync(publicDir);
    for (let index=0;index<brief.seats;index+=modes.length) {
      for (const mode of shuffled(modes)) {
        const seat = randomUUID(), file = seat+'.html';
        seats.push({seat,mode,file:'reviewers/'+file});
        const publicQuestions = Object.fromEntries(aspects.map(aspect=>{
          const {prompt,prompts,options,low,high} = brief.questions[aspect];
          return [aspect,{prompt:prompts?.[mode]??prompt,...(options
            ? {options:shuffled(options).map(({id,label},i)=>({code:i+1,label,id}))}
            : {low,high})}];
        }));
        // Ballots use seat-local choice codes. Stable IDs and the scoring rubric stay in the key.
        const choices = Object.fromEntries(['action','cause'].map(aspect=>{
          const rows = publicQuestions[aspect].options;
          publicQuestions[aspect].options = rows.map(({code,label})=>({code,label}));
          return [aspect,rows.map(({id})=>id)];
        }));
        seats.at(-1).choices = choices;
        const player = page('participant',{version:1,format:ballotFormat,session,seat,questions:publicQuestions,
          kind:mode==='sound'?'audio':'video',excerpt:media[mode],seconds:window.seconds});
        fs.writeFileSync(path.join(publicDir,file),player);
      }
    }
    const key = {format:keyFormat,version:1,id:brief.id,title:brief.title,session,window,questions:brief.questions,seats};
    fs.writeFileSync(path.join(stage,'review-key.json'),JSON.stringify(key,null,2)+'\n',{mode:0o600});
    return {key:'review-key.json',reviewers:seats.map(({file})=>file),window};
  });
}

function validateKey(key) {
  check(key?.format===keyFormat&&key.version===1&&id(key.id)&&text(key.title,100)&&token(key.session)&&
    Array.isArray(key.seats)&&integer(key.seats.length,3,30)&&key.seats.length%3===0,'Open a private blind audiovisual review key');
  questions(key.questions);
  const all = new Map(), size = key.seats.length/modes.length;
  for (const row of key.seats) {
    check(record(row)&&token(row.seat)&&!all.has(row.seat)&&modes.includes(row.mode)&&fields(row.choices,['action','cause']),
      'Invalid seat assignment in the review key');
    for (const aspect of ['action','cause']) {
      const ids = key.questions[aspect].options.map(option=>option.id), order = row.choices[aspect];
      check(Array.isArray(order)&&order.length===ids.length&&new Set(order).size===ids.length&&
        ids.every(value=>order.includes(value)),'Invalid option mapping in the review key');
    }
    all.set(row.seat,row);
  }
  check(modes.every(mode=>key.seats.filter(row=>row.mode===mode).length===size),'Review key seats are unbalanced');
  return all;
}

function normalizeBallot(key, assignments, ballot) {
  check(fields(ballot,['format','version','session','seat','completions','answers'])&&ballot.format===ballotFormat&&
    ballot.version===1&&ballot.session===key.session&&assignments.has(ballot.seat)&&
    integer(ballot.completions,1,10000)&&fields(ballot.answers,aspects),'Ballot does not belong to this review or is incomplete');
  const {mode,choices} = assignments.get(ballot.seat), {action,cause,impact} = ballot.answers;
  check(integer(action,1,choices.action.length)&&integer(cause,1,choices.cause.length)&&
    (impact===null||integer(impact,1,5)),'Ballot contains an out-of-range answer');
  return {seat:ballot.seat,mode,completions:ballot.completions,
    answers:{action:choices.action[action-1],cause:choices.cause[cause-1],impact}};
}

function summarize(key, ballots) {
  const assignments = validateKey(key), seen = new Set();
  const responses = ballots.map(ballot=>{
    const response = normalizeBallot(key,assignments,ballot);
    check(!seen.has(response.seat),'There is more than one ballot for seat '+response.seat);
    seen.add(response.seat);
    return response;
  });
  const cohorts = modes.map(mode=>{
    const rows = responses.filter(row=>row.mode===mode), n = rows.length;
    const metrics = {};
    for (const aspect of ['action','cause']) {
      const {correct,options} = key.questions[aspect];
      const counts = options.map(({id,label})=>({id,label,count:rows.filter(row=>row.answers[aspect]===id).length}));
      const hits = counts.find(row=>row.id===correct).count;
      metrics[aspect] = {correct:hits,fraction:n?hits/n:null,choices:counts};
    }
    const values = rows.map(row=>row.answers.impact).filter(value=>value!==null).sort((a,b)=>a-b);
    const middle = Math.floor(values.length/2);
    const median = values.length?(values[middle]+values[Math.floor((values.length-1)/2)])/2:null;
    metrics.impact = {rated:values.length,unrated:n-values.length,median,
      ratings:[1,2,3,4,5].map(value=>({value,count:values.filter(rating=>rating===value).length}))};
    return {mode,assigned:key.seats.length/modes.length,received:n,
      replayed:rows.filter(row=>row.completions>1).length,...metrics};
  });
  const combined = cohorts[2];
  const differences = cohorts.slice(0,2).map(row=>{
    function difference(a,b) { return a===null||b===null?null:a-b; }
    return {against:row.mode,action:difference(combined.action.fraction,row.action.fraction),
      cause:difference(combined.cause.fraction,row.cause.fraction),
      impact:difference(combined.impact.median,row.impact.median)};
  });
  return {format:reportFormat,version:1,id:key.id,title:key.title,session:key.session,window:key.window,
    questions:key.questions,assigned:key.seats.length,received:responses.length,cohorts,differences};
}

function score(keyFile, ballotsDirectory, out) {
  const key = read(keyFile), files = fs.readdirSync(ballotsDirectory,{withFileTypes:true})
    .filter(entry=>entry.isFile()&&entry.name.endsWith('.json')).map(entry=>entry.name).sort();
  check(files.length<=30,'Review has more than 30 ballot files');
  const ballots = files.map(file=>{
    const source = path.join(ballotsDirectory,file);
    check(fs.statSync(source).size<=16384,'Ballot file exceeds 16 KiB: '+file);
    return read(source);
  });
  const report = summarize(key,ballots);
  return newDirectory(out,stage=>{
    write(path.join(stage,'report.json'),report);
    fs.writeFileSync(path.join(stage,'index.html'),page('results',{report}));
    return {report:'report.json',review:'index.html',received:report.received,assigned:report.assigned};
  });
}

function command([mode,file,ballots,...rest], opt, {kit}) {
  const scoring = mode==='blind-review-score', usage = scoring?scoreUsage:buildUsage;
  check(typeof file==='string'&&!rest.length&&(scoring?typeof ballots==='string':ballots===undefined)&&text(opt.out,4096)&&
    Object.entries(opt).every(([key,value])=>['out',...(scoring?[]:['ffmpeg'])].includes(key)&&text(value,4096)),
  'Use '+usage);
  const result = scoring?score(file,ballots,opt.out):build(file,opt.out,kit,opt.ffmpeg??'ffmpeg');
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}

module.exports = {command,build,score,summarize,page,ballotFormat};
