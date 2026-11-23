const test=require('node:test'),assert=require('node:assert/strict');
const {KIT:K}=require('..').load(),{musicInstruments:I}=K.procedural;
const env={attack:.001,decay:.04,sustain:1,release:.1};
const base={type:'subtractive',saw:1,pulse:0,sub:0,env,filter:{bypass:true}};
const note=(frequency,play={})=>({frequency,midi:69,velocity:1,play,salt:81,roundRobin:0});
function render(patch,frequency,rate,seconds,gate=seconds,play={},fromFrequency) {
  const voice=I.compile(patch).prepare({...note(frequency,play),fromFrequency},rate,gate);
  const value=Float64Array.from({length:Math.round(rate*seconds)},(_,i)=>voice.signal(i/rate,i));
  assert(value.every(x=>Number.isFinite(x) && Math.abs(x)<=1));
  return value;
}
function amp(samples,rate,hz,start,end) {
  const a=Math.round(start*rate), b=Math.round(end*rate);
  const turn=2*Math.PI*hz/rate;
  let re=0,im=0,w=0;
  for (let i=a;i<b;i++) {
    const weight=.5-.5*Math.cos(2*Math.PI*(i-a)/(b-a));
    const sample=weight*samples[i];
    re+=sample*Math.cos(turn*i);
    im+=sample*Math.sin(turn*i);
    w+=weight;
  }
  return 2*Math.hypot(re,im)/w;
}

test('band-limited saw and pulse keep their harmonics below Nyquist',()=>{
  const rate=8000,f=3125;
  const aliases=[1750,1375,1000,2500];
  for (const patch of [base,{...base,pulse:1,saw:0,pulseWidth:.35}]) {
    const samples=render(patch,f,rate,1);
    const fundamental=amp(samples,rate,f,.1,.9);
    assert(fundamental>.25);
    for (const alias of aliases) assert(amp(samples,rate,alias,.1,.9)<fundamental*.00025);
  }
  const audible=render(base,4700,rate,.3);
  assert(audible.every(x=>x===0));
  const glide=render(base,1500,rate,.6,.6,{glide:.3},4700);
  assert(amp(glide,rate,1500,.36,.56)>.25);
  assert(glide.slice(0,120).every(x=>x===0));
});

test('saw, even-harmonic PWM sidebands, and the octave-down sub have distinct spectra',()=>{
  const rate=16000, f=250;
  const saw=render(base,f,rate,2);
  const pulse={...base,saw:0,pulse:1,pulseWidth:.5};
  const fixed=render(pulse,f,rate,2), moving=render({...pulse,pwm:{depth:.22,rate:2}},f,rate,2);
  const sub=render({...base,saw:0,sub:.8},f,rate,2);
  const power=(samples,hz)=>amp(samples,rate,hz,.5,1.5);
  assert(power(saw,2*f)>power(saw,f)*.38);
  assert(power(fixed,2*f)<power(fixed,f)*.001);
  assert(power(moving,2*f+2)>.07 && power(fixed,2*f+2)<.0001);
  assert(power(sub,f/2)>.55 && power(sub,f)<.0001);
});

test('filter ADSR sweeps the harmonic balance and key follow preserves it up the keyboard',()=>{
  const rate=16000, frequency=200;
  const swept={...base,filter:{cutoff:210,resonance:1.2,envAmount:48,keyTrack:0,velocity:0,
    env:{attack:.20,decay:.43,sustain:.09,release:.19}}};
  const samples=render(swept,frequency,rate,1.45,1.3);
  const bright=(s,f,a,b)=>amp(s,rate,3*f,a,b)/amp(s,rate,f,a,b);
  assert(bright(samples,frequency,.18,.25)>bright(samples,frequency,.72,1.12)*3);
  const release=render(swept,frequency,rate,1.6,1.3);
  assert(release.slice(Math.ceil(1.4*rate)+1).every(x=>x===0));
  const low=I.hz(48), high=I.hz(72);
  const fixed={cutoff:700,resonance:.8,envAmount:0,velocity:0};
  const played=(f,keyTrack)=>bright(render({...base,filter:{...fixed,keyTrack}},f,rate,1),f,.22,.78);
  const lowTracked=played(low,1), highTracked=played(high,1);
  assert(Math.abs(lowTracked-highTracked)<.06);
  assert(highTracked>played(high,0)*1.8);
  const q=render({...base,filter:{...fixed,keyTrack:0,cutoff:600,resonance:7}},200,rate,1);
  const broad=render({...base,filter:{...fixed,keyTrack:0,cutoff:600,resonance:.7}},200,rate,1);
  assert(amp(q,rate,600,.2,.8)>amp(broad,rate,600,.2,.8)*3);
  render({...base,filter:{cutoff:24,resonance:12,envAmount:84,keyTrack:2,env:{attack:.001,decay:.002,sustain:0,release:.006}}},
    750,8000,.12,.075,{glide:.036,vibrato:60},110);
});

test('articulations inherit oscillator and filter settings and production trims retain the voice history',()=>{
  const override={env:{release:.24},pwm:{rate:1.8},filter:{resonance:2.2,env:{decay:.62}}};
  const synth={type:'subtractive',saw:.3,pulse:.7,sub:.16,pulseWidth:.5,pwm:{depth:.13,rate:.55},
    env:{attack:.025,decay:.42,sustain:.7,release:.12},
    filter:{cutoff:380,envAmount:29,keyTrack:1,env:{attack:.09,decay:.32,sustain:.4}}};
  const merged={...synth,env:{...synth.env,...override.env},pwm:{...synth.pwm,...override.pwm},
    filter:{...synth.filter,...override.filter,env:{...synth.filter.env,...override.filter.env}}};
  const a=render({...synth,articulations:{open:override}},220,8000,1,.7,{articulation:'open'});
  const b=render(merged,220,8000,1,.7);
  assert.deepEqual(a,b);
  assert.throws(()=>I.compile({...synth,pulseWidth:.14,pwm:{depth:.23}}),/duty/);
  assert.throws(()=>I.compile({...synth,filter:{resonance:99}}),/resonance/);
  const production={arrangement:{score:{key:{root:'C4'},tempoMap:{tempo:120},harmonies:{c:{root:'C4',quality:'unison'}}},
    motifs:{call:{length:4,events:[{beat:0,duration:1.8,midi:48},{beat:2,duration:1.65,midi:60,
      play:{articulation:'open',glide:.1,vibrato:24}}]}},
    parts:{lead:{role:'lead',material:'call'}},sections:[{id:'cue',bars:1,harmony:'c'}]},
    patches:{voice:{...synth,articulations:{open:override}}},tracks:{lead:{patch:'voice',gain:-7,send:.14}}};
  const options={sampleRate:8000,stems:true};
  const output=K.music.production.render(production,{},options);
  const crop=K.music.production.render(production,{}, {...options,start:.75});
  assert.deepEqual(crop.value.samples,output.value.samples.slice(12000));
  assert.deepEqual(crop.stems.lead.samples,output.stems.lead.samples.slice(12000));
  assert(output.stems.lead.samples.some(x=>Math.abs(x)>.02));
});
