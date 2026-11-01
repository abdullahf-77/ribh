// Name and logo live here; colors and type live in src/app/globals.css.
export const brand = {
  nameAr: process.env.NEXT_PUBLIC_BRAND_NAME_AR ?? "رِبح",
  nameEn: process.env.NEXT_PUBLIC_BRAND_NAME_EN ?? "Ribh",
  descriptor: "مساعد مشتريات ذكي للمقاهي",
  tagline: "افهم عروضك. أحسن قرارك.",
  // Approved option-01 assets, used exactly as supplied in Ribh_Brand_Kit.
  logoSrc: "/brand/ribh-logo-transparent.png",
  symbolSrc: "/brand/ribh-symbol.svg",
};

// Only used when the user explicitly applies it to an offer that excludes VAT without stating a rate.
export const vatAssumption = {
  ratePercent: 15,
  effectiveFrom: "2020-07-01",
  source: "هيئة الزكاة والضريبة والجمارك (ZATCA)",
  sourceUrl: "https://zatca.gov.sa/ar/HelpCenter/guidelines/Documents/VAT15.pdf",
};

export const limits = {
  requirementChars: 2000,
  offerChars: 6000,
  replyChars: 4000,
  minOffers: 2,
  maxOffers: 3,
};
