import Image, { type StaticImageData } from "next/image";
import logoSvg from "../../../../logo.svg";

/** Canonical Everprimer logo, sourced from the repo-root `logo.svg`. */
export const logo = logoSvg as StaticImageData;

/** Decorative; pair with `Wordmark` for the accessible name. */
export function EverprimerMark({ className = "h-9 w-9" }: { className?: string }) {
  return <Image src={logo} alt="" aria-hidden="true" loading="eager" className={`object-contain ${className}`} />;
}

export function Wordmark({ className = "" }: { className?: string }) {
  return <span className={`font-black tracking-tight ${className}`}>Everprimer</span>;
}
