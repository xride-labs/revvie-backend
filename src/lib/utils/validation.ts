export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function getPhoneVariants(phone: string): string[] {
  const cleaned = phone.replace(/\D/g, "");
  const variants = new Set<string>();

  variants.add(cleaned);

  if (cleaned.startsWith("1") && cleaned.length === 11) {
    variants.add(cleaned.slice(1));
  }

  if (cleaned.length === 10) {
    variants.add(`1${cleaned}`);
  }

  if (cleaned.length >= 10) {
    const last10 = cleaned.slice(-10);
    variants.add(last10);
    variants.add(`1${last10}`);
  }

  return Array.from(variants);
}