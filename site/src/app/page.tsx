import AlchemicalCanvas from "./v1/AlchemicalCanvas";
import AlchemicalInstallPill from "./v1/AlchemicalInstallPill";
import AlchemicalFooter from "./v1/AlchemicalFooter";

export default function Home() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-between">
      <AlchemicalCanvas />
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center gap-6 px-6">
        <h1 className="text-[72px] font-light leading-none tracking-tight text-[#e8dcc8] max-md:text-[48px]" style={{ fontFamily: "var(--font-cormorant)" }}>forge</h1>
        <p className="text-sm tracking-widest text-[#8a7e6b] uppercase" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>forge your workflow</p>
        <div className="mt-8"><AlchemicalInstallPill /></div>
      </main>
      <AlchemicalFooter />
    </div>
  );
}
