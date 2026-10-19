import { matchContext, matchFamily, finishedRecipeFamilies } from './library';
import { discoveryEntries, type Discovery } from './library-discoveries';

self.onmessage = (event: MessageEvent<{ stock: Record<string, number>; saved: Discovery[] }>) => {
  try {
    const { stock, saved } = event.data, context = matchContext(stock), families = finishedRecipeFamilies();
    for (const [index, family] of families.entries()) {
      self.postMessage({ entry: matchFamily(family, stock, context), completed: index + 1, total: families.length });
    }
    for (const entry of discoveryEntries(saved, stock)) self.postMessage({ entry, completed: families.length, total: families.length });
    self.postMessage({ done: true });
  } catch { self.postMessage({ error: 'The library search could not finish. Try again.' }); }
};
