/* Load bounded Standard MIDI Files for the music and simulation importers. */
const fs=require('node:fs');
const {midiFiles:{decode,maxBytes}}=require('../src/kit/pui8-midi-file.js');

function read(file,options){
  if(fs.statSync(file).size>maxBytes)throw new RangeError('MIDI file exceeds its byte budget');
  return decode(fs.readFileSync(file),options);
}
module.exports={decode,read};
