/**
 * Stage 3: Controlled 5-Prompt Quality Test Script for Meta Model API
 * Tests dialect naturalness, adherence to facts, zero fabrication, and structured schema.
 */

import { MetaClient, ScriptwriterInput } from '../server/metaClient.js';

interface TestCase {
  id: number;
  dialectGroup: 'Algerian Darija' | 'Gulf Arabic';
  input: ScriptwriterInput;
  evaluationCriteria: {
    expectedKeyPhrases: string[];
    forbiddenFabrications: string[];
  };
}

const TEST_CASES: TestCase[] = [
  // --- Test 1: Algerian Darija ---
  {
    id: 1,
    dialectGroup: 'Algerian Darija',
    input: {
      facts: {
        productName: 'زيت الزيتون أفريد (Afridh Olive Oil)',
        description: 'زيت زيتون بكر ممتاز طبيعي 100% معصور على البارد من أشجار الزيتون في جبال بني معوش ببجاية. حموضة منخفضة جداً أقل من 0.5%، قارورة زجاجية عاتمة 1 لتر تحميه من الضوء والحرارة.',
        deliveryAreas: '58 ولاية وخلاص حتى توصلك القارورة للدار',
        ingredientsOrSpecs: 'طعم أصيل غني بمضادات الأكسدة ومثالي للكسرة والسلطات والطبخ التقليدي.'
      },
      targetAudience: 'العائلات الجزائرية ومحبو المنتجات البيولوجية والأكل الصحي التقليدي',
      dialect: 'Algerian Darija',
      platform: 'Instagram Reels / TikTok',
      tone: 'Friendly & Authentic',
      duration: '30s',
      restrictions: 'ممنوع تماماً ذكر أي أسعار أو تخفيضات لم تذكر، لا تدعي أنه يعالج الأمراض المزمنة، ولا تخترع جوائز دولية وهمية.'
    },
    evaluationCriteria: {
      expectedKeyPhrases: ['بني معوش', 'معصور على البارد', '58 ولاية'],
      forbiddenFabrications: ['تخفيض 50%', 'سعر 1000 دج', 'يعالج السرطان', 'حائز على الميدالية الذهبية']
    }
  },

  // --- Test 2: Algerian Darija ---
  {
    id: 2,
    dialectGroup: 'Algerian Darija',
    input: {
      facts: {
        productName: 'كليك كاست (KlickCast DZ)',
        description: 'متجر إلكتروني جزائري متخصص في شواحن الهواتف الأصلية فائقة السرعة، كوابل مضفرة ضد التلف، وحوامل الهواتف المغناطيسية للسيارات.',
        warranty: 'ضمان استبدال رسمي 6 أشهر',
        deliveryTime: '24 ساعة في العاصمة والبليدة وبومرداس وتيبازة، و48 ساعة لباقي الولايات',
        ingredientsOrSpecs: 'شواحن معتمدة تحمي بطارية التيليفون من السخانة، كوابل تريسي صحاح'
      },
      targetAudience: 'الشباب والطلبة وسائقو النقل وأصحاب السيارات',
      dialect: 'Algerian Darija',
      platform: 'TikTok',
      tone: 'Energetic sales',
      duration: '30s',
      restrictions: 'لا تخترع أسعاراً أو نسب تخفيض مئوية. لا تدعي أنه يشحن الهاتف في دقيقة واحدة.'
    },
    evaluationCriteria: {
      expectedKeyPhrases: ['24 ساعة'],
      forbiddenFabrications: ['تخفيض 70%', '1500 دج', 'شحن في دقيقة']
    }
  },

  // --- Test 3: Algerian Darija ---
  {
    id: 3,
    dialectGroup: 'Algerian Darija',
    input: {
      facts: {
        productName: 'سيروم اللحية - لحيتي (Liḥyati Golden Beard)',
        description: 'سيروم طبيعي 100% مغذٍ لشعر اللحية، بتركيبة زيت الأرغان الجزائري وخشب الأرز وزيت بذور العنب. يرطب البشرة تحت اللحية ويقضي على الحكة والتقصف ويمنحها مظهراً مرتباً ورائحة خفيفة.',
        ingredientsOrSpecs: 'خالٍ من السيليكون والمواد الكيميائية الحارقة، ملمس غير دهني يمتصه الشعر بسرعة.'
      },
      targetAudience: 'الرجال والشباب المهتمون بالعناية الشخصية والأناقة اليومية',
      dialect: 'Algerian Darija',
      platform: 'Instagram Reels',
      tone: 'Friendly & Persuasive',
      duration: '30s',
      restrictions: 'لا تدعي أنه ينبت الشعر من الصفر أو يعالج الصلع، لا تخترع شهادات أطباء وهمية.'
    },
    evaluationCriteria: {
      expectedKeyPhrases: ['أرغان', 'حكة', 'طبيعي'],
      forbiddenFabrications: ['إنبات الشعر من الصفر', 'معتمد من منظمة الصحة العالمية', 'سعر خاص 2000 دج']
    }
  },

  // --- Test 4: Gulf Arabic ---
  {
    id: 4,
    dialectGroup: 'Gulf Arabic',
    input: {
      facts: {
        productName: 'قهوة قطرة الباردة (Qatrah Cold Brew)',
        description: 'قهوة مختصة باردة مقطرة ببطء لمدة 18 ساعة باستخدام حبوب إثيوبية مجففة بدرجة تحميص وسط. نكهة ناعمة وقوام متوازن مع إيحاءات فاكهية منعشة بدون أي سكر مضاف أو نكهات صناعية.',
        deliveryAreas: 'الرياض وجدة توصيل مبرد',
        ingredientsOrSpecs: 'معبأة في زجاجات مبردة محكمة الإغلاق تحفظ الانتعاش'
      },
      targetAudience: 'عشاق القهوة المختصة والموظفون والرياضيون في الخليج',
      dialect: 'Gulf Arabic',
      platform: 'Snapchat / TikTok',
      tone: 'Luxury brand voice & Energetic',
      duration: '30s',
      restrictions: 'لا تخترع عروض اشتري 1 واحصل على 1 مجاناً، لا تخترع أسعاراً، لا تدعي خلوها من الكافيين.'
    },
    evaluationCriteria: {
      expectedKeyPhrases: ['بدون سكر مضاف'],
      forbiddenFabrications: ['اشتري واحد واحصل على الثاني مجاناً', 'سعرها 15 ريال', 'خالية تماماً من الكافيين']
    }
  },

  // --- Test 5: Gulf Arabic ---
  {
    id: 5,
    dialectGroup: 'Gulf Arabic',
    input: {
      facts: {
        productName: 'تطبيق لمعة لغسيل السيارات (Lamaa Mobile Detailing)',
        description: 'خدمة غسيل وتلميع السيارات المتنقلة عند بيتك أو دوامك. نستخدم تقنية البخار النانوي الإيطالية الموفرة للماء ومواد نانو سيراميك تحمي صبغة السيارة من حرارة الشمس والغبار.',
        deliveryAreas: 'دبي والرياض عند بيتك أو دوامك',
        ingredientsOrSpecs: 'حجز فوري في دقيقة عبر التطبيق، فريق مختص ومدرب'
      },
      targetAudience: 'أصحاب السيارات والمهنيون المشغولون في الخليج',
      dialect: 'Gulf Arabic',
      platform: 'Instagram Reels / TikTok',
      tone: 'Professional business & Persuasive',
      duration: '30s',
      restrictions: 'لا تخترع باقات اشتراك شهرية أو أسعار، لا تدعي تقديم خدمات تصليح محركات أو صيانة ميكانيكية.'
    },
    evaluationCriteria: {
      expectedKeyPhrases: ['دقيقة'],
      forbiddenFabrications: ['اشتراك سنوي 500 درهم', 'تصليح محركات', 'خصم 60%']
    }
  }
];

async function runQualityTests() {
  console.log('================================================================');
  console.log('STAGE 3: META MODEL API QUALITY EVALUATION (5 CONTROLLED PROMPTS)');
  console.log('Model ID: muse-spark-1.3-contributor');
  console.log('Endpoint: https://api.meta.ai/v1/chat/completions');
  console.log('================================================================\n');

  const client = new MetaClient();
  if (!client.isConfigured()) {
    console.error('ERROR: META_API_KEY is not configured in the environment.');
    process.exit(1);
  }

  const results: any[] = [];
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalCostUsd = 0;

  for (const test of TEST_CASES) {
    console.log(`>>> Executing Test ${test.id}/5 [${test.dialectGroup}]: "${test.input.facts.productName}"...`);
    const startTime = Date.now();
    const result = await client.generateAdScript(test.input);
    const durationMs = Date.now() - startTime;

    if (!result.success || !result.data) {
      console.error(`❌ Test ${test.id} FAILED:`, result.error);
      results.push({
        id: test.id,
        dialectGroup: test.dialectGroup,
        productName: test.input.facts.productName,
        success: false,
        error: result.error,
        durationMs
      });
      continue;
    }

    const { data, usage, validation } = result;
    if (usage) {
      totalPromptTokens += usage.promptTokens;
      totalCompletionTokens += usage.completionTokens;
      totalCostUsd += (usage.estimatedCostUsd || 0);
    }

    const evaluation = {
      id: test.id,
      dialectGroup: test.dialectGroup,
      productName: test.input.facts.productName,
      success: true,
      durationMs,
      data,
      validation,
      usage
    };

    results.push(evaluation);

    console.log(`✅ Test ${test.id} Completed in ${durationMs}ms`);
    console.log(`   Validation: Passed=${validation.passed}, Violations=${validation.violations.length}, Repaired=${validation.regenerationAttempted}`);
    console.log(`   Hook: "${data.hook}"`);
    console.log(`   Script: "${data.script}"`);
    console.log(`   CTA: "${data.cta}"`);
    console.log(`   TTS Settings: style="${data.tts.style}", emotion="${data.tts.emotion}", pace="${data.tts.pace}"`);
    console.log(`   Tokens: Prompt=${usage?.promptTokens}, Completion=${usage?.completionTokens} (Reasoning=${usage?.reasoningTokens})`);
    console.log(`   Estimated Cost: ~$${usage?.estimatedCostUsd}\n`);
  }

  console.log('================================================================');
  console.log('SUMMARY OF ALL 5 TESTS');
  console.log('================================================================');
  console.log(`Total Prompt Tokens: ${totalPromptTokens}`);
  console.log(`Total Completion Tokens: ${totalCompletionTokens}`);
  console.log(`Total Tokens: ${totalPromptTokens + totalCompletionTokens}`);
  console.log(`Total Estimated Cost: ~$${totalCostUsd.toFixed(6)} USD`);
  console.log('================================================================\n');
}

runQualityTests().catch(err => {
  console.error('Fatal error in quality tests:', err);
  process.exit(1);
});
