import InstallPill from "@/components/InstallPill";
import Footer from "@/components/Footer";

export default function V3Page() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-between">
      <main className="flex flex-1 flex-col items-center justify-center gap-8 px-6">
        <h1 className="text-3xl font-semibold tracking-tight">
          Direction 3: Negative Space
        </h1>
        <InstallPill />
      </main>
      <Footer />
    </div>
  );
}
