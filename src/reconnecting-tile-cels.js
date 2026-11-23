/* Each grid has its own painted seams, split arcs, and reconnecting poses. */
const ReconnectingTileCels = (() => {
  const palette=['#273449','#36495e','#647885','#428ee0','#94d6f4'];
  const mats = {
    8: [
      ['...12...','...122..','....122.','21...122','221...12','.221....','..221...','...21...'],
      ['...34...','...34...','......4.','43....34','34....43','.4......','...43...','...43...'],
      ['...43...','....4...','..3...4.','34....43','43....34','.4...3..','...4....','...34...']
    ],
    12: [
      ['.....12.....','.....12.....','.....122....','......122...','.......122..','21......1222',
        '2221......12','..221.......','...221......','....221.....','.....21.....','.....21.....'],
      ['.....34.....','.....34.....','......4.....','.........3..','..........4.','43........34',
        '34........43','.4..........','..3.........','.....4......','.....43.....','.....43.....'],
      ['.....43.....','.....43.....','....4.......','...3......4.','..43......3.','34........43',
        '43........34','.3......34..','.4......3...','.......4....','.....34.....','.....34.....']
    ]
  };
  const turn = rows => rows.map((row,y)=>Array.from(row,(_,x)=>rows[rows.length-1-x][y]).join(''));
  const glow = (rows,tip) => rows.map(row=>row.replace(/[12]/g,slot=>slot==='1'?'3':tip));
  return Object.fromEntries(Object.entries(mats).flatMap(([n,[a,part,spin]])=>{
    const b=turn(a), cross=[glow(a,'4'),part,spin,glow(b,'4')];
    const specs={a:[a],b:[b],'a-b':cross,'b-a':cross.map(turn)};
    return Object.entries(specs).map(([key,poses])=>{
      const frames=poses.map((rows,i)=>({rows,duration:poses.length===1 ? .12 : [.09,.13,.14,.12][i]}));
      return ['tile-reconnect-'+n+'-'+key,
        ['Paired arcs '+n+' × '+n+' · '+key.toUpperCase(),'tile-reconnect',
          {width:Number(n),height:Number(n),palette,frames,playback:'once',origin:'top-left'}]];
    });
  }));
})();
if (typeof module !== 'undefined') module.exports = ReconnectingTileCels;
