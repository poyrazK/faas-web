export function FrostedMark({ size = 56 }: { size?: number }) {
  return (
    <img
      src="/gregale-frosted.png"
      alt=""
      width={size}
      height={size}
      className="mx-auto block drop-shadow-[0_8px_18px_rgb(0_0_0/0.45)]"
    />
  );
}
