/* Café supply drawings: small line icons for categories and steps, and the hero illustration.
   Icons draw in currentColor so they take the surrounding text colour. */

type IconProps = { className?: string };

const Icon = ({ className = "size-5", children }: IconProps & { children: React.ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>{children}</svg>
);

export const CupIcon = (p: IconProps) => <Icon {...p}><path d="M5 5.5h14v2.5H5z" /><path d="M6.2 8h11.6l-1.4 11.3a1 1 0 0 1-1 .9H8.6a1 1 0 0 1-1-.9z" /><path d="M7 12.5h10" /></Icon>;
export const LidIcon = (p: IconProps) => <Icon {...p}><path d="M3.5 15h17v2a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z" /><path d="M6 15c0-3.3 2.7-6 6-6s6 2.7 6 6" /><path d="M10.5 9V7h3v2" /></Icon>;
export const BagIcon = (p: IconProps) => <Icon {...p}><path d="M5 8.5h14l-1 11.5H6z" /><path d="M9 11V7.5a3 3 0 0 1 6 0V11" /></Icon>;
export const NapkinIcon = (p: IconProps) => <Icon {...p}><path d="M4 9l8-4 8 4-8 4z" /><path d="M4 13l8 4 8-4" /><path d="M4 17l8 4 8-4" /></Icon>;
export const BoxIcon = (p: IconProps) => <Icon {...p}><path d="M3.5 8.5L12 4.5l8.5 4v7.5L12 20l-8.5-4z" /><path d="M3.5 8.5L12 12.5l8.5-4" /><path d="M12 12.5V20" /></Icon>;
export const CartIcon = (p: IconProps) => <Icon {...p}><path d="M3 4h2l2.1 10.2a1 1 0 0 0 1 .8h8.7a1 1 0 0 0 1-.8L19.5 8H6" /><circle cx="9" cy="19" r="1.3" /><circle cx="17" cy="19" r="1.3" /></Icon>;
export const ChatIcon = (p: IconProps) => <Icon {...p}><path d="M4.5 5h15v10.5H10L5.5 19.5V15.5h-1z" /><path d="M8.5 9.5h7M8.5 12.5h4" /></Icon>;
export const SheetIcon = (p: IconProps) => <Icon {...p}><path d="M6.5 3h8l4 4v14h-12z" /><path d="M14.5 3v4h4" /><path d="M9 12h6.5M9 15.5h4.5" /></Icon>;
export const CheckIcon = (p: IconProps) => <Icon {...p}><circle cx="12" cy="12" r="8.5" /><path d="M8.3 12.3l2.5 2.5 5-5.2" /></Icon>;

export const CATEGORY_ICON = { cups: CupIcon, lids: LidIcon, bags: BagIcon, napkins: NapkinIcon, takeaway: BoxIcon } as const;

/** Café packaging on a counter, with two quotation cards: one marked best, one with something missing. */
export function CafeSuppliesArt({ className = "" }: { className?: string }) {
  const kraft = "#c9955f", kraftDark = "#a9774a", kraftLight = "#ddb07e", paper = "#fffdf8", paperShade = "#efe6da", seam = "#e2d6c6";
  return (
    <svg viewBox="0 0 560 470" role="img" aria-label="أكواب ورقية وأغطية وكيس ورقي ومناديل وعلبة سفري، وبطاقتا عرض سعر إحداهما مختارة" className={className}>
      <ellipse cx="292" cy="250" rx="252" ry="206" fill="#f4e7d6" />
      <circle cx="470" cy="300" r="70" fill="#edf2fd" />
      <ellipse cx="290" cy="436" rx="248" ry="24" fill="#e7d6c0" opacity="0.75" />

      {/* Stack of paper cups */}
      <path d="M118 172h96l-12 252h-72z" fill={paper} stroke={seam} />
      <path d="M190 172h24l-12 252h-14z" fill={paperShade} />
      {[166, 196, 226, 256, 286].map((y) => <rect key={y} x="112" y={y} width="108" height="11" rx="5.5" fill={paper} stroke={seam} />)}

      {/* Kraft bag */}
      <path d="M383 156l40 15 4 238-37 12z" fill={kraftDark} />
      <path d="M252 156h131l7 265H243z" fill={kraft} />
      <path d="M252 156h131v24H252z" fill={kraftLight} />
      <path d="M288 158c0-60 62-60 62 0" fill="none" stroke="#8a5f39" strokeWidth="6" strokeLinecap="round" />
      <g fill="none" stroke="#6e4b2b" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M296 262h44l-5 46h-34z" /><path d="M340 272c14 0 14 22 0 22" /><path d="M309 246c-4-6 4-10 0-16M323 246c-4-6 4-10 0-16" />
      </g>

      {/* Takeaway cup with lid and sleeve */}
      <path d="M202 262h92l-12 178h-68z" fill={paper} stroke={seam} />
      <path d="M272 262h22l-12 178h-14z" fill={paperShade} />
      <path d="M207 322h82l-4 64h-74z" fill={kraft} />
      <rect x="233" y="340" width="30" height="28" rx="7" fill="#2864db" />
      <path d="M240.5 354l5 5 10-10" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M210 244c8-22 68-22 76 0z" fill="#3a312c" />
      <rect x="195" y="242" width="106" height="22" rx="8" fill="#2d2622" />
      <rect x="203" y="247" width="40" height="4" rx="2" fill="#5a4c43" />

      {/* Napkins */}
      {[0, 1, 2, 3, 4, 5].map((i) => <rect key={i} x={50 + (i % 2) * 3} y={424 - i * 10} width="138" height="11" rx="3" fill={i % 2 ? paper : "#f7f0e6"} stroke={seam} />)}
      <path d="M53 374h138v-0.5L122 368z" fill={paperShade} />

      {/* Takeaway box */}
      <path d="M392 372l44-20h96l-44 20z" fill={kraftLight} />
      <path d="M488 372l44-20v62l-44 24z" fill={kraftDark} />
      <path d="M392 372h96v66h-96z" fill={kraft} />
      <path d="M426 372h28v10h-28z" fill={kraftDark} opacity="0.55" />

      {/* Coffee beans */}
      {[[320, 446, -20], [342, 452, 25], [302, 455, 60]].map(([x, y, r]) => (
        <g key={x} transform={`rotate(${r} ${x} ${y})`}><ellipse cx={x} cy={y} rx="9" ry="6" fill="#6b4128" /><path d={`M${x - 7} ${y}q7 -3 14 0`} stroke="#3f2416" strokeWidth="1.5" fill="none" /></g>
      ))}

      {/* Quotation card marked best */}
      <g className="float" style={{ filter: "drop-shadow(0 14px 18px rgb(84 58 32 / 0.18))" }}>
        <rect x="24" y="44" width="176" height="104" rx="14" fill="#fffdfa" stroke="#eae0d3" />
        <rect x="112" y="64" width="70" height="8" rx="4" fill="#d9cdbd" />
        <rect x="132" y="82" width="50" height="6" rx="3" fill="#eae0d3" />
        <path d="M42 108h140" stroke="#d9cdbd" strokeDasharray="2 4" />
        <rect x="42" y="118" width="62" height="18" rx="5" fill="#e8f5ee" />
        <rect x="128" y="118" width="54" height="18" rx="5" fill="#eef2f6" />
        <rect x="34" y="30" width="84" height="28" rx="14" fill="#149568" />
        <path d="M46 44l5 5 9-9" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        <text x="90" y="49" textAnchor="middle" fontSize="14" fontWeight="700" fill="#fff">الأنسب</text>
      </g>

      {/* Quotation card with missing information */}
      <g className="float" style={{ animationDelay: "-3.5s", filter: "drop-shadow(0 12px 16px rgb(84 58 32 / 0.16))" }}>
        <rect x="402" y="62" width="140" height="86" rx="14" fill="#fffdfa" stroke="#eae0d3" />
        <rect x="462" y="80" width="62" height="8" rx="4" fill="#d9cdbd" />
        <rect x="484" y="96" width="40" height="6" rx="3" fill="#eae0d3" />
        <rect x="420" y="116" width="104" height="20" rx="6" fill="#fbf0d8" />
        <text x="472" y="131" textAnchor="middle" fontSize="12" fontWeight="600" fill="#6f4b00">معلومة ناقصة</text>
      </g>
    </svg>
  );
}
