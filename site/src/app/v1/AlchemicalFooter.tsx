export default function AlchemicalFooter() {
  return (
    <footer className="relative z-10 w-full border-t border-[#8a7e6b]/15 py-8 px-6">
      <div className="mx-auto flex max-w-4xl items-center justify-center gap-6 text-sm text-[#8a7e6b]">
        <a
          href="https://github.com/troywhoffman/forge-cc"
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors duration-300 hover:text-[#e8dcc8]"
        >
          GitHub
        </a>
        <a
          href="https://www.npmjs.com/package/forge-cc"
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors duration-300 hover:text-[#e8dcc8]"
        >
          npm
        </a>
        <a
          href="https://github.com/troywhoffman/forge-cc#readme"
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors duration-300 hover:text-[#e8dcc8]"
        >
          Docs
        </a>
      </div>
    </footer>
  );
}
