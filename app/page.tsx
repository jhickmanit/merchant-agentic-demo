import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-5xl font-bold tracking-tight">Merchant Agentic Demo</h1>
      <p className="mt-4 text-muted-foreground">
        Ory × Skyfire KYAPay reference integration.
      </p>
      <Button className="mt-8" variant="default">Get started</Button>
    </main>
  );
}
