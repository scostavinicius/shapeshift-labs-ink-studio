function measureScreenSubjects(frame, subjects, w, h) {
  const { passes, alpha } = frame;
  const needsObject = subjects.some(subject => subject.select.object !== undefined);
  const needsMaterial = subjects.some(subject => subject.select.material !== undefined);
  if (frame.w !== w || frame.h !== h || passes?.w !== w || passes?.h !== h ||
      (needsObject && (passes.objectId?.length !== w * h || !Array.isArray(passes.objects))) ||
      (needsMaterial && (passes.materialId?.length !== w * h || !Array.isArray(passes.materials))))
    throw new TypeError('Subject tracking needs aligned native object and material passes');
  const { objectId, materialId, objects, materials } = passes;
  const groups = new Map();
  for (let i = 0; i < subjects.length; i++) {
    const { object, material } = subjects[i].select;
    const objectSlot = object === undefined ? 0 : objects.indexOf(object);
    const materialSlot = material === undefined ? 0 : materials.indexOf(material);
    if ((object !== undefined && objectSlot <= 0) || (material !== undefined && materialSlot <= 0)) continue;
    const key = (objectSlot || 0) + ':' + (materialSlot || 0);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  }
  const boxes = subjects.map(() => [w, h, 0, 0]);
  const routes = new Map();
  for (let p = 0; p < w * h; p++) {
    if (alpha?.[p] === 0) continue;
    const object = objectId?.[p] || 0, material = materialId?.[p] || 0;
    if (!object && !material) continue;
    const key = object + ':' + material;
    if (!routes.has(key)) routes.set(key, [
      ...(object && material ? groups.get(key) ?? [] : []),
      ...(object ? groups.get(object + ':0') ?? [] : []),
      ...(material ? groups.get('0:' + material) ?? [] : [])
    ]);
    const matches = routes.get(key);
    if (!matches.length) continue;
    const x = p % w, y = Math.floor(p / w);
    for (const i of matches) {
      const box = boxes[i];
      box[0] = Math.min(box[0], x);
      box[1] = Math.min(box[1], y);
      box[2] = Math.max(box[2], x + 1);
      box[3] = Math.max(box[3], y + 1);
    }
  }
  return boxes.map((box, i) => ({
    id: subjects[i].id,
    box: box[2] ? box : null,
    sourceEdge: Boolean(box[2] && (box[0] === 0 || box[1] === 0 || box[2] === w || box[3] === h))
  }));
}

function captureScreenFrame(world, width, height, time, { pose, view }, overrides) {
  const options = view({ w: width, h: height, t: time });
  pose(world, time);
  const { w, h, rgb, alpha, passes } = require('./render.js').render(world, {
    ...options, ...overrides, px: 1, passes: ['objectId', 'materialId'],
    composite: false, renderGraph: false, renderGrid: false, inspection: false, shutter: false
  });
  return { w, h, rgb, alpha, passes };
}

module.exports = { measureScreenSubjects, captureScreenFrame };
