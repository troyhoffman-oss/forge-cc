import Link from "next/link";
import InstallPill from "@/components/InstallPill";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-between">
      <main className="flex flex-1 flex-col items-center justify-center gap-12 px-6">
        <h1 className="text-4xl font-semibold tracking-tight">forge</h1>
        <InstallPill />
        <nav className="flex flex-col items-center gap-4">
          <p className="text-sm text-[#a3a3a3]">Explore directions</p>
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-2">
            <Link
              href="/v1"
              className="text-sm text-[#e5e5e5] underline underline-offset-4 transition-colors hover:text-white"
            >
              v1 &mdash; Alchemical Forge
            </Link>
            <Link
              href="/v2"
              className="text-sm text-[#e5e5e5] underline underline-offset-4 transition-colors hover:text-white"
            >
              v2 &mdash; Stratigraphic Descent
            </Link>
            <Link
              href="/v3"
              className="text-sm text-[#e5e5e5] underline underline-offset-4 transition-colors hover:text-white"
            >
              v3 &mdash; Negative Space
            </Link>
          </div>
        </nav>
      </main>
      <Footer />
    </div>
  );
}
