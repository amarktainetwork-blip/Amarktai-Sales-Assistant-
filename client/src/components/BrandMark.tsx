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
  const brand = inverse ? "text-white" : "text-[#17263B]";
  const product = inverse ? "text-white/72" : "text-[#5B6B7E]";

  return (
    <a
      href="/"
      className="inline-flex flex-col items-start leading-none no-underline"
      aria-label="AmarktAI Network Sales Assistant home"
    >
      <span
        className={`font-display font-extrabold tracking-[-.045em] ${large ? "text-[25px]" : "text-[21px]"} ${brand}`}
      >
        Amarkt<span className="text-[#2F6FED]">AI</span>{" "}
        <span className="font-semibold tracking-[-.035em]">Network</span>
      </span>
      {!compact && (
        <span
          className={`mt-1.5 text-[11px] font-bold tracking-[.12em] ${product}`}
        >
          SALES ASSISTANT
        </span>
      )}
    </a>
  );
}
