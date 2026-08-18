type BrandMarkProps = {
  compact?: boolean;
  inverse?: boolean;
};

export function BrandMark({ compact = false, inverse = false }: BrandMarkProps) {
  const text = inverse ? "text-white" : "text-[#08255C]";
  const subtext = inverse ? "text-blue-100" : "text-[#4471B8]";
  return <div className="inline-flex items-center gap-2.5" aria-label="Amarktai AI">
    <span className="grid size-9 place-items-center rounded-xl bg-[#1463F3] shadow-[0_7px_16px_rgba(20,99,243,.24)]"><svg viewBox="0 0 36 36" className="size-6" aria-hidden="true"><path d="M18 4.5c5.2 0 7.9 5.5 4.9 9.7-2.1 3-6.6 3-8.7 0C11.1 10 12.8 4.5 18 4.5Z" fill="white"/><path d="M31.5 18c0 5.2-5.5 7.9-9.7 4.9-3-2.1-3-6.6 0-8.7 4.2-3 9.7-1.3 9.7 3.8Z" fill="white" opacity=".92"/><path d="M18 31.5c-5.2 0-7.9-5.5-4.9-9.7 2.1-3 6.6-3 8.7 0 3 4.2 1.3 9.7-3.8 9.7Z" fill="white" opacity=".84"/><path d="M4.5 18c0-5.2 5.5-7.9 9.7-4.9 3 2.1 3 6.6 0 8.7-4.2 3-9.7 1.3-9.7-3.8Z" fill="white" opacity=".76"/><circle cx="18" cy="18" r="3.5" fill="#1463F3"/></svg></span>
    {!compact && <span className={`grid leading-none ${text}`}><span className="font-display text-[19px] font-bold tracking-[-.06em]">Amarktai <em className="not-italic text-[#1463F3]">AI</em></span><small className={`mt-1 text-[8px] font-black uppercase tracking-[.18em] ${subtext}`}>Sales Intelligence</small></span>}
  </div>;
}
