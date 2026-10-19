import type {Card} from '../screens/Builds';
import {constructionIssues} from './construction';

function stale(card:Card,text:string,renderable=true):Card {
 return {...card,phase:'failed',craftPass:false,
  // Retain an explicitly unfinished snapshot, never an openable final build.
  preview:renderable?card.build??card.preview:undefined,build:undefined,checkpoint:undefined,instructionsReady:false,
  log:[...card.log,{text,tone:'note',t:card.log.at(-1)?.t??0}]};
}

/** Pure stock-change transition. The caller separately aborts active requests.
 * Completed bucket models are rechecked against exact current stock and the
 * unchanged geometry authority; any-part modes keep their shopping semantics.
 * No pose, color, quantity, physics gate or prior review evidence is repaired.
 */
export function invalidateRequestStock(cards:Card[],nextStock:Record<string,number>):Card[] {
 return cards.map(card=>{
  if(card.phase==='failed'){
   const key=(s:Record<string,number>)=>JSON.stringify(Object.entries(s).sort(([a],[b])=>a.localeCompare(b)));
   if(card.checkpoint&&key(card.checkpoint.stock)!==key(nextStock))return stale(card,'Inventory changed; the stored draft cannot be continued with a different stock ledger.');
   if(!card.instructionsReady||!card.build)return card;
  }
  if(card.phase!=='ready'&&card.phase!=='failed')return stale(card,'Inventory changed; this unfinished request was stopped. Start again with the corrected pieces.');
  if(card.idea.mode==='accurate'||card.idea.mode==='super')return card;
  let issues:string[],renderable=true;
  try{
   issues=card.build?constructionIssues(card.build,nextStock,24).map(issue=>issue.message):['No completed build is available.'];
  }catch{
   issues=['The saved model geometry could not be revalidated.'];renderable=false;
  }
  return issues.length?stale(card,`Inventory changed; this bucket model no longer qualifies with the current pieces. ${issues.slice(0,2).join(' ')} Start again with the corrected pile.`,renderable):card;
 });
}
