const assert=require('node:assert/strict');
const {test}=require('node:test');
const ink=require('..');
const {KIT,makeBuilder}=ink.load();
const P=KIT.procedural, {focusTrack,mediaGraph:M}=P;
const rate=8000;
const track={
  id:'handoff',map:{tempo:120,swing:.6,changes:[{beat:2,tempo:60}]},
  subjects:{
    hand:{picture:{select:{object:'glove'},contrast:2.4,pivot:.33},mix:{room:-12}},
    latch:{picture:{select:{object:'bolt'},contrast:2,pivot:.27},mix:{room:-4,foley:6}}
  },
  cues:[{beat:.5,subject:'hand',fade:.5},{beat:2,subject:'latch',fade:.5},{beat:3,subject:null}]
};
const nearly=(actual,expected)=>assert(Math.abs(actual-expected)<1e-8,`${actual} vs ${expected}`);

test('focus cues share exact swung musical addresses, crossfade, and release',()=>{
  const plan=focusTrack.prepare(track);
  const at=time=>focusTrack.at(plan,time);
  assert.equal(at(.299).to,undefined);
  assert.equal(at(.3).to.id,'hand');
  assert.equal(at(.3).weight,0);
  nearly(at(.4).weight,.5);
  assert.equal(at(.5).weight,1);
  const state=at(1.3);
  assert.equal(state.from.id,'hand');
  assert.equal(state.to.id,'latch');
  nearly(state.weight,.5);
  const [hand,latch]=focusTrack.picture(state);
  nearly(hand.amount,.7);
  nearly(latch.amount,.5);
  assert.equal(at(2).to,undefined);
  assert.equal(focusTrack.picture(at(2)).length,0);
  assert.throws(()=>focusTrack.prepare({...track,cues:[{...track.cues[0],fade:2},track.cues[1]]}),/fades that finish/);
  assert.throws(()=>focusTrack.prepare({...track,cues:[{beat:1,subject:'misspelled'}]}),/known subject/);
});

test('post-insert focus rides the regular fader, leaves the pre-fader tap, and follows live seeks',()=>{
  const room={sampleRate:rate,channels:1,samples:Array(18000).fill(.2)};
  const mixer={id:'mixer',sampleRate:rate,end:{seconds:2.1},focusTrack:track,output:'master',
    strips:{master:{},room:{clips:[{id:'bed',source:'room'}],fader:.5},foley:{}},
    taps:{pre:{strip:'room',tap:'pre'},post:{strip:'room',tap:'post'}}};
  const render=P.mediaGraph.mixer.render(mixer,{room});
  const off=P.mediaGraph.mixer.render({...mixer,focusTrack:false},{room});
  const sample=(result,tap,i)=>result.taps[tap].samples[i*2];
  assert.deepEqual(render.taps.pre.samples,off.taps.pre.samples);
  for (const [i,db] of [[0,0],[2400,0],[3200,-6],[8000,-12],[10400,-8],[15999,-4],[16000,0]]) {
    nearly(sample(render,'post',i),sample(off,'post',i)*10**(db/20));
  }
  assert.throws(()=>P.mediaGraph.mixer.render({...mixer,strips:{master:{},room:{}}},{room}),/focus track: foley/);

  const {strips,taps}=mixer;
  const source={format:'ink-studio/music-edit-session',version:1,id:'focus-test',sampleRate:rate,
    production:{arrangement:{score:{key:{root:'C4'},tempoMap:{tempo:120},
      harmonies:{home:{root:'C3',quality:'unison'}}},motifs:{pulse:{length:1,events:[{beat:0,duration:.2,degree:1}]}},
      parts:{music:{role:'lead',material:'pulse'}},sections:[{id:'base',bars:2,harmony:'home'}]},
      patches:{keys:{type:'subtractive'}},tracks:{music:{patch:'keys',gain:-30}}},
    audio:{room:{take:'one',takes:{one:{asset:'room'}}}},
    mixer:{output:'master',strips:{...strips,room:{fader:.5}},taps,focusTrack:track}};
  const editor=M.musicSession.create({room});
  const live=editor.open(source,{from:{samples:10399},to:{samples:10402},preroll:false});
  const post=live.pull(7,{taps:true}).taps.post.samples;
  for (let i=0;i<7;i++) nearly(post[i*2],sample(render,'post',10399+i%3));
  live.setLoop({from:{samples:50},to:{samples:53}});
  nearly(live.pull(4,{taps:true}).taps.post.samples[0],.1);
});

test('sub-sample timing remains on the same side of a hard cue in picture and audio',()=>{
  const plan=focusTrack.prepare({id:'tiny',subjects:track.subjects,cues:[
    {beat:.00015,subject:'hand'},
    {beat:.0004,subject:'latch',fade:.0001},
    {beat:.0005,subject:null}
  ]});
  const lane=focusTrack.mixLane(plan,'room',rate);
  assert.deepEqual(lane.points,[{at:0,value:0},{at:1,value:-12},{at:2,value:0}]);
  const equalGains=focusTrack.prepare({
    id:'quiet',subjects:{a:{mix:{room:-60}},b:{mix:{room:-60}}},
    cues:[{beat:0,subject:'a',fade:.00037},{beat:.00037,subject:'b',fade:.0109},{beat:2,subject:null}]
  });
  assert.equal(focusTrack.mixLane(equalGains,'room',rate).points.find(row=>row.at===2).value,-60);
});

test('the normal native picture path grades the named subject with independent static protection',()=>{
  const B=makeBuilder(2,[0x294761,0xb89b59,0x6a9083]);
  for (const [i,x,object] of [[1,-1,'glove'],[2,1,'bolt']]) {
    const at=B.count();
    B.disc(x,0,0,[0,0,1],.36,.04,B.P[i],3);
    B.describeSplats(at,B.count(),{object});
  }
  const world=B.finish({cam:{target:[0,0,0],dist:6,yaw:0,pitch:0},radius:7,dither:0,
    look:{focusTrack:track,silhouetteProtection:{targets:[{select:{object:'glove'},contrast:1.2,pivot:.5}]}}});
  const settings={w:96,h:64,px:1,raw:true,passes:['objectId'],captureSilhouetteProtection:true};
  const rgb=(frame,p)=>Array.from(frame.rgb.subarray(p*3,p*3+3));
  for (const [time,active] of [[.2,null],[.6,'glove'],[1.7,'bolt'],[2.2,null]]) {
    const on=ink.render(world,{...settings,t:time}), off=ink.render(world,{...settings,t:time,focusTrack:false});
    assert.equal(on.focusTrack.subject,active==='glove' ? 'hand' : active==='bolt' ? 'latch' : null);
    assert.deepEqual(on.passes.objectId,off.passes.objectId);
    assert.deepEqual(on.silhouetteMask,off.silhouetteMask);
    let changed=0;
    for(let p=0;p<on.w*on.h;p++) {
      const name=on.passes.objects[on.passes.objectId[p]];
      if (name==='glove' || name==='bolt') {
        if (name===active) changed+=Number(rgb(on,p).some((value,i)=>value!==rgb(off,p)[i]));
        else assert.deepEqual(rgb(on,p),rgb(off,p));
      }
    }
    if (active) assert(changed>40);
    else assert.deepEqual(on.rgb,off.rgb);
  }
});
