import { CATALOG, footprint, heightOf, parsePartId, type PartKind } from '../bricks';
import { isMade } from '../catalog';
import { compileConnections, definition, type Connector } from '../connections';
import { SHADE_FAMILY } from '../shape-first/pipeline';
import type { BuildBrief, FeatureNeed, FeatureOpportunityRule, FeaturePartRule } from './types';

export interface OpportunityContextOptions { confidence?:Record<string,number> }
export interface OpportunityPart {
  id:string; kind:PartKind; count:number; widthStuds:number; depthStuds:number; heightPlates:number;
  ports:Connector[]; shapeKey:string; confidence:number|null; body:boolean;
}
export interface OpportunityContext {
  parts:OpportunityPart[]; stock:Record<string,number>; total:number;
  rejected:{id:string;count:unknown;reason:string}[];
  confidenceWarnings:{id:string;value:unknown}[];
  /** Cache only local geometry checks, never mutable feature allocations. */
  techniqueCache:Map<string,boolean>;
}
export interface OpportunityReceipt {
  featureIndex:number; name:string; required:boolean; requested:number; allocated:number;
  parts:{id:string;count:number;confidence:number|null}[];
  carriers:{id:string;count:number;confidence:number|null}[];
  evidence:'exact-allocation'|'compiled-local-connection';
  structured:boolean; alternatives:{id:string;remaining:number;shapeKey:string}[];
  singletonIds:string[];
}
export interface OpportunityBlocker {
  code:'feature-parts'|'carrier-parts'|'local-connection'|'pair-shape'|'natural-color'|'piece-budget'|'body-reserve'|'invalid-rule'|'allocation-limit';
  name:string; required:number; available:number; detail:string;
}
export interface SubjectOpportunity {
  tier:'blocked'|'scarce'|'candidate'|'supported-local'; score:number; coverage:number;
  status:'promising'|'adapt'|'needs-parts';
  receipts:OpportunityReceipt[]; blockers:OpportunityBlocker[]; remaining:Record<string,number>;
  palette:{role:string;color:string;share:number}[];
  bodyReserve:{requested:number;reserved:{id:string;count:number;confidence:number|null}[];available:number;spanStuds:number;footprintCells:number};
  slack:{pieces:number;featureAlternatives:number;singletonFeatures:number};
  confidence:{minimum:number|null;knownPieces:number;unknownPieces:number;cautionPieces:number;note:string};
  evidence:'inventory-opportunity-estimate'; geometryUnchecked:string[]; reasons:string[];
}

/** Parse/inspect once per scan. Manufactured IDs outside the connection catalog,
 * loose wheels and unimplemented axle assemblies cannot increase capability. */
export function createOpportunityContext(stock:Record<string,number>,options:OpportunityContextOptions={}):OpportunityContext {
  const parts:OpportunityPart[]=[],rejected:OpportunityContext['rejected']=[],confidenceWarnings:OpportunityContext['confidenceWarnings']=[];
  for(const [id,count] of Object.entries(stock??{}).sort(([a],[b])=>a.localeCompare(b))) {
    const kind=parsePartId(id);
    let reason='';
    if(!Number.isSafeInteger(count)||count<0)reason='Count is not a nonnegative safe integer.';
    else if(!kind)reason='Unknown or malformed part ID.';
    else if(kind.type==='wheel'||kind.type==='wheels')reason='This wheel inventory type has no implemented connection-catalog geometry.';
    else if(!CATALOG[kind.type]?.includes(`${kind.w}x${kind.d}`))reason='Size is outside the connection catalog.';
    else if(!isMade(id))reason='Exact part/color ID is not a manufactured catalog entry.';
    if(reason){rejected.push({id,count,reason});continue;}
    if(!count)continue;
    const k=kind!,d=definition(k),f=footprint(k,0),raw=options.confidence?.[id];
    const confidence=typeof raw==='number'&&Number.isFinite(raw)&&raw>=0&&raw<=1?raw:null;
    if(raw!==undefined&&confidence===null)confidenceWarnings.push({id,value:raw});
    const ports=d.ports.map(p=>({...p,point:[...p.point] as Connector['point'],normal:[...p.normal] as Connector['normal']}));
    parts.push({id,kind:k,count,widthStuds:f.fw,depthStuds:f.fd,heightPlates:heightOf(k),ports,
      shapeKey:`${k.type}:${k.w}x${k.d}:${heightOf(k)}`,confidence,
      body:ports.some(p=>p.kind==='stud'&&p.normal[2]>.99)&&ports.some(p=>p.kind==='grip'&&p.normal[2]<-.99)});
  }
  return {parts,stock:Object.fromEntries(parts.map(p=>[p.id,p.count])),total:parts.reduce((n,p)=>n+p.count,0),rejected,confidenceWarnings,techniqueCache:new Map()};
}

function fits(p:OpportunityPart,r:FeaturePartRule={}):boolean {
  return (r.w===undefined||p.kind.w===r.w)&&(r.d===undefined||p.kind.d===r.d)&&(r.heightPlates===undefined||p.heightPlates===r.heightPlates)&&
    (!r.port||p.ports.some(port=>port.kind===r.port!.kind&&(!r.port!.id||port.id===r.port!.id)&&
      (r.port!.direction==='top'?port.normal[2]>.99:r.port!.direction==='bottom'?port.normal[2]<-.99:Math.abs(port.normal[2])<.01)));
}
function ruleIssue(f:FeatureNeed):string|undefined {
  const r=f.opportunity;
  if(!Number.isSafeInteger(f.count)||f.count<1||f.count>160)return 'Feature count must be a bounded positive integer.';
  if(!r)return;
  if(r.pairing&&!['same-shape','identical-id'].includes(r.pairing))return 'Unsupported structured pairing rule.';
  if(r.pairing&&f.count%2)return 'Structured pairs need an even feature count.';
  for(const rule of [r,r.carrier].filter(Boolean) as FeaturePartRule[])for(const n of [rule.w,rule.d,rule.heightPlates])if(n!==undefined&&(!Number.isFinite(n)||n<=0))return 'Structured dimensions must be positive finite numbers.';
  if(r.carrier&&(!Number.isSafeInteger(r.carrier.count)||r.carrier.count<1||r.carrier.count>160||!r.carrier.types.length))return 'Carrier count/types must be explicit and bounded.';
  if(r.carrier?.connection&&r.carrier.count!==f.count)return 'This local connection rule needs one carrier per feature part; a shared-carrier recipe is not specified.';
}
function localConnection(ctx:OpportunityContext,carrier:OpportunityPart,part:OpportunityPart,r:NonNullable<FeatureOpportunityRule['carrier']>):boolean {
  const c=r.connection!,key=JSON.stringify([carrier.shapeKey,part.shapeKey,c.parentPort,c.childPort,c.twist??0]);
  if(ctx.techniqueCache.has(key))return ctx.techniqueCache.get(key)!;
  let valid=false;
  try {compileConnections({name:'Local feature attachment',description:'Only this static two-part attachment was checked.',operations:[
    {partId:carrier.id,parent:-1,parentPort:'',childPort:'',twist:0},
    {partId:part.id,parent:0,parentPort:c.parentPort,childPort:c.childPort,twist:c.twist??0},
  ]},{[carrier.id]:carrier.id===part.id?2:1,...(carrier.id!==part.id?{[part.id]:1}:{})});valid=true;}catch {/* No guessed port or low-lip substitute. */}
  ctx.techniqueCache.set(key,valid);return valid;
}

type Task={feature:number;carrier:boolean;body?:boolean;count:number;ids:string[]};
type Unit={feature:number;parts:string[];carriers:string[];local:boolean};
const add=(cost:Record<string,number>,id:string,n=1)=>cost[id]=(cost[id]??0)+n;

/** Exact independent feature reservations, not a whole construction. The
 * default body reserve is a declared ranking policy (25% of the minimum piece
 * budget, at least four), never a dimension inferred from subject names. */
export function assessSubjectOpportunity(brief:BuildBrief,ctx:OpportunityContext):SubjectOpportunity {
  const blockers:OpportunityBlocker[]=[],palette:SubjectOpportunity['palette']=[],reasons:string[]=[],leftColors=new Map<string,number>();
  const parts=ctx.parts,byId=new Map(parts.map(p=>[p.id,p])),minimum=brief.parts[0];
  for(const p of parts)leftColors.set(p.kind.color,(leftColors.get(p.kind.color)??0)+p.count);
  let colorCoverage=0,adapted=false;
  for(const role of [...brief.colors].sort((a,b)=>Number(b.natural)-Number(a.natural)||b.share-a.share)) {
    const colors=role.natural?[...new Set(role.colors.flatMap(c=>[c,...(SHADE_FAMILY[c]??[])]))]:[...leftColors.keys()].filter(c=>!c.startsWith('trans-'));
    const ordered=colors.sort((a,b)=>(leftColors.get(b)??0)-(leftColors.get(a)??0)||a.localeCompare(b)),color=ordered[0],available=color?leftColors.get(color)??0:0,need=Math.max(1,Math.ceil(minimum*role.share));
    colorCoverage+=role.share*Math.min(1,available/need);
    if(available>0){palette.push({role:role.role,color,share:role.share});leftColors.set(color,Math.max(0,available-need));}
    if(role.natural&&available<need)blockers.push({code:'natural-color',name:`${role.role} colors`,required:need,available,detail:`Authored natural colors are ${role.colors.join(', ')} or declared nearby shades.`});
  }
  const allowed=new Set(palette.flatMap(p=>brief.colors.find(r=>r.role===p.role)?.natural?[p.color,...(SHADE_FAMILY[p.color]??[])]:[p.color]));
  const features:FeatureNeed[]=[...brief.features];
  // A wheeled profile requires supported running gear but specifies no axle
  // count. Side-facing connector availability is a capability check, not a
  // universal four-wheel recipe or evidence for a complete chassis.
  const wheeled=brief.approaches.some(a=>a.profile==='wheeled-chassis'),gearRule=features.some(f=>f.required&&f.opportunity?.carrier?.connection);
  const sideMounts=parts.filter(p=>p.ports.some(port=>port.kind==='stud'&&Math.abs(port.normal[2])<.01)).reduce((n,p)=>n+p.count,0);
  if(wheeled&&!gearRule&&!sideMounts)blockers.push({code:'carrier-parts',name:'Side-facing running-gear support',required:1,available:0,detail:'This running-gear profile requires a supported wheel relationship; no side-facing stud carrier is available. The authored brief does not specify wheel count or a complete mounting layout.'});
  const candidates=features.map(f=>parts.filter(p=>f.types.includes(p.kind.type)&&allowed.has(p.kind.color)&&(!f.opportunity?.colors||f.opportunity.colors.includes(p.kind.color))&&fits(p,f.opportunity))
    .sort((a,b)=>f.types.indexOf(a.kind.type)-f.types.indexOf(b.kind.type)||b.count-a.count||a.id.localeCompare(b.id)));
  const carriers=features.map(f=>f.opportunity?.carrier?parts.filter(p=>f.opportunity!.carrier!.types.includes(p.kind.type)&&fits(p,f.opportunity!.carrier!)).sort((a,b)=>b.count-a.count||a.id.localeCompare(b.id)):[]);
  const reserveNeed=Math.max(4,Math.ceil(minimum*.25)),bodyParts=parts.filter(p=>p.body&&allowed.has(p.kind.color));
  const taskList:Task[]=[{feature:-1,carrier:false,body:true,count:reserveNeed,ids:[...bodyParts].sort((a,b)=>b.count-a.count||b.widthStuds*b.depthStuds-a.widthStuds*a.depthStuds||a.id.localeCompare(b.id)).map(p=>p.id)}],atomic:{feature:number;options:Unit[][][]}[]=[],invalid=new Set<number>();
  features.forEach((f,i)=>{
    if(!f.required)return;
    const issue=ruleIssue(f);if(issue){invalid.add(i);blockers.push({code:'invalid-rule',name:f.name,required:f.count,available:0,detail:issue});return;}
    const r=f.opportunity;
    if(r?.pairing||r?.carrier?.connection) {
      const units:Unit[]=[];
      if(r.pairing) {
        for(let a=0;a<candidates[i].length;a++)for(let b=a;b<candidates[i].length;b++) {
          const aa=candidates[i][a],bb=candidates[i][b];
          if((r.pairing==='identical-id'?aa.id!==bb.id:aa.shapeKey!==bb.shapeKey)||(a===b&&aa.count<2))continue;
          if(r.carrier?.connection)continue; // Combined pair/carrier units are expanded below.
          units.push({feature:i,parts:[aa.id,bb.id],carriers:[],local:false});
        }
      } else for(const p of candidates[i])for(const c of carriers[i])if(localConnection(ctx,c,p,r.carrier!))units.push({feature:i,parts:[p.id],carriers:[c.id],local:true});
      if(r.pairing&&r.carrier?.connection) {
        const singles:Unit[]=[];for(const p of candidates[i])for(const c of carriers[i])if(localConnection(ctx,c,p,r.carrier))singles.push({feature:i,parts:[p.id],carriers:[c.id],local:true});
        for(let a=0;a<singles.length;a++)for(let b=a;b<singles.length;b++) {
          const aa=byId.get(singles[a].parts[0])!,bb=byId.get(singles[b].parts[0])!;
          if(r.pairing==='identical-id'?aa.id!==bb.id:aa.shapeKey!==bb.shapeKey)continue;
          const use:Record<string,number>={};[...singles[a].parts,...singles[b].parts,...singles[a].carriers,...singles[b].carriers].forEach(id=>add(use,id));
          if(Object.entries(use).every(([id,n])=>ctx.stock[id]>=n))units.push({feature:i,parts:[aa.id,bb.id],carriers:[...singles[a].carriers,...singles[b].carriers],local:true});
        }
      }
      atomic.push({feature:i,options:Array.from({length:f.count/(r.pairing?2:1)},()=>units.map(u=>[u]))});
      if(r.carrier&&!r.carrier.connection)taskList.push({feature:i,carrier:true,count:r.carrier.count,ids:carriers[i].map(p=>p.id)});
    } else {
      taskList.push({feature:i,carrier:false,count:f.count,ids:candidates[i].map(p=>p.id)});
      if(r?.carrier)taskList.push({feature:i,carrier:true,count:r.carrier.count,ids:carriers[i].map(p=>p.id)});
    }
  });
  type Allocation={left:Record<string,number>;parts:Record<string,number>[];carriers:Record<string,number>[];body:Record<string,number>;local:Set<number>;allocated:number};
  const flow=(ledger:Record<string,number>,units:Unit[]):Allocation=>{
    const allocatedParts=features.map(()=>({} as Record<string,number>)),allocatedCarriers=features.map(()=>({} as Record<string,number>)),local=new Set<number>();
    for(const u of units){u.parts.forEach(id=>add(allocatedParts[u.feature],id));u.carriers.forEach(id=>add(allocatedCarriers[u.feature],id));if(u.local)local.add(u.feature);}
    const owners=taskList.map(()=>({} as Record<string,number>)),used:Record<string,number>={};
    const change=(i:number,id:string,n:number)=>{add(owners[i],id,n);add(used,id,n);};
    const assign=(i:number,visitedTasks=new Set<number>(),visitedIds=new Set<string>()):boolean=>{
      if(visitedTasks.has(i))return false;const tt=new Set([...visitedTasks,i]);
      for(const id of taskList[i].ids) {
        if(visitedIds.has(id)||!ledger[id])continue;
        if((used[id]??0)<ledger[id]){change(i,id,1);return true;}
        const ii=new Set([...visitedIds,id]);
        for(let j=0;j<taskList.length;j++)if(j!==i&&(owners[j][id]??0)>0&&!tt.has(j)) {change(j,id,-1);if(assign(j,tt,ii)){change(i,id,1);return true;}change(j,id,1);}
      }
      return false;
    };
    const order=taskList.map((_,i)=>i).sort((a,b)=>taskList[a].ids.filter(id=>ledger[id]>0).length-taskList[b].ids.filter(id=>ledger[id]>0).length||a-b);
    for(const i of order)for(let n=0;n<taskList[i].count;n++)if(!assign(i))break;
    const body:Record<string,number>={};
    taskList.forEach((t,i)=>{const target=t.body?body:t.carrier?allocatedCarriers[t.feature]:allocatedParts[t.feature];for(const [id,n] of Object.entries(owners[i]))if(n>0)add(target,id,n);});
    const left={...ledger};for(const [id,n] of Object.entries(used))left[id]-=n;
    return {left,parts:allocatedParts,carriers:allocatedCarriers,body,local,allocated:allocatedParts.reduce((n,m)=>n+Object.values(m).reduce((a,b)=>a+b,0),0)};
  };
  const atomicUnits=atomic.flatMap(a=>a.options).sort((a,b)=>a.length-b.length);
  let attempts=0,best:Allocation|undefined,limited=false;
  const search=(at:number,left:Record<string,number>,chosen:Unit[])=>{
    if(++attempts>1024){limited=true;return;}
    if(at===atomicUnits.length){const a=flow(left,chosen),value=(v:Allocation)=>v.allocated*10000+v.carriers.reduce((n,m)=>n+Object.values(m).reduce((a,b)=>a+b,0),0)*100+Object.values(v.body).reduce((n,k)=>n+k,0);if(!best||value(a)>value(best))best=a;return;}
    for(const option of atomicUnits[at]) {
      const use:Record<string,number>={};option.forEach(u=>[...u.parts,...u.carriers].forEach(id=>add(use,id)));
      if(Object.entries(use).some(([id,n])=>(left[id]??0)<n))continue;
      const remaining={...left};Object.entries(use).forEach(([id,n])=>remaining[id]-=n);search(at+1,remaining,[...chosen,...option]);
      const found=best;
      if(found&&found.allocated===features.filter(f=>f.required).reduce((n,f)=>n+f.count,0)&&Object.values(found.body).reduce((n,v)=>n+v,0)===reserveNeed&&features.every((f,i)=>!f.required||!f.opportunity?.carrier||Object.values(found.carriers[i]).reduce((n,v)=>n+v,0)>=f.opportunity.carrier.count))return;
    }
    search(at+1,left,chosen);
  };
  search(0,{...ctx.stock},[]);const allocation=best??flow({...ctx.stock},[]),left={...allocation.left};
  if(limited)blockers.push({code:'allocation-limit',name:'Bounded feature allocation',required:1,available:0,detail:'The local reservation search reached its bound; this is unresolved, not a proven inventory shortage.'});
  const receipts:OpportunityReceipt[]=features.map((f,i)=>{
    const values=(cost:Record<string,number>)=>Object.entries(cost).filter(([,n])=>n>0).map(([id,count])=>({id,count,confidence:byId.get(id)!.confidence}));
    const selected=values(allocation.parts[i]),supports=values(allocation.carriers[i]),allocated=selected.reduce((n,p)=>n+p.count,0);
    if(selected.some(p=>byId.get(p.id)!.kind.type!==f.types[0]))adapted=true;
    const supportCount=supports.reduce((n,p)=>n+p.count,0);
    if(f.required&&!invalid.has(i)&&allocated<f.count)blockers.push({code:f.opportunity?.pairing?'pair-shape':f.opportunity?.carrier?.connection?'local-connection':'feature-parts',name:f.name,required:f.count,available:allocated,detail:`Exact compatible reservations cover ${allocated}/${f.count}; ${f.substitution}`});
    if(f.required&&f.opportunity?.carrier&&supportCount<f.opportunity.carrier.count)blockers.push({code:'carrier-parts',name:`${f.name} carrier`,required:f.opportunity.carrier.count,available:supportCount,detail:'The explicitly specified carriers compete in the same stock ledger.'});
    return {featureIndex:i,name:f.name,required:f.required,requested:f.count,allocated,parts:selected,carriers:supports,evidence:allocation.local.has(i)?'compiled-local-connection':'exact-allocation',structured:!!f.opportunity,
      alternatives:candidates[i].map(p=>({id:p.id,remaining:left[p.id]??0,shapeKey:p.shapeKey})),singletonIds:selected.filter(p=>byId.get(p.id)!.count===1).map(p=>p.id)};
  });
  const reserved=Object.entries(allocation.body).filter(([,count])=>count>0).map(([id,count])=>({id,count,confidence:byId.get(id)!.confidence})),reserveLeft=reserveNeed-reserved.reduce((n,p)=>n+p.count,0);
  const availableBody=bodyParts.reduce((n,p)=>n+(left[p.id]??0)+(allocation.body[p.id]??0),0);
  if(availableBody<reserveNeed)blockers.push({code:'body-reserve',name:'Body construction reserve',required:reserveNeed,available:availableBody,detail:'The ranking policy preserves supporting pieces after feature/carrier reservations; this does not specify a complete body layout.'});
  if(ctx.total<minimum)blockers.push({code:'piece-budget',name:'Purposeful piece budget',required:minimum,available:ctx.total,detail:'Known connection-catalog stock is below the authored minimum piece count.'});
  const required=receipts.filter(r=>r.required),need=required.reduce((n,r)=>n+r.requested,0),have=required.reduce((n,r)=>n+Math.min(r.requested,r.allocated),0);
  const selected=[...required.flatMap(r=>[...r.parts,...r.carriers]),...reserved],known=selected.filter(p=>p.confidence!==null),unknown=selected.filter(p=>p.confidence===null),caution=known.filter(p=>p.confidence!<.5);
  const primary=required.reduce((n,r)=>n+r.parts.reduce((a,p)=>a+(byId.get(p.id)!.kind.type===features[r.featureIndex].types[0]?p.count:0),0),0);
  const alternatives=required.reduce((n,r)=>n+r.alternatives.reduce((a,p)=>a+p.remaining,0),0),singletonFeatures=required.filter(r=>r.singletonIds.length>0).length;
  const slack=Object.values(left).reduce((n,v)=>n+v,0),bodySpan=Math.max(0,...reserved.map(p=>{const part=byId.get(p.id)!;return Math.max(part.widthStuds,part.depthStuds);}));
  const coverage=need?have/need:1,bodyFit=Math.min(1,(reserveNeed-reserveLeft)/reserveNeed),spareFit=slack/Math.max(1,slack+minimum*2),alternativeFit=alternatives/Math.max(1,alternatives+need*4);
  const score=Math.round(100*(coverage*.4+colorCoverage*.15+bodyFit*.15+spareFit*.1+alternativeFit*.1+(need?primary/need:1)*.1)-Math.min(8,singletonFeatures*2)-5*caution.reduce((n,p)=>n+p.count,0)/Math.max(1,selected.reduce((n,p)=>n+p.count,0)));
  const tier=blockers.length?'blocked':(singletonFeatures||spareFit<.5||alternativeFit<.25)?'scarce':required.some(r=>r.evidence==='compiled-local-connection')?'supported-local':'candidate';
  if(required.length)reasons.push(`${have}/${need} required feature pieces have exact ID reservations on one ledger.`);
  if(reserved.length)reasons.push(`${reserveNeed-reserveLeft} supporting pieces are separately reserved for the body; this is an estimate.`);
  if(required.some(r=>r.evidence==='compiled-local-connection'))reasons.push('Only the listed local two-part connector techniques were compiled; the whole subject is unbuilt.');
  if(adapted)reasons.push('The selected IDs use an authored alternative part type.');
  if(ctx.rejected.length)reasons.push(`${ctx.rejected.length} raw inventory entries were excluded from connection capability.`);
  return {tier,score:Math.max(0,Math.min(100,score)),coverage,status:blockers.length?'needs-parts':adapted?'adapt':'promising',receipts,blockers,remaining:left,palette,
    bodyReserve:{requested:reserveNeed,reserved,available:availableBody,spanStuds:bodySpan,footprintCells:reserved.reduce((n,p)=>{const k=byId.get(p.id)!;return n+p.count*k.widthStuds*k.depthStuds;},0)},
    slack:{pieces:slack,featureAlternatives:alternatives,singletonFeatures},
    confidence:{minimum:known.length?Math.min(...known.map(p=>p.confidence!)):null,knownPieces:known.reduce((n,p)=>n+p.count,0),unknownPieces:unknown.reduce((n,p)=>n+p.count,0),cautionPieces:caution.reduce((n,p)=>n+p.count,0),note:'Original scan metadata; unknown is not certainty and these values are not calibrated probabilities. Values below 0.5 are a verification caution policy, not a physical stock reduction.'},
    evidence:'inventory-opportunity-estimate',geometryUnchecked:['Whole-subject proportions, connectivity and craft',...required.filter(r=>r.evidence!=='compiled-local-connection').map(r=>r.name),...(wheeled&&!gearRule?['Running-gear count and mounting layout']:[])],reasons};
}
