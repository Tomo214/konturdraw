#!/bin/sh
# Baut den CDR-Hilfsprozess kw-cdr (macOS) nach .build/bin/kw-cdr.
# librevenge + libcdr statisch (Quellen = LibreOffice-Spiegel, SHA-256 aus dessen download.lst),
# lcms2 aus dem Quelltext von lcms2-sys (cargo), ICU = libicucore des Systems → keine fremden dylibs.
# Voraussetzung: pixi (Header von boost/icu/lcms2 + pkg-config, siehe pixi.toml).
set -eu
cd "$(dirname "$0")"
HERE=$(pwd)
B=$HERE/.build
PREFIX=$B/prefix
mkdir -p "$B/src" "$PREFIX/lib" "$B/bin"
pixi install -q
ENV=$HERE/.pixi/envs/default
export PATH="$ENV/bin:$PATH"
export PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig:$ENV/lib/pkgconfig"

fetch() { # Datei, SHA-256
  [ -f "$B/src/$1" ] || curl -sSfL -o "$B/src/$1" "https://dev-www.libreoffice.org/src/$1"
  echo "$2  $B/src/$1" | shasum -a 256 -c - >/dev/null
  rm -rf "$B/src/${1%.tar.*}"
  tar -xf "$B/src/$1" -C "$B/src"
}
fetch librevenge-0.0.6.tar.bz2 52a65e904d255dbdd97a8b7bb28d6574e14f999eb01416aff004502406d0904d
fetch libcdr-0.1.9.tar.xz f7bb6abdd7f226820f288a93dd8d07759833c0250d9e202af90f9b312c4665a3

# ICU-Funktionen ohne Versionssuffix, damit libicucore sie auflöst; zlib = System
CPPFLAGS="-I$ENV/include -DU_DISABLE_RENAMING=1"
mkdir -p "$PREFIX/lib/pkgconfig"
printf 'Name: zlib\nDescription: System\nVersion: %s\nLibs: -lz\nCflags:\n' \
  "$(sed -n 's/^#define ZLIB_VERSION "\(.*\)"/\1/p' "$(xcrun --show-sdk-path)/usr/include/zlib.h")" \
  > "$PREFIX/lib/pkgconfig/zlib.pc"
STATIC="--prefix=$PREFIX --disable-shared --enable-static --disable-werror --without-docs"

(cd "$B/src/librevenge-0.0.6" && ./configure -q $STATIC --disable-tests CPPFLAGS="$CPPFLAGS" && make -s -j8 install)
(cd "$B/src/libcdr-0.1.9" && ./configure -q $STATIC --disable-tests --disable-tools CPPFLAGS="$CPPFLAGS" && make -s -j8 install)

LCMS=$(ls -d "$HOME"/.cargo/registry/src/*/lcms2-sys-*/vendor | tail -1)
rm -rf "$B/lcms2" && mkdir -p "$B/lcms2"
(cd "$B/lcms2" && cc -c -O2 -I"$LCMS/include" "$LCMS"/src/*.c && ar rcs liblcms2.a ./*.o)

c++ -std=c++17 -O2 -o "$B/bin/kw-cdr" kw_cdr.cpp \
  -I"$PREFIX/include/libcdr-0.1" -I"$PREFIX/include/librevenge-0.0" \
  "$PREFIX/lib/libcdr-0.1.a" "$PREFIX/lib/librevenge-generators-0.0.a" \
  "$PREFIX/lib/librevenge-stream-0.0.a" "$PREFIX/lib/librevenge-0.0.a" \
  "$B/lcms2/liblcms2.a" -licucore -lz
echo "fertig: $B/bin/kw-cdr"
