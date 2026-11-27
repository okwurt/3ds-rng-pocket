import type { IdResult6 } from '../core/types';
import { TinyMT } from '../rng/tinymt';
import type { TinyState } from '../rng/types';
import { searchId6 } from './id6';
import { searchStationary6, type Stationary6Row } from './stationary6';

/**
 * Seed Run: pure math for a fresh-save Pokémon X starter appointment run.
 *
 * A cold boot seeds TinyMT from the console clock (the Tiny seed). The new
 * game's ID is the TinyMT output at the bedroom park index, and the MT seed
 * behind the starter gift is the Tiny seed plus a fixed constant K (two
 * observed values, K96/K97, one per boot timing). Every constant here is
 * hardware-verified against real saves; tests/gen6/seedRun.test.ts is the
 * contract.
 */

export const SEED_RUN_K96 = 0xd10c9196;
export const SEED_RUN_K97 = 0xd10c9197;
export const SEED_RUN_BRANCHES = [
  { key: 'K96', k: SEED_RUN_K96 },
  { key: 'K97', k: SEED_RUN_K97 },
] as const;
export type SeedRunBranchKey = (typeof SEED_RUN_BRANCHES)[number]['key'];

/** Press the starter prompt this many frames before the generation frame. */
export const SEED_RUN_PRESS_ANCHOR = 215;
/**
 * Stationary delay that makes searchStationary6 frame numbers equal
 * PokeReader generation frames for the gift starter template: the engine
 * reads the EC at stream index frame + delay + 1, and a generation frame G
 * has its EC at G + 79.
 */
export const SEED_RUN_STATIONARY_DELAY = 78;
export const SEED_RUN_STARTER_GAME = 'X' as const;
export const SEED_RUN_STARTER_PRESET = 'xy:5:0';

export const SEED_RUN_RATE_INDOORS = 59.8;
export const SEED_RUN_RATE_OUTDOORS = 39.9;

export const SEED_RUN_DEFAULT_LAG_MS = 17640;
export const SEED_RUN_DEFAULT_PARK = 37;
export const SEED_RUN_DEFAULT_WINDOW_MIN = 12000;
export const SEED_RUN_DEFAULT_WINDOW_MAX = 32000;

/** Initial TinyMT state for a boot seed, in TinyState (S0..S3) order. */
export function tinyStateFromSeed(seed: number): TinyState {
  return new TinyMT(seed >>> 0).getState();
}

/** The ID drawn from the TinyMT output at one stream index. */
export function idAtIndex(state: TinyState, index: number): IdResult6 {
  const [row] = searchId6(state, index, index);
  return row!;
}

/** The appointed ID for a booking: the output at the park index. */
export function appointedId(tinySeed: number, parkIndex: number): IdResult6 {
  return idAtIndex(tinyStateFromSeed(tinySeed), parkIndex);
}

/** MT seed for one branch of a booking. */
export function branchMtSeed(tinySeed: number, k: number): number {
  return (tinySeed + k) >>> 0;
}

export interface SeedRunWindow {
  minFrame: number;
  maxFrame: number;
}

function starterSearch(mtSeed: number, tsv: number, trv: number, window: SeedRunWindow) {
  return searchStationary6({
    seed: mtSeed >>> 0,
    game: SEED_RUN_STARTER_GAME,
    preset: SEED_RUN_STARTER_PRESET,
    minFrame: window.minFrame,
    maxFrame: window.maxFrame,
    targetFrame: 0,
    considerDelay: true,
    delay: SEED_RUN_STATIONARY_DELAY,
    tsv,
    trv,
    shinyCharm: false,
  });
}

/** Shiny starter rows in the pick window for one MT seed and TSV/TRV. */
export function branchShinyRows(
  mtSeed: number, tsv: number, trv: number, window: SeedRunWindow,
): Stationary6Row[] {
  const rows: Stationary6Row[] = [];
  for (const row of starterSearch(mtSeed, tsv, trv, window)) {
    if (row.shiny) rows.push(row);
  }
  return rows;
}

/** The frame-timer press frame for a generation frame. */
export function pressFrameFor(generationFrame: number): number {
  return generationFrame - SEED_RUN_PRESS_ANCHOR;
}

export type SeedRunDelta =
  | { kind: 'branch'; branch: SeedRunBranchKey; delta: number }
  | { kind: 'unknown'; delta: number };

/** Which branch an achieved title-screen MT seed belongs to, if any. */
export function classifyAchievedSeed(tinySeed: number, achievedMtSeed: number): SeedRunDelta {
  const delta = (achievedMtSeed - tinySeed) >>> 0;
  if (delta === SEED_RUN_K96) return { kind: 'branch', branch: 'K96', delta };
  if (delta === SEED_RUN_K97) return { kind: 'branch', branch: 'K97', delta };
  return { kind: 'unknown', delta };
}

export interface SeedRunFit {
  row: Stationary6Row;
  /** Signed error: true generation frame minus the targeted generation frame. */
  error: number;
}

/**
 * Fit a received starter against an MT stream: find the window row whose PID
 * (or EC) matches and report its generation frame and the signed error
 * against the targeted generation frame.
 */
export function fitReceipt(
  mtSeed: number, tsv: number, trv: number, window: SeedRunWindow,
  field: 'pid' | 'ec', value: number, targetFrame: number,
): SeedRunFit | null {
  for (const row of starterSearch(mtSeed, tsv, trv, window)) {
    if (row[field] === (value >>> 0)) return { row, error: row.frame - targetFrame };
  }
  return null;
}

/** The next shiny row strictly after a generation frame, for re-arming. */
export function nextShinyAfter(rows: readonly Stationary6Row[], frame: number): Stationary6Row | null {
  for (const row of rows) {
    if (row.frame > frame) return row;
  }
  return null;
}
