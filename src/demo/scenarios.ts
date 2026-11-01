import type { RawOffer, RawRequirements } from "@/domain/schemas";
import { rawOffer, rawRequirements, v } from "./build";

/* All suppliers, prices and replies here are fictional. No scenario names a winner for the app to show:
   `expected` is only asserted by the tests against what the real decision engine computes. */

export type DemoReply = { offerIndex: number; text: string; raw: RawOffer };

export type Scenario = {
  id: string;
  title: string;
  lesson: string;
  requirementText: string;
  rawRequirements: RawRequirements;
  offers: { text: string; raw: RawOffer }[];
  reply?: DemoReply;
  expected: {
    verdict: string;
    winnerIndex?: number;
    categories: ("confirmed" | "clarify" | "fail")[];
    totalsSar?: (number | null)[];
    note: string;
  };
};

const baseReq = (text: string, extra: Partial<RawRequirements> = {}) =>
  rawRequirements({
    product: v("أكواب مشروبات ساخنة", "كوب للمشروبات الساخنة"),
    quantity: v(3000, "٣٠٠٠ كوب"),
    sizeOz: v(8, "٨ أونصات"),
    use: v("hot" as const, "للمشروبات الساخنة"),
    city: v("الرياض", "الرياض"),
    ...extra,
  });

const REQ_BASIC = "أحتاج ٣٠٠٠ كوب للمشروبات الساخنة، مقاس ٨ أونصات، التوصيل إلى الرياض.";

export const scenarios: Scenario[] = [
  {
    id: "delivery-flip",
    title: "الأرخص إعلانًا يغلى بعد التوصيل",
    lesson: "سعر الكوب الأقل لا يعني مبلغًا أقل إذا كانت رسوم التوصيل مرتفعة.",
    requirementText: REQ_BASIC,
    rawRequirements: baseReq(REQ_BASIC),
    offers: [
      {
        text: "مؤسسة الندى (مثال خيالي): كوب ورقي ٨ أونصات للمشروبات الساخنة، السعر ٠٫٣٨ ريال للحبة شامل الضريبة. التوصيل للرياض ٣٠٠ ريال شامل الضريبة. التسليم خلال ٥ أيام.",
        raw: rawOffer({
          supplierName: v("مؤسسة الندى", "مؤسسة الندى"), cupSizeOz: v(8, "٨ أونصات"), use: v("hot", "للمشروبات الساخنة"), material: v("paper", "كوب ورقي"),
          priceAmount: v(0.38, "٠٫٣٨ ريال للحبة"), priceBasis: v("per_item", "للحبة"), vatStatus: v("included", "شامل الضريبة"),
          deliveryKind: v("amount", "التوصيل للرياض ٣٠٠ ريال"), deliveryAmount: v(300, "٣٠٠ ريال"), deliveryVat: v("included", "٣٠٠ ريال شامل الضريبة"),
          deliveryCities: v(["الرياض"], "التوصيل للرياض"), leadTimeDays: v(5, "خلال ٥ أيام"),
        }),
      },
      {
        text: "شركة الواحة (مثال خيالي): كوب ورقي مقاس ٨ أونصات للساخن، ٠٫٤٢ ريال للحبة شامل الضريبة، والتوصيل مجاني داخل الرياض. التسليم خلال ٤ أيام.",
        raw: rawOffer({
          supplierName: v("شركة الواحة", "شركة الواحة"), cupSizeOz: v(8, "٨ أونصات"), use: v("hot", "للساخن"), material: v("paper", "كوب ورقي"),
          priceAmount: v(0.42, "٠٫٤٢ ريال للحبة"), priceBasis: v("per_item", "للحبة"), vatStatus: v("included", "شامل الضريبة"),
          deliveryKind: v("free", "التوصيل مجاني"), deliveryCities: v(["الرياض"], "داخل الرياض"), leadTimeDays: v(4, "خلال ٤ أيام"),
        }),
      },
    ],
    expected: { verdict: "recommend", winnerIndex: 1, categories: ["confirmed", "confirmed"], totalsSar: [1440, 1260], note: "الندى أرخص للكوب (0.38) لكن إجماليها 1440 مقابل 1260." },
  },
  {
    id: "moq-payment",
    title: "سعر أقل للكوب ودفعة أعلى",
    lesson: "الحد الأدنى للطلب يرفع المبلغ المدفوع رغم انخفاض سعر الكوب، والنتيجة تتغير بحسب أولويتك.",
    requirementText: REQ_BASIC,
    rawRequirements: baseReq(REQ_BASIC),
    offers: [
      {
        text: "مصنع البيان (مثال خيالي): كوب ورقي ٨ أونصات للمشروبات الساخنة. ٠٫٣٥ ريال للحبة شامل الضريبة، الحد الأدنى للطلب ٥٠٠٠ كوب. توصيل مجاني للرياض خلال ٦ أيام.",
        raw: rawOffer({
          supplierName: v("مصنع البيان", "مصنع البيان"), cupSizeOz: v(8, "٨ أونصات"), use: v("hot", "للمشروبات الساخنة"), material: v("paper", "كوب ورقي"),
          priceAmount: v(0.35, "٠٫٣٥ ريال للحبة"), priceBasis: v("per_item", "للحبة"), vatStatus: v("included", "شامل الضريبة"),
          moq: v(5000, "٥٠٠٠ كوب"), moqUnit: v("item", "٥٠٠٠ كوب"), deliveryKind: v("free", "توصيل مجاني"), deliveryCities: v(["الرياض"], "للرياض"), leadTimeDays: v(6, "خلال ٦ أيام"),
        }),
      },
      {
        text: "توريد الأفق (مثال خيالي): كوب ورقي ٨ أونصات للساخن بسعر ٠٫٤٨ ريال للحبة شامل الضريبة. توصيل مجاني للرياض خلال ٣ أيام.",
        raw: rawOffer({
          supplierName: v("توريد الأفق", "توريد الأفق"), cupSizeOz: v(8, "٨ أونصات"), use: v("hot", "للساخن"), material: v("paper", "كوب ورقي"),
          priceAmount: v(0.48, "٠٫٤٨ ريال للحبة"), priceBasis: v("per_item", "للحبة"), vatStatus: v("included", "شامل الضريبة"),
          deliveryKind: v("free", "توصيل مجاني"), deliveryCities: v(["الرياض"], "للرياض"), leadTimeDays: v(3, "خلال ٣ أيام"),
        }),
      },
    ],
    expected: { verdict: "recommend", winnerIndex: 1, categories: ["confirmed", "confirmed"], totalsSar: [1750, 1440], note: "البيان 0.35 للكوب لكن يلزم 5000 كوب بدفعة 1750؛ الأفق 1440. بأولوية تكلفة الكوب يتقدم البيان." },
  },
  {
    id: "unresolved-attractive",
    title: "عرض جذاب لا يمكن التوصية به",
    lesson: "الطباعة والضريبة والتوصيل غير محسومة، فلا تتحول الجاذبية إلى توصية.",
    requirementText: "أحتاج ٣٠٠٠ كوب للمشروبات الساخنة، مقاس ٨ أونصات، بطباعة مخصصة، التوصيل إلى الرياض.",
    rawRequirements: baseReq("", { print: v("required", "بطباعة مخصصة") }),
    offers: [
      {
        text: "الصفوة للتغليف (مثال خيالي): كوب ٨ أونصات للساخن بسعر ٠٫٢٩ ريال فقط للحبة! عرض لفترة محدودة.",
        raw: rawOffer({
          supplierName: v("الصفوة للتغليف", "الصفوة للتغليف"), cupSizeOz: v(8, "٨ أونصات"), use: v("hot", "للساخن"),
          priceAmount: v(0.29, "٠٫٢٩ ريال"), priceBasis: v("per_item", "للحبة"),
        }),
      },
      {
        text: "مطبعة الريادة (مثال خيالي): كوب ٨ أونصات للساخن مع طباعة شعارك، ٠٫٥٥ ريال للحبة شامل الطباعة والضريبة. التوصيل للرياض ١٥٠ ريال شامل الضريبة.",
        raw: rawOffer({
          supplierName: v("مطبعة الريادة", "مطبعة الريادة"), cupSizeOz: v(8, "٨ أونصات"), use: v("hot", "للساخن"),
          priceAmount: v(0.55, "٠٫٥٥ ريال للحبة"), priceBasis: v("per_item", "للحبة"), printing: v("included", "شامل الطباعة"), vatStatus: v("included", "الطباعة والضريبة"),
          deliveryKind: v("amount", "التوصيل للرياض ١٥٠ ريال"), deliveryAmount: v(150, "١٥٠ ريال"), deliveryVat: v("included", "١٥٠ ريال شامل الضريبة"), deliveryCities: v(["الرياض"], "للرياض"),
        }),
      },
    ],
    expected: { verdict: "recommend_open", winnerIndex: 1, categories: ["clarify", "confirmed"], totalsSar: [null, 1800], note: "الصفوة تبقى للتوضيح؛ الريادة مؤكدة لكن لا يقال إنها الأرخص." },
  },
  {
    id: "different-sizes",
    title: "مقاس مختلف لا يقارن",
    lesson: "العرض بمقاس مختلف يخرج من المقارنة مهما كان سعره.",
    requirementText: REQ_BASIC,
    rawRequirements: baseReq(REQ_BASIC),
    offers: [
      {
        text: "أكواب النخبة (مثال خيالي): كوب ورقي ١٢ أونصة للساخن، ٠٫٣٠ ريال للحبة شامل الضريبة، توصيل مجاني للرياض.",
        raw: rawOffer({
          supplierName: v("أكواب النخبة", "أكواب النخبة"), cupSizeOz: v(12, "١٢ أونصة"), use: v("hot", "للساخن"), priceAmount: v(0.3, "٠٫٣٠ ريال للحبة"), priceBasis: v("per_item", "للحبة"),
          vatStatus: v("included", "شامل الضريبة"), deliveryKind: v("free", "توصيل مجاني"), deliveryCities: v(["الرياض"], "للرياض"),
        }),
      },
      {
        text: "أكواب السلام (مثال خيالي): كوب ورقي ٨ أونصات للساخن، ٠٫٤٥ ريال للحبة شامل الضريبة، توصيل مجاني للرياض.",
        raw: rawOffer({
          supplierName: v("أكواب السلام", "أكواب السلام"), cupSizeOz: v(8, "٨ أونصات"), use: v("hot", "للساخن"), priceAmount: v(0.45, "٠٫٤٥ ريال للحبة"), priceBasis: v("per_item", "للحبة"),
          vatStatus: v("included", "شامل الضريبة"), deliveryKind: v("free", "توصيل مجاني"), deliveryCities: v(["الرياض"], "للرياض"),
        }),
      },
    ],
    expected: { verdict: "recommend", winnerIndex: 1, categories: ["fail", "confirmed"], totalsSar: [900, 1350], note: "النخبة 12 أونصة تُستبعد رغم إجمالي أقل." },
  },
  {
    id: "missing-lids",
    title: "شمول الأغطية غير مذكور",
    lesson: "غياب ذكر الأغطية يعني «غير معروف»، لا مشمولة ولا مستبعدة.",
    requirementText: "أحتاج ٣٠٠٠ كوب للمشروبات الساخنة، مقاس ٨ أونصات، مع أغطية، التوصيل إلى الرياض.",
    rawRequirements: baseReq("", { lid: v("required", "مع أغطية") }),
    offers: [
      {
        text: "دار الأكواب (مثال خيالي): كوب ٨ أونصات للساخن، ٠٫٣٦ ريال للحبة شامل الضريبة، توصيل مجاني للرياض.",
        raw: rawOffer({
          supplierName: v("دار الأكواب", "دار الأكواب"), cupSizeOz: v(8, "٨ أونصات"), use: v("hot", "للساخن"), priceAmount: v(0.36, "٠٫٣٦ ريال للحبة"), priceBasis: v("per_item", "للحبة"),
          vatStatus: v("included", "شامل الضريبة"), deliveryKind: v("free", "توصيل مجاني"), deliveryCities: v(["الرياض"], "للرياض"),
        }),
      },
      {
        text: "ركن التغليف (مثال خيالي): كوب ٨ أونصات للساخن مع الغطاء، ٠٫٤٤ ريال للحبة شامل الغطاء والضريبة، توصيل مجاني للرياض.",
        raw: rawOffer({
          supplierName: v("ركن التغليف", "ركن التغليف"), cupSizeOz: v(8, "٨ أونصات"), use: v("hot", "للساخن"), priceAmount: v(0.44, "٠٫٤٤ ريال للحبة"), priceBasis: v("per_item", "للحبة"),
          lids: v("included", "شامل الغطاء"), vatStatus: v("included", "الغطاء والضريبة"), deliveryKind: v("free", "توصيل مجاني"), deliveryCities: v(["الرياض"], "للرياض"),
        }),
      },
    ],
    expected: { verdict: "recommend_open", winnerIndex: 1, categories: ["clarify", "confirmed"], totalsSar: [1080, 1320], note: "دار الأكواب أرخص إجماليًا لكن الغطاء مجهول." },
  },
  {
    id: "nested-packaging",
    title: "كرتون داخله باكيتات",
    lesson: "العبوة المتداخلة تُحسب في الكود، ويظهر الفائض بعد التقريب إلى كراتين كاملة.",
    requirementText: REQ_BASIC,
    rawRequirements: baseReq(REQ_BASIC),
    offers: [
      {
        text: "الأساس للتوريد (مثال خيالي): كوب ٨ أونصات للساخن. الكرتون بـ ٤٥٠ ريال شامل الضريبة، ٢٠ باكيت في الكرتون، كل باكيت ٥٠ كوب. توصيل مجاني للرياض.",
        raw: rawOffer({
          supplierName: v("الأساس للتوريد", "الأساس للتوريد"), cupSizeOz: v(8, "٨ أونصات"), use: v("hot", "للساخن"), priceAmount: v(450, "٤٥٠ ريال"), priceBasis: v("per_package", "الكرتون بـ ٤٥٠ ريال"),
          packageLevels: v([{ label: "كرتون", count: 20 }, { label: "باكيت", count: 50 }], "٢٠ باكيت في الكرتون، كل باكيت ٥٠ كوب"), vatStatus: v("included", "شامل الضريبة"),
          deliveryKind: v("free", "توصيل مجاني"), deliveryCities: v(["الرياض"], "للرياض"),
        }),
      },
      {
        text: "ميثاق للأكواب (مثال خيالي): كوب ٨ أونصات للساخن. الكرتون ١٦٠٠ كوب بسعر ٧٠٠ ريال شامل الضريبة. توصيل مجاني للرياض.",
        raw: rawOffer({
          supplierName: v("ميثاق للأكواب", "ميثاق للأكواب"), cupSizeOz: v(8, "٨ أونصات"), use: v("hot", "للساخن"), priceAmount: v(700, "٧٠٠ ريال"), priceBasis: v("per_package", "الكرتون ١٦٠٠ كوب بسعر ٧٠٠ ريال"),
          packageLevels: v([{ label: "كرتون", count: 1600 }], "الكرتون ١٦٠٠ كوب"), vatStatus: v("included", "شامل الضريبة"), deliveryKind: v("free", "توصيل مجاني"), deliveryCities: v(["الرياض"], "للرياض"),
        }),
      },
    ],
    expected: { verdict: "recommend", winnerIndex: 0, categories: ["confirmed", "confirmed"], totalsSar: [1350, 1400], note: "3 كراتين بالضبط مقابل كرتونين بفائض 200 كوب." },
  },
  {
    id: "fixed-lot",
    title: "سعر ثابت لكمية محددة",
    lesson: "العرض بكمية ثابتة لا يُقسّم ولا يُكرر؛ إن قلّت كميته عن طلبك لم يستوفِ.",
    requirementText: REQ_BASIC,
    rawRequirements: baseReq(REQ_BASIC),
    offers: [
      {
        text: "تصفية المستودع (مثال خيالي): ٢٠٠٠ كوب ٨ أونصات للساخن بسعر إجمالي ٥٠٠ ريال شامل الضريبة، استلام وتوصيل مجاني للرياض.",
        raw: rawOffer({
          supplierName: v("تصفية المستودع", "تصفية المستودع"), cupSizeOz: v(8, "٨ أونصات"), use: v("hot", "للساخن"), priceAmount: v(500, "٥٠٠ ريال"), priceBasis: v("quoted_lot", "بسعر إجمالي ٥٠٠ ريال"),
          quotedQuantity: v(2000, "٢٠٠٠ كوب"), vatStatus: v("included", "شامل الضريبة"), deliveryKind: v("free", "توصيل مجاني"), deliveryCities: v(["الرياض"], "للرياض"),
        }),
      },
      {
        text: "كوب سيتي (مثال خيالي): 8 oz cup for hot drinks, 0.47 SAR per piece including VAT, free delivery to Riyadh.",
        raw: rawOffer({
          supplierName: v("كوب سيتي", "كوب سيتي"), cupSizeOz: v(8, "8 oz"), use: v("hot", "for hot drinks"), priceAmount: v(0.47, "0.47 SAR per piece"), priceBasis: v("per_item", "per piece"),
          vatStatus: v("included", "including VAT"), deliveryKind: v("free", "free delivery"), deliveryCities: v(["الرياض"], "to Riyadh"),
        }),
      },
    ],
    expected: { verdict: "recommend", winnerIndex: 1, categories: ["fail", "confirmed"], totalsSar: [500, 1410], note: "لا يُفترض تكرار دفعة 2000 كوب." },
  },
  {
    id: "user-correction",
    title: "تصحيحك يغيّر التوصية",
    lesson: "صحّح نوع ضريبة العرض الأول في شاشة المراجعة إلى «غير شامل» بنسبة 15%، وشاهد تغيّر التوصية.",
    requirementText: REQ_BASIC,
    rawRequirements: baseReq(REQ_BASIC),
    offers: [
      {
        text: "نجمة التغليف (مثال خيالي): كوب ٨ أونصات للساخن، الألف كوب بـ ٤٠٠ ريال شامل الضريبة، توصيل مجاني للرياض.",
        raw: rawOffer({
          supplierName: v("نجمة التغليف", "نجمة التغليف"), cupSizeOz: v(8, "٨ أونصات"), use: v("hot", "للساخن"), priceAmount: v(400, "٤٠٠ ريال"), priceBasis: v("per_package", "الألف كوب بـ ٤٠٠ ريال"),
          packageLevels: v([{ label: "ألف كوب", count: 1000 }], "الألف كوب"), vatStatus: v("included", "شامل الضريبة"), deliveryKind: v("free", "توصيل مجاني"), deliveryCities: v(["الرياض"], "للرياض"),
        }),
      },
      {
        text: "الجود للتوريد (مثال خيالي): كوب ٨ أونصات للساخن، ٠٫٤٢ ريال للحبة شامل الضريبة، توصيل مجاني للرياض.",
        raw: rawOffer({
          supplierName: v("الجود للتوريد", "الجود للتوريد"), cupSizeOz: v(8, "٨ أونصات"), use: v("hot", "للساخن"), priceAmount: v(0.42, "٠٫٤٢ ريال للحبة"), priceBasis: v("per_item", "للحبة"),
          vatStatus: v("included", "شامل الضريبة"), deliveryKind: v("free", "توصيل مجاني"), deliveryCities: v(["الرياض"], "للرياض"),
        }),
      },
    ],
    expected: { verdict: "recommend", winnerIndex: 0, categories: ["confirmed", "confirmed"], totalsSar: [1200, 1260], note: "بعد التصحيح إلى 15% غير شامل: نجمة 1380 والجود 1260 فتتغير التوصية." },
  },
  {
    id: "no-deadline-match",
    title: "لا أحد يلحق بالموعد",
    lesson: "إذا كان الموعد إلزاميًا ولم يلحق به أحد، فالتطبيق يقول ذلك صراحة.",
    requirementText: "أحتاج ٣٠٠٠ كوب للمشروبات الساخنة، مقاس ٨ أونصات، توصل إلى الرياض خلال ٣ أيام.",
    rawRequirements: baseReq("", { requiredWithinDays: v(3, "خلال ٣ أيام") }),
    offers: [
      {
        text: "سريع التوريد (مثال خيالي): كوب ٨ أونصات للساخن، ٠٫٤٠ ريال للحبة شامل الضريبة، توصيل مجاني للرياض خلال ٧ أيام.",
        raw: rawOffer({
          supplierName: v("سريع التوريد", "سريع التوريد"), cupSizeOz: v(8, "٨ أونصات"), use: v("hot", "للساخن"), priceAmount: v(0.4, "٠٫٤٠ ريال للحبة"), priceBasis: v("per_item", "للحبة"),
          vatStatus: v("included", "شامل الضريبة"), deliveryKind: v("free", "توصيل مجاني"), deliveryCities: v(["الرياض"], "للرياض"), leadTimeDays: v(7, "خلال ٧ أيام"),
        }),
      },
      {
        text: "مخازن الشرق (مثال خيالي): كوب ٨ أونصات للساخن، ٠٫٤٣ ريال للحبة شامل الضريبة، توصيل مجاني للرياض خلال ١٠ أيام.",
        raw: rawOffer({
          supplierName: v("مخازن الشرق", "مخازن الشرق"), cupSizeOz: v(8, "٨ أونصات"), use: v("hot", "للساخن"), priceAmount: v(0.43, "٠٫٤٣ ريال للحبة"), priceBasis: v("per_item", "للحبة"),
          vatStatus: v("included", "شامل الضريبة"), deliveryKind: v("free", "توصيل مجاني"), deliveryCities: v(["الرياض"], "للرياض"), leadTimeDays: v(10, "خلال ١٠ أيام"),
        }),
      },
    ],
    expected: { verdict: "none_eligible", categories: ["fail", "fail"], totalsSar: [1200, 1290], note: "الموعد 3 أيام، والعرضان 7 و10." },
  },
  {
    id: "full-journey",
    title: "الرحلة الكاملة: طلب عرض، خصم كمية، ورد مورد",
    lesson: "ثلاثة عروض: أحدها بخصم كمية صريح، وآخر لا يوضح الأغطية. ألصق رد المورد وشاهد تغيّر القرار.",
    requirementText: "مقهى يحتاج ٣٠٠٠ كوب ورقي للمشروبات الساخنة، مقاس ٨ أونصات، مع أغطية، التوصيل إلى الرياض خلال ١٠ أيام، وميزانيتي ١٥٠٠ ريال شاملة التوصيل والضريبة.",
    rawRequirements: rawRequirements({
      product: v("أكواب ورقية للمشروبات الساخنة", "كوب ورقي للمشروبات الساخنة"),
      quantity: v(3000, "٣٠٠٠ كوب"), sizeOz: v(8, "٨ أونصات"), material: v("paper", "كوب ورقي"), use: v("hot", "للمشروبات الساخنة"),
      lid: v("required", "مع أغطية"), city: v("الرياض", "الرياض"), requiredWithinDays: v(10, "خلال ١٠ أيام"), budgetSar: v(1500, "١٥٠٠ ريال"),
      budgetIncludesDelivery: v(true, "شاملة التوصيل"), budgetIncludesVat: v(true, "والضريبة"),
    }),
    offers: [
      {
        text: "الوفرة للتغليف (مثال خيالي)\nكوب ورقي ٨ أونصات للمشروبات الساخنة مع الغطاء.\nالكرتون ١٠٠٠ كوب، السعر ٤٨٠ ريال للكرتون شامل الغطاء والضريبة.\nخصم الكمية: من ٥ كراتين فأكثر يصبح سعر الكرتون ٤٢٠ ريال على كامل الطلب.\nالبيع بالكرتون الكامل. التوصيل مجاني داخل الرياض خلال ٧ أيام.",
        raw: rawOffer({
          supplierName: v("الوفرة للتغليف", "الوفرة للتغليف"), cupSizeOz: v(8, "٨ أونصات"), material: v("paper", "كوب ورقي"), use: v("hot", "للمشروبات الساخنة"),
          lids: v("included", "شامل الغطاء"), priceAmount: v(480, "٤٨٠ ريال"), priceBasis: v("per_package", "٤٨٠ ريال للكرتون"), packageLevels: v([{ label: "كرتون", count: 1000 }], "الكرتون ١٠٠٠ كوب"),
          soldByPackageOnly: v(true, "البيع بالكرتون الكامل"), vatStatus: v("included", "الغطاء والضريبة"), deliveryKind: v("free", "التوصيل مجاني"), deliveryCities: v(["الرياض"], "داخل الرياض"), leadTimeDays: v(7, "خلال ٧ أيام"),
          tierMechanism: v("all_units", "على كامل الطلب"),
          tiers: [{ minQty: 5, qtyUnit: "package", price: 420, priceBasis: "per_package", condition: null, quote: "من ٥ كراتين فأكثر يصبح سعر الكرتون ٤٢٠ ريال" }],
        }),
      },
      {
        text: "مصنع الربوة (مثال خيالي)\nكوب ورقي ٨ أونصات للساخن، ٠٫٤٠ ريال للحبة شامل الضريبة.\nالتسليم خلال ٥ أيام للرياض.",
        raw: rawOffer({
          supplierName: v("مصنع الربوة", "مصنع الربوة"), cupSizeOz: v(8, "٨ أونصات"), material: v("paper", "كوب ورقي"), use: v("hot", "للساخن"),
          priceAmount: v(0.4, "٠٫٤٠ ريال للحبة"), priceBasis: v("per_item", "للحبة"), vatStatus: v("included", "شامل الضريبة"), leadTimeDays: v(5, "خلال ٥ أيام"), deliveryCities: v(["الرياض"], "للرياض"),
        }),
      },
      {
        text: "تموين الديرة (مثال خيالي)\nكوب ورقي ٨ أونصات للساخن مع غطاء، ٠٫٥٤ ريال للحبة شامل الغطاء والضريبة. توصيل مجاني للرياض خلال ٤ أيام.",
        raw: rawOffer({
          supplierName: v("تموين الديرة", "تموين الديرة"), cupSizeOz: v(8, "٨ أونصات"), material: v("paper", "كوب ورقي"), use: v("hot", "للساخن"),
          lids: v("included", "شامل الغطاء"), priceAmount: v(0.54, "٠٫٥٤ ريال للحبة"), priceBasis: v("per_item", "للحبة"), vatStatus: v("included", "الغطاء والضريبة"),
          deliveryKind: v("free", "توصيل مجاني"), deliveryCities: v(["الرياض"], "للرياض"), leadTimeDays: v(4, "خلال ٤ أيام"),
        }),
      },
    ],
    reply: {
      offerIndex: 1,
      text: "رد مورد خيالي: حياكم الله، السعر يشمل الغطاء مع كل كوب. والتوصيل داخل الرياض مجاني.",
      raw: rawOffer({ lids: v("included", "السعر يشمل الغطاء"), deliveryKind: v("free", "مجاني"), deliveryCities: v(["الرياض"], "داخل الرياض") }),
    },
    expected: { verdict: "recommend_open", winnerIndex: 0, categories: ["confirmed", "clarify", "fail"], totalsSar: [1440, null, 1620], note: "الديرة تتجاوز الميزانية. بعد رد الربوة يصبح إجماليها 1200 فتتغير التوصية من الوفرة إلى الربوة." },
  },
];
