import { brand } from "@/config/brand";

/* The only place the approved logo files are referenced. They are shown as supplied, never restyled. */

export function BrandLogo({ className = "" }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={brand.logoSrc} alt={`${brand.nameAr} ${brand.nameEn}`} className={`object-contain ${className}`} />;
}

export function BrandSymbol({ className = "" }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={brand.symbolSrc} alt="" aria-hidden className={`object-contain ${className}`} />;
}
