import type {Card} from '../screens/Builds';

/** Publish explicit cancellation separately from aborting the request. Stock,
 * geometry and prior review evidence remain unchanged; continuation must still
 * revalidate the retained checkpoint against the current inventory. */
export function stopPendingRequests(cards:Card[],reason:string):Card[] {
 return cards.map(card=>{
  if(card.phase==='ready'||card.phase==='failed')return card;
  return {...card,phase:'failed',build:undefined,preview:card.preview??card.build,
   log:[...card.log,{text:reason,tone:'note',t:card.log.at(-1)?.t??0}]};
 });
}
