import type { ConstructionApproach } from './types';
export interface DesignKnowledge {silhouette:string;traits:string[];approach:ConstructionApproach;alternatives:string[]}
export function constructionKnowledgeText(idea:{construction?:DesignKnowledge}) {
  const k=idea.construction;if(!k)return '';
  return `AUTHORED CONSTRUCTION BRIEF:
Silhouette: ${k.silhouette}
Required identifying traits: ${k.traits.join('; ')}
Chosen approach: ${k.approach.name}. ${k.approach.plan}
Relationship checks: ${k.approach.checks.join('; ')}
Substitutions to consider: ${k.alternatives.join('; ')}
These are design constraints, not an already validated build. Preserve the identifying relationships, openings and proportions. Do not substitute a generic housing, chassis or torso and claim the named subject is complete. If a feature cannot be built from actual stock, report that limitation rather than omit it silently.`;
}
