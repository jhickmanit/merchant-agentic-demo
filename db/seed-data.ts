export const CATEGORIES = [
  { slug: "apparel", name: "Apparel", blurb: "Layers, shells, base layers." },
  { slug: "footwear", name: "Footwear", blurb: "Trail runners, boots, sandals." },
  { slug: "packs", name: "Packs", blurb: "Daypacks, hauls, hydration." },
  { slug: "food", name: "Trail Food", blurb: "Bars, dehydrated meals, electrolytes." },
  { slug: "accessories", name: "Accessories", blurb: "Headlamps, knives, repair kits." },
];

interface SeedProduct {
  slug: string;
  name: string;
  description: string;
  priceCents: number;
  categorySlug: string;
}

export const PRODUCTS: SeedProduct[] = [
  // apparel (6)
  { slug: "alpine-shell", name: "Alpine Shell Jacket", description: "3-layer waterproof shell. Pit zips, helmet-compatible hood, taped seams.", priceCents: 38900, categorySlug: "apparel" },
  { slug: "puffy-vest", name: "Puffy Vest", description: "650-fill down vest. Stuffs into its own pocket. Weighs 240g.", priceCents: 18900, categorySlug: "apparel" },
  { slug: "merino-tee", name: "Merino Tee", description: "150gsm merino wool. Breathes, doesn't stink, dries fast.", priceCents: 6500, categorySlug: "apparel" },
  { slug: "softshell-pant", name: "Softshell Pant", description: "Stretch softshell, articulated knees, gusseted crotch.", priceCents: 14900, categorySlug: "apparel" },
  { slug: "rain-pant", name: "Packable Rain Pant", description: "Side zips for layering. Packs to size of a soda can.", priceCents: 12900, categorySlug: "apparel" },
  { slug: "trucker-cap", name: "Trucker Cap", description: "Mesh back, snapback, embroidered logo.", priceCents: 2900, categorySlug: "apparel" },

  // footwear (5)
  { slug: "trail-runner-x", name: "Trail Runner X", description: "Vibram Megagrip outsole. 4mm drop. 290g per shoe.", priceCents: 16500, categorySlug: "footwear" },
  { slug: "approach-shoe", name: "Approach Shoe", description: "Sticky rubber climbing zone at toe. Reinforced upper.", priceCents: 17500, categorySlug: "footwear" },
  { slug: "leather-boot", name: "Leather Backpacking Boot", description: "Full-grain leather, waterproof membrane, all-day support.", priceCents: 27900, categorySlug: "footwear" },
  { slug: "camp-sandal", name: "Camp Sandal", description: "Foam footbed. Toe loop. For around camp and river crossings.", priceCents: 5900, categorySlug: "footwear" },
  { slug: "wool-sock-3pack", name: "Wool Hiking Sock — 3-pack", description: "Mid-weight merino crew. Lifetime guarantee.", priceCents: 4500, categorySlug: "footwear" },

  // packs (6)
  { slug: "summit-pack-20", name: "Summit Pack 20L", description: "Stripped-down daypack. 280g. Bungee front, ice axe loop.", priceCents: 8900, categorySlug: "packs" },
  { slug: "daypack-30", name: "Daypack 30L", description: "Frame sheet, hip belt, hydration sleeve, side pockets.", priceCents: 13900, categorySlug: "packs" },
  { slug: "weekend-pack-50", name: "Weekend Pack 50L", description: "For 1–3 night trips. Roll-top closure, removable lid.", priceCents: 24900, categorySlug: "packs" },
  { slug: "thru-hike-65", name: "Thru-Hike Pack 65L", description: "Ultralight haul-bag style. 1.1kg. 500D Ultra fabric.", priceCents: 32900, categorySlug: "packs" },
  { slug: "fanny-pack", name: "Trail Fanny Pack", description: "Two zip compartments, bottle pocket. Worn front or back.", priceCents: 3900, categorySlug: "packs" },
  { slug: "hydration-vest", name: "Hydration Vest 6L", description: "Two 500ml soft flasks included. Stretch storage pockets.", priceCents: 11900, categorySlug: "packs" },

  // food (6)
  { slug: "nut-butter-bar", name: "Nut Butter Bar — 12 pack", description: "300 calories of fat and protein per bar. Salted maple flavor.", priceCents: 2400, categorySlug: "food" },
  { slug: "dehydrated-curry", name: "Dehydrated Thai Curry Meal", description: "650 calories. Add boiling water, wait 10 minutes.", priceCents: 1500, categorySlug: "food" },
  { slug: "electrolyte-mix", name: "Electrolyte Mix — 30 servings", description: "1000mg sodium per serving. Lemon-lime flavor.", priceCents: 2900, categorySlug: "food" },
  { slug: "trail-mix-1lb", name: "Trail Mix — 1lb", description: "Almonds, cashews, raisins, dark chocolate. Resealable.", priceCents: 1100, categorySlug: "food" },
  { slug: "instant-coffee", name: "Instant Coffee — 10 packets", description: "Specialty single-origin. Dissolves in cold water.", priceCents: 1800, categorySlug: "food" },
  { slug: "energy-gel", name: "Energy Gel — 24 pack", description: "25g of carbs per gel. Mixed flavors.", priceCents: 4200, categorySlug: "food" },

  // accessories (7)
  { slug: "headlamp", name: "Headlamp 400 lumens", description: "Rechargeable USB-C. Red-light mode. IPX7.", priceCents: 7500, categorySlug: "accessories" },
  { slug: "pocket-knife", name: "Pocket Knife", description: "Locking blade, glass-filled nylon handle. 60g.", priceCents: 4900, categorySlug: "accessories" },
  { slug: "repair-kit", name: "Gear Repair Kit", description: "Tenacious Tape, patches, needle, dental floss, zip ties.", priceCents: 1900, categorySlug: "accessories" },
  { slug: "bear-spray", name: "Bear Spray", description: "10oz canister. EPA-approved. Holster included.", priceCents: 5500, categorySlug: "accessories" },
  { slug: "trekking-poles", name: "Carbon Trekking Poles — pair", description: "Z-fold, 110g per pole, cork grips.", priceCents: 14900, categorySlug: "accessories" },
  { slug: "first-aid-kit", name: "Wilderness First Aid Kit", description: "For 1–2 people, 3–5 days. Includes SAM splint.", priceCents: 6900, categorySlug: "accessories" },
  { slug: "water-filter", name: "Squeeze Water Filter", description: "Hollow-fiber. 0.1 micron. 1L/min flow rate.", priceCents: 3900, categorySlug: "accessories" },
];
