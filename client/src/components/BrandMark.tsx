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
  const brand = inverse ? "text-white" : "text-[#203047]";
  const product = inverse ? "text-white/82" : "text-[#607086]";

  return (
    <span
      className="inline-flex flex-col items-start leading-none"
      aria-label="Amarktai Network Sales Assistant"
    >
      <span
        className={`font-display font-extrabold tracking-[-.045em] ${large ? "text-[29px]" : "text-[22px]"} ${brand}`}
      >
        Amarkt<span className="text-[#2F6FED]">ai</span>{" "}
        <span className="font-semibold tracking-[-.035em]">Network</span>
      </span>
      {!compact && (
        <span
          className={`mt-1.5 text-[13px] font-bold tracking-[.08em] ${product}`}
        >
          SALES ASSISTANT
        </span>
      )}
    </span>
  );
}
