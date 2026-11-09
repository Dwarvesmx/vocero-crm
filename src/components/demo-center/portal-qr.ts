// QR Model 2, versión 6-L, modo bytes, máscara 0. Sin red ni dependencias.
// Bloques (68 datos + 18 corrección) x 2; admite URLs de hasta 134 bytes.
export function qrPath(value: string): string {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > 134) throw new RangeError("URL demasiado larga para el QR");
  const bits: number[] = [];
  function append(n: number, length: number) {
    for (let i = length - 1; i >= 0; i--) bits.push((n >>> i) & 1);
  }
  append(4, 4); append(bytes.length, 8);
  for (const byte of bytes) append(byte, 8);
  append(0, 4);
  const data = Array.from({ length: bits.length / 8 }, (_, i) =>
    bits.slice(i * 8, i * 8 + 8).reduce((n, b) => (n << 1) | b, 0));
  for (let i = 0; data.length < 136; i++) data.push(i % 2 ? 0x11 : 0xec);
  function mul(a: number, b: number) {
    let r = 0;
    while (b) {
      if (b & 1) r ^= a;
      a = (a << 1) ^ (a & 128 ? 0x11d : 0);
      b >>>= 1;
    }
    return r;
  }
  let generator = [1], root = 1;
  for (let i = 0; i < 18; i++, root = mul(root, 2)) {
    const next = Array<number>(generator.length + 1).fill(0);
    generator.forEach((n, j) => { next[j] = next[j]! ^ n; next[j + 1] = next[j + 1]! ^ mul(n, root); });
    generator = next;
  }
  const blocks = [data.slice(0, 68), data.slice(68)];
  const ecc = blocks.map(block => {
    const remainder = [...block, ...Array<number>(18).fill(0)];
    for (let i = 0; i < 68; i++) {
      const factor = remainder[i]!;
      generator.forEach((n, j) => { remainder[i + j] = remainder[i + j]! ^ mul(n, factor); });
    }
    return remainder.slice(68);
  });
  bits.length = 0;
  for (const pair of [blocks, ecc]) for (let i = 0; i < pair[0]!.length; i++) {
    append(pair[0]![i]!, 8); append(pair[1]![i]!, 8);
  }
  const size = 41;
  const cells = Array.from({ length: size }, () => Array<number>(size).fill(-1));
  const set = (x: number, y: number, v: boolean) => {
    if (x >= 0 && y >= 0 && x < size && y < size) cells[y]![x] = Number(v);
  };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [x, y] of [[3, 3], [size - 4, 3], [3, size - 4]] as const) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      set(x + dx, y + dy, d !== 2 && d !== 4);
    }
  }
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    set(34 + dx, 34 + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  const format = (i: number) => Boolean(0x77c4 & (1 << i)); // L, máscara 0, BCH y XOR de formato
  for (let i = 0; i <= 5; i++) set(8, i, format(i));
  set(8, 7, format(6)); set(8, 8, format(7)); set(7, 8, format(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, format(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, format(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, format(i));
  set(8, size - 8, true);
  let index = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let row = 0; row < size; row++) {
      const y = ((right + 1) & 2) === 0 ? size - 1 - row : row;
      for (let x = right; x >= right - 1; x--) {
        if (cells[y]![x] !== -1) continue;
        set(x, y, Boolean((bits[index++] ?? 0) ^ Number((x + y) % 2 === 0)));
      }
    }
  }
  return cells.flatMap((row, y) => row.flatMap((dark, x) => dark ? [`M${x + 4},${y + 4}h1v1h-1z`] : [])).join("");
}
