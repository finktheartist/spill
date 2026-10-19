import {expect,it} from 'vitest';
import {contourPlan,contourCandidates} from './contour-animals';
import {recipeExample,buildCounts,matchRecipe} from './library';
import {constructionIssues} from './construction';
import {partCount} from './bricks';
import data from '../../test/fixtures/photo-stock.json';
it('compiles three distinct connected silhouettes against the same unmodified stock',()=>{
 for(const profile of ['shell','upright','long'] as const){
  const plan=contourPlan(profile),build=recipeExample(plan.recipe);
  expect(constructionIssues(build,buildCounts(build),24),profile).toEqual([]);
 }
 const matches=contourCandidates(data.stock);
 expect(matches.map(m=>m.recipeId)).toEqual(['contour:tortoise','contour:duck','contour:otter-10']);
 for(const match of matches){expect(constructionIssues(match.build,data.stock,24)).toEqual([]);expect(partCount(match.build)).toBeGreaterThanOrEqual(20);}
});

it('reallocates a shorter tail without inventing shaping pieces or changing the stock',()=>{
 const before=JSON.stringify(data.stock),short=matchRecipe(contourPlan('long',8).recipe,data.stock)!;
 expect(short).not.toBeNull();expect(constructionIssues(short.build,data.stock,24)).toEqual([]);
 expect(short.parts['plate-1x10-reddish-brown']??0).toBe(0);
 expect(JSON.stringify(data.stock)).toBe(before);
 const noCurve={...data.stock,'curve-1x3-white':0};
 expect(contourCandidates(noCurve).some(m=>m.recipeId==='contour:duck')).toBe(false);
});
