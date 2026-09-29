"""Builds trade-lab/ into one self-contained HTML file.

    python trade-lab/build.py --preview out.html   # design preview with SAMPLE data
    python trade-lab/build.py out.html             # live page (talks to /api/trade-lab)
    python trade-lab/build.py --tools out.html     # the Tools page (tools.html), same options

The preview inlines data/preview.js and turns on TRADE_LAB_PREVIEW, which
swaps in a pretend in-browser server with clearly labeled sample listings.
The live build never includes the sample data. Nothing here uploads or
deploys anything.
"""
import base64
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def _read(path, mode="r"):
    with open(os.path.join(HERE, path), mode, **({} if "b" in mode else {"encoding": "utf-8"})) as f:
        return f.read()


def _data_uri(path):
    return "data:image/webp;base64," + base64.b64encode(_read(path, "rb")).decode("ascii")


def build(preview=False, source="index.html"):
    page = _read(source)
    css = _read("css/styles.css").replace("url(../assets/", "url(assets/")
    css = re.sub(r"url\((assets/[\w.-]+\.webp)\)", lambda m: f"url({_data_uri(m.group(1))})", css)
    page = page.replace('<link rel="stylesheet" href="css/styles.css">', "<style>\n" + css + "\n</style>")
    page = page.replace('src="assets/logo.webp"', f'src="{_data_uri("assets/logo.webp")}"')
    start, end = page.index("<!-- DATA -->"), page.index("<!-- /DATA -->") + len("<!-- /DATA -->")
    data = ""
    if preview:
        data = "<script>window.TRADE_LAB_PREVIEW = true;</script>\n<script>\n" + _read("data/preview.js") + "\n</script>\n"
    page = page[:start] + data + page[end:]
    page = re.sub(r'<script src="(js/[\w.-]+)"></script>', lambda m: "<script>\n" + _read(m.group(1)) + "\n</script>", page)
    if preview:
        page = page.replace("<title>Gooncocks Trade Lab</title>", "<title>Trade Lab Preview</title>")
        page = page.replace("<title>Gooncocks Tools</title>", "<title>Tools Preview</title>")
    return page


if __name__ == "__main__":
    args = sys.argv[1:]
    preview = "--preview" in args
    out = [a for a in args if not a.startswith("--")]
    if len(out) != 1:
        sys.exit(__doc__)
    with open(out[0], "w", encoding="utf-8") as f:
        f.write(build(preview, "tools.html" if "--tools" in args else "index.html"))
    print(f"Wrote {out[0]} ({'preview with sample data' if preview else 'live'})")
