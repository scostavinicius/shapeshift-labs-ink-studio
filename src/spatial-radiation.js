/* Map absolute band pressures to shelves and a mid-band trim. */
const InkRadiation=(()=>{
  const crossovers=rate=>[Math.min(250,rate*.1),Math.min(3200,rate*.4)];
  function shelf(bands,gain){
    if(!gain)return {low:0,mid:1,high:0};
    const ratio=band=>Math.max(1e-6,bands[band]/gain);
    const mid=ratio('mid'), db=band=>20*Math.log10(ratio(band)/mid);
    return {low:db('low'),mid,high:db('high')};
  }
  return Object.freeze({crossovers,shelf});
})();
if (typeof module !== 'undefined') module.exports = InkRadiation;
else globalThis[Symbol.for('ink-studio.spatial-radiation')] = InkRadiation;
