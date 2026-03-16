Compile a LaTeX file and report results.

1. If $ARGUMENTS is provided, use it as the filename. Otherwise, find `.tex` files in the `docs/` directory and ask which one to compile.
2. Run `pdflatex -interaction=nonstopmode <file>` from the file's directory. Run it twice for cross-references.
3. If there are errors, parse the log and show only the relevant error lines with context.
4. If successful, report the output PDF path and page count.

$ARGUMENTS
