/* The lantern workshop with independent pool and copper reflection profiles. */
module.exports = kit => {
  const workshop = require('./local-reflection-workshop.js')(kit);
  return {
    ...workshop,
    id:'reflection-detail',
    name:'Lantern in the rain',
    build(seed) {
      const world=workshop.build(seed), rings=kit.KIT.ripple.field({
        scale:.52, amplitude:.22, width:.44, speed:.85, damping:.28
      });
      world.pal=[...world.pal,0x443739,0x62493f,0x866552];
      rings.add({at:[.47,.122,.55],start:0,strength:1,repeat:1.8});
      rings.add({at:[-.43,.122,1.15],start:.19,strength:.75,repeat:2.1});
      world.surfaces=world.surfaces.map(row=>{
        const {settings}=row, {layers}=settings;
        if (layers?.mirror?.plane==='basin')
          return {...row,settings:{...settings,normal:rings.normal,layers:{...layers,mirror:{
            ...layers.mirror,distortion:13,
            detail:{core:.70,stretch:[4.5,.40],direction:'ripple',distance:[9.2,13.0],cluster:3}
          }}}};
        if (layers?.local?.probe==='fixture')
          return {...row,settings:{...settings,layers:{...layers,local:{
            ...layers.local,detail:{core:.34,stretch:[6,.65],direction:'surface',rotation:.15,distance:[10,15],cluster:3}
          }}}};
        return row;
      });
      return world;
    }
  };
};
