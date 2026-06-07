export type Variant = {
  label: string;
  price: string;
  price_inr: number;
  unit: string;
};

export type Product = {
  id: number;
  name: string;
  description: string;
  category: string;
  variants: Variant[];
};

export const products: Product[] = [
  {
    id: 1,
    name: "Apple",
    description: "Fresh Himalayan apples, crisp and sweet.",
    category: "Fruits",
    variants: [
      { label: "500g",  price: "₹80",  price_inr: 80,  unit: "500 grams" },
      { label: "1 kg",  price: "₹150", price_inr: 150, unit: "1 kilogram" },
      { label: "2 kg",  price: "₹280", price_inr: 280, unit: "2 kilograms" },
    ],
  },
  {
    id: 2,
    name: "Mango",
    description: "Alphonso mangoes, pulpy and aromatic.",
    category: "Fruits",
    variants: [
      { label: "6 pcs",  price: "₹120", price_inr: 120, unit: "6 pieces" },
      { label: "12 pcs", price: "₹220", price_inr: 220, unit: "12 pieces" },
      { label: "1 kg",   price: "₹180", price_inr: 180, unit: "1 kilogram" },
    ],
  },
  {
    id: 3,
    name: "Banana",
    description: "Robusta bananas, ripe and ready to eat.",
    category: "Fruits",
    variants: [
      { label: "6 pcs",   price: "₹40",  price_inr: 40,  unit: "6 pieces" },
      { label: "1 dozen", price: "₹70",  price_inr: 70,  unit: "12 pieces" },
      { label: "2 dozen", price: "₹130", price_inr: 130, unit: "24 pieces" },
    ],
  },
  {
    id: 4,
    name: "Orange",
    description: "Nagpur oranges, juicy with a tangy kick.",
    category: "Fruits",
    variants: [
      { label: "500g", price: "₹60",  price_inr: 60,  unit: "500 grams" },
      { label: "1 kg", price: "₹110", price_inr: 110, unit: "1 kilogram" },
      { label: "2 kg", price: "₹200", price_inr: 200, unit: "2 kilograms" },
    ],
  },
  {
    id: 5,
    name: "Watermelon",
    description: "Summer watermelons, chilled and refreshing.",
    category: "Fruits",
    variants: [
      { label: "Small (~2 kg)", price: "₹80",  price_inr: 80,  unit: "~2 kg whole" },
      { label: "Large (~4 kg)", price: "₹150", price_inr: 150, unit: "~4 kg whole" },
    ],
  },
  {
    id: 6,
    name: "Mixed Fruit Basket",
    description: "Curated seasonal fruit basket, great for gifting.",
    category: "Baskets",
    variants: [
      { label: "Small (5 fruits)",   price: "₹350", price_inr: 350, unit: "5 assorted fruits" },
      { label: "Medium (8 fruits)",  price: "₹550", price_inr: 550, unit: "8 assorted fruits" },
      { label: "Premium (12 fruits)", price: "₹850", price_inr: 850, unit: "12 assorted fruits" },
    ],
  },
];
