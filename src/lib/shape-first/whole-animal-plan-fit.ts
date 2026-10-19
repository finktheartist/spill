import {frame,type V3} from '../connections';
import type {WholeAnimalLayout} from '../assembly-composer/animal-whole';
import {solidIntersectsEmpty,uniqueAnimalReservations,type AnimalBlueprint} from './animal-blueprint';
/** Necessary, translation-invariant checks before committing a partial prefix.
 * Adding later parts cannot make an existing extent smaller. This catches a
 * long bar turned across the animal before a whole torso becomes prepaid. It
 * neither accepts anatomy nor claims a visible taper or rendered craft. */
export function wholeAnimalPartialPlanIssues(layout:WholeAnimalLayout,plan:AnimalBlueprint):string[]{
 const frames=layout.parts.map(p=>frame({...p,z:p.z/.4})),boxes=layout.parts.map((p,i)=>({role:p.role,min:frames[i].bounds.min.map(n=>n/20),max:frames[i].bounds.max.map(n=>n/20)})),issues:string[]=[];
 if(!boxes.length)return ['No partial construction to compare.'];
 const selected=new Map<string,number>(),reserved=new Map<string,number>(),extra=new Map<string,number>();
 for(const p of layout.parts){const key=`${p.role}/${p.partId}`;selected.set(key,(selected.get(key)??0)+1);}
 for(const p of uniqueAnimalReservations(plan)){const key=`${p.role}/${p.partId}`;reserved.set(key,(reserved.get(key)??0)+p.count);}
 for(const [key,n]of reserved){const role=key.split('/')[0];extra.set(role,(extra.get(role)??0)+Math.max(0,n-(selected.get(key)??0)));}
 for(const r of plan.regions)if(r.role!=='frame'&&!boxes.some(b=>b.role===r.role))extra.set(r.role,Math.max(1,extra.get(r.role)??0));
 const minimum=layout.parts.length+[...extra.values()].reduce((n,v)=>n+v,0);
 if(minimum>plan.parts.max)issues.push(`The prepaid ${layout.parts.length}parts plus remaining mandatory roles/reservations need at least${minimum}, exceeding parts.max${plan.parts.max}. Leave room for the real remaining anatomy.`);
 const extent=(bb:typeof boxes)=>[0,1,2].map(a=>Math.max(...bb.map(b=>b.max[a]))-Math.min(...bb.map(b=>b.min[a]))),whole=extent(boxes),fmt=(n:number[])=>n.map(v=>Number(v.toFixed(3))).join(' × ');
 if(whole.some((n,a)=>n>plan.size.max[a]+1e-5))issues.push(`Actual partial dimensions ${fmt(whole)}studs already exceed final maximum ${fmt(plan.size.max)}; later parts cannot shrink the prefix. Correct actual bar rotation/carriers before freezing it.`);
 const shifts=[0,1,2].map(()=>({low:-Infinity,high:Infinity}));
 for(const r of plan.regions){const selected=boxes.filter(b=>b.role===r.role);if(!selected.length)continue;const actual=extent(selected),capacity=r.min.map((n,a)=>r.max[a]-n+2*r.tolerance);
  for(let a=0;a<3;a++){shifts[a].low=Math.max(shifts[a].low,r.min[a]-r.tolerance-Math.min(...selected.map(b=>b.min[a])));shifts[a].high=Math.min(shifts[a].high,r.max[a]+r.tolerance-Math.max(...selected.map(b=>b.max[a])));}
  if(actual.some((n,a)=>n>capacity[a]+1e-5))issues.push(`Actual ${r.role} dimensions ${fmt(actual)}studs exceed its tolerance-expanded ${fmt(capacity)} envelope. Later anatomy cannot reduce an earlier role's extent.`);
  if(r.intent==='small'&&actual.some(n=>n>1.5+1e-5))issues.push(`${r.role} promises small (each axis<=1.5studs), but the actual reserved detail is ${fmt(actual)}.`);
  if(r.intent==='thin'&&Math.min(...actual)>1+1e-5)issues.push(`${r.role} promises thin (at least one axis<=1stud), but the actual region is ${fmt(actual)}.`);
 }
 if(shifts.some(s=>s.low>s.high+1e-5))issues.push('The actual partial roles cannot fit their chosen envelopes under ONE common origin translation; repair their relative supports/positions before freezing them.');
 // For one convex solid, the translations producing positive-volume overlap
 // with a convex empty box form a convex set (their Minkowski difference).
 // If ALL eight corners of the feasible translation box overlap that SAME
 // solid, every feasible translation is blocked. Checking different solids at
 // different corners would be unsound, so this deliberately proves less.
 if(shifts.every(s=>Number.isFinite(s.low)&&Number.isFinite(s.high)&&s.low<=s.high+1e-5)){
  // Expand rather than shrink the possible translations for floating residue.
  const corners=Array.from({length:8},(_,i)=>shifts.map((s,a)=>(i>>a)&1?s.high+1e-5:s.low-1e-5));
  for(const empty of plan.emptyRegions)if(frames.some(f=>f.solids.some(s=>corners.every(delta=>solidIntersectsEmpty(s,{min:empty.min.map((n,a)=>(n-delta[a])*20) as V3,max:empty.max.map((n,a)=>(n-delta[a])*20) as V3})))))issues.push(`${empty.id}: this required void intersects one fixed nominal convex solid under EVERY feasible prefix translation. Revise the sketch or rebuild the responsible prefix.`);
 }
 return issues;
}

/** These failures concern editable design intent. Stock, subject, anatomy,
 * palette and reserved-contact allocation failures require construction work. */
export function mutableWholeAnimalSketchIssues(issues:string[],blueprint?:AnimalBlueprint):boolean {
 return issues.length>0&&issues.every(s=>/^Final overall size/.test(s)||/actual anatomy exceeds|selected thin region|selected small detail|no selected contour profile/.test(s)||/^Actual (?:full-body\/head proportions|projecting muzzle\/nose|substantial rear tail|paired alert ears)/.test(s)||/: deliberate empty region contains/.test(s)||/No globally exclusive assignment.*reserved contact graph/.test(s)&&!!blueprint?.features.some(f=>f.supportMode!=='anatomy'));
}
