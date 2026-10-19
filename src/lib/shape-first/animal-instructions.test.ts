import {describe,it,expect} from 'vitest';
import large from '../fixtures/large-pile-stock.json';
import {composeWholeAnimal,wholeAnimalIssues} from '../assembly-composer/animal-whole';
import {connectionPairs,frame,validateConnections} from '../connections';
import {wholeAnimalInstructions} from './animal-instructions';
import {authoredWholeAnimalTestLayouts} from '../../../test/whole-animal-fixtures';
describe('human whole-animal instructions',()=>{
 it('keeps authoritative geometry/contacts unchanged and names real earlier attachments',()=>{
  for(const layout of authoredWholeAnimalTestLayouts()){
   const c=composeWholeAnimal(large.stock,layout),before=JSON.stringify(c),build=wholeAnimalInstructions(c),parts=build.steps.flatMap(s=>s.parts);
   expect(JSON.stringify(c)).toBe(before);expect(wholeAnimalIssues(c)).toEqual([]);expect(validateConnections(build,large.stock,24)).toEqual([]);
   expect(build.requiredContacts).toEqual(c.build.requiredContacts);expect(parts).toEqual(c.build.steps.flatMap(s=>s.parts));
   expect(build.steps.some(s=>s.caption.includes('gap beneath the belly open'))).toBe(true);expect(build.steps.some(s=>s.caption.includes('module piece'))).toBe(false);
   for(const [i,step]of build.steps.entries())if(i){const parent=Number(/piece from step (\d+)/.exec(step.caption)![1])-1;expect(parent).toBeLessThan(i);expect(connectionPairs(frame(parts[parent]),frame(parts[i])).length).toBeGreaterThan(0);}
   build.steps[0].parts[0].x+=1;expect(JSON.stringify(c)).toBe(before);
  }
 });
 it('fails closed for mutated or unowned instruction geometry',()=>{
  const c=composeWholeAnimal(large.stock,authoredWholeAnimalTestLayouts()[0]);c.build.steps[2].parts[0].x+=1;
  expect(()=>wholeAnimalInstructions(c)).toThrow('unchecked');
 });
});
