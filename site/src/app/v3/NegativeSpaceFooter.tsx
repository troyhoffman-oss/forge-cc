export default function NegativeSpaceFooter() {
  return (
    <footer className="w-full border-t border-[#1a1a1a]/10 py-8 px-6">
      <div className="mx-auto flex max-w-4xl items-center justify-center gap-6 text-sm text-[#8a8a8a]">
        <a
          href="https://github.com/troywhoffman/forge-cc"
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-[#c45038]"
        >
          GitHub
        </a>
        <a
          href="https://www.npmjs.com/package/forge-cc"
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-[#c45038]"
        >
          npm
        </a>
        <a
          href="https://github.com/troywhoffman/forge-cc#readme"
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-[#c45038]"
        >
          Docs
        </a>
      </div>
    </footer>
  );
}
