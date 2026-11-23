# Directional sound emitters

A radiation profile describes how much bass, midrange, and treble a source sends in each direction. Use one for a loudspeaker with a bright front and bass around the back, a mouth attached to a head socket, or an exhaust whose main lobe points out of the pipe.

Add named `radiationProfiles` to `KIT.world.spatialAudio.create` or to the `spatial` block of a [scene soundtrack](scene-audio.md). Select a profile on a cue or override it on a continuous emitter. Set an emitter's `radiation` to `false` to use an omnidirectional feed even when its cue has a profile.

```json
{
  "radiationProfiles": {
    "cabinet": {
      "forward": [0, 0, -1],
      "points": [
        { "angle": 0, "db": { "low": 0, "mid": 0, "high": 0 } },
        { "angle": 60, "db": { "low": -1, "mid": -3, "high": -7 } },
        { "angle": 90, "db": { "low": -1, "mid": -5, "high": -15 } },
        { "angle": 180, "db": { "low": -2, "mid": -10, "high": -32 } }
      ]
    }
  },
  "cues": { "music": { "asset": "speaker-program", "radiation": "cabinet" } },
  "emitters": { "speaker": { "cue": "music", "at": { "entity": "box", "socket": "driver" } } }
}
```

`forward` defaults to local negative Z. Attach the source to an oriented entity or socket to rotate that axis with its world pose. A plain XYZ source uses the authored axis in world space. Each curve is symmetric around that axis, and its angles run from 0° in front to 180° behind. Supply 2 to 36 increasing points including both endpoints. Each point has three levels from −72 to 0 dB. Ink interpolates between points in decibels. The audio transition spans the overlapping bands around 250 Hz and 3.2 kHz, with crossovers limited by playback sample rate.

Live loops and active timeline clips update with the sampled pose. Live one-shot cues use the orientation at dispatch. Offline attached cues with `follow: true` keep following the pose during the cue. For early reflections, Ink evaluates the radiation in the direction from the source to the first bounce. Routed portal sound uses the first leg out of the source room. Distance, transmission, and obstacles still contribute to the resulting band levels. The filtered signal feeds the selected listener panner, including [pinned binaural profiles](pinned-binaural.md), and the optional [room response](room-response.md).

Inspect `voice.radiation` or `voice.reflections[n].radiation` for the selected profile, world-space axis, departure angle, and authored band attenuation. `voice.bands` contains the combined pressure gains after distance, path transmission, and radiation.

Generate the Turntable Cabinet listening comparison and scene with `node examples/directional-audio/demo.cjs <output-directory> <Chrome executable>`. The example uses an authored polar curve. For measured polar data and frequency-dependent loudspeaker directivity, see the [Princeton loudspeaker polar measurement paper](https://aes.org/publications/elibrary/elibrary-page/?id=17906).
