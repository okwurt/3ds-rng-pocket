import { useEffect, useMemo, useRef, useState } from 'react';
import type { IdResult6 } from '../../engine/core/types';
import { isTinyState6 } from '../../engine/gen6/id6';
import {
  SEED_RUN_BRANCHES, SEED_RUN_DEFAULT_LAG_MS, SEED_RUN_DEFAULT_PARK,
  SEED_RUN_DEFAULT_WINDOW_MAX, SEED_RUN_DEFAULT_WINDOW_MIN, SEED_RUN_RATE_INDOORS,
  SEED_RUN_RATE_OUTDOORS, appointedId, branchMtSeed, branchShinyRows,
  classifyAchievedSeed, fitReceipt, idAtIndex, nextShinyAfter, pressFrameFor,
  tinyStateFromSeed, type SeedRunFit,
} from '../../engine/gen6/seedRun';
import type { Stationary6Row } from '../../engine/gen6/stationary6';
import { formatEggSeedStr, parseEggSeedStr, parseHex32, toHex32 } from '../../engine/math/uint';
import type { SeedRunSession, Session6 } from '../../services/gen6Storage';
import { useApp } from '../../store/AppContext';
import { buttonClass, cardClass, fieldClass, labelClass, NumberField, primaryClass } from './fields';

const DEFAULT_RUN: SeedRunSession = {
  tinySeedHex: '',
  pressDateTime: '',
  lagMs: SEED_RUN_DEFAULT_LAG_MS,
  parkIndex: SEED_RUN_DEFAULT_PARK,
  windowMin: SEED_RUN_DEFAULT_WINDOW_MIN,
  windowMax: SEED_RUN_DEFAULT_WINDOW_MAX,
  armedMtSeedHex: '',
  armedFrame: null,
  achievedMtSeedHex: '',
  rescanTsv: null,
  receiptField: 'pid',
  receiptHex: '',
};

let audioCtx: AudioContext | null = null;

function beep(long = false) {
  try {
    const Ctor = window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audioCtx ??= new Ctor();
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    const seconds = long ? 0.6 : 0.09;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + seconds);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + seconds);
  } catch {
    // Audio is a nicety; the timers still run silently without it.
  }
}

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, ms / 1000);
  if (totalSeconds < 60) return totalSeconds.toFixed(1);
  const whole = Math.floor(totalSeconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = whole % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  return `${hours > 0 ? `${hours}:` : ''}${mm}:${String(seconds).padStart(2, '0')}`;
}

function IdLine({ id }: { id: IdResult6 }) {
  return <p className="font-mono text-sm">
    TID {String(id.tid).padStart(5, '0')} · SID {String(id.sid).padStart(5, '0')} ·{' '}
    TSV {String(id.tsv).padStart(4, '0')} · TRV {id.trv.toString(16).toUpperCase()}
  </p>;
}

function ShinyTable({ rows, mtSeed, armedMtSeedHex, armedFrame, onArm }: {
  rows: Stationary6Row[];
  mtSeed: number;
  armedMtSeedHex: string;
  armedFrame: number | null;
  onArm: (mtSeed: number, frame: number) => void;
}) {
  const { i18n } = useApp();
  const t = i18n.t;
  if (rows.length === 0) return <p className="text-xs text-zinc-400">{t('gen6.seedRun.noShiny')}</p>;
  return <div className="space-y-1">
    {rows.map(row => {
      const armed = armedFrame === row.frame && armedMtSeedHex === toHex32(mtSeed);
      return <button key={row.frame} type="button" aria-pressed={armed}
        className={`choice-button w-full rounded-xl border px-3 py-2 text-left font-mono text-xs ${armed ? 'border-amber-400 bg-amber-400/10' : 'border-zinc-800 bg-zinc-950'}`}
        onClick={() => onArm(mtSeed, row.frame)}>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-bold text-amber-300">#{row.frame}</span>
          <span>{t('gen6.seedRun.pressFrame')} {pressFrameFor(row.frame)}</span>
          <span>{i18n.getNatureName(row.nature)}</span>
          <span>{row.ivs.join('/')}</span>
        </span>
        <span className="block text-zinc-400">PID {toHex32(row.pid)} · EC {toHex32(row.ec)}</span>
      </button>;
    })}
  </div>;
}

export function SeedRun6Page({ session, updateSession }: {
  session: Session6;
  updateSession: (next: Partial<Session6>) => void;
}) {
  const { i18n } = useApp();
  const t = i18n.t;
  const run = session.seedRun ?? DEFAULT_RUN;
  const updateRun = (patch: Partial<SeedRunSession>) =>
    updateSession({ seedRun: { ...run, ...patch } });

  const tinySeed = run.tinySeedHex ? parseHex32(run.tinySeedHex) : null;
  const seedInvalid = run.tinySeedHex !== '' && tinySeed === null;
  const window = {
    minFrame: Math.min(run.windowMin, run.windowMax),
    maxFrame: Math.max(run.windowMin, run.windowMax),
  };
  const appointment = tinySeed !== null ? appointedId(tinySeed, run.parkIndex) : null;
  const appointmentTsv = appointment?.tsv;
  const appointmentTrv = appointment?.trv;

  const branches = useMemo(() => {
    if (tinySeed === null || appointmentTsv === undefined || appointmentTrv === undefined) return [];
    return SEED_RUN_BRANCHES.map(branch => {
      const mtSeed = branchMtSeed(tinySeed, branch.k);
      return {
        key: branch.key, mtSeed,
        rows: branchShinyRows(mtSeed, appointmentTsv, appointmentTrv, window),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tinySeed, appointmentTsv, appointmentTrv, window.minFrame, window.maxFrame]);

  const arm = (mtSeed: number, frame: number) =>
    updateRun({ armedMtSeedHex: toHex32(mtSeed), armedFrame: frame });

  // Step 3 — title check.
  const achieved = run.achievedMtSeedHex ? parseHex32(run.achievedMtSeedHex) : null;
  const classification = tinySeed !== null && achieved !== null
    ? classifyAchievedSeed(tinySeed, achieved) : null;
  const rescanTsv = run.rescanTsv ?? appointmentTsv ?? 0;
  const rescanRows = useMemo(() => {
    if (achieved === null || classification?.kind !== 'unknown' || appointmentTrv === undefined) return [];
    return branchShinyRows(achieved, rescanTsv, appointmentTrv, window);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [achieved, classification?.kind, rescanTsv, appointmentTrv, window.minFrame, window.maxFrame]);

  // Step 4 — park check.
  const [parkCount, setParkCount] = useState(run.parkIndex);
  useEffect(() => { setParkCount(run.parkIndex); }, [run.parkIndex]);
  const [statePaste, setStatePaste] = useState('');
  const parkRow = tinySeed !== null ? idAtIndex(tinyStateFromSeed(tinySeed), parkCount) : null;
  const parkMatches = parkRow !== null && appointment !== null &&
    parkRow.tid === appointment.tid && parkRow.sid === appointment.sid &&
    parkRow.tsv === appointment.tsv && parkRow.trv === appointment.trv;
  const pastedState = useMemo(() => {
    const words = statePaste.trim().split(/[^0-9a-fA-F]+/).filter(Boolean);
    if (words.length !== 4) return null;
    const state = parseEggSeedStr(words.join(','));
    return isTinyState6(state) ? state : null;
  }, [statePaste]);
  const stateMatches = pastedState !== null && parkRow !== null
    ? pastedState.every((word, index) => word === parkRow.state[index]) : null;

  // Step 5 — consecutive timers.
  const [stage, setStage] = useState<'book' | 'confirm' | 'press'>('book');
  const pressMs = run.pressDateTime ? new Date(run.pressDateTime).getTime() : NaN;
  const [aRunning, setARunning] = useState(false);
  const [aRemainingMs, setARemainingMs] = useState<number | null>(null);
  const aBeeps = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (!aRunning || Number.isNaN(pressMs)) return;
    const id = setInterval(() => {
      const remaining = pressMs - Date.now();
      setARemainingMs(Math.max(0, remaining));
      for (const s of [3, 2, 1]) {
        if (remaining <= s * 1000 && remaining > 0 && !aBeeps.current.has(s)) {
          aBeeps.current.add(s);
          beep();
        }
      }
      if (remaining <= 0) {
        setARunning(false);
        setStage('confirm');
        beep(true);
      }
    }, 50);
    return () => clearInterval(id);
  }, [aRunning, pressMs]);

  const targetPress = run.armedFrame !== null ? pressFrameFor(run.armedFrame) : null;
  const [bArmed, setBArmed] = useState(false);
  const [syncFrame, setSyncFrame] = useState(0);
  const [rate, setRate] = useState(SEED_RUN_RATE_INDOORS);
  const [bRunning, setBRunning] = useState(false);
  const [bCurrent, setBCurrent] = useState<number | null>(null);
  const bStart = useRef<{ at: number; frame: number } | null>(null);
  const bBeeps = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (!bRunning || targetPress === null) return;
    const id = setInterval(() => {
      const start = bStart.current;
      if (!start) return;
      const current = start.frame + (performance.now() - start.at) / 1000 * rate;
      setBCurrent(current);
      const toGo = targetPress - current;
      for (const s of [3, 2, 1]) {
        if (toGo <= s * rate && toGo > 0 && !bBeeps.current.has(s)) {
          bBeeps.current.add(s);
          beep();
        }
      }
      if (toGo <= 0) {
        setBRunning(false);
        beep(true);
      }
    }, 31);
    return () => clearInterval(id);
  }, [bRunning, rate, targetPress]);

  // Step 6 — receipt.
  const armedSeed = run.armedMtSeedHex ? parseHex32(run.armedMtSeedHex) : null;
  const activeMtSeed = achieved ?? armedSeed;
  const effTsv = rescanTsv;
  const fit: SeedRunFit | null = useMemo(() => {
    const value = run.receiptHex.trim().length === 8 ? parseHex32(run.receiptHex) : null;
    if (activeMtSeed === null || value === null || appointmentTrv === undefined) return null;
    return fitReceipt(activeMtSeed, effTsv, appointmentTrv, window, run.receiptField, value, run.armedFrame ?? 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMtSeed, effTsv, appointmentTrv, run.receiptHex, run.receiptField, run.armedFrame,
    window.minFrame, window.maxFrame]);
  const fitAttempted = run.receiptHex.trim().length === 8 && parseHex32(run.receiptHex) !== null &&
    activeMtSeed !== null;
  const nextRow = useMemo(() => {
    if (!fit || activeMtSeed === null || appointmentTrv === undefined) return null;
    return nextShinyAfter(
      branchShinyRows(activeMtSeed, effTsv, appointmentTrv, window), fit.row.frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit, activeMtSeed, effTsv, appointmentTrv, window.minFrame, window.maxFrame]);

  return <div className="space-y-3 pb-4">
    <section className={cardClass}>
      <h1 className="text-base font-bold">{t('gen6.seedRun.title')}</h1>
      <p className="text-xs text-zinc-400">{t('gen6.seedRun.intro')}</p>
      <h2 className="text-sm font-semibold">{t('gen6.seedRun.step1')}</h2>
      <div className="grid grid-cols-2 gap-2">
        <label className={labelClass}><span>{t('gen6.seedRun.tinySeed')}</span>
          <input className={`${fieldClass} font-mono tracking-wider`} value={run.tinySeedHex} maxLength={8}
            autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="00000000"
            onChange={event => updateRun({ tinySeedHex: event.target.value.toUpperCase() })} />
        </label>
        <label className={labelClass}><span>{t('gen6.seedRun.pressTime')}</span>
          <input type="datetime-local" step={1} className={fieldClass} value={run.pressDateTime}
            onChange={event => updateRun({ pressDateTime: event.target.value })} />
        </label>
        <NumberField label={t('gen6.seedRun.lag')} value={run.lagMs} max={600000}
          onChange={lagMs => updateRun({ lagMs })} />
        <NumberField label={t('gen6.seedRun.park')} value={run.parkIndex} max={100000}
          onChange={parkIndex => updateRun({ parkIndex })} />
        <NumberField label={t('gen6.seedRun.windowMin')} value={run.windowMin}
          onChange={windowMin => updateRun({ windowMin })} />
        <NumberField label={t('gen6.seedRun.windowMax')} value={run.windowMax}
          onChange={windowMax => updateRun({ windowMax })} />
      </div>
      {seedInvalid && <p role="alert" className="text-xs text-rose-300">{t('gen6.seedRun.tinySeedInvalid')}</p>}
      {appointment && tinySeed !== null && <>
        <h3 className="text-sm font-semibold">{t('gen6.seedRun.appointment')}</h3>
        <IdLine id={appointment} />
        <p className="text-xs text-zinc-400">{t('gen6.seedRun.tinyState')}</p>
        <p className="break-words font-mono text-sm text-amber-300">
          {formatEggSeedStr(tinyStateFromSeed(tinySeed)).replaceAll(',', ', ')}
        </p>
        {!Number.isNaN(pressMs) && <p className="text-xs text-zinc-400">
          {t('gen6.seedRun.seedInstant', { time: new Date(pressMs + run.lagMs).toLocaleString() })}
        </p>}
      </>}
    </section>

    <section className={cardClass}>
      <h2 className="text-sm font-semibold">{t('gen6.seedRun.step2')}</h2>
      {!appointment ? <p className="text-xs text-zinc-400">{t('gen6.seedRun.needSeed')}</p> : <>
        <p className="text-xs text-zinc-400">{t('gen6.seedRun.branchHelp')}</p>
        {branches.map(branch => <div key={branch.key} className="space-y-2">
          <h3 className="font-mono text-sm font-semibold">
            {branch.key} · {t('gen6.seedRun.mtSeed')} {toHex32(branch.mtSeed)}
          </h3>
          <ShinyTable rows={branch.rows} mtSeed={branch.mtSeed}
            armedMtSeedHex={run.armedMtSeedHex} armedFrame={run.armedFrame} onArm={arm} />
        </div>)}
      </>}
    </section>

    <section className={cardClass}>
      <h2 className="text-sm font-semibold">{t('gen6.seedRun.step3')}</h2>
      <p className="text-xs text-zinc-400">{t('gen6.seedRun.titleHelp')}</p>
      <label className={labelClass}><span>{t('gen6.seedRun.achievedSeed')}</span>
        <input className={`${fieldClass} font-mono tracking-wider`} value={run.achievedMtSeedHex} maxLength={8}
          autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="00000000"
          onChange={event => updateRun({ achievedMtSeedHex: event.target.value.toUpperCase() })} />
      </label>
      {classification?.kind === 'branch' && <p className="text-sm text-emerald-300">
        {t('gen6.seedRun.branchHit', { branch: classification.branch, delta: toHex32(classification.delta) })}
      </p>}
      {classification?.kind === 'unknown' && achieved !== null && <>
        <p className="text-sm text-amber-300">
          {t('gen6.seedRun.branchUnknown', { delta: toHex32(classification.delta) })}
        </p>
        <NumberField label={t('gen6.seedRun.rescanTsv')} value={rescanTsv} max={4095}
          onChange={value => updateRun({ rescanTsv: value })} />
        <ShinyTable rows={rescanRows} mtSeed={achieved}
          armedMtSeedHex={run.armedMtSeedHex} armedFrame={run.armedFrame} onArm={arm} />
      </>}
    </section>

    <section className={cardClass}>
      <h2 className="text-sm font-semibold">{t('gen6.seedRun.step4')}</h2>
      {!appointment ? <p className="text-xs text-zinc-400">{t('gen6.seedRun.needSeed')}</p> : <>
        <p className="text-xs text-zinc-400">{t('gen6.seedRun.parkHelp')}</p>
        <NumberField label={t('gen6.seedRun.advances')} value={parkCount} max={100000}
          onChange={setParkCount} />
        {parkRow && <>
          <h3 className="text-sm font-semibold">{t('gen6.seedRun.parkId')}</h3>
          <IdLine id={parkRow} />
          <p className={`text-xs ${parkMatches ? 'text-emerald-300' : 'text-amber-300'}`}>
            {parkMatches ? t('gen6.seedRun.parkMatch') : t('gen6.seedRun.parkMismatch')}
          </p>
        </>}
        <label className={labelClass}><span>{t('gen6.seedRun.statePaste')}</span>
          <input className={`${fieldClass} font-mono tracking-wider`} value={statePaste}
            autoCapitalize="characters" autoComplete="off" spellCheck={false}
            placeholder="00000000, 00000000, 00000000, 00000000"
            onChange={event => setStatePaste(event.target.value.toUpperCase())} />
        </label>
        {statePaste.trim() !== '' && (pastedState === null
          ? <p className="text-xs text-rose-300">{t('gen6.seedRun.stateInvalid')}</p>
          : stateMatches !== null && <p className={`text-xs ${stateMatches ? 'text-emerald-300' : 'text-rose-300'}`}>
              {stateMatches ? t('gen6.seedRun.stateMatch') : t('gen6.seedRun.stateMismatch')}
            </p>)}
      </>}
    </section>

    <section className={cardClass}>
      <h2 className="text-sm font-semibold">{t('gen6.seedRun.step5')}</h2>
      <h3 className="text-sm font-semibold">{t('gen6.seedRun.timerA')}</h3>
      <p className="text-xs text-zinc-400">{t('gen6.seedRun.countdownHelp')}</p>
      <p className="font-mono text-3xl font-bold tabular-nums">
        {aRemainingMs !== null ? formatCountdown(aRemainingMs) : '--:--'}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primaryClass} disabled={aRunning || Number.isNaN(pressMs)}
          onClick={() => { aBeeps.current = new Set(); setARunning(true); }}>
          {t('gen6.seedRun.start')}
        </button>
        <button type="button" className={buttonClass} disabled={!aRunning}
          onClick={() => setARunning(false)}>
          {t('gen6.seedRun.pause')}
        </button>
        <button type="button" className={buttonClass}
          onClick={() => { setARunning(false); setARemainingMs(null); setStage('book'); }}>
          {t('gen6.seedRun.reset')}
        </button>
      </div>
      {stage === 'confirm' && <p className="text-sm text-amber-300">{t('gen6.seedRun.booted')}</p>}
      <button type="button" className={primaryClass} disabled={targetPress === null}
        onClick={() => { setBArmed(true); setStage('press'); }}>
        {t('gen6.seedRun.ready')}
      </button>
      {targetPress === null && <p className="text-xs text-zinc-400">{t('gen6.seedRun.noTarget')}</p>}
      <h3 className="text-sm font-semibold">{t('gen6.seedRun.timerB')}</h3>
      {!bArmed
        ? <p className="text-xs text-zinc-400">{t('gen6.seedRun.notArmed')}</p>
        : <>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label={t('gen6.seedRun.syncFrame')} value={syncFrame} onChange={setSyncFrame} />
            <div>
              <span className="block text-xs font-medium text-zinc-300 mb-1">{t('gen6.seedRun.rate')}</span>
              <div className="grid grid-cols-2 gap-1 rounded-2xl border border-zinc-800 bg-zinc-900 p-1">
                {([SEED_RUN_RATE_INDOORS, SEED_RUN_RATE_OUTDOORS] as const).map(value =>
                  <button key={value} type="button" aria-pressed={rate === value}
                    className="choice-button min-h-10 rounded-xl px-1 text-xs font-semibold"
                    onClick={() => setRate(value)}>
                    {value === SEED_RUN_RATE_INDOORS ? t('gen6.seedRun.rateIndoors') : t('gen6.seedRun.rateOutdoors')}
                  </button>)}
              </div>
            </div>
          </div>
          {run.armedFrame !== null && <p className="font-mono text-xs text-zinc-400">
            {t('gen6.seedRun.targetGen')} {run.armedFrame} · {t('gen6.seedRun.targetPress')} {targetPress}
          </p>}
          <p className="font-mono text-3xl font-bold tabular-nums">
            {bCurrent !== null ? Math.floor(bCurrent) : '------'}
          </p>
          <p className="font-mono text-sm text-zinc-300">
            {t('gen6.seedRun.framesToGo')} {bCurrent !== null && targetPress !== null
              ? Math.max(0, Math.ceil(targetPress - bCurrent)) : '—'}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primaryClass} disabled={bRunning || targetPress === null}
              onClick={() => {
                bStart.current = { at: performance.now(), frame: bCurrent ?? syncFrame };
                bBeeps.current = new Set();
                setBRunning(true);
              }}>
              {t('gen6.seedRun.start')}
            </button>
            <button type="button" className={buttonClass} disabled={!bRunning}
              onClick={() => setBRunning(false)}>
              {t('gen6.seedRun.pause')}
            </button>
            <button type="button" className={buttonClass}
              onClick={() => { setBRunning(false); setBCurrent(null); bStart.current = null; }}>
              {t('gen6.seedRun.reset')}
            </button>
          </div>
        </>}
    </section>

    <section className={cardClass}>
      <h2 className="text-sm font-semibold">{t('gen6.seedRun.step6')}</h2>
      <p className="text-xs text-zinc-400">{t('gen6.seedRun.receiptHelp')}</p>
      <p className="font-mono text-xs text-zinc-400">
        {t('gen6.seedRun.activeStream')} {activeMtSeed !== null ? toHex32(activeMtSeed) : '—'}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <label className={labelClass}><span>{run.receiptField === 'pid' ? 'PID' : 'EC'}</span>
          <input className={`${fieldClass} font-mono tracking-wider`} value={run.receiptHex} maxLength={8}
            autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="00000000"
            onChange={event => updateRun({ receiptHex: event.target.value.toUpperCase() })} />
        </label>
        <div>
          <span className="block text-xs font-medium text-zinc-300 mb-1">PID / EC</span>
          <div className="grid grid-cols-2 gap-1 rounded-2xl border border-zinc-800 bg-zinc-900 p-1">
            {(['pid', 'ec'] as const).map(field =>
              <button key={field} type="button" aria-pressed={run.receiptField === field}
                className="choice-button min-h-10 rounded-xl px-1 text-xs font-semibold uppercase"
                onClick={() => updateRun({ receiptField: field })}>
                {field}
              </button>)}
          </div>
        </div>
      </div>
      {activeMtSeed === null && <p className="text-xs text-zinc-400">{t('gen6.seedRun.noStream')}</p>}
      {fitAttempted && !fit && <p className="text-xs text-rose-300">{t('gen6.seedRun.noFit')}</p>}
      {fit && <>
        <p className="font-mono text-sm">
          {t('gen6.seedRun.trueFrame')} <span className="font-bold text-amber-300">#{fit.row.frame}</span> ·{' '}
          {i18n.getNatureName(fit.row.nature)} · {fit.row.ivs.join('/')} · PID {toHex32(fit.row.pid)} · EC {toHex32(fit.row.ec)}
        </p>
        {run.armedFrame !== null && <p className="text-sm">
          {t('gen6.seedRun.errorVsTarget')}: {fit.error > 0
            ? t('gen6.seedRun.late', { n: fit.error })
            : fit.error < 0
              ? t('gen6.seedRun.early', { n: -fit.error })
              : t('gen6.seedRun.hit')}
        </p>}
        {nextRow
          ? <button type="button" className={primaryClass}
              onClick={() => {
                if (activeMtSeed !== null) arm(activeMtSeed, nextRow.frame);
                setBArmed(true);
                setBRunning(false);
                setBCurrent(null);
                bStart.current = null;
                setStage('press');
              }}>
              {t('gen6.seedRun.rearm', { frame: nextRow.frame })}
            </button>
          : <p className="text-xs text-zinc-400">{t('gen6.seedRun.noNext')}</p>}
      </>}
    </section>
  </div>;
}
