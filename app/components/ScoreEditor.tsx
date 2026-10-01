import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import abcjs from 'abcjs';
import {
  ChevronDown, ChevronsDown, ChevronsUp, ChevronUp, ClipboardPaste, Copy, CopyPlus, FileMusic, Loader2, Maximize2, Piano, Play,
  Redo2, RotateCcw, Save, Scissors, SkipBack, Square, Undo2, Wand2, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import { useI18n } from '../context/I18nContext';
import type { TranslationKey } from '../i18n/translations';
import * as roll from '../services/scoreRoll';
import type { SoundPart } from '../services/scoreRoll';
import { ADD_BARS, COMMON_CHORDS, NEW_BARS, ScoreEngine, type Ask, type Count, type EngineHost, type PartChoice, type Say, type Tab } from '../services/scoreEngine';
import { saveFile } from '../services/saveFile';
import { ConfirmDialog } from './ConfirmDialog';
import { MidiImportDialog, type MidiImported } from './MidiImportDialog';

export interface ScoreEditorProps {
  /** The score in the form when the window opens. */
  abc: string;
  title?: string;
  lyrics: string;
  /** The length set in the form, or null for the automatic one. */
  durationSeconds: number | null;
  cot: 'full' | 'melody' | 'off';
  /** Writes a score with the model from the form's style and lyrics. */
  onCompose: (signal: AbortSignal) => Promise<string>;
  onApply: (abc: string, lyrics: string | null) => void;
  onClose: () => void;
}

const ICON_BUTTON =
  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 transition-colors hover:border-pink-400 hover:text-pink-600 disabled:pointer-events-none disabled:opacity-40 dark:border-white/10 dark:text-zinc-300';
const TEXT_BUTTON =
  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 text-xs font-semibold text-zinc-600 transition-colors hover:border-pink-400 hover:text-pink-600 disabled:pointer-events-none disabled:opacity-40 dark:border-white/10 dark:text-zinc-300';
const SELECT =
  'h-8 rounded-lg border border-zinc-200 bg-white px-2 text-xs text-zinc-700 outline-hidden focus:border-pink-500 disabled:opacity-40 dark:border-white/10 dark:bg-zinc-800 dark:text-zinc-200';
const SEGMENTS = 'inline-flex shrink-0 gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-black/30';
const SEGMENT = 'rounded-md px-2.5 py-1 text-[11px] font-semibold transition-all';
const SEGMENT_ON = 'bg-white text-black shadow-xs dark:bg-zinc-700 dark:text-white';
const SEGMENT_OFF = 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200';
const DIVIDER = 'mx-0.5 h-5 w-px shrink-0 bg-zinc-200 dark:bg-white/10';
const CHANGED_RED = '#C0392B';
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const PARTS: { id: PartChoice; label: string; hint: string }[] = [
  { id: 'Vocal', label: 'scorePartVocal', hint: 'scorePartVocalHint' },
  { id: 'Ins', label: 'scorePartIns', hint: 'scorePartInsHint' },
  { id: 'chords', label: 'scorePartChords', hint: 'scorePartChordsHint' },
  { id: 'both', label: 'scorePartBoth', hint: 'scorePartBothHint' },
];

const HEARD: { part: SoundPart; label: string; hint: string }[] = [
  { part: 'Vocal', label: 'scoreHearVoice', hint: 'scoreHearVoiceHint' },
  { part: 'Ins', label: 'scoreHearIns', hint: 'scoreHearInsHint' },
  { part: 'chords', label: 'scoreHearChords', hint: 'scoreHearChordsHint' },
];

/** The score as sheet music, the bars the edit writes again in red. */
const NotesPaper: React.FC<{ text: string; changed: number[]; say: Say }> = ({ text, changed, say }) => {
  const holder = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    const element = holder.current;
    if (!element) return;
    try {
      abcjs.renderAbc(element, roll.forNotation(text), {
        responsive: 'resize',
        add_classes: true,
        staffwidth: Math.max(600, element.clientWidth - 60),
        paddingtop: 6,
        paddingbottom: 16,
        wrap: { minSpacing: 1.4, maxSpacing: 2.5, preferredMeasuresPerLine: 4 },
      });
      for (const bar of changed) {
        for (const found of element.querySelectorAll<SVGElement>('.abcjs-mm' + bar)) {
          found.style.fill = CHANGED_RED;
          found.style.stroke = CHANGED_RED;
          for (const child of found.querySelectorAll<SVGElement>('*')) child.style.fill = CHANGED_RED;
        }
      }
      setFailed(null);
    } catch (error) {
      setFailed(error instanceof Error ? error.message : String(error));
    }
  }, [text, changed]);
  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-lg bg-[#fbfaf7] px-4 py-3 text-[#222]">
      <p className="mb-2 text-xs text-zinc-600">
        {failed ? say('scoreNotesFailed', { error: failed }) : changed.length ? say('scoreNotesChanged', { bars: changed.map(bar => bar + 1).join(', ') }) : say('scoreNotesPlain')}
      </p>
      <div ref={holder} />
    </div>
  );
};

export const ScoreEditor: React.FC<ScoreEditorProps> = ({ abc, title, lyrics, durationSeconds, cot, onCompose, onApply, onClose }) => {
  const { t, language } = useI18n();
  const say = useCallback<Say>((key, values = {}) => Object.entries(values).reduce((text, [name, value]) => text.split(`{${name}}`).join(String(value)), t(key as TranslationKey)), [t]);
  const count = useCallback<Count>((base, value) => say(`${base}_${new Intl.PluralRules(language).select(value)}`, { count: value }), [say, language]);
  const sayRef = useRef({ say, count });
  sayRef.current = { say, count };
  const [ask, setAsk] = useState<(Ask & { resolve: (ok: boolean) => void }) | null>(null);
  const askRef = useRef<typeof ask>(null);
  askRef.current = ask;
  const confirm = useCallback((question: Ask) => new Promise<boolean>(resolve => setAsk({ ...question, resolve })), []);
  const [engine] = useState(() => {
    const host: EngineHost = {
      say: (key, values) => sayRef.current.say(key, values),
      count: (base, value) => sayRef.current.count(base, value),
      confirm: question => confirm(question),
      changed: () => undefined,
    };
    return new ScoreEngine(host);
  });
  const view = useSyncExternalStore(engine.subscribe, engine.view);
  const rollBox = useRef<HTMLDivElement | null>(null);
  const scroller = useRef<HTMLInputElement | null>(null);
  const dialog = useRef<HTMLDivElement | null>(null);
  const textBox = useRef<HTMLTextAreaElement | null>(null);
  const opener = useRef<Element | null>(null);
  const downOnBackdrop = useRef(false);
  const composing = useRef<AbortController | null>(null);
  const [abcText, setAbcText] = useState(abc.trim());
  const [busyCompose, setBusyCompose] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [imported, setImported] = useState<string | null>(null);
  const [takeWords, setTakeWords] = useState(false);
  const [tempoDraft, setTempoDraft] = useState<string | null>(null);

  useLayoutEffect(() => {
    opener.current = document.activeElement;
    if (rollBox.current) engine.attach(rollBox.current);
    if (scroller.current) engine.attachScroller(scroller.current);
    void engine.open(abc);
    engine.focus();
    return () => {
      composing.current?.abort();
      engine.destroy();
      (opener.current as HTMLElement | null)?.focus?.();
    };
    // the window opens on the score it was given; later changes of the prop are the form's, not the window's
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);

  const limit = useMemo(() => roll.lengthLimit(durationSeconds ?? 0, lyrics), [durationSeconds, lyrics]);
  useEffect(() => engine.setLimit(limit), [engine, limit]);

  useEffect(() => {
    if (document.activeElement !== textBox.current) setAbcText(view.current);
  }, [view.current]);

  const closeAsked = useCallback(async () => {
    if (engine.edited() && !(await confirm({ title: say('scoreCloseTitle'), message: say('scoreCloseMessage'), ok: say('scoreCloseOk'), cancel: say('scoreKeepEditing') }))) return;
    onClose();
  }, [engine, confirm, say, onClose]);

  const keyDown = (event: React.KeyboardEvent) => {
    if (askRef.current || importOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (!engine.escapeInside()) void closeAsked();
      return;
    }
    if (event.key === 'Tab' && dialog.current) {
      const focusable = [...dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(element => element.offsetParent !== null);
      if (focusable.length) {
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
      return;
    }
    engine.key(event.nativeEvent);
  };

  const compose = async () => {
    const controller = new AbortController();
    composing.current = controller;
    setBusyCompose(true);
    engine.tell(say('scoreComposing'));
    try {
      const score = await onCompose(controller.signal);
      if (!controller.signal.aborted) await engine.load(score);
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === 'AbortError')) engine.tell(reason instanceof Error ? reason.message : String(reason), true);
    } finally {
      composing.current = null;
      setBusyCompose(false);
    }
  };

  const apply = async () => {
    await engine.readNow(abcText);
    const { text, problem } = await engine.settled();
    let value = text;
    const typed = abcText.trim();
    if (problem && typed !== text) {
      if (!(await confirm({ title: say('scoreUnreadableTitle'), message: say('scoreUnreadableMessage', { problem }), ok: say('scoreUnreadableOk'), cancel: say('scoreKeepEditing') }))) return;
      value = typed;
    }
    onApply(value, takeWords && imported !== null ? imported : null);
  };

  const saveMidi = async () => {
    const bytes = await engine.midi();
    if (!bytes) return;
    const name = roll.midiFileName(title || 'YuE2 score');
    await saveFile(name, { blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'audio/midi' }) });
    engine.tell(say('scoreMidiSaved', { name }));
  };

  const openImported = (result: MidiImported) => {
    setImportOpen(false);
    setImported(result.lyrics);
    setTakeWords(Boolean(result.lyrics) && !lyrics.trim());
    engine.showTab('roll');
    void engine.load(result.abc, { text: result.summary, bad: false });
  };

  const facts = view.facts;
  const roleBusy = view.busy || busyCompose;
  const drawn = view.drawn;
  const onRoll = view.tab === 'roll';
  const tabs: { id: Tab; label: string; hint: string }[] = [
    { id: 'roll', label: 'scoreTabRoll', hint: 'scoreTabRollHint' },
    { id: 'notes', label: 'scoreTabNotes', hint: 'scoreTabNotesHint' },
    { id: 'abc', label: 'scoreTabAbc', hint: 'scoreTabAbcHint' },
  ];
  const limitHint = facts?.auto
    ? say('scoreLimitAutoHint', { perLine: roll.AUTO_SECONDS_PER_LINE, base: roll.AUTO_BASE_SECONDS, min: roll.AUTO_MIN_SECONDS, max: roll.MAX_SECONDS, instrumental: roll.AUTO_INSTRUMENTAL_SECONDS })
    : say('scoreLimitHint');

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-70 flex items-center justify-center bg-black/60 p-2 sm:p-4"
        onMouseDown={event => { downOnBackdrop.current = event.target === event.currentTarget; }}
        onClick={event => { if (event.target === event.currentTarget && downOnBackdrop.current) void closeAsked(); }}
      >
        <div
          ref={dialog}
          role="dialog"
          aria-modal="true"
          aria-labelledby="score-editor-title"
          onKeyDown={keyDown}
          className="flex h-[94vh] w-full max-w-[1500px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-zinc-900"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-200 px-4 py-3 dark:border-white/10 sm:px-5">
            <h3 id="score-editor-title" className="flex min-w-0 items-center gap-2 text-base font-bold text-zinc-900 dark:text-white">
              <Piano size={18} className="shrink-0 text-pink-500" />
              <span className="truncate">{title?.trim() ? say('scoreEditorOf', { title: title.trim() }) : say('scoreEditor')}</span>
            </h3>
            {facts && (
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                {facts.key && <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 font-semibold dark:bg-white/5">{say('scoreFactKey', { key: facts.key })}</span>}
                <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 dark:bg-white/5">{facts.meter}</span>
                <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 dark:bg-white/5">{say('scoreFactBpm', { bpm: facts.bpm })}</span>
                <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 dark:bg-white/5">{count('scoreBars', facts.bars)}</span>
                <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 tabular-nums dark:bg-white/5">{roll.clock(facts.seconds)}</span>
                {facts.sungUpTo !== null && (
                  <span className="cursor-help rounded-md bg-amber-500/15 px-1.5 py-0.5 font-semibold text-amber-700 dark:text-amber-300" title={limitHint}>
                    {say('scoreSungUpTo', { time: roll.clock(facts.sungUpTo) })}
                  </span>
                )}
              </div>
            )}
            <span className="flex-1" />
            <button type="button" onClick={() => void closeAsked()} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200" aria-label={say('scoreClose')} title={say('scoreClose')}>
              <X size={18} />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 px-4 pt-3 sm:px-5">
            <div className={SEGMENTS} role="tablist" aria-label={say('scoreEditor')}>
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={view.tab === tab.id}
                  title={say(tab.hint)}
                  onClick={() => engine.showTab(tab.id)}
                  className={`${SEGMENT} ${view.tab === tab.id ? SEGMENT_ON : SEGMENT_OFF}`}
                >
                  {say(tab.label)}
                </button>
              ))}
            </div>
            {drawn && (
              <>
                <span className={DIVIDER} />
                <button type="button" onClick={() => engine.togglePlay()} className={`${TEXT_BUTTON} ${view.playing ? '!border-pink-500 !text-pink-600 dark:!text-pink-300' : ''}`} title={say('scorePlayHint')}>
                  {view.playing ? <Square size={13} /> : <Play size={13} />}
                  {say(view.playing ? 'scoreHalt' : 'scorePlay')}
                </button>
                <button type="button" onClick={() => engine.toStart()} className={ICON_BUTTON} title={say('scoreFromStartHint')} aria-label={say('scoreFromStart')}>
                  <SkipBack size={14} />
                </button>
                {HEARD.map(item => (
                  <span key={item.part} className="inline-flex items-center gap-1">
                    <label className="inline-flex cursor-pointer select-none items-center gap-1 text-xs text-zinc-600 dark:text-zinc-300" title={say(item.hint)}>
                      <input type="checkbox" checked={view.hear[item.part]} onChange={event => engine.setHear(item.part, event.target.checked)} className="accent-pink-600" />
                      {say(item.label)}
                    </label>
                    <select
                      value={view.sounds[item.part]}
                      onChange={event => engine.setSound(item.part, event.target.value)}
                      className={`${SELECT} h-7 max-w-[96px] px-1 text-[11px]`}
                      title={say('scoreSoundHint')}
                      aria-label={say(item.label)}
                    >
                      {engine.soundChoices(item.part).map(kind => <option key={kind} value={kind}>{say(`scoreSound_${kind}`)}</option>)}
                    </select>
                  </span>
                ))}
                <span className={DIVIDER} />
                <label className="inline-flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300" title={say('scoreTempoHint')}>
                  {say('scoreTempo')}
                  <input
                    type="range"
                    min={view.tempoLow}
                    max={view.tempoHigh}
                    step={1}
                    value={tempoDraft ?? String(view.tempo ?? roll.TEMPO_LOW)}
                    onChange={event => { setTempoDraft(event.target.value); engine.previewTempo(Number(event.target.value)); }}
                    onPointerUp={event => { engine.setTempo(Number(event.currentTarget.value)); setTempoDraft(null); }}
                    onKeyUp={event => { engine.setTempo(Number(event.currentTarget.value)); setTempoDraft(null); }}
                    className="w-24 accent-pink-600"
                    aria-label={say('scoreTempo')}
                  />
                  <input
                    type="number"
                    min={view.tempoLow}
                    max={view.tempoHigh}
                    value={tempoDraft ?? String(view.tempo ?? '')}
                    onChange={event => setTempoDraft(event.target.value)}
                    onBlur={event => { engine.setTempo(Number(event.target.value)); setTempoDraft(null); }}
                    onKeyDown={event => { if (event.key === 'Enter') { engine.setTempo(Number(event.currentTarget.value)); setTempoDraft(null); } }}
                    className={`${SELECT} w-16 text-right tabular-nums`}
                    aria-label="BPM"
                  />
                  BPM
                </label>
                <label className="inline-flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300" title={say('scoreKeyHint')}>
                  {say('scoreKey')}
                  <select
                    value="0"
                    disabled={!view.keyChoices.length || view.keyBusy}
                    onChange={event => { const shift = Number(event.target.value); if (shift) void engine.changeKey(shift); engine.focus(); }}
                    className={SELECT}
                  >
                    {view.keyChoices.map(choice => <option key={choice.name + choice.shift} value={String(choice.shift)}>{choice.shift ? `${choice.name}  ${roll.keyMove(choice.shift)}` : choice.name}</option>)}
                  </select>
                </label>
              </>
            )}
          </div>

          {drawn && onRoll && (
            <div className="flex flex-wrap items-center gap-2 px-4 pt-2 sm:px-5">
              <div className={SEGMENTS} role="radiogroup" aria-label={say('scorePartVocal')}>
                {PARTS.map(part => (
                  <button
                    key={part.id}
                    type="button"
                    role="radio"
                    aria-checked={view.part === part.id}
                    title={say(part.hint)}
                    onClick={() => engine.pickPart(part.id)}
                    className={`${SEGMENT} ${view.part === part.id ? SEGMENT_ON : SEGMENT_OFF}`}
                  >
                    {say(part.label)}
                  </button>
                ))}
              </div>
              {view.part === 'chords' && (
                <label className="inline-flex cursor-pointer select-none items-center gap-1 text-xs text-zinc-600 dark:text-zinc-300" title={say('scoreRepeatsHint')}>
                  <input type="checkbox" checked={view.repeats} onChange={event => engine.setRepeats(event.target.checked)} className="accent-pink-600" />
                  {say('scoreRepeats')}
                </label>
              )}
              <span className={DIVIDER} />
              <label className="inline-flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300" title={say('scoreSnapHint')}>
                {say('scoreSnap')}
                <select value={String(view.snap)} onChange={event => engine.setSnap(event.target.value === 'finer' ? 'finer' : Number(event.target.value))} className={`${SELECT} max-w-[9.5rem]`}>
                  {view.snapChoices.map(choice => <option key={choice.label} value={String(choice.ticks)}>{say(choice.label)}</option>)}
                  {view.finer && <option value="finer">{say('scoreSnapFiner')}</option>}
                </select>
              </label>
              <select
                value=""
                onChange={event => { if (event.target.value) void engine.addBars(Number(event.target.value)); }}
                className={`${SELECT} max-w-[9.5rem]`}
                title={say('scoreAddBarsHint')}
                aria-label={say('scoreAddBars')}
              >
                <option value="">{say('scoreAddBars')}…</option>
                {ADD_BARS.map(bars => <option key={bars} value={String(bars)}>+ {count('scoreBars', bars)}</option>)}
              </select>
              <span className={DIVIDER} />
              <button type="button" onClick={() => engine.undo()} disabled={!view.canUndo} className={ICON_BUTTON} title={say('scoreUndo')} aria-label={say('scoreUndo')}><Undo2 size={14} /></button>
              <button type="button" onClick={() => engine.redo()} disabled={!view.canRedo} className={ICON_BUTTON} title={say('scoreRedo')} aria-label={say('scoreRedo')}><Redo2 size={14} /></button>
              <span className={DIVIDER} />
              <button type="button" onClick={() => void engine.clipAction('copy')} disabled={!view.picked} className={ICON_BUTTON} title={say('scoreCopy')} aria-label={say('scoreCopy')}><Copy size={14} /></button>
              <button type="button" onClick={() => void engine.clipAction('cut')} disabled={!view.picked} className={ICON_BUTTON} title={say('scoreCut')} aria-label={say('scoreCut')}><Scissors size={14} /></button>
              <button type="button" onClick={() => void engine.clipAction('paste')} disabled={!view.canPaste} className={ICON_BUTTON} title={say('scorePaste')} aria-label={say('scorePaste')}><ClipboardPaste size={14} /></button>
              <button type="button" onClick={() => void engine.clipAction('duplicate')} disabled={!view.picked} className={ICON_BUTTON} title={say('scoreDuplicate')} aria-label={say('scoreDuplicate')}><CopyPlus size={14} /></button>
              <span className={DIVIDER} />
              <button type="button" onClick={() => engine.shiftPicked(0, -12)} disabled={!view.picked} className={ICON_BUTTON} title={say('scoreOctaveDown')} aria-label={say('scoreOctaveDown')}><ChevronsDown size={14} /></button>
              <button type="button" onClick={() => engine.shiftPicked(0, -1)} disabled={!view.picked} className={ICON_BUTTON} title={say('scoreSemitoneDown')} aria-label={say('scoreSemitoneDown')}><ChevronDown size={14} /></button>
              <button type="button" onClick={() => engine.shiftPicked(0, 1)} disabled={!view.picked} className={ICON_BUTTON} title={say('scoreSemitoneUp')} aria-label={say('scoreSemitoneUp')}><ChevronUp size={14} /></button>
              <button type="button" onClick={() => engine.shiftPicked(0, 12)} disabled={!view.picked} className={ICON_BUTTON} title={say('scoreOctaveUp')} aria-label={say('scoreOctaveUp')}><ChevronsUp size={14} /></button>
              <span className={DIVIDER} />
              <button type="button" onClick={() => engine.zoom(1 / 1.4)} className={ICON_BUTTON} title={say('scoreZoomOut')} aria-label={say('scoreZoomOut')}><ZoomOut size={14} /></button>
              <button type="button" onClick={() => engine.zoom(1.4)} className={ICON_BUTTON} title={say('scoreZoomIn')} aria-label={say('scoreZoomIn')}><ZoomIn size={14} /></button>
              <button type="button" onClick={() => engine.fitSong()} className={TEXT_BUTTON} title={say('scoreFitHint')}><Maximize2 size={13} />{say('scoreFit')}</button>
            </div>
          )}

          <div className="flex min-h-0 flex-1 flex-col px-4 pt-3 sm:px-5">
            <div
              ref={rollBox}
              tabIndex={0}
              role="application"
              aria-label={say('scoreRollLabel')}
              className={`relative min-h-[240px] flex-1 overflow-hidden rounded-lg border border-zinc-200 outline-hidden focus-visible:ring-2 focus-visible:ring-pink-500 dark:border-white/10 ${onRoll && drawn ? '' : 'hidden'}`}
            />
            <input ref={scroller} type="range" min={0} step={1} defaultValue={0} aria-label={say('scoreTabRoll')} className={`mt-1.5 w-full accent-pink-600 ${onRoll && drawn ? '' : 'hidden'}`} />
            {view.tab === 'notes' && drawn && <NotesPaper text={view.current} changed={view.changed} say={say} />}
            {view.tab === 'abc' && (
              <textarea
                ref={textBox}
                value={abcText}
                spellCheck={false}
                placeholder={say('scoreAbcPlaceholder')}
                onChange={event => { setAbcText(event.target.value); engine.typed(event.target.value); }}
                className="min-h-[240px] w-full flex-1 resize-none rounded-lg border border-zinc-200 bg-zinc-50 p-3 font-mono text-[12px] leading-5 text-zinc-900 outline-hidden focus:border-pink-500 dark:border-white/10 dark:bg-black/25 dark:text-zinc-100 custom-scrollbar"
              />
            )}
            {view.empty === 'loading' && view.tab !== 'abc' && (
              <div className="m-auto flex items-center gap-2 py-10 text-sm text-zinc-500" role="status">
                <Loader2 size={16} className="animate-spin" /> {say('scoreReading')}
              </div>
            )}
            {!drawn && view.empty !== 'loading' && view.tab !== 'abc' && (
              <div className="m-auto flex max-w-xl flex-col items-center gap-4 px-4 py-10 text-center">
                <Piano size={28} className="text-pink-500" />
                <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-300">{say(view.empty === 'unreadable' ? 'scoreCannotDraw' : 'scoreEmpty')}</p>
                {view.empty === 'empty' && (
                  <div className="flex flex-wrap justify-center gap-2">
                    <button type="button" onClick={() => void compose()} disabled={busyCompose} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-pink-600 px-3.5 text-xs font-bold text-white transition hover:brightness-110 disabled:opacity-60">
                      {busyCompose ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                      {say(busyCompose ? 'scoreComposing' : 'scoreEmptyCompose')}
                    </button>
                    <button type="button" onClick={() => void engine.newScore()} disabled={busyCompose} className={`${TEXT_BUTTON} h-9`}>
                      <Piano size={14} /> {say('scoreEmptyBlank', { bars: count('scoreBars', NEW_BARS) })}
                    </button>
                    <button type="button" onClick={() => setImportOpen(true)} disabled={busyCompose} className={`${TEXT_BUTTON} h-9`}>
                      <FileMusic size={14} /> {say('scoreLoadMidi')}
                    </button>
                    <button type="button" onClick={() => { engine.showTab('abc'); requestAnimationFrame(() => textBox.current?.focus()); }} disabled={busyCompose} className={`${TEXT_BUTTON} h-9`}>
                      {say('scoreEmptyPaste')}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="px-4 sm:px-5">
            <div aria-live="polite" className={`mt-2 min-h-[18px] text-[12px] leading-5 ${view.status.bad ? 'text-red-600 dark:text-red-400' : 'text-zinc-600 dark:text-zinc-300'}`}>
              {view.status.text}
              {view.status.action && (
                <button type="button" onClick={view.status.action.run} className="ml-2 rounded-md border border-zinc-300 px-2 py-0.5 text-[11px] font-semibold text-zinc-700 hover:border-pink-400 hover:text-pink-600 dark:border-white/15 dark:text-zinc-200">
                  {view.status.action.label}
                </button>
              )}
            </div>
            <p className="mt-1 text-[11px] leading-4 text-zinc-500">{say('scoreHonest')}</p>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-zinc-200 px-4 py-3 dark:border-white/10 sm:px-5">
            <button type="button" onClick={() => void saveMidi()} disabled={!view.current.trim() || roleBusy} className={TEXT_BUTTON} title={say('scoreSaveMidiHint')}>
              <Save size={13} /> {say('scoreSaveMidi')}
            </button>
            <button type="button" onClick={() => setImportOpen(true)} disabled={roleBusy} className={TEXT_BUTTON} title={say('scoreLoadMidiHint')}>
              <FileMusic size={13} /> {say('scoreLoadMidi')}
            </button>
            <button type="button" onClick={() => void engine.revert()} disabled={!view.edited || roleBusy} className={TEXT_BUTTON} title={say('scoreResetHint')}>
              <RotateCcw size={13} /> {say('scoreReset')}
            </button>
            <span className="flex-1" />
            {imported !== null && (
              <label className="inline-flex cursor-pointer select-none items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300" title={say('scoreTakeWordsHint')}>
                <input type="checkbox" checked={takeWords} onChange={event => setTakeWords(event.target.checked)} className="accent-pink-600" />
                {say('scoreTakeWords')}
              </label>
            )}
            <button type="button" onClick={() => void closeAsked()} className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
              {say('scoreCancel')}
            </button>
            <button type="button" onClick={() => void apply()} disabled={roleBusy} className="rounded-lg bg-pink-600 px-4 py-2 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-50" title={say('scoreApplyHint')}>
              {say('scoreApply')}
            </button>
          </div>

          <datalist id="score-chords">{COMMON_CHORDS.map(name => <option key={name} value={name} />)}</datalist>
          <datalist id="score-sections">{roll.SECTION_NAMES.map(name => <option key={name} value={name} />)}</datalist>
        </div>
      </div>
      {importOpen && <MidiImportDialog chordsWanted={cot === 'full'} onCancel={() => setImportOpen(false)} onOpen={openImported} />}
      <ConfirmDialog
        isOpen={ask !== null}
        title={ask?.title ?? ''}
        message={ask?.message ?? ''}
        confirmLabel={ask?.ok}
        cancelLabel={ask?.cancel}
        onConfirm={() => { ask?.resolve(true); setAsk(null); }}
        onCancel={() => { ask?.resolve(false); setAsk(null); }}
      />
    </>,
    document.body,
  );
};
