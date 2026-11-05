#!/bin/sh
# Baut den CDR-Hilfsprozess kw-cdr nach .build/bin/ – auf macOS oder unter Windows in einer MSYS2-UCRT64-Shell.
# librevenge + libcdr statisch (Quellen = LibreOffice-Spiegel, SHA-256 aus dessen download.lst).
# macOS: lcms2 aus dem Quelltext von lcms2-sys (cargo), ICU = libicucore des Systems; Header über pixi (pixi.toml).
# Windows: Header, lcms2 und zlib aus MSYS2-Paketen (gcc boost lcms2 zlib icu pkgconf), alles statisch;
#   ICU = icu.dll des Systems (ab Windows 10 1903) → keine fremden DLLs neben kw-cdr.exe.
# Dazu eine Kopie kw-cdr-<Ziel-Triple> für bundle.externalBin (Tauri legt sie als kw-cdr neben die App).
set -eu
cd "$(dirname "$0")"
HERE=$(pwd)
B=$HERE/.build
PREFIX=$B/prefix
mkdir -p "$B/src" "$PREFIX/lib/pkgconfig" "$B/bin"

case "$(uname -s)" in
Darwin)
  OS=mac EXE= TRIPLE=$(rustc -vV | sed -n 's/^host: //p')
  pixi install -q
  ENV=$HERE/.pixi/envs/default
  export PATH="$ENV/bin:$PATH"
  export PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig:$ENV/lib/pkgconfig"
  # ICU-Funktionen ohne Versionssuffix, damit libicucore sie auflöst; zlib = System
  CPPFLAGS="-I$ENV/include -DU_DISABLE_RENAMING=1"
  printf 'Name: zlib\nDescription: System\nVersion: %s\nLibs: -lz\nCflags:\n' \
    "$(sed -n 's/^#define ZLIB_VERSION "\(.*\)"/\1/p' "$(xcrun --show-sdk-path)/usr/include/zlib.h")" \
    >"$PREFIX/lib/pkgconfig/zlib.pc"
  ;;
UCRT64_NT* | MINGW64_NT*)
  OS=win EXE=.exe TRIPLE=x86_64-pc-windows-msvc
  export PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig:${PKG_CONFIG_PATH:-}"
  # wie macOS: die icu.dll von Windows exportiert die Funktionen ohne Versionssuffix
  CPPFLAGS="-DU_DISABLE_RENAMING=1"
  ;;
*)
  echo "kw-cdr: nur macOS oder Windows (MSYS2 UCRT64)" >&2
  exit 1
  ;;
esac

sha256() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
fetch() { # Datei, SHA-256
  [ -f "$B/src/$1" ] || curl -sSfL -o "$B/src/$1" "https://dev-www.libreoffice.org/src/$1"
  echo "$2  $B/src/$1" | sha256 -c - >/dev/null
  rm -rf "$B/src/${1%.tar.*}"
  tar -xf "$B/src/$1" -C "$B/src"
}
fetch librevenge-0.0.6.tar.bz2 52a65e904d255dbdd97a8b7bb28d6574e14f999eb01416aff004502406d0904d
fetch libcdr-0.1.9.tar.xz f7bb6abdd7f226820f288a93dd8d07759833c0250d9e202af90f9b312c4665a3

STATIC="--prefix=$PREFIX --disable-shared --enable-static --disable-werror --without-docs"
(cd "$B/src/librevenge-0.0.6" && ./configure -q $STATIC --disable-tests CPPFLAGS="$CPPFLAGS" && make -s -j8 install)
(cd "$B/src/libcdr-0.1.9" && ./configure -q $STATIC --disable-tests --disable-tools CPPFLAGS="$CPPFLAGS" && make -s -j8 install)

INC="-I$PREFIX/include/libcdr-0.1 -I$PREFIX/include/librevenge-0.0"
LIBS="$PREFIX/lib/libcdr-0.1.a $PREFIX/lib/librevenge-generators-0.0.a $PREFIX/lib/librevenge-stream-0.0.a $PREFIX/lib/librevenge-0.0.a"
if [ "$OS" = mac ]; then
  LCMS=$(ls -d "$HOME"/.cargo/registry/src/*/lcms2-sys-*/vendor | tail -1)
  rm -rf "$B/lcms2" && mkdir -p "$B/lcms2"
  (cd "$B/lcms2" && cc -c -O2 -I"$LCMS/include" "$LCMS"/src/*.c && ar rcs liblcms2.a ./*.o)
  c++ -std=c++17 -O2 -o "$B/bin/kw-cdr" kw_cdr.cpp $INC $LIBS "$B/lcms2/liblcms2.a" -licucore -lz
else
  # Importbibliothek für die icu.dll von Windows: genau die Funktionen, die libcdr ruft (nm -u auf macOS)
  printf 'LIBRARY icu.dll\nEXPORTS\n' >"$B/icu.def"
  for f in ucnv_close ucnv_getNextUChar ucnv_open ucsdet_close ucsdet_detect ucsdet_enableInputFilter \
    ucsdet_getConfidence ucsdet_getName ucsdet_open ucsdet_setText; do echo "$f" >>"$B/icu.def"; done
  dlltool -d "$B/icu.def" -l "$B/libicu-win.a"
  g++ -std=c++17 -O2 -s -municode -static -o "$B/bin/kw-cdr.exe" kw_cdr.cpp $INC $LIBS -llcms2 -lz "$B/libicu-win.a"
fi
cp "$B/bin/kw-cdr$EXE" "$B/bin/kw-cdr-$TRIPLE$EXE"
echo "fertig: $B/bin/kw-cdr$EXE"
