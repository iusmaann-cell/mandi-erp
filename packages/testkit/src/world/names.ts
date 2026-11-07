import type { PartyKind } from "./dataset";

/** Synthetic names only (TS-9): no real person, shop or company. English and Urdu for every one (D-11). */
export interface ItemName {
  readonly code: string;
  readonly en: string;
  readonly ur: string;
  readonly base: "kg" | "pcs";
  /** Pack size in base units of the usual bag or carton. */
  readonly pack: number;
}

export const ITEM_NAMES: readonly ItemName[] = [
  { code: "RICE-BAS", en: "Basmati Rice", ur: "باسمتی چاول", base: "kg", pack: 50 },
  { code: "RICE-IRRI", en: "Irri-6 Rice", ur: "ایری 6 چاول", base: "kg", pack: 50 },
  { code: "RICE-BRK", en: "Broken Rice", ur: "ٹوٹا چاول", base: "kg", pack: 50 },
  { code: "WHEAT", en: "Wheat", ur: "گندم", base: "kg", pack: 50 },
  { code: "FLOUR", en: "Wheat Flour", ur: "گندم کا آٹا", base: "kg", pack: 50 },
  { code: "SUGAR", en: "Sugar", ur: "چینی", base: "kg", pack: 50 },
  { code: "DAL-MOONG", en: "Moong Lentils", ur: "دال مونگ", base: "kg", pack: 50 },
  { code: "DAL-MASOOR", en: "Masoor Lentils", ur: "دال مسور", base: "kg", pack: 50 },
  { code: "DAL-CHANA", en: "Chana Lentils", ur: "دال چنا", base: "kg", pack: 50 },
  { code: "CHICKPEA", en: "Chickpeas", ur: "کابلی چنے", base: "kg", pack: 50 },
  { code: "BESAN", en: "Gram Flour", ur: "بیسن", base: "kg", pack: 25 },
  { code: "CORN", en: "Maize", ur: "مکئی", base: "kg", pack: 50 },
  { code: "SALT", en: "Salt", ur: "نمک", base: "kg", pack: 50 },
  { code: "CHILI", en: "Red Chili", ur: "لال مرچ", base: "kg", pack: 25 },
  { code: "TURMERIC", en: "Turmeric", ur: "ہلدی", base: "kg", pack: 25 },
  { code: "CUMIN", en: "Cumin", ur: "زیرہ", base: "kg", pack: 25 },
  { code: "TEA", en: "Tea Leaves", ur: "چائے کی پتی", base: "kg", pack: 25 },
  { code: "DATES", en: "Dates", ur: "کھجور", base: "kg", pack: 25 },
  { code: "ALMOND", en: "Almonds", ur: "بادام", base: "kg", pack: 25 },
  { code: "RAISIN", en: "Raisins", ur: "کشمش", base: "kg", pack: 25 },
  { code: "SESAME", en: "Sesame Seeds", ur: "تل", base: "kg", pack: 50 },
  { code: "COCONUT", en: "Dried Coconut", ur: "سوکھا ناریل", base: "kg", pack: 25 },
  { code: "OIL", en: "Cooking Oil, 1 litre bottle", ur: "کوکنگ آئل، ایک لیٹر بوتل", base: "pcs", pack: 12 },
  { code: "GHEE", en: "Ghee, 1 kg pack", ur: "گھی، ایک کلو پیک", base: "pcs", pack: 12 },
];

export interface PartyName {
  readonly code: string;
  readonly kind: PartyKind;
  readonly en: string;
  readonly ur: string;
}
export const PARTY_NAMES: readonly PartyName[] = [
  { code: "SUP-NOOR", kind: "supplier", en: "Al-Noor Suppliers", ur: "النور سپلائرز" },
  { code: "CAR-FAST", kind: "carrier", en: "Fast Transport Co", ur: "فاسٹ ٹرانسپورٹ کمپنی" },
  { code: "CUS-KARIM", kind: "customer", en: "Karim Store", ur: "کریم اسٹور" },
  { code: "CUS-BILAL", kind: "customer", en: "Bilal Traders", ur: "بلال ٹریڈرز" },
  { code: "SUP-MADINA", kind: "supplier", en: "Madina Grain House", ur: "مدینہ گرین ہاؤس" },
  { code: "BOTH-REHMAN", kind: "both", en: "Rehman Brothers", ur: "رحمان برادرز" },
  { code: "SUP-GREEN", kind: "supplier", en: "Green Valley Foods", ur: "گرین ویلی فوڈز" },
  { code: "CUS-STAR", kind: "customer", en: "Star Wholesale", ur: "اسٹار ہول سیل" },
  { code: "SUP-PUNJAB", kind: "supplier", en: "Punjab Rice Mills", ur: "پنجاب رائس ملز" },
  { code: "CUS-CITY", kind: "customer", en: "City Kiryana Store", ur: "سٹی کریانہ اسٹور" },
  { code: "CAR-SALMAN", kind: "carrier", en: "Salman Transport", ur: "سلمان ٹرانسپورٹ" },
  { code: "BOTH-GHULAM", kind: "both", en: "Haji Ghulam Traders", ur: "حاجی غلام ٹریڈرز" },
  { code: "CUS-SHAN", kind: "customer", en: "Shan Provision Store", ur: "شان پروویژن اسٹور" },
  { code: "SUP-TAJ", kind: "supplier", en: "Taj Oil Depot", ur: "تاج آئل ڈپو" },
  { code: "CUS-AWAN", kind: "customer", en: "Awan Cash and Carry", ur: "اعوان کیش اینڈ کیری" },
  { code: "BOTH-BISMILLAH", kind: "both", en: "Bismillah Trading", ur: "بسم اللہ ٹریڈنگ" },
  { code: "SUP-DRYFRUIT", kind: "supplier", en: "Lahore Dry Fruit House", ur: "لاہور ڈرائی فروٹ ہاؤس" },
  { code: "SUP-ZUBAIR", kind: "supplier", en: "Zubair Flour Mills", ur: "زبیر فلور ملز" },
  { code: "CUS-METRO", kind: "customer", en: "Metro Bazaar", ur: "میٹرو بازار" },
  { code: "CAR-NOMAN", kind: "carrier", en: "Noman Loaders", ur: "نعمان لوڈرز" },
];
