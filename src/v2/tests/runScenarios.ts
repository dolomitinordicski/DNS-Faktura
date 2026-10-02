import { runFakturaV2Scenarios } from './scenarios';

const results = runFakturaV2Scenarios();
console.log(`Faktura v2 domain scenarios passed: ${results.join(', ')}`);
