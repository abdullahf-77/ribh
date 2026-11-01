import type { TurnPlan } from "@/chat/types";
import { rawRequirements, v } from "./build";
import { scenarios } from "./scenarios";

/* Demo mode only, and always labelled as such in the UI. These fixed turns stand in for Llama's reading of
   exact fictional messages so the app can be shown without credentials. Any other message is refused.
   Everything after the reading step still runs through the real validation and calculation code. */

const journey = scenarios.find((s) => s.id === "full-journey")!;
const offerTexts = journey.offers.map((o) => o.text);
const replyText = journey.reply!.text;

const plan = (p: Partial<TurnPlan>): TurnPlan => ({
  reply: "", asks: [], requirementUpdates: rawRequirements({}), waived: [], offers: [], supplierReply: null, generateRfq: null,
  showComparison: false, explainDecision: false, whatIfQuantity: null, setPriority: null, showDiscount: false, unsupportedProduct: null, ...p,
});

export const unsupportedExample = "أبي أقارن عروض حبوب قهوة";

export const demoScript: { text: string; plan: TurnPlan }[] = [
  {
    text: "السلام عليكم، أبي أكواب ورقية للمشروبات الساخنة لمقهاي في الرياض",
    plan: plan({
      reply: "حياك الله. كم كوبًا تحتاج، وما المقاس بالأونصة؟",
      asks: ["quantity", "sizeOz"],
      requirementUpdates: rawRequirements({
        category: v("cups", "أكواب"), product: v("أكواب ورقية للمشروبات الساخنة", "أكواب ورقية للمشروبات الساخنة"), material: v("paper", "أكواب ورقية"),
        use: v("hot", "للمشروبات الساخنة"), city: v("الرياض", "في الرياض"),
      }),
    }),
  },
  {
    text: "٣٠٠٠ كوب مقاس ٨ أونصات مع أغطية",
    plan: plan({
      reply: "تمام. متى تحتاج الاستلام، وكم ميزانيتك؟",
      asks: ["requiredDate", "budgetSar"],
      requirementUpdates: rawRequirements({ quantity: v(3000, "٣٠٠٠ كوب"), sizeOz: v(8, "٨ أونصات"), lid: v("required", "مع أغطية") }),
    }),
  },
  {
    text: "خلال ١٠ أيام، وميزانيتي ١٥٠٠ ريال شاملة التوصيل والضريبة، وما أحتاج طباعة",
    plan: plan({
      reply: "اكتملت متطلباتك. أجهز لك طلب عرض سعر ترسله للموردين، أم عندك عروض جاهزة تلصقها هنا؟",
      requirementUpdates: rawRequirements({
        requiredWithinDays: v(10, "خلال ١٠ أيام"), budgetSar: v(1500, "١٥٠٠ ريال"), budgetIncludesDelivery: v(true, "شاملة التوصيل"), budgetIncludesVat: v(true, "والضريبة"),
        print: v("not_required", "ما أحتاج طباعة"),
      }),
    }),
  },
  { text: "جهّز لي طلب عرض سعر", plan: plan({ generateRfq: { includeBudget: false } }) },
  {
    text: `وصلتني هذي العروض:\n\n${offerTexts.join("\n\n")}`,
    plan: plan({ offers: offerTexts.map((text, i) => ({ supplierHint: ["الوفرة للتغليف", "مصنع الربوة", "تموين الديرة"][i], text })) }),
  },
  { text: "قارن العروض", plan: plan({ showComparison: true }) },
  { text: "ليش هذا المورد؟", plan: plan({ explainDecision: true }) },
  { text: "وش لو اشتريت ٥٠٠٠؟", plan: plan({ whatIfQuantity: 5000 }) },
  { text: "هل خصم الكمية يستاهل؟", plan: plan({ showDiscount: true }) },
  { text: replyText, plan: plan({ supplierReply: { offerId: "B", text: replyText } }) },
];

/** One short fictional walkthrough per other category: request, offers, comparison, and a reply when it has one. */
const pathFor = (id: string): { text: string; plan: TurnPlan }[] => {
  const s = scenarios.find((x) => x.id === id)!;
  const texts = s.offers.map((o) => o.text);
  const steps = [
    { text: s.requirementText, plan: plan({ requirementUpdates: s.rawRequirements, reply: "سجلت طلبك. الناقص يظهر في ملخص المتطلبات. ألصق عروض الموردين عندما تكون جاهزة." }) },
    { text: `وصلتني هذي العروض:\n\n${texts.join("\n\n")}`, plan: plan({ offers: texts.map((text) => ({ supplierHint: null, text })) }) },
    { text: "قارن العروض", plan: plan({ showComparison: true }) },
  ];
  if (s.reply) steps.push({ text: s.reply.text, plan: plan({ supplierReply: { offerId: "ABC"[s.reply.offerIndex], text: s.reply.text } }) });
  return steps;
};

export const demoPaths: { id: string; label: string; steps: { text: string; plan: TurnPlan }[] }[] = [
  { id: "cups", label: "أكواب: الرحلة الكاملة", steps: demoScript },
  { id: "lids", label: "أغطية", steps: pathFor("lids-basic") },
  { id: "bags", label: "أكياس", steps: pathFor("bags-basic") },
  { id: "napkins", label: "مناديل", steps: pathFor("napkins-basic") },
  { id: "takeaway", label: "عبوات سفري", steps: pathFor("takeaway-basic") },
];

const extras = [
  { text: "أبي أقارن عروض حبوب قهوة", plan: plan({ unsupportedProduct: "حبوب القهوة" }) },
];

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

export const demoPlanFor = (text: string): TurnPlan | null =>
  [...demoPaths.flatMap((p) => p.steps), ...extras].find((d) => norm(d.text) === norm(text))?.plan ?? null;
