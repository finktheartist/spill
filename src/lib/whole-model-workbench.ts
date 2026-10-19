import {COLORS,parsePartId,partId,type Build,type Placed} from './bricks';
import {connectionPairs,definition,frame,type Frame,type V3} from './connections';
import {attachmentMap,constructionIssues} from './construction';

// Inventory capacity is independent of the bounded model and each atomic edit.
export const MAX_WHOLE_MODEL_STOCK = 2000;
export const MAX_WHOLE_MODEL_STOCK_IDS = 500;
export const MAX_WHOLE_MODEL_PARTS = 80;
export const MAX_WHOLE_MODEL_EDIT = 8;
export const WHOLE_MODEL_WIDTH_STUDS = 24;

export interface BenchPiece {id:string;partId:string;x:number;y:number;z:number;rot:number}
export interface BenchState {stock:Record<string,number>;revision:number;nextId:number;pieces:BenchPiece[]}
export interface BenchInspection {
 used:Record<string,number>;remaining:Record<string,number>;total:number;complete:boolean;
 build:Build|null;attachments:string;partIndexToId:string[];
 bounds:{minLdu:V3;maxLdu:V3;sizeStuds:V3}|null;issues:string[];
}
export interface BenchEdit {remove:string[];add:Placed[]}
export interface BenchResult {accepted:boolean;state:BenchState;candidate:Build|null;issues:string[];inspection:BenchInspection}

const unique=(xs:string[])=>[...new Set(xs)];
const message=(e:unknown)=>e instanceof Error?e.message:String(e);
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const ownKeys=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).every(k=>keys.includes(k));
const pose=(p:Placed):Placed=>({partId:p.partId,x:p.x,y:p.y,z:p.z,rot:p.rot});
/** Admit literal 1-LDU poses, retaining the submitted coordinates unchanged.
 * Decimal JSON may have binary roundoff; this checks alignment, never snaps
 * a pose or changes the native contact/collision tolerances. */
const lduAligned=(value:unknown,scale:number):value is number=>{
 if(typeof value!=='number'||!Number.isFinite(value))return false;
 const ldu=value*scale,integer=Math.round(ldu);
 return Number.isSafeInteger(integer)&&Math.abs(ldu-integer)<=1e-8;
};
function nativePart(id:string) {
 const kind=parsePartId(id);
 if(!kind||!Object.hasOwn(COLORS,kind.color)||partId(kind.type,kind.w,kind.d,kind.color)!==id)throw Error(`Unknown or noncanonical stock part ${id}.`);
 definition(kind);
 return kind;
}

function readStock(raw:unknown):Record<string,number> {
 if(!object(raw)||Object.keys(raw).length>MAX_WHOLE_MODEL_STOCK_IDS)throw Error('Stock must be a bounded exact part-count object.');
 const stock:Record<string,number>={};let total=0;
 for(const [id,n]of Object.entries(raw)){
  if(!Number.isSafeInteger(n)||(n as number)<0||(n as number)>MAX_WHOLE_MODEL_STOCK)throw Error(`Invalid stock count for ${id}.`);
  nativePart(id);
  if(n){stock[id]=n as number;total+=n as number;}
 }
 if(total<1||total>MAX_WHOLE_MODEL_STOCK)throw Error('Stock must contain 1–2000 actual supported pieces.');
 return Object.freeze(stock);
}
function readPose(raw:unknown,withId=false):Placed {
 if(!object(raw)||!ownKeys(raw,withId?['id','partId','x','y','z','rot']:['partId','x','y','z','rot']))throw Error('Each added piece needs only partId,x,y,z,rot; IDs are assigned on commit.');
 if(typeof raw.partId!=='string'||![raw.x,raw.y].every(v=>lduAligned(v,20))||!lduAligned(raw.z,8)||!Number.isSafeInteger(raw.rot)||![0,90,180,270].includes(raw.rot as number))throw Error('Use literal 1-LDU coordinates: x/y multiples of0.05stud, z multiples of0.125plate, and quarter-turn rot; orientation matrices are unsupported.');
 if([raw.x,raw.y,raw.z].some(v=>Math.abs(v as number)>1000))throw Error('Piece coordinates exceed the supported range.');
 const p=pose(raw as unknown as Placed);nativePart(p.partId);frame(p);return p;
}
function readState(raw:BenchState):BenchState {
 if(!object(raw)||!ownKeys(raw,['stock','revision','nextId','pieces'])||!Number.isSafeInteger(raw.revision)||raw.revision<0||!Number.isSafeInteger(raw.nextId)||raw.nextId<1||!Array.isArray(raw.pieces)||raw.pieces.length>MAX_WHOLE_MODEL_PARTS)throw Error('Malformed workbench state.');
 const stock=readStock(raw.stock),seen=new Set<string>();
 const pieces=raw.pieces.map(p=>{
  const parsed=readPose(p,true),id=object(p)?p.id:undefined;
  if(typeof id!=='string'||!/^p[1-9]\d{0,15}$/.test(id)||!Number.isSafeInteger(Number(id.slice(1)))||Number(id.slice(1))>=raw.nextId||seen.has(id))throw Error('State piece IDs must be unique committed p-numbers below nextId.');
  seen.add(id);return {id,...parsed};
 });
 return {stock,revision:raw.revision,nextId:raw.nextId,pieces};
}
const stateSnapshot=(state:BenchState):BenchState=>({...structuredClone(state),stock:Object.freeze({...state.stock})});
const ledger=(parts:Placed[])=>{const used:Record<string,number>={};for(const p of parts)used[p.partId]=(used[p.partId]??0)+1;return used;};
const unspent=(stock:Record<string,number>,used:Record<string,number>)=>Object.fromEntries(Object.entries(stock).flatMap(([id,n])=>n-(used[id]??0)>0?[[id,n-(used[id]??0)]]:[]));
const poseSet=(parts:Placed[])=>parts.map(p=>JSON.stringify([p.partId,p.x,p.y,p.z,p.rot])).sort().join('|');

interface Edge {other:number;ownPort:string;otherPort:string}
interface Geometry {build:Build|null;order:number[];issues:string[];frames:Frame[]}
/** Contact-based instruction order only. Every pose and every physical gate
 * remains unchanged; rejected disconnected/overlapping geometry is retained. */
function geometry(parts:Placed[],stock:Record<string,number>):Geometry {
 if(!parts.length)return {build:null,order:[],issues:['A committed build must contain at least one piece.'],frames:[]};
 if(parts.length>MAX_WHOLE_MODEL_PARTS)return {build:null,order:[],issues:['The workbench is limited to80 pieces.'],frames:[]};
 let frames:Frame[];
 try{frames=parts.map(frame);}catch(e){return {build:null,order:[],issues:[message(e)],frames:[]};}
 const links:Edge[][]=parts.map(()=>[]);
 for(let a=0;a<parts.length;a++)for(let b=0;b<a;b++)for(const[bPort,aPort]of connectionPairs(frames[b],frames[a])){
  links[a].push({other:b,ownPort:aPort,otherPort:bPort});links[b].push({other:a,ownPort:bPort,otherPort:aPort});
 }
 const order:number[]=[],steps:Build['steps']=[],reached=new Set<number>(),issues:string[]=[];
 // Frame bounds are measured from the transformed native body solids, not
 // requested dimensions, part origins or generic brick-height estimates.
 // Match the native bounds epsilon; no contact/collision tolerance changes.
 const solidMin=[0,1,2].map(axis=>Math.min(...frames.map(f=>f.bounds.min[axis])));
 const solidMax=[0,1,2].map(axis=>Math.max(...frames.map(f=>f.bounds.max[axis])));
 for(const [axis,name] of ['x','y','z'].entries()){
  const span=solidMax[axis]-solidMin[axis];
  if(span>WHOLE_MODEL_WIDTH_STUDS*20+1e-5)issues.push(`Actual ${name}-axis solid span ${span} LDU exceeds ${WHOLE_MODEL_WIDTH_STUDS} studs (${WHOLE_MODEL_WIDTH_STUDS*20} LDU).`);
 }
 const root=frames.findIndex(f=>Math.abs(f.bounds.min[2])<1e-5);
 if(root<0)issues.push('No grounded part can start the actual mating-contact assembly.');
 else{
  reached.add(root);order.push(root);steps.push({caption:`Place ${parts[root].partId} on the table in the shown orientation.`,parts:[pose(parts[root])]});
  while(order.length<parts.length){
   let next=-1,parent:Edge|undefined;
   for(let i=0;i<parts.length;i++)if(!reached.has(i)){
    const edges=links[i].filter(e=>reached.has(e.other)).sort((a,b)=>a.other-b.other||a.otherPort.localeCompare(b.otherPort)||a.ownPort.localeCompare(b.ownPort));
    if(edges.length){next=i;parent=edges[0];break;}
   }
   if(next<0||!parent){issues.push('All pieces must join one actual mating-contact graph from the grounded root.');break;}
   steps.push({caption:`Attach ${parts[next].partId} to part ${order.indexOf(parent.other)+1} at its ${parent.otherPort}, using this part’s ${parent.ownPort}. Keep the shown orientation.`,parts:[pose(parts[next])]});
   reached.add(next);order.push(next);
  }
 }
 const connected=order.length===parts.length;
 const build:Build={name:'Incremental workbench model',description:connected?'Submitted poses, ordered only by their actual mating contacts.':'Rejected proposal geometry; the following pieces are diagnostic views, not qualified instructions.',engine:'connections-v2',steps:connected?steps:parts.map(p=>({caption:'Unvalidated proposal piece; construction is rejected.',parts:[pose(p)]}))};
 try{issues.push(...constructionIssues(build,stock,WHOLE_MODEL_WIDTH_STUDS).map(i=>i.message));}catch(e){issues.push(message(e));}
 return {build,order:connected?order:parts.map((_,i)=>i),issues:unique(issues),frames};
}

/** Throws on invalid or unsupported initial stock. The stock snapshot is frozen.
 * Inventory may exceed the 80-piece model cap; unused pieces remain available.
 * The exact ledger is cloned and never
 * accepted from an edit action. No reference recipe is imported here. */
export function createBench(stock:Record<string,number>):BenchState {
 return {stock:readStock(stock),revision:0,nextId:1,pieces:[]};
}

export function inspectBench(state:BenchState):BenchInspection {
 const current=readState(state),used=ledger(current.pieces),remaining=unspent(current.stock,used);
 if(!current.pieces.length)return {used,remaining,total:0,complete:false,build:null,attachments:'',partIndexToId:[],bounds:null,issues:[]};
 const checked=geometry(current.pieces,current.stock),minLdu=[0,1,2].map(a=>Math.min(...checked.frames.map(f=>f.bounds.min[a]))) as V3,maxLdu=[0,1,2].map(a=>Math.max(...checked.frames.map(f=>f.bounds.max[a]))) as V3;
 return {used,remaining,total:current.pieces.length,complete:!checked.issues.length&&!Object.keys(remaining).length,build:checked.build,
  attachments:checked.build&&!checked.issues.length?attachmentMap(checked.build):'',partIndexToId:checked.order.map(i=>current.pieces[i].id),
  bounds:checked.frames.length?{minLdu,maxLdu,sizeStuds:minLdu.map((v,i)=>(maxLdu[i]-v)/20) as V3}:null,issues:checked.issues};
}

export function editBench(state:BenchState,edit:BenchEdit):BenchResult {
 const current=readState(state),inspection=inspectBench(current);
 const reject=(issues:string[],candidate:Build|null=null):BenchResult=>({accepted:false,state:stateSnapshot(current),candidate,issues:unique(issues),inspection:structuredClone(inspection)});
 if(inspection.issues.length)return reject(inspection.issues.map(s=>`Current state is invalid: ${s}`));
 try{
  if(!object(edit)||!ownKeys(edit,['remove','add'])||!Array.isArray(edit.remove)||!Array.isArray(edit.add))return reject(['An edit contains only remove:string[] and add:Placed[].']);
  const budgetIssues=edit.remove.length>MAX_WHOLE_MODEL_EDIT||edit.add.length>MAX_WHOLE_MODEL_EDIT?['An atomic edit permits at most8 removals and8 additions.']:[];
  if(edit.remove.length>MAX_WHOLE_MODEL_PARTS||edit.add.length>MAX_WHOLE_MODEL_PARTS)return reject(budgetIssues);
  if(!edit.remove.length&&!edit.add.length)return reject(['A no-op edit cannot commit.']);
  const existing=new Set(current.pieces.map(p=>p.id)),removed=new Set<string>();
  for(const id of edit.remove){if(typeof id!=='string'||!existing.has(id))return reject([`Unknown removal ID ${String(id)}.`]);if(removed.has(id))return reject([`Repeated removal ID ${id}.`]);removed.add(id);}
  const add=edit.add.map(p=>readPose(p)),retained=current.pieces.filter(p=>!removed.has(p.id)),proposed=[...retained.map(pose),...add];
  if(!proposed.length&&!add.length&&removed.size&&!budgetIssues.length){
   if(!Number.isSafeInteger(current.revision+1))return reject(['Workbench revision space is exhausted.']);
   const next:BenchState={stock:Object.freeze({...current.stock}),revision:current.revision+1,nextId:current.nextId,pieces:[]};
   return {accepted:true,state:next,candidate:null,issues:[],inspection:inspectBench(next)};
  }
  const checked=geometry(proposed,current.stock);
  if(budgetIssues.length)return reject([...budgetIssues,...checked.issues],checked.build);
  if(poseSet(proposed)===poseSet(current.pieces))return reject(['A no-op edit leaves the exact piece poses unchanged.'],checked.build);
  if(checked.issues.length)return reject(checked.issues,checked.build);
  if(!Number.isSafeInteger(current.nextId+add.length)||!Number.isSafeInteger(current.revision+1))return reject(['Workbench revision or ID space is exhausted.'],checked.build);
  // IDs are created only after every proposal check has passed. Removals are
  // applied atomically with additions; old IDs are never reassigned or reused.
  const next:BenchState={stock:Object.freeze({...current.stock}),revision:current.revision+1,nextId:current.nextId+add.length,pieces:[...retained.map(p=>({...p})),...add.map((p,i)=>({id:`p${current.nextId+i}`,...p}))]};
  const actual=inspectBench(next);
  return {accepted:true,state:next,candidate:checked.build,issues:[],inspection:actual};
 }catch(e){return reject([message(e)]);}
}

/** Final digital stock/construction gate only; finish does not revise poses,
 * increment IDs/revision, or claim reference fidelity or visual appeal. */
export function finishBench(state:BenchState):BenchResult {
 const current=readState(state),inspection=inspectBench(current),issues=[...inspection.issues];
 if(!inspection.total)issues.push('Cannot finish an empty workbench.');
 for(const [id,n]of Object.entries(inspection.remaining))issues.push(`Finish requires ${n} more × ${id} from the exact stock.`);
 return {accepted:inspection.complete,state:stateSnapshot(current),candidate:inspection.build?structuredClone(inspection.build):null,issues:unique(issues),inspection};
}

export interface CompletionPolicy {mode:'exact'|'subset';minParts:number}

function validPolicy(policy:unknown):policy is CompletionPolicy {
 if(!policy||typeof policy!=='object'||Array.isArray(policy))return false;
 const p=policy as CompletionPolicy;
 return Object.keys(p).every(k=>k==='mode'||k==='minParts')&&(p.mode==='exact'||p.mode==='subset')&&Number.isSafeInteger(p.minParts)&&p.minParts>=1&&p.minParts<=MAX_WHOLE_MODEL_PARTS;
}

export const DEFAULT_WHOLE_MODEL_POLICY:Readonly<CompletionPolicy>=Object.freeze({mode:'subset',minParts:20});

/** Completion policy only. Exact stock ownership, state validation, pose
 * ordering and every physical tolerance remain in the native physical checks.
 * inspection.complete retains its original full-stock meaning; accepted is
 * the completion result under this explicitly supplied policy. No craft or
 * subject-recognition claim is made by either mode. */
export function finishWithPolicy(state:BenchState,policy:CompletionPolicy=DEFAULT_WHOLE_MODEL_POLICY):BenchResult {
 const current=readState(state),inspection=inspectBench(current);
 const result=(accepted:boolean,issues:string[]):BenchResult=>({accepted,state:stateSnapshot(current),candidate:inspection.build?structuredClone(inspection.build):null,issues:unique(issues),inspection});
 if(!validPolicy(policy))return result(false,['Completion policy requires mode exact/subset and integer minParts from1 to80.']);
 const minimumIssues=inspection.total<policy.minParts?[`Completion requires at least ${policy.minParts} pieces; the current model has ${inspection.total}.`]:[];
 if(policy.mode==='exact'){
  const exact=finishBench(current);
  return {...exact,accepted:exact.accepted&&!minimumIssues.length,issues:unique([...exact.issues,...minimumIssues])};
 }
 const issues=[...inspection.issues,...minimumIssues];
 if(!inspection.total||!inspection.build)issues.push('Subset completion requires a nonempty actual model.');
 if(inspection.build){
  // Explicitly re-run the unchanged inventory/overlap/ground/bounds/contact
  // authority. Subset mode is not acceptance by ignoring remaining stock.
  issues.push(...constructionIssues(inspection.build,current.stock,WHOLE_MODEL_WIDTH_STUDS).map(i=>i.message));
 }
 return result(!issues.length,issues);
}
