export default function Footer() {
  return (
    <footer className="w-full border-t border-white/10 py-8 px-6">
      <div className="mx-auto flex max-w-4xl items-center justify-center gap-6 text-sm text-[#a3a3a3]">
        <a
          href="https://github.com/troywhoffman/forge-cc"
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-[#e5e5e5]"
        >
          GitHub
        </a>
        <a
          href="https://www.npmjs.com/package/forge-cc"
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-[#e5e5e5]"
        >
          npm
        </a>
        <a
          href="https://github.com/troywhoffman/forge-cc#readme"
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-[#e5e5e5]"
        >
          Docs
        </a>
      </div>
    </footer>
  );
}
