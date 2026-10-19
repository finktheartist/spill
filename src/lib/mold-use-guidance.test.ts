import {describe,it,expect} from 'vitest';
import {ALL_MOLDS} from './popular-molds';
import {moldUseGuidance,moldUseText,MOLD_USE_BOUNDARY} from './mold-use-guidance';
import {connectorShapeText,connectorText} from './connections';
import {catalogContract} from './whole-model-catalog';
import {signatureParts} from './shape-first/pipeline';
import {wholeModelPrompt} from './shape-first/whole-model-prompt';
import {parsePartId,COLOR_NAMES} from './bricks';
import snapshot from '../data/rebrickable.json';

const shapes=snapshot.shapes as Record<string,{colors:string[]}>;
const idFor=(num:string)=>{
 const m=ALL_MOLDS.find(m=>m.num===num)!;
 const key=`${m.type}-${m.w}x${m.d}`;
 return key+'-'+shapes[key].colors[0];
};
describe('exact native mold meaning in builder context',()=>{
 it('covers every registered mold without changing a single geometry or stock fact',()=>{
  const before=JSON.stringify(ALL_MOLDS),stock=Object.fromEntries(ALL_MOLDS.map(m=>[idFor(m.num),1]));
  const input=JSON.stringify(stock),signature=signatureParts(stock);
  for(const m of ALL_MOLDS){
   const g=moldUseGuidance(m)!;expect(g.name).toBe(m.name);
   expect(g.uses.length).toBeGreaterThan(20);expect(g.chooseWhen.length).toBeGreaterThan(20);
   expect(signature).toContain(idFor(m.num));expect(signature).toContain(m.name);
  }
  expect(JSON.stringify(stock)).toBe(input);expect(JSON.stringify(ALL_MOLDS)).toBe(before);
 });
 it('distinguishes openings, inclined profiles, planar wedges and side-facing carriers',()=>{
  for(const [num,phrase] of [['60592','framed entrances'],['87552','thin walls'],['85984','inclined roofs'],['43722','plan-view'],['52107','side-facing detail carriers'],['6091','rounded shells'],['24201','tapered undersides'],['6005','arched openings'],['13548','plan-view']] as const){
   expect(moldUseText(parsePartId(idFor(num))!)).toContain(phrase);
  }
  expect(moldUseText(parsePartId(idFor('4596'))!)).toContain('raised or stepped');
  expect(moldUseText(parsePartId(idFor('90498'))!)).toContain('No upward stud port');
  expect(moldUseText(parsePartId(idFor('43888'))!)).toContain('No qualified downward socket');
 });
 it('names each stocked shape once in shared technical context and retains exact colors/counts/ports',()=>{
  const a=idFor('60592'),k=parsePartId(a)!;
  const otherColor=shapes[`${k.type}-${k.w}x${k.d}`].colors.find(c=>c!==k.color)!;
  const b=`${k.type}-${k.w}x${k.d}-${otherColor}`,stock={[a]:2,[b]:1};
  const text=connectorShapeText(stock);
  expect(text.split('Exact mold #60592:')).toHaveLength(2);
  expect(text).toContain(a+' × 2');expect(text).toContain(b+' × 1');
  expect(text).toContain('grip');expect(text).toContain('normal');
  expect(connectorText(stock)).toContain('Exact mold #60592:');
  expect(catalogContract(stock)).toContain('framed entrances');
 });
 it('delivers semantic guidance through the actual whole-model prompt without expanding upright poses',()=>{
  const stock={[idFor('60592')]:2,[idFor('85984')]:2};
  const text=wholeModelPrompt({name:'Small gatehouse',pitch:'An open entrance and sloping roof'} as Parameters<typeof wholeModelPrompt>[0],stock,2,8).text;
  expect(text).toContain('Window');expect(text).toContain('inclined roofs');
  expect(text).toContain('upright quarter-turn yaw');expect(text).toContain('no orientation matrix');
  expect(text).toContain('Catalog names and shape-use clues');
  expect(text).toContain(MOLD_USE_BOUNDARY);
 });
 it('does not imply mechanisms from handles, holes or towball labels and never aliases an unknown mold',()=>{
  expect(moldUseText(parsePartId(idFor('2412b'))!)).toContain('Exact mold #2412b:');
  const text=connectorShapeText({[idFor('14704')]:1,[idFor('60478')]:1});
  expect(text).toContain('grant no unlisted joint or moving mechanism');
  expect(moldUseGuidance({type:'mold999999',w:1,d:2})).toBeUndefined();
  const k=parsePartId(idFor('60592'))!;
  expect(moldUseGuidance({...k,w:24,d:24})).toBeUndefined();
  expect(signatureParts({[idFor('60592')]:0})).not.toContain('60592');
  expect(signatureParts({[idFor('60592')]:.5})).not.toContain('60592');
  const key=`${k.type}-${k.w}x${k.d}`,unmade=COLOR_NAMES.find(c=>!shapes[key].colors.includes(c));
  if(unmade)expect(signatureParts({[key+'-'+unmade]:1})).not.toContain('60592');
 });
});
