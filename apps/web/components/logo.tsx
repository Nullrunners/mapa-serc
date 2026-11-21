import Image from "next/image";
import { BRAND } from "@/lib/brand";

/**
 * The campaign mark. Decorative, because the name always stands next to it. Loaded eagerly so a printed sticker
 * never comes out without it.
 */
export function LogoMark({ className }: { className?: string }) {
  return <Image src={BRAND.logo} alt="" width={64} height={64} loading="eager" className={className} />;
}
