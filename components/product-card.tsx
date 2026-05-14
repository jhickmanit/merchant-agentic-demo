import Link from "next/link";
import { Card, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCents } from "@/lib/format";

interface Props {
  slug: string;
  name: string;
  priceCents: number;
  imageUrl: string;
  category: { name: string };
}

export function ProductCard({ slug, name, priceCents, imageUrl, category }: Props) {
  return (
    <Link href={`/p/${slug}`} className="block">
      <Card className="overflow-hidden transition-transform hover:scale-[1.02]">
        <div className="aspect-square w-full overflow-hidden bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt={name} className="h-full w-full object-cover" />
        </div>
        <CardHeader className="space-y-1">
          <CardTitle className="text-base">{name}</CardTitle>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{category.name}</p>
        </CardHeader>
        <CardFooter className="pt-0">
          <span className="text-lg font-semibold">{formatCents(priceCents)}</span>
        </CardFooter>
      </Card>
    </Link>
  );
}
