import assert from 'node:assert';
import { detectScript, normalizeKabyle } from './kabyle.js';

console.log('Running Kabyle linguistic unit tests...');

// 1. Script detection tests
assert.strictEqual(detectScript('Azul fell-awen, amek tettilim?'), 'latin', 'Should detect standard Latin Kabyle');
assert.strictEqual(detectScript('أزول فلاون، أمك ثليذ؟'), 'arabic', 'Should detect Arabic script Kabyle');
assert.strictEqual(detectScript('ⴰⵣⵓⵍ ⴼⵍⵍⴰⵡⴻⵏ'), 'tifinagh', 'Should detect Tifinagh script Kabyle');
assert.strictEqual(detectScript('Azul فلاون'), 'mixed', 'Should detect mixed scripts');
assert.strictEqual(detectScript(''), 'latin', 'Empty string defaults to latin');

// 2. Normalization tests
// Whitespace & newlines
const multiSpace = '  Azul    fell-awen   \n\n  amek    tella?   ';
assert.strictEqual(normalizeKabyle(multiSpace), 'Azul fell-awen\n\namek tella?', 'Collapses horizontal whitespace');

// Apostrophe unification
const curlyApos = 'd’acu i g’ellan? d‘aɣbalu nʼtmusni';
assert.strictEqual(normalizeKabyle(curlyApos), "d'acu i g'ellan? d'aɣbalu n'tmusni", 'Unifies curly and modifier apostrophes');

// Greek lookalikes conversion
const greekLookalikes = 'A\u03B5ul d a\u03B3rum \u0395\u0393';
assert.strictEqual(normalizeKabyle(greekLookalikes), 'Aɛul d aɣrum ƐƔ', 'Converts Greek epsilon and gamma to Latin Kabyle letters');

// Chat conventions conversion (3 -> ɛ, 7 -> ḥ, 9 -> q)
assert.strictEqual(normalizeKabyle('sa7a 3aslama 9rib'), 'saḥa ɛaslama qrib', 'Converts chat numbers in Kabyle words');
assert.strictEqual(normalizeKabyle('3awed iyi-d am3elmin'), 'ɛawed iyi-d amɛelmin', 'Converts chat numbers inside Kabyle words');

// Preserving prices, numbers, URLs, and tech terms
assert.strictEqual(normalizeKabyle('ssuma d 500 DA'), 'ssuma d 500 DA', 'Preserves numbers and prices');
assert.strictEqual(normalizeKabyle('379 imdanen'), '379 imdanen', 'Preserves standalone numbers');
assert.strictEqual(normalizeKabyle('fichier mp3 di https://example.com/item?id=3'), 'fichier mp3 di https://example.com/item?id=3', 'Preserves tech terms and URLs');

console.log('All Kabyle linguistic unit tests passed successfully!');
