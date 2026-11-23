const fs=require('node:fs');
const path=require('node:path');
const [directory,out]=process.argv.slice(2);
if(!directory||!out) throw new Error('Use node review.cjs <external compositor output directory> <review.html>');
const report=JSON.parse(fs.readFileSync(path.join(directory,'insertion-report.json'),'utf8'));
const images=Object.fromEntries(['source','front','between','behind'].map(id=>[
  id,'data:image/png;base64,'+fs.readFileSync(path.join(directory,id+'.png')).toString('base64')
]));
const template=fs.readFileSync(path.join(__dirname,'review.html'),'utf8');
fs.writeFileSync(out,template.replace('/*INK_DEEP_DEMO*/',()=>JSON.stringify({report,images}).replaceAll('<','\\u003c')));
