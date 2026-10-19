import { compileConnections, frame, type ConnectionOperation, type ConnectionProgram } from './connections';
import { captionTechniques, type TechniqueReceipt } from './construction-techniques';
import { constructionIssues } from './construction';
import { refinementLimits, validVerdict } from './build-quality';
import type { Build } from './bricks';
import type { Verdict } from './gemini';

export interface ConnectionDraft { program: ConnectionProgram; receipts: TechniqueReceipt[]; build: Build; verdict: Verdict }
export interface ConnectionPatch {
  focus: string;
  updates: (ConnectionOperation & { index: number })[];
  remove: number[];
  add: ConnectionOperation[];
}
const properties = { partId: {type:'STRING'}, parent: {type:'INTEGER'}, parentPort: {type:'STRING'}, childPort: {type:'STRING'}, twist: {type:'NUMBER'} };
export const CONNECTION_PATCH_SCHEMA = {type:'OBJECT', required:['focus','updates','remove','add'], properties:{
  focus:{type:'STRING'}, updates:{type:'ARRAY',items:{type:'OBJECT',required:['index',...Object.keys(properties)],properties:{index:{type:'INTEGER'},...properties}}},
  remove:{type:'ARRAY',items:{type:'INTEGER'}}, add:{type:'ARRAY',items:{type:'OBJECT',required:Object.keys(properties),properties}},
}};
const rounded=(n:number)=>Math.round(n*1e6)/1e6;
/** Ignore captions, assembly ordering and the compiler's global x/y normalization. */
export function connectionGeometryKey(build:Build):string {
  const parts=build.steps.flatMap(s=>s.parts), frames=parts.map(frame), origin=frames[0].translation;
  return JSON.stringify(parts.map((p,i)=>[p.partId,...frames[i].translation.map((v,a)=>rounded(v-origin[a])),...frames[i].rotation.map(rounded)]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
}

/** Atomic attachment edits. The compiler never silently moves unrelated parts to repair a patch. */
export function patchConnectionDraft(draft:ConnectionDraft, raw:unknown, have:Record<string,number>):{draft?:ConnectionDraft;changed:number[];issues:string[]} {
  try {
    const patch=raw as ConnectionPatch, ops=draft.program.operations, n=ops.length, limits=refinementLimits(draft.build);
    if(!patch||typeof patch.focus!=='string'||!patch.focus.trim()||!Array.isArray(patch.updates)||!Array.isArray(patch.remove)||!Array.isArray(patch.add))throw Error('Return a focus, updates, remove and add arrays.');
    const oldIndex=(i:number)=>Number.isSafeInteger(i)&&i>0&&i<n;
    const removed=new Set(patch.remove), updated=new Set(patch.updates.map(p=>p.index));
    if(removed.size!==patch.remove.length||updated.size!==patch.updates.length||[...removed,...updated].some(i=>!oldIndex(i))||[...removed].some(i=>updated.has(i)))throw Error('Use unique existing indices; the root is fixed and a part cannot be updated and removed.');
    if(removed.size+updated.size>limits.changed||patch.add.length>limits.added)throw Error(`Change at most ${limits.changed} existing parts and add at most ${limits.added}.`);
    const locked=new Set(draft.receipts.flatMap(r=>r.parts));
    if([...removed,...updated].some(i=>locked.has(i)))throw Error('Approved module operations are locked. Edit their host or surrounding parts, preserving the entire assembly.');
    if(draft.receipts.some(r=>removed.has(r.host)))throw Error('Preserve each approved module host.');
    const logical=ops.map(o=>({...o}));
    for(const {index,...op} of patch.updates)logical[index]=op;
    logical.push(...patch.add);
    const survivors=logical.map((_,i)=>i).filter(i=>!removed.has(i));
    if(survivors.length<20||survivors.length>60||survivors.length<Math.ceil(n*.65))throw Error('Keep 20–60 pieces and at least 65% of the original count.');
    for(const i of survivors){
      const op=logical[i];
      if(!op||typeof op.partId!=='string'||!Number.isSafeInteger(op.parent)||typeof op.parentPort!=='string'||typeof op.childPort!=='string'||!Number.isFinite(op.twist))throw Error(`Malformed attachment at logical index ${i}.`);
      if(i&&(op.parent<0||op.parent>=logical.length||removed.has(op.parent)))throw Error(`Part ${i} needs a surviving parent; reparent its children before removing a part.`);
    }
    // A new spacer can support an existing piece. Reorder the graph for assembly
    // instead of requiring the model to delete and recreate the whole subtree.
    const map=new Map<number,number>([[0,0]]);
    while(map.size<survivors.length){
      const next=survivors.find(i=>!map.has(i)&&map.has(logical[i].parent));
      if(next===undefined)throw Error('Attachment graph has a cycle; every part must connect back to the fixed root.');
      map.set(next,map.size);
    }
    const operations=[...map.keys()].map(i=>({...logical[i],parent:i?map.get(logical[i].parent)!:-1}));
    const requiredContacts=draft.program.requiredContacts?.map(c=>{
      if(!map.has(c.a)||!map.has(c.b))throw Error('Required contact anchors cannot be removed.');
      return {...c,a:map.get(c.a)!,b:map.get(c.b)!};
    });
    const needed=new Map<string,number[]>();
    for(const [i,op]of logical.entries())if(!removed.has(i))needed.set(op.partId,[...(needed.get(op.partId)??[]),i]);
    const shortages=[...needed].filter(([id,indices])=>!Number.isSafeInteger(have[id])||have[id]<indices.length).map(([id,indices])=>`${id}: needs ${indices.length}, stock has ${have[id]??0}; logical indices ${indices.join(', ')}`);
    if(shortages.length)throw Error('Stock shortages: '+shortages.join('; '));
    const program:ConnectionProgram={...draft.program,operations,requiredContacts};
    let build:Build;
    try{build=compileConnections(program,have);}catch(e){
      const originalIndices=[...map.keys()],label=(step:number)=>{const i=originalIndices[step-1];return `${i} (${logical[i]?.partId??'unknown'})`;};
      const message=(e as Error).message.replace(/\bparts (\d+) and (\d+)\b/gi,(_,a,b)=>`logical operations ${label(+a)} and ${label(+b)}`).replace(/\bpart (\d+)\b/gi,(_,a)=>`logical operation ${label(+a)}`);
      throw Error(message);
    }
    const receipts=draft.receipts.map(r=>({...r,host:map.get(r.host)!,parts:r.parts.map(i=>map.get(i)!)}));
    const issues=constructionIssues(build,have,24);if(issues.length)throw Error(issues.map(i=>i.message).join('; '));
    const before=draft.build.steps.flatMap(s=>s.parts),after=build.steps.flatMap(s=>s.parts), a=before.map(frame),b=after.map(frame);
    const changed=[...removed];
    for(let i=0;i<n;i++){
      if(removed.has(i))continue;
      const j=map.get(i)!;
      if(before[i].partId!==after[j].partId||a[i].rotation.some((v,k)=>Math.abs(v-b[j].rotation[k])>1e-6)||a[i].translation.some((v,k)=>Math.abs((v-a[0].translation[k])-(b[j].translation[k]-b[0].translation[k]))>1e-6))changed.push(i);
    }
    if(changed.length>limits.changed)throw Error(`This moves ${changed.length} existing pieces, including descendants. Keep the revision local: at most ${limits.changed}.`);
    captionTechniques(build,receipts);
    return {draft:{...draft,program,receipts,build},changed,issues:[]};
  } catch(e) { return {changed:[],issues:[(e as Error).message]}; }
}

/** A draft can improve within a score band, but only with a separate visual preference and no regression. */
export function connectionRevisionWins(before:Verdict,after:Verdict,preferred:boolean):boolean {
  return preferred&&validVerdict(before)&&validVerdict(after)&&after.subjectMatched===true&&
    (['recognizable','complete','colors','impressive'] as const).every(k=>after[k]>=3&&after[k]>=before[k]);
}
