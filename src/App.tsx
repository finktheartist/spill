import { loadPhoto } from "./lib/photo-input";
import { confirmOutlineObservation } from './lib/specialty-review';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Build, PartKind } from './lib/bricks';
import { activeModel, applyDetections, correctDetections, designBuild, designSuper, frameRequest, ideasThatFit, openCatalog, passes, quarantineDetection, type Detection, type Idea, type Mode, type Verdict } from './lib/gemini';
import { renderViews, renderWholeModelViews } from './lib/render';
import { shoppingList } from './lib/catalog';
import { checkScanObservations, crossCheck, decideFromAngles, deepScan, needsHeightCheck, type AngleVote } from './lib/scan';
import {unfinishedScanObservations} from './lib/scan-unfinished';
import { addPart, clearPhotoObservations, colorTotals, counts, proposedCounts, reviewPartType, reviewOtherPiece,reviewUnboxedPart, editPiece, emptyInventory, sampleInventory, setCount, totalParts, usableParts, type Box, type Inventory } from './lib/inventory';
import {applyPieceReviewGroup} from './lib/piece-review-groups';
import { Capture } from './screens/Capture';
import { Parts, type Scan } from './screens/Parts';
import { Builds, assignSlots, newCard, reduceCard, weak, type Card, type Collection, type IdeasState } from './screens/Builds';
import { SHAPE_IDLE, reviewShape, type ShapeTabState } from './components/ShapeCards';
import { runShapeTab,type ShapeSlot } from './lib/shape-first/run';
import {recommendationStockKey,stockEvidence} from './lib/shape-first/stock-evidence';
import { rankIdeas, type ShapeIdea, type ShapeMode } from './lib/shape-first/pipeline';
import { Decisions } from './screens/Decisions';
import { Workbench } from './screens/Workbench';
import { newCardTrace, record, stopped, type CardTrace, type Trace } from './lib/trace';
import { Instructions } from './screens/Instructions';
import { useBuildLibrary } from './hooks/useBuildLibrary';
import { loadDiscoveries, saveDiscovery } from './lib/library-discoveries';
import { inventoryKey } from './lib/shape-first/discovery';
import {inventoryForRestoredRun,readInventorySnapshot} from './lib/inventory-snapshot';
import {buildWholeModel} from './lib/shape-first/whole-model';
import {invalidateRequestStock} from './lib/request-stock-freshness';
import {stopPendingRequests} from './lib/request-cancellation';
import {checkpointFromRun,validateCheckpoint,type WholeModelCheckpoint} from './lib/shape-first/whole-model-checkpoint';
import {inspectBench} from './lib/whole-model-workbench';
import {checkpointDraftBuild,wholeModelRequestResult} from './lib/shape-first/whole-model-draft';

type Screen = 'capture' | 'parts' | 'builds' | 'manual' | 'decisions' | 'bench';
const params = new URLSearchParams(location.search);
const SABOTAGE = params.get('sabotage') === '1';
const THINKING = (params.get('thinking') as 'low' | 'medium' | 'high' | null) ?? undefined;
const REVIEW = params.get('review') !== '0'; // ?review=0 skips the look-and-improve pass
const CANDIDATES = 5;
const DEBUG = params.get('debug') === '1'; // ?debug=1 records every repair round in window.__spillDebug
// New AI designs come from the shape-first builder (Only your pile / With a shopping list); ?engine=classic restores the older one.
const ENGINE = params.get('engine') === 'classic' ? 'classic' : 'shape';

export default function App() {
  const [screen, setScreen] = useState<Screen>(() => params.get('collection') === 'display' ? 'builds' : 'capture');
  const [collection, setCollection] = useState<Collection>(() => params.get('collection') === 'display' ? 'display' : 'bucket');
  const collectionRef=useRef(collection);collectionRef.current=collection;
  const [inv, setInv] = useState<Inventory>(emptyInventory);
  const [discoveries, setDiscoveries] = useState(loadDiscoveries);
  const [libraryNotice, setLibraryNotice] = useState('');
  const stock = useMemo(() => counts(inv), [inv]);
  const library = useBuildLibrary(stock, screen === 'builds' && collection === 'bucket', discoveries);
  const rememberBuild = useCallback((build: Build, verdict: Verdict | undefined, inventory: Inventory) => {
    const result = saveDiscovery(build, verdict, counts(inventory));
    if (result.status === 'saved') { setDiscoveries(result.items); setLibraryNotice(`Saved ${build.name} to your library for next time.`); }
    if (result.status === 'unavailable') setLibraryNotice('This design passed, but browser storage is unavailable. It could not be saved for next time.');
  }, []);
  useEffect(() => { if (DEBUG) (window as unknown as { __spillInv?: Inventory }).__spillInv = inv; }, [inv]); // ?debug=1: QA reads the scanned inventory
  useEffect(() => { if (DEBUG) Object.assign(window, { __spillSheets: [], __spillGate: [], __spillAngle: [] }); }, []);
  // ?debug=1: QA can load a saved scan straight into the parts screen.
  useEffect(() => { if (DEBUG) (window as unknown as { __spillLoad?: (i: Inventory) => void }).__spillLoad = i => { cancelScanning(); changeInventory(()=>i); setScreen('parts'); }; }, []);
  const [scans, setScans] = useState<Scan[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [ideasState, setIdeasState] = useState<IdeasState>({ status: 'idle' });
  const [requests, setRequests] = useState<Card[]>([]);
  const [openNeeds, setOpenNeeds] = useState<Set<string> | undefined>();
  const reqAbort = useRef(new Map<string, AbortController>());
  const [open, setOpen] = useState<Build | null>(null);
  const [openDraft,setOpenDraft]=useState<Build|null>(null);
  const [model, setModel] = useState('…');
  const runFor = useRef(''); // the inventory the current cards were designed for
  const abort = useRef<AbortController | null>(null);
  const invRef = useRef(inv);
  invRef.current = inv;

  useEffect(() => { activeModel().then(m => setModel(m.model)); }, []);

  // ?view=/dev-builds/x.json opens a saved build straight in the instruction viewer
  useEffect(() => {
    const v = params.get('view');
    if (!v) return;
    fetch(v).then(r => r.json()).then((b: Build) => { setInv(sampleInventory()); setOpen(b); setScreen('manual'); });
  }, []);

  const scanEpoch=useRef(0);
  const photoAbort=useRef(new Map<number,AbortController>());
  const recoveryAbort=useRef<AbortController|null>(null);
  const [recovering,setRecovering]=useState(false);
  function cancelScanning(){scanEpoch.current++;recoveryAbort.current?.abort();recoveryAbort.current=null;setRecovering(false);photoAbort.current.forEach(c=>c.abort());photoAbort.current.clear();angleVotes.current.clear();}
  const fullRes = useRef(new Map<number, HTMLCanvasElement>());
  const detailSources = useRef(new Map<number, () => Promise<ImageBitmap>>());

  const scan = useCallback(async (photo: number) => {
    const full = fullRes.current.get(photo);
    if (!full) return;
    photoAbort.current.get(photo)?.abort();
    const ctl=new AbortController(),epoch=scanEpoch.current;photoAbort.current.set(photo,ctl);
    const active=()=>!ctl.signal.aborted&&scanEpoch.current===epoch&&photoAbort.current.get(photo)===ctl;
    changeInventory(i=>clearPhotoObservations(i,photo));
    const patchScan = (p: Partial<Scan>) => {if(active())setScans(s => s.map(x => (x.photo === photo ? { ...x, ...p, lastProgressAt: Date.now() } : x)));};
    setScans(s => [...s.filter(x => x.photo !== photo), { photo, status: 'scanning', startedAt: Date.now(), lastProgressAt: Date.now(), phase: 'survey', tiles: [], estimate: 0 }]);
    try {
      await deepScan(full, {
        onDetections: d => {if(active()){changeInventory(i => applyDetections(i, d, photo));patchScan({});}},
        onCorrections: c => {if(active()){changeInventory(i => correctDetections(i, c, photo));patchScan({});}},
        onProgress: p => patchScan({ phase: p.phase, tiles: p.tiles, estimate: p.estimate, sheets: p.sheets, timedOutChecks: p.timedOutChecks }),
      },ctl.signal,{ detailSource: detailSources.current.get(photo), onDetailRetry: event => {
        if (DEBUG) ((window as unknown as { __spillDetailRetries?: unknown[] }).__spillDetailRetries ??= []).push(event);
      } });
      patchScan({ status: 'done' });
    } catch (e) {
      patchScan({ status: 'error', error: (e as Error).message });
    }finally{if(photoAbort.current.get(photo)===ctl)photoAbort.current.delete(photo);}
  }, []);

  const [photoError, setPhotoError] = useState('');
  const retryUnfinished = async () => {
    if (photoAbort.current.size || recoveryAbort.current) return;
    const pending = unfinishedScanObservations(invRef.current);
    if (!pending.size) return;
    const ctl = new AbortController(), epoch = scanEpoch.current;
    recoveryAbort.current = ctl; setRecovering(true); setPhotoError('');
    const active = () => scanEpoch.current === epoch && recoveryAbort.current === ctl;
    try {
      for (const [photo, pieces] of pending) {
        ctl.signal.throwIfAborted();
        const startedAt = Date.now();
        const patch = (p: Partial<Scan>) => { if (active()) setScans(s => s.map(x => x.photo === photo ? {...x, ...p, lastProgressAt: Date.now()} : x)); };
        setScans(s => [...s.filter(x => x.photo !== photo), {photo, status: 'scanning', phase: 'check', recovery: true,
          startedAt, lastProgressAt: startedAt, tiles: [], estimate: pieces.length}]);
        try {
          const loadSaved = async (id: number) => {
            const cached = fullRes.current.get(id);
            if (cached) return cached;
            const saved = invRef.current.photos.find(p => p.id === id);
            if (!saved) throw Error('The source photo is no longer available.');
            const response = await fetch(saved.url, {signal: ctl.signal});
            if (!response.ok) throw Error('Could not open the saved photo.');
            const loaded = await loadPhoto(new File([await response.blob()], 'saved-scan.jpg', {type: 'image/jpeg'}));
            ctl.signal.throwIfAborted();
            if (active()) fullRes.current.set(id, loaded.full);
            return loaded.full;
          };
          const full = await loadSaved(photo), angles = invRef.current.photos.filter(p => p.ref === photo);
          const held: {from: Detection; to: Detection}[] = [];
          let closeUpTimeouts = 0;
          await checkScanObservations(full, pieces, {
            onCorrections: changes => {
              if (!active() || ctl.signal.aborted) return;
              const ready = changes.filter(c => {
                if (angles.length && c.to && needsHeightCheck(c.to)) {held.push({from: c.from, to: c.to}); return false;}
                return true;
              });
              if (ready.length) changeInventory(i => correctDetections(i, ready, photo));
            },
            onProgress: p => { closeUpTimeouts = p.timedOutChecks; if (!ctl.signal.aborted) patch({sheets: {done: p.done, total: p.total}, timedOutChecks: p.timedOutChecks}); },
          }, ctl.signal, {detailSource: detailSources.current.get(photo), retainObserved: true});
          if (held.length) {
            const votes = new Map<Detection, AngleVote[]>();
            let previousDone = 0, previousTotal = 0, angleTimeouts = 0;
            for (const anglePhoto of angles) {
              ctl.signal.throwIfAborted();
              try {
                const angle = await loadSaved(anglePhoto.id);
                let stageDone = 0, stageTotal = 0, stageTimeouts = 0;
                const results = await crossCheck(full, held.map(c => c.to), angle, {onProgress: (done, total, timedOut) => {
                  stageDone = done; stageTotal = total; stageTimeouts = timedOut;
                  if (!ctl.signal.aborted) patch({phase: 'cross', sheets: {done: previousDone + done, total: previousTotal + total}, timedOutChecks: closeUpTimeouts + angleTimeouts + timedOut});
                }}, ctl.signal);
                for (const {det, vote} of results) votes.set(det, [...(votes.get(det) ?? []), vote]);
                previousDone += stageDone; previousTotal += stageTotal; angleTimeouts += stageTimeouts;
              } catch (error) { if (ctl.signal.aborted) throw error; /* No clear side view leaves the held pieces in review. */ }
            }
            ctl.signal.throwIfAborted();
            if (active()) changeInventory(i => correctDetections(i, held.map(({from, to}) => {
              const decision = decideFromAngles(to.kind!, votes.get(to) ?? [], true);
              return {from, to: 'kind' in decision ? {...to, kind: decision.kind} : quarantineDetection(to, decision.other)};
            }), photo));
          }
          patch({status: 'done'});
        } catch (error) {
          patch({status: 'error', error: ctl.signal.aborted ? 'Retry stopped. Completed results were kept.' : (error as Error).message});
          if (ctl.signal.aborted) break;
        }
      }
    } catch (error) {
      if (active() && !ctl.signal.aborted) setPhotoError((error as Error).message);
    } finally {
      if (recoveryAbort.current === ctl) { recoveryAbort.current = null; setRecovering(false); }
    }
  };
  /**
   * An angled photo of a pile already scanned: never counted, only used to cross-check the straight-down scan for
   * what it can't show (plate or brick, stacked pieces). Pieces are found in it by their neighbors, then judged from both views.
   */
  // Every angled photo's votes per piece (keyed by the piece's box in the straight-down photo), with its first
  // reading, so each new angle re-decides from all the evidence instead of overriding the last one.
  const angleVotes = useRef(new Map<Box, { orig: PartKind; votes: AngleVote[] }>());

  const cross = useCallback(async (target: number, id: number) => {
    const top = fullRes.current.get(target), angle = fullRes.current.get(id);
    if (!top || !angle) return;
    const ctl=new AbortController(),epoch=scanEpoch.current;photoAbort.current.set(id,ctl);
    const active=()=>!ctl.signal.aborted&&scanEpoch.current===epoch&&photoAbort.current.get(id)===ctl;
    angle.dataset.photo = String(id); // for the ?debug=1 log of which angled photo matched what
    const patch = (p: Partial<Scan>) => {if(active())setScans(s => s.map(x => (x.photo === id ? { ...x, ...p, lastProgressAt: Date.now() } : x)));};
    setScans(s => [...s, { photo: id, status: 'scanning', startedAt: Date.now(), lastProgressAt: Date.now(), phase: 'cross', tiles: [], estimate: 0, sheets: { done: 0, total: 0 } }]);
    // the current readings for that photo, built on the inventory's own box objects so corrections find them
    const reading = (inv: Inventory) => Object.values(inv.parts).flatMap(e => e.boxes.filter(b => b.photo === target)
      .map(b => ({ kind: e.kind, description: e.kind.partId, color: e.kind.color, box: b.box, confidence: b.confidence??e.confidence } as Detection)));
    try {
      // one look per piece in the photo; a clump the scan already split into parts isn't re-judged as one part
      const seen = new Map<Box, Detection[]>();
      for (const d of reading(invRef.current)) seen.set(d.box, [...(seen.get(d.box) ?? []), d]);
      const pieces = [...seen].filter(([box, ds]) => ds.length === 1 || angleVotes.current.has(box)).map(([, ds]) => ds[0]);
      const results = await crossCheck(top, pieces, angle, { onProgress: (done, total, timedOutChecks) => patch({ sheets: { done, total }, timedOutChecks }) },ctl.signal);
      if(!active())return;
      for (const { det, vote } of results) {
        const e = angleVotes.current.get(det.box) ?? { orig: det.kind!, votes: [] };
        e.votes.push(vote);
        angleVotes.current.set(det.box, e);
      }
      // re-decide every piece any angle has seen, and correct those whose decision differs from their reading now
      const now = new Map<Box, Detection[]>();
      for (const d of reading(invRef.current)) now.set(d.box, [...(now.get(d.box) ?? []), d]);
      const ids = (ds: Detection[]) => ds.map(d => d.kind!.partId).sort().join();
      const changes = [...angleVotes.current].flatMap(([box, { orig, votes }]): { from: Detection; to: Detection | Detection[] | null }[] => {
        const here = now.get(box);
        if (!here?.length) return [];
        const cur = here[0];
        const decision = decideFromAngles(orig, votes);
        const want: Detection[] | Detection = 'kind' in decision ? { ...cur, kind: decision.kind }
          : { ...cur, kind: null, description: decision.other };
        const same = Array.isArray(want) ? ids(want) === ids(here) : want.kind ? here.length === 1 && want.kind.partId === cur.kind!.partId : false;
        if (same) return [];
        // take out every part now on this box, then put in what the angles say is there
        return here.map((from, i) => ({ from, to: i === here.length - 1 ? want : null }));
      });
      for (const c of changes) if (c.to) (globalThis as { __spillGate?: unknown[] }).__spillGate?.push({ description: c.from.kind?.partId, named: c.from.kind?.partId, why: `angles decided: ${Array.isArray(c.to) ? c.to.map(d => d.kind?.partId).join(' + ') : c.to.kind?.partId ?? c.to.description}` });
      if (changes.length) changeInventory(i => correctDetections(i, changes, target));
      patch({ status: 'done' });
    } catch (e) {
      patch({ status: 'error', error: (e as Error).message });
    }finally{if(photoAbort.current.get(id)===ctl)photoAbort.current.delete(id);}
  }, []);

  const addAngle = useCallback(async (file: File) => {
    const epoch=scanEpoch.current;
    setPhotoError('');
    const target = [...invRef.current.photos].reverse().find(p => !p.ref)?.id;
    if (!target) { setPhotoError('Add a photo taken straight down first. Angled photos only check it.'); return; }
    let photo: Awaited<ReturnType<typeof loadPhoto>>;
    try { photo = await loadPhoto(file); } catch (e) { setPhotoError((e as Error).message || "Couldn't open that photo."); return; }
    if(scanEpoch.current!==epoch)return;
    const id = Date.now();
    fullRes.current.set(id, photo.full);
    changeInventory(i => ({ ...i, photos: [...i.photos, { id, url: photo.url, ref: target }] }));
    cross(target, id);
  }, [cross]);

  // The first screen collects one photo from above (it counts the parts) and any angled photos of the same pile
  // (they cross-check it), decoded as they're picked so they can be shown; "Scan my pile" starts.
  type Loaded = Awaited<ReturnType<typeof loadPhoto>>;
  const [staged, setStaged] = useState<{ main?: Loaded; angles: Loaded[]; loading: number }>({ angles: [], loading: 0 });
  const stagePhotos = useCallback(async (files: File[], slot: 'main' | 'angle') => {
    setPhotoError('');
    setStaged(s => ({ ...s, loading: s.loading + files.length }));
    for (const f of files) {
      try {
        const p = await loadPhoto(f);
        setStaged(s => (slot === 'main' ? { ...s, main: p } : { ...s, angles: [...s.angles, p] }));
      } catch (e) {
        setPhotoError((e as Error).message || `Couldn't open ${f.name}.`);
      } finally {
        setStaged(s => ({ ...s, loading: s.loading - 1 }));
      }
    }
  }, []);

  /** Count the photo from above, then check it from each angled photo in turn (their votes add up). */
  const start = async (main: Loaded, angles: Loaded[]) => {
    const epoch=scanEpoch.current;
    const base = Date.now();
    const top = base, ids = angles.map((_, i) => base + 1 + i);
    fullRes.current.set(top, main.full);
    detailSources.current.set(top, main.detailSource);
    angles.forEach((a, i) => fullRes.current.set(ids[i], a.full));
    changeInventory(i => ({ ...i, source: 'photo', photos: [...i.photos, { id: top, url: main.url }, ...angles.map((a, k) => ({ id: ids[k], url: a.url, ref: top }))] }));
    setScreen('parts');
    await scan(top);
    for (const id of ids) {
      if(scanEpoch.current!==epoch)return;
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); // let the scan's last readings land
      await cross(top, id);
    }
  };

  const addPhoto = useCallback(async (file: File) => {
    const epoch=scanEpoch.current;
    setPhotoError('');
    let photo: Awaited<ReturnType<typeof loadPhoto>>;
    try { photo = await loadPhoto(file); } catch (e) { setPhotoError((e as Error).message || "Couldn't open that photo."); return; }
    if(scanEpoch.current!==epoch)return;
    const { full, url } = photo;
    const id = Date.now();
    fullRes.current.set(id, full);
    detailSources.current.set(id, photo.detailSource);
    changeInventory(i => ({ ...i, source: 'photo', photos: [...i.photos, { id, url }] }));
    setScreen('parts');
    scan(id);
  }, [scan]);

  // One abort controller per candidate, so backups can be stopped once three builds are ready.
  const candAbort = useRef<AbortController[]>([]);
  // The workbench: what it opened with (empty, or a build to remix), keyed so each opening starts fresh
  const [bench, setBench] = useState<{ build?: Build; goal?: string; key: number }>({ key: 0 });
  const keepBench = useCallback((build: Build, goal: string) => setBench(b => ({ ...b, build, goal })), []);
  const [fromBench, setFromBench] = useState(false);
  // How the builder decided this run, for the "How it decided" screen
  const [trace, setTrace] = useState<Trace | null>(null);
  useEffect(() => {
    if (DEBUG) (window as unknown as { __spillTrace?: Trace | null }).__spillTrace = trace;
  }, [trace]);
  const traceCard = (i: number, f: (c: CardTrace) => CardTrace) => setTrace(t => (t && t.cards[i] ? { ...t, cards: t.cards.map((c, j) => (j === i ? f(c) : c)) } : t));

  // Shape-first tabs: each runs on demand against the parts as they are when it starts.
  const [shapeRuns, setShapeRuns] = useState<Record<ShapeMode, ShapeTabState>>({ pile: SHAPE_IDLE, shopping: SHAPE_IDLE });
  const [restoredRun,setRestoredRun]=useState<{key:string;slots:ShapeSlot[]}|null>(null);
  const shapeAbort = useRef<Record<ShapeMode, AbortController | null>>({ pile: null, shopping: null });
  function changeInventory(update:(i:Inventory)=>Inventory) {
    const before=invRef.current,next=update(before);
    // One transition pays for both invalidation and state. Advancing the ref
    // immediately also makes batched edits observe the latest exact ledger.
    invRef.current=next;
    if(inventoryKey('pile',counts(before))!==inventoryKey('pile',counts(next))){
      shapeAbort.current.pile?.abort();shapeAbort.current.shopping?.abort();reqAbort.current.forEach(c=>c.abort());
      setRequests(rs=>invalidateRequestStock(rs,counts(next)));
    }
    setInv(next);
    return next!==before;
  }
  useEffect(() => { if (DEBUG) (window as unknown as { __spillShape?: unknown }).__spillShape = shapeRuns; }, [shapeRuns]); // ?debug=1: QA reads every card's log and stats
  const resetShape = useCallback(() => {
    shapeAbort.current.pile?.abort(); shapeAbort.current.shopping?.abort();
    setShapeRuns({ pile: SHAPE_IDLE, shopping: SHAPE_IDLE });
  }, []);
  const stopShape=(mode:ShapeMode)=>{
    shapeAbort.current[mode]?.abort();
    setShapeRuns(r=>({...r,[mode]:{...r[mode],status:'done',slots:r[mode].slots.map(s=>['ready','failed'].includes(s.phase)?s:{...s,phase:'failed',log:[...s.log,{text:'Stopped. No unfinished model was substituted.',tone:'note'}]})}}));
  };
  const recommendationEvidence=useMemo(()=>stockEvidence(inv),[inv]);
  const shapeStockKey=useMemo(()=>recommendationStockKey(stock,recommendationEvidence),[stock,recommendationEvidence]);
  useEffect(()=>{resetShape();if(!params.get('view')&&collectionRef.current!=='display'){setOpen(null);setScreen(s=>s==='manual'?'parts':s);}},[shapeStockKey,resetShape]);
  useEffect(()=>{if(restoredRun?.key===shapeStockKey){setShapeRuns(r=>({...r,pile:{status:'done',slots:restoredRun.slots}}));setRestoredRun(null);}},[restoredRun,shapeStockKey]);
  // Unknown observations stay in review. They never block use of the separate,
  // confidence-qualified stock ledger, and never enter it through this gate.
  function needsBuildStock(minimum=20){
    if(photoAbort.current.size){setPhotoError('Wait for photo scanning to finish before starting a build.');setScreen('parts');return true;}
    if(usableParts(invRef.current)>=minimum)return false;
    setPhotoError(`You need at least ${minimum} usable ${minimum===1?'piece':'pieces'} for this. Uncertain and unsupported pieces stay out of builds.`);
    setScreen('parts');return true;
  }
  const runShape = useCallback((mode: ShapeMode, avoid: string[] = [], selected?:ShapeIdea,resumeSlot?:ShapeSlot) => {
    if(mode==='pile'&&needsBuildStock())return;
    const snapshot = invRef.current, total = usableParts(snapshot);
    const snapshotStock=counts(snapshot),evidence=stockEvidence(snapshot),key=recommendationStockKey(snapshotStock,evidence);
    shapeAbort.current[mode]?.abort();
    const ctl = new AbortController();
    const active=()=>!ctl.signal.aborted&&recommendationStockKey(counts(invRef.current),stockEvidence(invRef.current))===key;
    shapeAbort.current[mode] = ctl;
    setShapeRuns(r => ({ ...r, [mode]: { status: 'running', slots: resumeSlot?r[mode].slots:[],startedAt:Date.now() } }));
    runShapeTab(mode, snapshotStock, slots => { if (active()) setShapeRuns(r => ({ ...r, [mode]: { ...r[mode], slots:resumeSlot?r[mode].slots.map(s=>s.key===resumeSlot.key?{...slots[0],key:s.key}:s):slots } })); },
      { signal: ctl.signal, avoid,stockEvidence:evidence, ideas:selected?rankIdeas([selected],snapshotStock,mode):undefined, editableModel:true, wholeViews:renderWholeModelViews, views: renderViews, judge: (b, idea, signal) => reviewShape(b, idea, total, signal ?? ctl.signal),
        resume:resumeSlot?.checkpoint,resumeFeedback:resumeSlot?.verdict?.fixes.join('; '),
        onStatus:statusLine=>{if(active())setShapeRuns(r=>({...r,[mode]:{...r[mode],statusLine}}));},
        debug:DEBUG?(label,data)=>{const w=window as unknown as {__spillDebug?:unknown[]};(w.__spillDebug??=[]).push({label,data});}:undefined })
      .then(async run => {
        if(!active())return;
        setShapeRuns(r => ({ ...r, [mode]: { ...r[mode], status: 'done', small: run.small } }));
        if(mode==='pile')for(const slot of run.slots) {
          if(!active())return;
          if(slot.phase==='ready'&&slot.idea.atlas){const {saveAtlasDesign}=await import('./lib/build-atlas/cache');
            if(!active())return;const saved=await saveAtlasDesign(slot,snapshotStock,ctl.signal);
            if(active()&&saved.status==='saved')setLibraryNotice(`Saved ${slot.idea.name}. Open its instructions from the idea catalog next time.`);
          }
        }
      })
      .catch(e => { if (active()) setShapeRuns(r => ({ ...r, [mode]: { ...r[mode], status: 'error', error: (e as Error).message } })); });
  }, []);

  const runCard = useCallback(async (i: number, idea: Idea, snapshot: Inventory, parent: AbortSignal) => {
    if(!openCatalog(idea.mode)&&needsBuildStock())return {idea,build:undefined,verdict:undefined,reason:'Not enough usable pieces, or photo scanning is still running.',stopped:true};
    const total = usableParts(snapshot);
    const ctl = new AbortController();
    const stop = () => ctl.abort();
    parent.addEventListener('abort', stop, { once: true });
    if (parent.aborted) ctl.abort();
    candAbort.current[i]?.abort();
    candAbort.current[i] = ctl;
    setCards(cs => cs.map((c, j) => (j === i ? newCard(idea) : c)));
    traceCard(i, () => newCardTrace(idea));
    let verdict: Verdict | undefined, reason: string | undefined;
    const build = await designBuild(snapshot, idea, e => {
      if (e.phase === 'ready') verdict = e.verdict;
      if (e.phase === 'failed') reason = e.reason;
      if (ctl.signal.aborted) return;
      setCards(cs => cs.map((c, j) => (j === i ? reduceCard(c, e, total) : c))); traceCard(i, c => record(c, e));
    },
      {
        signal: ctl.signal, sabotage: SABOTAGE && i === 0, thinking: THINKING, views: REVIEW ? renderViews : undefined, judge: true,
        debug: DEBUG ? (label, data) => { const w = window as unknown as { __spillDebug?: unknown[] }; (w.__spillDebug ??= []).push({ idea: idea.name, label, data }); } : undefined,
      });
    parent.removeEventListener('abort', stop);
    if (build && !ctl.signal.aborted) rememberBuild(build, verdict, snapshot);
    if (build && DEBUG) { const w = window as unknown as { __spillDebug?: unknown[] }; (w.__spillDebug ??= []).push({ idea: idea.name, label: 'final', data: build }); }
    return { idea, build, verdict, reason, stopped: ctl.signal.aborted };
  }, [rememberBuild]);

  const slots = assignSlots(cards);
  // Once all three visible builds are ready, stop the backups that are still working.
  useEffect(() => {
    if (slots.length < 3 || !slots.every(s => s.card.phase === 'ready' && !weak(s.card))) return;
    const shown = new Set(slots.map(s => s.index));
    cards.forEach((c, i) => { if (!shown.has(i) && !['ready', 'failed'].includes(c.phase)) { candAbort.current[i]?.abort(); traceCard(i, c2 => stopped(c2)); } });
  }, [cards, slots]);

  // ideas already tried with THIS set of parts, so "Suggest different builds" brings new ones; a new set starts fresh
  const tried = useRef<{ key: string; names: string[] }>({ key: '', names: [] });
  const findBuilds = useCallback(async (force = false) => {
    if(needsBuildStock())return;
    setCollection('bucket');
    setScreen('builds');
    const snapshot = invRef.current;
    const key = JSON.stringify(counts(snapshot));
    if (!force && key === runFor.current) return;
    runFor.current = key;
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setCards([]);
    if (!force) {
      setTrace(null);
      setIdeasState({ status: 'idle' });
      resetShape();
      return;
    }
    setIdeasState({ status: 'loading' });
    try {
      if (tried.current.key !== key) tried.current = { key, names: [] };
      // ideas from the parts alone; only ones whose parts lists fit the bucket are built
      const started = Date.now();
      const { ideas, rounds } = await ideasThatFit(snapshot, CANDIDATES, ctl.signal, tried.current.names);
      if (ctl.signal.aborted) return;
      setTrace({
        startedAt: started, pipeline: 'quality-v3',
        pile: { usable: usableParts(snapshot), kinds: Object.keys(counts(snapshot)).length, other: snapshot.others.length, colors: colorTotals(snapshot).map(c => [c.color, c.total]) },
        ideaRounds: rounds, cards: ideas.map(newCardTrace),
      });
      tried.current.names.push(...ideas.map(i => i.name));
      if (!ideas.length) throw new Error("none of the ideas fit these parts");
      setIdeasState({ status: 'done' });
      setCards(ideas.map(newCard));
      const outcomes = await Promise.all(ideas.map((idea, i) => runCard(i, idea, snapshot, ctl.signal)));
      if (ctl.signal.aborted) return;
      const good = outcomes.filter(o => o.build && (!o.verdict || passes(o.verdict))).length;
      // One bounded second batch uses actual construction/appearance failures as planning constraints.
      if (good < 3 && !outcomes.some(o => o.stopped)) {
        setTrace(t => t && ({ ...t, searching: true }));
        const feedback = outcomes.filter(o => !o.build || (o.verdict && !passes(o.verdict))).map(o =>
          `${o.idea.name}: ${o.reason ?? `looked like ${o.verdict?.looksLike}; ${o.verdict?.fixes.join('; ')}`}`);
        let next: Awaited<ReturnType<typeof ideasThatFit>>;
        try {
          next = await ideasThatFit(snapshot, Math.min(3, 3 - good), ctl.signal, tried.current.names, feedback);
        } catch (e) {
          if (!ctl.signal.aborted) setTrace(t => t && ({ ...t, searching: false, searchError: (e as Error).message }));
          return;
        }
        if (ctl.signal.aborted) return;
        tried.current.names.push(...next.ideas.map(i => i.name));
        setTrace(t => t && ({ ...t, searching: false, ideaRounds: [...t.ideaRounds, ...next.rounds], cards: [...t.cards, ...next.ideas.map(newCardTrace)] }));
        setCards(cs => [...cs, ...next.ideas.map(newCard)]);
        await Promise.all(next.ideas.map((idea, i) => runCard(ideas.length + i, idea, snapshot, ctl.signal)));
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      runFor.current = '';
      setIdeasState({ status: 'error', error: (e as Error).message });
    }
  }, [runCard, resetShape]);

  /**
   * A typed request ("lion") runs three ways side by side: from your bucket, most accurate (any part,
   * with a parts list), and super fidelity (any part, any size, built section by section).
   * Each is framed, then designed; the first two get one fresh retry if they can't stand up.
   */
  const runVariant = useCallback(async (text: string, key: string, mode: Mode, replace: boolean,resume?:WholeModelCheckpoint) => {
    if(mode==='bucket'&&needsBuildStock())return;
    setScreen('builds');
    const snapshot = invRef.current;
    const total = usableParts(snapshot);
    reqAbort.current.get(key)?.abort();
    const ctl = new AbortController();
    reqAbort.current.set(key, ctl);
    const update = (f: (c: Card) => Card) => setRequests(rs => rs.map(c => (c.key === key ? f(c) : c)));
    const first = { bucket: 'Planning it around your parts…', accurate: 'Planning the most accurate version…', super: 'Planning a super-fidelity display model…' }[mode];
    const placeholder: Card = {
      ...newCard({ name: text, pitch: first, estimatedParts: 0, difficulty: 2, keyParts: [], request: text, mode }),
      key, phase: 'designing', log: [{ text: first, tone: 'work', t: 0 }],
    };
    setRequests(rs => {
      if (replace) return rs.map(c => (c.key === key ? placeholder : c));
      // The variants of one request sit side by side in order: bucket, accurate, super.
      if (mode !== 'bucket') {
        const base = key.replace(/-(acc|sup)$/, '');
        const i = Math.max(rs.findIndex(c => c.key === base), rs.findIndex(c => c.key === `${base}-acc`));
        const out = [...rs]; out.splice(i + 1, 0, placeholder); return out;
      }
      return [placeholder, ...rs];
    });
    try {
      if(mode==='bucket'&&ENGINE==='shape'){
        const requested=resume?.idea??{name:text.trim().slice(0,80),pitch:'An original miniature shaped around your available pieces.',why:'Your requested subject.',length:10,width:8,height:8,palette:[],cells:0,worst:1,shortfall:0};
        const a=await buildWholeModel(requested,counts(snapshot),{signal:ctl.signal,views:renderWholeModelViews,judge:(b,i,s)=>reviewShape(b,i,total,s),resume,
          onCheckpoint:checkpoint=>update(c=>{const b=inspectBench(checkpoint.state).build;return {...c,checkpoint,preview:b?{...b,name:requested.name}:undefined,partsUsed:checkpoint.state.pieces.length};}),
          onProgress:e=>update(c=>({...c,phase:e.phase==='judging'?'judging':e.phase==='revising'?'fixing':'designing',log:[...c.log,{text:e.text,tone:'work',t:Math.round((Date.now()-c.startedAt)/1000)}]})),
          debug:DEBUG?(label,data)=>{const w=window as unknown as {__spillDebug?:unknown[]};(w.__spillDebug??=[]).push({label,data});}:undefined});
        if(ctl.signal.aborted)return;
        update(c=>wholeModelRequestResult(c,a));
        if(a.verdict.pass&&a.verdict.named&&a.verdict.recognizable>=2)rememberBuild(a.build,a.verdict,snapshot);return;
      }
      const idea = await frameRequest(snapshot, text, ctl.signal, mode);
      update(c => ({ ...newCard(idea), key, startedAt: c.startedAt, log: [...c.log, { text: `Planned: ${idea.name}, mostly ${idea.mainColor}`, tone: 'good', t: Math.round((Date.now() - c.startedAt) / 1000) }] }));
      // A super build takes many minutes, so it gets one attempt; its fallbacks live inside designSuper.
      for (let attempt = 1; attempt <= (mode === 'super' ? 1 : 2); attempt++) {
        let verdict: Verdict | undefined;
        const b = await (mode === 'super' ? designSuper : designBuild)(snapshot, idea, e => { if (e.phase === 'ready') verdict = e.verdict; update(c => reduceCard(c, e, total)); }, {
          signal: ctl.signal, thinking: THINKING, views: REVIEW ? renderViews : undefined,
          debug: DEBUG ? (label, data) => { const w = window as unknown as { __spillDebug?: unknown[] }; (w.__spillDebug ??= []).push({ idea: `${idea.name} (${mode})`, label, data }); } : undefined,
        });
        if (b && mode === 'bucket' && !ctl.signal.aborted) rememberBuild(b, verdict, snapshot);
        if (b && DEBUG) { const w = window as unknown as { __spillDebug?: unknown[] }; (w.__spillDebug ??= []).push({ idea: `${idea.name} (${mode})`, label: 'final', data: b }); }
        if (b || ctl.signal.aborted) break;
        if (attempt === 1) update(c => ({
          ...c, phase: 'designing', stage: 'first', preview: undefined,
          log: [...c.log, { text: "Couldn't make that design stand up; trying a fresh one", tone: 'note', t: Math.round((Date.now() - c.startedAt) / 1000) }],
        }));
      }
    } catch (e) {
      if (ctl.signal.aborted || (e as Error).name === 'AbortError') return;
      update(c => ({ ...c, phase: 'failed', log: [...c.log, { text: (e as Error).message, tone: 'bad', t: 0 }] }));
    }
  }, [rememberBuild]);

  const runRequest = useCallback((text: string) => {
    if(needsBuildStock())return;
    setCollection('bucket');
    const key = `r${Date.now()}`;
    runVariant(text, key, 'bucket', false);
    runVariant(text, `${key}-acc`, 'accurate', false);
    runVariant(text, `${key}-sup`, 'super', false);
  }, [runVariant]);

  const startOver = () => {
    cancelScanning();
    fullRes.current.clear();
    detailSources.current.clear();
    abort.current?.abort();
    reqAbort.current.forEach(c => c.abort());
    resetShape();
    runFor.current = '';
    setCollection('bucket');
    setInv(emptyInventory()); setScans([]); setCards([]); setRequests([]); setIdeasState({ status: 'idle' }); setOpen(null); setScreen('capture');
  };

  const crumbs: [Screen, string, boolean][] = [
    ['capture', 'Photograph', true],
    ['parts', 'Your parts', totalParts(inv) > 0 || inv.photos.length > 0],
    ['builds', 'Builds', collection === 'display' || !!runFor.current || cards.length > 0 || requests.length > 0 || ideasState.status !== 'idle'],
    ['manual', 'Instructions', !!open],
  ];

  if (screen === 'manual' && open) {
    return <Instructions build={open} bucket={stock} onEditInventory={()=>setScreen('parts')} draft={openDraft===open} bucketTotal={usableParts(inv)} model={model} initialStep={Number(params.get('step') ?? 0)} needs={openNeeds} backTo={fromBench ? 'workbench' : 'builds'} onBack={() => { setScreen(fromBench ? 'bench' : collection === 'display' || runFor.current || cards.length || requests.length || shapeRuns.pile.slots.length || shapeRuns.shopping.slots.length ? 'builds' : 'parts'); setFromBench(false); }} />;
  }

  return (
    <div className="app">
      <header className="topbar">
        <button className="wordmark" onClick={startOver} aria-label="Spill, start over">Spill</button>
        <ol className="crumbs">
          {crumbs.map(([s, label, ok], k) => (
            <li key={s} className={screen === s ? 'on' : ''} style={{ cursor: ok && s !== 'capture' ? 'pointer' : 'default', opacity: ok ? 1 : 0.5 }}
              onClick={() => ok && s !== 'capture' && setScreen(s)}>
              <b>{k + 1}</b>{label}
            </li>
          ))}
        </ol>
        <span className="chip">runs on <i>{model}</i></span>
      </header>
      {DEBUG&&<label className="meta">Load saved inventory <input aria-label="Load saved inventory" type="file" accept="application/json,.json" onChange={async e=>{
        const file=e.target.files?.[0];e.target.value='';if(!file)return;
        try{const saved=readInventorySnapshot(JSON.parse(await file.text()));cancelScanning();fullRes.current.clear();detailSources.current.clear();resetShape();changeInventory(()=>saved);setScans([]);setScreen('parts');}
        catch(error){setPhotoError((error as Error).message);}
      }}/></label>}
      {DEBUG&&<label className="meta">Restore saved build run <input aria-label="Restore saved build run" type="file" accept="application/json,.json" onChange={async e=>{
        const file=e.target.files?.[0];e.target.value='';if(!file)return;
        try{
          const raw=JSON.parse(await file.text()),imported=readInventorySnapshot(raw),saved=inventoryForRestoredRun(invRef.current,imported),available=counts(saved),source=raw.shapeRuns?.pile?.slots;
          if(!Array.isArray(source)||source.length<1||source.length>3)throw Error('A saved run needs one to three pile models.');
          const slots:ShapeSlot[]=source.map((s,index)=>{
            const c=validateCheckpoint(s.checkpoint??checkpointFromRun(raw,s.idea?.name),available),b=inspectBench(c.state).build,draft=checkpointDraftBuild(c,available);
            return {key:`restored-${index}`,idea:c.idea,phase:'failed',startedAt:Date.now(),checkpoint:c,preview:b?{...b,name:c.idea.name}:undefined,build:draft,instructionsReady:!!draft,unrecognized:s.unrecognized===true,
              stats:{parts:c.state.pieces.length,clean:true,wholeModel:true,stockUnverified:false,unused:Object.values(available).reduce((a,b)=>a+b,0)-c.state.pieces.length},
              log:[{text:draft?'Restored generated draft. Parts and instructions are available; appearance is not approved. Continue to revise and rerun review.':'Restored unfinished draft. Continue to start a fresh bounded session and rerun visual review.',tone:'note'}]};
          });
          cancelScanning();setScans([]);resetShape();reqAbort.current.forEach(c=>c.abort());
          setRequests(rs=>stopPendingRequests(rs,'Stopped to restore a saved run. Retained drafts can be continued with matching stock.'));
          changeInventory(()=>saved);
          (window as unknown as {__spillDebug?:unknown[]}).__spillDebug=Array.isArray(raw.debug)?raw.debug:[];
          setRestoredRun({key:recommendationStockKey(available,stockEvidence(saved)),slots});setScreen('builds');
        }catch(error){setPhotoError((error as Error).message);}
      }}/></label>}
      {DEBUG&&<button className="linkbtn" onClick={()=>{
        const debug=(window as unknown as {__spillDebug?:unknown[]}).__spillDebug??[];
        const models=new Map<string,Build>();for(const raw of debug){const e=raw as {label?:string;data?:{build?:Build}};if(e.label==='wholeModelComplete'&&e.data?.build)models.set(e.data.build.name,e.data.build);}
        for(const slot of shapeRuns.pile.slots){const b=slot.build??slot.preview;if(b)models.set(slot.idea.name,b);}
        const renders=[...models].map(([name,b])=>{try{return {name,images:renderWholeModelViews(b)};}catch(error){return {name,error:(error as Error).message};}});
        const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),stock:counts(invRef.current),observedStock:proposedCounts(invRef.current),inventory:invRef.current,stockEvidence:stockEvidence(invRef.current),shapeRuns,requests,debug,renders},null,2)],{type:'application/json'});
        const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='spill-build-run.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      }}>Download build run</button>}

      {photoError && (
        <p className="upload-error" role="alert">{photoError} <button className="linkbtn" onClick={() => setPhotoError('')}>OK</button></p>
      )}
      {screen === 'capture' && (
        <Capture main={staged.main?.url} angles={staged.angles.map(a => a.url)} loading={staged.loading > 0}
          onPickMain={f => stagePhotos([f], 'main')} onPickAngles={fs => stagePhotos(fs, 'angle')}
          onRemoveMain={() => setStaged(s => ({ ...s, main: undefined }))}
          onRemoveAngle={i => setStaged(s => ({ ...s, angles: s.angles.filter((_, k) => k !== i) }))}
          onScan={() => { const s = staged; if (!s.main) return; setStaged({ angles: [], loading: 0 }); start(s.main, s.angles); }}
          onSample={() => { cancelScanning();changeInventory(()=>sampleInventory()); setScans([]); setCollection('bucket'); setScreen('parts'); }}
          onExplore={() => { setCollection('display'); setScreen('builds'); }} />
      )}
      {screen === 'parts' && (
        <Parts
          inv={inv} scans={scans}
          onReviewOther={(other,r)=>changeInventory(i=>reviewOtherPiece(i,other,r))}
          onReviewGroup={(rows,r)=>changeInventory(i=>applyPieceReviewGroup(i,rows,r))}
          onReviewType={(id,r,onlyUncertain,unboxedOnly,quantity,entry)=>changeInventory(i=>unboxedOnly?reviewUnboxedPart(i,id,r,quantity,entry):reviewPartType(i,id,r,onlyUncertain,entry))}
          onCount={(id, n) => changeInventory(i => setCount(i, id, n,false))}
          onAddPart={(k: PartKind) => changeInventory(i => addPart(i, k, 1))}
          onPhoto={addPhoto}
          onAnglePhoto={addAngle}
          onRetry={photo => scan(photo)}
          onRetryUnfinished={retryUnfinished} recovering={recovering} onStopRecovery={()=>recoveryAbort.current?.abort()}
          onResolve={(photo, box, r,id,onlyUncertain,observation) => changeInventory(i => editPiece(i, box, photo, r,id,onlyUncertain,observation))}
          onConfirmOutline={(observation, id) => changeInventory(i => confirmOutlineObservation(i, observation, id))}
          onNext={() => findBuilds()}
          onBench={() => { if(needsBuildStock(1))return;setBench(b => (b.build ? b : { key: b.key + 1 })); setScreen('bench'); }}
          onRequest={t => runRequest(t)}
        />
      )}
      {screen === 'decisions' && <Decisions trace={trace} slots={slots} onBack={() => setScreen('builds')} />}
      {screen === 'bench' && (
        <Workbench key={bench.key} inv={inv} start={bench.build} goal={bench.goal} onChange={keepBench}
          onBooklet={b => { setOpen(b); setOpenNeeds(undefined); setFromBench(true); setScreen('manual'); }} onBack={() => setScreen('builds')} />
      )}
      {screen === 'builds' && (
        <Builds
          collection={collection} onCollection={next => { setCollection(next); if (next !== 'display' && totalParts(inv) === 0) setScreen('capture'); }}
          onOpenDisplay={build => { setOpen(build); setOpenNeeds(undefined); setFromBench(false); setScreen('manual'); }}
          library={library.entries} libraryState={library} libraryNotice={libraryNotice}
          onOpenLibrary={build => { setOpen(build); setOpenNeeds(undefined); setFromBench(false); setScreen('manual'); }}
          slots={slots} tried={cards.length} ideasState={ideasState}
          onOpen={i => { setOpen(cards[i].build!); setOpenNeeds(undefined); setScreen('manual'); }}
          onRetry={i => abort.current && runCard(i, cards[i].idea, invRef.current, abort.current.signal)}
          onRetryIdeas={() => findBuilds(true)}
          requests={requests}
          bucket={stock}
          onRequest={t => runRequest(t)}
          onOpenRequest={k => { const c = requests.find(r => r.key === k); if (c?.build) { setOpen(c.build); setOpenDraft(c.phase==='failed'||weak(c)?c.build:null);setFromBench(false); setOpenNeeds(openCatalog(c.idea.mode) ? new Set(shoppingList(c.build, counts(inv)).get.map(l => l.partId)) : undefined); setScreen('manual'); } }}
          onRetryRequest={k => { const c = requests.find(r => r.key === k); if (c?.idea.request) runVariant(c.idea.request, k, c.idea.mode ?? 'bucket', true,c.checkpoint); }}
          onSuggest={() => findBuilds(true)}
          onDifferent={() => findBuilds(true)}
          onDecisions={trace ? () => setScreen('decisions') : undefined}
          onBench={(build, goal) => { setBench(b => ({ build, goal, key: b.key + 1 })); setScreen('bench'); }}
          shape={ENGINE === 'shape' ? {
            pile: shapeRuns.pile, shopping: shapeRuns.shopping,stockEvidence:recommendationEvidence,
            onStart: mode => runShape(mode),
            onStop:stopShape,
            onResume:(mode,slot)=>runShape(mode,[],slot.idea,slot),
            onDifferent: mode => runShape(mode, shapeRuns[mode].slots.map(s => s.idea.name)),
            onChoose:(mode,idea)=>runShape(mode,[],idea),
            onOpen: (build, mode,draft) => { setOpen(build);setOpenDraft(draft?build:null); setOpenNeeds(mode === 'shopping' ? new Set(shoppingList(build, counts(inv)).get.map(l => l.partId)) : undefined); setFromBench(false); setScreen('manual'); },
          } : undefined}
        />
      )}
    </div>
  );
}
