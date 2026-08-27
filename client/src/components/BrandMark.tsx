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
  const name = inverse ? "text-white" : "text-[#111214]";
  const subtext = inverse ? "text-white/55" : "text-[#74777d]";
  return (
    <span
      className="inline-flex items-baseline gap-2"
      aria-label="Amarktai Network Sales Assistant"
    >
      <span
        className={`font-display font-bold tracking-[-.055em] ${large ? "text-[27px]" : "text-[21px]"} ${name}`}
      >
        Amarkt<span className="text-[#2F6FED]">ai</span> Network
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
