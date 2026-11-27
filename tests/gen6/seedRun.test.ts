import { describe, expect, it } from 'vitest';
import { createI18n } from '../../src/data/i18n';
import { searchId6 } from '../../src/engine/gen6/id6';
import {
  SEED_RUN_K96, SEED_RUN_K97, appointedId, branchMtSeed, branchShinyRows,
  classifyAchievedSeed, fitReceipt, pressFrameFor, tinyStateFromSeed,
} from '../../src/engine/gen6/seedRun';

const i18n = createI18n('en');
const window = { minFrame: 20000, maxFrame: 22000 };

describe('Seed Run', () => {
  it('T1: builds the TinyMT state from a seed and draws the ID at frame 52', () => {
    const state = tinyStateFromSeed(0x758F5322);
    expect(state).toEqual([0x1EC7E146, 0x1E1F2DBD, 0x51C8E51C, 0x9960C7F6]);
    const rows = [...searchId6(state, 0, 60)];
    const row = rows.find(entry => entry.frame === 52);
    expect(row).toMatchObject({ rand: 0x5C37776F, tid: 30575, sid: 23607, tsv: 693, trv: 8 });
  });

  it('T2: appoints the ID at park index 37', () => {
    const id = appointedId(0xAE808558, 37);
    expect(id).toMatchObject({ tid: 59378, sid: 25977, tsv: 2088, trv: 11 });
  });

  it('derives branch MT seeds from the Tiny seed plus K', () => {
    expect(branchMtSeed(0x758F5322, SEED_RUN_K97)).toBe(0x469BE4B9);
    expect(branchMtSeed(0x93ED0DD8, SEED_RUN_K96)).toBe(0x64F99F6E);
    expect(classifyAchievedSeed(0xAE808558, 0x7F8D16EE)).toEqual({ kind: 'branch', branch: 'K96', delta: SEED_RUN_K96 });
    expect(classifyAchievedSeed(0xAE808558, 0x7F8D16EF)).toEqual({ kind: 'branch', branch: 'K97', delta: SEED_RUN_K97 });
    expect(classifyAchievedSeed(0xAE808558, 0x7F8D16F0).kind).toBe('unknown');
  });

  it('T3: Continue-stream stationary vector — the Ravu frame at delay 78 under the Continue MT seed', () => {
    // Ravu was generated on MT seed 0xACA5A826 (a Continue stream), TSV 693.
    const rows = branchShinyRows(0xACA5A826, 693, 8, window);
    const row = rows.find(entry => entry.frame === 20988);
    expect(row).toBeDefined();
    expect(row!.shiny).toBe(true);
    expect(i18n.getNatureName(row!.nature)).toBe('Naive');
    expect(row!.ivs).toEqual([8, 31, 18, 15, 7, 18]);
    expect(row!.pid).toBe(0x04062F5A);
    expect(row!.ec).toBe(0x52C20FE9);
  });

  it('T3b: branch plumbing (engine-derived) — the K97 branch table of the Ravu boot contains its own shiny frame', () => {
    const mtSeed = branchMtSeed(0x758F5322, SEED_RUN_K97);
    expect(mtSeed).toBe(0x469BE4B9);
    const rows = branchShinyRows(mtSeed, 693, 8, window);
    const row = rows.find(entry => entry.frame === 20825);
    expect(row).toBeDefined();
    expect(row!.shiny).toBe(true);
    expect(i18n.getNatureName(row!.nature)).toBe('Lonely');
    expect(row!.ivs).toEqual([29, 9, 17, 9, 14, 13]);
    expect(row!.pid).toBe(0xABFB80AB);
  });

  it('T4: branch table at delay 78 contains the appointed Adamant frame', () => {
    const rows = branchShinyRows(0x64F99F6E, 2413, 15, window);
    const row = rows.find(entry => entry.frame === 21226);
    expect(row).toBeDefined();
    expect(row!.shiny).toBe(true);
    expect(i18n.getNatureName(row!.nature)).toBe('Adamant');
    expect(row!.ivs).toEqual([25, 29, 10, 2, 14, 5]);
    expect(row!.pid).toBe(0x833B15EB);
  });

  it('T5: fits a received PID to its true generation frame with a signed error', () => {
    const miss = fitReceipt(0x64F99F6E, 2413, 15, window, 'pid', 0x08DC4E2B, 21226);
    expect(miss).not.toBeNull();
    expect(miss!.row.frame).toBe(21220);
    expect(miss!.error).toBe(-6);

    const hit = fitReceipt(0x7F8D16EE, 2088, 11, { minFrame: 12000, maxFrame: 32000 }, 'pid', 0x7314F191, 26940);
    expect(hit).not.toBeNull();
    expect(hit!.row.frame).toBe(26940);
    expect(hit!.error).toBe(0);
  });

  it('fits a received EC to its true generation frame', () => {
    const fit = fitReceipt(0x64F99F6E, 2413, 15, window, 'ec', 0x25266770, 21226);
    expect(fit).not.toBeNull();
    expect(fit!.row.frame).toBe(21220);
    expect(fit!.error).toBe(-6);
  });

  it('T6: press frame is the generation frame minus the 215 anchor', () => {
    expect(pressFrameFor(26940)).toBe(26725);
  });
});
