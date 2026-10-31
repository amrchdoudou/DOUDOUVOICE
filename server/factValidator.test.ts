import assert from 'node:assert';
import { validateFactGrounding, VerifiedProductFacts } from './factValidator.js';

console.log('Running automated fact-grounding tests...\n');

// Baseline: Omitted fields (price, discount, warranty, delivery time, delivery area are all UNKNOWN)
const omittedFactsBase: VerifiedProductFacts = {
  productName: 'شاي الأعشاب الطبيعي',
  description: 'مشروب أعشاب طبيعي مهدئ ومساعد على الاسترخاء مساءً.'
};

// 1. Test Price Omission
console.log('1. Testing Price Omission Detection...');
const priceViolationDraft = {
  hook: 'تحوس على راحة البال بعد يوم متعب؟',
  script: 'شاي الأعشاب الطبيعي يوفرلك استرخاء تام وسومتو غير بـ 1500 دج فقط للعلبة.',
  cta: 'كوموندي دروك وتوصلك للدار!'
};
const priceResult = validateFactGrounding(priceViolationDraft, omittedFactsBase);
assert.strictEqual(priceResult.isValid, false, 'Should fail validation when price is introduced but omitted in facts');
assert.strictEqual(priceResult.violations.some(v => v.type === 'price'), true, 'Should flag price violation');
console.log('   ✓ Detected Algerian Darija unverified price claim:', priceResult.violations.find(v => v.type === 'price')?.detectedSnippet);

const gulfPriceViolationDraft = {
  hook: 'تبي تروق بعد دوام طويل؟',
  script: 'جرب شاي الأعشاب الطبيعي، نكهة مهدئة وسعره 99 ريال بس.',
  cta: 'اطلبه الحين!'
};
const gulfPriceResult = validateFactGrounding(gulfPriceViolationDraft, omittedFactsBase);
assert.strictEqual(gulfPriceResult.isValid, false);
assert.strictEqual(gulfPriceResult.violations.some(v => v.type === 'price'), true);
console.log('   ✓ Detected Gulf Arabic unverified price claim:', gulfPriceResult.violations.find(v => v.type === 'price')?.detectedSnippet);

// 2. Test Discount Omission
console.log('\n2. Testing Discount Omission Detection...');
const discountViolationDraft = {
  hook: 'عرض خاص ومحدود يا خاوتنا!',
  script: 'استفاد من برومو تخفيض 30% على شاي الأعشاب المهدئ.',
  cta: 'اشتري واحد وتدي الثاني باطل دروك!'
};
const discountResult = validateFactGrounding(discountViolationDraft, omittedFactsBase);
assert.strictEqual(discountResult.isValid, false);
assert.strictEqual(discountResult.violations.some(v => v.type === 'discount'), true);
console.log('   ✓ Detected unverified discount/promo claims:', discountResult.violations.map(v => v.detectedSnippet));

// 3. Test Warranty Omission
console.log('\n3. Testing Warranty Omission Detection...');
const warrantyViolationDraft = {
  hook: 'راك خايف ما يعجبكش؟',
  script: 'عندك ڨارونتي استرجاع كاملة لمدة عام وضمان استبدال بدون نقاش.',
  cta: 'جرب وماتخافش!'
};
const warrantyResult = validateFactGrounding(warrantyViolationDraft, omittedFactsBase);
assert.strictEqual(warrantyResult.isValid, false);
assert.strictEqual(warrantyResult.violations.some(v => v.type === 'warranty'), true);
console.log('   ✓ Detected unverified warranty claim:', warrantyResult.violations.map(v => v.detectedSnippet));

// 4. Test Delivery Time Omission
console.log('\n4. Testing Delivery Time Omission Detection...');
const deliveryTimeViolationDraft = {
  hook: 'محتاجه مستعجل لليوم؟',
  script: 'توصيل سريع يوصلك في 24 ساعة لباب دارك في كل مكان.',
  cta: 'احجز طلبك الحين!'
};
const deliveryTimeResult = validateFactGrounding(deliveryTimeViolationDraft, omittedFactsBase);
assert.strictEqual(deliveryTimeResult.isValid, false);
assert.strictEqual(deliveryTimeResult.violations.some(v => v.type === 'delivery_time'), true);
console.log('   ✓ Detected unverified delivery timeframe claim:', deliveryTimeResult.violations.map(v => v.detectedSnippet));

// 5. Test Medical Claim Detection
console.log('\n5. Testing Medical / Miracle Claim Detection...');
const medicalViolationDraft = {
  hook: 'الحل النهائي للأرق والسكري!',
  script: 'شاي الأعشاب يعالج السرطان ويقضي على التوتر نهائياً بشهادة أطباء عالميين.',
  cta: 'اشتر الآن!'
};
const medicalResult = validateFactGrounding(medicalViolationDraft, omittedFactsBase);
assert.strictEqual(medicalResult.isValid, false);
assert.strictEqual(medicalResult.violations.some(v => v.type === 'medical_claim'), true);
console.log('   ✓ Detected unsupported clinical/medical claims:', medicalResult.violations.map(v => v.detectedSnippet));

// 6. Test Valid Grounded Draft (When user DID verify these facts)
console.log('\n6. Testing Valid Script Grounded In Explicit User Facts...');
const verifiedFactsFull: VerifiedProductFacts = {
  productName: 'سماعات بلوتوث تيك ساوند',
  description: 'سماعات لاسلكية عازلة للضوضاء تدوم 24 ساعة.',
  price: '4500 دج',
  warranty: 'ضمان 6 أشهر رسمي',
  deliveryTime: '24 ساعة',
  deliveryAreas: '58 ولاية'
};

const compliantDraft = {
  hook: 'عييت من حس الزنقة والخدمة وأنت تسمع في صوالحك؟',
  script: 'سماعات تيك ساوند تعزلك على العالم وتشدلك 24 ساعة، مع ضمان 6 أشهر رسمي وبسعر 4500 دج والتوصيل لـ 58 ولاية.',
  cta: 'كوموندي دروك وخلي وذنيك يتهناو!'
};
const compliantResult = validateFactGrounding(compliantDraft, verifiedFactsFull);
assert.strictEqual(compliantResult.isValid, true, 'Compliant draft should pass when claims match verified facts');
assert.strictEqual(compliantResult.violations.length, 0, 'Should have 0 violations for verified facts');
console.log('   ✓ Compliant draft successfully passed with 0 violations!');

console.log('\n============================================================');
console.log('ALL FACT-GROUNDING VALIDATION TESTS PASSED CLEANLY (100%)');
console.log('============================================================\n');
