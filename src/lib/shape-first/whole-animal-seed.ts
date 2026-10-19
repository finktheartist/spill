import {animalEarSeeds,type AnimalEarSeed} from '../assembly-composer/animal-ear-seed';
import {frame} from '../connections';
import type {AssemblyComposition} from '../assembly-composer/types';
import type {AnimalBlueprint} from './animal-blueprint';
import {wholeAnimalPartialPlanIssues} from './whole-animal-plan-fit';

/** A tiny compiled construction vocabulary, never a complete head/body template.
 * The selected design's exact reservations choose the two profiles and carrier. */
export function earSeedForBlueprint(stock:Record<string,number>,blueprint:AnimalBlueprint):AnimalEarSeed|undefined {
 const feature=blueprint.features.find(f=>f.intent==='pointed-ears'),head=blueprint.regions.find(r=>r.role==='head');if(!feature||!head)return;
 const left=feature.pieces.find(p=>p.role==='ear-left'),right=feature.pieces.find(p=>p.role==='ear-right');if(!left||!right||left.count!==1||right.count!==1)return;
 const carriers=feature.carriers.filter(c=>c.role==='head'),candidates=carriers.flatMap(c=>animalEarSeeds(stock,{leftId:left.partId,rightId:right.partId,carrierId:c.partId}));
 return candidates.filter(s=>!wholeAnimalPartialPlanIssues({id:'ear-motif',description:'Three-part construction vocabulary only',parts:s.parts},blueprint).length&&s.sizeStuds[0]<=blueprint.size.max[0]+1e-5&&s.parts.filter(p=>p.role==='head').every(p=>{
  const f=frame({...p,z:p.z/.4});return [0,1,2].every(a=>(f.bounds.max[a]-f.bounds.min[a])/20<=head.max[a]-head.min[a]+2*head.tolerance+1e-5);
 })).sort((a,b)=>Math.abs(a.sizeStuds[0]-(head.max[0]-head.min[0]))-Math.abs(b.sizeStuds[0]-(head.max[0]-head.min[0]))||a.rootRotation-b.rootRotation||a.id.localeCompare(b.id))[0];
}
export interface WholeAnimalMotifUse {id:string;evidence:'compiled-three-part-motif';cost:Record<string,number>;indices:number[]}
export function earSeedUsage(c:AssemblyComposition,seed:AnimalEarSeed):WholeAnimalMotifUse {
 const all=c.build.steps.flatMap(s=>s.parts),indices:number[]=[];
 for(const r of c.receipts){const n=c.plan.nodes.find(n=>n.id===r.id)!;n.option.program.operations.forEach((op,i)=>{const source=(op as typeof op&{sourceIndex?:number}).sourceIndex;if(source!==undefined&&source>=0&&source<3){if(all[r.indices[i]].partId!==seed.operations[source].partId||r.role!==seed.operations[source].role)throw Error('Compiled ear motif identity/role changed.');indices[source]=r.indices[i];}});}
 if(indices.length!==3||[0,1,2].some(i=>!Number.isSafeInteger(indices[i])))throw Error('The complete build did not retain all three motif parts.');
 return {id:seed.id,evidence:'compiled-three-part-motif',cost:{...seed.cost},indices};
}
