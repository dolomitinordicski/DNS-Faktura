import { runFakturaV2Scenarios } from './scenarios';

const results = await runFakturaV2Scenarios();
console.log(`Faktura v2 domain scenarios passed: ${results.join(', ')}`);
