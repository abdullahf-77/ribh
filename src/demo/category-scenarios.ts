import { rawOffer, rawRequirements, v } from "./build";
import type { Scenario } from "./scenarios";

/* All suppliers, prices and replies here are fictional. `expected` is only asserted against the real engine. */

const spec = (key: string, value: string, quote: string) => ({ key, value, quote });

export const categoryScenarios: Scenario[] = [
  {
    id: "lids-basic",
    title: "مقارنة أغطية",
    lesson: "الغطاء بفتحة شرب لا يقارن بغطاء مسطح، ورد المورد المتعارض ينتظر قرارك.",
    requirementText: "أبي ٥٠٠٠ غطاء بفتحة شرب لأكواب ٨ أونصات، التوصيل إلى جدة.",
    rawRequirements: rawRequirements({
      category: v("lids", "غطاء"), product: v("أغطية بفتحة شرب", "غطاء بفتحة شرب"), quantity: v(5000, "٥٠٠٠ غطاء"), city: v("جدة", "جدة"),
      specs: [spec("lidType", "sip", "بفتحة شرب"), spec("fitsCupOz", "8", "٨ أونصات")],
    }),
    offers: [
      {
        text: "الغطاء الذهبي (مثال خيالي): غطاء مسطح لأكواب ٨ أونصات، ١٢ هللة للحبة شامل الضريبة، توصيل مجاني لجدة.",
        raw: rawOffer({
          productCategory: v("lids", "غطاء"), supplierName: v("الغطاء الذهبي", "الغطاء الذهبي"), priceAmount: v(0.12, "١٢ هللة للحبة"), priceBasis: v("per_item", "للحبة"),
          vatStatus: v("included", "شامل الضريبة"), deliveryKind: v("free", "توصيل مجاني"), deliveryCities: v(["جدة"], "لجدة"),
          specs: [spec("lidType", "flat", "غطاء مسطح"), spec("fitsCupOz", "8", "٨ أونصات")],
        }),
      },
      {
        text: "مصنع الإتقان (مثال خيالي): غطاء بفتحة شرب لأكواب ٨ أونصات، الكرتون ١٠٠٠ حبة بسعر ١٨٠ ريال شامل الضريبة، توصيل مجاني لجدة.",
        raw: rawOffer({
          productCategory: v("lids", "غطاء"), supplierName: v("مصنع الإتقان", "مصنع الإتقان"), priceAmount: v(180, "١٨٠ ريال"), priceBasis: v("per_package", "الكرتون ١٠٠٠ حبة بسعر ١٨٠ ريال"),
          packageLevels: v([{ label: "كرتون", count: 1000 }], "الكرتون ١٠٠٠ حبة"), vatStatus: v("included", "شامل الضريبة"), deliveryKind: v("free", "توصيل مجاني"), deliveryCities: v(["جدة"], "لجدة"),
          specs: [spec("lidType", "sip", "بفتحة شرب"), spec("fitsCupOz", "8", "٨ أونصات")],
        }),
      },
    ],
    reply: {
      offerIndex: 1,
      text: "رد مورد خيالي: عذرًا، سعر الكرتون تعدّل إلى ٢٠٠ ريال، والتسليم خلال ٥ أيام.",
      raw: rawOffer({ priceAmount: v(200, "٢٠٠ ريال"), leadTimeDays: v(5, "خلال ٥ أيام") }),
    },
    expected: { verdict: "recommend", winnerIndex: 1, categories: ["fail", "confirmed"], totalsSar: [600, 900], note: "الأرخص مسطح فيُستبعد رغم إجمالي 600." },
  },
  {
    id: "bags-basic",
    title: "مقارنة أكياس",
    lesson: "الكيس بمقاس مختلف لا يقارن، والطباعة غير المذكورة تبقى غير معروفة.",
    requirementText: "أحتاج ٢٠٠٠ كيس ورقي بمقابض مقاس ٢٥×٣٢ سم مع طباعة، التوصيل إلى الرياض.",
    rawRequirements: rawRequirements({
      category: v("bags", "كيس"), product: v("أكياس ورقية بمقابض", "كيس ورقي بمقابض"), quantity: v(2000, "٢٠٠٠ كيس"), material: v("paper", "ورقي"), print: v("required", "مع طباعة"), city: v("الرياض", "الرياض"),
      specs: [spec("handles", "yes", "بمقابض"), spec("bagDimensions", "25×32", "٢٥×٣٢ سم")],
    }),
    offers: [
      {
        text: "أكياس المدينة (مثال خيالي): كيس ورقي بمقابض ٢٥×٣٢ سم، ٦٥ هللة للحبة شامل الطباعة والضريبة، توصيل مجاني للرياض.",
        raw: rawOffer({
          productCategory: v("bags", "كيس"), supplierName: v("أكياس المدينة", "أكياس المدينة"), material: v("paper", "ورقي"), printing: v("included", "شامل الطباعة"), priceAmount: v(0.65, "٦٥ هللة للحبة"), priceBasis: v("per_item", "للحبة"),
          vatStatus: v("included", "الطباعة والضريبة"), deliveryKind: v("free", "توصيل مجاني"), deliveryCities: v(["الرياض"], "للرياض"),
          specs: [spec("handles", "yes", "بمقابض"), spec("bagDimensions", "25×32", "٢٥×٣٢ سم")],
        }),
      },
      {
        text: "الحقيبة الخضراء (مثال خيالي): كيس ورقي بمقابض ٢٥×٣٢ سم، ٥٠ هللة للحبة شامل الضريبة، توصيل مجاني للرياض.",
        raw: rawOffer({
          productCategory: v("bags", "كيس"), supplierName: v("الحقيبة الخضراء", "الحقيبة الخضراء"), material: v("paper", "ورقي"), priceAmount: v(0.5, "٥٠ هللة للحبة"), priceBasis: v("per_item", "للحبة"),
          vatStatus: v("included", "شامل الضريبة"), deliveryKind: v("free", "توصيل مجاني"), deliveryCities: v(["الرياض"], "للرياض"),
          specs: [spec("handles", "yes", "بمقابض"), spec("bagDimensions", "25×32", "٢٥×٣٢ سم")],
        }),
      },
    ],
    expected: { verdict: "recommend_open", winnerIndex: 0, categories: ["confirmed", "clarify"], totalsSar: [1300, 1000], note: "الأرخص لم يذكر الطباعة، فلا يُجزم بأنه مناسب." },
  },
  {
    id: "napkins-basic",
    title: "مقارنة مناديل",
    lesson: "عدد الطبقات يحدد التوافق، والعبوة تحدد كمية الشراء الفعلية.",
    requirementText: "أبي ١٠٠٠٠ منديل طبقتين مقاس ٣٣×٣٣ سم، التوصيل إلى الدمام.",
    rawRequirements: rawRequirements({
      category: v("napkins", "منديل"), product: v("مناديل", "منديل"), quantity: v(10000, "١٠٠٠٠ منديل"), city: v("الدمام", "الدمام"),
      specs: [spec("ply", "2", "طبقتين"), spec("napkinSize", "33×33", "٣٣×٣٣ سم")],
    }),
    offers: [
      {
        text: "نقاء للمناديل (مثال خيالي): منديل طبقتين ٣٣×٣٣ سم، الكرتون ٢٤٠٠ منديل بسعر ١٤٤ ريال شامل الضريبة، البيع بالكرتون الكامل، توصيل مجاني للدمام.",
        raw: rawOffer({
          productCategory: v("napkins", "منديل"), supplierName: v("نقاء للمناديل", "نقاء للمناديل"), priceAmount: v(144, "١٤٤ ريال"), priceBasis: v("per_package", "الكرتون ٢٤٠٠ منديل بسعر ١٤٤ ريال"),
          packageLevels: v([{ label: "كرتون", count: 2400 }], "الكرتون ٢٤٠٠ منديل"), soldByPackageOnly: v(true, "البيع بالكرتون الكامل"), vatStatus: v("included", "شامل الضريبة"), deliveryKind: v("free", "توصيل مجاني"), deliveryCities: v(["الدمام"], "للدمام"),
          specs: [spec("ply", "2", "طبقتين"), spec("napkinSize", "33×33", "٣٣×٣٣ سم")],
        }),
      },
      {
        text: "لمسة ناعمة (مثال خيالي): منديل طبقة واحدة ٣٣×٣٣ سم، ٤ هللات للحبة شامل الضريبة، توصيل مجاني للدمام.",
        raw: rawOffer({
          productCategory: v("napkins", "منديل"), supplierName: v("لمسة ناعمة", "لمسة ناعمة"), priceAmount: v(0.04, "٤ هللات للحبة"), priceBasis: v("per_item", "للحبة"),
          vatStatus: v("included", "شامل الضريبة"), deliveryKind: v("free", "توصيل مجاني"), deliveryCities: v(["الدمام"], "للدمام"),
          specs: [spec("ply", "1", "طبقة واحدة"), spec("napkinSize", "33×33", "٣٣×٣٣ سم")],
        }),
      },
    ],
    expected: { verdict: "recommend", winnerIndex: 0, categories: ["confirmed", "fail"], totalsSar: [720, 400], note: "5 كراتين بفائض 2000؛ طبقة واحدة تُستبعد." },
  },
  {
    id: "takeaway-basic",
    title: "مقارنة عبوات سفري",
    lesson: "السعة ونوع العبوة وشمول الغطاء تحدد التوافق قبل السعر.",
    requirementText: "أحتاج ١٠٠٠ علبة سفري ورق سعة ٧٥٠ مل مع غطاء، التوصيل إلى الرياض.",
    rawRequirements: rawRequirements({
      category: v("takeaway", "علبة سفري"), product: v("علب سفري ورقية", "علبة سفري ورق"), quantity: v(1000, "١٠٠٠ علبة"), material: v("paper", "ورق"), lid: v("required", "مع غطاء"), city: v("الرياض", "الرياض"),
      specs: [spec("containerType", "box", "علبة"), spec("capacityMl", "750", "٧٥٠ مل")],
    }),
    offers: [
      {
        text: "سفري بلس (مثال خيالي): علبة ورق ٧٥٠ مل شامل الغطاء، ٩٠ هللة للحبة غير شامل الضريبة ١٥٪، توصيل مجاني للرياض.",
        raw: rawOffer({
          productCategory: v("takeaway", "علبة"), supplierName: v("سفري بلس", "سفري بلس"), material: v("paper", "علبة ورق"), lids: v("included", "شامل الغطاء"), priceAmount: v(0.9, "٩٠ هللة للحبة"), priceBasis: v("per_item", "للحبة"),
          vatStatus: v("excluded", "غير شامل الضريبة"), vatRatePercent: v(15, "١٥٪"), deliveryKind: v("free", "توصيل مجاني"), deliveryCities: v(["الرياض"], "للرياض"),
          specs: [spec("containerType", "box", "علبة"), spec("capacityMl", "750", "٧٥٠ مل")],
        }),
      },
      {
        text: "علب الشرق (مثال خيالي): علبة ورق ٥٠٠ مل مع غطاء، ٧٥ هللة للحبة شامل الضريبة، توصيل مجاني للرياض.",
        raw: rawOffer({
          productCategory: v("takeaway", "علبة"), supplierName: v("علب الشرق", "علب الشرق"), material: v("paper", "علبة ورق"), lids: v("included", "مع غطاء"), priceAmount: v(0.75, "٧٥ هللة للحبة"), priceBasis: v("per_item", "للحبة"),
          vatStatus: v("included", "شامل الضريبة"), deliveryKind: v("free", "توصيل مجاني"), deliveryCities: v(["الرياض"], "للرياض"),
          specs: [spec("containerType", "box", "علبة"), spec("capacityMl", "500", "٥٠٠ مل")],
        }),
      },
    ],
    expected: { verdict: "recommend", winnerIndex: 0, categories: ["confirmed", "fail"], totalsSar: [1035, 750], note: "الأرخص سعته 500 مل فيُستبعد." },
  },
];
