const fs = require('node:fs');
const path = require('node:path');
const { KIT: { world } } = require('..').load();

const command = (tick, action, args) => ({ tick, action, args });
const intake = { min:[-4,.79,0], max:[-.65,2,1] };
const heater = { min:[1.9,0], max:[2.9,1] };
const brace = [3.12,.73,-.16];
const recipe = {
  run:'tide-gate', seed:42,
  rules:{
    tide:{
      on:{ kind:'chamber-wet', system:'flood', where:{ path:['chamber'], value:'quay' } },
      pattern:'tide-line', select:{ object:'wash-wall' }, point:[-2.38,0,-.047],
      bindings:{ '/point/1':'/level' }, length:3.31, width:.19,
      spacing:.028, color:[22,23,23,24]
    },
    scuff:{
      on:{ kind:'material-sound', system:'contacts', where:{ path:['interaction'], value:'impact' } },
      pattern:'scuff', select:{ object:'quay' }, point:[0,0,0],
      bindings:{ '/point':'/at' }, heading:[1,0,-.84], length:1.03, width:.34,
      spacing:.026, color:[8,9,10,12]
    },
    soot:{
      on:{ kind:'heat-applied', system:'heater', where:{ path:['energy'], op:'gt', value:100 } },
      pattern:'soot', select:{ object:'covered-wall' }, point:[0,1.57,-.046],
      bindings:{ '/point/0':'/bounds/min/0' }, heading:[-.23,1,0], length:1.40, width:.83,
      spacing:.026, color:[1,1,2,8]
    },
    plaster:{
      on:{ kind:'body-repaired', system:'rig', where:{ path:['body'], value:'brace' } },
      pattern:'repair', select:{ object:'covered-wall' }, point:[0,0,0],
      bindings:{ '/point':'/at' }, length:.86, width:.51, reach:.20,
      spacing:.025, color:[5,6,6,7,7]
    }
  }
};

function simulate() {
  const run = world.runtime.create({
    id:'tide-gate', dt:.1, history:{limit:1},
    systems:{
      flood:{kind:'enclosed-water', config:{
        chambers:{ quay:{bounds:intake},
          cistern:{bounds:{min:[-4,2.1,0],max:[-.65,3.1,1]},initial:2.7} },
        openings:{sluice:{from:'cistern',to:'quay',sill:2.1,fromSill:2.1,fromCrown:2.7,
          toSill:.79,toCrown:1.9,maxFlow:2.5,conductance:3,opening:0}},
        vents:{air:{chamber:'quay'}}
      }},
      contacts:{kind:'contact-effects',config:{channels:['additional'],fallback:{sound:{interval:0}}}},
      heater:{kind:'water',config:{origin:[1.9,0],width:1,height:1,cell:1,thermal:{ambientTemperature:22}}},
      rig:{kind:'mechanics',config:{bodies:{brace:{fixed:true,position:brace,half:[.5,.12,.12],
        structure:{axis:0,sections:2,fatigue:{endurance:2,life:25,exponent:2}}}}}},
      stock:{kind:'logistics',config:{
        resources:{mortar:{type:'integer',units:'piece'}},
        containers:{yard:{stocks:{mortar:{initial:1,max:1}}}},
        recipes:{repair:{duration:.6,inputs:{mortar:1}}},
        processes:{plaster:{recipe:'repair',inputs:{mortar:'yard'},
          work:{at:[3.12,0,-.16],radius:.6,batches:1,effect:{action:'rig/repair',args:{body:'brace'}}}}}
      }},
      crew:{kind:'agents',config:{
        bounds:{min:[-4,-1,-1],max:[5,2,3]},
        species:{hand:{mode:'walk',speed:2,radius:.13}},
        agents:{mason:{species:'hand',position:[3.12,0,-.16]}},
        orders:{tasks:{mend:{steps:[{op:'work',site:'stock/plaster'}]}}}
      }}
    },
    commands:[
      command(8,'world/input',{port:'flood/opening.sluice',value:1}),
      command(21,'contacts/impact',{point:[-1.348,.094,1.1615],normal:[0,1,0],load:16,speed:3,cue:'gate/iron'}),
      command(34,'heater/heat',{bounds:heater,energy:145}),
      command(40,'crew/issue-order',{agent:'mason',order:{task:'mend'}})
    ]
  });
  run.advance(60);
  return run;
}

if (require.main === module) {
  const dir = path.resolve(process.argv[2] ?? 'studio/event-surface-marks');
  fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'run.json'),JSON.stringify(simulate().recording(),null,2)+'\n');
  fs.writeFileSync(path.join(dir,'recipe.json'),JSON.stringify(recipe,null,2)+'\n');
}
module.exports = { simulate, recipe };
