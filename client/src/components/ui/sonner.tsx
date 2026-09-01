import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      position="bottom-right"
      richColors
      closeButton
      toastOptions={{
        duration: 6500,
        classNames: {
          toast: "!shadow-xl !font-semibold",
          error:
            "!border-[#7F1D1D] !bg-[#7F1D1D] !text-white [&_[data-description]]:!text-red-50",
          success:
            "!border-emerald-700 !bg-emerald-700 !text-white [&_[data-description]]:!text-emerald-50",
          warning:
            "!border-amber-600 !bg-amber-50 !text-amber-950 [&_[data-description]]:!text-amber-900",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
