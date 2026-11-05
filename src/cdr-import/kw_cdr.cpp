// kw-cdr: CorelDRAW-Datei (.cdr) → ein SVG je Seite auf stdout, Seiten durch \f getrennt
// (XML kennt kein \f). Eigener Prozess: ein Absturz in libcdr reißt die App nicht mit.
// Exit 0 = gelesen, 2 = keine lesbare CDR-Datei (Format/Version), 3 = Lesefehler, 64 = Aufruf falsch.
#include <cstdio>
#include <vector>
#include <libcdr/libcdr.h>
#include <librevenge-generators/librevenge-generators.h>
#include <librevenge-stream/librevenge-stream.h>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

// Datei ganz lesen; der Speicher-Stream kann wie der Datei-Stream ZIP (CDR X4+) und OLE.
static int convert(FILE *f)
{
  std::vector<unsigned char> data;
  unsigned char buf[65536];
  for (size_t n; f && (n = std::fread(buf, 1, sizeof buf, f)) > 0;)
    data.insert(data.end(), buf, buf + n);
  if (f)
    std::fclose(f);
  if (data.empty())
    return 2;
  librevenge::RVNGStringStream input(data.data(), unsigned(data.size()));
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

#ifdef _WIN32
// wmain: char*-Argumente kämen in der ANSI-Codepage an und verlören Zeichen wie „Ω“.
int wmain(int argc, wchar_t **argv)
{
  if (argc != 2)
  {
    std::fputs("Aufruf: kw-cdr <datei.cdr>\n", stderr);
    return 64;
  }
  _setmode(_fileno(stdout), _O_BINARY); // \n nicht zu \r\n machen
  return convert(_wfopen(argv[1], L"rb"));
}
#else
int main(int argc, char **argv)
{
  if (argc != 2)
  {
    std::fputs("Aufruf: kw-cdr <datei.cdr>\n", stderr);
    return 64;
  }
  return convert(std::fopen(argv[1], "rb"));
}
#endif
