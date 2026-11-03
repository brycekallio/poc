// While a model streams `{"prompt":"Write a one-page…`, the JSON is not valid
// yet, but the string being written is exactly what the user wants to watch.
// This reads one top-level string field out of the text so far.

/** The (possibly unfinished) value of `"key": "…"` in a JSON object being streamed, or "" if it has not started. */
export function partialString(buf, key) {
  const m = new RegExp(`"${key}"\\s*:\\s*"`).exec(buf);
  if (!m) return "";
  let out = "";
  for (let i = m.index + m[0].length; i < buf.length; i++) {
    const c = buf[i];
    if (c === '"') break; // the value is complete
    if (c !== "\\") {
      out += c;
      continue;
    }
    const n = buf[i + 1];
    if (n === undefined) break; // an escape cut in half: wait for the rest
    if (n === "u") {
      const hex = buf.slice(i + 2, i + 6);
      if (hex.length < 4) break;
      out += String.fromCharCode(parseInt(hex, 16));
      i += 5;
    } else {
      out += { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" }[n] ?? n;
      i += 1;
    }
  }
  return out;
}
