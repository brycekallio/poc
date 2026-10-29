// Geist, bundled with the extension and registered on the host document.
//
// Two browser rules force this route. Chrome ignores @font-face declared inside
// a shadow root, so the face has to live on the document. And a host page's CSP
// can refuse a font URL, but it does not govern a FontFace built from bytes the
// extension already fetched. The family names are prefixed so they cannot
// collide with anything the host page loads.

export const FAMILY = "POC Geist";

const FILES = [
  [FAMILY, "fonts/Geist-Regular.woff2", "400"],
  [FAMILY, "fonts/Geist-Medium.woff2", "500"],
];

let loading = null;

/** Load the faces once per page. `url` maps a packaged path to a fetchable URL. */
export function loadFonts(url) {
  loading ??= Promise.all(
    FILES.map(async ([family, path, weight]) => {
      const bytes = await (await fetch(url(path))).arrayBuffer();
      const face = new FontFace(family, bytes, { weight, style: "normal" });
      document.fonts.add(await face.load());
    }),
  ).catch(() => {
    // Falls back to the system stack in panel.css. Never throw into the page.
  });
  return loading;
}
