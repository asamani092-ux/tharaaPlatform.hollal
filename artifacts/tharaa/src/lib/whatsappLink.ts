/** تطبيع جوال سعودي لرابط واتساب — O(n) على طول الرقم. */
export function toWhatsAppIntlPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = String(raw).trim().replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) {
    digits = digits.slice(1);
  }
  digits = digits.replace(/\D/g, "");

  if (digits.startsWith("966") && digits.length === 12 && digits[3] === "5") {
    return digits;
  }
  if (digits.startsWith("05") && digits.length === 10) {
    return `966${digits.slice(1)}`;
  }
  if (digits.startsWith("5") && digits.length === 9) {
    return `966${digits}`;
  }
  return null;
}

export function buildStrugglerWhatsAppUrl(
  phone: string | null | undefined,
  name: string,
  lastPrimaryAt: string | null | undefined
): string | null {
  const intl = toWhatsAppIntlPhone(phone);
  if (!intl) return null;
  const last = lastPrimaryAt && lastPrimaryAt.trim() !== "" ? lastPrimaryAt : "لا يوجد";
  const text = [
    `السلام عليكم ${name}،`,
    "نذكّرك برصد القراءة الأسبوعي في منصة ثراء المعرفة.",
    `آخر رصد مسجّل: ${last}.`,
  ].join("\n");
  return `https://wa.me/${intl}?text=${encodeURIComponent(text)}`;
}
