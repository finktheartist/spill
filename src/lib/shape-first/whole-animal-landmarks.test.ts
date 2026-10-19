import {describe,it,expect} from 'vitest';
import {authoredWholeAnimalTestLayouts} from '../../../test/whole-animal-fixtures';
import {foxFeatureLandmarks} from './whole-animal-landmarks';
const head=()=>{const l=authoredWholeAnimalTestLayouts()[0];return {...l,parts:l.parts.filter(p=>['head','neck','muzzle','nose','eye-left','eye-right','ear-left','ear-right'].includes(p.role))};};
describe('actual face landmarks before prefix commitment',()=>{
 it('accepts supported test heads in the declared front=-y frame without needing a body',()=>{for(const l of authoredWholeAnimalTestLayouts()){const h={...l,parts:l.parts.filter(p=>!p.role.startsWith('leg-')&&!['frame','chest','hips','torso','tail'].includes(p.role))};expect(foxFeatureLandmarks(h).issues).toEqual([]);}});
 it('reports a backward/off-center snout quantitatively instead of freezing it as a legal face',()=>{
  const l=head();for(const p of l.parts.filter(p=>p.role==='muzzle'||p.role==='nose')){p.y+=6;p.x+=1;}
  const r=foxFeatureLandmarks(l);expect(r.issues.some(i=>i.includes('SMALLER world y'))).toBe(true);expect(r.issues.some(i=>i.includes('off the head center'))).toBe(true);expect(r.measurements.snoutProjection).toBeLessThan(0);
 });
 it('rejects a recessed nose and an excessive stack, while preserving input',()=>{const l=head(),nose=l.parts.find(p=>p.role==='nose')!;nose.y+=1;nose.z+=2;const before=JSON.stringify(l),r=foxFeatureLandmarks(l);expect(r.issues.some(i=>i.includes('BEHIND muzzle'))).toBe(true);expect(r.issues.some(i=>i.includes('thickness'))).toBe(true);expect(JSON.stringify(l)).toBe(before);});
});
