import type {FoxHeadLayout} from './fox-head-layout';
import {expandFoxTechnique,type FoxTechniqueChoice,type FoxTechniquePlacement} from './fox-techniques';

export interface FoxTechniqueLayout extends FoxHeadLayout {
 techniques?: (FoxTechniquePlacement&{choiceId:string})[];
}
export interface FoxTechniqueUse {
 choiceId:string;studyId:string;kind:FoxTechniqueChoice['kind'];
 /** Indices in the expanded target layout, not final instruction-step indices. */
 layoutIndices:number[];cost:Record<string,number>;targetParts:FoxHeadLayout['parts'];
 evidence:'expanded-compiled-technique';
}

/** A named lesson counts as used only through its exact compiled geometry.
 * Whole-head composition still owns combined stock and connector acceptance. */
export function expandFoxTechniqueLayout(input:FoxTechniqueLayout,choices:readonly FoxTechniqueChoice[]):{layout:FoxHeadLayout;uses:FoxTechniqueUse[]} {
 if(!input||!Array.isArray(input.parts)||input.parts.length>24)throw Error('Provide a bounded free-parts array.');
 if(input.techniques!==undefined&&(!Array.isArray(input.techniques)||input.techniques.length>3))throw Error('Use at most three small technique placements.');
 const parts=input.parts.map(p=>({...p})),uses:FoxTechniqueUse[]=[];
 for(const placement of input.techniques??[]){
  const choice=choices.find(c=>c.id===placement?.choiceId);
  if(!choice)throw Error(`Technique ${String(placement?.choiceId).slice(0,100)} was not offered for this remaining stock.`);
  const expanded=expandFoxTechnique(choice,placement),start=parts.length;
  if(start+expanded.length>24)throw Error(`Free parts plus expanded techniques need ${start+expanded.length} parts; the head/neck limit is 24.`);
  parts.push(...expanded);
  uses.push({choiceId:choice.id,studyId:choice.studyId,kind:choice.kind,layoutIndices:expanded.map((_,i)=>start+i),cost:{...choice.cost},targetParts:expanded.map(p=>({...p})),evidence:'expanded-compiled-technique'});
 }
 return {layout:{id:input.id,description:input.description,parts},uses};
}
