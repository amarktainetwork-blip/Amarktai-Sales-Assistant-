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
  const name = inverse ? "text-white" : "text-[#1C2738]";
  const subtext = inverse ? "text-white/72" : "text-[#667085]";

  return (
    <span
      className="inline-flex flex-col items-start leading-none"
      aria-label="Amarktai Network Sales Assistant"
    >
      <span
        className={`font-display font-bold tracking-[-.05em] ${large ? "text-[29px]" : "text-[22px]"} ${name}`}
      >
        Amarkt<span className="text-[#2F6FED]">ai</span>{!compact && " Network"}
      </span>
      {!compact && (
        <small
          className={`mt-1.5 text-[11px] font-extrabold tracking-[.13em] ${subtext}`}
        >
          Sales Assistant
        </small>
      )}
    </span>
  );
}
