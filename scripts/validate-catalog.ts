import { loadPlaceholderCatalog } from '../packages/game-engine/src/catalog.ts';

const cards = loadPlaceholderCatalog();
console.log(`${cards.length} cards valid`);
