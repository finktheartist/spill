/** A bounded visual repair after the first blind review. A failed patch never replaces the existing build. */
import type { Build } from '../bricks';
import { applyFeaturePatch, featureEditContext, FEATURE_PATCH_SCHEMA, type FeaturePatch, type FeatureEdit } from '../moc-feature-edit';
import { featureChoiceText } from '../moc-features';
import { generate, rolePalette, type RankedIdea } from './pipeline';
import type { ShapeVerdict } from './run';

export interface AppearanceOptions {
  signal?: AbortSignal; minParts: number; views: (build:Build)=>string[];
  judge: (build:Build,idea:RankedIdea,signal?:AbortSignal)=>Promise<ShapeVerdict>;
  onProgress?: (text:string)=>void; debug?: (label:string,data:unknown)=>void;
}
const inline = (url:string) => {
  const match=/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s.exec(url);
  if(!match)throw Error('Visual revision needs actual rendered image data.');
  return {inlineData:{mimeType:match[1],data:match[2]}};
};
const reviewKeys=['recognizable','complete','colors','impressive'] as const;
const validScores=(v:ShapeVerdict)=>reviewKeys.every(k=>Number.isFinite(v[k])&&v[k]>=1&&v[k]<=5);
const strong=(v:ShapeVerdict)=>v.named&&v.recognizable>=4&&v.complete>=4&&v.impressive>=4&&v.colors>=3;
const rank=(v:ShapeVerdict)=>[strong(v)?1:0,v.named?1:0,v.recognizable,Math.min(v.complete,v.impressive),v.complete+v.impressive,v.colors];
function compareReview(before:ShapeVerdict,after:ShapeVerdict) {
  const a=rank(before),b=rank(after);for(let i=0;i<a.length;i++)if(a[i]!==b[i])return Math.sign(b[i]-a[i]);return 0;
}
/** Identity and shape lead; bounded color/core tradeoffs cannot destroy a passing or strong model. */
export const appearanceCanImprove = (before:ShapeVerdict,after:ShapeVerdict) => {
  if(!validScores(before)||!validScores(after)||(before.named&&!after.named)||(before.pass&&!after.pass)||(strong(before)&&!strong(after)))return false;
  // A finished model meeting every strong floor outranks a recognizable but unfinished draft.
  if(strong(after)&&!strong(before))return true;
  if(after.complete<2||after.colors<2||after.impressive<2)return false;
  if((['complete','colors','impressive'] as const).some(k=>after[k]<before[k]-1))return false;
  return compareReview(before,after)>=0;
};
/** Score-only selection must show a strict improvement; ties need an independent image comparison. */
export const appearanceIsBetter=(before:ShapeVerdict,after:ShapeVerdict)=>appearanceCanImprove(before,after)&&compareReview(before,after)>0;

export async function refineAppearance(build:Build,verdict:ShapeVerdict,idea:RankedIdea,stock:Record<string,number>,opts:AppearanceOptions) {
  const keep={build,verdict,improved:false,edit:undefined as FeatureEdit|undefined,reason:'Kept the original.'};
  if(opts.signal?.aborted)throw new DOMException('Stopped','AbortError');
  if(verdict.pass || build.steps.flatMap(s=>s.parts).length>144)return keep;
  const controller=new AbortController(),stop=()=>controller.abort();
  opts.signal?.addEventListener('abort',stop,{once:true});
  const timer=setTimeout(stop,120000),signal=controller.signal;
  const active=()=>{if(signal.aborted)throw new DOMException('Stopped','AbortError');};
  try {
  const colors=[...new Set(Object.values(rolePalette(idea,stock,'pile')).flat())];
  const ctx=featureEditContext(build,stock,`${idea.name} ${idea.pitch}`,colors);
  // Removing distracting detail remains possible when no complete study fits the remaining supply.
  const images=opts.views(build);
  const history:{role:'user'|'model';parts:Record<string,unknown>[]}[]=[{role:'user',parts:[...images.map(inline),{text:`Repair ONE visible weakness in this LEGO model of ${idea.name}: ${idea.pitch}.
These images show the actual current construction. Blind reviewer saw ${JSON.stringify(verdict.looksLike)}; fixes: ${JSON.stringify(verdict.fixes)}.
Use an actual small assembly below to replace an unsuccessful feature, or remove distracting detail. Choose the feature with the greatest effect on recognition, proportion or pose. Preserve successful surfaces and color grouping. Do not decorate an unrecognizable block just to make it busier. An added perch must support the subject; spare pieces do not justify a display pedestal.
Return focus (what visible weakness and why this change helps), remove (zero-based current part indices), add (up to four assemblies). Each add has id, choiceId copied exactly, parent="pN" for a retained original part or "ID:N" for part N of an earlier added assembly, parentPort on that parent, childPort on the new assembly's ROOT part, and twist=-180,-90,0,90,180. Twist is RELATIVE to the current parent's axes, not a world rotation: twist 0 inherits the host orientation. The current part listing supplies world directions of local +x and +y. All descendants keep the recipe's exact orientation; never guess coordinates. A ROOT attaches by one of its actual listed grip ports. Identify the right side of the model from the images and connector coordinates, not the name of the recipe.
At most ${Math.min(12,Math.ceil(ctx.parts*.35))} current parts may be removed; at most sixteen new parts. Keep at least ${opts.minParts} purposeful pieces. Unedited parts stay exactly in place. Remove the old feature to make room, but preserve its mount and any structure depending on it. A removed supporting part can leave a floating head. Everything is committed atomically only if it fits the original inventory, stays connected and has no collision. Do not reuse an occupied connector unless its occupant is removed. New assembly costs include their carriers. Alternatives compete for the same stock; refunds happen only for explicitly removed parts.
CURRENT PARTS AND PORTS (positions in studs, including height in the port coordinates):
${ctx.listing}
UNUSED STOCK: ${JSON.stringify(ctx.remaining)}
ORIGINAL STOCK CEILING: ${JSON.stringify(stock)}
AVAILABLE ASSEMBLIES (independent alternatives, costs include every part):
${featureChoiceText(ctx.choices)}
If none can address the weakness honestly, return focus explaining why and empty remove/add arrays. That retains the original.`}]}];
  let edit:FeatureEdit|undefined;
    for(let attempt=1;attempt<=2;attempt++) {
      active();opts.onProgress?.(attempt===1?'Rebuilding a weak feature from the visual review…':'Correcting the feature’s attachment…');
      const r=await generate<FeaturePatch>(history,FEATURE_PATCH_SCHEMA,signal);
      active();history.push(r.content);opts.debug?.('featurePatch',{attempt,patch:r.json});
      if(Array.isArray(r.json?.remove)&&!r.json.remove.length&&Array.isArray(r.json?.add)&&!r.json.add.length)return {...keep,reason:r.json.focus||'No useful local repair was available.'};
      try {edit=applyFeaturePatch(build,r.json,stock,ctx.choices,opts.minParts);break;}
      catch(e) {
        const reason=(e as Error).message;opts.debug?.('featurePatchRejected',{attempt,reason});
        history.push({role:'user',parts:[{text:`The patch was rejected and NOTHING changed. Correct the same local repair using the original indices. Exact reason: ${reason}. Return a complete replacement patch, or empty arrays to keep the original.`}]});
      }
    }
    if(!edit)return {...keep,reason:'The proposed feature did not fit; the original is intact.'};
    active();opts.onProgress?.('Reviewing the rebuilt feature without its label…');
    const next=await opts.judge(edit.build,idea,signal);active();
    opts.debug?.('featureCandidate',{edit,verdict:next});
    if(!appearanceCanImprove(verdict,next))return {...keep,reason:'The repair did not improve identity and shape within the quality floors; kept the original.'};
    const candidateA=Math.random()<.5,newImages=opts.views(edit.build);
    const pair=await generate<{preferred:'A'|'B'|'tie';reason:string}>([{role:'user',parts:[
      {text:'Compare two LEGO models from three views each. Prefer the model with clearer silhouette, better proportions, coherent color and integrated features. Do not reward size, piece count or presentation order. No title or intended object is supplied. Choose A or B only for a clear visible improvement; otherwise tie. Give one concrete sentence explaining the difference.'},
      {text:'MODEL A'},...(candidateA?newImages:images).map(inline),{text:'MODEL B'},...(candidateA?images:newImages).map(inline),
    ]}],{type:'OBJECT',required:['preferred','reason'],properties:{preferred:{type:'STRING',enum:['A','B','tie']},reason:{type:'STRING'}}},signal);
    active();
    if(!['A','B','tie'].includes(pair.json.preferred)||typeof pair.json.reason!=='string'||!pair.json.reason.trim())throw Error('Invalid blind comparison.');
    const improved=pair.json.preferred===(candidateA?'A':'B');
    opts.debug?.('featureComparison',{...pair.json,candidateLabel:candidateA?'A':'B',improved});
    return improved?{build:edit.build,verdict:next,improved,edit,reason:pair.json.reason}:{...keep,reason:pair.json.reason};
  }catch(e) {
    if(opts.signal?.aborted)throw e;
    opts.debug?.('featureRevisionStopped',{reason:(e as Error).message});
    return {...keep,reason:'The visual repair could not finish; kept the original.'};
  }finally {clearTimeout(timer);opts.signal?.removeEventListener('abort',stop);}
}
