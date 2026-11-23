/* Original frost cels facing east, with the receiving side below the edge. */
const BoundaryCelPresets = (() => {
  const palette=['#376969','#67aeae','#a4d8d1','#e3f1da'];
  const sizes={
    chip:{
      straight:['...','232','.1.'],
      inside:['...','31.','231'],
      outside:['...','.32','.21'],
      taper:['...','..3','.12'],
      gap:['...','..2','..1']
    },
    hook:{
      straight:['.....','.....','12332','.211.','..0..'],
      inside:['.....','1....','31232','2331.','.10..'],
      outside:['.....','.....','..332','..21.','..1..'],
      taper:['.....','.....','..123','...21','....0'],
      gap:['.....','.....','...23','...1.','....0']
    },
    drift:{
      straight:['.......','.......','.......','1233321','.22211.','..101..','....0..'],
      inside:['.......','2......','32.....','2312332','133211.','.2110..','...0...'],
      outside:['.......','.......','.......','...3332','...221.','...21..','...1...'],
      taper:['.......','.......','.......','...1132','....221','.....10','.......'],
      gap:['.......','.......','.......','.....23','....21.','.....1.','.......']
    }
  };
  return Object.freeze(Object.fromEntries(Object.entries(sizes).flatMap(([size,cels])=>
    Object.entries(cels).map(([kind,rows])=>['boundary-frost-'+size+'-'+kind,
      ['Frost boundary · '+size+' · '+kind,'boundary-frost',{width:rows[0].length,height:rows.length,palette,frames:[{rows,duration:1/12}]}]]))));
})();
if (typeof module !== 'undefined') module.exports = BoundaryCelPresets;
