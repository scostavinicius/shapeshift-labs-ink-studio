# View-specific pose corrections

Add an elbow or held-prop correction in a camera sector after the source puppet pose is solved. An elbow pivots around the shoulder-to-wrist line while the wrist holds its position and orientation. A prop moves its grips as a rigid body and the arm chains follow. Foot plants and other independent contacts keep their source position. Ink evaluates the correction for each camera in live WebGL, headless renders, and directional sprite atlases.

## Author the correction

Use a `K.puppet` with a separate wrist part under each forearm. Name the anchors in puppet rest coordinates. The source pose should already have its planted feet and grips in place.

```json
{
  "format": "ink-studio/view-poses",
  "version": 1,
  "anchor": "chest",
  "chains": {
    "left grip": {
      "upper": "upper-L",
      "lower": "lower-L",
      "wrist": "hand-L",
      "point": [-0.254, 1.119, 0.467],
      "grip": "staff"
    },
    "right grip": {
      "upper": "upper-R",
      "lower": "lower-R",
      "wrist": "hand-R",
      "point": [0.271, 1.501, 0.475],
      "grip": "staff"
    }
  },
  "locks": {
    "left foot": { "part": "boot-L", "point": [-0.293, 0.014, 0.062] },
    "right foot": { "part": "boot-R", "point": [0.33, 0.014, -0.102] }
  },
  "sectors": [{
    "id": "Port",
    "yaw": -42,
    "width": 150,
    "elbows": { "left grip": 57, "right grip": -37 },
    "props": { "staff": { "move": [0.105, 0.1, 0.08], "rotation": [-7, -9, -11] } }
  }]
}
```

- Sector centers and full widths use degrees around the `anchor` part's +Y axis, with +Z at zero degrees. A sector fades smoothly to zero at both edges. Overlapping sectors share their weight and wrap across ±180 degrees. The correction also fades at vertical views where yaw is ambiguous.
- Elbow values are degrees of rotation around the shoulder-to-wrist axis. An elbow-only chain can omit `grip`. A grip names a top-level prop, and every hand on an edited prop should have a chain. The sector's `move` is in world units along the anchor's axes, and `rotation` is in XYZ degrees about the prop pivot.
- Reach bounds limit the prop transform to a range all named grips can retain without changing limb lengths. Feet and other locked parts must be outside the edited arms and prop hierarchy. If a pose cannot retain a declared contact, Ink uses the source pose for that camera.

Use `puppet.viewPoses.set(asset)` or supply the asset as `viewPoses` in the puppet definition. `puppet.viewPoses.asset()` returns an editable copy. `puppet.viewPoses.sample({ eye, back, ortho })` reports the weights, resolved positions, applied prop gain, and contact residuals from a resolved camera. An orthographic sample uses the camera back direction. A perspective sample uses the eye position relative to the anchor. Sampling leaves the live animation pose and bone table intact.

Load an edit with `render`, `clip`, or `atlas` using `--view-poses asset.json`. Use `--view-poses off` for a source-pose bake.

```sh
node cli/ink-studio.js atlas examples/view-poses/breakwater-warden.js \
  --view-poses asset.json --t 0 --directions 16 --w 144 --h 144 --raw \
  --maps depth,normal,emission,silhouette --out warden-atlas
```

## Breakwater Warden

Build the development bundle and serve the repository to open the [live demo](../examples/view-poses/index.html).

```sh
npm run build -- development
python3 -m http.server 8080
```

Scrub the camera or press **Orbit**. The foot markers stay fixed while the elbows and staff move and both grips follow the staff. Pick **Port** or **Starboard** to change its elbow turn or staff lift, then download the correction JSON.
