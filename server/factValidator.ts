/**
 * Server-side Product Fact Grounding & Verification Validator
 * Enforces strict grounding against user-supplied verified facts.
 * Rule: Meta generates persuasive wording, never product facts.
 */

export interface VerifiedProductFacts {
  productName: string;
  description: string;
  price?: string;               // e.g. "2500 DZD", "150 SAR"
  discount?: string;            // e.g. "10% for first 100 orders", or undefined
  warranty?: string;            // e.g. "6 months replacement warranty"
  deliveryAreas?: string;       // e.g. "58 wilayas", "Riyadh and Jeddah"
  deliveryTime?: string;        // e.g. "24h to 48h"
  ingredientsOrSpecs?: string;  // e.g. "Cold-pressed extra virgin olive oil"
  otherVerifiedClaims?: string; // Explicit claims vouchsafed by the user
}

export interface FactViolation {
  type: 'price' | 'discount' | 'warranty' | 'delivery_time' | 'delivery_area' | 'medical_claim' | 'fake_award';
  description: string;
  detectedSnippet: string;
  source: 'hook' | 'script' | 'cta';
}

export interface FactValidationResult {
  isValid: boolean;
  violations: FactViolation[];
  warnings: string[];
  originalFacts: VerifiedProductFacts;
}

// Unicode boundary helpers for Arabic and multilingual text
const B_START = '(?:^|[^\\p{L}\\p{N}])';
const B_END = '(?:$|[^\\p{L}\\p{N}])';

// 1. Currency & Price patterns
const PRICE_PATTERNS = [
  new RegExp(`${B_START}(\\d+[\\s]*(?:دج|da|dzd|دينار|دينارا|ريال|ريالا|sar|درهم|درهما|aed|دولار|usd|euro|eur|€|\\$))${B_END}`, 'giu'),
  new RegExp(`((?:سومتو|سومتها|السعر|بسعر|بـ|سعرها|سعره|قيمته)[\\s]*[:=]?[\\s]*\\d+)`, 'giu'),
  new RegExp(`${B_START}(\\d+[\\s]*(?:الف|ملايين|مليون|الف فرنك))${B_END}`, 'giu')
];

// 2. Discount & Promotion patterns
const DISCOUNT_PATTERNS = [
  new RegExp(`${B_START}(\\d+[\\s]*(?:%|بالمية|بالمئة|في المية|في المئة))${B_END}`, 'giu'),
  new RegExp(`${B_START}(تخفيض|تخفيضات|خصم|خصومات|صولد|soldes?|remise|برومو|promo|promotions?)${B_END}`, 'giu'),
  new RegExp(`${B_START}(مجانا|مجاني|مجانية|باطل|بلاش|gratuit|free|هدية مجانية)${B_END}`, 'giu'),
  new RegExp(`((?:اشتري|اشتر|كوموندي)[\\s]+(?:1|واحد)[\\s]+(?:واحصل|وتدي|تاخذ)[\\s]+(?:على)?[\\s]+(?:واحد|الثاني)?[\\s]+(?:مجانا|باطل|بلاش))`, 'giu')
];

// 3. Warranty & Guarantee patterns
const WARRANTY_PATTERNS = [
  new RegExp(`${B_START}(ضمان|ضمانة|ڨارونتي|قارونتي|garantie|كفالة|استبدال مجاني|استرجاع مجاني)${B_END}`, 'giu'),
  new RegExp(`((?:مضمون|مضمونة)[\\s]+(?:لمدة|تاع|سنة|عام|شهور))`, 'giu')
];

// 4. Specific Delivery Time promises
const DELIVERY_TIME_PATTERNS = [
  new RegExp(`${B_START}((?:24|48|72)[\\s]*(?:ساعة|سوايع|heures?|h))${B_END}`, 'giu'),
  new RegExp(`${B_START}(في نفس اليوم|بنفس اليوم|خلال ساعتين|خلال ساعة|في نهار|في نهارين|في يومين)${B_END}`, 'giu'),
  new RegExp(`${B_START}(livraison[\\s]+(?:en[\\s]+)?(?:24|48)h?)${B_END}`, 'giu')
];

// 5. Broad delivery coverage claims (when unverified)
const DELIVERY_AREA_PATTERNS = [
  new RegExp(`${B_START}((?:58|48)[\\s]*(?:ولاية|ولايات))${B_END}`, 'giu'),
  new RegExp(`${B_START}(كامل التراب الوطني|جميع أنحاء المملكة|كافة دول الخليج|جميع مدن المملكة)${B_END}`, 'giu')
];

// 6. Medical / Biological / Miracle claims
const MEDICAL_CLAIM_PATTERNS = [
  new RegExp(`${B_START}(علاج نهائي|يعالج السرطان|يشفي السكري|ينبت الشعر من الصفر|إنبات فوري|يقضي على الصلع نهائياً)${B_END}`, 'giu'),
  new RegExp(`${B_START}(تنحيف 10 كيلو|تخسيس فوري|شهادة أطباء|معتمد من وزارة الصحة|منظمة الصحة العالمية|fda)${B_END}`, 'giu')
];

// 7. Fake global awards / certifications
const FAKE_AWARD_PATTERNS = [
  new RegExp(`${B_START}(أفضل منتج في العالم|الحائز على الجائزة العالمية|المرتبة الأولى عالمياً|شهادة إيزو معتمدة)${B_END}`, 'giu')
];

/**
 * Checks whether user verified facts contain tokens that justify a matched regex snippet.
 */
function factContainsSnippet(combinedFactsText: string, snippet: string): boolean {
  if (!snippet) return false;
  const cleanSnippet = snippet.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  const cleanFacts = combinedFactsText.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  if (cleanSnippet.length === 0) return true;
  return cleanFacts.includes(cleanSnippet);
}

/**
 * Validates generated copy against the submitted verified facts.
 */
export function validateFactGrounding(
  copy: { hook: string; script: string; cta: string },
  facts: VerifiedProductFacts
): FactValidationResult {
  const violations: FactViolation[] = [];
  const warnings: string[] = [];

  const combinedUserFacts = [
    facts.productName || '',
    facts.description || '',
    facts.price || '',
    facts.discount || '',
    facts.warranty || '',
    facts.deliveryAreas || '',
    facts.deliveryTime || '',
    facts.ingredientsOrSpecs || '',
    facts.otherVerifiedClaims || ''
  ].join(' ').toLowerCase();

  const sections: Array<{ name: 'hook' | 'script' | 'cta'; text: string }> = [
    { name: 'hook', text: copy.hook || '' },
    { name: 'script', text: copy.script || '' },
    { name: 'cta', text: copy.cta || '' }
  ];

  for (const { name, text } of sections) {
    if (!text) continue;

    // 1. Price Checks: If user didn't specify price, reject price claims
    if (!facts.price || facts.price.trim().length === 0) {
      for (const pattern of PRICE_PATTERNS) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(text)) !== null) {
          const matchedSnippet = (match[1] || match[0]).trim();
          violations.push({
            type: 'price',
            description: `Draft introduced an unverified price claim ("${matchedSnippet}"), but no price was verified by user.`,
            detectedSnippet: matchedSnippet,
            source: name
          });
        }
      }
    } else {
      // User specified a price; flag if different currency/numbers appear
      for (const pattern of PRICE_PATTERNS) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(text)) !== null) {
          const matchedSnippet = (match[1] || match[0]).trim();
          if (!factContainsSnippet(combinedUserFacts, matchedSnippet)) {
            warnings.push(`Price mention "${matchedSnippet}" in ${name} should be verified against "${facts.price}".`);
          }
        }
      }
    }

    // 2. Discount / Promo Checks: If user didn't specify discount, reject discount claims
    if (!facts.discount || facts.discount.trim().length === 0) {
      for (const pattern of DISCOUNT_PATTERNS) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(text)) !== null) {
          const matchedSnippet = (match[1] || match[0]).trim();
          violations.push({
            type: 'discount',
            description: `Draft introduced an unverified discount/promotion claim ("${matchedSnippet}"), but no discount was verified by user.`,
            detectedSnippet: matchedSnippet,
            source: name
          });
        }
      }
    }

    // 3. Warranty Checks: If user didn't specify warranty, reject warranty promises
    if (!facts.warranty || facts.warranty.trim().length === 0) {
      for (const pattern of WARRANTY_PATTERNS) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(text)) !== null) {
          const matchedSnippet = (match[1] || match[0]).trim();
          violations.push({
            type: 'warranty',
            description: `Draft introduced an unverified warranty/guarantee promise ("${matchedSnippet}"), but no warranty was specified by user.`,
            detectedSnippet: matchedSnippet,
            source: name
          });
        }
      }
    }

    // 4. Delivery Time Checks: If user didn't specify delivery time, reject exact timeframe promises
    if (!facts.deliveryTime || facts.deliveryTime.trim().length === 0) {
      for (const pattern of DELIVERY_TIME_PATTERNS) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(text)) !== null) {
          const matchedSnippet = (match[1] || match[0]).trim();
          violations.push({
            type: 'delivery_time',
            description: `Draft introduced an unverified delivery timeframe ("${matchedSnippet}"), but no delivery time was verified by user.`,
            detectedSnippet: matchedSnippet,
            source: name
          });
        }
      }
    }

    // 5. Delivery Areas: If user didn't specify delivery areas, flag broad territorial claims
    if (!facts.deliveryAreas || facts.deliveryAreas.trim().length === 0) {
      for (const pattern of DELIVERY_AREA_PATTERNS) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(text)) !== null) {
          const matchedSnippet = (match[1] || match[0]).trim();
          violations.push({
            type: 'delivery_area',
            description: `Draft introduced an unverified delivery territory claim ("${matchedSnippet}"), but no delivery areas were specified by user.`,
            detectedSnippet: matchedSnippet,
            source: name
          });
        }
      }
    }

    // 6. Medical & Miracle Claims: Unless user verified them in specs/claims, strictly reject
    for (const pattern of MEDICAL_CLAIM_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const matchedSnippet = (match[1] || match[0]).trim();
        if (!factContainsSnippet(combinedUserFacts, matchedSnippet)) {
          violations.push({
            type: 'medical_claim',
            description: `Draft introduced an unsupported medical or clinical claim ("${matchedSnippet}").`,
            detectedSnippet: matchedSnippet,
            source: name
          });
        }
      }
    }

    // 7. Fake awards & certifications
    for (const pattern of FAKE_AWARD_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const matchedSnippet = (match[1] || match[0]).trim();
        if (!factContainsSnippet(combinedUserFacts, matchedSnippet)) {
          violations.push({
            type: 'fake_award',
            description: `Draft introduced an unverified award or global certification claim ("${matchedSnippet}").`,
            detectedSnippet: matchedSnippet,
            source: name
          });
        }
      }
    }
  }

  return {
    isValid: violations.length === 0,
    violations,
    warnings,
    originalFacts: facts
  };
}
