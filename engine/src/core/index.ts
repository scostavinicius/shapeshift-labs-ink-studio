// The game core, as the rest of the engine uses it: the fixed-step clock, input, the follow camera and clicks.
export { FixedLoop, STEP, type LoopOptions } from './loop';
export {
  InputState,
  DomInput,
  DEFAULT_KEYS,
  DEFAULT_PAD,
  stickToWorld,
  type Action,
  type StepInput,
  type LookInput,
  type Click,
  type Sample,
  type KeyMap,
  type DomInputOptions
} from './input';
export { FollowCamera, springStep, type CameraOptions } from './camera';
export { rayThrough, project, eyeOf, type Ray } from './pick';
export { Core, type CoreOptions, type PokeRecord } from './core';
