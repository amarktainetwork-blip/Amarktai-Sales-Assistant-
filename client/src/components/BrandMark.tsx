type BrandMarkProps = {
  compact?: boolean;
  inverse?: boolean;
  large?: boolean;
};

export function BrandMark({ compact = false, inverse = false, large = false }: BrandMarkProps) {
  const name = inverse ? "text-white" : "text-[#F5F7FB]";
  const subtext = inverse ? "text-[#AFC4E6]" : "text-[#8FA8CE]";
  return <div className="inline-flex items-center gap-3" aria-label="Amarktai Network">
    <span className="grid size-11 place-items-center rounded-2xl border border-white/15 bg-[#1B64F2] shadow-[0_10px_25px_rgba(13,71,184,.38)]"><svg viewBox="0 0 36 36" className="size-7" aria-hidden="true"><path d="M18 4.5c5.2 0 7.9 5.5 4.9 9.7-2.1 3-6.6 3-8.7 0C11.1 10 12.8 4.5 18 4.5Z" fill="white"/><path d="M31.5 18c0 5.2-5.5 7.9-9.7 4.9-3-2.1-3-6.6 0-8.7 4.2-3 9.7-1.3 9.7 3.8Z" fill="white" opacity=".92"/><path d="M18 31.5c-5.2 0-7.9-5.5-4.9-9.7 2.1-3 6.6-3 8.7 0 3 4.2 1.3 9.7-3.8 9.7Z" fill="white" opacity=".84"/><path d="M4.5 18c0-5.2 5.5-7.9 9.7-4.9 3 2.1 3 6.6 0 8.7-4.2 3-9.7 1.3-9.7-3.8Z" fill="white" opacity=".76"/><circle cx="18" cy="18" r="3.5" fill="#1B64F2"/></svg></span>
    {!compact && <span className={`grid leading-none ${name}`}><span className={`font-display font-bold tracking-[-.065em] ${large ? "text-[27px]" : "text-[21px]"}`}>Amarktai <em className="not-italic text-[#75A7FF]">Network</em></span><small className={`mt-1 text-[8px] font-black uppercase tracking-[.2em] ${subtext}`}>Sales operations</small></span>}
  </div>;
}
