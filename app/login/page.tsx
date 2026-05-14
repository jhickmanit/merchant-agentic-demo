import { redirect } from "next/navigation";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ return_to?: string }>;
}) {
  const { return_to } = await searchParams;
  const baseUrl = process.env.ORY_SDK_URL!;
  const url = new URL(`${baseUrl}/ui/login`);
  if (return_to) {
    url.searchParams.set("return_to", `http://localhost:3000/auth/callback?return_to=${encodeURIComponent(return_to)}`);
  } else {
    url.searchParams.set("return_to", "http://localhost:3000/auth/callback?return_to=/");
  }
  redirect(url.toString());
}
