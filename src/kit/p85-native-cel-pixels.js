/* Whole-pixel cels tested against a world-space receiving plane. */
(function (K) {
  function plane(camera, w, h, origin, n) {
    const { view, eye, tangent, aspect, ortho, clipNear = .4, clipFar = 400 } = camera;
    const right = [view[0], view[4], view[8]], up = [view[1], view[5], view[9]], back = [view[2], view[6], view[10]];
    const nx = K.V.dot(right,n), ny = K.V.dot(up,n), nz = -K.V.dot(back,n);
    const distance = nx*origin[0] + ny*origin[1] + nz*origin[2];
    const inverseX = 2*tangent*aspect/w, inverseY = 2*tangent/h;
    const u = x => (x+.5-.5*w)*inverseX, v = y => (.5*h-y-.5)*inverseY;
    return {
      depthAt(x,y) {
        const lateral = u(x)*nx + v(y)*ny;
        const depth = ortho ? (distance-lateral)/nz : distance/(lateral+nz);
        return depth >= clipNear && depth <= clipFar ? depth : Infinity;
      },
      point(x,y,depth) {
        const scale = ortho ? 1 : depth, across = u(x)*scale, upScreen = v(y)*scale;
        return eye.map((a,i) => a + across*right[i] + upScreen*up[i] - depth*back[i]);
      }
    };
  }

  function pixels(rows, w, h, emit) {
    const winners = rows.length > 1 ? new Map() : null;
    for (const { left, top, depthAt, accepts, image } of rows) {
      const { width, height, rgba } = image;
      for (let y = Math.max(0, -top); y < Math.min(height, h - top); y++)
        for (let x = Math.max(0, -left); x < Math.min(width, w - left); x++) {
          const p = (y * width + x) * 4;
          if (!rgba[p + 3]) continue;
          const X = x + left, Y = y + top, depth = depthAt(X, Y);
          if (!Number.isFinite(depth) || accepts && !accepts(X,Y,depth)) continue;
          const rgb = [rgba[p], rgba[p + 1], rgba[p + 2]];
          if (!winners) emit(X, Y, depth, ...rgb);
          else {
            const index = Y * w + X, above = winners.get(index);
            if (!above || depth <= above[2]) winners.set(index, [X, Y, depth, ...rgb]);
          }
        }
    }
    if (winners) for (const pixel of winners.values()) emit(...pixel);
  }
  K.nativeCelPixels = Object.freeze({ plane, pixels });
})(KIT);
