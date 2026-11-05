// kw-cdr: CorelDRAW-Datei (.cdr) → ein SVG je Seite auf stdout, Seiten durch \f getrennt
// (XML kennt kein \f). Eigener Prozess: ein Absturz in libcdr reißt die App nicht mit.
// Exit 0 = gelesen, 2 = keine lesbare CDR-Datei (Format/Version), 3 = Lesefehler, 64 = Aufruf falsch.
#include <cstdio>
#include <libcdr/libcdr.h>
#include <librevenge-generators/librevenge-generators.h>
#include <librevenge-stream/librevenge-stream.h>

int main(int argc, char **argv)
{
  if (argc != 2)
  {
    std::fputs("Aufruf: kw-cdr <datei.cdr>\n", stderr);
    return 64;
  }
  librevenge::RVNGFileStream input(argv[1]);
  if (!libcdr::CDRDocument::isSupported(&input))
    return 2;
  librevenge::RVNGStringVector pages;
  librevenge::RVNGSVGDrawingGenerator painter(pages, ""); // ohne Präfix: <svg xmlns="…">
  if (!libcdr::CDRDocument::parse(&input, &painter) || pages.empty())
    return 3;
  for (unsigned i = 0; i < pages.size(); ++i)
  {
    if (i)
      std::fputc('\f', stdout);
    std::fputs(pages[i].cstr(), stdout);
  }
  return 0;
}
