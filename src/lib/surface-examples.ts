import boat from './fixtures/surface-boat.json';
import robot from './fixtures/surface-robot.json';
import kit from './fixtures/surface-stock.json';
import {compileTechniques,constructionChoices,type TechniqueProgram} from './construction-techniques';
/** Authored capability examples. Never insert these into the qualified library
 * or describe them as freshly generated/appearance-approved models. */
export const surfaceExampleStock:Record<string,number>=kit.stock;
export const surfaceExamples=()=>[boat,robot].map((raw,i)=>({id:i?'robot':'boat',...compileTechniques(raw as TechniqueProgram,surfaceExampleStock,constructionChoices(surfaceExampleStock))}));
