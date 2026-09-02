type BrandNameProps = {
  className?: string;
};

export function BrandName({ className = "" }: BrandNameProps) {
  return (
    <span className={`amk-brand-name ${className}`.trim()}>
      Amarkt<span className="amk-brand-name__ai">AI</span>
    </span>
  );
}
