/* Adapt native rig, scene-query and simulation samples to retained curve knots. */
const CurvePoseDrivers = (() => {
  const { V, M } = KIT;
  const vector = v => v?.length === 3 && Array.from(v).every(Number.isFinite);
  const integer = n => Number.isSafeInteger(n) && n >= 0;
  const name = s => typeof s === 'string' && s.length > 0;
  function need(ok, message) {
    if (!ok) throw new RangeError('Curve splat driver: ' + message);
  }
  function match(list, rest) {
    if (list.length === rest.points.length) return list;
    need(rest.autoClosed && list.length + 1 === rest.points.length, 'one binding is required per reference knot');
    return [...list, list[0]];
  }

  function bones(weights) {
    need(Array.isArray(weights) && weights.length >= 2, 'bone bindings need a list of influences');
    const joint = value => name(value) || integer(value);
    const influences = weights.map(value => {
      const { bone, second, weight = 0 } = joint(value) ? { bone: value } : value ?? {};
      need(joint(bone) && (second === undefined ? weight === 0 : joint(second)) &&
        Number.isFinite(weight) && weight >= 0 && weight <= 1, 'invalid bone influence or blend weight');
      return { bone, second, weight };
    });
    return (rest, { stage, world, bones: table = world?.anim?.bones } = {}) => {
      const rig = stage?.rig ?? world?.anim?.rig, matrices = new Map();
      function lookup(joint) {
        if (matrices.has(joint)) return matrices.get(joint);
        const useRig = typeof joint === 'string' || !table, data = useRig ? rig?.M : table;
        const index = typeof joint === 'string' ? rig?.names.indexOf(joint) : joint;
        need(data && integer(index) && (index + 1) * 12 <= data.length, 'unknown bone or part ' + joint);
        const matrix = Array.from(data.slice(index * 12, index * 12 + 12));
        need(matrix.every(Number.isFinite), 'bone matrix must be finite');
        matrices.set(joint, matrix);
        return matrix;
      }
      const poses = match(influences, rest).map(({ bone, second, weight }) => {
        const a = lookup(bone);
        if (!weight) return a;
        const b = lookup(second);
        return a.map((value, i) => value + (b[i] - value) * weight);
      });
      return {
        points: rest.points.map((p, i) => V.add(M.app(poses[i], p), poses[i].slice(9))),
        up: V.norm(M.app(poses[0], rest.up), rest.up),
        ...(rest.normals && { normals: rest.normals.map((n, i) => {
          const basis = poses[i].slice(0, 9);
          return V.norm(M.app(Math.abs(M.det(basis)) > 1e-8 ? M.tr(M.inv(basis)) : basis, n), n);
        }) })
      };
    };
  }

  function sockets(anchors) {
    need(Array.isArray(anchors) && anchors.length >= 2, 'socket bindings need a list of anchors');
    const targets = anchors.map(value => {
      if (vector(value)) return { point: Array.from(value) };
      const { socket, entity, offset = [0,0,0] } = name(value) ? { socket: value } : value ?? {};
      need(name(socket) && (entity === undefined || name(entity)) && vector(offset), 'invalid socket or local offset');
      return { socket, entity, offset: Array.from(offset) };
    });
    return (rest, { stage, query } = {}) => ({
      points: match(targets, rest).map(({ point, socket, entity, offset }) => {
        if (point) return point;
        if (entity) {
          const pose = query?.frame({ entity, socket });
          need(pose && vector(pose.point), 'unknown entity socket ' + entity + '/' + socket);
          return V.add(pose.point, pose.rotation ? M.app(pose.rotation, offset) : offset);
        }
        const anchor = stage?.sockets?.[socket], position = stage?.where?.(socket);
        need(anchor && vector(position), 'unknown stage socket ' + socket);
        return anchor.part && stage.rig?.has(anchor.part) ?
          stage.rig.at(anchor.part, V.add(anchor.p, offset)) : V.add(position, offset);
      })
    });
  }

  function xpbd(solver, indices, { links } = {}) {
    need(solver && Array.isArray(indices) && indices.length >= 2 && indices.every(integer), 'invalid XPBD point indices');
    need(links === undefined || Array.isArray(links) && links.every(value => value === null || integer(value)),
      'invalid XPBD link indices');
    const nodes = indices.slice(), guards = links?.slice();
    return (rest, context) => {
      const state = typeof solver === 'function' ? solver(context) : solver;
      const positions = state?.X ?? state?.positions, count = state?.n ?? positions?.length / 3;
      const ids = match(nodes, rest);
      need(positions && ids.every(i => i < count) && (!guards || guards.length === ids.length - 1),
        'XPBD pose does not contain the bound points and links');
      const read = i => typeof state.broken === 'function' ? state.broken(i) : state.broken?.[i];
      return { points: ids.map(i => Array.from(positions.slice(i * 3, i * 3 + 3))),
        ...(guards && { active: guards.map(i => i === null || !read(i)) }) };
    };
  }

  function chart(source) {
    return (rest, context) => {
      const carrier = typeof source === 'function' ? source(context) : source;
      const sample = carrier?.samplePointNormal ?? carrier?.sample;
      need(rest.uvs && typeof sample === 'function', 'a posed chart needs retained UVs and a sampler');
      const stations = rest.uvs.map(uv => sample.call(carrier, uv));
      const normals = stations.map(({ n }) => {
        need(vector(n) && V.len(n) > 1e-8, 'posed chart needs finite nonzero normals');
        return V.norm(n);
      });
      const points = stations.map(({ p }, i) => {
        need(vector(p), 'posed chart needs finite positions');
        return V.mad(p, normals[i], rest.offsets?.[i] ?? 0);
      });
      return { points, normals, ...(carrier.intact && { active: rest.uvs.slice(1).map((uv, i) =>
        carrier.intact(rest.uvs[i]) && carrier.intact(uv) && carrier.intact(uv.map((value, k) => (value + rest.uvs[i][k]) * .5))) }) };
    };
  }

  return Object.freeze({ bones, sockets, xpbd, chart });
})();
