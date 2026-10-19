import { attachPart, compileConnections, definition, frame, sub, validRotation, requiredContactIssues, type ConnectionOperation, type ConnectionProgram } from './connections';
import { parsePartId, type Build, type Placed } from './bricks';
import { constructionIssues } from './construction';

export interface AttachmentChange {operation:number;before:ConnectionOperation;after:ConnectionOperation}
/** Construction repair only. Preserve part identities/counts, parent graph, and connector face normals.
 * Default search is 320 candidates / 2 seconds; callers can request a bounded larger budget. No pieces are removed, added or recolored.
 * A valid repaired program still requires a separate visual review.
 */
export function fitConnectionProgram(program:ConnectionProgram,stock:Record<string,number>,constraints?:{validate?:(build:Build,complete:boolean)=>string[];lockedOperations?:ReadonlySet<number>;maxChecks?:number;maxMillis?:number}):{program:ConnectionProgram;build:Build;changes:AttachmentChange[];checks:number}{
  let originalError:unknown;
  const checked=(build:Build,complete=true)=>{const issues=constraints?.validate?.(build,complete)??[];if(issues.length)throw Error(issues.join('\n'));return build;};
  try{return {program,build:checked(compileConnections(program,stock)),changes:[],checks:0};}catch(e){originalError=e;}
  if(!program?.operations?.length||program.operations.length>60)throw originalError;
  if(requiredContactIssues([],program.requiredContacts,false).length)throw originalError;
  const used:Record<string,number>={};
  for(const op of program.operations){
    if(!op||!parsePartId(op.partId)||!Number.isFinite(op.twist)||Math.abs(op.twist)>180)throw originalError;
    used[op.partId]=(used[op.partId]??0)+1;if(used[op.partId]>(stock[op.partId]??0))throw originalError;
  }
  const maxChecks=Math.min(3000,Math.max(1,Math.floor(constraints?.maxChecks??320)));
  const deadline=performance.now()+Math.min(30000,Math.max(1,constraints?.maxMillis??2000));let checks=0;
  type State={parts:Placed[];ops:ConnectionOperation[];cost:number};
  let beam:State[]=[{parts:[],ops:[],cost:0}];
  const trial=(parts:Placed[]):Build=>{
    const x=Math.min(...parts.map(p=>p.x)),y=Math.min(...parts.map(p=>p.y));
    return {engine:'connections-v2',name:program.name,description:program.description,steps:parts.map(p=>({caption:'Check',parts:[{...p,x:p.x-x,y:p.y-y}]}))};
  };
  const test=(parts:Placed[])=>{
    if(++checks>maxChecks||performance.now()>deadline)throw Error(`Attachment fitting reached its search budget after ${checks-1} checks. Simplify the crowded arrangement or increase spacing. ${String(originalError).slice(0,700)}`);
    const build=trial(parts),complete=parts.length===program.operations.length;
    // A future feature reserves space as soon as its host exists. Otherwise an
    // earlier valid filler part can occupy its panel/anchor volume, and the
    // locked technique would fail later with no opportunity to move the filler.
    const projected=new Map(parts.map((p,i)=>[i,p]));
    for(let i=parts.length;i<program.operations.length;i++)if(constraints?.lockedOperations?.has(i)){
      const op=program.operations[i],parent=projected.get(op.parent);
      if(parent)projected.set(i,attachPart(parent,op.parentPort,op.partId,op.childPort,op.twist));
    }
    const positions=new Map([...projected.keys()].map((index,i)=>[index,i]));
    const reservedBuild=trial([...projected.values()]);
    const contacts=program.requiredContacts?.filter(c=>positions.has(c.a)&&positions.has(c.b)).map(c=>({...c,a:positions.get(c.a)!,b:positions.get(c.b)!}));
    return constructionIssues(reservedBuild,stock,24).length===0
      &&!requiredContactIssues(reservedBuild.steps.flatMap(s=>s.parts),contacts).length
      &&!requiredContactIssues(build.steps.flatMap(s=>s.parts),program.requiredContacts,complete).length
      &&!(constraints?.validate?.(build,complete).length);
  };
  for(let i=0;i<program.operations.length;i++){
    const op=program.operations[i],next:State[]=[];
    for(const state of beam){
      if(!i){
        if(op.parent!==-1||op.twist!==0)throw originalError;
        const p:Placed={partId:op.partId,x:0,y:0,z:0,rot:program.rootRotation??0};if(test([p]))next.push({parts:[p],ops:[op],cost:0});continue;
      }
      if(!Number.isSafeInteger(op.parent)||op.parent<0||op.parent>=i)throw originalError;
      const parent=state.parts[op.parent],pd=definition(parsePartId(parent.partId)!),cd=definition(parsePartId(op.partId)!);
      const pp=pd.ports.find(p=>p.id===op.parentPort),cp=cd.ports.find(p=>p.id===op.childPort);
      // Unknown ports or changing a stud into a grip are model errors, not spatial repairs.
      if(!pp||!cp||pp.kind===cp.kind)throw originalError;
      const p=attachPart(parent,op.parentPort,op.partId,op.childPort,op.twist);
      if(test([...state.parts,p])){next.push({parts:[...state.parts,p],ops:[...state.ops,op],cost:state.cost});continue;}
      // A proven module's anchor pattern and angle are indivisible. Repair its
      // surrounding ordinary attachments, never change its internal recipe.
      if(constraints?.lockedOperations?.has(i))continue;
      const wrap=(v:number)=>((v+540)%360)-180;
      const turns=[...new Set([op.twist,0,90,-90,180].map(wrap))];
      const sameNormal=(a:number[],b:number[])=>a.every((v,i)=>Math.abs(v-b[i])<1e-8);
      const candidates=pd.ports.filter(p=>p.kind===pp.kind&&sameNormal(p.normal,pp.normal)).flatMap(a=>cd.ports.filter(p=>p.kind===cp.kind&&sameNormal(p.normal,cp.normal)).flatMap(b=>turns.map(twist=>({
        op:{...op,parentPort:a.id,childPort:b.id,twist},
        cost:Math.hypot(...sub(a.point,pp.point))/20+Math.hypot(...sub(b.point,cp.point))/20+Math.abs(wrap(twist-op.twist))/90,
      })))).filter(c=>c.cost>0).sort((a,b)=>a.cost-b.cost);
      let accepted=0;
      for(const candidate of candidates){
        const p=attachPart(parent,candidate.op.parentPort,op.partId,candidate.op.childPort,candidate.op.twist);
        if(!validRotation(p.orientation)||!frame(p).bounds.min.every(Number.isFinite))continue;
        if(test([...state.parts,p])){
          next.push({parts:[...state.parts,p],ops:[...state.ops,candidate.op],cost:state.cost+candidate.cost});
          if(++accepted>=3)break;
        }
      }
    }
    if(!next.length)throw originalError;
    beam=next.sort((a,b)=>a.cost-b.cost).slice(0,3);
  }
  const repaired={...program,operations:beam[0].ops},build=checked(compileConnections(repaired,stock));
  const changes=repaired.operations.flatMap((after,i)=>JSON.stringify(after)!==JSON.stringify(program.operations[i])?[{operation:i,before:program.operations[i],after}]:[]);
  return {program:repaired,build,changes,checks};
}
