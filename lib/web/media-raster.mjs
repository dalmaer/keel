// Bounded structural validation only: image provenance is still an owner declaration.
import { inflateSync } from "node:zlib";
import { WebError } from "./common.mjs";
const invalid = () => {
  throw new WebError("invalid_raster", 400);
};
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function dimensions(width, height) {
  if (
    !width ||
    !height ||
    width > 8192 ||
    height > 8192 ||
    width * height > 12000000
  )
    throw new WebError("image_dimensions_exceeded", 413);
  return { width, height };
}
function png(b) {
  let offset = 8,
    width,
    height,
    depth,
    color,
    idats = [],
    ended = false,
    seenData = false,
    dataEnded = false,
    plte = false,
    palette = 0;
  const seenAncillary = new Set();
  const allowed = new Set([
    "IHDR",
    "PLTE",
    "IDAT",
    "IEND",
    "tRNS",
    "gAMA",
    "cHRM",
    "sRGB",
    "pHYs",
    "tEXt",
    "iCCP",
  ]);
  while (offset < b.length) {
    if (offset + 12 > b.length) invalid();
    const length = b.readUInt32BE(offset),
      type = b.toString("ascii", offset + 4, offset + 8),
      end = offset + 12 + length;
    if (
      end > b.length ||
      !allowed.has(type) ||
      crc(b.subarray(offset + 4, end - 4)) !== b.readUInt32BE(end - 4)
    )
      invalid();
    const data = b.subarray(offset + 8, end - 4);
    if ((offset === 8 && type !== "IHDR") || (offset !== 8 && type === "IHDR"))
      invalid();
    if (type === "IHDR") {
      if (length !== 13) invalid();
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      dimensions(width, height);
      depth = data[8];
      color = data[9];
      if (
        !{
          0: [1, 2, 4, 8, 16],
          2: [8, 16],
          3: [1, 2, 4, 8],
          4: [8, 16],
          6: [8, 16],
        }[color]?.includes(depth) ||
        data[10] !== 0 ||
        data[11] !== 0 ||
        data[12] !== 0
      )
        invalid();
    } else if (type === "PLTE") {
      if (
        seenData ||
        plte ||
        length < 3 ||
        length > 768 ||
        length % 3 ||
        [0, 4].includes(color)
      )
        invalid();
      if (color === 3 && length / 3 > 2 ** depth) invalid();
      plte = true;
      palette = length / 3;
    } else if (type === "IDAT") {
      if (dataEnded || (color === 3 && !plte)) invalid();
      seenData = true;
      idats.push(data);
    } else if (type === "IEND") {
      if (length !== 0 || !seenData || end !== b.length) invalid();
      ended = true;
    } else {
      if (type !== "tEXt" && (seenData || seenAncillary.has(type))) invalid();
      seenAncillary.add(type);
      if (type === "gAMA" && (length !== 4 || data.readUInt32BE(0) === 0))
        invalid();
      if (type === "cHRM" && length !== 32) invalid();
      if (type === "sRGB" && (length !== 1 || data[0] > 3)) invalid();
      if (type === "pHYs" && (length !== 9 || data[8] > 1)) invalid();
      if (type === "tRNS") {
        if (color === 0) {
          if (length !== 2 || data.readUInt16BE(0) >= 2 ** depth) invalid();
        } else if (color === 2) {
          if (length !== 6) invalid();
          for (let n = 0; n < 6; n += 2)
            if (data.readUInt16BE(n) >= 2 ** depth) invalid();
        } else if (color === 3) {
          if (!plte || length < 1 || length > palette) invalid();
        } else invalid();
      }
      if (type === "iCCP") {
        const split = data.indexOf(0),
          keyword = data.subarray(0, split);
        if (
          split < 1 ||
          split > 79 ||
          keyword[0] === 32 ||
          keyword.at(-1) === 32 ||
          keyword.some((b) => b < 32 || (b > 126 && b < 161)) ||
          keyword.toString("latin1").includes("  ") ||
          data[split + 1] !== 0
        )
          invalid();
        try {
          const compressed = data.subarray(split + 2),
            result = inflateSync(compressed, {
              maxOutputLength: 1048576,
              info: true,
            }),
            profile = result.buffer;
          if (
            result.engine.bytesWritten !== compressed.length ||
            profile.length < 128 ||
            profile.readUInt32BE(0) !== profile.length ||
            profile.toString("ascii", 36, 40) !== "acsp"
          )
            invalid();
        } catch {
          invalid();
        }
      }
      if (type === "tEXt") {
        const split = data.indexOf(0),
          keyword = data.subarray(0, split);
        if (
          split < 1 ||
          split > 79 ||
          keyword[0] === 32 ||
          keyword.at(-1) === 32 ||
          keyword.some((b) => b < 32 || (b > 126 && b < 161)) ||
          keyword.toString("latin1").includes("  ") ||
          data.subarray(split + 1).includes(0)
        )
          invalid();
      }
      if (seenData) dataEnded = true;
    }
    offset = end;
  }
  if (!ended) invalid();
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color],
    row = Math.ceil((width * channels * depth) / 8) + 1,
    expected = row * height;
  // Max 96MB decompression for the admitted 12MP/16-bit RGBA case; no unbounded inflater.
  let raw;
  try {
    const result = inflateSync(Buffer.concat(idats), {
      maxOutputLength: expected,
      info: true,
    });
    if (result.engine.bytesWritten !== Buffer.concat(idats).length) invalid();
    raw = result.buffer;
  } catch {
    invalid();
  }
  if (raw.length !== expected) invalid();
  for (let i = 0; i < height; i++) if (raw[i * row] > 4) invalid();
  return { mime: "image/png", width, height };
}
function jpeg(b) {
  let i = 2,
    width,
    height,
    frame = false,
    scan = false,
    ended = false,
    components = new Set(),
    quant = new Set(),
    huffman = new Set(),
    componentTables = new Map(),
    dcScans = new Set(),
    progressive = false;
  while (i < b.length) {
    if (b[i++] !== 255) invalid();
    while (b[i] === 255) i++;
    const marker = b[i++];
    if (marker === 217) {
      if (
        !scan ||
        i !== b.length ||
        [...components].some((c) => !dcScans.has(c))
      )
        invalid();
      ended = true;
      break;
    }
    if (
      marker === 216 ||
      marker === 0 ||
      marker === 1 ||
      (marker >= 208 && marker <= 215)
    )
      invalid();
    if (i + 2 > b.length) invalid();
    const length = b.readUInt16BE(i);
    if (length < 2 || i + length > b.length) invalid();
    const data = b.subarray(i + 2, i + length);
    i += length;
    if (marker === 192 || marker === 194) {
      if (frame || data.length < 6 || data[0] !== 8) invalid();
      height = data.readUInt16BE(1);
      width = data.readUInt16BE(3);
      dimensions(width, height);
      const count = data[5];
      if (![1, 3, 4].includes(count) || data.length !== 6 + 3 * count)
        invalid();
      for (let n = 0; n < count; n++) {
        const p = 6 + n * 3;
        if (
          components.has(data[p]) ||
          !(
            data[p + 1] >> 4 >= 1 &&
            data[p + 1] >> 4 <= 4 &&
            (data[p + 1] & 15) >= 1 &&
            (data[p + 1] & 15) <= 4
          ) ||
          data[p + 2] > 3
        )
          invalid();
        components.add(data[p]);
        componentTables.set(data[p], data[p + 2]);
      }
      frame = true;
      progressive = marker === 194;
    } else if (
      marker >= 193 &&
      marker <= 207 &&
      ![196, 200, 204].includes(marker)
    )
      invalid();
    else if (marker === 219) {
      let p = 0;
      while (p < data.length) {
        const kind = data[p++],
          size = kind >> 4 === 0 ? 64 : kind >> 4 === 1 ? 128 : 0;
        if (!size || (kind & 15) > 3 || p + size > data.length) invalid();
        for (let n = 0; n < size; n += kind >> 4 === 0 ? 1 : 2)
          if ((kind >> 4 === 0 ? data[p + n] : data.readUInt16BE(p + n)) === 0)
            invalid();
        quant.add(kind & 15);
        p += size;
      }
    } else if (marker === 196) {
      let p = 0;
      while (p < data.length) {
        const kind = data[p++];
        if (kind >> 4 > 1 || (kind & 15) > 3 || p + 16 > data.length) invalid();
        let count = 0,
          available = 1;
        for (let n = 0; n < 16; n++) {
          count += data[p + n];
          available = available * 2 - data[p + n];
          if (available < 1) invalid();
        }
        p += 16;
        if (!count || count > 256 || p + count > data.length) invalid();
        const symbols = data.subarray(p, p + count);
        if (new Set(symbols).size !== count) invalid();
        if (
          (kind >> 4 === 0 && symbols.some((v) => v > 11)) ||
          (kind >> 4 === 1 &&
            symbols.some(
              (v) => (v & 15) > 10 || ((v & 15) === 0 && v !== 0 && v !== 240),
            ))
        )
          invalid();
        huffman.add(kind);
        p += count;
      }
    } else if (marker === 218) {
      if (!frame || !quant.size || !huffman.size || data.length < 4) invalid();
      const count = data[0];
      if (
        !count ||
        count > components.size ||
        data.length !== 1 + 2 * count + 3
      )
        invalid();
      const ss = data.at(-3),
        se = data.at(-2),
        ah = data.at(-1) >> 4,
        al = data.at(-1) & 15;
      if (
        (!progressive && (ss !== 0 || se !== 63 || ah !== 0 || al !== 0)) ||
        (progressive &&
          (ss > se ||
            se > 63 ||
            ah > 13 ||
            al > 13 ||
            (ss === 0 && se !== 0) ||
            (ss > 0 && count !== 1) ||
            (ah !== 0 && ah !== al + 1)))
      )
        invalid();
      const seen = new Set();
      for (let n = 0; n < count; n++) {
        const c = data[1 + 2 * n],
          tables = data[2 + 2 * n];
        if (
          !components.has(c) ||
          seen.has(c) ||
          tables >> 4 > 3 ||
          (tables & 15) > 3
        )
          invalid();
        if (
          !quant.has(componentTables.get(c)) ||
          (ss === 0 && !huffman.has(tables >> 4)) ||
          (se > 0 && !huffman.has(16 + (tables & 15)))
        )
          invalid();
        seen.add(c);
        if (ss === 0) dcScans.add(c);
      }
      scan = true;
      let entropy = 0;
      while (i < b.length) {
        if (b[i] !== 255) {
          i++;
          entropy++;
          continue;
        }
        if (i + 1 >= b.length) invalid();
        if (b[i + 1] === 0) {
          i += 2;
          entropy++;
          continue;
        }
        if (b[i + 1] >= 208 && b[i + 1] <= 215) {
          i += 2;
          continue;
        }
        break;
      }
      if (!entropy) invalid();
    } else if (!(
      (marker >= 224 && marker <= 239) ||
      marker === 254 ||
      marker === 221
    ))
      invalid();
  }
  if (!ended || !width || !height) invalid();
  return { mime: "image/jpeg", width, height };
}
export function validateRaster(value) {
  if (!Buffer.isBuffer(value) || !value.length || value.length > 2097152)
    throw new WebError("image_bytes_exceeded", 413);
  if (
    value.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return png(value);
  if (value[0] === 255 && value[1] === 216) return jpeg(value);
  invalid();
}
