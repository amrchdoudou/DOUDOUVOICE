import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getDialectFlag(dialect: string): string {
  switch (dialect) {
    case 'Saudi Arabic':
      return '🇸🇦';
    case 'Emirati Arabic (Dubai / UAE)':
      return '🇦🇪';
    case 'Omani Arabic':
      return '🇴🇲';
    case 'Kuwaiti Arabic':
      return '🇰🇼';
    case 'Qatari Arabic':
      return '🇶🇦';
    case 'Bahraini Arabic':
      return '🇧🇭';
    case 'Egyptian Arabic':
      return '🇪🇬';
    case 'Algerian Arabic':
      return '🇩🇿';
    case 'Algerian Kabyle (Taqbaylit)':
      return '🇩🇿';
    case 'Tunisian Arabic':
      return '🇹🇳';
    case 'Libyan Arabic':
      return '🇱🇾';
    case 'Moroccan Arabic':
      return '🇲🇦';
    case 'Syrian Arabic':
      return '🇸🇾';
    case 'Iraqi Arabic':
      return '🇮🇶';
    case 'Palestinian Arabic':
      return '🇵🇸';
    case 'Neutral Middle Eastern Arabic':
      return '🌐';
    case 'American English (US)':
      return '🇺🇸';
    case 'British English (UK)':
      return '🇬🇧';
    default:
      return '🌐';
  }
}
