import { cameraLens } from './camera-lens.mjs';

export function splatScreenRays(camera, width, height) {
  const { view, eye, tangent, ortho, clipNear, clipFar } = camera;
  const rayAt = cameraLens.rays(view, eye, width, height, height / (2 * tangent), ortho);
  return (x, y) => {
    const { origin, direction, axial } = rayAt(x, height - y);
    return {
      origin: origin.map((value, i) => value + direction[i] * clipNear / axial),
      direction, maxDistance: (clipFar - clipNear) / axial, soft: true
    };
  };
}
