/* A lantern signal on the old bridge, with held and lost edges at native art size. */
module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'edge-hierarchy',
  name: 'The last signal',
  seed: 28,
  build(seed) {
    const B = makeBuilder(seed, [
      0x171b2a, 0x222737, 0x2b3144, 0x373e52, 0x464c63, 0x565d73, 0x6e7288, 0x8a8497,
      0xa69bab, 0xbca8aa, 0xdcbbb0, 0xf1cdb0,
      0x202030, 0x2a2639, 0x3d2c42, 0x593952, 0x75455c, 0x945664, 0xb97578,
      0x634657, 0x84576a, 0xa9747d, 0xcc9488, 0xe8ad8f, 0xf4c49a,
      0x433847, 0x624b50, 0x896853, 0xb98a63, 0xe2a86e, 0xfac887, 0xffeca9
    ]);
    const S = K.sculpt(makeSculpt(B));
    Object.assign(S, { amb: .38, sky: .16, sunK: .48, sun: K.V.norm([-.37, .74, .52]), wob: .005 });
    const stone = { r: [1, 2, 3, 4, 5], materialId: 'masonry' };
    const shade = { r: [0, 1, 2, 3], materialId: 'masonry' };
    const remote = { r: [4, 5, 6, 7, 8], materialId: 'distant-masonry' };
    const darkCloth = { r: [12, 13, 14, 15, 16], materialId: 'cloak' };
    const hood = { r: [13, 14, 15, 16, 17], materialId: 'cloak' };
    const skin = { r: [19, 20, 21, 22, 23, 24], materialId: 'skin' };
    const trim = { r: [14, 15, 16, 17, 18], materialId: 'weave' };
    const leather = { r: [0, 12, 13, 25, 26], materialId: 'leather' };
    const brass = { r: [25, 26, 27, 28, 29], materialId: 'brass' };
    const lamp = { r: [29, 30, 31], em: true, materialId: 'flame' };
    const box = (at, half, mat, options) => S.box(at, half, mat, { rd: .025, ...options });
    const tube = (points, width, mat, options) => S.tube(points, width, width, mat, options);
    function arch(x, y, z, span, height, mat, options) {
      const width = span * .19, depth = span * .25;
      for (const sign of [-1, 1]) {
        box([x + sign * span, y + height / 2, z], [width, height / 2 + .02, depth], mat, options);
        box([x + sign * span, y + .1, z], [1.2 * width, .16, 1.11 * depth], mat, options);
      }
      for (let i = 0; i <= 12; i++) {
        const a = i * Math.PI / 12, u = Math.cos(a), v = Math.sin(a);
        box([x + u * span, y + height + v * span, z], [width, span * .155, depth], mat,
          { ...options, ax: [[u,v,0],[-v,u,0],[0,0,1]], rd: width * .16 });
      }
    }

    for (const [x,y,z,half] of [
      [-5.3,-.96,-10.0,[3.6,1.36,3.4]], [2.8,-1.1,-13.1,[4.5,1.63,3.5]], [6.3,-1.37,-17.5,[3.8,2.2,3.4]]
    ]) S.rock([x,y,z],half,remote,{ res:.23, objectId:'headlands', target:{ tags:['distance'] } });
    for (const [x,z,span,height] of [[.95,-7.25,.93,1.3],[2.8,-7.25,.93,1.3],[4.9,-14.5,1.09,1.63],[7.1,-14.5,1.09,1.63]])
      arch(x,.16,z,span,height,remote,{ res:.10, objectId:'far-aqueduct', target:{ tags:['distance'] } });
    S.bake();

    box([-1.9,-.28,.45],[6.6,.28,2.8],shade,{ res:.125, objectId:'bridge' });
    for (let j = 0; j < 4; j++) for (let i = 0; i < 15; i++) {
      const x = (i - 7.6) * .61 + .28 * (j % 2), z = 1.72 - j * .61;
      box([x,-.024+.009*Math.cos(2*i+j),z],[.294,.037,.295],(i+3*j)%6?stone:shade,{ res:.087, objectId:'paving' });
    }
    arch(-3.42,.02,-2.25,1.14,1.83,shade,{ res:.077, objectId:'near-arch' });
    box([-2.33,1.0,-2.24],[.21,.93,.27],shade,{ res:.077, objectId:'near-arch' });
    for (let i = 0; i < 11; i++)
      box([-6 + .72 * i,.18,-1.36],[.346,.19,.16],shade,{ res:.085, objectId:'parapet' });
    for (const x of [-4.95, -3.8, -.08, 1.36, 2.63, 4.1]) {
      box([x,.44,-1.28],[.147,.44,.16],stone,{ res:.09, objectId:'parapet' });
      box([x,.885,-1.26],[.201,.06,.21],stone,{ res:.066, objectId:'parapet' });
    }
    S.bake();

    const x = -2.09, z = .37;
    const actor = { res:.036, objectId:'courier' };
    const face = { ...actor, res:.027, surfaceId:'courier-face' };
    const hand = { ...actor, res:.019, surfaceId:'courier-hand' };
    for (const side of [-1, 1]) {
      tube([[x+.16*side,.81,z],[x+.23*side,.53,z],[x+.24*side,.16,z+.074]],.106,leather,actor);
      S.ball([x+.245*side,.113,z+.151],[.13,.095,.20],leather,actor);
    }
    S.lathe([x,.41,z],1.05,t => .28+.13*(1-t)**1.55,darkCloth,{...actor,maxRadius:.43});
    S.ball([x-.035,1.26,z],[.34,.26,.235],hood,actor);
    tube([[x-.24,1.24,z],[x-.43,.92,z+.08],[x-.40,.66,z+.10]],.108,darkCloth,actor);
    tube([[x+.202,1.25,z],[x+.383,1.18,z+.159],[x+.549,1.40,z+.244]],.099,hood,actor);
    S.ball([x+.590,1.43,z+.268],[.096,.077,.074],skin,hand);
    S.ball([x+.643,1.45,z+.307],[.068,.042,.066],skin,hand);
    S.ball([x-.03,1.713,z],[.325,.34,.269],hood,actor);
    S.ball([x+.075,1.705,z+.226],[.218,.235,.133],skin,face);
    S.ball([x+.219,1.666,z+.320],[.076,.065,.067],skin,face);
    box([x+.145,1.759,z+.353],[.041,.012,.013],leather,{...actor,res:.017,rd:.008});
    tube([[x-.258,1.43,z+.062],[x-.105,1.345,z+.225],[x+.204,1.393,z+.232]],.073,trim,actor);
    tube([[x-.18,1.38,z+.157],[x-.39,1.31,z+.106],[x-.552,1.08,z-.018]],.054,trim,actor);
    box([x+.04,1.063,z+.241],[.056,.045,.020],brass,{...actor,res:.027,rd:.012});
    S.bake();

    const lantern = { res:.024, objectId:'signal-lantern' }, lx = x + .79, lz = z + .323;
    S.lathe([lx,1.045,lz],.045,[.128,.109],brass,lantern);
    S.ball([lx,1.199,lz],[.088,.123,.084],lamp,lantern);
    S.lathe([lx,1.310,lz],.062,[.13,.091],brass,lantern);
    tube([[lx-.092,1.346,lz],[lx-.089,1.438,lz],[lx+.031,1.443,lz],[lx+.085,1.354,lz]],.018,brass,lantern);
    for (const i of [-1, 1]) tube([[lx+.108*i,1.077,lz],[lx+.100*i,1.338,lz]],.015,brass,lantern);
    S.bake();

    const shadow = { lightness:[.24,.42], contrast:[.055,.24] };
    const haze = { strength:.82, contrast:[.06,.29], distance:{ near:10, far:18 } };
    const held = { lost:false, shadow:'#673e50', highlight:'#f4c49a' };
    return B.finish({
      cam:{ target:[-.25,1.19,-1.8], dist:7.05, pitch:.087, yaw:.041, sway:0 },
      radius:14, dither:0, detail:24,
      skyEnvironment:{ defaults:{ zenith:'#404962', horizon:'#c9a4a6', ground:'#746575', sunStrength:0 } },
      aerialPerspective:{ start:8, density:.055, contrast:.28 },
      look:{
        splatCoverage:'continuous',
        ink:{
          depthGap:.14, occlusionSilhouettes:true, creaseCosine:.56,
          silhouette:{ color:'#2b3144', strength:.85 }, boundary:{ color:'#373e52', strength:.65 },
          crease:{ steps:1, litSteps:0, strength:.53 },
          targets:[
            { select:{ object:'courier' }, silhouette:{ shadow:'#1a1829', highlight:'#714455', lost:shadow },
              boundary:{ color:'#523245', lost:shadow }, crease:false },
            { select:{ surface:'courier-face' }, silhouette:{ ...held, strength:1 }, boundary:{ ...held, strength:.85 } },
            { select:{ surface:'courier-hand' }, silhouette:{ ...held, strength:1 }, boundary:{ ...held, strength:.85 } },
            { select:{ tag:'distance' }, silhouette:{ color:'#50596e', lost:haze },
              boundary:{ color:'#565d73', lost:haze }, crease:{ lost:haze } }
          ]
        }
      }
    });
  }
});
