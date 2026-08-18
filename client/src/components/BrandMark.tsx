/**
 * Signal Garden style reminder: this component uses the bright four-petal bloom
 * as a confident, human signal of sales momentum. Keep it bold, visible, and never generic.
 */
type BrandMarkProps = {
  compact?: boolean;
  inverse?: boolean;
};

const logoUrl = "/manus-storage/amarktai-signal-bloom-logo_14da6096.png";

export function BrandMark({ compact = false, inverse = false }: BrandMarkProps) {
  return (
    <div className="brand-mark" aria-label="Amarktai Sales Assistant">
      <img className="brand-mark__symbol" src={logoUrl} alt="" />
      {!compact && (
        <div className={`brand-mark__type ${inverse ? "brand-mark__type--inverse" : ""}`}>
          <span>Amarktai</span>
          <small>Sales Assistant</small>
        </div>
      )}
    </div>
  );
}

