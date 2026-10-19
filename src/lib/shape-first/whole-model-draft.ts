import {partCount,type Build} from '../bricks';
import {finishWithPolicy} from '../whole-model-workbench';
import type {Card,LogLine} from '../../screens/Builds';
import {validateCheckpoint,type WholeModelCheckpoint} from './whole-model-checkpoint';
import type {WholeModelResult} from './whole-model';

/** Recover instructions only for the exact geometry that reached visual review.
 * Arbitrary previews remain unfinished. Stock and the native finish policy are
 * rechecked; visual approval is never inferred. */
export function checkpointDraftBuild(raw:WholeModelCheckpoint,stock:Record<string,number>):Build|undefined {
 const c=validateCheckpoint(raw,stock);
 if(!c.review||c.reviewRevision!==c.state.revision)return;
 const final=finishWithPolicy(c.state,{mode:'subset',minParts:20});
 if(!final.accepted||!final.candidate)return;
 return {...final.candidate,name:c.idea.name,description:'Generated draft; subject and appearance are not approved.',source:{kind:'discovery',recipeId:'whole-model:editable'}};
}

/** Called only after buildWholeModel returns its digitally qualified result.
 * Appearance approval controls quality and saving, never access to these steps. */
export function wholeModelRequestResult(card:Card,a:WholeModelResult):Card {
 const matched=a.verdict.named&&a.verdict.recognizable>=2,qualityPass=matched&&a.verdict.pass,t=Math.round((Date.now()-card.startedAt)/1000);
 const text=!matched?`Draft: the reviewer saw “${a.verdict.looksLike}” and did not identify the requested subject. You can still build this draft.`
  :a.verdict.pass?`Complete original model reviewed; ${a.unused} pieces left unused.`:`Draft: ${a.verdict.fixes.join('; ')}`;
 const log:LogLine[]=[...card.log,{text,tone:qualityPass?'good':'note',t},...(a.excluded.length?[{text:`Connection catalog does not support: ${a.excluded.join(', ')}. These pieces were left unused.`,tone:'note' as const,t}]:[])];
 return {...card,phase:matched?'ready':'failed',build:a.build,instructionsReady:true,verdict:a.verdict,craftPass:qualityPass,partsUsed:partCount(a.build),log};
}
