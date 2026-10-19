import type {RankedIdea} from './pipeline';
import {constructionKnowledgeText} from '../build-atlas/guidance';
import {catalogContract} from '../whole-model-catalog';

export function wholeModelPrompt(idea:RankedIdea,stock:Record<string,number>,minParts:number,maxDecisions:number,continuing=false){
 const schema={type:'OBJECT',required:['action','observation','plan','remove','add'],properties:{
  action:{type:'STRING',enum:['edit','inspect','finish']},observation:{type:'STRING'},plan:{type:'STRING'},
  remove:{type:'ARRAY',items:{type:'STRING'}},add:{type:'ARRAY',items:{type:'OBJECT',required:['partId','x','y','z','rot'],properties:{
   partId:{type:'STRING',enum:Object.keys(stock)},x:{type:'NUMBER',description:'Studs, exact multiples of 0.05 (one LDU).'},y:{type:'NUMBER',description:'Studs, exact multiples of 0.05 (one LDU).'},z:{type:'NUMBER',description:'Plate units, exact multiples of 0.125 (one LDU).'},rot:{type:'INTEGER',description:'Upright yaw: 0, 90, 180 or 270 degrees.'},
  }}},
 }};
 const text=`Design a complete, thoughtfully crafted LEGO miniature of ${JSON.stringify(idea.name)}: ${idea.pitch}.
${continuing?'Continue the retained generated draft below. This is a fresh reasoning context over checked physical geometry, not a native continuation of earlier thinking. Every existing pose remains editable.':'This is an empty workbench, not an authored chassis, seed, animal body or recipe. Every pose is yours.'} Use ONLY the exact available stock below. Use ${minParts}–80 purposeful pieces; unused pieces are welcome. A complete smaller subject beats an overextended or padded block assembly. The subject was selected for this pile; confirm its defining features are feasible before spending their parts.

Builder approach:
1. Identify the two to four forms that make this subject unmistakable. Catalog names and shape-use clues below explain potential visible roles: choose exact stocked pieces whose contours and openings match those forms, then validate their actual attachments. Work backwards from their real slopes, curves, tapers, openings, colors and carriers. Reserve scarce matched pieces and their supports on the shared ledger before building bulk.
2. Set a coherent overall scale and hierarchy of masses around those feasible features. Make deliberate negative space, changes of width/height, transitions and a convincing stance. Reduce or redesign the ENTIRE model if a key feature needs a different scale.
3. Solve a coherent connected section per edit. Study the ACTUAL quarter/front/side/rear views and free ports returned after each action. A list of correct parts, a label, a color patch or a physically legal box does not establish likeness or craft.
4. Use specialist pieces to form exposed contours, not buried decoration. When a preferred piece is absent, preserve the feature's visible function through a different construction. A roof must read as a roof, a wing as a wing, and an ear as an ear. Do not accept a tall fin/chimney as a pitched roof or a broad floating deck on a lone post as a resolved base.
5. Revise earlier placements freely. Foundation, body, stance, scale and features remain editable. Do not merely decorate an early bad mass. Reserve decisions for corrections.

${constructionKnowledgeText(idea)}
${idea.features?.length?`SUBJECT SELECTION FEATURE INTENT (provisional stock reservations, not validated placements; you may redesign these while preserving subject identity): ${JSON.stringify(idea.features)}`:''}

Choose one action per response:
- edit: remove up to8 current stable p-number IDs and add up to8 literal poses. Removals refund stock within that atomic edit. To move/rotate/recolor a piece, remove its ID and add its replacement. New pieces may join one another within an edit, or attach underneath real ports. The result must have one actual mating-contact graph, no overlaps, valid stock, a grounded root and a maximum24stud span on every axis. Empty reset is allowed but cannot finish. No snapping, support insertion, pose repair, implicit recoloring or filler follows your response; code only orders instructions through real mating contacts.
- inspect: empty remove/add arrays; read the returned state. This consumes a decision, so edit directly when feedback is sufficient.
- finish: empty remove/add arrays, only after inspecting the complete model in actual views. Digital qualification and independent visual review are separate. A critical-feature reviewer may return visible failures; then use the same editable workbench to repair the actual model.

Rejected proposals never change state, inventory, revision or IDs. Images labelled REJECTED are diagnostic only. Use acceptedState IDs to remove pieces, never proposed-add labels. All earlier pieces are revisable. There are ${maxDecisions} decisions in this bounded session, including any review corrections. ${continuing?'Start from the retained acceptedState and actual views below.':'Start EMPTY.'} Build in coherent batches, not the whole model in one action. Keep observation/plan concise and output only action-schema JSON.

EXACT AVAILABLE STOCK:\n${JSON.stringify(stock)}
${catalogContract(stock)}
The stock ledger is a digital scan estimate, not physical confirmation or strength proof. Do not fabricate parts, duplicate singletons, claim moving mechanisms or explain away visibly missing features.`;
 return {text,schema};
}
