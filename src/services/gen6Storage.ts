import { MAX_FRAME } from '../engine/core/pokemonMath';
import { isGen6GameVersion, type GameVersion6 } from '../engine/core/types';
import { isTinyState6 } from '../engine/gen6/id6';
import { parseHex32, toHex32 } from '../engine/math/uint';
import type { TinyState } from '../engine/rng/types';

const PROFILES_KEY = 'gen6_rng_profiles_v1';
const SESSION_KEY = 'gen6_rng_session_v1';

export interface TrainerProfile6 {
  id: string;
  name: string;
  gameVersion: GameVersion6;
  tid: number;
  sid: number;
  shinyCharm: boolean;
}

export interface ProfileStore6 {
  generation: 6;
  version: 1;
  activeProfileId: string;
  profiles: TrainerProfile6[];
}

import { isCalibration6, type Timeline6Request } from '../engine/gen6/tinyTimeline';

export interface SeedRunSession {
  tinySeedHex: string;
  pressDateTime: string;
  lagMs: number;
  parkIndex: number;
  windowMin: number;
  windowMax: number;
  armedMtSeedHex: string;
  armedFrame: number | null;
  achievedMtSeedHex: string;
  rescanTsv: number | null;
  receiptField: 'pid' | 'ec';
  receiptHex: string;
}

export interface Session6 {
  timeline?: Timeline6Request;
  eggKey?: [number,number];
  seedRun?: SeedRunSession;
  initialSeedHex: string;
  startFrame: number;
  endFrame: number;
  targetFrame: number;
  idState: TinyState | null;
  idStartFrame: number;
  idEndFrame: number;
}

function isHexOrEmpty(value: unknown): value is string {
  return typeof value === 'string' && (value === '' || parseHex32(value) !== null);
}

function isSeedRunSession(value: unknown): value is SeedRunSession {
  if (!isRecord(value)) return false;
  return isHexOrEmpty(value.tinySeedHex) &&
    typeof value.pressDateTime === 'string' &&
    isIntInRange(value.lagMs, 600000) &&
    isIntInRange(value.parkIndex, 100000) &&
    isIntInRange(value.windowMin, MAX_FRAME) &&
    isIntInRange(value.windowMax, MAX_FRAME) &&
    isHexOrEmpty(value.armedMtSeedHex) &&
    (value.armedFrame === null || isIntInRange(value.armedFrame, MAX_FRAME)) &&
    isHexOrEmpty(value.achievedMtSeedHex) &&
    (value.rescanTsv === null || isIntInRange(value.rescanTsv, 4095)) &&
    (value.receiptField === 'pid' || value.receiptField === 'ec') &&
    typeof value.receiptHex === 'string';
}

export function createDefaultProfileStore6(): ProfileStore6 {
  const profile: TrainerProfile6 = {
    id: 'default-x', name: 'Pokémon X', gameVersion: 'X', tid: 0, sid: 0, shinyCharm: false,
  };
  return { generation: 6, version: 1, activeProfileId: profile.id, profiles: [profile] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isIntInRange(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;
}

export function importProfiles6Json(json: string): ProfileStore6 {
  const data: unknown = JSON.parse(json);
  if (!isRecord(data) || data.generation !== 6) throw new Error('Expected a Gen 6 profile file.');
  if (data.version !== 1) throw new Error('Unsupported Gen 6 profile version.');
  if (!Array.isArray(data.profiles) || data.profiles.length === 0) {
    throw new Error('No Gen 6 profiles found.');
  }

  const ids = new Set<string>();
  const profiles = data.profiles.map((raw: unknown): TrainerProfile6 => {
    if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id.trim() || ids.has(raw.id) ||
        typeof raw.name !== 'string' || !raw.name.trim() || !isGen6GameVersion(raw.gameVersion) ||
        !isIntInRange(raw.tid, 65535) || !isIntInRange(raw.sid, 65535) ||
        typeof raw.shinyCharm !== 'boolean') {
      throw new Error('Invalid Gen 6 trainer profile.');
    }
    ids.add(raw.id);
    return {
      id: raw.id, name: raw.name.trim(), gameVersion: raw.gameVersion,
      tid: raw.tid, sid: raw.sid, shinyCharm: raw.shinyCharm,
    };
  });
  const activeProfileId = typeof data.activeProfileId === 'string' && ids.has(data.activeProfileId)
    ? data.activeProfileId : profiles[0]!.id;
  return { generation: 6, version: 1, activeProfileId, profiles };
}

export function exportProfiles6Json(store: ProfileStore6): string {
  return JSON.stringify(store, null, 2);
}

export function loadProfileStore6(): ProfileStore6 {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    if (raw !== null) return importProfiles6Json(raw);
  } catch {
    // An invalid or unavailable store falls back to a fresh profile.
  }
  return createDefaultProfileStore6();
}

export function saveProfileStore6(store: ProfileStore6): void {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(store));
}

const defaultSession: Session6 = {
  initialSeedHex: '00000000',
  startFrame: 0,
  endFrame: 5000,
  targetFrame: 5000,
  idState: null,
  idStartFrame: 0,
  idEndFrame: 5000,
};

export function loadSession6(): Session6 {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    const session: unknown = raw === null ? null : JSON.parse(raw);
    if (isRecord(session)) {
      const seed = typeof session.initialSeedHex === 'string' ? parseHex32(session.initialSeedHex) : null;
      const frame = (key: 'startFrame' | 'endFrame' | 'targetFrame' | 'idStartFrame' | 'idEndFrame') => {
        const value = session[key];
        return isIntInRange(value, MAX_FRAME) ? value : defaultSession[key];
      };
      const startFrame = frame('startFrame');
      const idStartFrame = frame('idStartFrame');
      return {
        initialSeedHex: seed === null ? defaultSession.initialSeedHex : toHex32(seed),
        startFrame,
        endFrame: Math.max(startFrame, frame('endFrame')),
        targetFrame: frame('targetFrame'),
        idState: isTinyState6(session.idState) ? session.idState : null,
        ...(isCalibration6(session.timeline) ? { timeline: session.timeline } : {}),
        ...(isSeedRunSession(session.seedRun) ? { seedRun: session.seedRun } : {}),
        ...(Array.isArray(session.eggKey) && session.eggKey.length===2 && session.eggKey.every(v=>isIntInRange(v,0xffffffff)) ? {eggKey:session.eggKey as [number,number]} : {}),
        idStartFrame,
        idEndFrame: Math.max(idStartFrame, frame('idEndFrame')),
      };
    }
  } catch {
    // An invalid or unavailable session falls back to the initial fields.
  }
  return { ...defaultSession };
}

export function saveSession6(session: Session6): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}
