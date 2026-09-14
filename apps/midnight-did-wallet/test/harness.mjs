import { createHash } from "node:crypto";
import { blake2s256Hex } from "../src/blake2s.js";

// 1) Spec vector
const b64 = "TU9EMQAAAC0AAAABAQAAACFodHRwczovL2V4YW1wbGUub3JnL2hvbGRlcnMvYWxpY2UAAAAAAAAAAAAAAAAAAAABAQAAAA0jaG9sZGVyLWtleS0xAAAAAQEAAAArQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQQAAACtBUUVCQVFFQkFRRUJBUUVCQVFFQkFRRUJBUUVCQVFFQkFRRUJBUUVCQVFFAAAAAQMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAQAAAAgjcHJvZmlsZQAAAA1MaW5rZWREb21haW5zAAAAIWh0dHBzOi8vZXhhbXBsZS5vcmcvcHJvZmlsZS9hbGljZQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const payload = Buffer.from(b64, "base64url");
const spec = "3c08b85758d973a6002942c730d077ede51920c184927aaf010562035203fc21";
const got = blake2s256Hex(payload);
console.log("spec vector :", got === spec ? "PASS" : "FAIL got=" + got);

// 2) Fuzz against native Node blake2s256
const rnd = (n) => new Uint8Array(Array.from({ length: n }, () => Math.floor(Math.random() * 256)));
let fails = 0;
const sizes = [0, 1, 7, 8, 63, 64, 65, 127, 128, 129, 256, 1000, 4096];
for (const n of sizes) {
  for (let trial = 0; trial < 200; trial++) {
    const b = rnd(n);
    const native = createHash("blake2s256").update(b).digest("hex");
    const mine = blake2s256Hex(b);
    if (native !== mine) {
      fails++;
      if (fails < 5) console.log("MISMATCH n=" + n, "native=" + native, "mine=" + mine);
    }
  }
}
// Fixed known-answer vectors (BLAKE2s-256, no key) — pinned against Node
// native crypto.createHash('blake2s256') on this host.
const known = [
  ["", "69217a3079908094e11121d042354a7c1f55b6482ca1a51e1b250dfd1ed0eef9"],
  ["abc", "508c5e8c327c14e2e1a72ba34eeb452f37458b209ed63a294d999b4c86675982"],
];
for (const [s, want] of known) {
  const gotk = blake2s256Hex(Buffer.from(s, "utf8"));
  console.log(`KAV "${s}" :`, gotk === want ? "PASS" : "FAIL got=" + gotk);
}
console.log("fuzz fails:", fails, "of", sizes.length * 200);
