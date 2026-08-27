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
  const subtext = inverse ? "text-white/88" : "text-[#475467]";

  return (
    <span
      className="inline-flex flex-col items-start leading-none"
      aria-label="Amarktai Sales Assistant"
    >
      <span
        className={`font-display font-bold tracking-[-.055em] ${large ? "text-[30px]" : "text-[23px]"} ${name}`}
      >
        Amarkt<span className="text-[#2F6FED]">ai</span>
      </span>
      {!compact && (
        <span
          className={`mt-1.5 text-[14px] font-extrabold tracking-[.025em] ${subtext}`}
        >
          Sales Assistant
        </span>
      )}
    </span>
  );
}
