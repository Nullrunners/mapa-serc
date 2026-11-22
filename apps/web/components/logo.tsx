import Image from "next/image";
import { BRAND } from "@/lib/brand";

/**
 * The campaign mark. Decorative, because the name always stands next to it. Loaded eagerly so a printed sticker
 * never comes out without it, and served as the file is: one small picture sharp enough for every place, from the
 * header to the print.
 */
export function LogoMark({ className }: { className?: string }) {
  return <Image src={BRAND.logo} alt="" width={64} height={64} loading="eager" unoptimized className={className} />;
}
