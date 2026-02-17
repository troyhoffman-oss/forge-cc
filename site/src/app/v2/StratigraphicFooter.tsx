export default function StratigraphicFooter() {
  return (
    <footer className="relative z-10 w-full border-t border-[#6c7ab8]/15 py-8 px-6">
      <div className="mx-auto flex max-w-4xl items-center justify-center gap-6 text-sm text-[#7a7a8c]">
        <a
          href="https://github.com/troywhoffman/forge-cc"
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-[#e0e0e8]"
        >
          GitHub
        </a>
        <a
          href="https://www.npmjs.com/package/forge-cc"
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-[#e0e0e8]"
        >
          npm
        </a>
        <a
          href="https://github.com/troywhoffman/forge-cc#readme"
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-[#e0e0e8]"
        >
          Docs
        </a>
      </div>
    </footer>
  );
}
