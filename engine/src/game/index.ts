// Stage 6: the game model. See docs/engine-stage6-design.md.
export * from './types';
export { createGame, defineGame, type CreateOptions, type RunningGame } from './game';
export { buildLevel, type Level, type SceneFn, type Slot } from './level';
export { CollisionBuilder, makeCollision, splatBox, type BakeStats, type Field } from './collision';
export { Dice, XorShift } from './rng';
export { DMATH, DMATH_NAMES, fingerprint as dmathFingerprint } from './dmath';
export { ScriptPlayer, InputRecorder } from './script';
export { Combat } from './combat';
export { GameEffects } from './effects';
export { chaser, dummy, hunter, nearestFoe, perceive, type ChaserOptions, type HunterOptions } from './brains';
export { buildNavGrid, cellAt, findPath, navGridFor, type NavGrid, type Path } from './nav';
export { saveGame, loadSave, saveProblem, storeLocal, readLocal, forgetLocal, saveKey, SAVE_FORMAT, SAVE_VERSION, type SaveData, type SavedEntity } from './save';
export { validateGame, checkDefinition, checkRun, lintSource, codeOnly, type Problem, type RunStats } from './validate';
export { makeDungeonScene, layDungeon, dungeonOf, DUNGEON_PALETTE, type DungeonLayout, type DungeonOptions, type DungeonRoom, type Spot } from './dungeon';
export { Breakables, type BreakableDef, type BreakableData } from './breakables';
export { placeAsset, placePart, type PlaceAssetOptions } from './assets';
