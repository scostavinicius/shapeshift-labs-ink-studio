/* Conservative transport and phase reactions for the material-cell lattice. */
(function (K) {
  const W = K.world, { check, record } = W.data;
  const { freeze } = K.procedural.data;
  const finite = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
  const pair = (value, valid) => Array.isArray(value) && value.length === 2 && Array.from(value).every(valid);
  const keys = (value, allowed) => record(value) && Object.keys(value).every(key => allowed.includes(key));
  const channels = ['liquid', 'ice', 'heat'];

  function prepare(config, { size, cell, origin, profile, dt, ground, absoluteZero, maxTemperature }) {
    const [width, height] = [size[0], size[2]], count = width * height, firstId = size.reduce((a, b) => a * b);
    const { material, layer = 0, waterline = origin[1] + layer * cell, initial = [], closed = [],
      meltingPoint = 0, latentHeat, liquidCapacity = 3, leveling = 1, current = [0, 0],
      climate = [], depositSpread = 2, liquidColor = 0x55aeb8 } = config;
    const { mass, capacity } = profile;
    const latent = latentHeat * mass, latentDegrees = latent / capacity, fusion = meltingPoint - absoluteZero;
    const maxHeat = (liquidCapacity + 1) * (maxTemperature - absoluteZero);
    const grid = K.procedural.motion.gridDomain({ width, height, cell, origin: [origin[0], origin[2]] });
    const { center } = grid;
    const index = at => pair(at, Number.isSafeInteger) && at[0] >= 0 && at[0] < width && at[1] >= 0 && at[1] < height ?
      at[0] + at[1] * width : -1;
    const address = i => [i % width, Math.floor(i / width)];
    const lattice = i => [i % width, layer, Math.floor(i / width)];
    const cellY = origin[1] + layer * cell;
    check(keys(config, ['material', 'layer', 'waterline', 'initial', 'closed', 'meltingPoint', 'latentHeat',
      'liquidCapacity', 'leveling', 'current', 'climate', 'depositSpread', 'liquidColor']) &&
      Number.isSafeInteger(layer) && layer >= 0 && layer < size[1] && cellY >= ground - cell * 1e-7 &&
      finite(waterline, ground, origin[1] + cell * size[1]) &&
      finite(meltingPoint, absoluteZero + 1, maxTemperature - 1) &&
      finite(latentDegrees, 1e-6, 1e4) && finite(liquidCapacity, 1, 16) && finite(leveling, 0, 100) &&
      pair(current, v => finite(v, -100, 100)) && Number.isSafeInteger(depositSpread) &&
      depositSpread >= 0 && depositSpread <= 4 && Number.isSafeInteger(liquidColor) && finite(liquidColor, 0, 0xffffff),
    'Invalid material phase lattice, transport or thermodynamics');
    check(Array.isArray(closed) && closed.length < count && Array.from(closed).every(at => index(at) >= 0),
      'Material phase barriers need bounded XZ addresses');
    const blocked = new Set(closed.map(index)), sites = [], faces = [];
    for (let i = 0; i < count; i++) {
      if (blocked.has(i)) continue;
      sites.push(i);
      const [x, z] = address(i);
      if (x + 1 < width && !blocked.has(i + 1)) faces.push([i, i + 1, 0]);
      if (z + 1 < height && !blocked.has(i + width)) faces.push([i, i + width, 1]);
    }
    check(Array.isArray(climate) && climate.length <= 64 && Array.from(climate).every(zone =>
      keys(zone, ['min', 'max', 'temperature', 'rate']) &&
      pair(zone.min, Number.isFinite) && pair(zone.max, Number.isFinite) && zone.min.every((v, i) => v < zone.max[i]) &&
      finite(zone.temperature, absoluteZero, maxTemperature) && finite(zone.rate, 0, 100)),
    'Material phase climate needs bounded rectangles, temperatures and rates');
    const zoneAt = (x, z) => climate.findLast(zone =>
      x >= zone.min[0] && x < zone.max[0] && z >= zone.min[1] && z < zone.max[1]);
    const siteZones = sites.map(i => zoneAt(...center(i)));

    check(Array.isArray(initial) && initial.length <= count, 'Material phase initial field exceeds its grid');
    function buffers() {
      return Object.fromEntries(channels.map(name => [name, Array(count).fill(0)]));
    }
    const field = buffers(), occupied = new Set();
    for (const row of initial) {
      check(keys(row, ['at', 'liquid', 'ice', 'temperature']), 'Invalid initial material phase cell');
      const { at, liquid = 0, ice = 0, temperature = meltingPoint } = row, i = index(at);
      check(i >= 0 && !blocked.has(i) && !occupied.has(i) && finite(liquid, 0, liquidCapacity) &&
        finite(ice, 0, 1) && finite(temperature, absoluteZero, maxTemperature), 'Invalid initial material phase contents');
      occupied.add(i);
      field.liquid[i] = liquid;
      field.ice[i] = ice;
      field.heat[i] = (temperature - absoluteZero) * (liquid + ice);
    }
    const start = freeze({ ...field, nextId: firstId, exchange: 0 });

    const reactionDt = K.clamp(dt, 1e-5, 1);
    const thermalDifference = ({ liquid, ice, heat }) => fusion * (liquid + ice) - heat;
    const reactionRate = (fields, sign) => Math.min(1e8, Math.max(0, sign * thermalDifference(fields) / (latentDegrees * reactionDt)));
    const chemistry = K.procedural.motion.phaseChange({
      width, height, cell, origin: [origin[0], origin[2]], dt: reactionDt,
      mask: (_x, _z, i) => !blocked.has(i),
      channels: { liquid: { capacity: liquidCapacity }, ice: {}, heat: { capacity: maxHeat } },
      rules: [
        { id: 'freeze', consume: { liquid: 1 }, produce: { ice: 1, heat: latentDegrees },
          rate: ({ fields }) => reactionRate(fields, 1) },
        { id: 'melt', consume: { ice: 1, heat: latentDegrees }, produce: { liquid: 1 },
          rate: ({ fields }) => reactionRate(fields, -1) }
      ]
    });

    function readTotals({ liquid, ice, heat }) {
      let water = 0, frost = 0, sensible = 0;
      for (const i of sites) {
        water += liquid[i];
        frost += ice[i];
        sensible += heat[i];
      }
      return { liquidMass: water * mass, fieldIceMass: frost * mass,
        fieldSensibleEnergy: sensible * capacity, liquidLatentEnergy: water * latent };
    }

    function move(source, dt) {
      const next = Object.fromEntries(channels.map(name => [name, source[name].slice()]));
      if (!leveling && current.every(value => !value)) return next;
      const { liquid, ice, heat } = source, outgoing = new Float64Array(count), incoming = new Float64Array(count);
      const transfers = [];
      for (const [a, b, axis] of faces) {
        const drift = current[axis];
        const flow = dt * (leveling * (liquid[a] - liquid[b]) + drift * liquid[drift >= 0 ? a : b] / cell);
        if (!flow) continue;
        const [from, to] = flow > 0 ? [a, b] : [b, a], amount = Math.abs(flow);
        if (liquid[from] <= 0 || liquid[to] >= liquidCapacity) continue;
        outgoing[from] += amount;
        incoming[to] += amount;
        transfers.push({ from, to, amount });
      }
      // Limit all faces against step-start availability. Heat rides with the donor liquid.
      for (const { from, to, amount } of transfers) {
        const moved = amount * Math.min(1, liquid[from] / outgoing[from], (liquidCapacity - liquid[to]) / incoming[to]);
        const energy = moved * heat[from] / (liquid[from] + ice[from]);
        next.liquid[from] -= moved;
        next.liquid[to] += moved;
        next.heat[from] -= energy;
        next.heat[to] += energy;
      }
      return next;
    }

    const exchangeAt = (zone, temp, dt) => zone ? (zone.temperature - temp) * -Math.expm1(-zone.rate * dt) : 0;
    function advance(state, ctx) {
      const input = move(state, ctx.dt);
      let exchange = state.exchange;
      for (const [slot, i] of sites.entries()) {
        const amount = input.ice[i] + input.liquid[i];
        if (!amount) continue;
        const change = exchangeAt(siteZones[slot], absoluteZero + input.heat[i] / amount, ctx.dt) * amount;
        input.heat[i] += change;
        exchange += change * capacity;
      }
      // Face accumulation can differ from its analytic bound by a few ulps.
      for (const i of sites) {
        input.liquid[i] = K.clamp(input.liquid[i], 0, liquidCapacity);
        input.heat[i] = K.clamp(input.heat[i], 0, maxHeat);
        if (input.ice[i] + input.liquid[i] === 0) input.heat[i] = 0;
      }
      const result = chemistry.solve(input, { time: ctx.time - ctx.dt });
      return { ...Object.fromEntries(channels.map(name => [name, Array.from(result[name])])),
        nextId: state.nextId, exchange };
    }

    function extract(field, i) {
      const heat = field.heat[i] / (field.liquid[i] + field.ice[i]);
      field.ice[i] -= 1;
      field.heat[i] -= heat;
      check(field.nextId < Number.MAX_SAFE_INTEGER, 'Material phase parcel IDs exhausted');
      return { id: field.nextId++, material, phase: true, energy: heat * capacity, wetness: 0 };
    }

    const meltEnergy = (fusion + latentDegrees) * capacity;
    function deposit(field, [x, , z], energy) {
      const cx = Math.floor((x - origin[0]) / cell), cz = Math.floor((z - origin[2]) / cell);
      let closest = -1, distance = Infinity;
      for (let row = Math.max(0, cz - depositSpread); row <= Math.min(height - 1, cz + depositSpread); row++)
        for (let col = Math.max(0, cx - depositSpread); col <= Math.min(width - 1, cx + depositSpread); col++) {
          const i = col + row * width;
          if (blocked.has(i) || field.liquid[i] > liquidCapacity - 1) continue;
          const [u, v] = center(i), d = (x - u) ** 2 + (z - v) ** 2;
          if (d < distance) {
            closest = i;
            distance = d;
          }
        }
      if (closest < 0) return null;
      field.liquid[closest] += 1;
      field.heat[closest] += (energy - latent) / capacity;
      return lattice(closest);
    }

    function validate(field) {
      check(keys(field, [...channels, 'nextId', 'exchange']) && Number.isSafeInteger(field.nextId) &&
        field.nextId >= firstId && Number.isFinite(field.exchange) &&
        channels.every(name => Array.isArray(field[name]) && field[name].length === count), 'Invalid saved material phase field');
      for (let i = 0; i < count; i++) {
        const { liquid, ice, heat } = field, amount = liquid[i] + ice[i];
        check(finite(liquid[i], 0, liquidCapacity) && finite(ice[i], 0, 1) &&
          finite(heat[i], 0, (maxTemperature - absoluteZero) * amount + 1e-9) &&
          (!blocked.has(i) || amount === 0 && heat[i] === 0) && (amount > 0 || heat[i] === 0),
        'Invalid saved phase mass or heat at cell ' + i);
      }
    }

    function rows(field) {
      return sites.flatMap(i => {
        const liquid = field.liquid[i], ice = field.ice[i];
        if (!(liquid + ice)) return [];
        const [x, z] = center(i);
        return [{ at: lattice(i), point: [x, waterline, z], liquid: liquid * mass, ice: ice * mass,
          temperature: absoluteZero + field.heat[i] / (liquid + ice), energy: field.heat[i] * capacity + liquid * latent }];
      });
    }
    return { start, material, meltingPoint, meltEnergy, latent, latentDegrees, firstId, mass, liquidColor, sites, lattice, advance, extract, deposit,
      totals: readTotals, rows, validate,
      warm: (point, temp, dt) => exchangeAt(zoneAt(point[0], point[2]), temp, dt) * capacity };
  }

  W.materialPhases = Object.freeze({ prepare });
})(KIT);
