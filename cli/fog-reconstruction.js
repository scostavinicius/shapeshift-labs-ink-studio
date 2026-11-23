function surfaceGuide(width, height, depth, owners, fogScales, tolerance) {
  const boundaries = new Uint8Array(depth.length);
  const depthDelta = (a,b) => depth[a] === depth[b] ? 0 : Math.abs(depth[a] - depth[b]);
  const compatible = (a,b) => owners?.[a] === owners?.[b] &&
    fogScales?.[a] === fogScales?.[b] && depthDelta(a,b) <= tolerance;

  for (let y=0,p=0;y<height;y++) for (let x=0;x<width;x++,p++) {
    if (x && !compatible(p,p-1)) boundaries[p] = boundaries[p-1] = 1;
    if (y && !compatible(p,p-width)) boundaries[p] = boundaries[p-width] = 1;
  }

  function connected(source, target) {
    let pixel = source, x = source%width, y = Math.floor(source/width);
    const tx = target%width, ty = Math.floor(target/width);
    const dx = Math.abs(tx-x), dy = Math.abs(ty-y), sx = x<tx ? 1 : -1, sy = y<ty ? 1 : -1;
    let error = dx-dy;
    while (pixel!==target) {
      const twice = 2*error;
      if (twice > -dy) {
        error -= dy;
        x += sx;
        pixel += sx;
        if (!compatible(source,pixel)) return false;
      }
      if (twice < dx) {
        error += dx;
        y += sy;
        pixel += sy*width;
        if (!compatible(source,pixel)) return false;
      }
    }
    return true;
  }
  return { owners, boundaries, connected };
}

module.exports = { surfaceGuide };
