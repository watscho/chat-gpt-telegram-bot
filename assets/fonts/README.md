# Noto Sans

`NotoSans-Regular.ttf` is an unmodified font from the official [Noto fonts repository](https://github.com/notofonts/noto-fonts/tree/main/hinted/ttf/NotoSans). It is distributed under the bundled [SIL Open Font License 1.1](OFL.txt).

The application embeds this local font in PDF conversation exports. It does not fetch fonts when serving requests. The exporter supports the bundled Latin/Greek/Cyrillic character range and directs unsupported scripts or emoji to lossless Markdown/JSON export rather than silently dropping them.
