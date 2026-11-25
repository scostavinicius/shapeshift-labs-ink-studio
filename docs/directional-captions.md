# Generate directional sound captions from playback

Assign text to the sounds that matter to the player. Ink starts their captions when playback reaches the listener, including when admission comes late. Muted, blocked and dropped requests produce no captions. Repeated cues can share a single line.

## Mark the sounds to caption

Save a version 1 plan with rules for cue names, sound family names or both. A cue-specific rule takes precedence over a family rule. A rule can cover several takes of one action, such as short and heavy bootsteps.

```json
{
  "format": "ink-studio/directional-captions",
  "version": 1,
  "mergeMs": 360,
  "holdMs": 1250,
  "rules": [
    {
      "id": "steps",
      "cues": ["step-a", "step-b"],
      "families": ["work-boots"],
      "text": "Bootstep",
      "burstText": "Bootsteps"
    },
    {
      "id": "alarm",
      "cues": ["pump-bell"],
      "text": "Pump bell rings",
      "priority": 20
    }
  ]
}
```

The default merge window is 350 ms from the first matching arrival. The default hold is 1,150 ms from the last arrival. Each burst keeps a consistent direction and acoustic opening. Multiple layers linked to the same committed beat within that burst count once. `burstText` is optional. `priority` orders overlapping live captions from highest to lowest so a host can limit the number displayed.

Direction uses the apparent sound position and the listener's forward and up axes. Sound carried by an acoustic route can be heard through a doorway in a different direction from its emitter. The caption describes the listener-side opening when the acoustic field identifies it. Unpositioned cues get text alone. Aggregated cues use the audible texture’s sector.

## Export a caption track

```sh
ink-studio story audio scene.run.json soundtrack.json --out mix
ink-studio story audio-captions mix/playback.json captions-plan.json --out captions
```

`captions.vtt` uses time relative to the exported WAV. `captions.json` retains absolute and file-relative samples, source beat IDs, and zero-based indexes into the playback receipts. A cropped print can caption a cue whose feed continues into the window. Earlier version 1 receipts still work for onsets inside the window and use plain text when they lack direction evidence.

This tracks admitted cue feeds. A cue can contain an authored fade or silence at the start, and the renderer has no measurement of the listener's playback volume or hearing threshold. Label the cue with the sound or action it represents.

## Show captions in the live player

Pass the same plan to `createSpatialAudioPlayer` from `webgl.mjs`. Use `captureSources: true` when producing spatial audio frames so layered cues can share the original event identity.

```js
const player = createSpatialAudioPlayer(context, {resolveAsset, captions: plan});
await player.update(frame);
const visible = player.readCaptions();
```

Call `readCaptions()` on the host's UI frame. It returns active rows with `text`, `count`, `direction`, `opening`, `startSample` and `endSample` on the current AudioContext clock. Direct cues appear once their buffer starts. Overflow texture captions appear after their worklet plays the relevant grain. A seek or reset clears pending and visible captions.

## Open the Pump House demo

```sh
node scripts/build.js node
node examples/directional-captions/demo.cjs ./pump-house-captions
```

Open `pump-house-captions.html` to play the native mix with captions, jump to individual cues, and download the caption track and evidence.
