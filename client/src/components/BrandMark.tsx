type BrandMarkProps = {
  compact?: boolean;
  inverse?: boolean;
  large?: boolean;
};

export function BrandMark({
  compact = false,
  inverse = false,
  large = false,
}: BrandMarkProps) {
  const name = inverse ? "text-white" : "text-[#F5F4F0]";
  const subtext = inverse ? "text-white/60" : "text-[#A7A8AD]";
  return (
    <span
      className="inline-flex items-baseline gap-2"
      aria-label="Amarktai Network Sales Assistant"
    >
      <span
        className={`font-display font-bold tracking-[-.055em] ${large ? "text-[27px]" : "text-[21px]"} ${name}`}
      >
        Amarkt<span className="text-[#3B82F6]">ai</span> Network
      </span>
      {!compact && (
        <small
          className={`hidden text-[8px] font-black uppercase tracking-[.18em] sm:inline ${subtext}`}
        >
          Sales Assistant
        </small>
      )}
    </span>
  );
}
